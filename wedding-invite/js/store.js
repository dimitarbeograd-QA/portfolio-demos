/* Хранилище.
   Ако има js/config.json (Supabase) -> работи на живо.
   Ако няма -> демо режим в localStorage на браузъра. */
const RSVPStore = (() => {
  const LS_RSVP = 'wedding-invite-demo-rsvps';
  const LS_PHOTOS = 'wedding-invite-demo-photos';
  const BUCKET = 'wedding-photos';
  let cfgPromise = null;

  function getConfig() {
    if (!cfgPromise) {
      cfgPromise = fetch('js/config.json', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
        .then(c => (c && c.supabaseUrl && c.supabaseAnonKey ? c : null));
    }
    return cfgPromise;
  }

  async function isLive() { return !!(await getConfig()); }

  function readLocal(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function writeLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function authHeaders(cfg, token, extra) {
    return Object.assign(
      { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + (token || cfg.supabaseAnonKey) },
      extra || {}
    );
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  /* ---------- RSVP ---------- */
  async function saveRsvp(record) {
    const cfg = await getConfig();
    if (!cfg) {
      const all = readLocal(LS_RSVP);
      if (record.guest_code && all.some(r => r.guest_code === record.guest_code)) {
        return { ok: false, reason: 'duplicate' };
      }
      all.push(Object.assign({}, record, { created_at: new Date().toISOString() }));
      writeLocal(LS_RSVP, all);
      return { ok: true, mode: 'demo' };
    }
    try {
      const res = await fetch(cfg.supabaseUrl + '/rest/v1/rsvps', {
        method: 'POST',
        headers: authHeaders(cfg, null, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify(record)
      });
      if (res.status === 201) return { ok: true, mode: 'live' };
      if (res.status === 409) return { ok: false, reason: 'duplicate' };
      return { ok: false, reason: 'error' };
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
  }

  async function listRsvps(token) {
    const cfg = await getConfig();
    if (!cfg) return readLocal(LS_RSVP);
    const res = await fetch(cfg.supabaseUrl + '/rest/v1/rsvps?select=*&order=created_at.desc', {
      headers: authHeaders(cfg, token)
    });
    if (!res.ok) throw new Error('rsvps ' + res.status);
    return res.json();
  }

  async function login(email, password) {
    const cfg = await getConfig();
    if (!cfg) return null;
    const res = await fetch(cfg.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) throw new Error('login');
    const body = await res.json();
    return body.access_token;
  }

  /* ---------- Видео в демо режим: IndexedDB (localStorage е твърде малко) ---------- */
  function idb() {
    return new Promise((resolve, reject) => {
      const rq = indexedDB.open('wedding-invite-demo', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('videos');
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function idbPut(id, blob) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(id) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const rq = db.transaction('videos').objectStore('videos').get(id);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    });
  }
  async function idbDel(id) {
    const db = await idb();
    return new Promise(resolve => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  const VIDEO_EXT = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

  /* ---------- Снимки и видео ---------- */
  function photoUrl(cfg, path) {
    return cfg.supabaseUrl + '/storage/v1/object/public/' + BUCKET + '/' + path;
  }

  async function uploadPhoto(blob, uploader, kind) {
    const isVideo = kind === 'video';
    const cfg = await getConfig();
    const who = String(uploader || '').trim().slice(0, 40) || null;
    if (!cfg) {
      try {
        const id = newId();
        const all = readLocal(LS_PHOTOS);
        if (isVideo) {
          await idbPut(id, blob);
          all.push({ id, kind: 'video', mime: blob.type || 'video/mp4', uploader: who, approved: false, created_at: new Date().toISOString() });
        } else {
          const url = await blobToDataUrl(blob);
          all.push({ id, kind: 'photo', url, uploader: who, approved: false, created_at: new Date().toISOString() });
        }
        writeLocal(LS_PHOTOS, all);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'quota' };
      }
    }
    try {
      const path = newId() + '.' + (isVideo ? (VIDEO_EXT[blob.type] || 'mp4') : 'jpg');
      const up = await fetch(cfg.supabaseUrl + '/storage/v1/object/' + BUCKET + '/' + path, {
        method: 'POST',
        headers: authHeaders(cfg, null, { 'Content-Type': isVideo ? (blob.type || 'video/mp4') : 'image/jpeg' }),
        body: blob
      });
      if (!up.ok) return { ok: false, reason: 'error' };
      const row = await fetch(cfg.supabaseUrl + '/rest/v1/photos', {
        method: 'POST',
        headers: authHeaders(cfg, null, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ path, uploader: who, kind: isVideo ? 'video' : 'photo' })
      });
      return row.status === 201 ? { ok: true } : { ok: false, reason: 'error' };
    } catch (e) {
      return { ok: false, reason: 'network' };
    }
  }

  async function listPhotos(opts) {
    const o = opts || {};
    const cfg = await getConfig();
    if (!cfg) {
      const all = readLocal(LS_PHOTOS).filter(p => !o.approvedOnly || p.approved);
      return Promise.all(all.map(async p => {
        if (p.kind !== 'video') return Object.assign({ kind: 'photo' }, p);
        const blob = await idbGet(p.id).catch(() => null);
        return Object.assign({}, p, { url: blob ? URL.createObjectURL(blob) : '' });
      }));
    }
    const filter = o.approvedOnly ? '&approved=eq.true' : '';
    const res = await fetch(cfg.supabaseUrl + '/rest/v1/photos?select=*&order=created_at.desc' + filter, {
      headers: authHeaders(cfg, o.token)
    });
    if (!res.ok) throw new Error('photos ' + res.status);
    const rows = await res.json();
    return rows.map(r => Object.assign({ kind: 'photo' }, r, { url: photoUrl(cfg, r.path) }));
  }

  async function setApproved(photo, approved, token) {
    const cfg = await getConfig();
    if (!cfg) {
      const all = readLocal(LS_PHOTOS);
      const p = all.find(x => x.id === photo.id);
      if (p) p.approved = approved;
      writeLocal(LS_PHOTOS, all);
      return;
    }
    const res = await fetch(cfg.supabaseUrl + '/rest/v1/photos?id=eq.' + encodeURIComponent(photo.id), {
      method: 'PATCH',
      headers: authHeaders(cfg, token, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ approved })
    });
    if (!res.ok) throw new Error('approve ' + res.status);
  }

  async function removePhoto(photo, token) {
    const cfg = await getConfig();
    if (!cfg) {
      writeLocal(LS_PHOTOS, readLocal(LS_PHOTOS).filter(x => x.id !== photo.id));
      if (photo.kind === 'video') await idbDel(photo.id);
      return;
    }
    const del = await fetch(cfg.supabaseUrl + '/storage/v1/object/' + BUCKET + '/' + photo.path, {
      method: 'DELETE',
      headers: authHeaders(cfg, token)
    });
    if (!del.ok) throw new Error('storage ' + del.status);
    const row = await fetch(cfg.supabaseUrl + '/rest/v1/photos?id=eq.' + encodeURIComponent(photo.id), {
      method: 'DELETE',
      headers: authHeaders(cfg, token)
    });
    if (!row.ok) throw new Error('row ' + row.status);
  }

  return { isLive, saveRsvp, listRsvps, login, uploadPhoto, listPhotos, setApproved, removePhoto };
})();
