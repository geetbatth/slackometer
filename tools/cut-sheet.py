"""Cut the v2 robot sprite sheet (4x4, plain background) and the gauge.

    python tools/cut-sheet.py

Inputs : tools/art/robots-sheet-2.jpg, tools/art/gauge.jpg
Outputs: web/src/assets/robots/<name>.webp, web/src/assets/gauge.webp,
         web/src/assets/gauge.json (needle pivot + radius in the cut image),
         tools/art/sheet-contact.png (check the cuts)
"""
import json
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "tools" / "art"
OUT = ROOT / "web" / "src" / "assets"
NAMES = [
    "fib", "asleep", "hammock", "hustle",
    "inspect", "skiptests", "overachiever", "shrug",
    "hiding", "scroll", "rug", "trophy",
    "measure", "whiteboard", "piggy", "giveup",
]


def bg_mask(a, bg, tol=26):
    d = np.abs(a[..., :3].astype(int) - np.array(bg)).max(axis=2)
    return d <= tol


def label(mask):
    h, w = mask.shape
    lab = np.zeros((h, w), dtype=np.int32)
    n = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not lab[y, x]:
                n += 1
                q = deque([(y, x)]); lab[y, x] = n
                while q:
                    cy, cx = q.popleft()
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
    return lab, n


def flood_outside(isbg, keep):
    """Background = bg-coloured pixels reachable from the crop edge or from outside `keep`."""
    h, w = isbg.shape
    out = ~keep.copy()
    seen = np.zeros_like(isbg)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            q.append((y, x))
    ys, xs = np.nonzero(out)
    q.extend(zip(ys.tolist(), xs.tolist()))
    while q:
        y, x = q.popleft()
        if seen[y, x]:
            continue
        seen[y, x] = True
        if not (isbg[y, x] or out[y, x]):
            continue
        out[y, x] = True
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                q.append((ny, nx))
    return out


def fill_holes(mask):
    """Fill enclosed holes in a boolean mask (flood the background from the border)."""
    h, w = mask.shape
    reached = np.zeros_like(mask)
    q = deque([(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)])
    while q:
        y, x = q.popleft()
        if reached[y, x] or mask[y, x]:
            continue
        reached[y, x] = True
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not reached[ny, nx] and not mask[ny, nx]:
                q.append((ny, nx))
    return mask | ~reached


def finish(rgba, transparent):
    a = np.where(transparent, 0, 255).astype(np.uint8)
    alpha = Image.fromarray(a).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    im = Image.fromarray(rgba[..., :3]).convert("RGBA")
    im.putalpha(alpha)
    return im


def cut_sheet():
    img = Image.open(ART / "robots-sheet-2.jpg").convert("RGB")
    a = np.array(img)
    H, W = a.shape[:2]
    bg = tuple(int(v) for v in a[5, 5])
    isbg = bg_mask(a, bg)
    # group parts (Zzz, drops, smoke) with a coarse dilated mask
    S = 4
    small = Image.fromarray((~isbg).astype(np.uint8) * 255).resize((W // S, H // S), Image.BILINEAR)
    small = small.point(lambda v: 255 if v > 40 else 0).filter(ImageFilter.MaxFilter(3))
    lab, n = label(np.array(small) > 0)
    cells = {i: [] for i in range(16)}
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if len(ys) < 60:
            continue
        cx, cy = xs.mean() * S, ys.mean() * S
        cell = min(3, int(cy / (H / 4))) * 4 + min(3, int(cx / (W / 4)))
        cells[cell].append(k)
    sprites = {}
    for i, name in enumerate(NAMES):
        region_small = fill_holes(np.isin(lab, cells[i]))
        if not region_small.any():
            print("no robot found for", name); continue
        region = np.array(Image.fromarray(region_small.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 0
        ys, xs = np.nonzero(region)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub_bg = isbg[y0:y1, x0:x1]
        # seal small gaps in ink outlines (e.g. the white flag) before flooding, then hug the ink again
        R = 6
        ink = Image.fromarray((~sub_bg).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * R + 1))
        sealed_bg = sub_bg & ~(np.array(ink) > 0)
        flooded = flood_outside(sealed_bg, region[y0:y1, x0:x1])
        grow = np.array(Image.fromarray(flooded.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * R + 3))) > 0
        transparent = flooded | (grow & sub_bg)
        im = finish(a[y0:y1, x0:x1], transparent)
        im = im.crop(im.getbbox())
        im.thumbnail((320, 320), Image.LANCZOS)
        im.save(OUT / "robots" / f"{name}.webp", "WEBP", quality=82, method=6)
        sprites[name] = im
    return sprites


def cut_gauge():
    img = Image.open(ART / "gauge.jpg").convert("RGB")
    a = np.array(img)
    bg = tuple(int(v) for v in a[5, 5])
    isbg = bg_mask(a, bg, tol=22)
    transparent = flood_outside(isbg, np.ones_like(isbg))
    im = finish(a, transparent)
    box = im.getbbox()
    im = im.crop(box)
    # needle pivot = centre of the brass hub at the bottom middle; radius to the inner rim
    pivot_src = (1002, 1318)
    px, py = pivot_src[0] - box[0], pivot_src[1] - box[1]
    scale = 900 / im.width
    im = im.resize((900, round(im.height * scale)), Image.LANCZOS)
    im.save(OUT / "gauge.webp", "WEBP", quality=84, method=6)
    meta = {"width": im.width, "height": im.height, "pivot": [round(px * scale, 1), round(py * scale, 1)], "radius": round(560 * scale, 1)}
    (OUT / "gauge.json").write_text(json.dumps(meta))
    return im, meta


def main():
    (OUT / "robots").mkdir(parents=True, exist_ok=True)
    sprites = cut_sheet()
    gauge, meta = cut_gauge()
    sheet = Image.new("RGBA", (4 * 230, 5 * 250), (40, 40, 40, 255))
    for i, (name, im) in enumerate(sprites.items()):
        th = im.copy(); th.thumbnail((220, 220))
        sheet.alpha_composite(th, (i % 4 * 230 + 5, i // 4 * 250 + 5))
        ImageDraw.Draw(sheet).text((i % 4 * 230 + 8, i // 4 * 250 + 232), name, fill="white")
    g = gauge.copy()
    d = ImageDraw.Draw(g)
    cx, cy = meta["pivot"]; r = meta["radius"]
    import math
    for deg in (180, 135, 90, 45, 0):
        d.line((cx, cy, cx + r * math.cos(math.radians(deg)), cy - r * math.sin(math.radians(deg))), fill="black", width=4)
    g.thumbnail((900, 240))
    sheet.alpha_composite(g, (5, 4 * 250 + 5))
    sheet.save(ART / "sheet-contact.png")
    print("ok", len(sprites), "robots; gauge", meta)


if __name__ == "__main__":
    main()
