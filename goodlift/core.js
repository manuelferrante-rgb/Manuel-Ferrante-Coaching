// ¿oodLift — strumenti comuni a tutte le alzate.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Serie di punti dai landmark MediaPipe, fermi, ricostruzione dei pezzi coperti.
// Non dipende dal DOM: si può testare anche in Node.

export const LM = {
  NOSE: 0, L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_MOUTH: 9, R_MOUTH: 10,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28, L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
};

export const deg = r => r * 180 / Math.PI;

export function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))));
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const median = arr => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Riempie i buchi (null) interpolando, se il buco è breve.
export function fillGaps(values, times, maxGapSec = 0.2) {
  const out = values.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i] != null) { i++; continue; }
    let j = i;
    while (j < out.length && out[j] == null) j++;
    const prev = i - 1, next = j;
    if (prev >= 0 && next < out.length && times[next] - times[prev] <= maxGapSec) {
      for (let k = i; k < j; k++) {
        const f = (times[k] - times[prev]) / (times[next] - times[prev]);
        out[k] = { x: out[prev].x + (out[next].x - out[prev].x) * f, y: out[prev].y + (out[next].y - out[prev].y) * f };
      }
    }
    i = j;
  }
  return out;
}

// Media mobile centrata (si può fare perché l'analisi è in differita). La finestra resta
// simmetrica anche ai bordi dei buchi, altrimenti i picchi (la buca) verrebbero schiacciati.
export function smooth(points, halfWin) {
  return points.map((p, i) => {
    if (!p) return null;
    let k = 0;
    while (k < halfWin && points[i - k - 1] && points[i + k + 1]) k++;
    let sx = 0, sy = 0;
    for (let j = i - k; j <= i + k; j++) { sx += points[j].x; sy += points[j].y; }
    return { x: sx / (2 * k + 1), y: sy / (2 * k + 1) };
  });
}

// Converte i frame grezzi in serie di punti (in pixel) per il lato del corpo più visibile.
export function buildSeries(frames, width, height, minVis) {
  const sides = {
    left: { S: LM.L_SHOULDER, E: LM.L_ELBOW, W: LM.L_WRIST, H: LM.L_HIP, K: LM.L_KNEE, A: LM.L_ANKLE },
    right: { S: LM.R_SHOULDER, E: LM.R_ELBOW, W: LM.R_WRIST, H: LM.R_HIP, K: LM.R_KNEE, A: LM.R_ANKLE },
  };
  // punti in più (non usati per scegliere il lato): naso, bocca, punta e tallone del piede
  const extra = {
    left: { N: LM.NOSE, M: LM.L_MOUTH, T: LM.L_FOOT, Hl: LM.L_HEEL },
    right: { N: LM.NOSE, M: LM.R_MOUTH, T: LM.R_FOOT, Hl: LM.R_HEEL },
  };
  const visSum = side => frames.reduce((acc, f) => {
    if (!f.lm) return acc;
    const ids = Object.values(sides[side]);
    return acc + ids.reduce((a, id) => a + (f.lm[id]?.visibility ?? 0), 0) / ids.length;
  }, 0);
  const side = visSum('left') >= visSum('right') ? 'left' : 'right';
  const ids = sides[side];
  const t = frames.map(f => f.t);
  const dt = median(t.slice(1).map((v, i) => v - t[i])) || 1 / 20;
  const halfWin = Math.max(1, Math.round(0.08 / dt));

  const series = {};
  const visibility = {};
  for (const [key, id] of Object.entries({ ...ids, ...extra[side] })) {
    const raw = frames.map(f => {
      const p = f.lm?.[id];
      if (!p || (p.visibility ?? 1) < minVis) return null;
      return { x: p.x * width, y: p.y * height };
    });
    series[key] = smooth(fillGaps(raw, t), halfWin);
    visibility[key] = median(frames.map(f => f.lm?.[id]?.visibility ?? 0));
  }

  // Quanto è "laterale" la ripresa: di profilo le due anche quasi coincidono. Le spalle no,
  // perché nello squat sono coperte dal bilanciere e il modello le sparpaglia.
  const hipSpread = median(frames.map(f => {
    const l = f.lm?.[LM.L_HIP], r = f.lm?.[LM.R_HIP];
    return l && r && l.visibility > 0.7 && r.visibility > 0.7 ? Math.abs(l.x - r.x) * width : NaN;
  }));
  return { t, dt, side, series, visibility, hipSpread };
}

