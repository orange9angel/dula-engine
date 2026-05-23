#!/usr/bin/env python3
"""
Dula Storyboard Preview Generator
=================================
Reads storyboard/check_shot_*.jpg from an episode directory and composes
a single collage grid image for quick visual review before rendering.

Usage:
    python generate_preview.py <episode-dir> [options]

Options:
    --cols N          Number of columns in the grid (auto-computed if omitted)
    --thumb-width W   Width of each thumbnail in pixels (default: 480)
    --gap G           Gap between thumbnails in pixels (default: 4)
    --bg R G B        Background color as three integers 0-255 (default: 32 32 32)
    --quality Q       JPEG output quality 0-100 (default: 92)
    --output NAME     Output filename relative to storyboard/ (default: preview.jpg)

Example:
    python generate_preview.py ./episodes/she_ra --cols 4 --thumb-width 400
"""

import os
import sys
import glob
import argparse
import math
from PIL import Image


def compute_grid(n: int, preferred_cols: int | None = None) -> tuple[int, int]:
    """Compute (rows, cols) for n items.

    If preferred_cols is given, use it directly.
    Otherwise auto-compute to get a roughly square-ish grid,
    preferring more columns than rows for a landscape feel.
    """
    if preferred_cols:
        cols = max(1, preferred_cols)
        rows = math.ceil(n / cols)
        return rows, cols

    # Auto: start from sqrt and adjust for better aspect ratio
    cols = int(math.sqrt(n))
    if cols * cols < n:
        cols += 1
    # Prefer slightly more columns for landscape orientation
    while cols > 1 and math.ceil(n / (cols - 1)) * (cols - 1) >= n:
        cols -= 1
        if cols <= int(math.sqrt(n)):
            break
    cols = max(1, cols)
    rows = math.ceil(n / cols)
    return rows, cols


def create_collage(
    episode_dir: str,
    cols: int | None = None,
    thumb_width: int = 480,
    gap: int = 4,
    bg_color: tuple[int, int, int] = (32, 32, 32),
    quality: int = 92,
    output_name: str = "preview.jpg",
) -> str:
    """Compose a collage from check_shot_*.jpg files.

    Returns the absolute path to the generated preview image.
    """
    board_dir = os.path.join(episode_dir, "storyboard")
    pattern = os.path.join(board_dir, "check_shot_*.jpg")
    shots = sorted(glob.glob(pattern))

    if not shots:
        print(f"[ERROR] No check_shot_*.jpg found in {board_dir}")
        print("        Run 'dula-verify <episode-dir>' first.")
        sys.exit(1)

    n = len(shots)
    rows, cols = compute_grid(n, cols)

    # Determine thumbnail height from first image aspect ratio
    with Image.open(shots[0]) as im:
        aspect = im.height / im.width
    thumb_height = int(thumb_width * aspect)

    # Canvas size
    canvas_w = cols * thumb_width + (cols + 1) * gap
    canvas_h = rows * thumb_height + (rows + 1) * gap

    canvas = Image.new("RGB", (canvas_w, canvas_h), bg_color)

    for idx, path in enumerate(shots):
        r = idx // cols
        c = idx % cols
        x = gap + c * (thumb_width + gap)
        y = gap + r * (thumb_height + gap)

        with Image.open(path) as im:
            # Convert to RGB if necessary (e.g. RGBA or P mode)
            if im.mode != "RGB":
                im = im.convert("RGB")
            thumb = im.resize((thumb_width, thumb_height), Image.LANCZOS)
            canvas.paste(thumb, (x, y))

    output_path = os.path.join(board_dir, output_name)
    canvas.save(output_path, "JPEG", quality=quality, optimize=True)
    print(
        f"[OK] Preview saved: {output_path}\n"
        f"     Grid: {cols} cols x {rows} rows = {n} shots\n"
        f"     Thumbnail: {thumb_width}x{thumb_height}\n"
        f"     Canvas: {canvas_w}x{canvas_h}"
    )
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description="Generate a storyboard collage preview from verify screenshots."
    )
    parser.add_argument("episode_dir", help="Path to the episode directory")
    parser.add_argument(
        "--cols", type=int, default=None, help="Number of columns (auto if omitted)"
    )
    parser.add_argument(
        "--thumb-width",
        type=int,
        default=480,
        help="Thumbnail width in pixels (default: 480)",
    )
    parser.add_argument(
        "--gap", type=int, default=4, help="Gap between thumbnails in pixels (default: 4)"
    )
    parser.add_argument(
        "--bg",
        nargs=3,
        type=int,
        default=[32, 32, 32],
        metavar=("R", "G", "B"),
        help="Background color RGB (default: 32 32 32)",
    )
    parser.add_argument(
        "--quality", type=int, default=92, help="JPEG quality 0-100 (default: 92)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="preview.jpg",
        help="Output filename in storyboard/ (default: preview.jpg)",
    )
    args = parser.parse_args()

    bg_color = tuple(args.bg)
    create_collage(
        episode_dir=args.episode_dir,
        cols=args.cols,
        thumb_width=args.thumb_width,
        gap=args.gap,
        bg_color=bg_color,
        quality=args.quality,
        output_name=args.output,
    )


if __name__ == "__main__":
    main()
