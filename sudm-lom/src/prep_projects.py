#!/usr/bin/env python3
"""Пренася подробните страници на проектите и националните програми, които не са сред новините."""
import json, re, io, hashlib, subprocess
from pathlib import Path
from bs4 import BeautifulSoup
from PIL import Image
R = Path(__file__).resolve().parent.parent
pages = json.load(open(R / 'src/pages.json', encoding='utf-8'))
news = json.load(open(R / 'src/news.json', encoding='utf-8'))
have = {n['title'].strip() for n in news}
OUT = R / 'assets/img/news'
ALLOW = {'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'br', 'blockquote', 'b', 'i', 'table', 'tr', 'td', 'th', 'tbody', 'thead'}
def get(u): return subprocess.run(['curl', '-sL', '-m', '40', u], capture_output=True).stdout
def orig(u): return re.sub(r'-\d+x\d+(\.\w+)$', r'\1', u)
def grab(u):
    f = hashlib.md5(u.encode()).hexdigest()[:10] + '.jpg'
    if (OUT / f).exists(): return f
    try: im = Image.open(io.BytesIO(get(u))).convert('RGB')
    except Exception: return None
    if im.width < 320: return None
    w = min(960, im.width); im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(OUT / f, 'JPEG', quality=72, optimize=True, progressive=True); return f
items = []
for sec in ('proekti', 'nacionalni-programi'):
    for b in pages[sec]['blocks']:
        if b['t'] != 'h' or not b.get('url') or b['text'].strip() in have: continue
        u = b['url']; m = re.search(r'/(\d{4})/(\d{2})/(\d{2})/([^/]+)/?$', u)
        if not m: continue
        s = BeautifulSoup(get(u).decode('utf-8', 'ignore'), 'html.parser')
        c = s.select_one('.et_pb_post_content')
        if not c: print('skip', u); continue
        imgs = []; seen = set()
        for im in c.find_all('img'):
            iu = orig(im.get('src', ''))
            if 'uploads' in iu and iu not in seen:
                seen.add(iu)
                if len(imgs) < 4:
                    f = grab(iu)
                    if f: imgs.append({'f': f, 'alt': im.get('alt', '')})
        vids = []
        for v in c.find_all('video'):
            if v.get('src'): vids.append(v['src'])
        for t in c(['script', 'style', 'img', 'figure', 'iframe', 'video', 'audio', 'form']): t.decompose()
        for t in c.find_all(True):
            if t.name not in ALLOW: t.unwrap()
            else: t.attrs = {'href': t['href']} if t.name == 'a' and t.has_attr('href') else {}
        body = re.sub(r'\[/?[a-z_]+[^\]]*\]', '', str(c))
        body = re.sub(r'<(p|h2|h3|h4|li)>\s*(&nbsp;|\s)*</\1>', '', body)
        body = re.sub(r'\n{2,}', '\n', body).strip()
        for v in vids: body += f'\n<figure class="vid"><video controls preload="metadata" src="{v}"></video></figure>'
        text = re.sub(r'\s+', ' ', BeautifulSoup(body, 'html.parser').get_text(' ', strip=True))
        items.append({'slug': m.group(4), 'title': b['text'].strip(), 'date': f'{m.group(1)}-{m.group(2)}-{m.group(3)}', 'section': sec, 'excerpt': text[:200].rsplit(' ', 1)[0] + ('…' if len(text) > 200 else ''), 'body': body, 'imgs': imgs, 'url': u})
        print('ok', m.group(4), len(text), len(imgs))
json.dump(items, open(R / 'src/projects.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
