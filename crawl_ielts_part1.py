#!/usr/bin/env python3
"""Update the private IELTS TIME database from public Speaking Part 1 and 2 pages."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import tempfile
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup, Comment, NavigableString, Tag
from protego import Protego


BASE = "https://theieltstime.com/"
CATEGORIES = {
    part: urljoin(BASE, f"category/ielts-speaking-part-{part}/")
    for part in ("1", "2")
}
CATEGORY = CATEGORIES["1"]
DATABASE = Path(__file__).resolve().parent / "data" / "db.json"
AGENT = "IELTS-Part1-Personal-Crawler"
MIN_DELAY = 3
MAX_CATEGORY_PAGES = 100
TRANSCRIPT_STATUSES = {"available", "missing", "restricted", "needs-review"}
MEMBERS_ONLY_NOTICE = re.compile(
    r"\b(?:taken from a members[-– ]only (?:video|lesson)|"
    r"(?:this|the) (?:video|lesson) is (?:available )?for (?:channel )?members only)\b",
    re.I,
)
AUDIO_EXTENSION = re.compile(r"\.(mp3|m4a|wav|aac|ogg|opus|flac)$", re.I)
YOUTUBE_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
YOUTUBE_CHANNEL_JOIN = re.compile(r"/channel/(UC[A-Za-z0-9_-]{22})/join/?")
YOUTUBE_EMBED_LITERAL = re.compile(
    r"""["'](https://(?:www\.)?youtube(?:-nocookie)?\.com/embed/[^"'\s<>]+)["']"""
)
SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")
BLOCK_TAGS = {
    "article", "blockquote", "dd", "div", "dt", "figcaption", "h2", "h3",
    "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "section", "table",
    "td", "th", "tr", "ul",
}
SKIP_CONTENT = (
    "script, style, noscript, template, iframe, video, audio, form, nav, "
    "aside, [hidden], [aria-hidden='true'], .wp-block-buttons, "
    ".wp-block-embed, .wp-block-post-date, .wp-block-post-terms, "
    ".wp-block-post-author, .wp-block-comments, .sharedaddy, .addtoany_share_save_container"
)


class CrawlError(Exception):
    """Abort an update that could not be completed safely."""


def source_host(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.netloc == "theieltstime.com"


def episode_url(url: str) -> str | None:
    slug = urlsplit(url).path.strip("/")
    if source_host(url) and SLUG.fullmatch(slug) and slug not in {
        "episodes", "shop", "buy-me-a-coffee",
    }:
        return urljoin(BASE, f"{slug}/")
    return None


class Source:
    def __init__(self, session: requests.Session):
        self.session = session
        self.session.headers.update({"User-Agent": AGENT})
        self.delay = MIN_DELAY
        self.last_request = 0.0
        self.robots = None

    def load_robots(self) -> None:
        url = urljoin(BASE, "robots.txt")
        with self.get(url, check_robots=False) as response:
            if response.status_code == 404:
                self.robots = Protego.parse("")
                return
            self.require_ok(response)
            if "text/html" in response.headers.get("Content-Type", "").lower():
                raise CrawlError("robots.txt returned HTML. Crawl stopped.")
            self.robots = Protego.parse(response.text)
        crawl_delay = self.robots.crawl_delay(AGENT) or 0
        request_rate = self.robots.request_rate(AGENT)
        if request_rate and request_rate.requests > 0:
            crawl_delay = max(crawl_delay, request_rate.seconds / request_rate.requests)
        self.delay = max(self.delay, crawl_delay)

    @staticmethod
    def require_ok(response: requests.Response) -> None:
        if response.status_code != 200:
            raise CrawlError(f"HTTP {response.status_code} at {response.url}")

    def get(self, url: str, *, check_robots: bool = True, media: bool = False):
        for _ in range(4):
            if not source_host(url):
                raise CrawlError(f"Unexpected host or protocol for {url}")
            if check_robots and (self.robots is None or not self.robots.can_fetch(url, AGENT)):
                raise CrawlError(f"robots.txt blocks {url}")
            for attempt in range(2):
                wait = self.delay - (time.monotonic() - self.last_request)
                if wait > 0:
                    time.sleep(wait)
                self.last_request = time.monotonic()
                try:
                    response = self.session.get(
                        url, timeout=(10, 25), allow_redirects=False, stream=media,
                        headers={"Range": "bytes=0-11"} if media else None,
                    )
                except requests.RequestException as exc:
                    if attempt == 0:
                        continue
                    raise CrawlError(f"Request failed for {url}: {exc}") from exc
                if response.status_code == 429 or (
                    response.status_code == 503 and "Retry-After" in response.headers
                ):
                    retry_after = response.headers.get("Retry-After", "not supplied")
                    response.close()
                    raise CrawlError(
                        f"Rate limit or maintenance at {url}; Retry-After={retry_after}. "
                        "Stopped without writing the database."
                    )
                if response.status_code in {500, 502, 503, 504} and attempt == 0:
                    response.close()
                    continue
                break
            if response.is_redirect:
                url = urljoin(url, response.headers["Location"])
                response.close()
                continue
            return response
        raise CrawlError(f"Too many redirects at {url}")

    def html(self, url: str) -> BeautifulSoup:
        with self.get(url) as response:
            self.require_ok(response)
            return BeautifulSoup(response.content, "html.parser")

    def audio(self, candidates: list[str]) -> dict | None:
        for url in candidates:
            if not self.robots.can_fetch(url, AGENT):
                continue
            with self.get(url, media=True) as response:
                mime_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if response.status_code in {200, 206}:
                    if mime_type.startswith("audio/"):
                        return {"url": response.url}
                    wav_path = urlsplit(response.url).path.lower().endswith(".wav")
                    if wav_path and mime_type in {"", "application/octet-stream"}:
                        # Some public WAV files are served as generic downloads.
                        header = next(response.iter_content(chunk_size=12), b"")
                        if header[:4] in {b"RIFF", b"RF64", b"RIFX"} and header[8:12] == b"WAVE":
                            return {"url": response.url}
                if response.status_code >= 500:
                    self.require_ok(response)
        return None


def category_links(soup: BeautifulSoup, page: str, category: str = CATEGORY) -> tuple[list[str], str | None]:
    main = soup.select_one("main") or soup.select_one('[role="main"]')
    if main is None:
        raise CrawlError(f"Category content unavailable at {page}")
    links = main.select(".wp-block-post-title a[href], .entry-title a[href]")
    if not links:
        links = main.select("h2 a[href], h3 a[href]")
    urls = []
    for link in links:
        url = episode_url(urljoin(page, link["href"]))
        if url:
            urls.append(url)
    if not urls:
        raise CrawlError(f"No episode links found at {page}")

    next_link = main.select_one("a.wp-block-query-pagination-next[href], a[rel~=next][href]")
    if next_link is None:
        next_link = next(
            (link for link in main.select("a[href]") if re.match(
                r"next\s*page", link.get_text(" ", strip=True), re.I
            )),
            None,
        )
    if next_link is None:
        return urls, None
    next_page = urljoin(page, next_link["href"])
    category_path = urlsplit(category).path
    if not source_host(next_page) or not urlsplit(next_page).path.startswith(category_path):
        raise CrawlError(f"Invalid category pagination URL: {next_page}")
    return urls, next_page


def article_urls(source: Source, category: str = CATEGORY) -> list[str]:
    urls = {}
    visited = set()
    page = category
    while page:
        if page in visited or len(visited) >= MAX_CATEGORY_PAGES:
            raise CrawlError(f"Category pagination did not terminate at {page}")
        visited.add(page)
        entries, page = category_links(source.html(page), page, category)
        urls.update(dict.fromkeys(entries))
    return list(urls)


def transcript_blocks(content: Tag) -> list[str]:
    for element in content.select(SKIP_CONTENT):
        if element.parent is not None:
            element.decompose()
    blocks = []
    inline = []

    def flush() -> None:
        text = re.sub(r"\s+", " ", "".join(inline)).strip()
        if text:
            blocks.append(text)
        inline.clear()

    def visit(node) -> None:
        if isinstance(node, Comment):
            return
        if isinstance(node, NavigableString):
            inline.append(str(node))
            return
        if not isinstance(node, Tag):
            return
        if node.name == "br":
            flush()
            return
        block = node.name in BLOCK_TAGS
        if block:
            flush()
        for child in node.children:
            visit(child)
        if block:
            flush()

    visit(content)
    return blocks


def publication_date(soup: BeautifulSoup) -> str | None:
    for element in soup.select(
        "meta[property='article:published_time'], .wp-block-post-date time, "
        "time.published, time.entry-date, .wp-block-post-date, main time"
    ):
        value = element.get("datetime") or element.get("content") or element.get_text(" ", strip=True)
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            try:
                return datetime.strptime(value, "%B %d, %Y").date().isoformat()
            except ValueError:
                continue
    return None


def youtube_links(value: str) -> dict[str, str]:
    """Return a canonical episode watch link or public channel join link."""
    try:
        url = urlsplit(value)
    except ValueError:
        return {}
    if url.scheme != "https":
        return {}

    video_id = ""
    if url.netloc in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        membership = YOUTUBE_CHANNEL_JOIN.fullmatch(url.path)
        if membership:
            return {"membershipUrl": f"https://www.youtube.com/channel/{membership[1]}/join"}
        if url.path == "/watch":
            ids = parse_qs(url.query, keep_blank_values=True).get("v", [])
            if len(ids) == 1:
                video_id = ids[0]
        elif url.path.startswith(("/embed/", "/shorts/")):
            video_id = url.path.split("/", 2)[2].removesuffix("/")
    elif url.netloc in {"youtube-nocookie.com", "www.youtube-nocookie.com"}:
        if url.path.startswith("/embed/"):
            video_id = url.path.removeprefix("/embed/")
    elif url.netloc == "youtu.be":
        video_id = url.path.removeprefix("/")
    if YOUTUBE_VIDEO_ID.fullmatch(video_id):
        return {"videoUrl": f"https://www.youtube.com/watch?v={video_id}"}
    return {}


def article_video_links(content: Tag) -> dict[str, str]:
    links = {}
    # Prefer the actual player over links elsewhere in the article.
    urls = [item["src"] for item in content.select("iframe[src]")]
    for script in content.select("script:not([src])"):
        urls.extend(YOUTUBE_EMBED_LITERAL.findall(script.string or ""))
    urls.extend(item["href"] for item in content.select("a[href]"))
    for url in urls:
        for key, value in youtube_links(url).items():
            links.setdefault(key, value)
    return links


def parse_episode(soup: BeautifulSoup, url: str, part: str = "1") -> tuple[dict, list[str]]:
    main = soup.select_one("main") or soup.select_one('[role="main"]')
    if main is None:
        raise CrawlError(f"No main element at {url}")
    title = main.select_one("h1")
    if title is None or not title.get_text(strip=True):
        raise CrawlError(f"Article title unavailable at {url}")
    content = main.select_one(".wp-block-post-content, .entry-content")
    restricted = main.select_one(
        ".post-password-form, input[name='post_password'], .pmpro_content_message, "
        ".mepr-unauthorized-message"
    ) is not None
    if content is None and not restricted:
        raise CrawlError(f"Article body selector did not match {url}")
    source = {"website": "IELTS TIME", "url": url}
    author = soup.select_one("meta[name='author'], .wp-block-post-author-name, a[rel~=author]")
    if author:
        value = author.get("content") or author.get_text(" ", strip=True)
        if value:
            source["author"] = value
    candidates = []
    if content is not None and not restricted:
        source.update(article_video_links(content))
        restricted = "membershipUrl" in source or any(
            MEMBERS_ONLY_NOTICE.search(block.get_text(" ", strip=True))
            for block in content.select("p, h2, h3")
        )
    if content is not None and not restricted:
        for item in content.select("audio[src], audio source[src], a[href]"):
            value = urljoin(url, item.get("src") or item["href"])
            if source_host(value) and (
                item.name in {"audio", "source"} or AUDIO_EXTENSION.search(urlsplit(value).path)
            ):
                candidates.append(value)
        blocks = transcript_blocks(content)
        restricted = bool(blocks) and re.fullmatch(
            r"(?:error:\s*)?content is protected\s*!*", " ".join(blocks), re.I
        ) is not None
    else:
        blocks = []
    if restricted:
        blocks = []
        candidates = []
        source.pop("videoUrl", None)
    status = "restricted" if restricted else ("available" if blocks else "missing")
    return {
        "slug": urlsplit(url).path.strip("/"),
        "title": title.get_text(" ", strip=True),
        "publishedAt": publication_date(soup),
        "category": f"Speaking Part {part}",
        "source": source,
        "audio": None,
        "transcriptStatus": status,
        "transcript": blocks,
    }, list(dict.fromkeys(candidates))


def validate(db: object) -> None:
    if not isinstance(db, dict) or db.get("version") != 1 or not isinstance(db.get("episodes"), list):
        raise ValueError("Expected an object with version 1 and an episodes array")
    urls = set()
    for record in db["episodes"]:
        if not isinstance(record, dict):
            raise ValueError("Episode must be an object")
        slug = record.get("slug")
        title = record.get("title")
        if not isinstance(slug, str) or not SLUG.fullmatch(slug):
            raise ValueError(f"Invalid episode slug: {slug}")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"Missing episode title: {slug}")
        source = record.get("source")
        if not isinstance(source, dict) or not isinstance(source.get("website"), str) or not source["website"].strip():
            raise ValueError(f"Missing source attribution: {slug}")
        url = source.get("url")
        if not https_url(url) or (
            source["website"] == "IELTS TIME"
            and (url != episode_url(url) or urlsplit(url).path != f"/{slug}/")
        ):
            raise ValueError(f"Invalid episode URL: {slug}")
        for field in ("videoUrl", "membershipUrl"):
            if field in source:
                value = source[field]
                if not isinstance(value, str) or youtube_links(value).get(field) != value:
                    raise ValueError(f"Invalid {field}: {slug}")
        if url in urls:
            raise ValueError(f"Duplicate episode URL: {url}")
        urls.add(url)
        if record.get("category") not in {f"Speaking Part {part}" for part in CATEGORIES}:
            raise ValueError(f"Invalid episode category: {slug}")
        published_at = record.get("publishedAt")
        if published_at is not None and (
            not isinstance(published_at, str) or date.fromisoformat(published_at).isoformat() != published_at
        ):
            raise ValueError(f"Invalid publication date: {slug}")
        status = record.get("transcriptStatus")
        transcript = record.get("transcript")
        if (
            status not in TRANSCRIPT_STATUSES or not isinstance(transcript, list)
            or any(not isinstance(block, str) or not block.strip() for block in transcript)
            or (status == "available") != bool(transcript)
        ):
            raise ValueError(f"Invalid transcript or status: {slug}")
        audio = record.get("audio")
        if audio is not None and (
            not isinstance(audio, dict) or not https_url(audio.get("url"))
            or (source["website"] == "IELTS TIME" and not source_host(audio["url"]))
        ):
            raise ValueError(f"Invalid audio URL: {slug}")
    skipped = db.get("skippedUrls", [])
    if not isinstance(skipped, list) or any(
        not isinstance(url, str) or url != episode_url(url) or url in urls
        for url in skipped
    ) or len(skipped) != len(set(skipped)):
        raise ValueError("Invalid or duplicate skipped URL")


def https_url(value: object) -> bool:
    if not isinstance(value, str) or re.search(r"[\s\\]", value):
        return False
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.hostname) and (
        parsed.username is None and parsed.password is None and not parsed.fragment
    )


def save(path: Path, db: dict) -> None:
    validate(db)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=".db-", delete=False
    ) as output:
        temporary = Path(output.name)
        try:
            json.dump(db, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def update(
    source: Source,
    db: dict,
    repair_limit: int = 0,
    parts: tuple[str, ...] = ("1",),
    limit: int | None = None,
    refresh_audio_limit: int = 0,
    refresh_audio_offset: int = 0,
) -> dict:
    source.load_robots()
    existing = {record["source"]["url"]: record for record in db["episodes"]}
    skipped = set(db.get("skippedUrls", []))
    if refresh_audio_limit:
        targets = [
            (url, part) for part in parts for url, record in existing.items()
            if record["source"]["website"] == "IELTS TIME"
            and record["category"] == f"Speaking Part {part}"
            and record["transcriptStatus"] == "available"
            and record["audio"] is None
        ]
        if targets:
            start = refresh_audio_offset % len(targets)
            targets = (targets[start:] + targets[:start])[:refresh_audio_limit]
    elif repair_limit:
        targets = [
            (url, part) for part in parts for url, record in existing.items()
            if record["source"]["website"] == "IELTS TIME"
            and record["category"] == f"Speaking Part {part}"
            and record["transcriptStatus"] in {"missing", "needs-review"}
        ][:repair_limit]
    else:
        discovered = {}
        for part in parts:
            for url in article_urls(source, CATEGORIES[part]):
                if url not in existing and url not in skipped:
                    discovered.setdefault(url, part)
        targets = list(discovered.items())[:limit]
    logging.info("Found %d episode(s) to process", len(targets))
    added = []
    skipped_count = 0
    for url, part in targets:
        record, candidates = parse_episode(source.html(url), url, part)
        previous = existing.get(url)
        if record["transcriptStatus"] == "restricted":
            if not previous:
                skipped.add(url)
            skipped_count += 1
            logging.info("%s | skipped restricted or members-only article", record["slug"])
            continue
        if refresh_audio_limit:
            audio = source.audio(candidates)
            media_links = {
                key: record["source"][key] for key in ("videoUrl", "membershipUrl")
                if key in record["source"]
            }
            existing[url] = {
                **previous,
                "audio": audio,
                "source": {**previous["source"], **media_links},
            }
            logging.info("%s | refreshed audio=%s", previous["slug"], "available" if audio else "unavailable")
            continue
        if previous:
            if record["transcriptStatus"] != "available":
                continue
            record["audio"] = previous["audio"] or source.audio(candidates)
            record["source"] = {**previous["source"], **record["source"]}
            record["publishedAt"] = record["publishedAt"] or previous["publishedAt"]
            existing[url] = {**previous, **record}
        else:
            record["audio"] = source.audio(candidates)
            added.append(record)
        logging.info("%s | transcript=%s", record["slug"], record["transcriptStatus"])
    logging.info("New episodes: %d, skipped restricted or members-only: %d", len(added), skipped_count)
    revised = {**db, "episodes": [*added, *existing.values()]}
    if skipped or "skippedUrls" in db:
        revised["skippedUrls"] = sorted(skipped)
    return revised


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DATABASE, help="Existing database path")
    parser.add_argument("--part", choices=(*CATEGORIES, "all"), default="1", help="Speaking Part to crawl")
    parser.add_argument("--limit", type=int, help="Process at most this many new articles")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--validate", action="store_true", help="Validate locally without network access")
    modes.add_argument("--repair-missing", metavar="LIMIT", type=int, help="Revisit up to LIMIT missing transcripts")
    modes.add_argument("--refresh-audio", metavar="LIMIT", type=int,
                       help="Revisit up to LIMIT available transcripts without direct audio")
    parser.add_argument("--audio-offset", type=int, default=0,
                        help="Starting position for --refresh-audio, wrapping at the end")
    args = parser.parse_args()
    if args.repair_missing is not None and args.repair_missing < 1:
        parser.error("--repair-missing must be a positive integer")
    if args.refresh_audio is not None and args.refresh_audio < 1:
        parser.error("--refresh-audio must be a positive integer")
    if args.audio_offset < 0 or (args.audio_offset and args.refresh_audio is None):
        parser.error("--audio-offset requires --refresh-audio and must be nonnegative")
    if args.limit is not None and (
        args.limit < 1 or args.validate or args.repair_missing is not None or args.refresh_audio is not None
    ):
        parser.error("--limit must be positive and is for new article crawls only")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        db = json.loads(args.db.read_text(encoding="utf-8"))
        validate(db)
        if args.validate:
            logging.info("Valid database: %d episodes", len(db["episodes"]))
            return 0
        with requests.Session() as session:
            parts = tuple(CATEGORIES) if args.part == "all" else (args.part,)
            revised = update(Source(session), db, args.repair_missing or 0, parts, args.limit,
                             args.refresh_audio or 0, args.audio_offset)
        if revised == db:
            logging.info("No changes to %s", args.db)
        else:
            save(args.db, revised)
            logging.info("Saved %d episodes to %s", len(revised["episodes"]), args.db)
    except (CrawlError, OSError, ValueError, requests.RequestException) as exc:
        logging.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
