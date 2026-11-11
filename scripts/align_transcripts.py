#!/usr/bin/env python3
"""Create sentence cues by forced-aligning the existing text with its audio.

Install stable-ts in a separate environment. Audio and model downloads stay in
--cache-dir and are never included in the published JSON.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request

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
        '-of', 'default=noprint_wrappers=1:nokey=1', str(path)], text=True).strip())



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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--cache-dir', type=Path, required=True)
    parser.add_argument('--model', default='base.en')
    parser.add_argument('--slugs', nargs='+', default=DEFAULT_SLUGS)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--download-only', action='store_true')
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    database = json.loads(args.database.read_text())
    by_slug = {item['slug']: item for item in database['episodes']}
    selected = [by_slug[slug] for slug in args.slugs]
    paths = {}
    for episode in selected:
        url = episode.get('audio', {}).get('url')
        if not url or not url.startswith('https://'):
            parser.error(f"{episode['slug']} has no direct HTTPS audio")
        url_digest = hashlib.sha256(url.encode()).hexdigest()[:12]
        path = args.cache_dir / (episode['slug'] + '-' + url_digest + '.mp3')
        if not path.exists():
            print(f"Downloading {episode['slug']}", flush=True)
            request = urllib.request.Request(url, headers={'User-Agent': 'IELTS-study-alignment/1.0'})
            with urllib.request.urlopen(request, timeout=90) as response:
                path.write_bytes(response.read())
        paths[episode['slug']] = path
        print(f"Audio {episode['slug']}: {duration(path):.2f}s", flush=True)
    if args.download_only:
        return

    import torch
    import stable_whisper
    torch.set_num_threads(args.threads)
    model = stable_whisper.load_model(args.model, device='cpu', download_root=str(args.cache_dir / 'models'))
    output = {'version': 1, 'episodes': {}}
    for episode in selected:
        slug = episode['slug']
        rows = sentence_rows(episode['transcript'])
        text = '\n'.join(row['text'] for row in rows)
        digest = hashlib.sha256(json.dumps(episode['transcript'], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        audio_digest = hashlib.sha256(episode['audio']['url'].encode()).hexdigest()[:12]
        raw_path = args.cache_dir / (slug + '-' + args.model + '-150-' + digest[:12] + '-' + audio_digest + '-raw.json')
        started = time.monotonic()
        if raw_path.exists():
            raw = json.loads(raw_path.read_text())
        else:
            print(f"Aligning {slug}: {len(rows)} sentences", flush=True)
            result = model.align(str(paths[slug]), text, language='en', original_split=True,
                                 verbose=False, regroup=False, suppress_silence=True,
                                 token_step=150, fast_mode=False)
            if result is None:
                raise RuntimeError(f'Alignment failed for {slug}')
            raw = result.to_dict()
            raw_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2))
        segments = raw['segments']
        repaired = repair_suspicious_sentences(model, paths[slug], segments)
        tail_refined = refine_final_endpoint(model, paths[slug], segments)
        (args.cache_dir / (slug + '-' + args.model + '-reviewed-raw.json')).write_text(json.dumps(raw, ensure_ascii=False, indent=2))
        if len(segments) != len(rows):
            raise RuntimeError(f'{slug}: expected {len(rows)} sentences, got {len(segments)}')
        cues = []
        invalid_words = 0
        for row, segment in zip(rows, segments):
            if re.sub(r'\s+', '', row['text']) != re.sub(r'\s+', '', segment['text']):
                raise RuntimeError(f"Text mismatch for {slug}: {row['text']!r} vs {segment['text']!r}")
            start, end = round(segment['start'], 3), round(segment['end'], 3)
            if end <= start:
                raise RuntimeError(f'Zero duration sentence in {slug}: {row}')
            if cues and start < cues[-1]['end'] - 0.001:
                raise RuntimeError(f'Overlapping sentences in {slug}')
            invalid_words += sum(word['end'] <= word['start'] for word in segment.get('words', []))
            cues.append({**row, 'start': start, 'end': end})
        output['episodes'][slug] = {
            'audioUrl': episode['audio']['url'],
            'method': 'stable-ts Whisper ' + args.model + ' forced alignment, token step 150 with local re-alignment',
            'locallyRealignedSentences': repaired,
            'finalEndpointConfirmedByASR': tail_refined,
            'transcriptHash': digest,
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'duration': round(duration(paths[slug]), 3),
            'segments': cues,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
        print(f"Done {slug}: {len(cues)} cues, {cues[0]['start']}–{cues[-1]['end']}s; "
              f"zero duration words={invalid_words}; elapsed={time.monotonic()-started:.1f}s", flush=True)


if __name__ == '__main__':
    main()
