#!/usr/bin/env python3
"""Генератор на статичния сайт на СУ „Димитър Маринов“ – Лом.
Пуска се с:  python3 src/build.py
Чете src/pages.json и src/news.json и записва готовите страници в корена на хранилището.
Незадължително: SITE_URL=https://... python3 src/build.py  (за sitemap.xml и адреси за споделяне)
"""
import json, os, re, html, shutil
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SRC = ROOT_DIR / 'src'
SITE_URL = os.environ.get('SITE_URL', '').rstrip('/')
BASE_PATH = os.environ.get('BASE_PATH', '/')          # за 404.html, напр. /sudm-lom-new/
OLD = 'https://sudm-lom.bg'
SCHOOL = 'СУ „Димитър Маринов“'

PAGES = json.load(open(SRC / 'pages.json', encoding='utf-8'))
NEWS = json.load(open(SRC / 'news.json', encoding='utf-8'))
NEWS.sort(key=lambda n: n['date'], reverse=True)

MONTHS = ['', 'януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември']
MON_S = ['', 'яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек']

def esc(s): return html.escape(s or '', quote=True)
def bg_date(d):
    y, m, dd = d.split('-'); return f'{int(dd)} {MONTHS[int(m)]} {y}'
def bg_date_s(d):
    y, m, dd = d.split('-'); return f'{int(dd)} {MON_S[int(m)]} {y}'

TITLES = {
    'za-nas': 'Мисия и визия', 'patron': 'Патрон', 'istoriya': 'История', 'ekip': 'Екип',
    'obshtestven-suvet': 'Обществен съвет', 'lichni-danni': 'Защита на личните данни',
    'iziavi': 'Изяви и постижения', 'priem-1-klas': 'Прием в 1. клас', 'priem-5-klas': 'Прием в 5. клас',
    'priem-8-klas': 'Прием в 8. клас', 'normativni-dokumenti': 'Нормативни документи',
    'uchebni-planove': 'Учебни планове', 'byudzhet': 'Бюджет', 'obrazci': 'Образци на документи',
    'bdp': 'Безопасни условия на труд (БДП)', 'proekti': 'Проекти', 'nacionalni-programi': 'Национални програми',
    'kontakti': 'Контакти',
}
LEADS = {
    'za-nas': 'Какво вярваме и накъде вървим.',
    'patron': 'Кой е Димитър Маринов и защо училището носи името му.',
    'istoriya': 'Повече от 55 години развитие на училището.',
    'ekip': 'Директор, учители и специалисти.',
    'obshtestven-suvet': 'Членове и документи на Обществения съвет.',
    'lichni-danni': 'Как защитаваме личните данни на учениците и родителите.',
    'iziavi': 'Постижения и отличия на нашите ученици.',
    'priem-1-klas': 'Планове, срокове и свободни места за първокласници.',
    'priem-5-klas': 'Планове, срокове и свободни места за пети клас.',
    'priem-8-klas': 'График, профили и свободни места след 7. клас.',
    'normativni-dokumenti': 'Правилници, планове и други задължителни документи.',
    'uchebni-planove': 'Учебни планове по класове и етапи.',
    'byudzhet': 'Утвърден бюджет, отчети и информация за изпълнението.',
    'obrazci': 'Заявления и образци, готови за попълване.',
    'bdp': 'Безопасност на движението по пътищата.',
    'proekti': 'Европейски и национални проекти, по които работи училището.',
    'nacionalni-programi': 'Национални програми, в които участва училището.',
    'kontakti': 'Адрес, телефони, имейл и работно време.',
}

# ------------------------------------------------------------------ навигация
NAV = [
    ('За училището', [('Мисия и визия', 'za-nas'), ('Патрон', 'patron'), ('История', 'istoriya'), ('Екип', 'ekip'), ('Обществен съвет', 'obshtestven-suvet'), ('Защита на личните данни', 'lichni-danni')]),
    ('Прием', [('Прием – общо', 'priem'), ('Прием в 1. клас', 'priem-1-klas'), ('Прием в 5. клас', 'priem-5-klas'), ('Прием в 8. клас', 'priem-8-klas')]),
    ('Документи', [('Всички документи', 'dokumenti'), ('Нормативни документи', 'normativni-dokumenti'), ('Учебни планове', 'uchebni-planove'), ('Бюджет', 'byudzhet'), ('Образци на документи', 'obrazci'), ('БДП', 'bdp')]),
    ('Проекти', [('Проекти', 'proekti'), ('Национални програми', 'nacionalni-programi')]),
    ('Изяви', 'iziavi'), ('Изпити', 'izpiti'), ('Новини', 'novini'), ('Контакти', 'kontakti'),
]
GROUPS = {}   # slug -> (име на групата, [(име, slug)])
for n in NAV:
    if isinstance(n[1], list):
        for _, s in n[1]: GROUPS[s] = (n[0], n[1])

SEARCH = []   # [заглавие, раздел, път]

def link(root, slug):
    """Връзка към страница. Използваме index.html, за да работи и при отваряне на файловете директно."""
    return f'{root}index.html' if slug == '' else f'{root}{slug}/index.html'

ICONS = '''<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M21 13a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></symbol>
<symbol id="i-phone" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></symbol>
<symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
</svg>'''

MAP = 'https://www.google.com/maps/search/?api=1&amp;query=%D1%83%D0%BB.%20%D0%94%D0%B8%D0%BD%D0%B0%D0%B2%D1%81%D0%BA%D0%B0%2067%20%D0%9B%D0%BE%D0%BC'

