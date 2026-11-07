"""Draw the extension icons (a card with a % mark) into extension/icons/."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
TEAL = (15, 123, 108, 255)
WHITE = (255, 255, 255, 255)
GOLD = (243, 180, 60, 255)
S = 512  # draw large, then downscale


def draw() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([16, 16, S - 16, S - 16], radius=110, fill=TEAL)
    # card
    d.rounded_rectangle([86, 140, S - 86, S - 140], radius=36, fill=WHITE)
    d.rectangle([86, 196, S - 86, 246], fill=(15, 123, 108, 90))
    # % badge
    cx, cy, r = S - 150, S - 150, 92
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GOLD, outline=TEAL, width=14)
    d.ellipse([cx - 50, cy - 50, cx - 14, cy - 14], fill=TEAL)
    d.ellipse([cx + 14, cy + 14, cx + 50, cy + 50], fill=TEAL)
    d.line([cx + 44, cy - 44, cx - 44, cy + 44], fill=TEAL, width=16)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    big = draw()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
    print("wrote", ", ".join(f"icon{s}.png" for s in (16, 32, 48, 128)))


if __name__ == "__main__":
    main()
