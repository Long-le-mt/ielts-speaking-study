"""Protect concurrent publication and stale-worker merges."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import merge_alignments


class MergeAlignmentsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = json.loads((ROOT / 'data/db.json').read_text())
        cls.current = json.loads((ROOT / 'public/alignment.json').read_text())
        cls.slug = 'shoes'

    def worker_file(self, directory, entry):
        path = Path(directory) / 'alignment.json'
        path.write_text(json.dumps({'version': 1, 'episodes': {self.slug: entry}}))
        return path

    def test_existing_valid_entry_wins_over_worker_snapshot(self):
        candidate = deepcopy(self.current['episodes'][self.slug])
        candidate['generatedAt'] = 'worker-snapshot'
        with tempfile.TemporaryDirectory() as directory:
            path = self.worker_file(directory, candidate)
            merged, report = merge_alignments.merge_alignments(self.database, self.current, [path])
        self.assertEqual(merged, self.current)
        self.assertEqual(report['added'], [])

    def test_valid_missing_entry_is_added_without_losing_other_entries(self):
        current = deepcopy(self.current)
        candidate = current['episodes'].pop(self.slug)
        with tempfile.TemporaryDirectory() as directory:
            path = self.worker_file(directory, candidate)
            merged, report = merge_alignments.merge_alignments(self.database, current, [path])
        self.assertEqual(merged, self.current)
        self.assertEqual(report['added'], [self.slug])

    def test_worker_audio_or_text_change_does_not_publish_stale_cues(self):
        for field in ('audioUrl', 'transcriptHash'):
            candidate = deepcopy(self.current['episodes'][self.slug])
            candidate[field] = 'changed-source'
            current = {'version': 1, 'episodes': {}}
            with tempfile.TemporaryDirectory() as directory:
                path = self.worker_file(directory, candidate)
                merged, report = merge_alignments.merge_alignments(self.database, current, [path])
            self.assertEqual(merged, current)
            self.assertEqual(len(report['skipped']), 1)


if __name__ == '__main__':
    unittest.main()