def nav_html(root, active):
    out = []
    for i, n in enumerate(NAV):
        name, tgt = n
        if isinstance(tgt, list):
            cur = any(s == active for _, s in tgt)
            li = ''.join(f'<li><a href="{link(root, s)}"{" aria-current=\"page\"" if s == active else ""}>{esc(t)}</a></li>' for t, s in tgt)
            out.append(f'<li class="has{" end" if i >= len(NAV) - 4 else ""}"><button class="nl" type="button" aria-expanded="false" aria-controls="m{i}">{esc(name)} <svg class="ico chev"><use href="#i-chev"/></svg></button><div class="menu" id="m{i}"><ul>{li}</ul></div></li>')
        else:
            cur = ' aria-current="page"' if tgt == active else ''
            out.append(f'<li><a class="nl" href="{link(root, tgt)}"{cur}>{esc(name)}</a></li>')
    out.append(f'<li class="mob-only"><a class="nl" href="https://app.shkolo.bg/">Е-дневник</a></li>')
    out.append(f'<li class="mob-only"><a class="nl" href="{link(root, "roditeli-i-uchenici")}">За родители и ученици</a></li>')
    return '\n'.join(out)

def layout(depth, slug, title, desc, body, og_img='assets/img/school.jpg', extra_head='', is_home=False):
    root = '../' * depth
    full_title = SCHOOL + ' – Лом' if is_home else f'{title} – {SCHOOL} – Лом'
    canon = f'<link rel="canonical" href="{SITE_URL}/{slug + "/" if slug else ""}">' if SITE_URL else ''
    ogu = f'<meta property="og:image" content="{SITE_URL}/{og_img}">' if SITE_URL else ''
    return f'''<!doctype html>
<html lang="bg" data-root="{root}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(full_title)}</title>
<meta name="description" content="{esc(desc)}">
<meta property="og:type" content="website"><meta property="og:title" content="{esc(full_title)}"><meta property="og:description" content="{esc(desc)}">{ogu}
{canon}
<meta name="theme-color" content="#8a1c4f">
<link rel="icon" href="{root}assets/img/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:opsz,wght@7..72,500;7..72,700&family=Manrope:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="{root}assets/css/style.css">
{extra_head}
</head>
<body>
{ICONS}
<a class="skip" href="#main">Към съдържанието</a>
<div class="wrap top">
  <em>Ако успееш тук, ще успееш навсякъде!</em>
  <div class="tools">
    <a class="pill txt" href="https://app.shkolo.bg/">Е-дневник</a>
    <a class="pill txt" href="{link(root, 'roditeli-i-uchenici')}">За родители и ученици</a>
    <button class="pill" type="button" data-search aria-label="Търсене в сайта"><svg class="ico"><use href="#i-search"/></svg><span class="txt">Търсене</span></button>
    <button class="pill" type="button" id="themeBtn" aria-label="Смени светла или тъмна тема"><svg class="ico"><use href="#i-moon"/></svg><span class="txt">Тема</span></button>
  </div>
</div>
<header class="bar" id="bar">
  <div class="wrap">
    <a class="brand" href="{link(root, '')}" aria-label="{SCHOOL}, начало">
      <img class="logo" src="{root}assets/img/logo.png" alt="" width="240" height="141">
      <span><b>{SCHOOL}</b><small>град Лом</small></span>
    </a>
    <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="nav">Меню</button>
    <nav class="main" id="nav" aria-label="Основно меню"><ul>
{nav_html(root, slug)}
    </ul></nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer>
  <div class="wrap cols">
    <div>
      <img class="logo" src="{root}assets/img/logo.png" alt="{SCHOOL}" width="240" height="141">
      <h2>{SCHOOL} – Лом</h2>
      <p style="margin:0 0 6px">Ако успееш тук, ще успееш навсякъде!</p>
      <p style="margin:0">гр. Лом, ул. Динавска №67<br>тел./факс: 0894 472 694<br>info-1209005@edu.mon.bg</p>
    </div>
    <div>
      <h2>Раздели</h2>
      <a href="{link(root, 'za-nas')}">За училището</a><a href="{link(root, 'priem')}">Прием</a><a href="{link(root, 'dokumenti')}">Документи</a><a href="{link(root, 'proekti')}">Проекти</a><a href="{link(root, 'izpiti')}">Изпити</a><a href="{link(root, 'novini')}">Новини</a><a href="{link(root, 'kontakti')}">Контакти</a>
    </div>
    <div>
      <h2>Връзки</h2>
      <a href="https://app.shkolo.bg/">Е-дневник</a><a href="https://web.mon.bg/mon/">МОН</a><a href="https://ruo-montana.bg/">РУО Монтана</a><a href="https://www.lom.bg/">Община Лом</a>
      <a href="https://www.facebook.com/people/%D0%A1%D0%A3-%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80-%D0%9C%D0%B0%D1%80%D0%B8%D0%BD%D0%BE%D0%B2/100063863358048/">Facebook</a><a href="https://www.youtube.com/@avstudio_sudm_lom9515">YouTube</a>
    </div>
  </div>
  <div class="wrap"><small>© {SCHOOL}, град Лом. Съдържанието е пренесено от sudm-lom.bg.</small></div>
</footer>

<dialog id="dlgContact" aria-labelledby="cTitle">
  <div class="dh"><h2 id="cTitle">Бързи контакти</h2><button class="x" type="button" data-close aria-label="Затвори"><svg class="ico"><use href="#i-x"/></svg></button></div>
  <div class="db">
    <div class="field"><svg class="ico"><use href="#i-pin"/></svg><div><small>Адрес</small><b>гр. Лом, ул. Динавска №67</b></div><a class="copy" style="text-decoration:none" href="{MAP}">Карта</a></div>
    <div class="field"><svg class="ico"><use href="#i-phone"/></svg><div><small>Телефон / факс</small><b>0894 472 694</b></div><button class="copy" type="button" data-copy="0894472694">Копирай</button></div>
    <div class="field"><svg class="ico"><use href="#i-phone"/></svg><div><small>Администрация</small><b>0971 60011</b></div><button class="copy" type="button" data-copy="097160011">Копирай</button></div>
    <div class="field"><svg class="ico"><use href="#i-mail"/></svg><div><small>Имейл</small><b>info-1209005@edu.mon.bg</b></div><button class="copy" type="button" data-copy="info-1209005@edu.mon.bg">Копирай</button></div>
    <div class="field"><svg class="ico"><use href="#i-mail"/></svg><div><small>Имейл</small><b>info@sudm-lom.bg</b></div><button class="copy" type="button" data-copy="info@sudm-lom.bg">Копирай</button></div>
    <p style="margin:14px 0 0"><a class="btn ghost" href="{link(root, 'kontakti')}">Работно време и още</a></p>
  </div>
</dialog>
<dialog id="dlgSearch" aria-labelledby="sTitle">
  <div class="dh"><h2 id="sTitle">Търсене в сайта</h2><button class="x" type="button" data-close aria-label="Затвори"><svg class="ico"><use href="#i-x"/></svg></button></div>
  <div class="db">
    <label for="q" class="eyebrow" style="display:block;margin-bottom:8px">Какво търсиш? <span class="kbd">Ctrl K</span></label>
    <input class="search-in" id="q" type="search" placeholder="Например: НВО, прием, бюджет…" autocomplete="off">
    <ul id="res"></ul>
    <p id="none" hidden>Няма такъв раздел. Опитай с друга дума или виж страницата „Контакти“.</p>
  </div>
</dialog>
<script src="{root}assets/js/search-data.js"></script>
<script src="{root}assets/js/app.js"></script>
</body>
</html>
'''

