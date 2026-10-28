# -*- coding: utf-8 -*-
"""
בונה את data/addresses.json ו-data/junctions.json מתוך הריפו kalpi-map.
מריצים פעם אחת (או כשרוצים להרחיב אזור); הפלט נשמר בריפו, כך שאין תלות
ב-kalpi-map בזמן ריצה.

    python3 scripts/build_data.py /path/to/kalpi-map

רק ספריית התקן.
"""
import json
import math
import os
import re
import sys

ROVA_ZONES = {51, 52, 53, 54, 55}      # תתי-רובע של רובע 5 (lev ha'ir)
MAIN_STREET = 'הכרמל'
# מרחק מקסימלי (מטרים) בין נקודת חיתוך של רחוב חוצה לבין קו רחוב הכרמל
JUNCTION_SNAP_M = 35


def norm_street(s):
    s = (s or '').replace('״', '"').replace('׳', "'").strip()
    return re.sub(r'\s+', ' ', s)


def house_key(h):
    """'13א' -> (13, 'א'); מיון טבעי של מספרי בית."""
    m = re.match(r'\s*(\d+)\s*(.*)$', h or '')
    if not m:
        return (10 ** 6, h or '')
    return (int(m.group(1)), m.group(2).strip())


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_polygon(x, y, rings):
    return point_in_ring(x, y, rings[0]) and not any(point_in_ring(x, y, r) for r in rings[1:])


# --- גיאומטריה מקומית במטרים (קירוב שטוח מספיק לטווח של קילומטר) ---
LAT0 = 32.066
M_LAT = 111320.0
M_LNG = 111320.0 * math.cos(math.radians(LAT0))


def to_xy(lat, lng):
    return (lng * M_LNG, lat * M_LAT)


def seg_intersect(p1, p2, p3, p4):
    d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
    if abs(d) < 1e-9:
        return None
    t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
    u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1]))
    return None


def dist_point_seg(p, a, b):
    vx, vy = b[0] - a[0], b[1] - a[1]
    L = vx * vx + vy * vy
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L))
    q = (a[0] + t * vx, a[1] + t * vy)
    return math.hypot(p[0] - q[0], p[1] - q[1]), q


def decode_road(coords):
    """kalpi-map osm_context: [lat*1e5, lng*1e5, ...] רצוף."""
    return [(coords[i] / 1e5, coords[i + 1] / 1e5) for i in range(0, len(coords) - 1, 2)]


