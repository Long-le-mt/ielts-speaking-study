import type { DialogueParagraph, Episode, SentenceCue } from "../../lib/library";

interface TimedSentence {
  index: number;
  cue: SentenceCue;
}

interface Paragraph {
  index: number;
  text: string;
  sentences: TimedSentence[];
}

export interface SpeakerTurn {
  id: number;
  speaker: string;
  role: DialogueParagraph["role"] | "speaker";
  paragraphs: Paragraph[];
}

export interface TranscriptSection {
  id: number;
  label: string;
  turns: SpeakerTurn[];
  firstSentence?: number;
}

export function groupTranscript(episode: Episode, cues: readonly SentenceCue[]) {
  const sentencesByParagraph = new Map<number, TimedSentence[]>();
  const bySentence: { section: TranscriptSection; turn: SpeakerTurn }[] = [];
  const sections: TranscriptSection[] = [];
  let section: TranscriptSection | undefined;
  let turn: SpeakerTurn | undefined;
  let speaker = "";

  cues.forEach((cue, index) => {
    const sentence = { index, cue };
    const sentences = sentencesByParagraph.get(cue.paragraphIndex);
    if (sentences) sentences.push(sentence);
    else sentencesByParagraph.set(cue.paragraphIndex, [sentence]);
  });

  episode.transcript.forEach((text, index) => {
    const explicitSpeaker = /^speaker\s*:\s*(\S[^\n]{0,100})$/i.exec(text.trim());
    if (!episode.dialogue && explicitSpeaker) {
      speaker = explicitSpeaker[1];
      turn = undefined;
      return;
    }
    const metadata = episode.dialogue?.[index] ?? {
      speaker,
      section: speaker || "Transcript",
      role: "speaker" as const,
    };
    if (!section || section.label !== metadata.section) {
      section = { id: index, label: metadata.section, turns: [] };
      sections.push(section);
      turn = undefined;
    }
    if (!turn || turn.speaker !== metadata.speaker || turn.role !== metadata.role) {
      turn = { id: index, speaker: metadata.speaker, role: metadata.role, paragraphs: [] };
      section.turns.push(turn);
    }
    const sentences = sentencesByParagraph.get(index) ?? [];
    turn.paragraphs.push({ index, text, sentences });
    if (sentences.length) section.firstSentence ??= sentences[0].index;
    for (const sentence of sentences) bySentence[sentence.index] = { section, turn };
  });

  return { sections, bySentence };
}