def write(slug, content, sub=''):
    d = ROOT_DIR / slug if slug else ROOT_DIR
    d.mkdir(parents=True, exist_ok=True)
    (d / 'index.html').write_text(content, encoding='utf-8')

def crumbs(depth, items):
    root = '../' * depth
    li = f'<li><a href="{link(root, "")}">Начало</a></li>' + ''.join(
        (f'<li><a href="{u}">{esc(t)}</a></li>' if u else f'<li aria-current="page">{esc(t)}</li>') for t, u in items)
    return f'<nav class="crumbs wrap" aria-label="Пътека"><ol>{li}</ol></nav>'

def pagehead(title, lead=''):
    return f'<div class="wrap pagehead"><h1>{esc(title)}</h1>' + (f'<p class="lead">{esc(lead)}</p>' if lead else '') + '</div>'

def side(root, slug):
    if slug not in GROUPS: return ''
    gname, items = GROUPS[slug]
    li = ''.join(f'<li><a href="{link(root, s)}"{" aria-current=\"page\"" if s == slug else ""}>{esc(t)}</a></li>' for t, s in items)
    return f'<aside class="side" aria-label="В този раздел"><h2>{esc(gname)}</h2><ul>{li}</ul></aside>'

def ext_badge(url):
    m = re.search(r'\.(\w{2,4})(?:\?|$)', url)
    e = (m.group(1).lower() if m else 'file')
    cls = 'doc' if e.startswith('doc') else 'xls' if e.startswith('xls') else 'zip' if e in ('zip', 'rar') else ''
    return f'<span class="ext {cls}">{esc(e.upper())}</span>'

def docs_list(docs):
    items = ''.join(f'<li><a href="{esc(d["url"])}">{ext_badge(d["url"])}<span>{esc(d["text"])}</span></a></li>' for d in docs)
    return f'<ul class="docs">{items}</ul>'

def blocks_html(blocks, root, filter_ui=True):
    """Превръща блоковете от стария сайт в чист HTML."""
    out = []; i = 0; docs_total = sum(1 for b in blocks if b['t'] == 'doc')
    first_docs = True
    while i < len(blocks):
        b = blocks[i]; t = b['t']
        if t == 'doc':
            grp = []
            while i < len(blocks) and blocks[i]['t'] == 'doc': grp.append(blocks[i]); i += 1
            if first_docs and filter_ui and docs_total >= 8:
                out.append('<div class="tools-row"><input class="filter" id="docFilter" type="search" placeholder="Търси в документите…" aria-label="Търси в документите"><span class="count" id="docCount" aria-live="polite"></span></div>')
            first_docs = False
            out.append(docs_list(grp)); continue
        if t == 'img':
            grp = []
            while i < len(blocks) and blocks[i]['t'] == 'img': grp.append(blocks[i]); i += 1
            grp = [g for g in grp if g.get('file')]
            if len(grp) == 1: out.append(f'<figure class="fig"><img src="{root}assets/img/pages/{grp[0]["file"]}" alt="{esc(grp[0].get("alt"))}" loading="lazy"></figure>')
            elif grp: out.append('<div class="figs">' + ''.join(f'<a href="{root}assets/img/pages/{g["file"]}"><img src="{root}assets/img/pages/{g["file"]}" alt="{esc(g.get("alt"))}" loading="lazy"></a>' for g in grp) + '</div>')
            continue
        if t == 'li':
            grp = []
            while i < len(blocks) and blocks[i]['t'] == 'li':
                if blocks[i].get('url') != '#': grp.append(blocks[i])
                i += 1
            if grp: out.append('<ul>' + ''.join(f'<li>{"<a href=%s>%s</a>" % (chr(34)+esc(x["url"])+chr(34), esc(x["text"])) if x.get("url") else esc(x["text"])}</li>' for x in grp) + '</ul>')
            continue
        if t == 'h': out.append(f'<h2>{esc(b["text"])}</h2>')
        elif t == 'p':
            txt = b['text']
            if txt.startswith('//'): i += 1; continue
            h = b.get('html') or esc(txt)
            if txt.startswith('✓'): out.append(f'<p class="chk">{h.lstrip("✓ ").strip()}</p>')
            else: out.append(f'<p>{h}</p>')
        i += 1
    return '\n'.join(out)

def reg(title, section, slug):
    SEARCH.append([title, section, link('', slug)])

# --------------------------------------------------------------- общи страници
def content_page(slug, extra_before='', extra_after='', filter_ui=True, blocks=None, lead=None):
    data = PAGES[slug]; title = TITLES.get(slug, data['title'])
    root = '../'
    blocks = blocks if blocks is not None else data['blocks']
    section = GROUPS[slug][0] if slug in GROUPS else title
    crumb_items = []
    if slug in GROUPS: crumb_items.append((GROUPS[slug][0], None))
    crumb_items.append((title, None))
    body = crumbs(1, crumb_items) + pagehead(title, lead or LEADS.get(slug, ''))
    main = f'{extra_before}<div class="prose checks">{blocks_html(blocks, root, filter_ui)}</div>{extra_after}'
    sd = side(root, slug)
    body += f'<div class="wrap layout{"" if sd else " full"}">{sd}<div>{main}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, title, lead or LEADS.get(slug, title), body))
    reg(title, section, slug)