export const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');

// Cerca un buco nei dati di anca/ginocchio tra discesa e salita e stima l'angolo del femore
// nel punto più basso con una parabola sui fotogrammi visibili subito prima e subito dopo
// (l'angolo del femore cambia in modo regolare e in buca si ferma: forma a "cupola").
export function hiddenBottom({ t, femur, from, to }) {
  const ok = i => Number.isFinite(femur[i]);
  let a = -1, b = -1;
  for (let i = from; i <= to; i++) {
    if (!ok(i)) { if (a < 0) a = i; b = i; } else if (a >= 0) break;
  }
  if (a <= 0 || b >= t.length - 1 || !ok(a - 1) || !ok(b + 1)) return null;
  if (t[b] - t[a] > 1.2) return null;
  const pts = [];
  let before = 0, after = 0;
  for (let i = 0; i < t.length; i++) {
    if (!ok(i)) continue;
    if (i < a && t[a] - t[i] <= 0.35) { pts.push([t[i], femur[i]]); before++; }
    if (i > b && t[i] - t[b] <= 0.35) { pts.push([t[i], femur[i]]); after++; }
  }
  if (before < 2 || after < 2) return null;
  // minimi quadrati per f = c0 + c1·u + c2·u², con u centrato sul buco
  const tc = (t[a] + t[b]) / 2;
  const M = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const [ti, f] of pts) {
    const u = ti - tc, row = [1, u, u * u];
    for (let r = 0; r < 3; r++) { for (let c = 0; c < 3; c++) M[r][c] += row[r] * row[c]; M[r][3] += row[r] * f; }
  }
  for (let r = 0; r < 3; r++) {
    let piv = r; for (let q = r + 1; q < 3; q++) if (Math.abs(M[q][r]) > Math.abs(M[piv][r])) piv = q;
    [M[r], M[piv]] = [M[piv], M[r]];
    if (Math.abs(M[r][r]) < 1e-12) return null;
    for (let q = 0; q < 3; q++) if (q !== r) { const k = M[q][r] / M[r][r]; for (let c = r; c < 4; c++) M[q][c] -= k * M[r][c]; }
  }
  const c0 = M[0][3] / M[0][0], c1 = M[1][3] / M[1][1], c2 = M[2][3] / M[2][2];
  if (!(c2 < 0)) return null; // deve essere una cupola
  const u = Math.max(t[a] - tc, Math.min(t[b] - tc, -c1 / (2 * c2)));
  const edge = Math.max(femur[a - 1], femur[b + 1]);
  const est = Math.min(c0 + c1 * u + c2 * u * u, edge + 30); // non inventare più di 30°
  let idx = a; for (let i = a; i <= b; i++) if (Math.abs(t[i] - tc - u) < Math.abs(t[idx] - tc - u)) idx = i;
  return { femur: est, idx };
}

export function unclear(message, lift = 'squat') {
  return { lift, verdict: 'unclear', checks: [], warnings: [message], key: null, replay: null };
}


// A volte il modello trova la stessa persona due volte (scheletri quasi sovrapposti): si tiene il migliore.
function dedupe(cs) {
  const out = [];
  for (const c of [...cs].sort((a, b) => b.score - a.score)) {
    // stessa persona: quasi nello stesso punto e della stessa grandezza (chi passa davanti è più grande)
    const same = o => Math.hypot(o.cx - c.cx, o.cy - c.cy) < 0.2 * Math.min(o.size, c.size) && Math.max(o.size, c.size) < 1.25 * Math.min(o.size, c.size);
    if (!out.some(same)) out.push(c);
  }
  return out;
}
// Quante persone diverse ci sono in un fotogramma (per decidere se serve cercarne più di una).
export function countPeople(poses, width = 1, height = 1) {
  const cs = poses.map(lm => {
    const pts = [11, 12, 23, 24, 25, 26].map(i => lm[i]).filter(p => (p.visibility ?? 1) > 0.3);
    if (pts.length < 3) return null;
    const xs = pts.map(p => p.x * width), ys = pts.map(p => p.y * height);
    return { score: pts.length, size: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
      cx: xs.reduce((a, v) => a + v, 0) / xs.length, cy: ys.reduce((a, v) => a + v, 0) / ys.length };
  }).filter(Boolean);
  return dedupe(cs).length;
}

