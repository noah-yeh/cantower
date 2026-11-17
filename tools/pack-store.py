# -*- coding: utf-8 -*-
"""
打 H5 上传包（store/残塔-h5-上传包.zip）：只含运行时文件，index.html 在包根。
剔除 tools / tests / 资料表 / 素材 / node_modules / store 等开发目录。
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'store', '残塔-h5-上传包.zip')

INCLUDE_FILES = ['index.html', 'style.css', 'sw.js', 'manifest.webmanifest']
INCLUDE_DIRS = ['src', 'assets', 'icons', 'data', 'legal']
SKIP_EXT = {'.py', '.mjs', '.md', '.log'}
SKIP_PREFIX = ('~$', '.')

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in INCLUDE_FILES:
        z.write(os.path.join(ROOT, f), f)
        print('+', f)
    for d in INCLUDE_DIRS:
        base = os.path.join(ROOT, d)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if not x.startswith('.')]
            for fn in filenames:
                if fn.startswith(SKIP_PREFIX) or os.path.splitext(fn)[1] in SKIP_EXT:
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ROOT).replace('\\', '/')
                z.write(full, rel)
        print('+', d + '/')

print('ZIP ->', OUT, round(os.path.getsize(OUT) / 1024 / 1024, 2), 'MB')
