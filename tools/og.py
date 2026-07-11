# Generate docs/img/og.png (1200x630 Open Graph card) for StageCloset.
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
img = Image.new("RGB", (W, H), "#16110f")
d = ImageDraw.Draw(img)

# curtain band top
d.rectangle([0, 0, W, 14], fill="#a3132e")
d.rectangle([0, 14, W, 18], fill="#d4a545")

def font(path, size):
    return ImageFont.truetype(path, size)

georgia_b = "C:/Windows/Fonts/georgiab.ttf"
georgia = "C:/Windows/Fonts/georgia.ttf"
segoe = "C:/Windows/Fonts/segoeui.ttf"

# diamond mark
cx, cy, r = 120, 200, 56
d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill="#d4a545")
r2 = 26
d.polygon([(cx, cy - r2), (cx + r2, cy), (cx, cy + r2), (cx - r2, cy)], fill="#a3132e")

d.text((205, 150), "StageCloset", font=font(georgia_b, 86), fill="#ece2d0")
d.text((208, 268), "The costume closet binder, computerized.", font=font(georgia, 40), fill="#d4a545")

lines = [
    "Tag every costume and prop, with photos",
    "Check-outs, due dates, and who still has what",
    "Pull sheets by rack, costume plots, strike reports",
    "100% in your browser. No account. Nothing uploads.",
]
y = 380
for ln in lines:
    d.ellipse([96, y + 14, 110, y + 28], fill="#a3132e")
    d.text((130, y), ln, font=font(segoe, 34), fill="#b3a68f")
    y += 56

d.text((96, H - 40), "android-tipster.github.io/stagecloset", font=font(segoe, 24), fill="#6d5c4c")

import os
os.makedirs("docs/img", exist_ok=True)
img.save("docs/img/og.png")
print("wrote docs/img/og.png")
