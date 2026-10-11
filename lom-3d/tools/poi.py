import json, math, collections
LAT0, LON0 = 43.8167, 23.2333
KX = 111320*math.cos(math.radians(LAT0)); KY = 110574.0
G = {  # group -> (label, [overture basic_category/taxonomy keywords])
 'food': ('Храна и напитки', ['restaurant','cafe','bar','coffee','eatery','pizza','bakery','fast_food','pub','food_and_drink','ice_cream','dessert']),
 'shop': ('Магазин', ['store','shopping','market','supermarket','convenience','florist','pharmacy_store','kiosk']),
 'stay': ('Настаняване', ['hotel','hostel','guest','lodging','motel','resort','bed_and_breakfast']),
 'edu': ('Образование', ['school','kindergarten','place_of_learning','university','college','preschool','education','library']),
 'health': ('Здравеопазване', ['hospital','clinic','medical','dentist','doctor','pharmacy','health','wellness','alternative_medicine','veterinar']),
 'gov': ('Държавна и общинска служба', ['government','police','fire_station','civic','post_office','court','municipal','public_service','social_or_community']),
 'fin': ('Финанси', ['bank','financial','atm','insurance','credit']),
 'ind': ('Производство и склад', ['manufactur','factory','industrial','warehouse','storage','wholesale','b2b','agricultur','construction']),
 'move': ('Транспорт и горива', ['gas_station','train_station','bus','automotive','auto_','vehicle','parking','car_','shipping','taxi','charging']),
 'cult': ('Култура, религия, отдих', ['church','place_of_worship','historic','museum','theater','cinema','casino','sport','gym','park','plaza','arts','stadium','entertainment','landmark']),
 'svc': ('Услуги', ['service','beauty','salon','barber','repair','laundry','office','telecom','professional','home_']),
}
ORDER = ['edu','health','gov','stay','food','shop','fin','ind','move','cult','svc']
def grp(*keys):
    ks = ' '.join(k for k in keys if k).lower()
    for kw,gg in (('package_locker','move'),('non_governmental','svc'),('wellness','svc'),('spa','svc'),('social_or_community','svc'),('barber','svc'),('manicure','svc')):
        if kw in ks: return gg
    for g in ORDER:
        for kw in G[g][1]:
            if kw in ks: return g
    return 'svc'
f = json.load(open('poi/places.geojson'))['features']
out = []; seen = set()
for x in f:
    p = x['properties']; nm = (p.get('names') or {}).get('primary')
    if not nm or nm.lower().startswith('lom city') or nm.strip()=='Болница': continue
    lon, lat = x['geometry']['coordinates']
    cat = p.get('basic_category'); tx = (p.get('taxonomy') or {}).get('primary')
    g = grp(tx, cat)
    X = round((lon-LON0)*KX*10); Y = round((lat-LAT0)*KY*10)
    k = (nm.lower(), X//200, Y//200)
    if k in seen: continue
    seen.add(k)
    a = (p.get('addresses') or [{}])[0].get('freeform') or ''
    out.append([X, Y, ORDER.index(g), nm.strip()[:60], a.strip()[:60], (tx or cat or '')[:40]])
print(len(out), collections.Counter(ORDER[o[2]] for o in out))
labels = [G[g][0] for g in ORDER]
for src, dst in (('data4.json','data5.json'),('data_public.json','data_public5.json')):
    d = json.load(open(src)); d['poi'] = out; d['poig'] = labels
    json.dump(d, open(dst,'w'), separators=(',',':'), ensure_ascii=False)
