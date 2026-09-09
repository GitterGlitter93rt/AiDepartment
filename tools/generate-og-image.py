#!/usr/bin/env python3
"""Generate the site's default social-sharing image (public/og-default.png).

Why this is a script and not a binary someone dropped in:
the image is assembled entirely from elements that already exist in this
repository — the brand hex values in src/styles/tokens.css, the YAD mark
in public/icon-512.png, the brand name, and SITE.tagline from
src/lib/site.ts. Keeping the recipe in the repo means the asset can be
regenerated after a brand change instead of being re-created by hand.

Nothing here invents a claim. There is no statistic, no customer count,
no award, and no text that is not already published on the site.

Run:  python3 tools/generate-og-image.py

Requires Pillow, and the Manrope WOFF files that ship with
@fontsource/manrope (already a project dependency). The WOFF-to-TTF step
is inline and stdlib-only, because Pillow cannot read WOFF directly and
adding a font toolchain for one image would be a poor trade.
"""

import glob
import os
import struct
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og-default.png"
MARK = ROOT / "public" / "icon-512.png"
FONT_DIR = ROOT / "node_modules" / "@fontsource" / "manrope" / "files"

# src/styles/tokens.css
MIDNIGHT_NAVY = (0x08, 0x11, 0x1F)
ELECTRIC_BLUE = (0x25, 0x63, 0xEB)
SIGNAL_CYAN = (0x22, 0xD3, 0xEE)
PURE_WHITE = (0xFF, 0xFF, 0xFF)
MUTED = (0x94, 0xA3, 0xB8)

W, H = 1200, 630


def woff_to_ttf(src: Path, dst: Path) -> Path:
    """WOFF 1.0 is an SFNT whose tables are individually zlib-compressed,
    behind a 44-byte header. Unwrapping it needs no third-party code."""
    data = src.read_bytes()
    sig, _flavor, _length, num_tables = struct.unpack(">4sIIH", data[:14])
    assert sig == b"wOFF", f"{src} is not WOFF 1.0"

    entries = []
    off = 44
    for _ in range(num_tables):
        tag, offset, comp_len, orig_len, checksum = struct.unpack(">4sIIII", data[off : off + 20])
        off += 20
        raw = data[offset : offset + comp_len]
        table = raw if comp_len == orig_len else zlib.decompress(raw)
        assert len(table) == orig_len, f"{tag!r} decompressed to the wrong length"
        entries.append((tag, table, checksum))

    entries.sort(key=lambda e: e[0])
    n = len(entries)
    search_range = (2 ** (n.bit_length() - 1)) * 16
    entry_selector = n.bit_length() - 1
    range_shift = n * 16 - search_range

    head = bytearray(struct.pack(">IHHHH", 0x00010000, n, search_range, entry_selector, range_shift))
    body = bytearray()
    data_off = 12 + n * 16
    for tag, table, checksum in entries:
        head += struct.pack(">4sIII", tag, checksum, data_off + len(body), len(table))
        body += table + b"\x00" * ((-len(table)) % 4)

    dst.write_bytes(bytes(head) + bytes(body))
    return dst


def load_font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    matches = glob.glob(str(FONT_DIR / f"manrope-latin-{weight}-normal.woff"))
    if not matches:
        raise SystemExit(f"Manrope {weight} not found — run npm install first")
    ttf = ROOT / "public" / f".manrope-{weight}.ttf"
    woff_to_ttf(Path(matches[0]), ttf)
    font = ImageFont.truetype(str(ttf), size)
    ttf.unlink()  # a build artefact, not something to commit
    return font


def radial_wash(size, center, radius, color, peak_alpha):
    """One of the site's decorative radial gradients, as a soft-light
    overlay. Same shape as the CSS in InteriorHero.astro."""
    w, h = size
    layer = Image.new("RGBA", (w, h), (*color, 0))
    mask = Image.new("L", (w // 4, h // 4), 0)
    md = ImageDraw.Draw(mask)
    cx, cy = center[0] // 4, center[1] // 4
    r = radius // 4
    steps = 48
    for i in range(steps, 0, -1):
        frac = i / steps
        alpha = int(peak_alpha * (1 - frac) ** 1.6)
        md.ellipse([cx - r * frac, cy - r * frac, cx + r * frac, cy + r * frac], fill=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(6)).resize((w, h), Image.LANCZOS)
    layer.putalpha(mask)
    return layer


def main() -> None:
    img = Image.new("RGB", (W, H), MIDNIGHT_NAVY).convert("RGBA")

    # Dot grid, matching the interior hero's SVG pattern.
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for y in range(0, H, 26):
        for x in range(0, W, 26):
            fade = max(0.0, 1.0 - (y / (H * 0.8)))
            a = int(38 * fade)
            if a > 0:
                gd.ellipse([x, y, x + 2, y + 2], fill=(148, 163, 184, a))
    img = Image.alpha_composite(img, grid)

    img = Image.alpha_composite(img, radial_wash((W, H), (180, 130), 760, ELECTRIC_BLUE, 150))
    img = Image.alpha_composite(img, radial_wash((W, H), (1050, 60), 620, SIGNAL_CYAN, 95))

    draw = ImageDraw.Draw(img)

    # The existing YAD mark, top-left of the content block.
    mark = Image.open(MARK).convert("RGBA").resize((128, 128), Image.LANCZOS)
    img.alpha_composite(mark, (88, 92))

    wordmark = load_font("800", 34)
    draw.text((236, 128), "YOUR", font=wordmark, fill=PURE_WHITE)
    w_your = draw.textlength("YOUR ", font=wordmark)
    draw.text((236 + w_your, 128), "AI", font=wordmark, fill=SIGNAL_CYAN)
    w_ai = draw.textlength("AI ", font=wordmark)
    draw.text((236 + w_your + w_ai, 128), "DEPARTMENT", font=wordmark, fill=PURE_WHITE)

    headline = load_font("800", 72)
    draw.text((88, 272), "Practical AI.", font=headline, fill=PURE_WHITE)
    draw.text((88, 360), "Real Business Value.", font=headline, fill=PURE_WHITE)

    # Accent rule, in the site's primary gradient direction.
    for i in range(150):
        t = i / 149
        c = tuple(int(ELECTRIC_BLUE[k] + (SIGNAL_CYAN[k] - ELECTRIC_BLUE[k]) * t) for k in range(3))
        draw.rectangle([88 + i, 472, 88 + i + 1, 478], fill=c)

    sub = load_font("700", 27)
    draw.text((88, 506), "AI strategy, implementation, and growth systems", font=sub, fill=MUTED)
    draw.text((88, 544), "youraidepartment.ai", font=sub, fill=SIGNAL_CYAN)

    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {W}x{H})")


if __name__ == "__main__":
    main()
