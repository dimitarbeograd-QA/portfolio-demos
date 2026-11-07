// Spark емотиконки: собствен комплект от 28 векторни емотиконки във фирмените цветове + обикновени емоджита.
// В съобщенията се пишат като :име: (напр. :smile:) и се показват като картинки.
(() => {
  'use strict';
  const INK = '#07203f';
  const ST = (w = 3) => `stroke="${INK}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const HEART = 'M32 57C6 38 4 18 16 11c8-5 14 0 16 6 2-6 8-11 16-6 12 7 10 27-16 46z';
  const heartAt = (x, y, k, fill = '#ff4f7b') => `<path transform="translate(${x} ${y}) scale(${k})" d="M0 9C-14 -1 -9 -12 0 -6C9 -12 14 -1 0 9z" fill="${fill}"/>`;

  const GRADS = {
    b: ['#9be8ff', '#2f7bff'],            // основен син (фирмен)
    r: ['#ffb199', '#e0452b'],            // ядосан
    h: ['#ff9ec0', '#e0245e'],            // сърце
    o: ['#ffe27a', '#ff6a1a'],            // огън
    g: ['#fff0a0', '#ffb300'],            // злато
    c: ['#e9fbff', '#4cc9ff'],            // лед
    p: ['#ffc2f0', '#8a5cff'],            // лилаво
  };
  const defs = k => `<defs><radialGradient id="g" cx=".32" cy=".26" r=".95"><stop offset="0" stop-color="${GRADS[k][0]}"/><stop offset="1" stop-color="${GRADS[k][1]}"/></radialGradient></defs>`;
  const face = (k = 'b') => `${defs(k)}<circle cx="32" cy="32" r="29" fill="url(#g)" stroke="#0b2f66" stroke-opacity=".55" stroke-width="2"/><ellipse cx="23" cy="15" rx="12" ry="5.5" fill="#fff" opacity=".3" transform="rotate(-18 23 15)"/>`;
  const dots = '<circle cx="23" cy="28" r="3.3" fill="#07203f"/><circle cx="41" cy="28" r="3.3" fill="#07203f"/>';
  const smile = `<path d="M21 38Q32 49 43 38" ${ST()}/>`;
  const arcEyes = `<path d="M17 30Q23 22 29 30" ${ST()}/><path d="M35 30Q41 22 47 30" ${ST()}/>`;
  const cheeks = '<ellipse cx="14.5" cy="38" rx="5" ry="3.2" fill="#ff6f9f" opacity=".6"/><ellipse cx="49.5" cy="38" rx="5" ry="3.2" fill="#ff6f9f" opacity=".6"/>';

  const SVG = {
    smile: face() + dots + smile,
    grin: face() + dots + `<path d="M18 36Q32 56 46 36Z" fill="${INK}"/><path d="M21 37.5Q32 42 43 37.5" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M26 47Q32 44 38 47" stroke="#ff7a8f" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    laugh: face() + arcEyes + `<path d="M18 37Q32 58 46 37Z" fill="${INK}"/><path d="M23 49Q32 44 41 49" stroke="#ff7a8f" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M9 29c-4 5-1 9 1.5 9s3.5-4-1.5-9z" fill="#bff1ff" stroke="#2f7bff" stroke-width="1.2"/><path d="M55 29c4 5 1 9-1.5 9s-3.5-4 1.5-9z" fill="#bff1ff" stroke="#2f7bff" stroke-width="1.2"/>`,
    wink: face() + '<circle cx="23" cy="28" r="3.3" fill="#07203f"/>' + `<path d="M35 29Q41 22 47 29" ${ST()}/>` + smile,
    love: face() + heartAt(23, 28, .8) + heartAt(41, 28, .8) + smile,
    kiss: face() + '<circle cx="23" cy="28" r="3.3" fill="#07203f"/>' + `<path d="M35 29Q41 22 47 29" ${ST()}/>` + '<path d="M27 42q4-5 8 0q-4 6-8 0z" fill="#ff4f7b" stroke="#a3153d" stroke-width="1.4"/>' + heartAt(50, 17, .5),
    blush: face() + dots + smile + cheeks,
    cool: face() + `<path d="M11 24h42v4c0 7-5 10-11 10-5 0-8-3-9-6-1-1.5-3-1.5-4 0-1 3-4 6-9 6-6 0-9-3-9-10z" fill="${INK}"/><path d="M15 27l6-2M37 27l6-2" stroke="#fff" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>` + `<path d="M22 44Q32 51 42 44" ${ST()}/>`,
    think: face() + dots + `<path d="M17 18Q23 13 29 18" ${ST(2.6)}/><path d="M36 20L46 20" ${ST(2.6)}/><path d="M24 43Q29 39 33 43T42 42" ${ST(2.8)}/>`,
    wow: face() + '<circle cx="23" cy="27" r="5.4" fill="#fff" stroke="#07203f" stroke-width="2"/><circle cx="41" cy="27" r="5.4" fill="#fff" stroke="#07203f" stroke-width="2"/><circle cx="23" cy="28" r="2.4" fill="#07203f"/><circle cx="41" cy="28" r="2.4" fill="#07203f"/>' + `<path d="M16 15Q23 10 29 15M35 15Q41 10 48 15" ${ST(2.4)}/><ellipse cx="32" cy="44" rx="5" ry="6.5" fill="${INK}"/>`,
    sad: face() + dots + `<path d="M16 21L28 18.5M48 21L36 18.5" ${ST(2.6)}/><path d="M22 46Q32 37 42 46" ${ST()}/>`,
    cry: face() + dots + `<path d="M23 33q-3 9 0 15M41 33q3 9 0 15" stroke="#e3f9ff" stroke-width="4.5" fill="none" stroke-linecap="round" opacity=".9"/><path d="M15 21L28 19M49 21L36 19" ${ST(2.6)}/><path d="M23 47Q32 39 41 47Z" fill="${INK}"/>`,
    angry: face('r') + '<circle cx="24" cy="30" r="3" fill="#07203f"/><circle cx="40" cy="30" r="3" fill="#07203f"/>' + `<path d="M15 20L29 27M49 20L35 27" ${ST(3.4)}/><path d="M22 47Q32 38 42 47" ${ST()}/>`,
    sleep: face() + `<path d="M17 29Q23 34 29 29M35 29Q41 34 47 29" ${ST(2.8)}/><ellipse cx="32" cy="43" rx="3.4" ry="2.8" fill="${INK}"/><path d="M45 10h8l-8 8h8M52 2h6l-6 6h6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    party: `<defs><linearGradient id="hat" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ff5da2"/><stop offset="1" stop-color="#ffd23f"/></linearGradient></defs>` + `<g transform="translate(3.2 7) scale(.9)">` + face() + dots + smile + `</g>` + `<path d="M21 18L32 2 43 18Z" fill="url(#hat)" stroke="#07203f" stroke-width="1.6" stroke-linejoin="round"/><circle cx="32" cy="3" r="3.2" fill="#fff" stroke="#07203f" stroke-width="1.2"/><circle cx="8" cy="12" r="2.2" fill="#ffd23f"/><circle cx="56" cy="14" r="2.2" fill="#ff5da2"/><circle cx="55" cy="46" r="2" fill="#7affc8"/><circle cx="9" cy="48" r="2" fill="#ff5da2"/>`,
    smirk: face() + dots + `<path d="M23 42Q33 46 43 36" ${ST()}/>` + `<ellipse cx="49.5" cy="37" rx="4" ry="2.6" fill="#ff6f9f" opacity=".5"/>`,

    heart: `<defs><radialGradient id="g" cx=".32" cy=".3" r=".9"><stop offset="0" stop-color="#ff9ec0"/><stop offset="1" stop-color="#d4154f"/></radialGradient></defs><path d="${HEART}" fill="url(#g)" stroke="#8a0f35" stroke-opacity=".55" stroke-width="2"/><ellipse cx="20" cy="21" rx="6.5" ry="3.6" fill="#fff" opacity=".42" transform="rotate(-35 20 21)"/>`,
    broken: `<defs><radialGradient id="g" cx=".32" cy=".3" r=".9"><stop offset="0" stop-color="#ff9ec0"/><stop offset="1" stop-color="#d4154f"/></radialGradient></defs><path d="${HEART}" fill="url(#g)" stroke="#8a0f35" stroke-opacity=".55" stroke-width="2"/><path d="M35 14L28 27L38 34L27 45L33 56" stroke="#07203f" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    fire: `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4d00"/><stop offset=".6" stop-color="#ff9d1a"/><stop offset="1" stop-color="#ffe27a"/></linearGradient></defs><path d="M33 3C34 15 49 22 49 40A17 17 0 0 1 15 40C15 31 20 26 24 22c0 7 3 10 6 10 0-9-2-18 3-29z" fill="url(#g)" stroke="#a82d00" stroke-opacity=".5" stroke-width="2" stroke-linejoin="round"/><path d="M32 60a9 9 0 0 1-9-9c0-6 5-9 7-14 1 4 3 5 5 5 3 2 6 5 6 9a9 9 0 0 1-9 9z" fill="#ffe27a" opacity=".92"/>`,
    star: `<defs><radialGradient id="g" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fff3a8"/><stop offset="1" stop-color="#ffab00"/></radialGradient></defs><polygon points="32,4 39.6,23.5 60.5,24.8 44.2,37.9 49.6,58.2 32,46.8 14.4,58.2 19.8,37.9 3.5,24.8 24.4,23.5" fill="url(#g)" stroke="#b36b00" stroke-opacity=".55" stroke-width="2" stroke-linejoin="round"/>`,
    spark: `<defs><radialGradient id="g" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#3da5ff"/></radialGradient></defs><path d="M30 4C32 22 40 30 58 32C40 34 32 42 30 60C28 42 20 34 2 32C20 30 28 22 30 4Z" fill="url(#g)" stroke="#0b4a9a" stroke-opacity=".5" stroke-width="2" stroke-linejoin="round"/><path d="M50 6c.8 5 3 7 8 8-5 1-7 3-8 8-1-5-3-7-8-8 5-1 7-3 8-8z" fill="#bfe8ff"/><path d="M52 44c.6 3.6 2 5 5.5 5.6-3.5.6-4.9 2-5.5 5.6-.6-3.6-2-5-5.5-5.6 3.5-.6 4.9-2 5.5-5.6z" fill="#fff"/>`,
    lips: `<defs><radialGradient id="g" cx=".4" cy=".3" r=".9"><stop offset="0" stop-color="#ff7a93"/><stop offset="1" stop-color="#c4143f"/></radialGradient></defs><path d="M6 33C14 20 25 22 32 27C39 22 50 20 58 33C50 50 40 55 32 55C24 55 14 50 6 33Z" fill="url(#g)" stroke="#7d0d2b" stroke-opacity=".6" stroke-width="2" stroke-linejoin="round"/><path d="M9 34Q32 41 55 34" stroke="#7d0d2b" stroke-width="2.6" fill="none" stroke-linecap="round"/><ellipse cx="22" cy="31" rx="6" ry="2.4" fill="#fff" opacity=".4" transform="rotate(-12 22 31)"/>`,
    coffee: `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#7cc6ff"/></linearGradient></defs><path d="M46 31h4a7 7 0 0 1 0 14h-6" stroke="#0b4a9a" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M10 26h38v14a15 15 0 0 1-15 15h-8a15 15 0 0 1-15-15z" fill="url(#g)" stroke="#0b4a9a" stroke-opacity=".7" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 30h30v3H14z" fill="#7a4a2b" opacity=".85"/><ellipse cx="29" cy="58" rx="22" ry="3.4" fill="#0b4a9a" opacity=".35"/><path d="M20 20q-3-4 0-8t0-8M30 20q-3-4 0-8t0-8M40 20q-3-4 0-8t0-8" stroke="#d6f1ff" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    thumbs: `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9be8ff"/><stop offset="1" stop-color="#2f7bff"/></linearGradient></defs><rect x="6" y="28" width="13" height="29" rx="3.5" fill="#1d5fd1" stroke="#0b2f66" stroke-opacity=".6" stroke-width="2"/><path d="M23 29L32 8C37 6.5 41.5 10 40.5 15.5L38.5 25H53C58.5 25 61.5 29.5 60.5 34.5L57 51C56 55 53 57 49 57H23Z" fill="url(#g)" stroke="#0b2f66" stroke-opacity=".6" stroke-width="2" stroke-linejoin="round"/><path d="M33 36H55M33 44H53M33 51H50" stroke="#0b2f66" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>`,
    gift: `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc2f0"/><stop offset="1" stop-color="#8a5cff"/></linearGradient></defs><rect x="10" y="30" width="44" height="27" rx="3.5" fill="url(#g)" stroke="#3b1f99" stroke-opacity=".6" stroke-width="2"/><rect x="6" y="21" width="52" height="11" rx="3.5" fill="url(#g)" stroke="#3b1f99" stroke-opacity=".6" stroke-width="2"/><rect x="28.5" y="21" width="7" height="36" fill="#ffd23f"/><path d="M32 21C24 6 11 9 17 17C21 22 29 21 32 21ZM32 21C40 6 53 9 47 17C43 22 35 21 32 21Z" fill="#ffd23f" stroke="#b36b00" stroke-opacity=".6" stroke-width="2" stroke-linejoin="round"/>`,
    crown: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a0"/><stop offset="1" stop-color="#ffab00"/></linearGradient></defs><path d="M6 47L10 17L23 31L32 11L41 31L54 17L58 47Z" fill="url(#g)" stroke="#b36b00" stroke-opacity=".7" stroke-width="2" stroke-linejoin="round"/><rect x="6" y="47" width="52" height="9" rx="2.5" fill="url(#g)" stroke="#b36b00" stroke-opacity=".7" stroke-width="2"/><circle cx="32" cy="38" r="3.6" fill="#ff4f7b"/><circle cx="18" cy="42" r="2.6" fill="#3da5ff"/><circle cx="46" cy="42" r="2.6" fill="#3da5ff"/><circle cx="10" cy="14" r="3" fill="#fff3a8"/><circle cx="32" cy="8" r="3" fill="#fff3a8"/><circle cx="54" cy="14" r="3" fill="#fff3a8"/>`,
    moon: `<defs><radialGradient id="g" cx=".3" cy=".3" r=".9"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#ffc83d"/></radialGradient></defs><path d="M39 5a27 27 0 1 0 20 43A23 23 0 0 1 39 5z" fill="url(#g)" stroke="#b36b00" stroke-opacity=".55" stroke-width="2" stroke-linejoin="round"/><circle cx="24" cy="34" r="3.2" fill="#e0a82a" opacity=".6"/><circle cx="34" cy="48" r="2.4" fill="#e0a82a" opacity=".6"/><path d="M50 12c.6 3.6 2 5 5.6 5.6-3.6.6-5 2-5.6 5.6-.6-3.6-2-5-5.6-5.6 3.6-.6 5-2 5.6-5.6z" fill="#fff"/>`,
    diamond: `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9fbff"/><stop offset="1" stop-color="#2fb6ff"/></linearGradient></defs><path d="M17 8H47L59 22L32 58L5 22Z" fill="url(#g)" stroke="#0b4a9a" stroke-opacity=".65" stroke-width="2" stroke-linejoin="round"/><path d="M5 22H59M17 8L25 22L32 58L39 22L47 8M25 22L32 8L39 22" stroke="#fff" stroke-opacity=".75" stroke-width="1.8" fill="none" stroke-linejoin="round"/>`,
  };

  const LABELS = {
    smile: 'Усмивка', grin: 'Широка усмивка', laugh: 'Смях', wink: 'Намигване', love: 'Влюбен', kiss: 'Целувка', blush: 'Срам', cool: 'Готин',
    think: 'Замислен', wow: 'Уау', sad: 'Тъжен', cry: 'Плаче', angry: 'Ядосан', sleep: 'Сънен', party: 'Празник', smirk: 'Хитра усмивка',
    heart: 'Сърце', broken: 'Разбито сърце', fire: 'Огън', star: 'Звезда', spark: 'Искра', lips: 'Устни', coffee: 'Кафе', thumbs: 'Харесвам',
    gift: 'Подарък', crown: 'Корона', moon: 'Луна', diamond: 'Диамант',
  };
  const NAMES = Object.keys(SVG);
  const urlCache = new Map();
  const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
  const url = name => {
    if (!urlCache.has(name)) urlCache.set(name, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wrap(SVG[name])));
    return urlCache.get(name);
  };

  // Обикновени емоджита (системните), групирани.
  const UNICODE = [
    ['Лица', '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤔 🤭 🤫 😐 😏 😒 🙄 😬 😌 😔 😴 😷 🤒 🥵 🥶 😎 🤓 😕 😟 😮 😲 😳 🥺 😢 😭 😱 😤 😡 😈'],
    ['Жестове', '👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 🙏 🤝 💪 👋 🤙 ☝️ 👀 🫶 🤗'],
    ['Любов', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💞 💓 💗 💖 💘 💝 😻 💋 💍 🌹'],
    ['Забавно', '🎉 🎊 🎁 🎂 🍾 🥂 🍻 🍕 🍔 🍟 🍫 🍰 ☕ 🍷 🌞 🌙 ⭐ ✨ 🔥 🌈 ⚽ 🎵 🎶 🎬 📸 ✈️ 🏖️ 🏔️ 🐶 🐱 🌸'],
  ].map(([title, str]) => ({ title, items: str.split(' ') }));

  const TOKEN = /:([a-z]+):/g;
  const PICT = /^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}\s]+$/u;
  // Разделя текст на части: { t: 'text', v } | { t: 'emo', v: име }. big = само 1–3 емотиконки/емоджита (показват се по-големи).
  function parse(text) {
    const parts = [];
    let last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (!SVG[m[1]]) continue;
      if (m.index > last) parts.push({ t: 'text', v: text.slice(last, m.index) });
      parts.push({ t: 'emo', v: m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ t: 'text', v: text.slice(last) });
    const emoCount = parts.filter(p => p.t === 'emo').length;
    const rest = parts.filter(p => p.t === 'text').map(p => p.v).join('');
    const restOk = rest.trim() === '' || PICT.test(rest);
    const uniCount = rest.trim() ? [...rest.replace(/\s/g, '')].filter(c => /\p{Extended_Pictographic}/u.test(c)).length : 0;
    return { parts, big: parts.length > 0 && restOk && emoCount + uniCount >= 1 && emoCount + uniCount <= 3 };
  }
  function img(name, cls = 'emo') {
    const el = document.createElement('img');
    el.className = cls; el.src = url(name); el.alt = `:${name}:`; el.title = LABELS[name]; el.width = 28; el.height = 28; el.draggable = false;
    return el;
  }
  // Връща { nodes, big } – готови DOM възли (текстът е само като text node → безопасно).
  function render(text) {
    const { parts, big } = parse(String(text || ''));
    return { nodes: parts.map(p => (p.t === 'emo' ? img(p.v) : document.createTextNode(p.v))), big };
  }

  window.SparkEmo = { names: NAMES, labels: LABELS, url, img, parse, render, unicode: UNICODE };
})();
