/* Табло на младоженците: отговори, снимки, CSV и ZIP */
(function () {
  const $ = id => document.getElementById(id);
  let token = null;
  let rsvpRows = [];
  let photosCache = [];

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(c => { if (c) n.appendChild(c); });
    return n;
  }

  function showError(msg) {
    const e = $('admin-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* CSV: защита от "формулни" инжекции в Excel */
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    const lines = [['Име', 'Отговор', 'Души', 'Бележка', 'Код'].map(csvCell).join(',')];
    rsvpRows.forEach(r => {
      lines.push([
        r.name,
        r.attending === 'yes' ? 'Идва' : 'Не идва',
        r.attending === 'yes' ? r.guests : 0,
        r.note || '',
        r.guest_code || ''
      ].map(csvCell).join(','));
    });
    // BOM, за да отваря Excel кирилицата правилно
    download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'otgovori.csv');
  }

  function renderRsvps(rows) {
    rsvpRows = rows;
    const yes = rows.filter(r => r.attending === 'yes');
    $('sum-answers').textContent = rows.length;
    $('sum-yes').textContent = yes.length;
    $('sum-persons').textContent = yes.reduce((s, r) => s + (Number(r.guests) || 0), 0);
    $('sum-no').textContent = rows.length - yes.length;

    const body = $('rsvp-body');
    body.textContent = '';
    rows.forEach(r => {
      body.appendChild(el('tr', { 'data-testid': 'rsvp-row' }, [
        el('td', { text: r.name }),
        el('td', { text: r.attending === 'yes' ? 'Идва' : 'Не идва' }),
        el('td', { text: r.attending === 'yes' ? String(r.guests) : '–' }),
        el('td', { text: r.note || '' }),
        el('td', { text: r.guest_code || '' })
      ]));
    });
  }

  async function act(fn) {
    showError('');
    try {
      await fn();
      await loadAll();
    } catch (e) {
      showError('Действието не успя. Проверете връзката и опитайте отново.');
    }
  }

  function renderPhotos(photos) {
    photosCache = photos;
    const approved = photos.filter(p => p.approved).length;
    $('photo-counts').textContent = 'Одобрени: ' + approved + ' · На изчакване: ' + (photos.length - approved);

    const grid = $('photo-grid');
    grid.textContent = '';
    photos.forEach(p => {
      const approveBtn = el('button', {
        type: 'button', class: 'btn small', 'data-testid': 'approve-btn', text: p.approved ? 'Скрий' : 'Одобри'
      });
      approveBtn.addEventListener('click', () => act(() => RSVPStore.setApproved(p, !p.approved, token)));

      const delBtn = el('button', { type: 'button', class: 'btn small ghost', 'data-testid': 'delete-btn', text: 'Изтрий' });
      delBtn.addEventListener('click', () => {
        if (window.confirm('Да изтрием ли файла окончателно?')) act(() => RSVPStore.removePhoto(p, token));
      });

      const media = p.kind === 'video'
        ? el('video', { src: p.url, controls: '', preload: 'metadata', playsinline: '' })
        : el('img', { src: p.url, alt: 'Снимка от гост', loading: 'lazy' });
      grid.appendChild(el('figure', { 'data-testid': p.kind === 'video' ? 'video-card' : 'photo-card' }, [
        media,
        el('figcaption', {}, [
          el('span', { text: p.uploader || 'Гост' }),
          el('span', { class: 'badge' + (p.approved ? ' ok' : ''), 'data-testid': 'photo-status', text: p.approved ? 'Одобрена' : 'На изчакване' })
        ]),
        el('div', { class: 'actions' }, [approveBtn, delBtn])
      ]));
    });
  }

  async function loadAll() {
    const rows = await RSVPStore.listRsvps(token);
    const photos = await RSVPStore.listPhotos({ token });
    renderRsvps(rows);
    renderPhotos(photos);
  }

  async function downloadZip() {
    const status = $('zip-status');
    const list = photosCache.filter(p => p.approved && p.kind !== 'video');
    if (!list.length) {
      status.textContent = 'Няма одобрени снимки (видеата се свалят поотделно от галерията).';
      status.hidden = false;
      return;
    }
    try {
      const files = [];
      for (let i = 0; i < list.length; i++) {
        status.textContent = 'Подготвям ' + (i + 1) + ' от ' + list.length + '…';
        status.hidden = false;
        const res = await fetch(list[i].url);
        if (!res.ok) throw new Error('fetch');
        files.push({
          name: 'snimka-' + String(i + 1).padStart(3, '0') + '.jpg',
          data: new Uint8Array(await res.arrayBuffer())
        });
      }
      download(Zip.build(files), 'snimki-ot-svatbata.zip');
      status.textContent = 'Готово: ' + files.length + ' снимки.';
    } catch (e) {
      status.textContent = 'Не успях да подготвя архива. Опитайте отново.';
    }
    status.hidden = false;
  }

  function selectTab(which) {
    const rsvp = which === 'rsvp';
    $('view-rsvp').hidden = !rsvp;
    $('view-photos').hidden = rsvp;
    $('tab-rsvp').setAttribute('aria-selected', String(rsvp));
    $('tab-photos').setAttribute('aria-selected', String(!rsvp));
  }

  async function init() {
    $('tab-rsvp').addEventListener('click', () => selectTab('rsvp'));
    $('tab-photos').addEventListener('click', () => selectTab('photos'));
    $('export-csv').addEventListener('click', exportCsv);
    $('download-zip').addEventListener('click', downloadZip);

    $('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      showError('');
      try {
        token = await RSVPStore.login($('l-email').value.trim(), $('l-pass').value);
        $('login-form').hidden = true;
        $('panel').hidden = false;
        await loadAll();
      } catch (err) {
        showError('Грешен имейл или парола.');
      }
    });

    const live = await RSVPStore.isLive();
    if (!live) {
      $('demo-banner').hidden = false;
      $('panel').hidden = false;
      await loadAll();
    } else {
      $('login-form').hidden = false;
    }
  }

  init();
})();
