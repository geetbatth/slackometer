"""Cut robot mascots out of the team's AI-generated poster.

    python tools/cut-robots.py <poster.jpg>

Writes web/src/assets/robots/<name>.webp with the paper background made
transparent (flood fill from the crop edges through light, low-ink pixels,
so the robots' own light fills, enclosed by ink outlines, are kept).
Also writes a contact sheet to tools/robots-contact.png for checking crops.
"""
import sys
from collections import deque
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "assets" / "robots"

# name: (left, top, right, bottom) in the 1403x2000 poster, plus boxes to blank out (number labels)
CROPS = {
    "mascot":    ((238, 150, 455, 478), [(398, 160, 440, 200)]),      # gauge on its chest
    "normal":    ((1140, 690, 1370, 960), [(1190, 690, 1260, 730)]),  # waving
    "slacking":  ((505, 140, 735, 425), [(640, 150, 710, 190)]),      # eating a shoe
    "unusual":   ((1180, 1470, 1385, 1740), [(1190, 1480, 1230, 1520)]),  # colander + ???
    "baseline":  ((845, 1700, 1042, 1995), [(840, 1700, 900, 1745), (962, 1885, 1020, 1950)]),  # climbing a ladder
    "leaner":    ((925, 150, 1135, 395), [(1020, 160, 1060, 200)]),    # toaster on a skateboard
    "falsedone": ((840, 1195, 1060, 1465), [(838, 1205, 880, 1240)]),  # box on its head
    "empty":     ((1055, 1212, 1370, 1470), [(1060, 1225, 1110, 1265), (1185, 1400, 1235, 1440)]),  # talks to a bin
    "budget":    ((975, 935, 1118, 1195), [(965, 940, 1030, 980)]),    # clock robot
    "paused":    ((930, 395, 1185, 695), [(940, 430, 1000, 470)]),     # umbrella + bucket
    "compare":   ((1000, 1740, 1385, 1995), [(965, 1905, 1030, 1945)]),  # two robots tangled
    "plunger":   ((60, 445, 335, 700), [(178, 455, 232, 495), (280, 440, 340, 490)]),        # plunger unicycle
}


KEEP_ALL = {"unusual", "empty", "compare", "mascot"}  # keep small extras (???, speech bubble)


def is_warm_paper(px):
    r, g, b = px[:3]
    return (r + g + b) / 3 > 205 and r - b > 10 and max(r, g, b) - min(r, g, b) < 45


def components(mask, w, h):
    seen = bytearray(w * h); comps = []
    for s in range(w * h):
        if not mask[s] or seen[s]:
            continue
        q = deque([s]); seen[s] = 1; pts = []
        while q:
            i = q.popleft(); pts.append(i); x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                j = ny * w + nx
                if 0 <= nx < w and 0 <= ny < h and mask[j] and not seen[j]:
                    seen[j] = 1; q.append(j)
        comps.append(pts)
    return comps


def is_paper(px):
    r, g, b = px[:3]
    light = (r + g + b) / 3
    sat = max(r, g, b) - min(r, g, b)
    return light > 200 and sat < 45


def cut(name, img, box, blanks):
    crop = img.crop(box).convert("RGBA")
    d = ImageDraw.Draw(crop)
    for (l, t, r, b) in blanks:  # paint number labels with paper colour first
        d.rectangle((l - box[0], t - box[1], r - box[0], b - box[1]), fill=(246, 240, 226, 255))
    w, h = crop.size
    px = crop.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_paper(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                q.append((nx, ny))
    # (removed: it also ate light robot fills; the page sits robots on paper so gaps don't show)
    # drop stray fragments (neighbours, labels) unless this robot keeps its extras
    if name not in KEEP_ALL:
        solid = bytearray(1 if px[i % w, i // w][3] else 0 for i in range(w * h))
        comps = sorted(components(solid, w, h), key=len, reverse=True)
        for pts in comps[1:]:
            if len(pts) < 0.12 * len(comps[0]):
                for i in pts:
                    px[i % w, i // w] = (0, 0, 0, 0)
    # soften the cut edge a little
    a = crop.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    crop.putalpha(a)
    bbox = crop.getbbox()
    return crop.crop(bbox) if bbox else crop


def main():
    poster = Image.open(sys.argv[1]).convert("RGB")
    OUT.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (4 * 260, 3 * 300), (40, 40, 40, 255))
    for i, (name, (box, blanks)) in enumerate(CROPS.items()):
        im = cut(name, poster, box, blanks)
        im.save(OUT / f"{name}.webp", "WEBP", quality=88, method=6)
        th = im.copy(); th.thumbnail((250, 270))
        sheet.alpha_composite(th, (i % 4 * 260 + 5, i // 4 * 300 + 5))
        ImageDraw.Draw(sheet).text((i % 4 * 260 + 8, i // 4 * 300 + 280), name, fill=(255, 255, 255, 255))
    sheet.save(ROOT / "tools" / "robots-contact.png")
    print("wrote", len(CROPS), "robots to", OUT)


if __name__ == "__main__":
    main()
