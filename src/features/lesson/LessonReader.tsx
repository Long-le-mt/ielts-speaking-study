import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { CheckboxField } from "../../components/ui/Fields";
import { safeLink, type Episode, type SentenceCue } from "../../lib/library";
import { groupTranscript } from "./transcript";
import { useAudioPlayback } from "./useAudioPlayback";

export interface LessonReaderProps {
  episode: Episode;
  onPositionChange?: (time: number) => void;
  initialTime?: number;
}

const noCues: readonly SentenceCue[] = [];
const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

const speakerStyles: Record<string, string> = {
  Joseph: "joseph",
  Blondie: "blondie",
  Ivanna: "ivanna",
};
const roleLabels = {
  host: "Host",
  candidate: "Candidate",
  interviewer: "Question",
  speaker: "",
};

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function LessonHeading({ episode }: { episode: Episode }) {
  const source = safeLink(episode.source?.url);
  return (
    <header className="lesson-header">
      <p className="lesson-category">{episode.category}</p>
      <h2 id="lesson-title" className="lesson-title">{episode.title}</h2>
      {episode.date && (
        <time className="lesson-date" dateTime={episode.date.toISOString().slice(0, 10)}>
          {dateFormat.format(episode.date)}
        </time>
      )}
      <div className="source">
        <p>Source: {source ? (
          <a href={source} target="_blank" rel="noopener noreferrer">{episode.publisher}</a>
        ) : episode.publisher}</p>
        {episode.source?.author && <p>By {episode.source.author}</p>}
        {episode.source?.copyright && <p>{episode.source.copyright}</p>}
      </div>
    </header>
  );
}

function AudioPlayer({ episode, playback }: {
  episode: Episode;
  playback: ReturnType<typeof useAudioPlayback>;
}) {
  const membership = safeLink(episode.source?.membershipUrl);
  const alternate = episode.videoUrl ?? membership;
  return (
    <section className="listen" aria-label="Audio player">
      {episode.audioUrl ? (
        <>
          <div className="audio-controls">
            <audio ref={playback.audioRef} controls preload="none" aria-label={`Audio for ${episode.title}`} />
            <Button aria-label="Back 10 seconds"
              disabled={!playback.duration || playback.failed} onClick={() => playback.controls.current.skip(-10)}>
              −10 s
            </Button>
            <Button aria-label="Forward 10 seconds"
              disabled={!playback.duration || playback.failed} onClick={() => playback.controls.current.skip(10)}>
              +10 s
            </Button>
          </div>
          {playback.failed && <p className="audio-error" role="status">The original audio could not be played. Try the original link.</p>}
          <a className="audio-source" href={episode.audioUrl} target="_blank" rel="noopener noreferrer">Open original audio</a>
        </>
      ) : alternate ? (
        <a className="audio-source" href={alternate} target="_blank" rel="noopener noreferrer">
          {episode.videoUrl ? "Watch the original video on YouTube" : "View the publisher’s YouTube membership"}
        </a>
      ) : <p className="notice">No direct audio link is available for this topic.</p>}
    </section>
  );
}

