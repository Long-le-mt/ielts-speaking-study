export function assetUrl(name: string): string {
  const base = import.meta.env.BASE_URL;
  return import.meta.env.DEV ? base + name : base + name + "?v=" + encodeURIComponent(__APP_VERSION__);
}

export function takePlaybackPosition(slug: string): number | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem("ielts-playback") ?? "null");
    if (saved?.slug !== slug || !Number.isFinite(saved.time)) return undefined;
    return Math.max(0, saved.time);
  } catch {
    return undefined;
  }
}

export function clearPlaybackPosition(slug: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem("ielts-playback") ?? "null");
    if (saved?.slug === slug) sessionStorage.removeItem("ielts-playback");
  } catch {
    // Reading and playback work without session storage.
  }
}

export function watchRelease(savePlayback: (url: URL) => void): () => void {
  if (import.meta.env.DEV) return () => {};
  let pending = false;
  let stopped = false;
  const check = async () => {
    if (pending || stopped || document.visibilityState === "hidden") return;
    pending = true;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}version.json?check=${Date.now()}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const { version } = await response.json();
      if (stopped || typeof version !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(version) ||
          version === __APP_VERSION__) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("v") === version) return;
      savePlayback(url);
      url.searchParams.set("v", version);
      window.location.replace(url);
    } catch {
      // A failed release check leaves the loaded library available.
    } finally {
      pending = false;
    }
  };
  window.addEventListener("focus", check);
  window.addEventListener("pageshow", check);
  document.addEventListener("visibilitychange", check);
  const timer = window.setInterval(check, 60_000);
  return () => {
    stopped = true;
    window.removeEventListener("focus", check);
    window.removeEventListener("pageshow", check);
    document.removeEventListener("visibilitychange", check);
    window.clearInterval(timer);
  };
}
