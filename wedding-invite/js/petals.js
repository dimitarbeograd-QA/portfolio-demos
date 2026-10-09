/* Падащи листенца от рози (canvas, с 3D завъртане) */
(function () {
  const PALETTES = {
    garden: { kinds: null, hearts: null },
    emerald: { kinds: [['#2E0610','#5E1226','#8E2A44'],['#4A0F1F','#7E1F38','#B0425C'],['#7A1E36','#B8506A','#E6A0B0'],['#EFE6CF','#D9C79B','#B9A06A'],['#5C1A2B','#8F3148','#C26078']], hearts: [['#FF7A8E','#D0213F','#8E0F27'],['#F3E0A2','#C9A24F','#8D6A25'],['#FF9AA8','#E5495F','#A8142E']] },
    blush: { kinds: [['#C0607A','#E58EA2','#FAD0D8'],['#D47A92','#F2A9B8','#FFE3E8'],['#E8A2B2','#F8CBD4','#FFF1F3'],['#F4C2CA','#FFE0E6','#FFFFFF'],['#B5566E','#DB8197','#F6BFCB']], hearts: [['#FFB3C1','#F06A86','#B02A4C'],['#FFD0DA','#F59BAE','#C8506C'],['#FF7A8E','#D0213F','#8E0F27']] },
    gold: { kinds: [['#8D6A25','#D4AE58','#F7E7B0'],['#B48B3D','#E9CF86','#FFF6D6'],['#C9A24F','#F3E0A2','#FFFFFF'],['#EFE4C8','#F9F2DE','#FFFFFF'],['#6E5018','#B48B3D','#E3C676']], hearts: [['#FFF3C8','#E3C676','#A8803A'],['#F3E0A2','#C9A24F','#8D6A25'],['#FF7A8E','#D0213F','#8E0F27']] },
    noir: { kinds: [['#6E5018','#C9A24F','#F3E0A2'],['#8D6A25','#E3C676','#FFF3C8'],['#1A1A1A','#3A3A3A','#6A6A6A'],['#B48B3D','#F3E0A2','#FFF8E0'],['#3A2A08','#8D6A25','#D4B25E']], hearts: [['#F3E0A2','#C9A24F','#8D6A25'],['#FFF3C8','#E3C676','#A8803A'],['#FF7A8E','#D0213F','#8E0F27']] }
  };
  const KINDS = [
    ['#16224C', '#2B3C7C', '#5670B4'],
    ['#1C2A5E', '#33488F', '#6F87C8'],
    ['#25346C', '#4A62A8', '#93A9DC'],
    ['#5A6FA8', '#A5B8E0', '#E3EAF7'],
    ['#3A4F94', '#7F97CC', '#C3D0EE']
  ];
  const SW = 72, SH = 92;

  function sprite(c, back) {
    const cv = document.createElement('canvas');
    cv.width = SW; cv.height = SH;
    const x = cv.getContext('2d');
    const path = () => {
      x.beginPath();
      x.moveTo(SW / 2, 6);
      x.bezierCurveTo(SW - 2, 14, SW - 4, SH * 0.62, SW / 2, SH - 6);
      x.bezierCurveTo(4, SH * 0.62, 2, 14, SW / 2, 6);
      x.closePath();
    };
    const g = x.createLinearGradient(0, 0, SW, SH);
    g.addColorStop(0, back ? c[1] : c[2]);
    g.addColorStop(0.55, back ? c[0] : c[1]);
    g.addColorStop(1, back ? c[1] : c[0]);
    path(); x.fillStyle = g; x.fill();
    x.save(); path(); x.clip();
    const d = x.createRadialGradient(SW / 2, SH - 6, 2, SW / 2, SH - 6, 36);
    d.addColorStop(0, 'rgba(0,0,0,.45)'); d.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = d; x.fillRect(0, 0, SW, SH);
    x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      x.beginPath(); x.moveTo(SW / 2, SH - 8);
      x.quadraticCurveTo(SW / 2 + i * 12, SH * 0.5, SW / 2 + i * 15, 18); x.stroke();
    }
    const gl = x.createLinearGradient(0, 0, SW, 0);
    gl.addColorStop(0, 'rgba(255,255,255,.28)'); gl.addColorStop(0.4, 'rgba(255,255,255,0)');
    x.fillStyle = gl; x.fillRect(0, 0, SW, SH);
    x.restore();
    path(); x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1.2; x.stroke();
    return cv;
  }

  const HEARTS = [['#FF7A8E', '#D0213F', '#8E0F27'], ['#FF9AA8', '#E5495F', '#A8142E'], ['#9DB4EA', '#4A62A8', '#26356E'], ['#C3D0F5', '#7F97CC', '#3A4F94']];
  function heartSprite(c) {
    const S = 64, cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const x = cv.getContext('2d');
    x.beginPath();
    x.moveTo(32, 56);
    x.bezierCurveTo(6, 38, 4, 16, 18, 10);
    x.bezierCurveTo(26, 7, 31, 12, 32, 18);
    x.bezierCurveTo(33, 12, 38, 7, 46, 10);
    x.bezierCurveTo(60, 16, 58, 38, 32, 56);
    x.closePath();
    const g = x.createRadialGradient(24, 20, 2, 32, 32, 34);
    g.addColorStop(0, c[0]); g.addColorStop(0.55, c[1]); g.addColorStop(1, c[2]);
    x.fillStyle = g; x.fill();
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1.2; x.stroke();
    x.beginPath(); x.ellipse(20, 20, 6, 3.5, -0.7, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,.5)'; x.fill();
    return cv;
  }

  window.Petals = {
    start() {
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const cv = document.getElementById('petals');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      let sprites = [];
      let hs = [];
      function buildSprites() {
        const look = (window.WeddingLook && WeddingLook.name) || 'garden';
        const pal = PALETTES[look] || PALETTES.garden;
        sprites = (pal.kinds || KINDS).map(k => [sprite(k, false), sprite(k, true)]);
        hs = (pal.hearts || HEARTS).map(heartSprite);
      }
      buildSprites();
      document.addEventListener('lookchange', buildSprites);
      let W = 0, H = 0;
      function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = innerWidth; H = innerHeight;
        cv.width = W * dpr; cv.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resize();
      addEventListener('resize', resize);

      function make(initial) {
        const z = Math.random();
        return {
          x: Math.random() * W,
          y: initial ? Math.random() * H : -SH,
          z, sc: 0.16 + z * 0.32,
          vy: 0.35 + z * 1.0,
          sway: Math.random() * Math.PI * 2,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.02,
          fx: Math.random() * Math.PI * 2, fy: Math.random() * Math.PI * 2,
          vfx: 0.01 + Math.random() * 0.025, vfy: 0.01 + Math.random() * 0.02,
          a: 0.55 + z * 0.4,
          k: Math.floor(Math.random() * 5)
        };
      }
      function makeHeart(initial) {
        const s = 12 + Math.random() * 18;
        return {
          x: Math.random() * W, y: initial ? Math.random() * H : H + 30,
          s, vy: 0.45 + Math.random() * 0.8, sway: Math.random() * 6.28, sw: 0.012 + Math.random() * 0.02,
          amp: 0.4 + Math.random() * 0.7, rot: (Math.random() - 0.5) * 0.5, k: Math.floor(Math.random() * 6), a: 0.7 + Math.random() * 0.25
        };
      }
      const hn = W < 500 ? 9 : 16;
      const hearts = Array.from({ length: hn }, () => makeHeart(true));
      const n = W < 500 ? 11 : 22;
      const ps = Array.from({ length: n }, () => make(true));

      const stageEl = document.getElementById('stage');
      function frame() {
        if (stageEl && !stageEl.classList.contains('go')) { requestAnimationFrame(frame); return; }
        ctx.clearRect(0, 0, W, H);
        ctx.shadowColor = 'rgba(15,25,70,.25)';
        ctx.shadowBlur = 3;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          p.y += p.vy; p.sway += 0.015; p.rot += p.vr; p.fx += p.vfx; p.fy += p.vfy;
          p.x += Math.sin(p.sway) * 0.6;
          if (p.y > H + SH) { ps[i] = make(false); continue; }
          const cf = Math.cos(p.fx), sf = Math.cos(p.fy);
          const back = cf < 0;
          ctx.save();
          ctx.globalAlpha = p.a;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(p.sc * (0.35 + 0.65 * Math.abs(sf)), p.sc * (0.35 + 0.65 * Math.abs(cf)));
          ctx.drawImage(sprites[p.k % sprites.length][back ? 1 : 0], -SW / 2, -SH / 2);
          ctx.restore();
        }
        for (let i = 0; i < hearts.length; i++) {
          const h = hearts[i];
          h.y -= h.vy; h.sway += h.sw; h.x += Math.sin(h.sway) * h.amp;
          if (h.y < -40) { hearts[i] = makeHeart(false); continue; }
          const fade = Math.min(1, h.y / (H * 0.22), (H - h.y + 30) / 60);
          ctx.save();
          ctx.globalAlpha = Math.max(0, h.a * fade);
          ctx.translate(h.x, h.y);
          ctx.rotate(h.rot + Math.sin(h.sway) * 0.25);
          ctx.drawImage(hs[h.k % hs.length], -h.s / 2, -h.s / 2, h.s, h.s);
          ctx.restore();
        }
        requestAnimationFrame(frame);
      }
      frame();
    }
  };
})();
