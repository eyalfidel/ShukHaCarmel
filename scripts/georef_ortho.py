# -*- coding: utf-8 -*-
"""
הצמדת צילום מסך מה-GIS העירוני למפה (צפון למעלה, בלי סיבוב).

מחפש את ההזזה ואת קנה המידה שבהם קווי הרחובות של OSM (מתוך kalpi-map) נופלים
על הפיקסלים הכהים ביותר בתמונה (אספלט), ומדפיס את הגבולות ל-config.js (ORTHO.bounds).

    python3 scripts/georef_ortho.py IMAGE KALPI_ROOT AX AY SCALE

AX, AY  - ניחוש ראשוני: הפיקסל בתמונה שבו נמצאת הכתובת הכרמל 58 (כיכר מגן דוד)
SCALE   - ניחוש ראשוני למטרים לפיקסל (1:2000 על המסך ≈ 0.7)
לבדיקה בעין: מציירים את נקודות data/addresses.json על התמונה עם הפרמטרים שיצאו.

צריך Pillow ו-numpy.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

LAT0, LNG0 = 32.069438, 34.77013      # הכרמל 58
MX, MY = 94400.0, 110900.0            # מטרים למעלה אורך / רוחב, בקו רוחב 32.07


def road_points(kalpi_root):
    roads = json.load(open(os.path.join(kalpi_root, 'data/osm_context_tlv/box_0.json'), encoding='utf-8'))['roads']
    pts = []
    for _, _, c in roads:
        ll = [(c[i] / 1e5, c[i + 1] / 1e5) for i in range(0, len(c) - 1, 2)]
        for (a, b), (p, q) in zip(ll, ll[1:]):
            x1, y1 = (b - LNG0) * MX, (LAT0 - a) * MY
            x2, y2 = (q - LNG0) * MX, (LAT0 - p) * MY
            n = max(1, int(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** .5 / 3))   # נקודה כל ~3 מ'
            for k in range(n + 1):
                x, y = x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n
                if -2000 < x < 2000 and -1500 < y < 1500:
                    pts.append((x, y))
    return np.array(pts)


def main(image, kalpi_root, ax0, ay0, s0):
    A = np.asarray(Image.open(image).convert('L'), dtype=float)
    H, W = A.shape
    P = road_points(kalpi_root)
    X, Y = P[:, 0], P[:, 1]

    def score(ax, ay, s):
        u = (ax + X / s).astype(int)
        v = (ay + Y / s).astype(int)
        m = (u >= 2) & (u < W - 2) & (v >= 2) & (v < H - 2)
        if m.sum() < 500:
            return 999.0
        u, v = u[m], v[m]
        return sum(A[v + dv, u + du] for du in (-1, 0, 1) for dv in (-1, 0, 1)).mean() / 9

    best = (score(ax0, ay0, s0), ax0, ay0, s0)
    # שלב גס ואז עדין
    for step, rng, scales in ((4, 48, np.arange(s0 * .86, s0 * 1.02, .005)), (1, 5, None)):
        ax_c, ay_c, s_c = best[1:]
        for s in (scales if scales is not None else s_c + np.array([-.003, -.0015, 0, .0015, .003])):
            for ax in range(int(ax_c - rng), int(ax_c + rng) + 1, step):
                for ay in range(int(ay_c - rng), int(ay_c + rng) + 1, step):
                    sc = score(ax, ay, s)
                    if sc < best[0]:
                        best = (sc, ax, ay, round(float(s), 4))
        print('stage:', best)

    _, ax, ay, s = best
    lng = lambda u: LNG0 + (u - ax) * s / MX
    lat = lambda v: LAT0 - (v - ay) * s / MY
    print('ORTHO.bounds =', [[round(lat(H), 6), round(lng(0), 6)], [round(lat(0), 6), round(lng(W), 6)]])


if __name__ == '__main__':
    img, root, ax, ay, s = sys.argv[1:6]
    main(img, root, float(ax), float(ay), float(s))