def person_cards(blocks):
    people = []; i = 0
    while i < len(blocks):
        if blocks[i]['t'] == 'h':
            name = blocks[i]['text']; role = ''
            if i + 1 < len(blocks) and blocks[i + 1]['t'] == 'p': role = blocks[i + 1]['text']; i += 1
            people.append((name, role))
        i += 1
    out = []
    for k, (n, r) in enumerate(people):
        ini = ''.join(w[0] for w in n.replace('-', ' ').split()[:2]).upper()
        out.append(f'<div class="person{" lead" if k == 0 else ""}"><span class="av" aria-hidden="true">{esc(ini)}</span><div><b>{esc(n)}</b><span>{esc(r)}</span></div></div>')
    return '<div class="team">' + ''.join(out) + '</div>'

def page_ekip():
    slug = 'ekip'; blocks = PAGES[slug]['blocks']
    body = crumbs(1, [('За училището', None), ('Екип', None)]) + pagehead('Екип', LEADS[slug])
    body += f'<div class="wrap layout">{side("../", slug)}<div>{person_cards(blocks)}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'Екип', LEADS[slug], body)); reg('Екип', 'За училището', slug)

def page_obshtestven():
    slug = 'obshtestven-suvet'; blocks = PAGES[slug]['blocks']
    docs = [b for b in blocks if b['t'] == 'doc']; rest = [b for b in blocks if b['t'] in ('h', 'p')]
    main = '<h2 style="margin-top:0">Състав</h2>' + person_cards(rest).replace('person lead', 'person') if rest else ''
    main += '<h2>Документи</h2>' + docs_list(docs)
    body = crumbs(1, [('За училището', None), ('Обществен съвет', None)]) + pagehead('Обществен съвет', LEADS[slug])
    body += f'<div class="wrap layout">{side("../", slug)}<div class="prose">{main}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'Обществен съвет', LEADS[slug], body)); reg('Обществен съвет', 'За училището', slug)

def page_zanas():
    slug = 'za-nas'; blocks = PAGES[slug]['blocks']; stop = ('Позвънете', 'За връзка', 'Запишете', 'Последни')
    cut = len(blocks)
    for k, b in enumerate(blocks):
        if b['t'] in ('p', 'h') and b['text'].startswith(stop): cut = k; break
    blocks = blocks[:cut]
    # Начало: първите два абзаца, после "Мисия" и "Визия"
    ps = [b for b in blocks if b['t'] == 'p' and not b['text'].startswith('//') and len(b['text']) < 160][:2]
    feats = []
    for k, b in enumerate(blocks):
        if b['t'] == 'h' and b['text'].startswith(('Високи стандарти', 'Професионално', 'Добър опит', 'Обучения')):
            desc = ''
            if k + 1 < len(blocks) and blocks[k + 1]['t'] == 'p' and not blocks[k + 1]['text'].startswith('//'): desc = blocks[k + 1]['text']
            feats.append((b['text'], desc))
    mi = next((k for k, b in enumerate(blocks) if b['t'] == 'h' and b['text'] == 'Мисия'), None)
    mission = blocks[mi:] if mi is not None else []
    main = '<div class="cards">' + ''.join(f'<div class="card"><b>{esc(t)}</b><span>{esc(d)}</span></div>' for t, d in feats) + '</div>'
    main += f'<div class="prose checks">{blocks_html(mission, "../", False)}</div>'
    lead = ps[0]['text'] if ps else LEADS[slug]
    body = crumbs(1, [('За училището', None), ('Мисия и визия', None)]) + pagehead('Мисия и визия', lead)
    body += f'<div class="wrap layout">{side("../", slug)}<div>{main}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'Мисия и визия', lead, body)); reg('Мисия и визия', 'За училището', slug)

def page_patron():
    slug = 'patron'; blocks = [b for b in PAGES[slug]['blocks'] if b['t'] != 'img']
    fig = '<figure class="fig" style="max-width:340px;float:right;margin:0 0 18px 28px"><img src="../assets/img/patron-plaque.jpg" alt="Паметна плоча с барелеф на Димитър Маринов, 1846–1940" width="560" height="770"><figcaption style="font-size:.8rem;color:var(--muted);margin-top:6px">Паметна плоча на Димитър Маринов</figcaption></figure>'
    body = crumbs(1, [('За училището', None), ('Патрон', None)]) + pagehead('Патрон', LEADS[slug])
    body += f'<div class="wrap layout">{side("../", slug)}<div class="prose">{fig}{blocks_html(blocks, "../", False)}<div style="clear:both"></div></div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'Патрон', LEADS[slug], body, og_img='assets/img/patron-plaque.jpg')); reg('Патрон', 'За училището', slug)

def news_href(root, n): return f'{root}novini/{n["slug"]}/index.html'
NEWS_BY_TITLE = {n['title'].strip(): n for n in NEWS}

def project_cards(slug):
    blocks = PAGES[slug]['blocks']; cards = []; imgs = [b for b in blocks if b['t'] == 'img' and b.get('file')]
    i = 0
    while i < len(blocks):
        b = blocks[i]
        if b['t'] == 'h' and b.get('url'):
            date = blocks[i + 1]['text'] if i + 1 < len(blocks) and blocks[i + 1]['t'] == 'p' else ''
            exc = blocks[i + 2]['text'] if i + 2 < len(blocks) and blocks[i + 2]['t'] == 'p' else ''
            img = next((g for g in imgs if g.get('alt', '').strip() == b['text'].strip()), None)
            n = NEWS_BY_TITLE.get(b['text'].strip())
            href = news_href('../', n) if n else b['url']
            cards.append((b['text'], date, exc, img, href));
        i += 1
    out = []
    for t, d, e, img, href in cards:
        th = f'<div class="th"><img src="../assets/img/pages/{img["file"]}" alt="" loading="lazy"></div>' if img else ''
        out.append(f'<a class="ncard" href="{esc(href)}">{th}<div class="nb"><span class="meta">{esc(d)}</span><h3>{esc(t)}</h3><p>{esc(e)}</p></div></a>')
    return '<div class="ngrid">' + ''.join(out) + '</div>'

