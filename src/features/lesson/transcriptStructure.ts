import type { DialogueParagraph, Episode } from "../../lib/library";

export interface TranscriptRole {
  speaker: string;
  role: DialogueParagraph["role"] | "speaker";
  section: string;
}

const participant = /\b(Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)\b/ig;
const reviewNames = [
  /(?:^|[.!?,—–-]\s*)(?:and |so )?that was (Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)\b/i,
  /\b(?:answer|response|description|story|performance) from (Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)\b/i,
  /\b(?:heard (?:from )?|thanks to |dive into |review |revisit |go over |tie together how )(Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)\b/i,
  /\b(Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)[’']s (?:answer|response|description|story|performance)s?\b/i,
  /\b(Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle) (?:shared|talked about|gave us|described|responded|answer(?:ed)?(?:ing)?)\b/i,
];
const marker = /^speaker\s*:\s*(\S[^\n]{0,100})$/i;
const opening = /\b(?:welcome (?:back )?to (?:the )?(?:ielts|speaking|another episode|the show)|i[’']m (?:your host|archer)\b|hello[,]? (?:everyone|listeners|dear listeners))\b/i;
const closing = /^(?:(?:okay|alright|so|and)[, —]+)*(?:that(?:[’']s| wraps) (?:all(?: the time)?|it|up|our time) (?:for |we have|today|this|our)|thanks? for (?:listening|tuning in)|until next time|we[’']ll see you next time)/i;
const feedback = /^(?:(?:okay|alright|wow|so|and|now|everyone|listeners|hello)[,! .—–-]+){0,6}(?:welcome back\b|thanks? (?:to |for (?:listening|joining)(?: to)? (?:that|the|our)\b)|that was (?:Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle|(?:such )?an?\s+[^.!?]{0,40}\b(?:answer|response|description|story|performance)\b)|what a story from\b|you (?:just heard|[’']ve (?:just )?heard)\b|we (?:just (?:heard|listened)|[’']ve (?:just )?heard)\b)|\b(?:now that we[’']ve heard|let[’']s (?:break down|revisit|go over|review|dissect|unpack|quickly tie together)|(?:answer|response|description|story|performance) (?:was|is) (?:a great|an? (?:excellent|really solid)|straightforward|a good|very|truly|also excellent))/i;
const handoff = /\b(?:let[’']s (?:hear|listen|start|begin|switch|move (?:on )?to|take a listen|dive in and hear)|(?:we[’']ll|we[’']re going to|you[’']ll) (?:start|hear|listen)|here[’']s (?:his|her|an? (?:sample|model|example)|(?:Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)\b)|hear what|(?:model|sample|example) (?:answer|response) (?:from|by)|first(?: one)? (?:comes |is )?from|full response from|next up,? we have|now.{0,100}here[’']s)\b/ig;
const hostIdentity = /\b(?:i[’']m (?:your host,? )?|my name is |i[’']m your )(Archer)\b/i;
const questionOpening = /^(?:Q(?:uestion)?\s*\d*\s*[:.)-]\s*)?[“‘"']?(?:(?:what|which|where|when|why|who|whose|how)\b|(?:do|did|does|are|is|was|were|will|would|have|has|had|can|could|should|may|might)\b|(?:in your opinion|on what|at what|when [^,]+,|compared (?:to|with))\b)/i;

export function explicitSpeaker(text: string) {
  return marker.exec(text.trim())?.[1];
}

function names(text: string) {
  return [...new Set([...text.matchAll(participant)].map(([name]) => name[0].toUpperCase() + name.slice(1).toLowerCase()))];
}

function isQuestion(text: string) {
  const trimmed = text.trim().replace(/^\d+\s*[.)]\s*/, "");
  if (trimmed.length > 170 || !/\?[”’"']?$/.test(trimmed) || !questionOpening.test(trimmed)) return false;
  // A single prompt can contain a short follow-up, such as "Why or why not?"
  return !/[.!]\s+\p{L}/u.test(trimmed) && trimmed.split("?").length <= 3;
}

function isNarrative(text: string) {
  return text.length >= 48 && /\b(?:i[’']\w+|i\s|my|we[’']\w+|we\s|our)\b/i.test(text);
}

function isFeedback(text: string) {
  const lead = text.trim().replace(/^[“‘"']/, "");
  if (feedback.test(lead)) return true;
  if (!names(lead.slice(0, 170)).length) return false;
  return /^(?:(?:okay|alright|wow|so|and|now)[,! .—–-]+){0,5}(?:that was (?:great|wonderful|fantastic)|what an? [^.!?]{0,30}\b(?:answer|story|response)|another [^.!?]{0,30}\b(?:answer|story|response) from|some [^.!?]{0,30}\b(?:answers|responses) from|that[’']s [^.!?]{0,42}\bperspective from)/i.test(lead) ||
    /^(?:Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)(?:[’']s\s+(?:answer|response|description|story|performance)s?\b|\s+(?:shared|talked about|gave us|described)\b)/i.test(lead) ||
    /^.{0,100}?[?!]\s+(?:Joseph|Blondie|Ivanna|Finn|Ben|Lucius|Isabelle)[’']s (?:answer|response)s?\b/i.test(lead);
}

function handoffMatch(text: string) {
  return [...text.matchAll(handoff)].reverse().find(match => names(text.slice(match.index)).length);
}

function lastHandoff(paragraphs: string[], start: number, end: number) {
  for (let index = end - 1; index >= start; index--) {
    const text = paragraphs[index];
    const signal = handoffMatch(text);
    if (!signal && !/here[’']s (?:his|her) response/i.test(text)) continue;
    const people = names(signal ? text.slice(signal.index) : text);
    return { index, name: people.length === 1 ? people[0] : "" };
  }
}

function answerName(paragraphs: string[], start: number, end: number) {
  for (const text of paragraphs.slice(start, end)) {
    const signal = handoffMatch(text);
    const recap = signal && signal.index > 0 ? text.slice(0, signal.index) : text;
    for (const pattern of reviewNames) {
      const matches = [...recap.matchAll(new RegExp(pattern.source, "ig"))];
      const people = new Set(matches.map(match => match[1].toLowerCase()));
      if (people.size > 1) return "";
      const name = matches[0]?.[1];
      if (name) return name[0].toUpperCase() + name.slice(1).toLowerCase();
    }
  }
  return "";
}

export function inferTranscriptStructure(episode: Episode): (TranscriptRole | undefined)[] {
  const paragraphs = episode.transcript;
  const result: (TranscriptRole | undefined)[] = Array(paragraphs.length);
  const partOne = episode.category === "Speaking Part 1";
  const isPodcast = paragraphs.slice(0, 3).some(text => opening.test(text));
  const host = paragraphs.slice(0, 4).map(text => hostIdentity.exec(text)?.[1]).find(Boolean) || "Host";

  const apply = (start: number, end: number, speaker: string, role: TranscriptRole["role"], section: string) => {
    for (let index = start; index < end; index++) result[index] = { speaker, role, section };
  };

  const markers = paragraphs.flatMap((text, index) => {
    const speaker = explicitSpeaker(text);
    return speaker ? [{ index, speaker }] : [];
  });

  if (markers.length) {
    if (isPodcast) apply(0, markers[0].index, host, "host", "Introduction");
    for (const [position, { index, speaker }] of markers.entries()) {
      const end = markers[position + 1]?.index ?? paragraphs.length;
      const section = partOne ? `${speaker} interview` : `${speaker} sample answer`;
      const feedbackStart = isPodcast ? paragraphs.findIndex((text, row) =>
        row >= index + 2 && row < end && (isFeedback(text) || closing.test(text))) : -1;
      const answerEnd = feedbackStart < 0 ? end : feedbackStart;
      apply(index + 1, answerEnd, speaker, "candidate", section);
      if (feedbackStart >= 0) apply(feedbackStart, end, host, "host", `${speaker} feedback`);
      if (partOne) {
        for (let row = index + 1; row < answerEnd; row++) {
          if (isQuestion(paragraphs[row])) result[row] = { speaker: "Interviewer", role: "interviewer", section };
        }
      }
    }
  } else if (partOne) {
    // Interview prompts recur within a few paragraphs, with a spoken answer in between.
    // Requiring this pattern avoids tagging isolated rhetorical questions as a new person.
    const questions = paragraphs.flatMap((text, index) =>
      isQuestion(text) && !/^question\s+\d+\s*:/i.test(text) &&
      index + 1 < paragraphs.length && !isQuestion(paragraphs[index + 1]) ? [index] : []);
    const clusters: number[][] = [];
    for (const index of questions) {
      const previous = clusters.at(-1);
      const preceding = previous?.at(-1);
      if (previous && preceding !== undefined && index - preceding <= 8 &&
          !paragraphs.slice(preceding + 1, index).some(text => isFeedback(text) || (handoffMatch(text) && names(text).length > 0))) {
        previous.push(index);
      } else {
        clusters.push([index]);
      }
    }
    let cursor = 0;
    let previousName = "";
    const interviews = clusters.filter(cluster => cluster.length >= 2);
    for (const [position, cluster] of interviews.entries()) {
      const start = cluster[0];
      const last = cluster.at(-1)!;
      const next = interviews[position + 1]?.[0] ?? paragraphs.length;
      const reviewOffset = paragraphs.slice(last + 2, next).findIndex(text => isFeedback(text) || (handoffMatch(text) && names(text).length > 0) || closing.test(text));
      const end = reviewOffset < 0 ? last + 2 : last + 2 + reviewOffset;
      const announced = lastHandoff(paragraphs, cursor, start)?.name;
      const reviewed = reviewOffset >= 0 ? answerName(paragraphs, end, Math.min(end + 2, next)) : "";
      const name = announced || (reviewed !== previousName ? reviewed : "");
      const section = name ? `${name} interview` : interviews.length > 1 ? `Sample interview ${position + 1}` : "Sample interview";
      if (isPodcast) apply(cursor, start, host, "host", cursor === 0 ? "Introduction" : previousName ? `${previousName} feedback` : "Feedback");
      apply(start, end, name || "Candidate", "candidate", section);
      for (const index of cluster) result[index] = { speaker: "Interviewer", role: "interviewer", section };
      cursor = end;
      previousName = name;
    }
    if (isPodcast && interviews.length) apply(cursor, paragraphs.length, host, "host", previousName ? `${previousName} feedback` : "Feedback");
  } else if (episode.category === "Speaking Part 2" && isPodcast) {
    let cursor = 0;
    let previousName = "";
    for (let index = 2; index < paragraphs.length; index++) {
      const text = paragraphs[index];
      if (!isFeedback(text) || (index < 4 && !names(text).length)) continue;
      const announced = lastHandoff(paragraphs, cursor, index);
      const reviewed = answerName(paragraphs, index, Math.min(index + 2, paragraphs.length));
      // Unannounced answers can follow a cue card read in the opening paragraph.
      const startsAfterCue = cursor === 0 && /\byou should say\b/i.test(paragraphs[0] ?? "") &&
        isNarrative(paragraphs[1] ?? "") && !handoffMatch(paragraphs[1] ?? "");
      const start = announced ? announced.index + 1 : startsAfterCue ? 1 : index;
      if (start >= index || !paragraphs.slice(start, index).some(isNarrative)) continue;
      const name = announced?.name || reviewed;
      apply(cursor, start, host, "host", cursor === 0 ? "Introduction" : previousName ? `${previousName} feedback` : "Feedback");
      apply(start, index, name || "Candidate", "candidate", name ? `${name} sample answer` : "Sample answer");
      cursor = index;
      previousName = name;
    }
    if (cursor) apply(cursor, paragraphs.length, host, "host", previousName ? `${previousName} feedback` : "Feedback");
  }

  if (isPodcast) {
    const start = paragraphs.findIndex((text, index) => index >= Math.max(1, paragraphs.length - 5) && closing.test(text));
    if (start >= 0) apply(start, paragraphs.length, host, "host", "Closing");
    result[0] ??= { speaker: host, role: "host", section: "Introduction" };
  }
  return result;
}