def main(kalpi_root, out_dir):
    feats = json.load(open(os.path.join(kalpi_root, 'data/processed/addresses_with_kalpi.geojson'),
                           encoding='utf-8'))['features']
    zones = json.load(open(os.path.join(kalpi_root, 'data/raw/tlv_subdistricts.geojson'),
                           encoding='utf-8'))['features']
    polys = [z['geometry']['coordinates'] for z in zones if z['properties']['zone_num'] in ROVA_ZONES]

    seen = set()
    addresses = []
    for f in feats:
        lng, lat = f['geometry']['coordinates'][:2]
        if not any(in_polygon(lng, lat, rings) for rings in polys):
            continue
        p = f['properties']
        street = norm_street(p['street'])
        house = re.sub(r'\s+', '', p.get('house_display') or '')
        if not street or not house or (street, house) in seen:
            continue
        seen.add((street, house))
        n = house_key(house)[0]
        addresses.append({
            'street': street,
            'house': house,
            'side': 'זוגי' if n % 2 == 0 else 'אי-זוגי',
            'lat': round(lat, 6),
            'lng': round(lng, 6),
        })
    addresses.sort(key=lambda a: (a['street'] != MAIN_STREET, a['street'], house_key(a['house'])))

    # --- צמתים לאורך רחוב הכרמל ---
    roads = json.load(open(os.path.join(kalpi_root, 'data/osm_context_tlv/box_0.json'),
                           encoding='utf-8'))['roads']
    carmel = [a for a in addresses if a['street'] == MAIN_STREET]
    # רחוב הכרמל כמעט ישר, אז מתארים אותו כציר אחד (PCA על קואורדינטות הכתובות).
    # ב-OSM הוא מופיע רק בחלקו, ויש עוד "הכרמל" בעיר, לכן לא משתמשים בקו מ-OSM.
    xy = [to_xy(c['lat'], c['lng']) for c in carmel]
    cx = sum(p[0] for p in xy) / len(xy)
    cy = sum(p[1] for p in xy) / len(xy)
    sxx = sum((p[0] - cx) ** 2 for p in xy)
    syy = sum((p[1] - cy) ** 2 for p in xy)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in xy)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)

    def along(p):   # מיקום לאורך הרחוב (מטרים)
        return (p[0] - cx) * ux + (p[1] - cy) * uy

    def across(p):  # מרחק ניצב מהציר (סימן = צד)
        return -(p[0] - cx) * uy + (p[1] - cy) * ux

    for c, p in zip(carmel, xy):
        c['_t'] = along(p)
    ts = [c['_t'] for c in carmel]
    t0, t1 = min(ts) - 20, max(ts) + 20
    axis = ((cx + t0 * ux, cy + t0 * uy), (cx + t1 * ux, cy + t1 * uy))
    side_sign = {}
    for side in ('זוגי', 'אי-זוגי'):
        v = [across(p) for c, p in zip(carmel, xy) if c['side'] == side]
        side_sign[side] = 1 if sum(v) >= 0 else -1

    hits = {}
    for r in roads:
        name = norm_street(r[1])
        if name == MAIN_STREET or not name or 'כרמל' in name:
            continue
        line = [to_xy(*q) for q in decode_road(r[2])]
        found = []
        for i in range(len(line) - 1):
            p = seg_intersect(line[i], line[i + 1], axis[0], axis[1])
            if p is not None:
                found.append(p)
        # רחוב שמסתיים ממש ליד הכרמל (צומת T) בלי לחצות את הציר
        for end in (line[0], line[-1]):
            d, q = dist_point_seg(end, *axis)
            if d <= JUNCTION_SNAP_M:
                found.append(q)
        if not found:
            continue
        h = hits.setdefault(name, {'pts': [], 'signs': set()})
        h['pts'] += found
        for q in line:
            if abs(along(q) - along(found[0])) < 80 and abs(across(q)) > 8:
                h['signs'].add(1 if across(q) > 0 else -1)

    junctions = []
    for name, h in hits.items():
        t = sum(along(p) for p in h['pts']) / len(h['pts'])
        x, y = cx + t * ux, cy + t * uy
        j = {'street': MAIN_STREET, 'cross_street': name,
             'lat': round(y / M_LAT, 6), 'lng': round(x / M_LNG, 6)}
        for side, key in (('זוגי', 'even'), ('אי-זוגי', 'odd')):
            # האם הרחוב החוצה יוצא מהצד הזה (אם אין מידע - מניחים ששני הצדדים)
            j[key + '_side'] = (not h['signs']) or side_sign[side] in h['signs']
            row = sorted((c for c in carmel if c['side'] == side), key=lambda c: c['_t'])
            before = [c for c in row if c['_t'] <= t]
            after = [c for c in row if c['_t'] > t]
            j[key + '_between'] = [before[-1]['house'] if before else None,
                                   after[0]['house'] if after else None]
        j['_t'] = t
        junctions.append(j)
    junctions.sort(key=lambda j: j['_t'])
    for j in junctions:
        del j['_t']
    for c in carmel:
        del c['_t']

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'addresses.json'), 'w', encoding='utf-8') as fh:
        # שורה לכל כתובת: קומפקטי, וגם נוח ל-diff
        fh.write('[\n' + ',\n'.join(json.dumps(a, ensure_ascii=False) for a in addresses) + '\n]\n')
    with open(os.path.join(out_dir, 'junctions.json'), 'w', encoding='utf-8') as fh:
        json.dump(junctions, fh, ensure_ascii=False, indent=1)

    print('addresses:', len(addresses), '| on', MAIN_STREET + ':', len(carmel),
          '| streets:', len({a['street'] for a in addresses}))
    for j in junctions:
        print('  junction:', j['cross_street'], '| odd', j['odd_between'], j['odd_side'], '| even', j['even_between'], j['even_side'])


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '../kalpi-map'
    here = os.path.dirname(os.path.abspath(__file__))
    main(root, os.path.join(here, '..', 'data'))