def page_projects(slug):
    title = TITLES[slug]
    body = crumbs(1, [('Проекти', None), (title, None)]) + pagehead(title, LEADS[slug])
    body += f'<div class="wrap layout">{side("../", slug)}<div>{project_cards(slug)}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, title, LEADS[slug], body)); reg(title, 'Проекти', slug)

def page_kontakti():
    slug = 'kontakti'
    cards = f'''<div class="cards">
<div class="card"><svg class="ico" style="width:1.5em;height:1.5em;color:var(--plum)"><use href="#i-pin"/></svg><b>Адрес</b><span>гр. Лом, ул. Динавска №67</span><a href="{MAP}" style="color:var(--plum);font-weight:700">Виж на картата</a></div>
<div class="card"><svg class="ico" style="width:1.5em;height:1.5em;color:var(--plum)"><use href="#i-phone"/></svg><b>Телефон</b><span>тел./факс: 0894 472 694<br>администрация: 0971 60011</span></div>
<div class="card"><svg class="ico" style="width:1.5em;height:1.5em;color:var(--plum)"><use href="#i-mail"/></svg><b>Имейл</b><span>info-1209005@edu.mon.bg<br>info@sudm-lom.bg</span></div>
</div>
<div class="two2">
<div><h2 style="font-size:1.4rem;margin-bottom:6px">Приемно време за родители и граждани</h2>
<table class="hours"><tbody><tr><th>Вторник</th><td>12:00 – 14:00</td></tr><tr><th>Четвъртък</th><td>12:00 – 14:00</td></tr></tbody></table></div>
<div><h2 style="font-size:1.4rem;margin-bottom:6px">Работно време на администрацията</h2>
<table class="hours"><tbody><tr><th>Понеделник – петък</th><td>08:00 – 16:30 ч.</td></tr><tr><th>Почивка</th><td>12:00 – 12:30 ч.</td></tr></tbody></table></div>
</div>'''
    body = crumbs(1, [('Контакти', None)]) + pagehead('Контакти', LEADS[slug])
    body += f'<div class="wrap" style="padding-top:24px">{cards}</div><div style="height:56px"></div>'
    write(slug, layout(1, slug, 'Контакти', LEADS[slug], body)); reg('Контакти', 'Контакти', slug)

def page_hub(slug, title, lead, items, section):
    body = crumbs(1, [(title, None)]) + pagehead(title, lead)
    cards = ''.join(f'<a class="card" href="{link("../", s)}"><b>{esc(t)}</b><span>{esc(d)}</span><em>Отвори →</em></a>' for t, d, s in items)
    body += f'<div class="wrap" style="padding-top:24px"><div class="cards">{cards}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, title, lead, body)); reg(title, section, slug)

def page_izpiti():
    slug = 'izpiti'; parts = [('nvo-4-klas', 'НВО 4. клас'), ('nvo-7-klas', 'НВО 7. клас'), ('nvo-10-klas', 'НВО 10. клас'), ('dzi', 'ДЗИ (матури)'), ('zdippk', 'ЗДИППК'), ('popravitelni-izpiti', 'Поправителни изпити')]
    chips = ''.join(f'<a class="pill" href="#{s}">{esc(t)}</a>' for s, t in parts)
    secs = ''
    for s, t in parts:
        bl = PAGES.get(s, {}).get('blocks', [])
        inner = blocks_html(bl, '../', False) or '<p>Информацията ще бъде публикувана тук.</p>'
        secs += f'<section id="{s}" style="scroll-margin-top:calc(var(--hdr) + 16px)"><h2>{esc(t)}</h2>{inner}</section>'
    body = crumbs(1, [('Изпити', None)]) + pagehead('Изпити', 'Национално външно оценяване, матури и поправителни изпити.')
    body += f'<div class="wrap" style="padding-top:20px"><div class="chips">{chips}</div><div class="prose checks">{secs}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'Изпити', 'НВО, ДЗИ, ЗДИППК и поправителни изпити.', body)); reg('Изпити', 'Изпити', slug)
    for s, t in parts: SEARCH.append([t, 'Изпити', f'izpiti/index.html#{s}'])

def page_priem():
    items = [('Прием в 1. клас', 'Утвърден план и свободни места за първокласници.', 'priem-1-klas'), ('Прием в 5. клас', 'План-прием и свободни места за пети клас.', 'priem-5-klas'), ('Прием в 8. клас', 'График, профили и свободни места след 7. клас.', 'priem-8-klas')]
    page_hub('priem', 'Прием', 'Всичко за записването в училището.', items, 'Прием')

def page_dokumenti():
    items = [('Нормативни документи', LEADS['normativni-dokumenti'], 'normativni-dokumenti'), ('Учебни планове', LEADS['uchebni-planove'], 'uchebni-planove'), ('Бюджет', LEADS['byudzhet'], 'byudzhet'), ('Образци на документи', LEADS['obrazci'], 'obrazci'), ('Безопасни условия на труд', LEADS['bdp'], 'bdp'), ('Обществен съвет', LEADS['obshtestven-suvet'], 'obshtestven-suvet'), ('Защита на личните данни', LEADS['lichni-danni'], 'lichni-danni')]
    page_hub('dokumenti', 'Документи', 'Всички официални документи на едно място.', items, 'Документи')

