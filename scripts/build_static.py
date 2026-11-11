#!/usr/bin/env python3
"""Build the public IELTS study site for GitHub Pages."""

import argparse
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output_dir.resolve()
    public = ROOT / "public"
    database = ROOT / "data" / "db.json"
    if output == ROOT or output.is_relative_to(public) or output.is_relative_to(ROOT / "data"):
        parser.error("Choose an output directory outside public/ and data/ and distinct from the project root")

    data = json.loads(database.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("episodes"), list):
        parser.error("data/db.json must contain version 1 and an episodes array")
    for filename in ("index.html", "app.js", "styles.css"):
        if not (public / filename).is_file():
            parser.error(f"Missing public/{filename}")

    shutil.copytree(public, output, dirs_exist_ok=True)
    shutil.copyfile(database, output / "db.json")
    (output / ".nojekyll").touch()
    print(f"Built {len(data['episodes'])} lessons into {output}")


if __name__ == "__main__":
    main()
