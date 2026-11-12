(() => {
  const script = document.currentScript;
  if (!script) return;

  const loadedVersion = document.querySelector('meta[name="app-version"]')?.content;
  const manifest = new URL("version.json", script.src);
  manifest.searchParams.set("check", String(Date.now()));

  fetch(manifest, { cache: "no-store", credentials: "same-origin" })
    .then(response => response.ok ? response.json() : null)
    .then(release => {
      const version = release?.version;
      if (typeof version !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(version) || version === loadedVersion) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("v") === version) return;
      url.searchParams.set("v", version);
      window.location.replace(url);
    })
    .catch(() => {});
})();
