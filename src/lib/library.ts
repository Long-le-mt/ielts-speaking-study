import { assetUrl } from "./release";

export interface SentenceCue {
  start: number;
  end: number;
  text: string;
  paragraphIndex: number;
}

export interface DialogueParagraph {
  index: number;
  speaker: string;
  role: "host" | "candidate" | "interviewer";
  section: string;
}

interface EpisodeSource {
  website?: string;
  url?: string;
  videoUrl?: string;
  membershipUrl?: string;
  author?: string;
  copyright?: string;
}

export interface Episode {
  slug: string;
  title: string;
  category: string;
  publisher: string;
  source?: EpisodeSource;
  publishedAt?: string;
  date: Date | null;
  year: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  searchKey: string;
  transcript: string[];
  transcriptStatus?: string;
  hasTranscript: boolean;
  alignment: { segments: SentenceCue[] } | null;
  hasAlignment: boolean;
  detailAsset?: string;
  dialogue: DialogueParagraph[] | null;
}

export interface LibraryFilters {
  q?: string;
  part?: string;
  source?: string;
  availability?: "audio" | "video" | "transcript" | "missing" | "synced";
  year?: string;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function searchKey(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizedText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function validateAlignment(value: unknown, audioUrl: string | null, transcript: string[]): Episode["alignment"] {
  const alignment = object(value);
  if (!alignment || !audioUrl || safeLink(alignment.audioUrl) !== audioUrl || !Array.isArray(alignment.segments)) return null;
  const groups = new Map<number, SentenceCue[]>();
  const cues: SentenceCue[] = [];
  let previousEnd = 0;
  for (const raw of alignment.segments) {
    const cue = object(raw);
    if (!cue) return null;
    const { start, end, paragraphIndex, text } = cue;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) ||
        !Number.isFinite(end) || start < 0 || start < previousEnd - .02 || end <= start ||
        typeof paragraphIndex !== "number" || !Number.isInteger(paragraphIndex) ||
        !transcript[paragraphIndex] || typeof text !== "string" || !text.trim()) return null;
    const segment = { start, end, paragraphIndex, text };
    const group = groups.get(paragraphIndex) ?? [];
    group.push(segment);
    groups.set(paragraphIndex, group);
    cues.push(segment);
    previousEnd = end;
  }
  const valid = new Set<number>();
  for (const [index, group] of groups) {
    if (normalizedText(group.map(cue => cue.text).join(" ")) === normalizedText(transcript[index])) valid.add(index);
  }
  const segments = cues.filter(cue => valid.has(cue.paragraphIndex));
  return segments.length ? { segments } : null;
}

function validateDialogue(value: unknown, transcript: string[]): Episode["dialogue"] {
  const dialogue = object(value);
  if (!dialogue || !Array.isArray(dialogue.transcript) ||
      JSON.stringify(dialogue.transcript) !== JSON.stringify(transcript) ||
      !Array.isArray(dialogue.paragraphs) || dialogue.paragraphs.length !== transcript.length) return null;
  const paragraphs: DialogueParagraph[] = [];
  for (const [index, raw] of dialogue.paragraphs.entries()) {
    const row = object(raw);
    if (!row || row.index !== index) return null;
    const { speaker, section, role } = row;
    if (typeof speaker !== "string" || typeof section !== "string" ||
        (role !== "host" && role !== "candidate" && role !== "interviewer")) return null;
    paragraphs.push({ index, speaker, section, role });
  }
  return paragraphs;
}

export function normalizeEpisode(value: unknown, alignments?: JsonObject, dialogues?: JsonObject): Episode | null {
  const raw = object(value);
  const slug = string(raw?.slug);
  const title = string(raw?.title);
  if (!raw || !slug || !title) return null;
  const sourceData = object(raw.source);
  const source = sourceData && {
    website: string(sourceData.website),
    url: safeLink(sourceData.url) ?? undefined,
    videoUrl: safeLink(sourceData.videoUrl) ?? undefined,
    membershipUrl: safeLink(sourceData.membershipUrl) ?? undefined,
    author: string(sourceData.author),
    copyright: string(sourceData.copyright),
  };
  const audioUrl = safeLink(object(raw.audio)?.url);
  const category = string(raw.category)?.trim() ?? "Uncategorized";
  const publisher = source?.website?.trim() || (source?.url ? new URL(source.url).hostname : "Source not listed");
  const publishedAt = string(raw.publishedAt);
  const parsed = publishedAt && /\b\d{4}\b/.test(publishedAt) ? new Date(publishedAt) : null;
  const date = parsed && Number.isFinite(parsed.valueOf()) ? parsed : null;
  const transcript = Array.isArray(raw.transcript)
    ? raw.transcript.filter((paragraph): paragraph is string => typeof paragraph === "string" && !!paragraph.trim())
    : [];
  const alignment = validateAlignment(alignments?.[slug], audioUrl, transcript);
  return {
    slug, title, category, publisher, source, publishedAt, date,
    year: date && String(date.getUTCFullYear()),
    audioUrl, videoUrl: source?.videoUrl ?? null, transcript,
    transcriptStatus: string(raw.transcriptStatus),
    hasTranscript: raw.transcriptStatus === "available" && transcript.length > 0,
    searchKey: searchKey(`${title} ${category} ${publisher}`),
    alignment, hasAlignment: !!alignment,
    dialogue: validateDialogue(dialogues?.[slug], transcript),
  };
}

