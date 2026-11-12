import copy
import unittest
from unittest.mock import patch

from bs4 import BeautifulSoup

import crawl_ielts_part1 as crawler


def episode(slug, *, part="1", status="available", audio=None):
    return {
        "slug": slug,
        "title": "Original title",
        "publishedAt": "2025-01-01",
        "category": f"Speaking Part {part}",
        "source": {"website": "IELTS TIME", "url": f"https://theieltstime.com/{slug}/"},
        "audio": audio,
        "transcriptStatus": status,
        "transcript": ["Original transcript."] if status == "available" else [],
    }


class FakeSource:
    def __init__(self, pages=None):
        self.pages = pages or {}
        self.visited = []
        self.robots_loaded = False

    def load_robots(self):
        self.robots_loaded = True

    def html(self, url):
        self.visited.append(url)
        body = self.pages.get(url, '<p>Updated transcript should not replace the original.</p>')
        return BeautifulSoup(
            f'<main><h1>Updated title</h1><div class="entry-content">{body}</div></main>',
            "html.parser",
        )

    def audio(self, candidates):
        return {"url": candidates[0]} if candidates else None


class AudioRefreshTests(unittest.TestCase):
    def test_adds_verified_audio_without_replacing_saved_text_or_metadata(self):
        original = episode("topic")
        original["source"]["author"] = "Original author"
        database = {"version": 1, "episodes": [original]}
        snapshot = copy.deepcopy(database)
        url = original["source"]["url"]
        audio = "https://theieltstime.com/wp-content/uploads/topic.mp3"
        source = FakeSource({url: f'<p>New text.</p><audio src="{audio}"></audio>'})

        result = crawler.update(source, database, refresh_audio_limit=10)

        expected = {**original, "audio": {"url": audio}}
        self.assertEqual(result["episodes"], [expected])
        self.assertEqual(database, snapshot)
        self.assertTrue(source.robots_loaded)
        crawler.validate(result)

    def test_discovers_canonical_video_without_replacing_transcript(self):
        original = episode("topic")
        source = FakeSource({original["source"]["url"]: (
            '<iframe src="https://www.youtube.com/embed/abcdefghijk?feature=oembed"></iframe>'
        )})

        result = crawler.update(source, {"version": 1, "episodes": [original]}, refresh_audio_limit=10)

        updated = result["episodes"][0]
        self.assertEqual(updated["source"]["videoUrl"], "https://www.youtube.com/watch?v=abcdefghijk")
        self.assertEqual(updated["transcript"], original["transcript"])
        self.assertIsNone(updated["audio"])
        crawler.validate(result)

    def test_only_visits_matching_available_audio_null_lessons_up_to_limit(self):
        records = [
            episode("part-two", part="2"),
            episode("has-audio", audio={"url": "https://theieltstime.com/audio.mp3"}),
            episode("missing-text", status="missing"),
            episode("eligible-one"),
            episode("eligible-two"),
        ]
        source = FakeSource()
        with patch.object(crawler, "article_urls", side_effect=AssertionError("Category crawl was unexpected")):
            crawler.update(source, {"version": 1, "episodes": records}, refresh_audio_limit=1)

        self.assertEqual(source.visited, ["https://theieltstime.com/eligible-one/"])

    def test_restricted_source_keeps_saved_lesson_untouched(self):
        original = episode("topic")
        database = {"version": 1, "episodes": [original]}
        source = FakeSource({original["source"]["url"]: '<p>This video is for members only.</p>'})
        with patch.object(source, "audio", side_effect=AssertionError("Restricted audio was requested")):
            result = crawler.update(source, database, refresh_audio_limit=10)

        self.assertEqual(result, database)

    def test_no_new_media_leaves_saved_database_equal(self):
        database = {"version": 1, "episodes": [episode("topic")]}

        result = crawler.update(FakeSource(), database, refresh_audio_limit=10)

        self.assertEqual(result, database)


if __name__ == "__main__":
    unittest.main()
