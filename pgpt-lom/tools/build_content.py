#!/usr/bin/env python3
"""Builds the editable parts of index.html from the data files in content/.

  content/news.json       -> the latest news cards on the home page            (marker: cms:news)
  content/documents.json  -> the documents list on the home page + Documents page (markers: cms:docs-home, cms:docs-page)
  title_en / text_en ...  -> English texts, injected into the page's translation table (marker: cms:en)

Then it refreshes the per-page SEO pages and sitemap.xml (tools/build_seo_pages.py).
Everything between the  <!-- cms:... -->  markers in index.html is generated: edit the JSON files, not those blocks.

Run from the pgpt-lom folder:   python tools/build_content.py            (add --check to only verify nothing would change)
"""
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME_NEWS = 4
MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"]


def esc(s):
    return html.escape(str(s), quote=False)


def attr(s):
    return html.escape(str(s), quote=True)


def load(name):
    return json.loads((ROOT / "content" / name).read_text(encoding="utf-8"))["items"]


def collapse(s):
    return re.sub(r"\s+", " ", s).strip()


def date_label(item):
    if item.get("date_label"):
        return item["date_label"]
    d = date.fromisoformat(item["published"])
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def news_html(items, eol):
    items = sorted(items, key=lambda i: i["published"], reverse=True)[:HOME_NEWS]
    rows = []
    for i in items:
        if not (ROOT / i["image"]).exists():
            print(f"WARNING: image not found: {i['image']}", file=sys.stderr)
        rows.append(
            f'    <article class="post"><img loading="lazy" src="{attr(i["image"])}" alt="{attr(i.get("alt", ""))}"><div>'
            f'<time>{esc(date_label(i))}</time><h3>{esc(i["title"])}</h3><p>{esc(i["text"])}</p></div></article>')
    return eol + eol.join(rows) + eol + "    "


def docs_html(items, eol, home):
    rows = []
    for i in items:
        title = (i.get("short_title") or i["title"]) if home else i["title"]
        rows.append(f'<a href="{attr(i["url"])}" target="_blank" rel="noopener">{esc(title)}</a>')
    if home:
        rows.append('<a href="#/dokumenti">📚 Всички документи →</a>')
        return eol + eol.join("    " + r for r in rows) + eol + "   "
    return eol + eol.join(rows) + eol


def en_js(news, docs):
    pairs = {}
    for i in news:
        if i.get("title_en"):
            pairs[collapse(i["title"])] = i["title_en"]
        if i.get("text_en"):
            pairs[collapse(i["text"])] = i["text_en"]
        if i.get("date_label_en") and i.get("date_label"):
            pairs[collapse(i["date_label"])] = i["date_label_en"]
    for i in docs:
        if i.get("title_en"):
            pairs[collapse(i["title"])] = i["title_en"]
        if i.get("short_title") and i.get("short_title_en"):
            pairs[collapse(i["short_title"])] = i["short_title_en"]
    return "".join(f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}, " for k, v in pairs.items())


def replace_block(src, name, make):
    pat = re.compile(r"(<!-- cms:%s -->|/\*cms:%s\*/)(.*?)(<!-- /cms:%s -->|/\*/cms:%s\*/)" % ((re.escape(name),) * 4), re.S)
    m = pat.search(src)
    if not m:
        sys.exit(f"marker cms:{name} not found in index.html")
    eol = "\r\n" if "\r\n" in m.group(2) or (not m.group(2) and "\r\n" in src[max(0, m.start() - 200):m.start()]) else "\n"
    return src[:m.start(2)] + make(eol) + src[m.end(2):]


def main():
    check = "--check" in sys.argv
    news, docs = load("news.json"), load("documents.json")
    path = ROOT / "index.html"
    with open(path, encoding="utf-8", newline="") as fh:   # newline="" keeps the file's mixed CRLF / LF endings intact
        src = fh.read()
    new = replace_block(src, "news", lambda e: news_html(news, e))
    new = replace_block(new, "docs-home", lambda e: docs_html(docs, e, True))
    new = replace_block(new, "docs-page", lambda e: docs_html(docs, e, False))
    new = replace_block(new, "en", lambda e: en_js(news, docs))
    if check:
        print("index.html is up to date" if new == src else "index.html would change")
        sys.exit(0 if new == src else 1)
    if new != src:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(new)
    print(f"news: {len(news)} items ({min(HOME_NEWS, len(news))} on the home page); documents: {len(docs)}; index.html {'updated' if new != src else 'unchanged'}")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_seo_pages
    build_seo_pages.main()


if __name__ == "__main__":
    main()
