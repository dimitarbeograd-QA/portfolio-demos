"""Build index.html from the template and the data in data/.
This public build contains OpenStreetMap, Microsoft ML footprints (via Overture), Sentinel-2 and Copernicus DEM only."""
import base64, pathlib
r = pathlib.Path(__file__).parent
s = (r / 'src_template.html').read_text(encoding='utf-8')
rd = lambda n: (r / 'data' / n).read_text(encoding='utf-8')
b64 = lambda n: base64.b64encode((r / 'data' / n).read_bytes()).decode()
s = (s.replace('__DATA__', rd('data.json')).replace('__VEG__', rd('veg.b64')).replace('__DEM__', rd('dem.b64'))
      .replace('__WM__', b64('water_mask.png')).replace('__SAT__', b64('sat.jpg')).replace('__SR__', b64('sr_local.jpg')).replace('__PAR__', '').replace('__DEM2__', rd('dem2.b64')).replace('__OUT__', rd('outer.json')).replace('__SATO__', b64('sat_outer.jpg')))
# the cadastre (KAIS) layers are not part of the public build
s = s.replace('      <button class="tog" data-layer="parcels" aria-pressed="true">Имоти</button>\n', '')
s = s.replace('Сгради от кадастъра на АГКК и OSM, снимка от Sentinel-2', 'Сгради от OSM и Microsoft ML, снимка от Sentinel-2')
s = s.replace('© OpenStreetMap · АГКК · Microsoft ML', '© OpenStreetMap · Microsoft ML')
s = s.replace('Контури и етажност на сградите и границите на имотите: АГКК (КАИС, отворени данни, 14.09.2026), за лична употреба. Допълнително: ', 'Сгради: ')
import re
s = re.sub(r'Фирми с търговски обекти и общински дружества:[^.]*\.[^.]*\.[^.]*\. ', '', s)
s = s.replace('Фирми с търговски обекти и общински дружества: отворени данни на Община Лом (регистри от 2015–2021 г., само юридически лица, може да са остарели; координатите са по адреса). ', '')
(r / 'index.html').write_text(s, encoding='utf-8')
print('index.html', len(s) // 1024, 'KB')
