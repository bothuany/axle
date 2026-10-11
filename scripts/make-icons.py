"""Builds Axle's app icon files in editor/branding/ (icon.png, icon.ico, icon.icns).

Large sizes come from the generated artwork (concepts/axle-source.png: a rounded tile on a plain background,
cropped and masked here). Its strokes are too fine to read at 16 to 48 pixels, so those sizes are drawn bolder
from the same idea: an axle hub with three spokes to a triangle, a diamond and a circle. Needs Pillow.
"""
import struct
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

BRANDING = Path(__file__).resolve().parent.parent / 'editor' / 'branding'
SOURCE = BRANDING / 'concepts' / 'axle-source.png'
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
BOLD_BELOW = 64  # sizes under this are drawn, not scaled from the artwork

NAVY_TOP, NAVY_BOTTOM, ACCENT = (34, 40, 62), (14, 17, 29), (122, 162, 247)
CORNER = 0.222  # corner radius as a share of the tile's width


def rounded_mask(size: int) -> Image.Image:
    big = size * 4
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(CORNER * big), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def artwork_tile() -> Image.Image:
    """The generated tile, cut out of its background (found by being darker than it) and given clean corners."""
    src = Image.open(SOURCE).convert('RGB')
    lum = (np.asarray(src).astype(int) @ np.array([299, 587, 114])) // 1000
    ys, xs = np.where(lum < 75)
    inset = 10  # drops the tile's own hairline border and soft shadow
    x0, x1, y0, y1 = xs.min() + inset, xs.max() - inset, ys.min() + inset, ys.max() - inset
    side = min(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    tile = src.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)).convert('RGBA')
    tile.putalpha(rounded_mask(tile.width))
    return tile.resize((1024, 1024), Image.LANCZOS)


def bold_tile(size: int) -> Image.Image:
    """Chunky version for small sizes, drawn at 8x and scaled down."""
    big = size * 8
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    gradient = Image.new('RGBA', (big, big))
    draw = ImageDraw.Draw(gradient)
    for y in range(big):
        t = y / (big - 1)
        draw.line([(0, y), (big, y)], fill=tuple(round(NAVY_TOP[i] + (NAVY_BOTTOM[i] - NAVY_TOP[i]) * t) for i in range(3)) + (255,))
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(CORNER * big), fill=255)
    img.paste(gradient, (0, 0), mask)
    d = ImageDraw.Draw(img)

    cx, cy = big * 0.5, big * 0.53

    def at(angle_deg: float, dist: float):
        import math
        a = math.radians(angle_deg)
        return cx + math.cos(a) * dist * big, cy + math.sin(a) * dist * big

    hub, ring = 0.145, 0.075
    nodes = [(-90, 0.315), (150, 0.315), (30, 0.315)]  # top, lower left, lower right
    for angle, dist in nodes:
        d.line([at(angle, hub), at(angle, dist)], fill=ACCENT, width=int(0.06 * big))
    d.ellipse([cx - hub * big, cy - hub * big, cx + hub * big, cy + hub * big], outline=ACCENT, width=int(ring * big))
    r = 0.095 * big
    x, y = at(-90, 0.315)
    d.polygon([(x, y - r * 1.1), (x - r * 1.05, y + r * 0.8), (x + r * 1.05, y + r * 0.8)], fill=ACCENT)
    x, y = at(150, 0.315)
    d.polygon([(x, y - r * 1.1), (x + r * 1.1, y), (x, y + r * 1.1), (x - r * 1.1, y)], fill=ACCENT)
    x, y = at(30, 0.315)
    d.ellipse([x - r, y - r, x + r, y + r], fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    out = BytesIO()
    image.save(out, 'PNG')
    return out.getvalue()


def write_ico(path: Path, images: dict[int, Image.Image]):
    """An .ico of PNG entries, one image per size (Pillow's own writer scales a single image to every size)."""
    blobs = [(size, png_bytes(img)) for size, img in sorted(images.items())]
    header = struct.pack('<HHH', 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries, data = b'', b''
    for size, blob in blobs:
        entries += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(blob), offset + len(data))
        data += blob
    path.write_bytes(header + entries + data)


def main():
    art = artwork_tile()
    BRANDING.mkdir(parents=True, exist_ok=True)
    art.save(BRANDING / 'icon.png')
    art.save(BRANDING / 'icon.icns')
    sizes = {s: (bold_tile(s) if s < BOLD_BELOW else art.resize((s, s), Image.LANCZOS)) for s in ICO_SIZES}
    write_ico(BRANDING / 'icon.ico', sizes)
    print('wrote', *sorted(p.name for p in BRANDING.iterdir() if p.is_file()))


if __name__ == '__main__':
    main()