def page_roditeli():
    slug = 'roditeli-i-uchenici'
    cards = f'''<div class="cards">
<a class="card" href="https://app.shkolo.bg/#login-tab"><b>Електронен дневник – вход</b><span>Оценки, отсъствия и съобщения в Shkolo.</span><em>Влез →</em></a>
<a class="card" href="https://www.shkolo.bg/blog/nov-roditel/"><b>Регистрация на родител</b><span>Как да създадеш профил в електронния дневник.</span><em>Виж как →</em></a>
<a class="card" href="{link('../', 'priem')}"><b>Прием</b><span>Планове, срокове и свободни места.</span><em>Отвори →</em></a>
<a class="card" href="{link('../', 'izpiti')}"><b>Изпити</b><span>НВО, матури и поправителни изпити.</span><em>Отвори →</em></a>
<a class="card" href="{link('../', 'novini')}"><b>Новини</b><span>Какво се случва в училището.</span><em>Отвори →</em></a>
<a class="card" href="{link('../', 'kontakti')}"><b>Контакти и приемно време</b><span>Кога и как да ни намерите.</span><em>Отвори →</em></a>
</div>'''
    body = crumbs(1, [('За родители и ученици', None)]) + pagehead('За родители и ученици', 'Най-важното за семействата, на една страница.')
    body += f'<div class="wrap" style="padding-top:24px">{cards}</div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'За родители и ученици', 'Е-дневник, прием, изпити и контакти.', body)); reg('За родители и ученици', 'Начало', slug)

def page_iziavi():
    slug = 'iziavi'
    b1 = PAGES['iziavi']['blocks']; b2 = PAGES['konkursi']['blocks']
    main = f'<div class="prose">{blocks_html(b1, "../", False)}<h2>Конкурси, олимпиади, състезания</h2>{blocks_html(b2, "../", False)}</div>'
    body = crumbs(1, [('Изяви и постижения', None)]) + pagehead('Изяви и постижения', LEADS[slug])
    body += f'<div class="wrap layout full"><div>{main}</div></div><div style="height:72px"></div>'
    write(slug, layout(1, slug, 'Изяви и постижения', LEADS[slug], body)); reg('Изяви и постижения', 'Изяви', slug)

# --------------------------------------------------------------------- новини
def thumb(root, n):
    if n['imgs']: return f'<div class="th"><img src="{root}assets/img/news/{n["imgs"][0]["f"]}" alt="" loading="lazy"></div>'
    return f'<div class="th" style="display:grid;place-items:center"><img src="{root}assets/img/logo.png" alt="" style="width:46%;height:auto;object-fit:contain;opacity:.9"></div>'

def is_full(n): return bool(n['imgs']) or len(re.sub(r'<[^>]+>','',n['body'])) >= 300

def ncard(root, n, small=False):
    cats = '|' + '|'.join(n['cats']) + '|'
    return f'<a class="ncard{" nsmall" if small else ""}" href="{news_href(root, n)}" data-cats="{esc(cats)}">{"" if small else thumb(root, n)}<div class="nb"><span class="meta"><time datetime="{n["date"]}">{bg_date_s(n["date"])}</time>{"<span>" + esc(n["cats"][0]) + "</span>" if n["cats"] else ""}</span><h3>{esc(n["title"])}</h3><p>{esc(n["excerpt"])}</p></div></a>'

def page_novini():
    cats = {}
    for n in NEWS:
        for c in n['cats']: cats[c] = cats.get(c, 0) + 1
    top = [c for c, _ in sorted(cats.items(), key=lambda x: -x[1])[:8]]
    chips = '<button class="chip" type="button" data-cat="" aria-pressed="true">Всички</button>' + ''.join(f'<button class="chip" type="button" data-cat="{esc(c)}" aria-pressed="false">{esc(c)}</button>' for c in top)
    body = crumbs(1, [('Новини', None)]) + pagehead('Новини', 'Какво се случва в училището.')
    body += f'''<div class="wrap" style="padding-top:20px">
<div class="tools-row"><input class="filter" id="newsFilter" type="search" placeholder="Търси в новините…" aria-label="Търси в новините"><span class="count" id="newsCount" aria-live="polite"></span></div>
<div class="chips" role="group" aria-label="Категории">{chips}</div>
<div class="ngrid">{''.join(ncard('../', n) for n in NEWS if is_full(n))}</div>
<h2 class="subhead">Кратки съобщения</h2>
<div class="ngrid small">{''.join(ncard('../', n, True) for n in NEWS if not is_full(n))}</div>
<p style="color:var(--muted)">По-старите новини са в <a href="{OLD}/category/novini/" style="color:var(--plum);font-weight:700">архива на стария сайт</a>.</p>
</div><div style="height:72px"></div>'''
    write('novini', layout(1, 'novini', 'Новини', 'Новини от училищния живот на СУ „Димитър Маринов“ – Лом.', body)); reg('Новини', 'Новини', 'novini')

def page_news_posts():
    for k, n in enumerate(NEWS):
        root = '../../'
        prev_n = NEWS[k + 1] if k + 1 < len(NEWS) else None; next_n = NEWS[k - 1] if k > 0 else None
        gal = ''
        if n['imgs']: gal = '<div class="gal">' + ''.join(f'<img src="{root}assets/img/news/{g["f"]}" alt="{esc(g["alt"])}" loading="lazy">' for g in n['imgs']) + '</div>'
        cats = ''.join(f'<span class="pill">{esc(c)}</span> ' for c in n['cats'])
        pn = '<div class="pn">' + (f'<a href="{news_href(root, prev_n)}"><small>← По-старa</small>{esc(prev_n["title"])}</a>' if prev_n else '<span></span>') + (f'<a class="nx" href="{news_href(root, next_n)}"><small>По-нова →</small>{esc(next_n["title"])}</a>' if next_n else '<span></span>') + '</div>'
        src = f'<p style="color:var(--muted);font-size:.9rem">Оригинална публикация: <a href="{esc(n["url"])}">sudm-lom.bg</a></p>'
        body = crumbs(2, [('Новини', f'{root}novini/index.html'), (n['title'], None)])
        body += f'<article class="wrap post" style="padding-top:20px"><div class="meta"><time datetime="{n["date"]}">{bg_date(n["date"])}</time></div><h1>{esc(n["title"])}</h1><div class="prose">{n["body"]}</div>{gal}<div>{cats}</div>{src}{pn}</article><div style="height:72px"></div>'
        og = f'assets/img/news/{n["imgs"][0]["f"]}' if n['imgs'] else 'assets/img/school.jpg'
        write(f'novini/{n["slug"]}', layout(2, 'novini', n['title'], n['excerpt'], body, og_img=og))
        SEARCH.append([n['title'], 'Новини · ' + bg_date_s(n['date']), f'novini/{n["slug"]}/index.html'])

