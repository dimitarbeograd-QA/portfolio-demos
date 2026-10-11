import json, math, sys

SRC = sys.argv[1]
OUT = sys.argv[2]

LAT0, LON0 = 43.8167, 23.2333
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574.0
# visible window in metres around the origin (generous margin around the bounding box that was downloaded)
XMIN, XMAX = -2500, 2500
YMIN, YMAX = -2900, 2900

d = json.load(open(SRC))
els = d["elements"]


def proj(p):
    return ((p["lon"] - LON0) * KX, (p["lat"] - LAT0) * KY)


def q(v):
    return int(round(v * 10))  # decimetres


def inside(x, y, m=0):
    return XMIN - m <= x <= XMAX + m and YMIN - m <= y <= YMAX + m


def area(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


def runs(pts, m=150):
    out, cur = [], []
    for x, y in pts:
        if inside(x, y, m):
            cur.append((x, y))
        else:
            if len(cur) > 1:
                out.append(cur)
            cur = []
    if len(cur) > 1:
        out.append(cur)
    return out


def flat(pts):
    r = []
    for x, y in pts:
        r.append(q(x))
        r.append(q(y))
    return r


buildings, roads, rails, landuse, water, streams = [], [], [], [], [], []
river = []
lom_river = []

ROAD_W = {
    "secondary": 9, "secondary_link": 7, "tertiary": 7, "unclassified": 5.5, "residential": 5.5,
    "service": 3.6, "track": 3, "pedestrian": 3, "footway": 1.6, "path": 1.4, "bridleway": 1.4,
}

for e in els:
    t = e.get("tags", {})
    g = e.get("geometry")
    if not g:
        continue
    pts = [proj(p) for p in g]
    if "building" in t:
        if len(pts) < 4:
            continue
        pts = pts[:-1] if pts[0] == pts[-1] else pts
        if abs(area(pts)) < 6:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        if not inside(cx, cy, 100):
            continue
        b = {"id": e["id"], "p": flat(pts), "t": t["building"]}
        if "building:levels" in t:
            b["l"] = t["building:levels"]
        if "height" in t:
            b["h"] = t["height"]
        nm = t.get("name")
        if nm:
            b["n"] = nm
        st = t.get("addr:street")
        if st:
            b["s"] = st + (" " + t["addr:housenumber"] if "addr:housenumber" in t else "")
        buildings.append(b)
    elif "highway" in t:
        for r in runs(pts):
            roads.append({"c": t["highway"], "w": ROAD_W.get(t["highway"], 3.5), "p": flat(r), **({"n": t["name"]} if "name" in t else {})})
    elif "railway" in t:
        for r in runs(pts):
            rails.append({"p": flat(r)})
    elif t.get("natural") == "water":
        if len(pts) > 3:
            water.append({"p": flat(pts[:-1])})
    elif "landuse" in t:
        if len(pts) > 3 and pts[0] == pts[-1]:
            pts = pts[:-1]
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            if inside(cx, cy, 800):
                landuse.append({"k": t["landuse"], "p": flat(pts), "a": abs(area(pts))})
    elif t.get("waterway") == "river" and "Дунав" in t.get("name:bg", ""):
        for r in runs(pts, 4000):
            river.append({"p": flat(r)})
    elif t.get("waterway") == "river":
        for r in runs(pts, 150):
            lom_river.append({"w": 9, "p": flat(r), "n": t.get("name", "")})
    elif t.get("waterway") == "stream" and "tunnel" not in t:
        for r in runs(pts):
            streams.append({"w": 3, "p": flat(r)})

landuse.sort(key=lambda z: -z["a"])
for z in landuse:
    z["a"] = int(z["a"])

data = {
    "origin": [LAT0, LON0],
    "bounds": [XMIN, XMAX, YMIN, YMAX],
    "buildings": buildings, "roads": roads, "rails": rails, "landuse": landuse,
    "water": water, "streams": streams + lom_river, "danube": river,
}
json.dump(data, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print({k: (len(v) if isinstance(v, list) else v) for k, v in data.items()})
