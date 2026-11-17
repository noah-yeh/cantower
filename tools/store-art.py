# -*- coding: utf-8 -*-
"""
商店物料第二步：宣传图与封面（底图 = 去水印后的主标题画）。

输出（store/ 下，全部 ≥ TapTap 最低要求）：
  promo-16x9.jpg   1920×1080  16:9 宣传图（只有游戏名，无其他文字）
  promo-1x1.jpg    1440×1440  方形宣传图（只有游戏名；竖屏游戏传竖版录屏时必交）
  cover-port.jpg   900×1350   竖版封面（≥600×900，带 LOGO+标题）
  cover-land.jpg   920×430    横版封面（≥460×215，带 LOGO+标题）
"""
import os
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, '素材生成', '主标题画.png')
OUT = os.path.join(ROOT, 'store')

art = Image.open(ART).convert('RGB')
W, H = art.size
# 底部 70px 全部覆盖：水印约 55px 高，留 15px 余量
band = art.crop((0, H - 140, W, H - 70))          # 70px 干净带（草地/苔藓纹理）
art.paste(band, (0, H - 70))
art.save(os.path.join(OUT, '_art-clean.png'))  # 留一份干净底图

logo = Image.open(os.path.join(OUT, 'logo.png')).convert('RGBA')

def paste_logo(base, cx_ratio, cy_ratio, width_ratio):
    """把 LOGO 按 base 宽的比例贴到 (cx, cy) 比例位置"""
    lw = int(base.width * width_ratio)
    lh = int(logo.height * lw / logo.width)
    lg = logo.resize((lw, lh), Image.LANCZOS)
    # 轻微投影：深色模糊层垫底，保证浅色区域也能读清
    shadow = Image.new('RGBA', base.size, (0, 0, 0, 0))
    sh = Image.new('RGBA', lg.size, (0, 0, 0, 150))
    mask = lg.split()[3].filter(ImageFilter.GaussianBlur(10))
    px, py = int(base.width * cx_ratio - lw / 2), int(base.height * cy_ratio - lh / 2)
    shadow.paste(sh, (px + 6, py + 8), mask)
    base.alpha_composite(shadow)
    base.alpha_composite(lg, (px, py))

def save_jpg(im, name, quality=90):
    im.convert('RGB').save(os.path.join(OUT, name), quality=quality)
    print(name, im.size, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')

# ------------------------------------------------ 16:9 宣传图（只有游戏名）
c = art.crop((0, 150, 1024, 726))            # 塔身 + 光带
promo = c.resize((1920, 1080), Image.LANCZOS).convert('RGBA')
paste_logo(promo, 0.5, 0.82, 0.34)
save_jpg(promo, 'promo-16x9.jpg')

# ------------------------------------------------ 1:1 方形宣传图（只有游戏名）
c = art.crop((0, 180, 1024, 1204))           # 塔 + 人物头顶
sq = c.resize((1440, 1440), Image.LANCZOS).convert('RGBA')
paste_logo(sq, 0.5, 0.86, 0.36)
save_jpg(sq, 'promo-1x1.jpg')

# ------------------------------------------------ 竖版封面（LOGO+标题）
pt = art.resize((900, 1350), Image.LANCZOS).convert('RGBA')
paste_logo(pt, 0.5, 0.80, 0.52)
save_jpg(pt, 'cover-port.jpg')

# ------------------------------------------------ 横版封面（LOGO+标题）
c = art.crop((0, 330, 1024, 808))            # 2.14:1 的塔身横带
cl = c.resize((920, 430), Image.LANCZOS).convert('RGBA')
paste_logo(cl, 0.5, 0.5, 0.42)
save_jpg(cl, 'cover-land.jpg')