// In palestra spesso nell'inquadratura c'è più di una persona (giudici, spotter, chi passa).
// Il modello ne trova fino a 3 per fotogramma; qui si sceglie l'atleta e lo si segue nel tempo.
// L'atleta non è per forza il più grande o il più vicino al telefono (un giudice davanti lo è):
// è quello che fa l'alzata. Si collegano le persone da un fotogramma all'altro in "tracce" e si
// sceglie la traccia che si muove di più su e giù, con la postura giusta (sdraiato in panca,
// appeso con le mani sopra la testa a trazioni e muscle up).
// frames: [{ t, poses: [lm, …] }] → [{ t, lm }]
export function pickPerson(frames, lift, width = 1, height = 1) {
  if (!frames.some(f => f.poses)) return frames;
  const KEY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const info = lm => {
    const vis = KEY.reduce((a, i) => a + (lm[i]?.visibility ?? 0), 0) / KEY.length;
    const pts = KEY.map(i => lm[i]).filter(p => (p.visibility ?? 1) > 0.3);
    if (pts.length < 4) return null;
    const xs = pts.map(p => p.x * width), ys = pts.map(p => p.y * height);
    const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const sx = (lm[11].x + lm[12].x) / 2 * width, sy = (lm[11].y + lm[12].y) / 2 * height;
    const hx = (lm[23].x + lm[24].x) / 2 * width, hy = (lm[23].y + lm[24].y) / 2 * height;
    const wy = (lm[15].y + lm[16].y) / 2 * height;
    const lying = Math.abs(sx - hx) / (Math.abs(sx - hx) + Math.abs(sy - hy) + 1e-6); // 1 = busto orizzontale
    // sdraiato visto dai piedi o dalla testa: il busto sembra cortissimo rispetto alle spalle
    const shoulderW = Math.abs(lm[11].x - lm[12].x) * width, torsoLen = Math.hypot(sx - hx, sy - hy);
    const lyingEnd = shoulderW > 1.3 * torsoLen;
    let pose = lift === 'panca' ? (lying > 0.6 || lyingEnd ? 2 : 0.4) : (lying < 0.75 ? 1 : 0.5);
    // appeso alla sbarra (o sopra): mani all'altezza delle spalle o più in alto
    if ((lift === 'trazioni' || lift === 'muscleup') && wy < sy + 0.05 * size) pose *= 2.5;
    // il punto che fa l'alzata: le mani in panca e stacco, il busto nelle altre
    const my = lift === 'panca' || lift === 'stacco' ? wy : (sy + hy) / 2;
    return { lm, score: size * vis * pose, size, cx: (sx + hx) / 2, cy: (sy + hy) / 2, my };
  };
  const cands = frames.map(f => dedupe((f.poses || (f.lm ? [f.lm] : [])).map(info).filter(Boolean)));
  // tracce: ogni persona si collega a quella più vicina del fotogramma prima (anche con buchi brevi)
  const tracks = [];
  cands.forEach((cs, i) => {
    // coppie persona-traccia dalla più vicina alla più lontana: chi passa davanti all'atleta
    // non gli "ruba" la traccia
    const pairs = [];
    cs.forEach(c => tracks.forEach(tr => {
      if (i - tr.lastI > 12) return;
      const d = Math.hypot(c.cx - tr.last.cx, c.cy - tr.last.cy);
      if (d < 0.6 * tr.last.size) pairs.push({ c, tr, d });
    }));
    pairs.sort((a, b) => a.d - b.d);
    const doneC = new Set(), doneT = new Set();
    for (const { c, tr } of pairs) {
      if (doneC.has(c) || doneT.has(tr)) continue;
      tr.items.set(i, c); tr.next = c; doneC.add(c); doneT.add(tr);
    }
    for (const tr of doneT) { tr.last = tr.next; tr.lastI = i; }
    for (const c of cs) if (!doneC.has(c)) tracks.push({ items: new Map([[i, c]]), last: c, lastI: i });
  });
  if (!tracks.length) return frames.map(f => ({ t: f.t, lm: null }));
  const med = arr => { const v = arr.slice().sort((a, b) => a - b); return v[v.length >> 1]; };
  const value = tr => {
    const cs = [...tr.items.values()];
    const ys = cs.map(c => c.my).sort((a, b) => a - b);
    const range = ys[Math.floor(0.95 * (ys.length - 1))] - ys[Math.floor(0.05 * (ys.length - 1))];
    const size = med(cs.map(c => c.size));
    return cs.reduce((a, c) => a + c.score, 0) * (1 + 4 * Math.min(1, range / size));
  };
  const best = tracks.reduce((a, tr) => (value(tr) > value(a) ? tr : a));
  return frames.map((f, i) => ({ t: f.t, lm: best.items.get(i)?.lm ?? null }));
}

