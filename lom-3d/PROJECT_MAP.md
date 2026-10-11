# Lom 3D – карта на проекта (за AI агенти: Gemini, Jules, Copilot)

Този файл е кратка карта на проекта, за да не се чете целият `index.html` (около 6,7 MB, почти цялото е вградени данни). **Работи се само по `src_template.html` и `build_public.py`.** Данните са в `data/`, вграждат се при build.

## 1. Файлове

| Файл | Какво е |
|---|---|
| `src_template.html` | Целият код: HTML, CSS, JS (Three.js r128 от CDN). 1464 реда. Съдържа плейсхолдъри `__DATA__`, `__VEG__`, `__DEM__`, `__DEM2__`, `__WM__`, `__SAT__`, `__SATO__`, `__SR__`, `__CLS__`, `__CLS2__`, `__OUT__`, `__PAR__`. |
| `build_public.py` | Замества плейсхолдърите с файловете от `data/` и пише `index.html`. Пускане: `python3 build_public.py`. |
| `index.html` | Генериран. Не се редактира на ръка. |
| `data/data.json` | Градът (виж т. 3). |
| `data/outer.json` | Селата и пътищата в Община Лом извън града. |
| `data/dem.b64`, `data/dem2.b64` | Височини (base64): 30 м решетка за града, 60 м за общината. |
| `data/sat.jpg`, `data/sr_local.jpg`, `data/sat_outer.jpg` | Sentinel-2 за града (10 м), AI-изострен център (SEN2SR), снимка на общината (12,5 м). |
| `data/water_mask.png`, `data/veg.b64` | Маска на водата и растителност от Sentinel-2. |
| `data/cls_a.png`, `data/cls_b.png` | Карта на културите по нивите: cls_a = R вода, G стърнище/гола земя, B слънчоглед; cls_b = царевица. 1760×700, 25 м/пиксел. |
| `tools/` | Скриптове, с които са направени данните (Python, Overture CLI, Colab за SEN2SR). |

## 2. Координати и единици (най-честата причина за грешки)

- Локални метри. Начало: LAT0=43.8167, LON0=23.2333. `KX=111320·cos(LAT0)`, `KY=110574`.
- **x** = на изток, **y** = на север, и в Three.js сцената е `(x, височина, −y)`. Тоест сцената z = −y.
- Координатите в `data.json` и `outer.json` са в **дециметри** (цели числа). `pts(p)` ги дели на 10. `polyArea` очаква дециметри.
- `hAt(x, y)` = височина на терена в метри над нивото на Дунав. `nAt(x, y)` = нормала.
- Вътрешна зона за детайлна снимка и вода: `SB=[-4000,4000,-4600,4600]`. Цяла община: `OB=[-22500,21500,-12500,4960]`.

## 3. Формат на данните

`data.json`: `origin`, `bounds`, `buildings` (`{id,p:[x,y,…],t}`), `roads` (`{c:клас,w:ширина м,p}`), `rails`, `landuse` (`{k,p}`), `water`, `streams`, `danube`, `power`, `ms` (контури на Microsoft ML, всеки е масив от x,y), `poi` (`[x,y,категория_индекс,име,адрес,тип]`), `poig` (имена на групите).
`outer.json`: `cells` (ключ `"i,j"`, центърът на клетката е `(i·1000+500, j·1000+500)` м; стойност = списък контури на сгради, всеки е масив x,y в дециметри) и `roads`.

## 4. Карта на `src_template.html` (редове)

