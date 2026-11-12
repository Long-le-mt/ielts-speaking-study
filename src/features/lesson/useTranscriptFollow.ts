import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

interface FollowOptions {
  active: number;
  playing: boolean;
  player: RefObject<HTMLElement | null>;
}

const edge = 12;

function inReadingArea(top: number, height: number, start: number, end: number) {
  const available = end - start - 2 * edge;
  return available > 0 && top >= start + edge &&
    top + Math.min(height, available) <= end - edge;
}

export function useTranscriptFollow({ active, playing, player }: FollowOptions) {
  const viewport = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const hasPlayed = useRef(false);
  const lastObservedCue = useRef(-1);

  const revealSentence = useCallback((index: number, immediate = false) => {
    const pane = viewport.current;
    const sentence = pane?.querySelector<HTMLElement>(`[data-sentence-index="${index}"]`);
    if (!pane || !sentence || !pane.clientHeight) return;

    const screen = window.visualViewport;
    const screenTop = screen?.offsetTop ?? 0;
    const screenBottom = screenTop + (screen?.height ?? window.innerHeight);
    const playerElement = player.current;
    const playerStyle = playerElement && window.getComputedStyle(playerElement);
    const stickyHeight = playerStyle?.position === "sticky" && playerElement
      ? playerElement.getBoundingClientRect().height + (Number.parseFloat(playerStyle.top) || 0)
      : 0;
    const screenStart = Math.min(screenTop + stickyHeight, screenBottom - 3 * edge);
    const paneTop = pane.getBoundingClientRect().top + pane.clientTop;
    const paneBottom = paneTop + pane.clientHeight;
    const row = sentence.getBoundingClientRect();
    const behavior = immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto" : "smooth";

    const visibleTop = Math.max(paneTop, screenStart);
    const visibleBottom = Math.min(paneBottom, screenBottom);
    const visibleHeight = visibleBottom - visibleTop;
    const canStayOnPage = visibleHeight >= Math.min(160, pane.clientHeight / 2) &&
      visibleHeight >= Math.min(row.height + 2 * edge, screenBottom - screenStart);

    // Prefer moving the transcript pane when enough of it is already onscreen.
    const currentTop = pane.scrollTop;
    let targetTop = currentTop;
    const areaTop = canStayOnPage ? visibleTop : paneTop;
    const areaBottom = canStayOnPage ? visibleBottom : paneBottom;
    if (!inReadingArea(row.top, row.height, areaTop, areaBottom)) {
      const inset = Math.min(64, Math.max(edge, (areaBottom - areaTop - row.height) / 3));
      targetTop = Math.max(0, Math.min(
        pane.scrollHeight - pane.clientHeight,
        currentTop + row.top - areaTop - inset,
      ));
      if (Math.abs(targetTop - currentTop) > 1) pane.scrollTo({ top: targetTop, behavior });
    }

    const projectedTop = row.top + currentTop - targetTop;
    if (!inReadingArea(projectedTop, row.height, screenStart, screenBottom)) {
      const inset = Math.min(64, Math.max(edge, (screenBottom - screenStart - row.height) / 3));
      const distance = projectedTop - screenStart - inset;
      if (Math.abs(distance) > 1) window.scrollBy({ top: distance, behavior });
    }
  }, [player]);

  useLayoutEffect(() => {
    const cueChanged = lastObservedCue.current !== active;
    lastObservedCue.current = active;
    if (playing) hasPlayed.current = true;
    if (!follow || active < 0 || !hasPlayed.current) return;
    if (!playing && !cueChanged) return;
    const frame = window.requestAnimationFrame(() => revealSentence(active));
    return () => window.cancelAnimationFrame(frame);
  }, [active, follow, playing, revealSentence]);

  return { viewport, follow, setFollow, revealSentence };
}
