# SU "Dimitar Marinov" – Lom (redesign demo)

A personal redesign demo for the website of SU "Dimitar Marinov" in Lom, Bulgaria. **This is not the official school website**; it is a project prepared for review. The content (text, news, team, documents and photos) is taken from the school's public site, https://sudm-lom.bg/.

Live demo: https://dimitarbeograd-qa.github.io/portfolio-demos/sudm-lom/

## What it is

A static multi-page website (48 pages, plain HTML, CSS and JS, no database):

- home page with the school building, quick links, the patron, latest news, admissions, exams, projects and contacts;
- about the school (mission and vision, patron, history, team, public council, personal data), admissions for grades 1, 5 and 8, documents with search, projects and national programmes, exams, contacts with opening hours;
- news with 24 full posts, search and categories;
- drop-down menus, site search (`Ctrl+K`), contact and search dialogs, light and dark theme (starts light), mobile menu, keyboard focus states, reduced-motion support.

Documents (PDF and others) still link to the original site.

## How it is built

`src/pages.json` and `src/news.json` hold the content; `src/build.py` generates every page:

```
python3 src/build.py
```

Set `SITE_URL` and `BASE_PATH` for canonical links when hosting in a sub-folder. Open `index.html` directly in a browser to view it locally; links between pages also work without a server.

## Checked

Every page was opened at 1366, 820 and 390 px wide: no horizontal scroll and no console errors; internal links and images resolve. Tested in Chromium only.
