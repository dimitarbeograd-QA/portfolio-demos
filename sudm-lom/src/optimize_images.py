#!/usr/bin/env python3
"""Прави миниатюри за новините (400 px), запомня размерите на снимките и малка версия на снимката на сградата."""
import json
from pathlib import Path
from PIL import Image
R = Path(__file__).resolve().parent.parent
news = json.load(open(R / 'src/news.json', encoding='utf-8'))
for n in news:
    for g in n['imgs']:
        src = R / 'assets/img/news' / g['f']
        im = Image.open(src); g['w'], g['h'] = im.size
        t = R / 'assets/img/news' / ('t-' + g['f'])
        w = 400; h = round(im.height * w / im.width)
        if not t.exists():
            im.convert('RGB').resize((w, h), Image.LANCZOS).save(t, 'JPEG', quality=70, optimize=True, progressive=True)
        g['tw'], g['th'] = w, h
json.dump(news, open(R / 'src/news.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
s = R / 'assets/img/school.jpg'; o = R / 'assets/img/school-640.jpg'
if not o.exists():
    im = Image.open(s).convert('RGB'); im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS).save(o, 'JPEG', quality=72, optimize=True, progressive=True)
print('ok')
