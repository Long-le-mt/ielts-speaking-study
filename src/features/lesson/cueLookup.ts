import type { SentenceCue } from "../../lib/library";

export function createCueLookup(cues: readonly SentenceCue[]) {
  const ordered = cues.every((cue, index) => index === 0 || cues[index - 1].end <= cue.start);

  return (time: number, currentIndex = -1): number => {
    // Older alignment files can contain small overlaps. Keep their first-match
    // behavior while using binary lookup for ordered, non-overlapping cues.
    if (!ordered) return cues.findIndex(cue => cue.start <= time && time < cue.end);
    const current = cues[currentIndex];
    if (current && current.start <= time && time < current.end) return currentIndex;

    let lower = 0;
    let upper = cues.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (cues[middle].end <= time) lower = middle + 1;
      else upper = middle;
    }
    return cues[lower]?.start <= time ? lower : -1;
  };
}