async function fetchJson(name: string): Promise<unknown> {
  const response = await fetch(assetUrl(name), { cache: import.meta.env.DEV ? "no-store" : "default", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Could not load ${name}`);
  return response.json();
}

let libraryRequest: Promise<Episode[]> | undefined;
const lessonRequests = new Map<string, Promise<Episode>>();
const loadedLessons = new Map<string, Episode>();

export function loadLibrary(): Promise<Episode[]> {
  libraryRequest ??= fetchJson("catalog.json").then(raw => {
    const catalog = object(raw);
    if (catalog?.version !== 1 || !Array.isArray(catalog.episodes)) throw new Error("Unsupported library format");
    return catalog.episodes.map((value): Episode | null => {
      const metadata = object(value);
      const episode = normalizeEpisode(value);
      if (!episode || typeof metadata?.detailAsset !== "string" ||
          !/^lessons\/[a-f0-9]{20}\.json$/.test(metadata.detailAsset)) return null;
      return {
        ...episode,
        detailAsset: metadata.detailAsset,
        hasTranscript: metadata.hasTranscript === true,
        hasAlignment: metadata.hasAlignment === true,
      };
    })
      .filter((episode): episode is Episode => episode !== null)
      .sort((a, b) => (b.date?.valueOf() ?? 0) - (a.date?.valueOf() ?? 0));
  }).catch(error => {
    libraryRequest = undefined;
    throw error;
  });
  return libraryRequest;
}

export function getLoadedLesson(episode: Episode): Episode | undefined {
  return episode.detailAsset ? loadedLessons.get(episode.detailAsset) : episode;
}

export function loadLesson(episode: Episode): Promise<Episode> {
  const asset = episode.detailAsset;
  if (!asset) return Promise.resolve(episode);
  let request = lessonRequests.get(asset);
  if (!request) {
    request = fetchJson(asset).then(raw => {
      const detail = object(raw);
      const value = normalizeEpisode(detail?.episode,
        { [episode.slug]: detail?.alignment }, { [episode.slug]: detail?.dialogue });
      if (detail?.version !== 1 || !value || value.slug !== episode.slug) {
        throw new Error("Unsupported lesson format");
      }
      loadedLessons.set(asset, value);
      return value;
    }).catch(error => {
      lessonRequests.delete(asset);
      throw error;
    });
    lessonRequests.set(asset, request);
  }
  return request;
}

const materialFilters = {
  audio: (episode: Episode) => !!episode.audioUrl,
  video: (episode: Episode) => !!episode.videoUrl,
  transcript: (episode: Episode) => episode.hasTranscript,
  missing: (episode: Episode) => !episode.hasTranscript,
  synced: (episode: Episode) => episode.hasAlignment,
};

let previousFilter: {
  episodes: Episode[];
  query: string;
  part: LibraryFilters["part"];
  source: LibraryFilters["source"];
  year: LibraryFilters["year"];
  availability: LibraryFilters["availability"];
  result: Episode[];
} | undefined;

export function filterLibrary(episodes: Episode[], filters: LibraryFilters): Episode[] {
  const query = searchKey(filters.q ?? "");
  const { part, source, year, availability } = filters;
  if (previousFilter?.episodes === episodes && previousFilter.query === query &&
      previousFilter.part === part && previousFilter.source === source &&
      previousFilter.year === year && previousFilter.availability === availability) {
    return previousFilter.result;
  }

  const terms = query.split(" ").filter(Boolean);
  const matchesMaterial = availability ? materialFilters[availability] : undefined;
  const result = episodes.filter(episode =>
    (!part || part === episode.category) &&
    (!source || source === episode.publisher) &&
    (!year || year === episode.year) &&
    (!availability || !!matchesMaterial?.(episode)) &&
    terms.every(term => episode.searchKey.includes(term)),
  );
  // Filter changes select a matching slug before navigation. Reuse that same
  // result when the route renders, retaining only the most recent request.
  previousFilter = { episodes, query, part, source, year, availability, result };
  return result;
}