# ------------------------------------------------------------------- начало
def page_home():
    root = ''
    latest = NEWS[:5]
    f = latest[0]
    lst = ''.join(f'<li><a class="nlink" href="{news_href(root, n)}"><span class="meta"><time datetime="{n["date"]}">{bg_date_s(n["date"])}</time></span><h3>{esc(n["title"])}</h3><p>{esc(n["excerpt"])}</p></a></li>' for n in latest[1:])
    free = next((n for n in NEWS if n['title'].startswith('Свободни места')), None)
    prog = next((n for n in NEWS if n['title'].startswith('Програма за')), None)
    body = f'''<div class="wrap" id="top">
  <section class="cover" aria-labelledby="h1">
    <div class="ph"><img src="assets/img/school.jpg" alt="Сградата на {SCHOOL} в Лом: входът с три арковидни врати и бюст на патрона" width="1200" height="675" fetchpriority="high"></div>
    <div class="shade"></div>
    <div class="tx">
      <span class="eyebrow">Средно училище · град Лом · ул. Динавска №67</span>
      <h1 id="h1">Училище, което те води от първия до дванайсетия клас</h1>
      <p>Прием, свободни места, дневна програма и новини от училищния живот на едно място.</p>
      <div class="cta"><a class="btn" href="{link(root, 'priem-1-klas')}">Прием в 1. клас</a><a class="btn ghost" href="{news_href(root, free) if free else link(root, 'priem')}">Свободни места</a></div>
    </div>
  </section>

  <aside class="quick rv" aria-labelledby="qh">
    <h2 id="qh">Най-търсеното</h2>
    <ul>
      <li><a href="{news_href(root, free) if free else link(root, 'priem')}">Свободни места<span>{bg_date_s(free["date"]) if free else "прием"}</span></a></li>
      <li><a href="{news_href(root, prog) if prog else link(root, 'novini')}">Програма за деня<span>{bg_date_s(prog["date"]) if prog else "новини"}</span></a></li>
      <li><a href="{link(root, 'izpiti')}">Изпити<span>НВО, ДЗИ, ЗДИППК</span></a></li>
      <li><a href="{link(root, 'dokumenti')}">Документи<span>за изтегляне</span></a></li>
      <li><a href="{link(root, 'kontakti')}" data-open="dlgContact">Контакти<span>как да ни намерите</span></a></li>
    </ul>
  </aside>

  <dl class="facts rv">
    <div><dt>1–12</dt><dd>клас в едно училище</dd></div>
    <div><dt>55+</dt><dd>години история</dd></div>
    <div><dt>180</dt><dd>години от рождението на патрона</dd></div>
    <div><dt>1 · 5 · 8</dt><dd>класове с прием</dd></div>
  </dl>

  <section class="patron rv" aria-labelledby="pt">
    <figure class="pp"><img src="assets/img/patron-plaque.jpg" alt="Паметна плоча с бронзов барелеф на Димитър Маринов, 1846–1940" width="560" height="770" loading="lazy"><figcaption>Паметна плоча на Димитър Маринов</figcaption></figure>
    <div>
      <span class="eyebrow">Нашият патрон</span>
      <h2 id="pt">Димитър Маринов</h2>
      <p class="yr">1846 – 1940</p>
      <p>Възрожденец, учен-етнограф и историк, пръв председател на Ломския окръжен съд след Освобождението на България (1878) и депутат в Учредителното събрание (1879).</p>
      <p>Училището носи името му, а 180-годишнината от рождението му отбелязахме на 26 октомври 2026 г. с екскурзии, срещи и творчески занимания във всички класове.</p>
      <div class="track" aria-hidden="true"><i></i><hr><i></i><hr><i></i><hr><i></i></div>
      <div class="years" aria-hidden="true"><span>1846</span><span>1940</span><span>1970</span><span>2026</span></div>
      <div class="cta"><a class="btn ghost" href="{link(root, 'patron')}">За патрона</a><a class="btn ghost" href="{link(root, 'istoriya')}">История на училището</a></div>
    </div>
  </section>

  <section class="block rv" aria-labelledby="nh">
    <div class="head"><div><h2 id="nh">Новини</h2></div><a class="all" href="{link(root, 'novini')}">Всички новини <svg class="ico"><use href="#i-arrow"/></svg></a></div>
    <div class="news">
      <a class="feature" href="{news_href(root, f)}" style="text-decoration:none">
        <span>
          <span class="meta"><time datetime="{f["date"]}">{bg_date(f["date"])}</time><span>Новини</span></span>
          <h3 style="margin-top:14px">{esc(f["title"])}</h3>
          <p>{esc(f["excerpt"])}</p>
        </span>
        <span class="more">Прочети <svg class="ico"><use href="#i-arrow"/></svg></span>
      </a>
      <ul class="list">{lst}</ul>
    </div>
  </section>

  <section class="block rv" aria-labelledby="ah">
    <div class="two">
      <div>
        <div class="head" style="margin-bottom:18px"><div><h2 id="ah">Прием</h2></div><a class="all" href="{link(root, 'priem')}">Условия и срокове <svg class="ico"><use href="#i-arrow"/></svg></a></div>
        <div class="rows">
          <a class="row" href="{link(root, 'priem-1-klas')}"><b>1. клас</b><span>Утвърден план и свободни места за първокласници.</span><em>Виж информацията →</em></a>
          <a class="row" href="{link(root, 'priem-5-klas')}"><b>5. клас</b><span>План-прием и свободни места.</span><em>Виж информацията →</em></a>
          <a class="row" href="{link(root, 'priem-8-klas')}"><b>8. клас</b><span>График, профили и свободни места.</span><em>Виж информацията →</em></a>
        </div>
      </div>
      <div>
        <div class="head" style="margin-bottom:18px"><div><h2>Изпити</h2></div></div>
        <div class="exams">
          <a href="{link(root, 'izpiti')}#nvo-4-klas">НВО 4. клас</a><a href="{link(root, 'izpiti')}#nvo-7-klas">НВО 7. клас</a><a href="{link(root, 'izpiti')}#nvo-10-klas">НВО 10. клас</a>
          <a href="{link(root, 'izpiti')}#dzi">ДЗИ</a><a href="{link(root, 'izpiti')}#zdippk">ЗДИППК</a><a href="{link(root, 'izpiti')}#popravitelni-izpiti">Поправителни</a>
        </div>
      </div>
    </div>
  </section>

  <section class="block rv" aria-labelledby="ph2">
    <div class="head"><div><h2 id="ph2">Проекти и национални програми</h2><p>Какво предлага училището освен учебния план.</p></div><a class="all" href="{link(root, 'proekti')}">Всички проекти <svg class="ico"><use href="#i-arrow"/></svg></a></div>
    <div class="proj">
      <a href="{link(root, 'proekti')}"><span class="tag">Проект</span><b>Училищна STEM среда</b></a>
      <a href="{link(root, 'proekti')}"><span class="tag">Проект</span><b>Модернизиране на професионалното образование и обучение</b></a>
      <a href="{link(root, 'proekti')}"><span class="tag">Проект</span><b>Живей активно, храни се разумно!</b></a>
      <a href="{link(root, 'nacionalni-programi')}"><span class="tag">Национална програма</span><b>Без свободен час</b></a>
      <a href="{link(root, 'nacionalni-programi')}"><span class="tag">Национална програма</span><b>Заедно в изкуствата и в спорта</b></a>
      <a href="{link(root, 'nacionalni-programi')}"><span class="tag">Национална програма</span><b>Иновации в действие</b></a>
    </div>
  </section>

  <section class="block rv" aria-labelledby="ct">
    <div class="head"><div><h2 id="ct">Контакти</h2><p>Приемно време: вторник и четвъртък, 12:00 – 14:00. Администрация: понеделник – петък, 08:00 – 16:30 ч.</p></div><button class="btn" type="button" data-open="dlgContact">Бързи контакти</button></div>
    <div class="contact">
      <div class="cc"><svg class="ico"><use href="#i-pin"/></svg><h3>Адрес</h3><p>гр. Лом, ул. Динавска №67</p><p style="margin-top:8px"><a href="{MAP}">Виж на картата</a></p></div>
      <div class="cc"><svg class="ico"><use href="#i-phone"/></svg><h3>Телефон</h3><p>тел./факс: 0894 472 694<br>администрация: 0971 60011</p></div>
      <div class="cc"><svg class="ico"><use href="#i-mail"/></svg><h3>Имейл</h3><p>info-1209005@edu.mon.bg<br>info@sudm-lom.bg</p></div>
    </div>
  </section>
</div>
<div style="height:8px"></div>
<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@type": "School", "name": "СУ „Димитър Маринов“", "address": {"@type": "PostalAddress", "streetAddress": "ул. Динавска 67", "addressLocality": "Лом", "addressCountry": "BG"}, "telephone": "+359894472694", "email": "info-1209005@edu.mon.bg"}, ensure_ascii=False)}</script>'''
    write('', layout(0, '', 'Начало', 'СУ „Димитър Маринов“ – Лом: прием, свободни места, програма, документи и новини на едно място.', body, is_home=True));

