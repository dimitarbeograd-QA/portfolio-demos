# Lom 3D

An interactive 3D model of the town of Lom (Bulgaria) that runs in a phone or desktop browser. One self-contained `index.html` (Three.js r128), no build tools needed to view it. The interface is in Bulgarian.

**Live demo:** https://dimitarbeograd-qa.github.io/portfolio-demos/lom-3d/

## What is in it

- About 9,900 buildings with procedural walls, gable and flat roofs, rooftop details (parapets, stair boxes, PV rows), and a tap-to-inspect card per building
- Real terrain from the Copernicus DEM (30 m), so streets, buildings, water and trees follow the hills above the Danube
- Satellite ground from Sentinel-2 (10 m), a procedural close-up ground texture, and a crisp procedural Danube drawn from a water mask
- Roads, rails, water, trees and the 110 kV grid from OpenStreetMap
- Day/night slider, layer toggles, and Google-Maps-style touch controls (one finger pans, two fingers pinch and tilt, double tap zooms)

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Roads, rails, water, landuse, power, some buildings | OpenStreetMap contributors | ODbL |
| Building footprints | Microsoft ML Building Footprints via Overture Maps | ODbL |
| Satellite image, vegetation and water masks | Copernicus Sentinel-2 L2A, 26 July 2025 (contains modified Copernicus Sentinel data 2025) | Free and open |
| Terrain heights | Copernicus DEM GLO-30, © DLR e.V. and Airbus Defence and Space GmbH, provided under COPERNICUS by the EU and ESA | Free and open |

This public version deliberately does **not** include cadastral data (building types, floor counts, addresses, parcel boundaries) from the Bulgarian Agency for Geodesy, Cartography and Cadastre, because the terms of those open data files are unclear.

## Limits

- Facades, floor counts and roof shapes are estimated from building type and size, not surveyed.
- The ground image is 10 m per pixel; close-up detail is procedural, not photographic.
- The terrain is a 30 m model and shows the general shape, not steps or retaining walls.
- The page is about 2 MB and takes a few seconds to build the scene.

## Rebuild

```
python3 build_public.py
```

`build_public.py` reads `src_template.html` and the files in `data/` and writes `index.html`. The scripts in `tools/` show how the data files were produced (`process.py` for OpenStreetMap, `ms.py` for the footprints, `sat2.py` for the satellite crop and masks, `dem.py` for the terrain).
