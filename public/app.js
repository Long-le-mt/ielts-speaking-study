"use strict";

const search = document.querySelector("#search");
const part = document.querySelector("#part");
const publisher = document.querySelector("#publisher");
const availability = document.querySelector("#availability");
const year = document.querySelector("#year");
const clear = document.querySelector("#clear-filters");
const filters = [part, publisher, availability, year];
const count = document.querySelector("#topic-count");
const list = document.querySelector("#topic-list");
const lesson = document.querySelector("#lesson");
const shortDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

let episodes = [];
let activeEpisode = null;
let player = null;
let stopSentenceSync = null;
let alignments = {};

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function safeLink(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function externalLink(url, label, className) {
  const anchor = element("a", label, className);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function parseDate(value) {
  if (typeof value !== "string" || !/\b\d{4}\b/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function searchKey(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function publisherName(source) {
  if (typeof source?.website === "string" && source.website.trim()) return source.website.trim();
  const url = safeLink(source?.url);
  return url ? new URL(url).hostname : "Source not listed";
}

function withDisplayData(episode) {
  const date = parseDate(episode.publishedAt);
  const category = typeof episode.category === "string" && episode.category.trim()
    ? episode.category.trim() : "Uncategorized";
  const publisher = publisherName(episode.source);
  const transcript = Array.isArray(episode.transcript)
    ? episode.transcript.filter(paragraph => typeof paragraph === "string" && paragraph.trim())
    : [];
  return {
    ...episode,
    category,
    publisher,
    searchKey: searchKey(`${episode.title} ${category} ${publisher}`),
    date,
    year: date && String(date.getUTCFullYear()),
    audioUrl: safeLink(episode.audio?.url),
    videoUrl: safeLink(episode.source?.videoUrl),
    transcript,
    alignment: validAlignment(episode, transcript),
    hasTranscript: episode.transcriptStatus === "available" && transcript.length > 0,
  };
}

function validAlignment(episode, transcript) {
  const alignment = alignments[episode.slug];
  if (!alignment || alignment.audioUrl !== episode.audio?.url || !Array.isArray(alignment.segments)) return null;
  let previousEnd = 0;
  for (const segment of alignment.segments) {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
        segment.start < previousEnd - 0.02 || segment.end <= segment.start ||
        !Number.isInteger(segment.paragraphIndex) || !transcript[segment.paragraphIndex] ||
        typeof segment.text !== "string" || !segment.text.trim()) return null;
    previousEnd = segment.end;
  }
  const normalizedText = text => text.replace(/\s+/gu, " ").trim();
  const segments = alignment.segments.filter(segment => {
    const paragraphSegments = alignment.segments.filter(item => item.paragraphIndex === segment.paragraphIndex);
    return normalizedText(paragraphSegments.map(item => item.text).join(" ")) === normalizedText(transcript[segment.paragraphIndex]);
  });
  return segments.length ? { ...alignment, segments } : null;
}

function matchesAvailability(episode) {
  switch (availability.value) {
    case "synced": return Boolean(episode.alignment);
    case "audio": return Boolean(episode.audioUrl);
    case "video": return Boolean(episode.videoUrl);
    case "transcript": return episode.hasTranscript;
    case "missing": return !episode.hasTranscript;
    default: return true;
  }
}

function dateNode(date, formatter, className) {
  const time = element("time", formatter.format(date), className);
  time.dateTime = date.toISOString().slice(0, 10);
  return time;
}

function showTopics() {
  const terms = searchKey(search.value).split(" ").filter(Boolean);
  const visible = episodes.filter(episode => (
    terms.every(term => episode.searchKey.includes(term)) &&
    matchesAvailability(episode) &&
    (!part.value || part.value === episode.category) &&
    (!publisher.value || publisher.value === episode.publisher) &&
    (!year.value || year.value === episode.year)
  ));

  clear.hidden = !search.value && filters.every(filter => !filter.value);
  if (!visible.includes(activeEpisode)) showLesson(visible[0] ?? null);
  count.textContent = `${visible.length} of ${episodes.length} topics`;

  const items = visible.map(episode => {
    const row = element("li");
    const button = element("button", "", "topic");
    button.type = "button";
    button.setAttribute("aria-controls", "lesson");
    if (episode === activeEpisode) button.setAttribute("aria-current", "true");

    const details = element("span", "", "topic-meta");
    details.append(element("span", `${episode.category} · ${episode.publisher}`, "topic-source"));
    if (episode.date) details.append(dateNode(episode.date, shortDate));
    if (episode.audioUrl) details.append(element("span", "Audio", "pill pill-ready"));
    else if (episode.videoUrl) details.append(element("span", "Video", "pill"));
    if (episode.alignment) details.append(element("span", "Sentence sync", "pill pill-sync"));
    details.append(element("span", episode.hasTranscript ? "Transcript" : "No transcript", episode.hasTranscript ? "pill pill-ready" : "pill"));

    button.append(element("span", episode.title, "topic-title"), details);
    button.addEventListener("click", () => {
      list.querySelector('[aria-current="true"]')?.removeAttribute("aria-current");
      button.setAttribute("aria-current", "true");
      if (episode !== activeEpisode) showLesson(episode);
      lesson.focus();
    });
    row.append(button);
    return row;
  });

  list.replaceChildren(...items);
}

function audioSection(episode) {
  const section = element("section", "", "listen");
  section.append(element("h3", "Audio"));
  if (!episode.audioUrl) {
    const membership = safeLink(episode.source?.membershipUrl);
    if (episode.videoUrl) {
      section.append(externalLink(episode.videoUrl, "Watch the original video on YouTube", "audio-source"));
    } else if (membership) {
      section.append(externalLink(membership, "View the publisher’s YouTube membership", "audio-source"));
    } else {
      section.append(element("p", "No direct audio link is available for this topic.", "notice"));
    }
    return section;
  }

  const audio = element("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.setAttribute("aria-label", `Audio for ${episode.title}`);
  player = audio;

  const controls = element("div", "", "audio-controls");
  controls.append(audio);
  for (const [seconds, label] of [[-10, "−10 s"], [10, "+10 s"]]) {
    const button = element("button", label, "secondary");
    button.type = "button";
    button.disabled = true;
    button.setAttribute("aria-label", seconds < 0 ? "Back 10 seconds" : "Forward 10 seconds");
    audio.addEventListener("durationchange", () => {
      button.disabled = !Number.isFinite(audio.duration) || audio.duration <= 0;
    });
    audio.addEventListener("error", () => { button.disabled = true; });
    button.addEventListener("click", () => {
      if (!Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
    });
    controls.append(button);
  }

  const error = element("p", "", "audio-error");
  error.setAttribute("role", "status");
  error.hidden = true;
  audio.addEventListener("error", () => {
    error.textContent = "The original audio could not be played. Check the source link for another way to listen.";
    error.hidden = false;
  });
  audio.src = episode.audioUrl;

  section.append(controls, error, externalLink(episode.audioUrl, "Open original audio", "audio-source"));
  return section;
}

function transcriptSection(episode) {
  const section = element("section", "", "transcript");
  section.append(element("h3", "Transcript"));
  if (!episode.hasTranscript) {
    const messages = {
      restricted: "The transcript is restricted at the source.",
      "needs-review": "This transcript needs review. See the original lesson for the source material.",
    };
    section.append(element("p", messages[episode.transcriptStatus] ?? "No transcript is available for this topic.", "notice"));
    return section;
  }

  const body = element("div", "", "transcript-body");
  const sentenceButtons = [];
  for (const [paragraphIndex, paragraph] of episode.transcript.entries()) {
    const isSpeaker = /^speaker\s*:\s*\S[^\n]{0,100}$/i.test(paragraph.trim());
    const isQuestion = paragraph.length <= 180 && /^[^\n.!]+\?$/.test(paragraph.trim());
    const container = isSpeaker
      ? element("h4", paragraph, "speaker")
      : element("p", paragraph, isQuestion ? "question" : "");
    const segments = episode.alignment?.segments.filter(segment => segment.paragraphIndex === paragraphIndex) ?? [];
    if (segments.length) {
      container.replaceChildren();
      for (const segment of segments) {
        const button = element("button", segment.text, "sentence");
        button.type = "button";
        button.title = `Play from ${formatTime(segment.start)}`;
        button.dataset.start = segment.start;
        button.dataset.end = segment.end;
        sentenceButtons.push({ button, segment });
        container.append(button, document.createTextNode(" "));
      }
    }
    body.append(container);
  }
  if (episode.alignment && player && sentenceButtons.length) {
    section.append(element("p", "Click a sentence to listen from that point. Timing is automatically aligned to the original audio.", "sync-help"));
    section.append(sentenceControls(player, sentenceButtons));
  }
  section.append(body);
  return section;
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function sentenceControls(audio, sentences) {
  const controls = element("div", "", "sentence-controls");
  const repeat = element("button", "Repeat sentence", "secondary");
  repeat.type = "button";
  repeat.setAttribute("aria-pressed", "false");
  const replay = element("button", "Replay sentence", "secondary");
  replay.type = "button";
  const followLabel = element("label", "", "follow-label");
  const follow = element("input");
  follow.type = "checkbox";
  followLabel.append(follow, document.createTextNode("Follow transcript"));
  const status = element("span", "Select a sentence to listen.", "sentence-status");
  status.setAttribute("role", "status");
  controls.append(replay, repeat, followLabel, status);

  let selected = null;
  let active = null;
  let looping = false;
  let frame = null;
  let disposed = false;
  const removals = [];

  function listen(target, event, callback) {
    target.addEventListener(event, callback);
    removals.push(() => target.removeEventListener(event, callback));
  }

  function select(sentence) {
    selected?.button.removeAttribute("aria-pressed");
    selected = sentence;
    selected.button.setAttribute("aria-pressed", "true");
    status.textContent = `${looping ? "Repeating" : "Selected"} sentence at ${formatTime(sentence.segment.start)}`;
  }

  async function playSentence(sentence) {
    if (disposed) return;
    select(sentence);
    // Setting currentTime before metadata is supported by media elements and
    // preserves the requested seek while the remote audio starts loading.
    audio.currentTime = sentence.segment.start;
    update();
    try {
      await audio.play();
    } catch {
      if (!disposed) status.textContent = "Press Play in the audio player to continue.";
    }
  }

  function update() {
    if (disposed) return;
    if (looping && selected && !audio.paused && audio.currentTime >= selected.segment.end) {
      audio.currentTime = selected.segment.start;
    }
    const current = sentences.find(sentence => audio.currentTime >= sentence.segment.start && audio.currentTime < sentence.segment.end) ?? null;
    if (current === active) return;
    active?.button.classList.remove("is-reading");
    active?.button.removeAttribute("aria-current");
    active = current;
    if (active) {
      active.button.classList.add("is-reading");
      active.button.setAttribute("aria-current", "true");
      if (follow.checked && !audio.paused) active.button.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function tick() {
    frame = null;
    update();
    if (!disposed && !audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
  }

  for (const sentence of sentences) {
    sentence.button.setAttribute("aria-pressed", "false");
    listen(sentence.button, "click", () => { playSentence(sentence); });
  }
  listen(replay, "click", () => { playSentence(selected ?? active ?? sentences[0]); });
  listen(repeat, "click", () => {
    looping = !looping;
    repeat.setAttribute("aria-pressed", String(looping));
    repeat.textContent = looping ? "Stop repeating" : "Repeat sentence";
    if (looping) playSentence(selected ?? active ?? sentences[0]);
    else if (selected) select(selected);
  });
  listen(audio, "timeupdate", update);
  listen(audio, "seeked", update);
  listen(audio, "play", () => {
    if (frame === null) frame = requestAnimationFrame(tick);
  });
  listen(audio, "pause", () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    update();
  });
  listen(audio, "ended", () => {
    if (looping && selected) playSentence(selected);
  });
  listen(audio, "error", () => {
    status.textContent = "Audio could not be loaded. Try the original audio link.";
  });
  stopSentenceSync = () => {
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    removals.forEach(remove => remove());
  };
  return controls;
}

function sourceSection(episode) {
  const section = element("div", "", "source");
  const url = safeLink(episode.source?.url);
  const publisherLine = element("p", "Source: ");
  publisherLine.append(url ? externalLink(url, episode.publisher) : episode.publisher);
  section.append(publisherLine);
  if (episode.source?.author) section.append(element("p", `By ${episode.source.author}`));
  if (episode.source?.copyright) section.append(element("p", episode.source.copyright));
  return section;
}

function showLesson(episode) {
  stopSentenceSync?.();
  stopSentenceSync = null;
  if (player) {
    player.pause();
    player.removeAttribute("src");
    player.load();
    player = null;
  }

  activeEpisode = episode;
  if (!episode) {
    lesson.removeAttribute("aria-labelledby");
    const message = episodes.length ? "No topics match these filters." : "No topics are available yet.";
    lesson.replaceChildren(element("p", message, "notice"));
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("lesson", episode.slug);
  window.history.replaceState(null, "", url);
  const header = element("header", "", "lesson-header");
  const heading = element("h2", episode.title, "lesson-title");
  heading.id = "lesson-title";
  lesson.setAttribute("aria-labelledby", heading.id);
  header.append(element("p", episode.category, "lesson-category"), heading);
  if (episode.date) header.append(dateNode(episode.date, longDate, "lesson-date"));
  header.append(sourceSection(episode));
  lesson.replaceChildren(header, audioSection(episode), transcriptSection(episode));
}

function populateFilter(select, values, descending = false) {
  const labels = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (descending) labels.reverse();
  for (const value of labels) {
    const option = element("option", value);
    option.value = value;
    select.append(option);
  }
}

async function loadLibrary() {
  try {
    const [response, alignment] = await Promise.all([
      fetch("./db.json", { cache: "no-store", credentials: "same-origin" }),
      fetch("./alignment.json", { cache: "no-store", credentials: "same-origin" })
        .then(result => result.ok ? result.json() : null).catch(() => null),
    ]);
    alignments = alignment?.version === 1 && alignment.episodes && typeof alignment.episodes === "object"
      ? alignment.episodes : {};
    if (!response.ok) throw new Error("Library request failed");
    const data = await response.json();
    if (data.version !== 1 || !Array.isArray(data.episodes)) throw new Error("Unsupported library format");

    episodes = data.episodes
      .filter(item => typeof item?.slug === "string" && typeof item?.title === "string")
      .map(withDisplayData)
      .sort((a, b) => (b.date?.valueOf() ?? 0) - (a.date?.valueOf() ?? 0));

    populateFilter(part, episodes.map(episode => episode.category));
    populateFilter(publisher, episodes.map(episode => episode.publisher));
    populateFilter(year, episodes.map(episode => episode.year), true);
    for (const control of [search, ...filters]) control.disabled = false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("sync") === "1") availability.value = "synced";
    const requested = episodes.find(episode => episode.slug === params.get("lesson"));
    if (requested) activeEpisode = requested;
    showTopics();
    if (requested && activeEpisode === requested) showLesson(requested);
    const syncOption = availability.querySelector('[value="synced"]');
    const syncedCount = episodes.filter(episode => episode.alignment).length;
    if (syncOption) syncOption.textContent = `Sentence sync (${syncedCount} lessons)`;
  } catch {
    count.textContent = "Library unavailable";
    const message = element("p", "Could not load the study library.", "notice");
    message.setAttribute("role", "alert");
    const retry = element("button", "Try again", "secondary retry");
    retry.type = "button";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      loadLibrary();
    });
    lesson.replaceChildren(message, retry);
  }
}

search.addEventListener("input", showTopics);
for (const filter of filters) filter.addEventListener("change", showTopics);
clear.addEventListener("click", () => {
  for (const control of [search, ...filters]) control.value = "";
  showTopics();
  search.focus();
});
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  showLesson(null);
  list.replaceChildren();
  window.location.reload();
});
loadLibrary();