def page_404():
    root = BASE_PATH if BASE_PATH.endswith('/') else BASE_PATH + '/'
    body = f'<div class="wrap notfound"><h1>404</h1><p style="font-size:1.2rem">Тази страница не съществува или е преместена.</p><p><a class="btn" href="{root}index.html">Към началото</a></p></div>'
    page = layout(0, '404', 'Страницата не е намерена', 'Страницата не е намерена.', body)
    page = page.replace('data-root=""', f'data-root="{root}"').replace('href="assets/', f'href="{root}assets/').replace('src="assets/', f'src="{root}assets/')
    page = re.sub(r'href="((?:[a-z0-9-]+/)*index\.html(?:#[^"]*)?)"', lambda m: f'href="{root}{m.group(1)}"', page)
    (ROOT_DIR / '404.html').write_text(page, encoding='utf-8')

def main():
    # изчисти старите генерирани папки (не пипа src/ и assets/)
    for d in ROOT_DIR.iterdir():
        if d.is_dir() and d.name not in ('src', 'assets', '.git', '.github') and (d / 'index.html').exists(): shutil.rmtree(d)
    page_home(); reg('Начало', 'Начало', '')
    for s in ('za-nas',): page_zanas()
    page_patron(); reg('Патрон', 'За училището', 'patron')
    content_page('istoriya'); page_ekip(); page_obshtestven()
    content_page('lichni-danni')
    page_iziavi()
    for s in ('priem-1-klas', 'priem-5-klas', 'priem-8-klas', 'normativni-dokumenti', 'uchebni-planove', 'byudzhet', 'obrazci', 'bdp'): content_page(s)
    page_priem(); page_dokumenti()
    page_projects('proekti'); page_projects('nacionalni-programi')
    page_izpiti(); page_kontakti(); page_roditeli()
    page_novini(); page_news_posts(); page_404()
    (ROOT_DIR / 'assets/js/search-data.js').write_text('window.SEARCH=' + json.dumps(SEARCH, ensure_ascii=False) + ';\n', encoding='utf-8')
    (ROOT_DIR / '.nojekyll').write_text('')
    if SITE_URL:
        urls = [''] + sorted({s[2].replace('/index.html', '/').replace('index.html', '').split('#')[0] for s in SEARCH})
        (ROOT_DIR / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'<url><loc>{SITE_URL}/{u}</loc></url>\n' for u in urls) + '</urlset>\n', encoding='utf-8')
        (ROOT_DIR / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n')
    print('Готово:', len(SEARCH), 'записа за търсене')

if __name__ == '__main__':
    main()
