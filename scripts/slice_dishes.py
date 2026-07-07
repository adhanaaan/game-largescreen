#!/usr/bin/env python3
"""Slice the Thai-dish grid image into individual circular plate assets.

Usage:
    pip install pillow
    python3 scripts/slice_dishes.py path/to/grid.png

The source art is a COLS x ROWS grid of plated dishes (each a circular plate on
white, with a caption below). This script:
  1. splits the image into cells,
  2. auto-detects the plate (largest non-white blob in the upper part of each
     cell, ignoring the caption strip),
  3. crops a padded square around it,
  4. writes assets/dishes/<key>.png for every mapped cell, plus a debug copy
     tile_r{r}_c{c}.png for every cell so the mapping can be checked/fixed.

If a dish lands in the wrong file, just edit MAPPING below (row, col are
0-indexed) and re-run.
"""
import os, sys
from PIL import Image

COLS, ROWS = 7, 4
CAPTION_FRAC = 0.22   # bottom slice of each cell that holds the caption text
WHITE = 245           # pixels brighter than this (all channels) count as background
PAD = 0.06            # padding around the detected plate, as a fraction of side

# (row, col) -> asset key.  `None` = extra tile not in the catalogue (skipped).
# Best-effort from the reference art; adjust after eyeballing the debug tiles.
MAPPING = {
    (0, 0): "tom_yum",      (0, 1): "tom_kha",     (0, 2): "green_curry",
    (0, 3): "red_curry",    (0, 4): "massaman",    (0, 5): None,
    (0, 6): "khao_soi",
    (1, 0): "pad_thai",     (1, 1): "pad_see_ew",  (1, 2): "pad_see_mao",
    (1, 3): "drunken_noodles", (1, 4): None,       (1, 5): None,
    (1, 6): None,
    (2, 0): "pineapple_rice", (2, 1): "pad_kra_pao", (2, 2): "khao_moo_daeng",
    (2, 3): "kai_jeow",     (2, 4): "som_tum",     (2, 5): "laab_moo",
    (2, 6): "nam_tok_moo",
    (3, 0): "tod_mun_pla",  (3, 1): "hoy_tod",     (3, 2): "moo_ping",
    (3, 3): "gai_yang",     (3, 4): "pla_rad_prik", (3, 5): "mango_sticky_rice",
    (3, 6): "tub_tim_grob",
}


def plate_bbox(cell):
    """Bounding box of the plate: non-white content in the upper region."""
    w, h = cell.size
    top = cell.crop((0, 0, w, int(h * (1 - CAPTION_FRAC)))).convert("RGB")
    px = top.load()
    tw, th = top.size
    minx, miny, maxx, maxy = tw, th, 0, 0
    found = False
    for y in range(0, th, 2):
        for x in range(0, tw, 2):
            r, g, b = px[x, y]
            if not (r > WHITE and g > WHITE and b > WHITE):
                found = True
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if not found:
        return (0, 0, w, int(h * (1 - CAPTION_FRAC)))
    return (minx, miny, maxx, maxy)


def square_crop(cell, bbox):
    x0, y0, x1, y1 = bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = max(x1 - x0, y1 - y0)
    side *= (1 + 2 * PAD)
    half = side / 2
    L, T = int(cx - half), int(cy - half)
    R, B = int(cx + half), int(cy + half)
    W, H = cell.size
    L, T = max(0, L), max(0, T)
    R, B = min(W, R), min(H, B)
    return cell.crop((L, T, R, B))


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python3 scripts/slice_dishes.py <grid-image>")
    src = sys.argv[1]
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "assets", "dishes")
    dbg = os.path.join(here, "scripts", "_tiles")
    os.makedirs(out, exist_ok=True)
    os.makedirs(dbg, exist_ok=True)

    img = Image.open(src).convert("RGBA")
    W, H = img.size
    cw, ch = W / COLS, H / ROWS
    print(f"image {W}x{H}, cell ~{cw:.0f}x{ch:.0f}")

    n = 0
    for r in range(ROWS):
        for c in range(COLS):
            cell = img.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
            plate = square_crop(cell, plate_bbox(cell))
            plate.save(os.path.join(dbg, f"tile_r{r}_c{c}.png"))
            key = MAPPING.get((r, c))
            if key:
                plate.save(os.path.join(out, f"{key}.png"))
                n += 1
    print(f"wrote {n} dish assets to assets/dishes/ (+ {ROWS*COLS} debug tiles in scripts/_tiles/)")


if __name__ == "__main__":
    main()
