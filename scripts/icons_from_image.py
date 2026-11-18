# =============================================================================
# WHAT THIS FILE IS
#   Makes every app icon from ONE picture: scripts/icon-source.png (the gold
#   cloche + checklist tile on navy, 1536x1024, tile in the middle).
# WHY IT EXISTS
#   Phones, browsers and notifications each need their own size and shape:
#     public/icon-192.png, icon-512.png   the tile with its gold border, corners
#                                         transparent (Android / Chrome / notifications)
#     public/icon-maskable-512.png        artwork on full navy, kept inside the
#     public/apple-touch-icon.png (180)   centre "safe zone": Android and iPhone
#                                         cut their own rounded shape
#     public/favicon-64.png               browser tab
#     public/brand-mark.png (128)         the logo inside the app (components/BrandMark.tsx)
#   If the picture changes, replace icon-source.png and run:  npm run icons
#   (needs Python with Pillow: pip install pillow)
# =============================================================================
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / 'scripts' / 'icon-source.png').convert('RGB')
OUT = ROOT / 'public'

# Where the tile sits in the source picture (outer edge of the gold border).
TILE = (339, 97, 1183, 916)         # left, top, right, bottom (outer edge, incl. the light top of the border)
RADIUS = 170                        # corner radius of the gold border
PAD = 14                            # transparent margin, so the border never touches the image edge
ART = (410, 190, 1110, 790)         # the artwork inside the tile (cloche, checklist, steam)


def tile_icon(size):
    """The whole tile, gold border included, transparent outside its rounded shape."""
    l, t, r, b = TILE
    side = max(r - l, b - t) + 2 * PAD
    cx, cy = (l + r) // 2, (t + b) // 2
    box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
    big = SRC.crop(box).convert('RGBA')
    mask = Image.new('L', big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (l - box[0], t - box[1], r - box[0], b - box[1]), radius=RADIUS, fill=255)
    big.putalpha(mask)
    return big.resize((size, size), Image.LANCZOS)


def maskable_icon(size):
    """The artwork on full-bleed navy, inside the 80% safe circle, no border.
    The navy around it continues the artwork's own edge colours outwards
    (then softly blurred), so there is no visible box where it is placed."""
    S = 1024
    art = SRC.crop(ART)
    scale = 0.9
    art = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
    w, h = art.size
    ox, oy = (S - w) // 2, (S - h) // 2 - 10
    src = art.load()
    bg = Image.new('RGB', (S, S))
    px = bg.load()
    for y in range(S):
        sy = min(h - 1, max(0, y - oy))
        for x in range(S):
            px[x, y] = src[min(w - 1, max(0, x - ox)), sy]   # nearest edge pixel of the artwork
    bg = bg.filter(ImageFilter.GaussianBlur(40))
    feather = Image.new('L', art.size, 0)                   # only the outermost pixels soften
    ImageDraw.Draw(feather).rectangle((10, 10, w - 10, h - 10), fill=255)
    feather = feather.filter(ImageFilter.GaussianBlur(8))
    bg.paste(art, (ox, oy), feather)
    return bg.resize((size, size), Image.LANCZOS)


def save(img, name):
    img.save(OUT / name, optimize=True)
    print('wrote public/' + name)


save(tile_icon(192), 'icon-192.png')
save(tile_icon(512), 'icon-512.png')
save(tile_icon(64), 'favicon-64.png')
save(tile_icon(128), 'brand-mark.png')
save(maskable_icon(512), 'icon-maskable-512.png')
save(maskable_icon(180), 'apple-touch-icon.png')
