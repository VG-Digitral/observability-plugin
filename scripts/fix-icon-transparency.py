#!/usr/bin/env python3
"""
Make the extension icon marketplace-friendly:
- Converts the black background to transparent (so it looks clean on light marketplace backgrounds)
- Outputs both full-size and 128x128 (recommended marketplace size)
"""
from pathlib import Path

from PIL import Image

MEDIA = Path(__file__).resolve().parent.parent / "media"
SRC = MEDIA / "qapilot-logo.png"
OUT_FULL = MEDIA / "qapilot-logo.png"  # overwrite with transparent version
OUT_128 = MEDIA / "qapilot-logo-128.png"  # optional 128x128 for marketplace

# Pixels darker than this (R,G,B all <= threshold) become transparent.
# Keeps blue/white logo; only removes black border/background.
BLACK_THRESHOLD = 25


def main():
    img = Image.open(SRC).convert("RGBA")
    data = img.getdata()
    new_data = []
    for item in data:
        r, g, b, a = item
        # Make black / near-black pixels fully transparent
        if r <= BLACK_THRESHOLD and g <= BLACK_THRESHOLD and b <= BLACK_THRESHOLD:
            new_data.append((r, g, b, 0))
        else:
            new_data.append(item)
    img.putdata(new_data)
    img.save(OUT_FULL, "PNG")
    print(f"Saved transparent icon: {OUT_FULL}")

    # 128x128 for marketplace (clean scaling from 1024)
    small = img.resize((128, 128), Image.Resampling.LANCZOS)
    small.save(OUT_128, "PNG")
    print(f"Saved 128x128 icon: {OUT_128}")
    print("In package.json you can use: \"icon\": \"media/qapilot-logo.png\" (or qapilot-logo-128.png)")


if __name__ == "__main__":
    main()
