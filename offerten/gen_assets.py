#!/usr/bin/env python3
"""VRENT Offerten — build-time asset generator.

Fetches the brand fonts (Archivo, IBM Plex Mono) and the VRENT.CH logo,
instances/subsets the fonts to small woff2 files for the UI, bundles
TTF fonts + logo as base64 into fonts.js for jsPDF, and renders the
PWA icons from the brand mark.

A local logo.png / mark.png next to this script takes precedence over
the CDN fetch, so the logo can also be pinned into the repo.
"""
import base64
import io
import os
import shutil

import urllib.request

OUT = "public"
FONTS_DIR = os.path.join(OUT, "fonts")

GF = "https://raw.githubusercontent.com/google/fonts/main/ofl"
ARCHIVO_VAR_URL = GF + "/archivo/Archivo%5Bwdth%2Cwght%5D.ttf"
PLEX_URLS = {
    400: GF + "/ibmplexmono/IBMPlexMono-Regular.ttf",
    600: GF + "/ibmplexmono/IBMPlexMono-SemiBold.ttf",
}

# (local file, [urls]) — first URL that answers wins; a local file wins over all.
IMAGE_SOURCES = {
    "logo.png": [
        "https://www.vrent.ch/cdn/shop/files/Vrent.ch_Logo.png",
        "https://cdn.shopify.com/s/files/1/0679/0660/1258/files/Vrent.ch_Logo.png?v=1720546173",
    ],
    "mark.png": [
        "https://www.vrent.ch/cdn/shop/files/Logo_VRENT.png?v=1679230993",
        "https://cdn.shopify.com/s/files/1/0679/0660/1258/files/Logo_VRENT.png?v=1679230993",
    ],
}

# Latin + Latin-1 + Latin-Ext-A + typographic punctuation (de-CH thousands
# separator U+2019, quotes, dashes, ellipsis, bullet, euro).
UNICODE_RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x00FF), (0x0100, 0x017F),
    (0x2013, 0x2014), (0x2018, 0x201E), (0x2022, 0x2022),
    (0x2026, 0x2026), (0x20AC, 0x20AC), (0x2212, 0x2212),
]
UNICODES = [cp for lo, hi in UNICODE_RANGES for cp in range(lo, hi + 1)]


def fetch(url):
    print("fetch", url, flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (VRENT Offerten build)"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def load_font(data):
    from fontTools.ttLib import TTFont
    return TTFont(io.BytesIO(data))


def pin_axes(font, wght):
    """Instance a variable font to a single weight (no-op for static fonts)."""
    if "fvar" not in font:
        return font
    from fontTools.varLib import instancer
    wanted = {"wght": wght, "wdth": 100, "opsz": 14}
    pins = {a.axisTag: wanted.get(a.axisTag, (a.minValue + a.maxValue) / 2)
            for a in font["fvar"].axes}
    instancer.instantiateVariableFont(font, pins, inplace=True)
    return font


def subset_font(font):
    from fontTools import subset
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = [1, 2, 3, 4, 6]
    ss = subset.Subsetter(options=opts)
    ss.populate(unicodes=UNICODES)
    ss.subset(font)
    return font


def font_bytes(font, flavor=None):
    font.flavor = flavor  # None → ttf, "woff2" → woff2 (needs brotli)
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def build_fonts():
    """Write the UI woff2 files; return the base64 TTFs jsPDF embeds."""
    os.makedirs(FONTS_DIR, exist_ok=True)
    pdf_fonts = {}

    archivo_var = fetch(ARCHIVO_VAR_URL)
    for wght in (400, 600, 700, 800):
        font = subset_font(pin_axes(load_font(archivo_var), wght))
        with open(os.path.join(FONTS_DIR, "archivo-%d.woff2" % wght), "wb") as f:
            f.write(font_bytes(font, "woff2"))
        if wght == 400:
            pdf_fonts["archivoRegular"] = base64.b64encode(font_bytes(font, None)).decode()
        if wght == 700:
            pdf_fonts["archivoBold"] = base64.b64encode(font_bytes(font, None)).decode()
        if wght == 800:
            pdf_fonts["archivoBlack"] = base64.b64encode(font_bytes(font, None)).decode()

    for wght, url in PLEX_URLS.items():
        font = subset_font(load_font(fetch(url)))
        with open(os.path.join(FONTS_DIR, "plexmono-%d.woff2" % wght), "wb") as f:
            f.write(font_bytes(font, "woff2"))
        if wght == 400:
            pdf_fonts["mono"] = base64.b64encode(font_bytes(font, None)).decode()

    return pdf_fonts


def get_image(name):
    """Local file first, then the CDN mirrors. Writes the file next to the script."""
    if not os.path.exists(name):
        last = None
        for url in IMAGE_SOURCES[name]:
            try:
                data = fetch(url)
                with open(name, "wb") as f:
                    f.write(data)
                break
            except Exception as e:  # noqa: BLE001 — try the next mirror
                last = e
        else:
            raise SystemExit("could not fetch %s: %s" % (name, last))
    from PIL import Image
    return Image.open(name).convert("RGBA")


def icon(img, size, pad_ratio, bg):
    from PIL import Image
    canvas = Image.new("RGBA", (size, size), bg)
    inner = int(size * (1 - 2 * pad_ratio))
    copy = img.copy()
    copy.thumbnail((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(copy, ((size - copy.width) // 2, (size - copy.height) // 2))
    return canvas


def build_images():
    from PIL import Image

    def autocrop(img):
        """Trim transparent padding so the artwork fills its box."""
        bbox = img.getchannel("A").getbbox()
        return img.crop(bbox) if bbox else img

    logo = autocrop(get_image("logo.png"))
    mark = autocrop(get_image("mark.png"))

    # recompress: palette PNGs keep the flat brand artwork crisp at a
    # fraction of the size (smaller fonts.js and smaller generated PDFs)
    logo.thumbnail((1200, 1200))
    logo.quantize(colors=256, method=Image.FASTOCTREE).save("logo.png", optimize=True)
    small = mark.copy()
    small.thumbnail((256, 256))
    small.quantize(colors=256, method=Image.FASTOCTREE).save("mark.png", optimize=True)

    white = (255, 255, 255, 255)
    icon(mark, 192, 0.10, white).convert("RGB").save(os.path.join(OUT, "icon-192.png"), optimize=True)
    icon(mark, 512, 0.10, white).convert("RGB").save(os.path.join(OUT, "icon-512.png"), optimize=True)
    icon(mark, 180, 0.14, white).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    icon(mark, 64, 0.04, (255, 255, 255, 0)).save(os.path.join(OUT, "favicon.png"), optimize=True)

    shutil.copy("logo.png", "public/logo.png")
    shutil.copy("mark.png", "public/mark.png")


def b64_file(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def main():
    os.makedirs(OUT, exist_ok=True)
    pdf_fonts = build_fonts()
    build_images()

    parts = ["window.VRENT_ASSETS = {", "  fonts: {"]
    parts += ['    %s: "%s",' % (k, v) for k, v in pdf_fonts.items()]
    parts += ["  },",
              '  logo: "%s",' % b64_file("public/logo.png"),
              '  mark: "%s"' % b64_file("public/mark.png"),
              "};", ""]
    with open(os.path.join(OUT, "fonts.js"), "w") as f:
        f.write("\n".join(parts))

    print("assets done", flush=True)


if __name__ == "__main__":
    main()
