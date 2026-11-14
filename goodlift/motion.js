// ¿oodLift — telefono che si muove: quanto si sposta l'inquadratura.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Se il video è fatto con il telefono in mano, tutto l'immagine si sposta un po' (su, giù, di lato).
// Per il giudizio contano i movimenti dell'atleta, non quelli del telefono: si misura quanto si
// sposta lo sfondo rispetto al primo fotogramma (le persone si escludono, perché si muovono loro)
// e si toglie quello spostamento dai punti del corpo. Lavora sulle copie piccole in grigio dei
// fotogrammi (quelle usate anche per trovare il disco). Non dipende dal DOM.

// Riquadri delle persone in un fotogramma (pixel della copia piccola), un po' allargati.
function personBoxes(poses, gw, gh) {
  const out = [];
  for (const lm of poses || []) {
    const pts = lm.filter(p => (p.visibility ?? 1) > 0.2);
    if (pts.length < 4) continue;
    const xs = pts.map(p => p.x * gw), ys = pts.map(p => p.y * gh);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // un piccolo margine: lo sfondo deve restare visibile (dischi e bilanciere sono poca cosa)
    const mx = 0.1 * (x1 - x0) + 3, my = 0.05 * (y1 - y0) + 3;
    out.push([x0 - mx, y0 - my, x1 + mx, y1 + my]);
  }
  return out;
}

// Spostamento (dx, dy) del fotogramma `b` rispetto a `a`: quello che rende le due immagini più
// simili fuori dalle persone. Si cerca intorno a `guess`.
function match(a, b, gw, gh, mask, guess, R) {
  let best = null, bestCost = Infinity;
  for (let dy = guess.dy - R; dy <= guess.dy + R; dy++) {
    for (let dx = guess.dx - R; dx <= guess.dx + R; dx++) {
      let sum = 0, n = 0;
      for (let y = 4; y < gh - 4; y += 3) {
        const yb = y + dy; if (yb < 0 || yb >= gh) continue;
        for (let x = 4; x < gw - 4; x += 3) {
          const xb = x + dx; if (xb < 0 || xb >= gw) continue;
          const k = y * gw + x;
          if (mask[k]) continue;
          sum += Math.abs(a[k] - b[yb * gw + xb]); n++;
        }
      }
      if (n < 120) continue;
      const cost = sum / n;
      if (cost < bestCost) { bestCost = cost; best = { dx, dy }; }
    }
  }
  return best && { ...best, cost: bestCost };
}

// frames: [{ gray, poses }] → per ogni fotogramma lo spostamento dell'inquadratura rispetto al primo
// ({ dx, dy } in frazioni della larghezza/altezza), oppure null se il telefono è fermo.
export function cameraShift(frames, gw, gh) {
  const ref = frames.find(f => f.gray);
  if (!ref) return null;
  const n = gw * gh;
  const maskOf = f => {
    const mask = new Uint8Array(n);
    for (const [x0, y0, x1, y1] of [...personBoxes(ref.poses, gw, gh), ...personBoxes(f.poses, gw, gh)]) {
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(gh, Math.ceil(y1)); y++) mask.fill(1, y * gw + Math.max(0, Math.floor(x0)), y * gw + Math.min(gw, Math.ceil(x1)));
    }
    return mask;
  };
  // Controllo veloce (4 fotogrammi): se il telefono è fermo non si fa altro.
  const withGray = frames.filter(f => f.gray);
  const probe = [0.25, 0.5, 0.75, 1].map(q => withGray[Math.max(0, Math.round(q * (withGray.length - 1)))]);
  if (!probe.some(f => { const m = match(ref.gray, f.gray, gw, gh, maskOf(f), { dx: 0, dy: 0 }, 10); return m && (Math.abs(m.dx) >= 3 || Math.abs(m.dy) >= 3); })) return null;
  const out = [];
  let prev = { dx: 0, dy: 0 };
  for (const f of frames) {
    if (!f.gray) { out.push({ ...prev }); continue; }
    if (f === ref) { out.push({ dx: 0, dy: 0 }); continue; }
    const mask = maskOf(f);
    // prima vicino allo spostamento di prima; se non torna bene, si cerca più largo
    let m = match(ref.gray, f.gray, gw, gh, mask, prev, 3);
    if (!m || m.dx === prev.dx - 3 || m.dx === prev.dx + 3 || m.dy === prev.dy - 3 || m.dy === prev.dy + 3) m = match(ref.gray, f.gray, gw, gh, mask, prev, 10) || m;
    prev = m ? { dx: m.dx, dy: m.dy } : prev;
    out.push({ ...prev });
  }
  // telefono fermo: niente da correggere (si evita di aggiungere rumore)
  const big = out.some(s => Math.abs(s.dx) >= 3 || Math.abs(s.dy) >= 3);
  if (!big) return null;
  return out.map(s => ({ dx: s.dx / gw, dy: s.dy / gh }));
}

// Toglie lo spostamento del telefono dai punti del corpo. I punti originali restano in `orig`
// (servono a disegnare lo scheletro sopra il video, che si muove davvero).
export function stabilize(frames, shift) {
  if (!shift) return frames;
  return frames.map((f, i) => {
    const s = shift[i];
    const fix = lm => {
      const out = lm.map(p => ({ ...p, x: p.x - s.dx, y: p.y - s.dy }));
      Object.defineProperty(out, 'orig', { value: lm });
      return out;
    };
    return { ...f, poses: f.poses?.map(fix), lm: f.lm ? fix(f.lm) : f.lm };
  });
}
