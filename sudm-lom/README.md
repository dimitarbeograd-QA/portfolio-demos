# SU "Dimitar Marinov" – Lom (redesign demo)

A personal redesign demo for the website of SU "Dimitar Marinov" in Lom, Bulgaria. **This is not the official school website**; it is a project prepared for review. The content (text, news, team, documents and photos) is taken from the school's public site, https://sudm-lom.bg/.

Live demo: https://dimitarbeograd-qa.github.io/portfolio-demos/sudm-lom/

## What it is

A static multi-page website (91 pages, plain HTML, CSS and JS, no database):

- home page with the school building, quick links, the patron, latest news, admissions, exams, projects and contacts;
- about the school (mission and vision, patron, history, team, public council, personal data), admissions for grades 1, 5 and 8, documents with search, projects and national programmes, exams, contacts with opening hours;
- news with 60 full posts (up to 4 photos each, video where the original has one), search, categories and "show more";
- detail pages of the projects and national programmes, carried over so they no longer depend on the old site;
- design: fixed left sidebar with an accordion menu (a slide-in drawer on phones), a full-height duotone photo hero with frosted-glass cards, a bento grid of mixed-size tiles, Geologica + Golos Text, light theme first with a plum-black dark theme;
- site search (`Ctrl+K`), contact and search dialogs, keyboard focus states, reduced-motion support.

Documents (PDF and others) still link to the original site.

## How it is built

`src/pages.json` and `src/news.json` hold the content; `src/build.py` generates every page:

```
python3 src/build.py
```

Set `SITE_URL` and `BASE_PATH` for canonical links when hosting in a sub-folder. Open `index.html` directly in a browser to view it locally; links between pages also work without a server.

## Checked

Every page was opened at 1366, 820 and 390 px wide: no horizontal scroll and no console errors; internal links and images resolve. The code was also reviewed for accessibility (WCAG 2.1 AA), cross-browser support, performance/SEO and fidelity against the old site, and the findings were fixed. Tested in Chromium only (not in Firefox or Safari).

Known limits: documents (PDF and others) still link to the original site; news older than the latest 60 posts stay in the old archive; the street name is written as "Дунавска" (the old contact page says "Динавска", the old personal-data page says "Дунавска") and should be confirmed with the school.