function LessonContent({ episode, onPositionChange, initialTime }: LessonReaderProps) {
  const cues = episode.audioUrl && episode.hasTranscript ? episode.alignment?.segments ?? noCues : noCues;
  const { sections, bySentence } = useMemo(() => groupTranscript(episode, cues), [episode, cues]);
  const playback = useAudioPlayback({ source: episode.audioUrl, cues, initialTime, onPositionChange });
  const [follow, setFollow] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const active = bySentence[playback.active];
  const selected = cues[playback.selected];
  const replayIndex = playback.selected >= 0 ? playback.selected : Math.max(0, playback.active);
  const speakingTurn = bySentence[playback.lastActive]?.turn;
  const role = speakingTurn?.role;
  const speaker = speakingTurn?.speaker;
  const roleLabel = role === "candidate" ? "Answer" : role && roleLabels[role];
  const speaking = [speaker, roleLabel && roleLabel !== speaker ? roleLabel : ""].filter(Boolean).join(" · ");

  function revealSentence(index: number, force: boolean) {
    const pane = viewport.current;
    const sentence = pane?.querySelector<HTMLElement>(`[data-sentence-index="${index}"]`);
    if (!pane || !sentence) return;
    const view = pane.getBoundingClientRect();
    const row = sentence.getBoundingClientRect();
    if (!force && row.top >= view.top + 32 && row.bottom <= view.bottom - 48) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    pane.scrollTo({
      top: Math.max(0, pane.scrollTop + row.top - view.top - 36),
      behavior: force || reduceMotion ? "auto" : "smooth",
    });
  }

  useLayoutEffect(() => {
    if (follow && playback.playing && playback.active >= 0) revealSentence(playback.active, false);
  }, [follow, playback.active, playback.playing]);

  function playSentence(index: number, reveal = false) {
    if (reveal) revealSentence(index, true);
    playback.controls.current.playCue(index);
  }

  const transcriptMessage = episode.transcriptStatus === "restricted"
    ? "The transcript is restricted at the source."
    : episode.transcriptStatus === "needs-review"
      ? "This transcript needs review. See the original lesson for the source material."
      : "No transcript is available for this topic.";

  return (
    <>
      <LessonHeading episode={episode} />
      <AudioPlayer episode={episode} playback={playback} />
      <section className="transcript">
        <div className="reader-heading">
          <h3>Transcript</h3>
          {cues.length > 0 && <span className="reader-hint">Click a sentence to listen</span>}
        </div>
        {!episode.hasTranscript ? <p className="notice">{transcriptMessage}</p> : (
          <>
            {cues.length > 0 && (
              <div className="reader-toolbar">
                <nav className="section-navigation" aria-label="Transcript sections">
                  {sections.map((section) => {
                    const index = section.firstSentence;
                    if (index === undefined) return null;
                    return (
                      <button key={section.id} type="button" className="section-chip"
                        aria-current={active?.section === section || undefined} onClick={() => playSentence(index, true)}>
                        {section.label}
                      </button>
                    );
                  })}
                </nav>
                <div className="sentence-controls">
                  <Button onClick={() => playSentence(replayIndex, true)}>Replay sentence</Button>
                  <Button aria-pressed={playback.repeating}
                    onClick={() => playback.controls.current.toggleRepeat()}>
                    {playback.repeating ? "Stop repeating" : "Repeat sentence"}
                  </Button>
                  <CheckboxField label="Follow audio" labelClassName="follow-label" checked={follow}
                    onChange={(event) => {
                      setFollow(event.currentTarget.checked);
                      if (event.currentTarget.checked && playback.active >= 0) revealSentence(playback.active, true);
                    }} />
                </div>
                <div className="reading-state">
                  <p className="now-speaking" aria-live="polite">{speaking || "Ready to listen"}</p>
                  <span className="sentence-status" role="status">
                    {playback.message || (selected ? `${playback.repeating ? "Repeating" : "Selected"} ${formatTime(selected.start)}` : "")}
                  </span>
                </div>
              </div>
            )}
            <div className="transcript-viewport" ref={viewport} tabIndex={0} aria-label="Transcript reading area">
              <div className="transcript-body">
                {sections.map((section) => (
                  <section key={section.id} className="dialogue-section">
                    {section.label !== "Transcript" && <h4 className="section-heading">{section.label}</h4>}
                    {section.turns.map((turn) => {
                      const label = roleLabels[turn.role];
                      return (
                        <article key={turn.id} className={`turn turn-${turn.role} speaker-${speakerStyles[turn.speaker] ?? "default"}${active?.turn === turn ? " is-speaking" : ""}`}>
                          {turn.speaker && (
                            <header className="turn-label">
                              <span className="speaker-name">{turn.speaker}</span>
                              {label && label !== turn.speaker && <span className="speaker-role">{label}</span>}
                            </header>
                          )}
                          {turn.paragraphs.map((paragraph) => (
                            <p key={paragraph.index} className="turn-paragraph">
                              {paragraph.sentences.length ? paragraph.sentences.map(({ index, cue }) => (
                                <Fragment key={index}>
                                  <button type="button" className={`sentence${playback.active === index ? " is-reading" : ""}`}
                                    title={`Listen from ${formatTime(cue.start)}`} data-start={cue.start} data-end={cue.end}
                                    data-sentence-index={index} aria-current={playback.active === index || undefined}
                                    aria-pressed={playback.selected === index} onClick={() => playSentence(index)}>
                                    {cue.text}
                                  </button>
                                  {" "}
                                </Fragment>
                              )) : paragraph.text}
                            </p>
                          ))}
                        </article>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export function LessonReader(props: LessonReaderProps) {
  return <LessonContent key={`${props.episode.slug}:${props.episode.audioUrl ?? ""}`} {...props} />;
}