// Trova tutte le ripetizioni: discesa (downAt) → punto più profondo → ritorno in posizione (locked).
// Valido per tutte le alzate: per trazioni e muscle up "giù" vuol dire "su" (lontano dalla partenza).
// isReal(rep) scarta i falsi allarmi: per esempio la persona che esce dall'inquadratura
// dopo l'ultima ripetizione, o il video che continua senza nessuno.
export function findReps(n, downAt, locked, deeper, isReal = () => true) {
  const reps = [];
  let from = 0, prevUp = -1;
  while (from < n) {
    let fd = -1;
    for (let i = from; i < n; i++) if (downAt(i)) { fd = i; break; }
    if (fd < 0) break;
    let up = -1;
    for (let i = fd; i < n; i++) if (locked[i]) { up = i; break; }
    const end = up >= 0 ? up : n - 1;
    let bottom = fd;
    for (let i = fd; i <= end; i++) if (deeper(i, bottom)) bottom = i;
    let desc = -1;
    for (let i = fd; i > prevUp; i--) if (locked[i]) { desc = i; break; }
    reps.push({ desc, fd, bottom, up, end });
    if (up < 0) break;
    prevUp = up; from = up + 1;
  }
  // il video parte nel punto più profondo di una ripetizione già in corso: quel pezzo non si giudica
  if (reps.length > 1 && reps[0].desc < 0 && reps[0].bottom - reps[0].fd <= 2) reps.shift();
  return reps.filter(isReal);
}

// Mette insieme il verdetto. Una ripetizione: come in gara. Più ripetizioni: ognuna ha il suo
// verdetto e il riepilogo dice quali sono valide.
// Consigli: cosa sistemare (no rep) o cosa migliorare (valida ma al limite).
const TIPS = {
  noDrop: 'Spingi in modo continuo: se rallenti va bene, ma non tornare mai indietro.',
  depth: {
    squat: 'Scendi di più: il femore deve rompere il parallelo, con l\'anca chiaramente sotto il ginocchio.',
    panca: 'Porta il bilanciere fino al petto, con il gomito almeno all\'altezza della spalla.',
    dip: 'Scendi di più: la spalla deve andare chiaramente sotto il gomito.',
  },
  chestHold: 'Al petto fermati quasi un secondo (0,8 s), senza rimbalzare, poi spingi.',
  butt: 'Tieni il sedere incollato alla panca: spingi con le gambe senza alzare il bacino.',
  feet: 'Tieni i piedi piantati a terra per tutta l\'alzata.',
  lockout: {
    squat: 'Chiudi completamente: ginocchia distese in alto.',
    stacco: 'Chiudi completamente: ginocchia e anche distese.',
    panca: 'Chiudi completamente: braccia tese in alto.',
    dip: 'Chiudi completamente: braccia tese in alto.',
    trazioni: 'Torna giù fino a braccia completamente tese.',
  },
  shoulder: 'In chiusura porta le spalle indietro, dietro il bilanciere.',
  kip: 'Parti da fermo: niente movimento delle spalle per prendere slancio.',
  legs: 'Tieni le gambe ferme o muovile piano, senza calci.',
  chin: 'Tira più in alto: il mento deve superare chiaramente la sbarra.',
  knee: 'Tieni le ginocchia tese per tutta l\'alzata.',
  snap: 'Muoviti in modo fluido, senza scatti dell\'anca.',
  top: 'Arriva sopra la sbarra e distendi completamente le braccia.',
};
const tipFor = (lift, c) => { const v = TIPS[c.id]; return typeof v === 'object' ? v[lift] : v; };

