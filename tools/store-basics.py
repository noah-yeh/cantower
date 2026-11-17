# -*- coding: utf-8 -*-
"""
商店物料第一步：去水印 + 商店图标 + 透明 LOGO。

输入：素材生成/主标题画.png（1024×1536，右下角有 AI 生成水印）
输出：store/ 下
  icon-1024.png / icon-512.png  —— TapTap 图标（方图，插画裁方，非纯色底）
  logo.png                      —— 透明底「残塔」隶书 LOGO（1600×640）
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, '素材生成', '主标题画.png')
OUT = os.path.join(ROOT, 'store')
os.makedirs(OUT, exist_ok=True)

art = Image.open(ART).convert('RGB')
W, H = art.size  # 1024 x 1536

# ---------------------------------------------------------------- 去水印
# 水印在最底部约 40px。把水印区上方一条干净的带子镜像贴过去，视觉上无缝。
# 底部 70px 全部覆盖：水印约 55px 高，留 15px 余量
band = art.crop((0, H - 140, W, H - 70))          # 70px 干净带（草地/苔藓纹理）
art.paste(band, (0, H - 70))

# ---------------------------------------------------------------- 商店图标
# 裁上部塔身：塔尖 + 云隙光 + 蓝色光带，主体在方图中央偏上，小尺寸可辨。
icon = art.crop((0, 0, 1024, 1024))
icon.save(os.path.join(OUT, 'icon-1024.png'))
icon.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'))
icon.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, 'icon-192.png'))

# ---------------------------------------------------------------- LOGO
CANVAS_W, CANVAS_H = 1600, 640
TEXT = '残塔'
FONT_PATH = r'C:\Windows\Fonts\SIMLI.TTF'   # 隶书：暗黑奇幻味最浓
font = ImageFont.truetype(FONT_PATH, 430)

canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))

# 文字遮罩（无描边，用来贴金色渐变）
mask_img = Image.new('L', (CANVAS_W, CANVAS_H), 0)
ImageDraw.Draw(mask_img).text(
    (CANVAS_W // 2, CANVAS_H // 2 - 10), TEXT, font=font, fill=255, anchor='mm')

# 深色描边层：先画一圈粗描边
stroke_img = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
ImageDraw.Draw(stroke_img).text(
    (CANVAS_W // 2, CANVAS_H // 2 - 10), TEXT, font=font,
    fill=(24, 14, 6, 255), anchor='mm', stroke_width=16, stroke_fill=(24, 14, 6, 255))

# 金色渐变（上亮下深，仿鎏金）
grad = Image.new('RGBA', (CANVAS_W, CANVAS_H))
gd = ImageDraw.Draw(grad)
top, bottom = (255, 226, 140), (196, 138, 44)
for y in range(CANVAS_H):
    t = y / CANVAS_H
    c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    gd.line([(0, y), (CANVAS_W, y)], fill=c + (255,))

# 柔光晕：把遮罩模糊后垫在描边底下，暖金微光
glow = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
glow_mask = mask_img.filter(ImageFilter.GaussianBlur(18))
glow.paste(Image.new('RGBA', (CANVAS_W, CANVAS_H), (255, 196, 90, 110)),
           (0, 0), glow_mask)

canvas = Image.alpha_composite(canvas, glow)
canvas = Image.alpha_composite(canvas, stroke_img)
canvas.paste(grad, (0, 0), mask_img)
canvas.save(os.path.join(OUT, 'logo.png'))

print('OK ->', OUT)
for f in ('icon-1024.png', 'icon-512.png', 'logo.png'):
    p = os.path.join(OUT, f)
    print(f, Image.open(p).size, os.path.getsize(p) // 1024, 'KB')
