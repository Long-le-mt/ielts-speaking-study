import { useLayoutEffect, useRef, useState } from "react";
import type { SentenceCue } from "../../lib/library";

interface PlaybackOptions {
  source: string | null;
  cues: readonly SentenceCue[];
  initialTime?: number;
  onPositionChange?: (time: number) => void;
}

interface PlaybackControls {
  playCue: (index: number) => void;
  skip: (seconds: number) => void;
  toggleRepeat: () => void;
}

const emptyControls: PlaybackControls = {
  playCue: () => {},
  skip: () => {},
  toggleRepeat: () => {},
};

export function useAudioPlayback({ source, cues, initialTime, onPositionChange }: PlaybackOptions) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const restoreTime = useRef(initialTime);
  const reportPosition = useRef(onPositionChange);
  const controls = useRef(emptyControls);
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cueState, setCueState] = useState({ active: -1, lastActive: -1 });
  const [selected, setSelected] = useState(-1);
  const [repeating, setRepeating] = useState(false);
  const [message, setMessage] = useState("");

  useLayoutEffect(() => {
    reportPosition.current = onPositionChange;
  }, [onPositionChange]);

  useLayoutEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    const media = audio;
    let frame: number | null = null;
    let currentCue = -1;
    let selectedCue = -1;
    let repeat = false;
    let disposed = false;
    let request = 0;
    let pendingSeek: number | null = null;

    function position() {
      return pendingSeek ?? media.currentTime;
    }

    function seek(seconds: number) {
      const maximum = Number.isFinite(media.duration) ? media.duration : Infinity;
      const target = Math.max(0, Math.min(maximum, seconds));
      pendingSeek = media.readyState < 1 ? target : null;
      media.currentTime = target;
    }

    function update() {
      if (disposed) return;
      const loopCue = repeat ? cues[selectedCue] : undefined;
      if (loopCue && !media.paused && !media.seeking && position() >= loopCue.end) {
        seek(loopCue.start);
      }
      const time = position();
      const next = cues.findIndex((cue) => cue.start <= time && time < cue.end);
      if (currentCue !== next) {
        currentCue = next;
        setCueState((previous) => ({ active: next, lastActive: next >= 0 ? next : previous.lastActive }));
      }
    }

    function publishPosition() {
      const time = position();
      if (Number.isFinite(time)) reportPosition.current?.(time);
    }

    function tick() {
      frame = null;
      update();
      if (!disposed && !media.paused && !media.ended) {
        frame = window.requestAnimationFrame(tick);
      }
    }

    function stopFrame() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    }

    function onPlay() {
      setPlaying(true);
      setMessage("");
      update();
      if (cues.length && frame === null) frame = window.requestAnimationFrame(tick);
    }

    function onPause() {
      stopFrame();
      setPlaying(false);
      update();
      publishPosition();
    }

    function onTimeChange() {
      update();
      publishPosition();
    }

    function onDuration() {
      setDuration(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null);
    }

    function onMetadata() {
      if (pendingSeek !== null) seek(pendingSeek);
      onDuration();
      onTimeChange();
    }

    async function playCue(index: number) {
      const cue = cues[index];
      if (!cue || disposed) return;
      const playRequest = ++request;
      selectedCue = index;
      setSelected(index);
      setMessage("");
      try {
        seek(cue.start);
        onTimeChange();
        await media.play();
      } catch {
        if (!disposed && playRequest === request && !media.error) {
          setMessage("Press Play to continue");
        }
      }
    }

    function onEnded() {
      onPause();
      if (repeat && selectedCue >= 0) void playCue(selectedCue);
    }

    function onError() {
      stopFrame();
      setFailed(true);
      setPlaying(false);
      setDuration(null);
      setMessage("Audio unavailable. Try the original link.");
    }

    const listeners: [keyof HTMLMediaElementEventMap, EventListener][] = [
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onEnded],
      ["timeupdate", onTimeChange],
      ["seeked", onTimeChange],
      ["durationchange", onDuration],
      ["loadedmetadata", onMetadata],
      ["error", onError],
    ];
    for (const [event, callback] of listeners) media.addEventListener(event, callback);

    controls.current = {
      playCue: (index) => { void playCue(index); },
      skip: (seconds) => {
        if (!Number.isFinite(media.duration) || media.duration <= 0) return;
        seek(position() + seconds);
        onTimeChange();
      },
      toggleRepeat: () => {
        repeat = !repeat;
        setRepeating(repeat);
        if (repeat && cues.length) {
          const index = selectedCue >= 0 ? selectedCue : Math.max(0, currentCue);
          void playCue(index);
        }
      },
    };

    media.src = source;
    const restored = restoreTime.current;
    if (typeof restored === "number" && Number.isFinite(restored) && restored > 0) {
      seek(restored);
      onTimeChange();
    }

    return () => {
      disposed = true;
      controls.current = emptyControls;
      stopFrame();
      for (const [event, callback] of listeners) media.removeEventListener(event, callback);
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, [source, cues]);

  return { audioRef, controls, duration, playing, failed, ...cueState, selected, repeating, message };
}
