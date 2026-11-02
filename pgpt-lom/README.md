# PGPT – Lom (demo website)

A personal demo of a website for the Vocational High School of Production Technologies (PGPT) in Lom, Bulgaria. **This is not the official school website**; it is a project prepared for review.

Live demo: https://dimitarbeograd-qa.github.io/portfolio-demos/pgpt-lom/

## What it is

A single-file website (one `index.html`, all pictures embedded, works offline) with:

- pages for the programmes, news, gallery, documents and European projects;
- Bulgarian and English versions, font size controls and a high-contrast mode;
- accessibility work in the spirit of WCAG 2.1 / EN 301 549: skip link, visible focus, correct page language, screen-reader announcements of page changes;
- a back button that returns to the exact place you left (scroll position and open panel);
- a spinning 3D volleyball in the Sport panel, drawn in real time on a canvas (no libraries, no pictures: 18 panels in 6 sections of 3 strips, built from geometry).

Stack: vanilla HTML, CSS and JavaScript.

## Notes

- The file is large (about 60 MB) because every picture is embedded so the page works without a connection. Please give it a moment to load.
- Content is in Bulgarian with English translations of the main parts.
