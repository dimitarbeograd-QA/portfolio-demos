/* Галерия: качване от гостите + разглеждане на одобрените снимки */
(function () {
  const $ = id => document.getElementById(id);
  const MAX_FILES = 10;
  const MAX_ORIGINAL = 25 * 1024 * 1024;
  const MAX_VIDEO = 50 * 1024 * 1024;
  const isVideoFile = f => /^video\//.test(f.type);
  const dayFmt = new Intl.DateTimeFormat('bg-BG', { dateStyle: 'long', timeZone: 'Europe/Sofia' });
  const params = new URLSearchParams(location.search);
  let live = false;

  function show(id, text) { const n = $(id); n.textContent = text; n.hidden = false; }
  function hide(id) { $(id).hidden = true; }

  /* Прекодиране в JPEG: смалява файла и премахва EXIF (в т.ч. GPS). */
  async function toJpeg(file, maxSide, quality) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality);
    });
  }

  let box = null;
  function openBox(url) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Снимка');
      box.setAttribute('data-testid', 'lightbox');
      const img = document.createElement('img');
      img.alt = 'Снимка от сватбата';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'lb-close';
      x.setAttribute('aria-label', 'Затвори');
      x.textContent = '×';
      box.append(img, x);
      box.addEventListener('click', closeBox);
      document.body.appendChild(box);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBox(); });
    }
    box.querySelector('img').src = url;
    box.hidden = false;
    box.querySelector('.lb-close').focus();
  }
  function closeBox() { if (box) box.hidden = true; }

  function renderGrid(photos) {
    const grid = $('grid');
    grid.textContent = '';
    $('empty').hidden = photos.length > 0;
    photos.forEach(p => {
      const fig = document.createElement('figure');
      let media;
      if (p.kind === 'video') {
        fig.setAttribute('data-testid', 'gallery-video');
        media = document.createElement('video');
        media.src = p.url;
        media.controls = true;
        media.preload = 'metadata';
        media.setAttribute('playsinline', '');
      } else {
        fig.setAttribute('data-testid', 'gallery-photo');
        media = document.createElement('img');
        media.src = p.url;
        media.loading = 'lazy';
        media.alt = 'Снимка от сватбата';
        media.addEventListener('click', () => openBox(p.url));
        media.style.cursor = 'zoom-in';
      }

      const cap = document.createElement('figcaption');
      const who = document.createElement('span');
      who.textContent = p.uploader || '';
      const dl = document.createElement('a');
      dl.href = p.url;
      dl.textContent = 'Свали';
      dl.setAttribute('download', p.kind === 'video' ? 'svatba-video' : 'svatba-snimka.jpg');
      dl.target = '_blank';
      dl.rel = 'noopener noreferrer';
      cap.append(who, dl);

      fig.append(media, cap);
      grid.appendChild(fig);
    });
  }

  async function refresh() {
    try {
      renderGrid(await RSVPStore.listPhotos({ approvedOnly: true }));
    } catch (e) {
      show('gallery-state', 'Снимките не могат да се заредят в момента. Опитайте по-късно.');
    }
  }

  function wireUpload() {
    const form = $('upload-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      hide('error-files');
      hide('error-consent');
      hide('upload-status');

      const files = Array.from($('u-files').files || []);
      let bad = false;
      if (files.length === 0) {
        show('error-files', 'Изберете поне една снимка.'); bad = true;
      } else if (files.length > MAX_FILES) {
        show('error-files', 'Най-много ' + MAX_FILES + ' снимки наведнъж.'); bad = true;
      } else if (files.some(f => !/^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime))$/.test(f.type))) {
        show('error-files', 'Позволени са JPG, PNG, WebP и видео MP4, WebM или MOV.'); bad = true;
      } else if (files.some(f => !isVideoFile(f) && f.size > MAX_ORIGINAL)) {
        show('error-files', 'Една от снимките е над 25 MB.'); bad = true;
      } else if (files.some(f => isVideoFile(f) && f.size > MAX_VIDEO)) {
        show('error-files', 'Едно от видеата е над 50 MB.'); bad = true;
      }
      if (!$('u-consent').checked) {
        show('error-consent', 'Нужно е да потвърдите съгласието.'); bad = true;
      }
      if (bad) return;

      const btn = form.querySelector('button[type="submit"]');
      const uploader = $('u-name').value;
      btn.disabled = true;
      let ok = 0;
      let failed = 0;
      try {
        for (let i = 0; i < files.length; i++) {
          show('upload-status', 'Качване ' + (i + 1) + ' от ' + files.length + '…');
          $('upload-status').className = 'status';
          try {
            const video = isVideoFile(files[i]);
            const blob = video ? files[i] : await toJpeg(files[i], live ? 1600 : 640, live ? 0.82 : 0.6);
            const r = await RSVPStore.uploadPhoto(blob, uploader, video ? 'video' : 'photo');
            if (r.ok) ok++; else failed++;
          } catch (err) {
            failed++;
          }
        }
      } finally {
        btn.disabled = false;
      }

      form.reset();
      const st = $('upload-status');
      if (ok > 0 && failed === 0) {
        st.textContent = 'Благодарим! Качени файлове: ' + ok + '. Ще се покажат след одобрение от младоженците.';
        st.className = 'status';
      } else if (ok > 0) {
        st.textContent = 'Качени: ' + ok + ', неуспешни: ' + failed + '. Неуспешните опитайте отново.';
        st.className = 'status err';
      } else {
        st.textContent = 'Не успяхме да качим снимките. Опитайте отново.';
        st.className = 'status err';
      }
      st.hidden = false;
    });
  }

  async function main() {
    let data;
    try {
      const res = await fetch('data/couple.json');
      if (!res.ok) throw new Error('load');
      data = await res.json();
    } catch (e) {
      show('gallery-state', 'Страницата не може да се зареди.');
      $('gallery-section').hidden = true;
      return;
    }

    const names = data.couple.first + ' и ' + data.couple.second;
    $('couple-names').textContent = names;
    document.title = 'Снимки – ' + names;

    const guestCode = params.get('g');
    if (guestCode) $('back').href = 'index.html?g=' + encodeURIComponent(guestCode);

    const g = data.gallery;
    const now = Date.now();
    const opens = new Date(g.opensAt).getTime();
    const until = new Date(g.uploadsUntil).getTime();
    const keep = new Date(g.keepUntil).getTime();

    if (now < opens) {
      show('gallery-state', 'Галерията ще се отвори на ' + dayFmt.format(new Date(opens)));
      $('gallery-section').hidden = true;
      return;
    }
    if (now > keep) {
      show('gallery-state', 'Галерията вече не е достъпна. Младоженците пазят своите спомени.');
      $('gallery-section').hidden = true;
      return;
    }

    if (now <= until) {
      $('upload-section').hidden = false;
      show('gallery-state', 'Качвайте снимки и видео до ' + dayFmt.format(new Date(until)));
    } else {
      show('gallery-state', 'Качването приключи. Снимките са достъпни до ' + dayFmt.format(new Date(keep)));
    }

    live = await RSVPStore.isLive();
    await refresh();
    wireUpload();
  }

  main();
})();
