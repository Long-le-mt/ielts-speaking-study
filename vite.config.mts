import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const pagesBase = "/ielts-speaking-study/";
const dataFiles = {
  "db.json": "data/db.json",
  "alignment.json": "public/alignment.json",
  "dialogue.json": "public/dialogue.json",
};

function getRelease(): string {
  if (process.env.PAGES_SOURCE_SHA && process.env.GITHUB_RUN_ID) {
    const id = [
      process.env.PAGES_SOURCE_SHA,
      process.env.GITHUB_RUN_ID,
      process.env.GITHUB_RUN_ATTEMPT ?? "1",
    ].join("-");
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid release identifier");
    return id;
  }
  const hash = createHash("sha256");
  function add(path: string) {
    hash.update(path).update("\0").update(readFileSync(join(root, path))).update("\0");
  }
  function visit(directory: string) {
    for (const file of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, file.name);
      if (file.isDirectory()) visit(path);
      else if (file.isFile() && file.name !== "routeTree.gen.ts") add(path);
    }
  }
  visit("src");
  for (const path of [
    "index.html", "vite.config.mts", "package-lock.json", "scripts/pages-recovery.js",
    "public/styles.css", ...Object.values(dataFiles),
  ]) add(path);
  return hash.digest("hex").slice(0, 20);
}

function studyAssets(base: string, release: string): Plugin {
  return {
    name: "study-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = request.url?.split("?")[0].slice(1);
        if (!name || !Object.hasOwn(dataFiles, name)) return next();
        try {
          const path = dataFiles[name as keyof typeof dataFiles];
          const content = readFileSync(join(root, path));
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(content);
        } catch (error) {
          next(error);
        }
      });
    },
    transformIndexHtml() {
      if (release === "development") return [];
      return [
        { tag: "meta", attrs: { name: "app-version", content: release }, injectTo: "head" },
        { tag: "script", attrs: { src: base + "app.js?v=" + release, defer: true }, injectTo: "head" },
      ];
    },
    generateBundle() {
      for (const [fileName, path] of Object.entries(dataFiles)) {
        const source = readFileSync(join(root, path), "utf8");
        const value = JSON.parse(source);
        if (value?.version !== 1 || (fileName === "db.json" && !Array.isArray(value.episodes))) {
          throw new Error(`Invalid study data in ${path}`);
        }
        this.emitFile({ type: "asset", fileName, source });
      }
      for (const file of ["bricolage-OFL.txt", "dm-sans-OFL.txt"]) {
        this.emitFile({ type: "asset", fileName: "licenses/" + file, source: readFileSync(join(root, "src/assets/fonts", file)) });
      }
      // Stable URLs allow older cached index files to find the current release.
      this.emitFile({ type: "asset", fileName: "app.js", source: readFileSync(join(root, "scripts/pages-recovery.js")) });
      this.emitFile({ type: "asset", fileName: "styles.css", source: readFileSync(join(root, "public/styles.css")) });
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: release }) + "\n" });
      this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
    },
  };
}

export default defineConfig(({ command, isPreview }) => {
  const base = command === "build" || isPreview ? pagesBase : "/";
  const release = command === "build" ? getRelease() : "development";
  return {
    base,
    publicDir: false,
    define: { __APP_VERSION__: JSON.stringify(release) },
    plugins: [tanstackRouter({ target: "react" }), react(), studyAssets(base, release)],
    server: { host: "127.0.0.1" },
    preview: { host: "127.0.0.1" },
  };
});
