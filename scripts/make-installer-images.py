"""Builds the images Insilode's installer shows (editor/installer/inno-big-*.bmp and inno-small-*.bmp) and its Start tile logos
(code_70x70.png, code_150x150.png) from editor/branding/icon.png.

Inno Setup shows the big one on the welcome and finish pages and the small one in the header of the others, once per
display scale. VS Code's own (blue) versions are replaced by these when `npm run installer` runs. Needs Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / 'editor' / 'branding' / 'icon.png'
OUT = ROOT / 'editor' / 'installer'

# Inno's sizes per display scale (percent): (width, height), as in VS Code's own images.
BIG = {100: (164, 314), 125: (192, 386), 150: (246, 459), 175: (273, 556), 200: (328, 604), 225: (355, 700), 250: (410, 797)}
SMALL = {100: (55, 55), 125: (64, 68), 150: (83, 80), 175: (92, 97), 200: (110, 106), 225: (119, 123), 250: (138, 140)}
NAVY_TOP, NAVY_BOTTOM, ACCENT = (34, 40, 62), (14, 17, 29), (122, 162, 247)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ('segoeuib.ttf', 'seguisb.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def big(width: int, height: int) -> Image.Image:
    img = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        draw.line([(0, y), (width, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(NAVY_TOP, NAVY_BOTTOM)))
    side = round(width * 0.62)
    icon = Image.open(ICON).convert('RGBA').resize((side, side), Image.LANCZOS)
    top = round(height * 0.16)
    img.paste(icon, ((width - side) // 2, top), icon)
    text, f = 'Insilode', font(round(width * 0.2))
    box = draw.textbbox((0, 0), text, font=f)
    draw.text(((width - (box[2] - box[0])) // 2 - box[0], top + side + round(height * 0.05)), text, font=f, fill=(235, 239, 250))
    draw.rectangle([round(width * 0.38), height - round(height * 0.09), round(width * 0.62), height - round(height * 0.09) + max(2, round(width * 0.015))], fill=ACCENT)
    return img


def small(width: int, height: int) -> Image.Image:
    img = Image.new('RGB', (width, height), (255, 255, 255))
    side = round(min(width, height) * 0.86)
    icon = Image.open(ICON).convert('RGBA').resize((side, side), Image.LANCZOS)
    img.paste(icon, ((width - side) // 2, (height - side) // 2), icon)
    return img


OUT.mkdir(parents=True, exist_ok=True)
for scale, (w, h) in BIG.items():
    big(w, h).save(OUT / f'inno-big-{scale}.bmp')
for scale, (w, h) in SMALL.items():
    small(w, h).save(OUT / f'inno-small-{scale}.bmp')
# The Start tile logos (VisualElementsManifest.xml): the icon, transparent around it, on the tile's own background colour.
for side in (70, 150):
    tile = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    inner = round(side * 0.8)
    icon = Image.open(ICON).convert('RGBA').resize((inner, inner), Image.LANCZOS)
    tile.paste(icon, ((side - inner) // 2, (side - inner) // 2), icon)
    tile.save(OUT / f'code_{side}x{side}.png')
print(f'{len(BIG) + len(SMALL) + 2} images in {OUT}')
