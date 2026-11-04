"""Static quality checks for the PGPT-Lom site. Pure standard library: no install needed.

Run from the pgpt-lom folder:    python -m unittest discover -s tests -v
"""
import json
import re
import subprocess
import sys
import unittest
from collections import Counter
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://dimitarbeograd-qa.github.io/portfolio-demos/pgpt-lom/"


def read(p):
    return Path(p).read_text(encoding="utf-8")


INDEX = read(ROOT / "index.html")
ROUTES = re.findall(r'<section class="page" id="page-([a-z0-9-]+)"', INDEX)


class Tags(HTMLParser):
    """Collects every start tag with its attributes (and the text of <title>)."""

    def __init__(self):
        super().__init__()
        self.tags = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
        self._in_title = tag == "title"

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def parse(src):
    p = Tags()
    p.feed(src)
    return p


class Home(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = parse(INDEX)

    def tags(self, name):
        return [a for t, a in self.p.tags if t == name]

    def test_document_basics(self):
        self.assertTrue(INDEX.lstrip().lower().startswith("<!doctype html"))
        self.assertEqual(self.tags("html")[0].get("lang"), "bg")
        self.assertTrue(self.p.title.strip())
        desc = [a for a in self.tags("meta") if a.get("name") == "description"]
        self.assertEqual(len(desc), 1)
        self.assertTrue(80 <= len(desc[0]["content"]) <= 170, len(desc[0]["content"]))

    def test_zoom_is_not_blocked(self):
        vp = [a for a in self.tags("meta") if a.get("name") == "viewport"][0]["content"]
        self.assertNotIn("user-scalable=no", vp.replace(" ", ""))
        self.assertNotIn("maximum-scale=1", vp.replace(" ", ""))

    def test_unique_ids(self):
        ids = [a["id"] for _, a in self.p.tags if a.get("id")]
        dup = [k for k, v in Counter(ids).items() if v > 1]
        self.assertEqual(dup, [])

    def test_images_have_alt_attribute(self):
        missing = [a.get("src", "")[:60] for a in self.tags("img") if "alt" not in a]
        self.assertEqual(missing, [])

    def test_buttons_and_links_have_a_name(self):
        # <a href> / <button> need visible text, aria-label, title or an image with alt
        bad = []
        markup = re.sub(r"<(script|style)\b.*?</\1>", "", INDEX, flags=re.S)  # UI built in JavaScript is labelled at run time
        for m in re.finditer(r"<(a|button)\b([^>]*)>(.*?)</\1>", markup, re.S):
            tag, attrs, inner = m.groups()
            if tag == "a" and "href" not in attrs:
                continue
            text = re.sub(r"<(?!img)[^>]+>", "", inner).strip()
            named = text or re.search(r"aria-label=|aria-labelledby=|title=|<img[^>]+alt=\"[^\"]+\"", attrs + inner)
            if not named:
                bad.append((tag, attrs.strip()[:70]))
        self.assertEqual(bad, [])

    def test_external_new_tab_links_are_safe(self):
        bad = [a.get("href", "")[:70] for a in self.tags("a") if a.get("target") == "_blank" and "noopener" not in (a.get("rel") or "")]
        self.assertEqual(bad, [])

    def test_all_referenced_images_exist(self):
        refs = set(re.findall(r"""(?<![\w/.-])img/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp|svg)""", INDEX))
        missing = sorted(r for r in refs if not (ROOT / r).exists())
        self.assertEqual(missing, [])

    def test_internal_route_links_resolve(self):
        links = set(re.findall(r'href="#/([a-z0-9-]+)"', INDEX))
        missing = sorted(links - set(ROUTES) - {""})
        self.assertEqual(missing, [])

    def test_anchor_links_resolve(self):
        ids = {a["id"] for _, a in self.p.tags if a.get("id")}
        # "#more" is the "Още" drop-down trigger (handled by JavaScript, not a real target)
        missing = sorted({h for h in re.findall(r'href="#([A-Za-z][\w-]*)"', INDEX) if h not in ids} - {"more"})
        self.assertEqual(missing, [])

    def test_json_ld_is_valid(self):
        blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', INDEX, re.S)
        self.assertGreaterEqual(len(blocks), 1)
        for b in blocks:
            data = json.loads(b)
            self.assertEqual(data["@context"], "https://schema.org")

    def test_open_graph_image_exists(self):
        og = [a for a in self.tags("meta") if a.get("property") == "og:image"][0]["content"]
        self.assertTrue(og.startswith(BASE))
        self.assertTrue((ROOT / og[len(BASE):]).exists())


class SeoPages(unittest.TestCase):
    def test_every_subpage_has_a_page_and_sitemap_entry(self):
        sitemap = read(ROOT / "sitemap.xml")
        self.assertGreaterEqual(len(ROUTES), 20)
        for r in ROUTES:
            f = ROOT / r / "index.html"
            self.assertTrue(f.exists(), f"missing {r}/index.html")
            self.assertIn(f"<loc>{BASE}{r}/</loc>", sitemap, r)
        self.assertIn(f"<loc>{BASE}</loc>", sitemap)

    def test_pages_have_unique_titles_descriptions_and_canonical(self):
        titles, descs = Counter(), Counter()
        for r in ROUTES:
            src = read(ROOT / r / "index.html")
            p = parse(src)
            titles[p.title.strip()] += 1
            d = re.search(r'name="description" content="([^"]*)"', src).group(1)
            descs[d] += 1
            self.assertIn(f'<link rel="canonical" href="{BASE}{r}/">', src, r)
            self.assertLessEqual(len(d), 200, r)
            self.assertEqual(len(re.findall(r"<h1>", src)), 1, r)
            for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', src, re.S):
                json.loads(m.group(1))
        self.assertEqual([t for t, n in titles.items() if n > 1], [])
        self.assertEqual([d for d, n in descs.items() if n > 1], [])

    def test_sitemap_has_no_stale_urls(self):
        for loc in re.findall(r"<loc>([^<]+)</loc>", read(ROOT / "sitemap.xml")):
            rel = loc[len(BASE):].strip("/")
            self.assertTrue(rel == "" or rel in ROUTES, loc)


class Content(unittest.TestCase):
    def test_news_items(self):
        items = json.loads(read(ROOT / "content" / "news.json"))["items"]
        self.assertTrue(items)
        for i in items:
            for k in ("published", "title", "text", "image"):
                self.assertTrue(i.get(k), f"news item missing {k}: {i.get('title')}")
            date.fromisoformat(i["published"])
            self.assertTrue((ROOT / i["image"]).exists(), i["image"])

    def test_documents(self):
        items = json.loads(read(ROOT / "content" / "documents.json"))["items"]
        self.assertTrue(items)
        urls = [i["url"] for i in items]
        for i in items:
            self.assertTrue(i.get("title", "").strip())
            self.assertRegex(i["url"], r"^https?://")
        self.assertEqual(len(urls), len(set(urls)), "duplicate document URL")

    def test_generated_blocks_are_up_to_date(self):
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_content.py"), "--check"], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, "index.html is stale: run  python tools/build_content.py\n" + r.stdout + r.stderr)


class SpecialtyPages(unittest.TestCase):
    def test_both_languages_present(self):
        for r in [x for x in ROUTES if x.startswith("spec-")]:
            sec = re.search(r'<section class="page" id="page-%s".*?</section>' % re.escape(r), INDEX, re.S).group(0)
            self.assertIn('data-lang="bg"', sec, r)
            self.assertIn('data-lang="en"', sec, r)


if __name__ == "__main__":
    unittest.main(verbosity=2)
