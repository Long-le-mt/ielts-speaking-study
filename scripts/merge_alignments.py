#!/usr/bin/env python3
"""Merge worker results against the current catalog without replacing valid cues."""
import argparse
import json
from pathlib import Path

from align_transcripts import atomic_json, load_alignment, valid_alignment


def merge_alignments(database, current, inputs):
    episodes = {episode['slug']: episode for episode in database['episodes']}
    merged = {'version': 1, 'episodes': dict(current['episodes'])}
    added = []
    skipped = []
    for path in sorted(inputs):
        candidates = load_alignment(path)['episodes']
        for slug, entry in candidates.items():
            episode = episodes.get(slug)
            if episode is None or not valid_alignment(episode, entry):
                skipped.append({'slug': slug, 'file': str(path), 'reason': 'source changed or cues invalid'})
                continue
            if valid_alignment(episode, merged['episodes'].get(slug)):
                continue
            merged['episodes'][slug] = entry
            added.append(slug)
    return merged, {'added': added, 'skipped': skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    args = parser.parse_args()
    database = json.loads(args.database.read_text())
    if database.get('version') != 1 or not isinstance(database.get('episodes'), list):
        parser.error('Unsupported catalog format')
    inputs = list(args.inputs.rglob('alignment.json')) if args.inputs.exists() else []
    merged, report = merge_alignments(database, load_alignment(args.output), inputs)
    if report['added']:
        atomic_json(args.output, merged)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
