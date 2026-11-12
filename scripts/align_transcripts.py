#!/usr/bin/env python3
"""Create sentence cues by forced-aligning the existing text with its audio.

Install stable-ts in a separate environment. Audio and model downloads stay in
--cache-dir and are never included in the published JSON.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit

DEFAULT_SLUGS = ['shoes', 'being-happy', 'outer-space-and-stars', 'growing-vegetables', 'rain']


def sentence_rows(transcript):
    rows = []
    for paragraph_index, paragraph in enumerate(transcript):
        if re.match(r'^speaker\s*:', paragraph.strip(), re.I):
            continue
        # Keep original punctuation and wording. Whitespace is only the boundary.
        for sentence in re.split(r'''(?<=[.!?])\s+(?=[A-Z“"‘])|(?<=[.!?][”"’'])\s+(?=[A-Z“"‘])''', paragraph.strip()):
            if sentence:
                rows.append({'text': sentence, 'paragraphIndex': paragraph_index})
    return rows


def duration(path):
    return float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path)], text=True, timeout=60).strip())



def repair_suspicious_sentences(model, audio_path, segments):
    """Re-align unusually fast/slow spans with a small surrounding audio window."""
    import numpy as np
    repaired = []
    for index, segment in enumerate(segments):
        word_count = len(segment['text'].split())
        length = segment['end'] - segment['start']
        if 0 < length and word_count / length <= 6.5 and length <= max(12, word_count):
            continue
        lower = max(0, index - 2)
        upper = min(len(segments), index + 3)
        window_start = max(0, segments[lower]['start'] - 1)
        window_end = segments[upper - 1]['end'] + 1
        pcm = subprocess.check_output([
            'ffmpeg', '-v', 'error', '-ss', str(window_start), '-t', str(window_end-window_start),
            '-i', str(audio_path), '-f', 's16le', '-ac', '1', '-ar', '16000', '-'])
        waveform = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
        text = '\n'.join(item['text'].strip() for item in segments[lower:upper])
        result = model.align(waveform, text, language='en', original_split=True,
                             verbose=None, regroup=False, token_step=150)
        candidates = result.to_dict()['segments'] if result else []
        if len(candidates) != upper - lower:
            continue
        for candidate in candidates:
            candidate['start'] = round(float(candidate['start']) + window_start, 3)
            candidate['end'] = round(float(candidate['end']) + window_start, 3)
            for word in candidate.get('words', []):
                word['start'] = round(float(word['start']) + window_start, 3)
                word['end'] = round(float(word['end']) + window_start, 3)
        if any(item['end'] <= item['start'] for item in candidates):
            continue
        if any(a['end'] > b['start'] for a, b in zip(candidates, candidates[1:])):
            continue
        if lower > 0 and candidates[0]['start'] < segments[lower-1]['end']:
            continue
        if upper < len(segments) and candidates[-1]['end'] > segments[upper]['start']:
            continue
        if any(''.join(a['text'].split()) != ''.join(b['text'].split())
               for a, b in zip(candidates, segments[lower:upper])):
            continue
        old = (segment['start'], segment['end'])
        segments[lower:upper] = candidates
        repaired.append(index)
        print(f"Local re-alignment sentence {index}: {old} -> "
              f"{(candidates[index-lower]['start'], candidates[index-lower]['end'])}", flush=True)
    return repaired



def refine_final_endpoint(model, audio_path, segments):
    """Confirm long final-word spans using an independently transcribed audio tail."""
    import numpy as np
    last = segments[-1]
    words = last.get('words', [])
    if not words or words[-1]['end'] - words[-1]['start'] <= 3:
        return False
    offset = max(0, last['start'] - 5)
    pcm = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-ss', str(offset), '-i', str(audio_path),
        '-f', 's16le', '-ac', '1', '-ar', '16000', '-'])
    waveform = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    result = model.transcribe(waveform, language='en', fp16=False, temperature=0,
                              verbose=None, word_timestamps=True, regroup=False)
    heard = [word for segment in result.to_dict()['segments'] for word in segment.get('words', [])]
    normalize = lambda value: re.sub(r'[^a-z0-9]', '', value.casefold())
    expected = [normalize(word['word']) for word in words[-4:]]
    for index in range(len(heard)-len(expected)+1):
        matched = heard[index:index+len(expected)]
        if [normalize(word['word']) for word in matched] != expected:
            continue
        endpoint = round(float(matched[-1]['end']) + offset, 3)
        if not last['start'] < endpoint < last['end']:
            continue
        for original, spoken in zip(words[-len(expected):], matched):
            original['start'] = round(float(spoken['start']) + offset, 3)
            original['end'] = round(float(spoken['end']) + offset, 3)
        print(f"Final speech endpoint confirmed by ASR: {last['end']} -> {endpoint}", flush=True)
        last['end'] = endpoint
        return True
    return False


def transcript_hash(transcript):
    return hashlib.sha256(json.dumps(transcript, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def eligible_episode(episode):
    """Return why a lesson cannot be aligned, or None when it is supported."""
    slug = episode.get('slug')
    if not isinstance(slug, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', slug):
        return 'invalid lesson slug'
    audio = episode.get('audio')
    url = audio.get('url') if isinstance(audio, dict) else None
    if not isinstance(url, str):
        return 'no direct audio'
    try:
        parts = urlsplit(url)
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
            return 'no direct HTTPS audio'
    except ValueError:
        return 'invalid audio URL'
    transcript = episode.get('transcript')
    if episode.get('transcriptStatus') != 'available' or not isinstance(transcript, list) or not transcript:
        return 'transcript unavailable'
    if any(not isinstance(paragraph, str) or not paragraph.strip() for paragraph in transcript):
        return 'invalid transcript'
    if not sentence_rows(transcript):
        return 'no spoken sentences'
    return None


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def valid_alignment(episode, entry):
    """Validate full sentence coverage and audio identity before reuse or publication."""
    if eligible_episode(episode) or not isinstance(entry, dict):
        return False
    if entry.get('audioUrl') != episode['audio']['url'] or entry.get('transcriptHash') != transcript_hash(episode['transcript']):
        return False
    total = entry.get('duration')
    segments = entry.get('segments')
    rows = sentence_rows(episode['transcript'])
    if not finite_number(total) or total <= 0 or not isinstance(segments, list) or len(segments) != len(rows):
        return False
    previous_end = 0
    for row, segment in zip(rows, segments):
        if not isinstance(segment, dict):
            return False
        start, end = segment.get('start'), segment.get('end')
        if not finite_number(start) or not finite_number(end) or start < 0 or end <= start or end > total + .02 or start < previous_end - .001:
            return False
        if type(segment.get('paragraphIndex')) is not int or segment['paragraphIndex'] != row['paragraphIndex']:
            return False
        text = segment.get('text')
        if not isinstance(text, str) or ' '.join(text.split()) != ' '.join(row['text'].split()):
            return False
        words = len(text.split())
        if words >= 4 and words > 10 * (end - start):
            return False
        previous_end = end
    return True


def load_alignment(path):
    if not path.exists():
        return {'version': 1, 'episodes': {}}
    output = json.loads(path.read_text())
    if not isinstance(output, dict) or output.get('version') != 1 or not isinstance(output.get('episodes'), dict):
        raise ValueError(f'Unsupported alignment format in {path}')
    return output


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
            json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def deadline(seconds):
    """Bound both model compute and downloads on the Linux/macOS workers."""
    def expired(signum, frame):
        raise TimeoutError(f'Operation exceeded {seconds} seconds')
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def download_audio(episode, cache_dir):
    url = episode['audio']['url']
    digest = hashlib.sha256(url.encode()).hexdigest()[:12]
    path = cache_dir / (episode['slug'] + '-' + digest + '.mp3')
    if path.exists():
        try:
            if duration(path) > 0:
                return path
        except (ValueError, subprocess.SubprocessError):
            pass
    print(f"Downloading {episode['slug']}", flush=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.part', dir=cache_dir)
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'IELTS-study-alignment/1.0'})
        with os.fdopen(descriptor, 'wb') as file, urllib.request.urlopen(request, timeout=90) as response:
            if urlsplit(response.url).scheme != 'https':
                raise ValueError('Audio redirected to an unsupported protocol')
            while chunk := response.read(1024 * 1024):
                file.write(chunk)
        if not math.isfinite(duration(temporary)) or duration(temporary) <= 0:
            raise ValueError('Audio duration is invalid')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return path


def align_episode(model, episode, audio_path, cache_dir, model_name):
    slug = episode['slug']
    rows = sentence_rows(episode['transcript'])
    digest = transcript_hash(episode['transcript'])
    audio_digest = hashlib.sha256(episode['audio']['url'].encode()).hexdigest()[:12]
    raw_path = cache_dir / (slug + '-' + model_name + '-150-' + digest[:12] + '-' + audio_digest + '-raw.json')
    if raw_path.exists():
        raw = json.loads(raw_path.read_text())
    else:
        print(f"Aligning {slug}: {len(rows)} sentences", flush=True)
        result = model.align(str(audio_path), '\n'.join(row['text'] for row in rows),
                             language='en', original_split=True, verbose=False, regroup=False,
                             suppress_silence=True, token_step=150, fast_mode=False)
        if result is None:
            raise RuntimeError(f'Alignment failed for {slug}')
        raw = result.to_dict()
        atomic_json(raw_path, raw)
    segments = raw['segments']
    if len(segments) != len(rows):
        raise RuntimeError(f'{slug}: expected {len(rows)} sentences, got {len(segments)}')
    repaired = repair_suspicious_sentences(model, audio_path, segments)
    tail_refined = refine_final_endpoint(model, audio_path, segments)
    atomic_json(cache_dir / (slug + '-' + model_name + '-reviewed-raw.json'), raw)
    cues = []
    invalid_words = 0
    for row, segment in zip(rows, segments):
        if ' '.join(row['text'].split()) != ' '.join(segment['text'].split()):
            raise RuntimeError(f"Text mismatch for {slug}: {row['text']!r} vs {segment['text']!r}")
        invalid_words += sum(word['end'] <= word['start'] for word in segment.get('words', []))
        cues.append({**row, 'start': round(segment['start'], 3), 'end': round(segment['end'], 3)})
    entry = {
        'audioUrl': episode['audio']['url'],
        'method': 'stable-ts Whisper ' + model_name + ' forced alignment, token step 150 with local re-alignment',
        'locallyRealignedSentences': repaired,
        'finalEndpointConfirmedByASR': tail_refined,
        'transcriptHash': digest,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'duration': round(duration(audio_path), 3),
        'segments': cues,
    }
    if not valid_alignment(episode, entry):
        raise RuntimeError(f'{slug}: alignment failed coverage, timing or identity validation')
    print(f"Validated {slug}: {len(cues)} cues, {cues[0]['start']}–{cues[-1]['end']}s; zero duration words={invalid_words}", flush=True)
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path)
    parser.add_argument('--model', default='base.en')
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--slugs', nargs='+')
    selection.add_argument('--all-missing', action='store_true')
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--shard-index', type=int)
    parser.add_argument('--shard-count', type=int, default=1)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--timeout', type=int, default=1800)
    parser.add_argument('--download-only', action='store_true')
    args = parser.parse_args()
    if args.threads < 1 or args.timeout < 1 or args.shard_count < 1:
        parser.error('threads, timeout and shard-count must be positive')
    if args.shard_index is not None and not 0 <= args.shard_index < args.shard_count:
        parser.error('shard-index must be between zero and shard-count minus one')
    if not re.fullmatch(r'[a-zA-Z0-9_.-]+', args.model):
        parser.error('model must be a model name, not a path')
    database = json.loads(args.database.read_text())
    if not isinstance(database, dict) or database.get('version') != 1 or not isinstance(database.get('episodes'), list):
        parser.error('Unsupported catalog format')
    episodes = database['episodes']
    if any(not isinstance(episode, dict) for episode in episodes):
        parser.error('Catalog entries must be objects')
    by_slug = {episode.get('slug'): episode for episode in episodes}
    if len(by_slug) != len(episodes):
        parser.error('Duplicate lesson slugs')
    output = load_alignment(args.output)
    eligible = [episode for episode in episodes if eligible_episode(episode) is None]
    valid = {episode['slug'] for episode in eligible if valid_alignment(episode, output['episodes'].get(episode['slug']))}
    pending = sorted(episode['slug'] for episode in eligible if episode['slug'] not in valid)
    slugs = args.slugs if args.slugs is not None else (pending if args.all_missing or args.plan else DEFAULT_SLUGS)
    for slug in slugs:
        if slug not in by_slug:
            parser.error(f'Unknown lesson: {slug}')
        reason = eligible_episode(by_slug[slug])
        if reason:
            parser.error(f'{slug}: {reason}')
    # Canonical ordering keeps shards stable across independent workers.
    selected_slugs = sorted(set(slugs))
    shards = [selected_slugs[index::args.shard_count] for index in range(args.shard_count)]
    if args.shard_index is not None:
        selected_slugs = shards[args.shard_index]
    plan = {
        'eligibleCount': len(eligible), 'validCount': len(valid),
        'pendingCount': len(pending), 'pending': pending, 'count': len(pending),
        'selectedCount': len(selected_slugs), 'selectedSlugs': selected_slugs, 'shards': shards,
        'unsupported': [{'slug': episode.get('slug'), 'reason': eligible_episode(episode)}
                        for episode in episodes if eligible_episode(episode)],
    }
    if args.plan:
        print(json.dumps(plan, ensure_ascii=False))
        return 0
    report = {**plan, 'completed': [], 'failed': []}
    if not selected_slugs:
        if args.report:
            atomic_json(args.report, report)
        print('No pending supported lessons', flush=True)
        return 0
    if args.cache_dir is None:
        parser.error('--cache-dir is required when work is selected')
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    socket.setdefaulttimeout(90)
    model = None
    for slug in selected_slugs:
        started = time.monotonic()
        try:
            with deadline(args.timeout):
                episode = by_slug[slug]
                audio_path = download_audio(episode, args.cache_dir)
                print(f'Audio {slug}: {duration(audio_path):.2f}s', flush=True)
                if not args.download_only:
                    if model is None:
                        import torch
                        import stable_whisper
                        torch.set_num_threads(args.threads)
                        model = stable_whisper.load_model(args.model, device='cpu', download_root=str(args.cache_dir / 'models'))
                    entry = align_episode(model, episode, audio_path, args.cache_dir, args.model)
                    output['episodes'][slug] = entry
                    atomic_json(args.output, output)
                report['completed'].append(slug)
                print(f'Done {slug}; elapsed={time.monotonic()-started:.1f}s', flush=True)
        except Exception as error:
            report['failed'].append({'slug': slug, 'error': str(error)})
            print(f'Failed {slug}: {error}', file=sys.stderr, flush=True)
        if args.report:
            atomic_json(args.report, report)
    return 1 if report['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
