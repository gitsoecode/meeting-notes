#!/usr/bin/env python3

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "assets"
ICONSET_DIR = ROOT / "build" / "app-icon.iconset"
APP_ICON_PATH = ASSETS_DIR / "app-icon.png"
APP_ICNS_PATH = ASSETS_DIR / "app-icon.icns"
APP_SVG_PATH = ASSETS_DIR / "icon.svg"
TRAY_SVG_PATH = ASSETS_DIR / "icon-tray.svg"

GREEN_TOP = "#2D6B3F"
GREEN_BOTTOM = "#214F2F"
WHITE = "#FFFFFF"
BLACK = "#000000"

BAR_SHAPES = (
    (278, 434, 54, 104),
    (376, 369, 54, 234),
    (475, 303, 54, 104),
    (475, 540, 54, 127),
    (573, 369, 54, 104),
)
DOT_CENTER = (692, 455)
DOT_RADIUS = 30
SMALL_SPARKLE_CENTER = (512, 460)
SMALL_SPARKLE_SIZE = 130
SMALL_SPARKLE_THICKNESS = 52
LARGE_SPARKLE_CENTER = (627, 564)
LARGE_SPARKLE_SIZE = 188
LARGE_SPARKLE_THICKNESS = 76
TRAY_GLYPH_CENTER = (500, 485)
TRAY_GLYPH_SCALE = 1.55


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def draw_rounded_rect(
    draw: ImageDraw.ImageDraw,
    box: tuple[float, float, float, float],
    radius: float,
    fill: tuple[int, int, int, int] | str,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_sparkle(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    size: float,
    thickness: float,
    fill: tuple[int, int, int, int] | str,
) -> None:
    cx, cy = center
    half = size / 2
    radius = thickness / 2
    draw_rounded_rect(draw, (cx - radius, cy - half, cx + radius, cy + half), radius, fill)
    draw_rounded_rect(draw, (cx - half, cy - radius, cx + half, cy + radius), radius, fill)


def resize_box(box: tuple[int, int, int, int], scale: float) -> tuple[float, float, float, float]:
    x, y, width, height = box
    return (x * scale, y * scale, (x + width) * scale, (y + height) * scale)


def scale_point(
    point: tuple[int, int], center: tuple[int, int], multiplier: float
) -> tuple[float, float]:
    px, py = point
    cx, cy = center
    return (cx + (px - cx) * multiplier, cy + (py - cy) * multiplier)


def resize_box_around(
    box: tuple[int, int, int, int],
    scale: float,
    center: tuple[int, int],
    multiplier: float,
) -> tuple[float, float, float, float]:
    x0, y0 = scale_point((box[0], box[1]), center, multiplier)
    x1, y1 = scale_point((box[0] + box[2], box[1] + box[3]), center, multiplier)
    return (x0 * scale, y0 * scale, x1 * scale, y1 * scale)


def render_app_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = size / 1024

    top = hex_to_rgb(GREEN_TOP)
    bottom = hex_to_rgb(GREEN_BOTTOM)
    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient_draw = ImageDraw.Draw(gradient)
    tile_box = resize_box((96, 96, 832, 832), scale)
    radius = 196 * scale

    for index in range(size):
        blend = index / max(size - 1, 1)
        color = tuple(
            round(top[channel] * (1 - blend) + bottom[channel] * blend)
            for channel in range(3)
        ) + (255,)
        gradient_draw.line((0, index, size, index), fill=color)

    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(tile_box, radius=radius, fill=255)
    image.paste(gradient, (0, 0), mask)

    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph_draw = ImageDraw.Draw(glyph)
    for shape in BAR_SHAPES:
        x0, y0, x1, y1 = resize_box(shape, scale)
        glyph_draw.rounded_rectangle((x0, y0, x1, y1), radius=27 * scale, fill=WHITE)
    draw_sparkle(
        glyph_draw,
        (SMALL_SPARKLE_CENTER[0] * scale, SMALL_SPARKLE_CENTER[1] * scale),
        SMALL_SPARKLE_SIZE * scale,
        SMALL_SPARKLE_THICKNESS * scale,
        WHITE,
    )
    draw_sparkle(
        glyph_draw,
        (LARGE_SPARKLE_CENTER[0] * scale, LARGE_SPARKLE_CENTER[1] * scale),
        LARGE_SPARKLE_SIZE * scale,
        LARGE_SPARKLE_THICKNESS * scale,
        WHITE,
    )
    glyph_draw.ellipse(
        (
            (DOT_CENTER[0] - DOT_RADIUS) * scale,
            (DOT_CENTER[1] - DOT_RADIUS) * scale,
            (DOT_CENTER[0] + DOT_RADIUS) * scale,
            (DOT_CENTER[1] + DOT_RADIUS) * scale,
        ),
        fill=WHITE,
    )

    return Image.alpha_composite(image, glyph)


def render_tray_icon(size: int) -> Image.Image:
    image = Image.new("L", (size, size), 0)
    scale = size / 1024
    draw = ImageDraw.Draw(image)

    for shape in BAR_SHAPES:
        x0, y0, x1, y1 = resize_box_around(
            shape, scale, TRAY_GLYPH_CENTER, TRAY_GLYPH_SCALE
        )
        draw.rounded_rectangle((x0, y0, x1, y1), radius=27 * scale, fill=255)
    small_center = scale_point(SMALL_SPARKLE_CENTER, TRAY_GLYPH_CENTER, TRAY_GLYPH_SCALE)
    draw_sparkle(
        draw,
        (small_center[0] * scale, small_center[1] * scale),
        SMALL_SPARKLE_SIZE * TRAY_GLYPH_SCALE * scale,
        SMALL_SPARKLE_THICKNESS * TRAY_GLYPH_SCALE * scale,
        255,
    )
    large_center = scale_point(LARGE_SPARKLE_CENTER, TRAY_GLYPH_CENTER, TRAY_GLYPH_SCALE)
    draw_sparkle(
        draw,
        (large_center[0] * scale, large_center[1] * scale),
        LARGE_SPARKLE_SIZE * TRAY_GLYPH_SCALE * scale,
        LARGE_SPARKLE_THICKNESS * TRAY_GLYPH_SCALE * scale,
        255,
    )
    dot_center = scale_point(DOT_CENTER, TRAY_GLYPH_CENTER, TRAY_GLYPH_SCALE)
    draw.ellipse(
        (
            (dot_center[0] - DOT_RADIUS * TRAY_GLYPH_SCALE) * scale,
            (dot_center[1] - DOT_RADIUS * TRAY_GLYPH_SCALE) * scale,
            (dot_center[0] + DOT_RADIUS * TRAY_GLYPH_SCALE) * scale,
            (dot_center[1] + DOT_RADIUS * TRAY_GLYPH_SCALE) * scale,
        ),
        fill=255,
    )

    # A subtle blur keeps the tiny glyph from feeling jagged once the alpha mask is
    # converted into a black template icon.
    softened = image.filter(ImageFilter.GaussianBlur(radius=max(size / 64, 0.5)))
    rgba = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rgba.putalpha(softened)
    return rgba


def write_svg_files() -> None:
    app_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="meeting-notes-bg" x1="50%" x2="50%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="{GREEN_TOP}" />
      <stop offset="100%" stop-color="{GREEN_BOTTOM}" />
    </linearGradient>
  </defs>
  <rect x="96" y="96" width="832" height="832" rx="196" fill="url(#meeting-notes-bg)" />
  <g fill="{WHITE}">
    <rect x="278" y="434" width="54" height="104" rx="27" />
    <rect x="376" y="369" width="54" height="234" rx="27" />
    <rect x="475" y="303" width="54" height="104" rx="27" />
    <rect x="475" y="540" width="54" height="127" rx="27" />
    <rect x="573" y="369" width="54" height="104" rx="27" />
    <rect x="486" y="395" width="52" height="130" rx="26" />
    <rect x="447" y="434" width="130" height="52" rx="26" />
    <rect x="589" y="470" width="76" height="188" rx="38" />
    <rect x="533" y="526" width="188" height="76" rx="38" />
    <circle cx="692" cy="455" r="30" />
  </g>
</svg>
"""
    tray_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g fill="{BLACK}">
    <rect x="278" y="434" width="54" height="104" rx="27" />
    <rect x="376" y="369" width="54" height="234" rx="27" />
    <rect x="475" y="303" width="54" height="104" rx="27" />
    <rect x="475" y="540" width="54" height="127" rx="27" />
    <rect x="573" y="369" width="54" height="104" rx="27" />
    <rect x="486" y="395" width="52" height="130" rx="26" />
    <rect x="447" y="434" width="130" height="52" rx="26" />
    <rect x="589" y="470" width="76" height="188" rx="38" />
    <rect x="533" y="526" width="188" height="76" rx="38" />
    <circle cx="692" cy="455" r="30" />
  </g>
</svg>
"""
    APP_SVG_PATH.write_text(app_svg, encoding="utf-8")
    TRAY_SVG_PATH.write_text(tray_svg, encoding="utf-8")


def build_icns(source_path: Path) -> None:
    ensure_clean_dir(ICONSET_DIR)
    sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for filename, size in sizes.items():
        subprocess.run(
            [
                "/usr/bin/sips",
                "-z",
                str(size),
                str(size),
                str(source_path),
                "--out",
                str(ICONSET_DIR / filename),
            ],
            check=True,
            capture_output=True,
            text=True,
        )

    try:
        subprocess.run(
            ["/usr/bin/iconutil", "-c", "icns", str(ICONSET_DIR), "-o", str(APP_ICNS_PATH)],
            check=True,
        )
    except subprocess.CalledProcessError as error:
        if not APP_ICNS_PATH.exists():
            raise
        print(
            "warning: iconutil could not regenerate app-icon.icns in the current sandbox; "
            "keeping the existing .icns file",
            flush=True,
        )


def main() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    write_svg_files()

    render_app_icon(1024).save(APP_ICON_PATH)
    build_icns(APP_ICON_PATH)

    for filename, size in (
        ("tray-idleTemplate.png", 16),
        ("tray-idleTemplate@2x.png", 32),
        ("tray-recordingTemplate.png", 16),
        ("tray-recordingTemplate@2x.png", 32),
    ):
        render_tray_icon(size).save(ASSETS_DIR / filename)


if __name__ == "__main__":
    main()
