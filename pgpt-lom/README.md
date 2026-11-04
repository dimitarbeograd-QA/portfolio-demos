# PGPT – Lom (demo website)

A personal demo of a website for the Vocational High School of Production Technologies (PGPT) in Lom, Bulgaria. **This is not the official school website**; it is a project prepared for review.

Live demo: https://dimitarbeograd-qa.github.io/portfolio-demos/pgpt-lom/

## What it is

A lightweight website (one `index.html` plus an `img/` folder of optimized pictures, loaded lazily) with:

- pages for the programmes, news, gallery, documents and European projects;
- Bulgarian and English versions, font size controls and a high-contrast mode;
- accessibility work in the spirit of WCAG 2.1 / EN 301 549: skip link, visible focus, correct page language, screen-reader announcements of page changes;
- a back button that returns to the exact place you left (scroll position and open panel);
- an interactive Android simulator: the small phone next to the laptop (in the STEM article) opens a full-screen phone with lock screen, home screen, quick settings, recent apps and working Settings, Phone, Messages, Camera, Gallery, Calculator, Clock, Calendar, Notes and a Browser (Wi-Fi / airplane mode really switch it offline). It lives in a Shadow DOM block (`aphone-css` / `aphone-js`), loads nothing from outside, and is bilingual (BG / EN);
- a spinning 3D volleyball in the Sport panel, drawn in real time on a canvas (no libraries, no pictures: 18 panels in 6 sections of 3 strips, built from geometry).

Stack: vanilla HTML, CSS and JavaScript.

## Notes

- The file is large (about 60 MB) because every picture is embedded so the page works without a connection. Please give it a moment to load.
- Content is in Bulgarian with English translations of the main parts.