| Редове | Секция | Функции |
|---|---|---|
| 126–141 | helpers | rnd, mulberry, pts, polyArea, shapeOf, col |
| 142–156 | renderer / scene | — |
| 157–209 | terrain: Copernicus DEM GLO-30 (30 m grid, metres above the Danube level) | hR, hR2, hOuter, hAt, nAt, terrainGeo |
| 210–308 | ground layers (vertex-coloured, drawn in order without depth writes; draped over the terrain) | Acc, d2, roadTex, addPoly, addRibbon |
| 309–394 | satellite (Copernicus Sentinel-2, 10 m, drawn under the roads) | — |
| 395–439 | the whole municipality: coarse Sentinel-2 (12.5 m) on a 100 m terrain, drawn under the detailed city layers | — |
| 440–481 | crisp procedural water (mask from Sentinel-2 NDWI; ripples are drawn per pixel so they stay sharp at any zoom) | inWater |
| 482–499 | AI-sharpened centre (SEN2SR super-resolution of Sentinel-2, ~2.5 m/px; invented detail, labelled as such) | — |
| 500–819 | buildings | cv, grain, glass, blank, rr, win, winLit, plaster, facadeTex, flatTex, tileTex, wallMat, roofMat, flatMat |
| 820–908 | rooftop detail on large flat roofs: parapet, stair/lift boxes, vents, AC units, PV rows (own procedural design | addBox, roofDetail, baseZ |
| 909–961 | the rest of the town: Microsoft ML building footprints (ODbL) via Overture, merged into a few meshes | Batch, batchFor |
| 962–1019 | village buildings (Overture: Microsoft ML + OSM footprints), 1 km cells built lazily as the camera comes near | outStart, outStep, outUpdate |
| 1020–1053 | trees | inPoly, nearBuilding, isGreen |
| 1054–1108 | foliage: crowns built from several displaced leaf clusters, with a procedural leaf pattern (light tips, dark g | crownGeometry, leafMat |
| 1109–1150 | riverside vegetation from the satellite colours: dark green -> dense riparian forest, light green -> shrubs an | shoreVeg |
| 1151–1198 | 110 kV grid (from OpenStreetMap) | — |
| 1199–1231 | places: businesses and institutions (Overture Maps Places, CDLA-Permissive-2.0) | roofAt, poiScale, poiIn |
| 1232–1243 | camera | — |
| 1244–1269 | parcel boundaries (АГКК open data) | — |
| 1270–1300 | time of day | setHour, placeSun |
| 1301–1464 | UI | setMenu, zoomBy, groundHit, zoomToPoint, unsel, clearSel, resize, loop |

## 5. Как е устроено (накратко)

- **Терен:** `terrainGeo(x0,x1,y0,y1,step,lift,shade,uvB)` прави мрежа по `hAt`. Вътре 30 м решетка, навън груба 100 м (`hOuter`), със смесване на ръба.
- **Земя (слоеве):** `outMesh` (общината, `renderOrder 2.2`) → `satMesh` (града, 2.5) → вода `waterSurf` (2.7) → растителност (3). Слоевете нямат depthWrite, затова редът е важен.
- **Шейдъри:** `satMat` (град), `outMat` (община), `waterMat`, `wallMat` (фасади с паралакс). Общият GLSL за култури е в `CROP_GLSL` (`cropShade`).
- **Сгради:** фасадите са рисувани на canvas (`DRAW`, `facadeTex`), UV през `WALL_UV`. Селските сгради се строят на клетки по 1 км, когато камерата е на по-малко от 2,6 км (`outStep`, `outUpdate`).
- **Дървета:** `crownGeometry`, `leafMat`.
- **Производителност:** рендерът е „при нужда“ (флаг `dirty`). Има регулатор на качеството (`QU`, `window.__lvl`), който намалява качеството при бавни кадри.
- **Камера:** OrbitControls, `maxDistance` 36000, `near`/`far`/мъгла се мащабират по разстоянието.

Забележка: секцията „parcel boundaries (АГКК)“ е само код. В публичния build `__PAR__` е празен, така че не се рисува нищо.

## 5a. Правила при промени

1. Не добавяй външни библиотеки и не променяй версията на Three.js (r128).
2. Всичко остава в един самостоятелен `index.html`. Артефактът е ограничен до около 16 MB.
3. Нищо от кадастъра (АГКК/КАИС) не се качва в публичното репо. Тук е само OSM, Microsoft ML (през Overture), Sentinel-2, Copernicus DEM, Overture Places.
4. Не се ползват Google/Bing или други снимки и не се трасира от тях.
5. Интерфейсът и текстовете са на български.
6. След промяна: `python3 build_public.py`, провери в браузър, че няма грешки в конзолата.
7. Проверявай на телефон (Samsung Galaxy A55): без нови тежки шейдъри и без нови геометрии без ограничение на броя.

## 6. Лиценз и източници

Виж `README.md` (таблица с източниците и лицензите).
