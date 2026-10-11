import json, math, sys
from shapely.geometry import Polygon, shape
from shapely.strtree import STRtree
SRC, DATA, OUT = sys.argv[1:4]
LAT0, LON0 = 43.8167, 23.2333
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110574.0
XMIN, XMAX, YMIN, YMAX = -2500, 2500, -2900, 2900
def prj(c): return ((c[0]-LON0)*KX, (c[1]-LAT0)*KY)
d = json.load(open(DATA))
osm = []
for b in d['buildings']:
    p = b['p']; pg = Polygon([(p[i]/10, p[i+1]/10) for i in range(0, len(p), 2)])
    if pg.is_valid and pg.area > 0: osm.append(pg)
tree = STRtree(osm)
out = []; skipped = 0
for f in json.load(open(SRC))['features']:
    pr = f['properties']; src = str(pr.get('sources', ''))
    if 'Microsoft' not in src: continue
    ring = f['geometry']['coordinates'][0]
    pg = Polygon([prj(c) for c in ring])
    if not pg.is_valid: pg = pg.buffer(0)
    if pg.is_empty or pg.geom_type != 'Polygon': continue
    c = pg.centroid
    if not (XMIN <= c.x <= XMAX and YMIN <= c.y <= YMAX): continue
    if pg.area < 12: continue
    ov = False
    for i in tree.query(pg):
        if osm[i].intersection(pg).area > 0.2 * pg.area: ov = True; break
    if ov: skipped += 1; continue
    pg = pg.simplify(0.5, preserve_topology=True)
    if pg.geom_type != 'Polygon' or len(pg.exterior.coords) < 4: continue
    co = list(pg.exterior.coords)[:-1]
    out.append([int(round(v*10)) for xy in co for v in xy])
print('kept', len(out), 'skipped overlap', skipped)
d['ms'] = out
json.dump(d, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
import os; print(os.path.getsize(OUT)//1024, 'KB')
