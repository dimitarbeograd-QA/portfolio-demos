import json,re,os,io,hashlib,subprocess,email.utils,datetime
from bs4 import BeautifulSoup
from PIL import Image
S='/tmp/claude-0/-home-user/5e14a2a4-58e3-55dc-86f3-080345da4e04/scratchpad/'
items=json.load(open(S+'migrate/news.json',encoding='utf-8'))[:60]
OUT=S+'site/assets/img/news/'
ALLOW={'p','h2','h3','h4','ul','ol','li','a','strong','em','br','blockquote','b','i'}
def orig(u): return re.sub(r'-\d+x\d+(\.\w+)$',r'\1',u)
def grab(u):
    path=OUT+hashlib.md5(u.encode()).hexdigest()[:10]+'.jpg'
    if os.path.exists(path): return os.path.basename(path)
    r=subprocess.run(['curl','-s','-m','40','-L',u],capture_output=True)
    try:
        im=Image.open(io.BytesIO(r.stdout)).convert('RGB')
    except Exception: return None
    if im.width<320: return None
    w=min(960,im.width); h=round(im.height*w/im.width)
    im.resize((w,h),Image.LANCZOS).save(path,'JPEG',quality=72,optimize=True,progressive=True)
    return os.path.basename(path)
news=[]
for it in items:
    s=BeautifulSoup(it['html'],'html.parser')
    imgs=[];seen=set()
    for im in s.find_all('img'):
        u=orig(im.get('src',''))
        if 'uploads' not in u or u in seen: continue
        seen.add(u)
        if len(imgs)<4:
            f=grab(u)
            if f: imgs.append({'f':f,'alt':im.get('alt','')})
    vids=[]
    for fg in s.find_all('figure'):
        v=fg.find('video')
        if v and (v.get('src') or (v.find('source') and v.find('source').get('src'))):
            src=v.get('src') or v.find('source').get('src')
            cap=fg.find('figcaption'); vids.append({'src':src,'cap':cap.get_text(' ',strip=True) if cap else ''})
    for t in s(['script','style','img','figure','iframe','video','audio']): t.decompose()
    for t in s.find_all(True):
        if t.name not in ALLOW: t.unwrap()
        else:
            t.attrs={'href':t['href']} if t.name=='a' and t.has_attr('href') else {}
    body=str(s)
    body=re.sub(r'\[/?[a-z_]+[^\]]*\]','',body)       # shortcodes
    body=re.sub(r'<(p|h2|h3|h4|li)>\s*(&nbsp;|\s)*</\1>','',body)
    body=re.sub(r'\n{2,}','\n',body).strip()
    for v in vids:
        body+='\n<figure class="vid"><video controls preload="metadata" src="%s"></video>%s</figure>'%(v['src'],('<figcaption>'+v['cap']+'</figcaption>') if v['cap'] else '')
    FIX=[('Фотогпафия','Фотография'),('1 80 години','180 години'),('е вропейската','европейската'),('гпад Лом','град Лом')]
    for a,b in FIX: body=body.replace(a,b); it['title']=it['title'].replace(a,b); it['cat']=[c.replace(a,b) for c in it['cat']]
    text=re.sub(r'\s+',' ',BeautifulSoup(body,'html.parser').get_text(' ',strip=True))
    d=email.utils.parsedate_to_datetime(it['date'])
    slug=it['link'].rstrip('/').split('/')[-1]
    cats=[c.replace('Фотогпафия','Фотография') for c in it['cat'] if c!='Новини']
    news.append({'slug':slug,'title':it['title'],'date':d.strftime('%Y-%m-%d'),'cats':cats[:3],'excerpt':text[:200].rsplit(' ',1)[0]+('…' if len(text)>200 else ''),'body':body,'imgs':imgs,'url':it['link']})
json.dump(news,open(S+'site/src/news.json','w'),ensure_ascii=False,indent=1)
print(len(news),sum(len(n['imgs']) for n in news))
