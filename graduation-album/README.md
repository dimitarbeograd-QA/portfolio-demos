# Graduation album

A digital graduation album for a whole class year, with one chapter for every grade from 1 to 12. Each chapter holds a class teacher, a short memory of the year and photos with captions. It is a single static page with no build step and no external requests. Content is in Bulgarian.

**Live demo:** https://dimitarbeograd-qa.github.io/portfolio-demos/graduation-album/

The demo opens with generated placeholder pictures (marked "ДЕМО"). Use "Празен албум" to start empty and add your own photos.

## Features

- Cover with a gold-foil title, a table of contents and 12 chapters in three stages (primary, lower secondary, upper secondary)
- Roman numerals for grades, a gilt double frame on every page, photos mounted in mats
- Edit mode: add many photos at once, write captions, reorder and remove photos (removal asks for a second tap), write a memory per grade
- Full-screen photo viewer with keyboard (arrow keys, Escape) and touch controls
- Light and dark theme, following the system setting with a manual switch
- Print to PDF: the album is laid out as a cover plus one page per grade
- Export and import the whole album as one JSON file, so it can be backed up or moved between devices
- Works at phone width, respects reduced-motion settings

## Privacy

Nothing is uploaded. Photos are resized to about 1000 px, stored in the visitor's own browser (IndexedDB) and never sent anywhere. Clearing site data removes the album, so use "Експорт" to keep a copy.

## How it works

- `index.html` holds the markup, styles and script. State is one object (`school`, `year`, `ch[grade] = {teacher, memory, photos[]}`) that is rendered by small DOM helpers.
- The same page also runs as a published Claude artifact. There it saves by republishing itself instead of using IndexedDB; the code detects which mode it is in at start-up.
- Placeholder pictures are small SVG scenes generated in script, so the repo contains no stock photos.

## Stack

Vanilla HTML, CSS and JavaScript, IndexedDB, Canvas (for resizing photos). No framework and no libraries.

## Fonts

Self-hosted, SIL Open Font License 1.1 (see `fonts/LICENSE.txt`): Playfair Display, EB Garamond and Jost, with Latin and Cyrillic subsets.

## Testing status

Checked by hand in Chromium at 1280 px and 390 px, in light and dark theme, with no console errors and no horizontal scroll. A scripted check covered rendering, editing, saving to IndexedDB, reloading, export and the print layout. There are no automated tests in the repository yet.
