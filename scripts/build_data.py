# -*- coding: utf-8 -*-
"""
בונה את data/addresses.json מתוך הריפו kalpi-map.
מריצים פעם אחת (או כשרוצים להרחיב אזור); הפלט נשמר בריפו, כך שאין תלות
ב-kalpi-map בזמן ריצה.

    python3 scripts/build_data.py /path/to/kalpi-map

רק ספריית התקן.
"""
import json
import os
import re
import sys

ROVA_ZONES = {51, 52, 53, 54, 55}      # תתי-רובע של רובע 5 (lev ha'ir)
MAIN_STREET = 'הכרמל'


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

    carmel = [a for a in addresses if a['street'] == MAIN_STREET]

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'addresses.json'), 'w', encoding='utf-8') as fh:
        # שורה לכל כתובת: קומפקטי, וגם נוח ל-diff
        fh.write('[\n' + ',\n'.join(json.dumps(a, ensure_ascii=False) for a in addresses) + '\n]\n')

    # כל שמות הרחובות בעיר (להשלמה האוטומטית בטופס), בכתיב הרשמי של העירייה
    streets = sorted({norm_street(f['properties']['street']) for f in feats if f['properties'].get('street')})
    with open(os.path.join(out_dir, 'streets.json'), 'w', encoding='utf-8') as fh:
        json.dump(streets, fh, ensure_ascii=False, separators=(',', ':'))
    print('city streets:', len(streets))

    print('addresses:', len(addresses), '| on', MAIN_STREET + ':', len(carmel),
          '| streets:', len({a['street'] for a in addresses}))


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else '../kalpi-map'
    here = os.path.dirname(os.path.abspath(__file__))
    main(root, os.path.join(here, '..', 'data'))
