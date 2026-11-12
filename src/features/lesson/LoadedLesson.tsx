import { memo, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { getLoadedLesson, loadLesson, type Episode } from "../../lib/library";
import { clearPlaybackPosition, takePlaybackPosition } from "../../lib/release";
import { LessonReader } from "./LessonReader";

export const LoadedLesson = memo(function LoadedLesson({ episode }: { episode: Episode }) {
  const [detail, setDetail] = useState(() => getLoadedLesson(episode));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [position] = useState(() => takePlaybackPosition(episode.slug));

  useEffect(() => {
    let current = true;
    loadLesson(episode).then(value => {
      if (current) setDetail(value);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [episode, attempt]);

  useEffect(() => {
    if (detail && position !== undefined) clearPlaybackPosition(episode.slug);
  }, [detail, episode.slug, position]);

  if (detail) return <LessonReader episode={detail} initialTime={position} />;

  return (
    <section aria-busy={!failed}>
      <header className="lesson-header">
        <p className="lesson-category">{episode.category}</p>
        <h2 id="lesson-title" className="lesson-title">{episode.title}</h2>
      </header>
      {failed ? (
        <div>
          <p className="notice" role="alert">Could not load this lesson.</p>
          <Button className="retry" onClick={() => {
            setFailed(false);
            setAttempt(previous => previous + 1);
          }}>Try again</Button>
        </div>
      ) : <p className="notice" role="status">Loading lesson…</p>}
    </section>
  );
});
