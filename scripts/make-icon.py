#!/usr/bin/env python3
"""生成 MoDex 应用图标 assets/icon.ico（多尺寸，近黑圆角底 + 白色 M 标记）。

风格对齐 MoDex 界面：单色、几何、无渐变。
用法：python scripts/make-icon.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
SIZES = [16, 24, 32, 48, 64, 128, 256]

BACKGROUND = (23, 24, 26, 255)  # #17181a，近黑中性
GLYPH = (250, 250, 248, 255)  # #fafaf8，暖白


def rounded_background(size: int) -> Image.Image:
    """近黑圆角方形底。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = max(int(size * 0.22), 2)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    canvas.paste(Image.new("RGBA", (size, size), BACKGROUND), (0, 0), mask)
    return canvas


def draw_mark(image: Image.Image) -> Image.Image:
    """在图标中央画白色描边 M：几何、圆角转折、与界面品牌标记一致。"""
    size = image.size[0]
    draw = ImageDraw.Draw(image)
    stroke = max(int(size * 0.085), 2)
    left = size * 0.27
    right = size * 0.73
    top = size * 0.3
    bottom = size * 0.7
    mid_y = size * 0.55
    points = [
        (left, bottom),
        (left, top),
        (size / 2, mid_y),
        (right, top),
        (right, bottom),
    ]
    draw.line(points, fill=GLYPH, width=stroke, joint="curve")
    # 端点为圆头，避免小尺寸发虚
    radius = stroke / 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=GLYPH)
    return image


def main() -> None:
    os.makedirs(ASSETS, exist_ok=True)
    base = draw_mark(rounded_background(256))
    frames = [base.resize((size, size), Image.LANCZOS) for size in SIZES]
    ico_path = os.path.join(ASSETS, "icon.ico")
    frames[-1].save(ico_path, format="ICO", sizes=[(size, size) for size in SIZES])
    png_path = os.path.join(ASSETS, "icon.png")
    base.save(png_path, format="PNG")
    print(f"icon.ico -> {ico_path} ({os.path.getsize(ico_path)} bytes)")
    print(f"icon.png -> {png_path} ({os.path.getsize(png_path)} bytes)")


if __name__ == "__main__":
    main()
