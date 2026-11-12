#!/usr/bin/env python3
"""Build the IELTS library with fresh asset URLs for every deployment."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


ROOT = Path(__file__).resolve().parents[1]
MARKER = ".ielts-static-build"
SIGNATURE = "ielts-speaking-study-static-v1"
LEGACY_FILES = {
    ".nojekyll", "index.html", "app.js", "styles.css", "db.json",
    "alignment.json", "dialogue.json", "version.json",
}


def release_id(public, database):
    revision = os.environ.get("GITHUB_SHA")
    if revision:
        run = os.environ.get("GITHUB_RUN_ID", "local")
        attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
        value = f"{revision}-{run}-{attempt}"
    else:
        digest = hashlib.sha256()
        for path in [*sorted(public.rglob("*")), database]:
            if path.is_file():
                name = path.relative_to(ROOT).as_posix().encode()
                content = path.read_bytes()
                digest.update(len(name).to_bytes(8, "big") + name)
                digest.update(len(content).to_bytes(8, "big") + content)
        value = digest.hexdigest()[:20]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Release identifiers may contain only letters, numbers, underscores and hyphens")
    return value


def check_output(output, public, parser):
    if output == ROOT or ROOT.is_relative_to(output) or output.is_relative_to(public) or output.is_relative_to(ROOT / "data"):
        parser.error("Choose an output directory outside source data, public files and project ancestors")
    if not output.exists():
        return
    if not output.is_dir() or output.is_symlink():
        parser.error("The output must be a directory")
    marker = output / MARKER
    if marker.is_file() and marker.read_text(encoding="utf-8").strip() == SIGNATURE:
        return
    entries = list(output.iterdir())
    if all(path.is_file() and not path.is_symlink() and path.name in LEGACY_FILES for path in entries):
        return
    parser.error("Output contains files outside a previous IELTS static build. Choose an empty directory")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    if args.output_dir.is_symlink():
        parser.error("Choose an output directory without a symlink")
    output = args.output_dir.resolve()
    public = ROOT / "public"
    database = ROOT / "data" / "db.json"
    check_output(output, public, parser)

    data = json.loads(database.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("episodes"), list):
        parser.error("data/db.json must contain version 1 and an episodes array")
    for filename in ("index.html", "app.js", "styles.css"):
        if not (public / filename).is_file():
            parser.error(f"Missing public/{filename}")
    for filename in ("alignment.json", "dialogue.json"):
        path = public / filename
        if path.is_file():
            json.loads(path.read_text(encoding="utf-8"))

    release = release_id(public, database)
    base = "./"
    html = (public / "index.html").read_text(encoding="utf-8")
    for attribute, filename in (("href", "styles.css"), ("src", "app.js")):
        pattern = rf'({attribute}\s*=\s*[\"\'])(?:\./)?{re.escape(filename)}(?:\?[^\"\']*)?([\"\'])'
        html, replacements = re.subn(pattern, lambda match: f"{match[1]}{base}{filename}?v={release}{match[2]}", html)
        if replacements != 1:
            parser.error(f"Expected one local {filename} reference in public/index.html")

    html = re.sub(
        r"<meta\b(?=[^>]*\bname\s*=\s*[\"']app-version[\"'])[^>]*>\s*",
        "",
        html,
        flags=re.IGNORECASE,
    )
    html, head_count = re.subn(
        r"[ \t]*</head\s*>",
        f'    <meta name="app-version" content="{release}">\n  </head>',
        html,
        flags=re.IGNORECASE,
    )
    if head_count != 1:
        parser.error("Expected one closing head tag in public/index.html")

    script = (public / "app.js").read_text(encoding="utf-8")
    for placeholder, value in (("__BUILD_ID__", release), ("__ASSET_BASE__", base)):
        if script.count(placeholder) != 1:
            parser.error(f"Expected one {placeholder} placeholder in public/app.js")
        script = script.replace(placeholder, value)

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".ielts-build-", dir=output.parent) as directory:
        staged = Path(directory) / "site"
        shutil.copytree(public, staged, ignore=shutil.ignore_patterns("index.html"))
        (staged / "app.js").write_text(script, encoding="utf-8")
        shutil.copyfile(database, staged / "db.json")
        (staged / "index.html").write_text(html, encoding="utf-8")
        (staged / "version.json").write_text(json.dumps({"version": release}) + "\n", encoding="utf-8")
        (staged / ".nojekyll").touch()
        (staged / MARKER).write_text(SIGNATURE + "\n", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        staged.rename(output)
    print(f"Built {len(data['episodes'])} lessons, release {release}, into {output}")


if __name__ == "__main__":
    main()
