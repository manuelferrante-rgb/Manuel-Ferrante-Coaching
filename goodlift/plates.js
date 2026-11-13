// ¿oodLift — trova e segue il disco (o la punta del bilanciere) nell'immagine.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Visto di lato, un disco è un cerchio e il suo centro è la punta del bilanciere (o il punto
// in cui la cintura regge i dischi). Si cerca il cerchio con la trasformata di Hough sui bordi
// dell'immagine (in piccolo, in scala di grigi) vicino a dove ce lo aspettiamo, e poi lo si
// segue da un fotogramma all'altro cercando solo lì intorno. Niente DOM: si testa in Node.

// Bordi: gradiente di Sobel; si tengono i pixel con gradiente forte.
function edges(gray, w, h) {
  const out = [];
  let sum = 0, n = 0;
  const mag = new Float32Array(w * h), gxs = new Float32Array(w * h), gys = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m; gxs[i] = gx; gys[i] = gy; sum += m; n++;
    }
  }
  const thr = Math.max(60, 2.2 * sum / n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (mag[i] > thr) out.push({ x, y, dx: gxs[i] / mag[i], dy: gys[i] / mag[i] });
  }
  return out;
}

// Miglior cerchio con centro dentro `area` ({x, y, r}) e raggio tra rMin e rMax.
// score = frazione della circonferenza sostenuta da bordi (0–1).
export function findCircle(gray, w, h, area, rMin, rMax) {
  const E = edges(gray, w, h);
  const rs = [];
  for (let r = Math.max(4, Math.round(rMin)); r <= Math.round(rMax); r += r < 20 ? 1 : 2) rs.push(r);
  if (!rs.length) return null;
  const x0 = Math.max(0, Math.floor(area.x - area.r)), x1 = Math.min(w - 1, Math.ceil(area.x + area.r));
  const y0 = Math.max(0, Math.floor(area.y - area.r)), y1 = Math.min(h - 1, Math.ceil(area.y + area.r));
  const aw = x1 - x0 + 1, ah = y1 - y0 + 1;
  if (aw < 2 || ah < 2) return null;
  const acc = rs.map(() => new Float32Array(aw * ah));
  const r2 = area.r * area.r;
  for (const e of E) {
    for (let k = 0; k < rs.length; k++) {
      const r = rs[k];
      for (const s of [1, -1]) { // il disco può essere più chiaro o più scuro dello sfondo
        const cx = Math.round(e.x + s * e.dx * r), cy = Math.round(e.y + s * e.dy * r);
        if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
        if ((cx - area.x) ** 2 + (cy - area.y) ** 2 > r2) continue;
        acc[k][(cy - y0) * aw + (cx - x0)] += 1;
      }
    }
  }
  let best = null;
  for (let k = 0; k < rs.length; k++) {
    const a = acc[k], r = rs[k];
    for (let y = 1; y < ah - 1; y++) for (let x = 1; x < aw - 1; x++) {
      const i = y * aw + x;
      // un po' di tolleranza: somma 3×3 (i bordi veri non cadono tutti sullo stesso pixel)
      const v = a[i] + 0.5 * (a[i - 1] + a[i + 1] + a[i - aw] + a[i + aw]);
      const score = v / (2 * Math.PI * r * 1.6);
      if (!best || score > best.score) best = { x: x + x0, y: y + y0, r, score };
    }
  }
  return best;
}

// Segue il disco in tutti i fotogrammi.
// frames: [{ gray, seed: {x, y} | null }], w, h nella scala dei grigi; body = lunghezza del corpo
// (stessa scala) per stimare la grandezza del disco. Restituisce un centro (o null) per fotogramma.
export function trackPlate(frames, w, h, body, { minScore = 0.33 } = {}) {
  const out = frames.map(() => null);
  if (!frames.length || !(body > 0)) return out;
  // 1) primo aggancio: il cerchio più netto vicino a dove ce lo aspettiamo, sui primi fotogrammi utili
  let start = -1, found = null;
  for (let i = 0; i < frames.length && start < 0; i++) {
    const f = frames[i];
    if (!f.seed || !f.gray) continue;
    const c = findCircle(f.gray, w, h, { x: f.seed.x, y: f.seed.y, r: 0.45 * body }, 0.07 * body, 0.24 * body);
    if (c && c.score >= minScore) { start = i; found = c; }
  }
  if (start < 0) return out;
  out[start] = found;
  // 2) avanti e indietro: si cerca solo vicino al centro e al raggio di prima
  const follow = (from, to, step) => {
    let prev = found, miss = 0;
    for (let i = from + step; i !== to; i += step) {
      const f = frames[i];
      if (!f.gray) continue;
      const c = findCircle(f.gray, w, h, { x: prev.x, y: prev.y, r: Math.max(6, 0.35 * prev.r) }, prev.r * 0.85, prev.r * 1.15);
      if (c && c.score >= minScore * 0.8) { out[i] = c; prev = c; miss = 0; } else if (++miss > 6) break;
    }
  };
  follow(start, frames.length, 1);
  follow(start, -1, -1);
  return out;
}
