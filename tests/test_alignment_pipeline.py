"""Regression checks for resumable alignment and pure-stdlib planning."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location('align_transcripts', Path(__file__).parents[1] / 'scripts/align_transcripts.py')
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)


def episode(slug):
    return {
        'slug': slug, 'audio': {'url': 'https://example.com/' + slug + '.mp3'},
        'transcriptStatus': 'available', 'transcript': ['Hello world. Good day.'],
    }


def alignment(lesson):
    return {
        'audioUrl': lesson['audio']['url'],
        'transcriptHash': pipeline.transcript_hash(lesson['transcript']),
        'duration': 4,
        'segments': [
            {'text': 'Hello world.', 'paragraphIndex': 0, 'start': 0, 'end': 1},
            {'text': 'Good day.', 'paragraphIndex': 0, 'start': 1, 'end': 2},
        ],
    }


class AlignmentPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / 'db.json'
        self.output = self.root / 'alignment.json'
        self.lessons = [episode(slug) for slug in ('old', 'first', 'second')]
        self.database.write_text(json.dumps({'version': 1, 'episodes': self.lessons}))
        pipeline.atomic_json(self.output, {'version': 1, 'episodes': {'old': alignment(self.lessons[0])}})

    def invoke(self, *flags):
        stdout, stderr = io.StringIO(), io.StringIO()
        args = ['align_transcripts.py', '--database', str(self.database), '--output', str(self.output), *flags]
        with mock.patch.object(sys, 'argv', args), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = pipeline.main()
        return code, stdout.getvalue(), stderr.getvalue()

    def test_plan_skips_valid_entries_without_model_dependencies_or_writes(self):
        before = self.output.read_bytes()
        with mock.patch.dict(sys.modules, {'torch': None, 'stable_whisper': None}):
            code, output, _ = self.invoke('--all-missing', '--plan', '--shard-count', '2')
        plan = json.loads(output)
        self.assertEqual(code, 0)
        self.assertEqual(plan['pending'], ['first', 'second'])
        self.assertEqual(plan['validCount'], 1)
        self.assertEqual(plan['shards'], [['first'], ['second']])
        self.assertEqual(self.output.read_bytes(), before)

    def test_changed_audio_text_hash_or_incomplete_timing_are_not_reused(self):
        lesson = self.lessons[0]
        original = alignment(lesson)
        self.assertTrue(pipeline.valid_alignment(lesson, original))
        changes = [
            lambda entry: entry.update(audioUrl='https://example.com/changed.mp3'),
            lambda entry: entry.update(transcriptHash='stale'),
            lambda entry: entry['segments'].pop(),
            lambda entry: entry['segments'][1].update(start=.5),
            lambda entry: entry['segments'][1].update(end=9),
            lambda entry: entry['segments'][1].update(end=float('nan')),
            lambda entry: entry['segments'][0].update(start=False),
            lambda entry: entry['segments'][0].update(paragraphIndex=True),
            lambda entry: entry['segments'][0].update(text='Invented sentence.'),
        ]
        for change in changes:
            entry = copy.deepcopy(original)
            change(entry)
            with self.subTest(entry=entry):
                self.assertFalse(pipeline.valid_alignment(lesson, entry))

    def test_one_failed_lesson_preserves_existing_and_successful_results_for_retry(self):
        fake_torch = types.SimpleNamespace(set_num_threads=lambda count: None)
        fake_whisper = types.SimpleNamespace(load_model=lambda *args, **kwargs: object())
        report = self.root / 'report.json'

        def align(model, lesson, *args):
            if lesson['slug'] == 'first':
                raise RuntimeError('temporary audio failure')
            return alignment(lesson)

        with mock.patch.dict(sys.modules, {'torch': fake_torch, 'stable_whisper': fake_whisper}), \
                mock.patch.object(pipeline, 'download_audio', return_value=self.root / 'audio.mp3'), \
                mock.patch.object(pipeline, 'duration', return_value=4), \
                mock.patch.object(pipeline, 'align_episode', side_effect=align):
            code, _, errors = self.invoke('--all-missing', '--cache-dir', str(self.root / 'cache'), '--report', str(report))
        self.assertEqual(code, 1)
        self.assertIn('temporary audio failure', errors)
        self.assertEqual(set(json.loads(self.output.read_text())['episodes']), {'old', 'second'})
        self.assertEqual(json.loads(report.read_text())['completed'], ['second'])
        _, output, _ = self.invoke('--plan')
        self.assertEqual(json.loads(output)['pending'], ['first'])

    def test_atomic_save_failure_preserves_previous_json(self):
        before = self.output.read_bytes()
        with mock.patch.object(pipeline.json, 'dump', side_effect=ValueError('invalid result')):
            with self.assertRaises(ValueError):
                pipeline.atomic_json(self.output, {'broken': True})
        self.assertEqual(self.output.read_bytes(), before)
        self.assertEqual(list(self.root.glob('alignment.json.*.tmp')), [])

    def test_zero_pending_work_does_not_load_a_model(self):
        pipeline.atomic_json(self.output, {'version': 1, 'episodes': {lesson['slug']: alignment(lesson) for lesson in self.lessons}})
        with mock.patch.dict(sys.modules, {'torch': None, 'stable_whisper': None}):
            code, text, _ = self.invoke('--all-missing')
        self.assertEqual(code, 0)
        self.assertIn('No pending', text)


if __name__ == '__main__':
    unittest.main()