// Video tagliato prima della fine: quella ripetizione non si può giudicare (non è "valida").
const END = {
  squat: 'gambe tese', stacco: 'gambe e anche tese', panca: 'braccia tese', dip: 'braccia tese',
  trazioni: 'braccia tese in basso', muscleup: 'braccia tese sopra la sbarra',
};
export const endMessage = lift => `Il video finisce prima della fine dell'alzata: riprendi tutta l'alzata, fino a ${END[lift] || 'chiusura completa'}.`;

export function assemble(lift, b, reps, globalWarnings, overlay) {
  for (const [k, r] of reps.entries()) {
    r.n = k + 1;
    // Finisce prima della chiusura: non si giudica. Restano no rep solo gli errori veri già visti
    // (non il fermo o la discesa, che il taglio del video può falsare).
    // Nelle trazioni la parte che conta (salita, mento sopra la sbarra) è già vista: se manca solo
    // il ritorno a braccia tese, l'alzata resta valida con una nota (deciso con Manuel).
    const cut = !r.unclear && r.checks.some(c => c.status === 'unknown' && /^Il video finisce prima/.test(c.detail) && !(lift === 'trazioni' && c.id === 'lockout'));
    if (cut && !r.checks.some(c => c.status === 'fail' && !['chestHold', 'noDrop'].includes(c.id))) r.unclear = endMessage(lift);
    r.verdict = r.unclear ? 'unclear' : r.checks.some(c => c.status === 'fail') ? 'norep' : 'good';
    r.missing = r.unclear ? 0 : r.checks.filter(c => c.status === 'unknown').length;
    r.reason = r.verdict === 'norep' ? r.checks.find(c => c.status === 'fail').detail : r.verdict === 'unclear' ? r.unclear : '';
  }
  const judged = reps.filter(r => r.verdict !== 'unclear');
  if (!judged.length) return unclear(reps[0].unclear, lift);
  const main = reps.length > 1 ? (reps.find(r => r.verdict === 'norep') || judged[0]) : reps[0];
  const verdict = judged.some(r => r.verdict === 'norep') ? 'norep' : 'good';
  const warnings = [...globalWarnings, ...new Set(reps.flatMap(r => r.warnings || []))];
  const missing = judged.reduce((a, r) => a + r.missing, 0);
  if (verdict === 'good' && missing) {
    const what = [...new Set(judged.flatMap(r => r.checks.filter(c => c.status === 'unknown').map(c => c.label.toLowerCase())))];
    const ends = judged.flatMap(r => r.checks.filter(c => c.status === 'unknown' && /^Il video finisce prima/.test(c.detail)).map(c => c.detail));
    if (ends.length) warnings.push(`${ends[0].replace(/\.$/, '')}: non l'ho potuto controllare. Tutto il resto è valido.`);
    else warnings.push(`Non si vede bene, quindi non l'ho potuto controllare: ${what.join(', ')}. Tutto il resto è valido.`);
  }
  const valid = judged.filter(r => r.verdict === 'good').length;
  // al limite: valida, ma da migliorare
  for (const r of reps) {
    for (const c of r.checks) if (c.status === 'pass' && /^Al limite/.test(c.detail)) c.borderline = true;
    const tc = r.verdict === 'norep' ? r.checks.filter(c => c.status === 'fail') : r.checks.filter(c => c.borderline);
    r.tips = [...new Set(tc.map(c => tipFor(lift, c)).filter(Boolean))];
  }
  const tips = main.tips;
  return {
    lift, verdict, missing, checks: main.checks, warnings, side: b.side, key: main.key,
    borderline: verdict === 'good' && main.checks.some(c => c.borderline), tips,
    // no rep per poco: tutto quello che è sbagliato lo è di pochissimo
    close: verdict === 'norep' && main.checks.filter(c => c.status === 'fail').every(c => c.close),
    reps: reps.length > 1 ? reps : null, mainRep: main.n,
    summary: reps.length > 1 ? `${valid} ${valid === 1 ? 'valida' : 'valide'} su ${reps.length}` : null,
    replay: { t: b.t, series: b.series, ...overlay, focusTs: reps.map(r => r.key.focus) },
  };
}
