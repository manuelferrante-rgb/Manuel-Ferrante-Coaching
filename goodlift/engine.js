// ¿oodLift — motore di giudizio delle alzate.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Lavora su una sequenza di pose (landmark MediaPipe, coordinate normalizzate 0–1)
// e restituisce il verdetto con i controlli effettuati. Non dipende dal DOM:
// si può testare anche in Node.

export const LM = {
  NOSE: 0, L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANKLE: 27, R_ANKLE: 28,
};

// Soglie dello squat. Sono il punto da tarare con i video reali.
export const SQUAT = {
  lockoutKneeDeg: 158,     // ginocchio "teso" (se il video mostra la persona più dritta di così)
  lockoutRelDeg: 10,       // …oppure entro 10° dalla posizione più dritta vista nel video
  lockoutHipDropRatio: 0.045, // in piedi: anca entro il 4,5% del corpo dalla sua posizione più alta
  squattingKneeDeg: 125,   // sotto quest'angolo sei "in squat" (usato dai comandi vocali live)
  squatDropRatio: 0.12,    // sei "in squat" quando l'anca è scesa del 12% della lunghezza del corpo
  barDropMinSec: 0.08,     // la discesa in salita conta solo se dura almeno così (filtra il rumore)
  holdSec: 1.0,            // fermo richiesto in partenza e in chiusura
  holdToleranceSec: 0.12,  // margine per il campionamento dei fotogrammi
  holdSlackSec: 0.45,      // tempo max tra fine del fermo e inizio del movimento (e viceversa)
  stillRatio: 0.022,       // movimento max da fermo, in frazione della lunghezza del corpo
  // Profondità, misurata sulla linea anca–ginocchio di MediaPipe. Il punto "anca" del modello
  // sta più in alto dell'articolazione vera, quindi la linea risulta qualche grado più alta
  // del femore reale. Taratura provvisoria su squat validi: va confermata con video no rep.
  depthMinDeg: -9,         // sopra questo valore la profondità è sufficiente
  depthBorderlineDeg: 5,   // nei primi 5° oltre la soglia è "al limite"
  barDropRatio: 0.018,     // discesa tollerata in salita (~3 cm su un corpo di 1,7 m)
  minVisibility: 0.3,
};

const deg = r => r * 180 / Math.PI;

function angleAt(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return NaN;
  return deg(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))));
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = arr => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Riempie i buchi (null) interpolando, se il buco è breve.
function fillGaps(values, times, maxGapSec = 0.2) {
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
function smooth(points, halfWin) {
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
  for (const [key, id] of Object.entries(ids)) {
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

// Misura il fermo più lungo vicino ad `anchor`.
// dir = -1: fermo che finisce poco prima di `anchor` (partenza, prima della discesa).
// dir = +1: fermo che inizia poco dopo `anchor` (chiusura, dopo l'estensione).
// Un fermo è valido solo se per tutta la sua durata il corpo resta bloccato e immobile
// (anca, caviglia e "bilanciere" non si spostano più di `thr`, né in verticale né in orizzontale).
function measureHold({ t, dt, anchor, dir, locked, tracks, thr, slackSec, hasData }) {
  const n = t.length;
  // Il fermo "tocca il bordo" se oltre di lui il video finisce o la persona non si vede più:
  // in quel caso non sappiamo quanto sarebbe durato.
  const edge = i => i < 0 || i >= n || !hasData[i];
  let best = { found: false, dur: 0 };
  for (let e = anchor; e >= 0 && e < n && Math.abs(t[e] - t[anchor]) <= slackSec; e += dir) {
    if (!locked[e]) continue;
    const lo = tracks.map(() => ({ x: Infinity, y: Infinity })), hi = tracks.map(() => ({ x: -Infinity, y: -Infinity }));
    let k = e, last = e;
    while (k >= 0 && k < n && locked[k]) {
      let ok = true;
      tracks.forEach((tr, j) => {
        const p = tr[k];
        if (!p) return;
        lo[j].x = Math.min(lo[j].x, p.x); lo[j].y = Math.min(lo[j].y, p.y);
        hi[j].x = Math.max(hi[j].x, p.x); hi[j].y = Math.max(hi[j].y, p.y);
        if (hi[j].x - lo[j].x > thr || hi[j].y - lo[j].y > thr) ok = false;
      });
      if (!ok) break;
      last = k; k += dir;
    }
    const a = Math.min(e, last), b = Math.max(e, last);
    const dur = t[b] - t[a] + dt;
    if (dur > best.dur) best = { found: true, a, b, start: t[a], end: t[b] + dt, dur, touchesStart: edge(a - 1), touchesEnd: edge(b + 1) };
  }
  return best;
}

const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');

export function analyzeSquat(frames, width, height, cfg = SQUAT) {
  const valid = frames.filter(f => f.lm);
  if (valid.length < 8) {
    return unclear('Non ti vedo nel video. Riprendi tutto il corpo, di lato, con il telefono fermo.');
  }
  const { t, dt, side, series, visibility, hipSpread } = buildSeries(frames, width, height, cfg.minVisibility);
  const { S, H, K, A } = series;

  // Punti impossibili: di profilo tibia e femore non si accorciano. Se il modello "schiaccia"
  // il ginocchio sulla caviglia o sull'anca (succede quando i dischi coprono le gambe),
  // quei fotogrammi si buttano e la buca si ricostruisce dal movimento prima e dopo.
  const lenRef = (P, Q) => { const v = t.map((_, i) => P[i] && Q[i] ? dist(P[i], Q[i]) : NaN).filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length * 0.75)] : NaN; };
  const shinRef = lenRef(K, A), thighRef = lenRef(H, K);
  for (let i = 0; i < t.length; i++) {
    if (!K[i]) continue;
    const badShin = A[i] && dist(K[i], A[i]) < 0.6 * shinRef;
    const badThigh = H[i] && dist(H[i], K[i]) < 0.45 * thighRef;
    if (badShin || badThigh) { K[i] = null; if (badThigh) H[i] = null; }
  }

  const lowerBodyVis = Math.min(visibility.H, visibility.K, visibility.A);
  if (!(lowerBodyVis >= cfg.minVisibility * 0.7)) {
    return unclear('Non vedo bene anca, ginocchio e caviglia. Riprendi di lato, con tutto il corpo nell\'inquadratura.');
  }

  // Lunghezza del corpo (riferimento per tutte le distanze): anca-caviglia è la misura più stabile,
  // perché nello squat busto e spalle sono spesso coperti dai dischi.
  const bodyLen = median(t.map((_, i) => H[i] && A[i] ? dist(H[i], A[i]) * 1.9 : NaN));
  const kneeAng = t.map((_, i) => H[i] && K[i] && A[i] ? angleAt(H[i], K[i], A[i]) : NaN);
  // Femore rispetto all'orizzontale: positivo = anca sotto il ginocchio.
  const femur = t.map((_, i) => H[i] && K[i] ? deg(Math.atan2(H[i].y - K[i].y, Math.abs(H[i].x - K[i].x))) : NaN);
  // "Bilanciere": sta sulla schiena e sale e scende con l'anca, che a differenza delle spalle
  // non viene coperta dai dischi. Se l'anca scende durante la salita, è sceso anche il bilanciere.
  const bar = t.map((_, i) => H[i]?.y);

  // "In piedi" è relativo alla persona del video: il modello può sbagliare l'angolo del ginocchio
  // di qualche grado in modo costante, quindi si confronta con la sua posizione più dritta.
  const pct = (arr, p) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const standKnee = pct(kneeAng, 0.9);
  const standHipY = pct(bar, 0.08);
  const kneeLock = Math.min(cfg.lockoutKneeDeg, standKnee - cfg.lockoutRelDeg);
  const locked = t.map((_, i) => kneeAng[i] >= kneeLock && bar[i] <= standHipY + cfg.lockoutHipDropRatio * bodyLen);
  const hasData = kneeAng.map(Number.isFinite);
  const firstData = hasData.indexOf(true), lastData = hasData.lastIndexOf(true);
  const hold = (anchor, dir) => measureHold({
    t, dt, anchor, dir, locked, tracks: [H, A], thr: cfg.stillRatio * bodyLen, slackSec: cfg.holdSlackSec, hasData,
  });

  // Prima ripetizione: primo frame in cui l'anca è scesa abbastanza.
  const firstDown = bar.findIndex(y => y > standHipY + cfg.squatDropRatio * bodyLen);
  if (firstDown < 0) {
    return unclear('Non ho visto uno squat: le ginocchia non si piegano abbastanza. Controlla di aver caricato il video giusto.');
  }
  let upIdx = -1;
  for (let i = firstDown; i < t.length; i++) if (locked[i]) { upIdx = i; break; }
  const repEnd = upIdx >= 0 ? upIdx : t.length - 1;
  let bottom = firstDown;
  for (let i = firstDown; i <= repEnd; i++) if (H[i] && H[bottom] && H[i].y > H[bottom].y) bottom = i;
  let descStart = -1;
  for (let i = firstDown; i >= 0; i--) if (locked[i]) { descStart = i; break; }

  const checks = [];
  const warnings = [];

  // 1) Fermo iniziale a gambe tese.
  if (descStart < 0) {
    checks.push(t[firstDown] - t[Math.max(0, firstData)] < 0.6
      ? { id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'unknown', detail: 'Il video inizia già durante la discesa.' }
      : { id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'fail', detail: 'Non sei partito a gambe tese.' });
  } else {
    const h = hold(descStart, -1);
    const need = cfg.holdSec - cfg.holdToleranceSec;
    if (h.found && h.dur >= need) {
      checks.push({ id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'pass', detail: `Fermo di ${fmt(h.dur)} s prima di scendere.`, t: [h.start, h.end] });
    } else if (!h.found || h.touchesStart || t[descStart] - t[firstData] < need) {
      checks.push({ id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'unknown', detail: 'Il video inizia troppo tardi per vedere il secondo di fermo.' });
    } else {
      checks.push({ id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'fail', detail: `Fermo di solo ${fmt(h.dur)} s: serve 1 secondo prima di scendere.`, t: [h.start, h.end] });
    }
  }

  // 2) Profondità: anca sotto il ginocchio.
  let depth = -Infinity, depthIdx = bottom;
  for (const win of [0.25, 0.6]) {
    for (let i = 0; i < t.length; i++) {
      if (Math.abs(t[i] - t[bottom]) <= win && Number.isFinite(femur[i]) && femur[i] > depth) { depth = femur[i]; depthIdx = i; }
    }
    if (Number.isFinite(depth)) break;
  }
  // Buca coperta (dischi, rack, altre persone): se manca un pezzo di traiettoria vicino al punto
  // più basso, si ricostruisce dalla dinamica: discesa e salita dell'anca sono una curva liscia,
  // e il ginocchio in buca quasi non si muove.
  let estimated = false;
  const hidden = hiddenBottom({ t, femur, from: firstDown, to: repEnd });
  if (hidden && (!Number.isFinite(depth) || hidden.femur > depth)) {
    depth = hidden.femur; depthIdx = hidden.idx; estimated = true;
    warnings.push('In buca anca e ginocchio erano coperti: la profondità è ricostruita dal movimento prima e dopo.');
  }
  // Senza la profondità non c'è giudizio possibile: è l'unico controllo che non si può "dare per buono".
  if (!Number.isFinite(depth)) {
    return unclear('Nel punto più basso anca e ginocchio sono coperti (dischi, rack o altre persone). Riprendi esattamente di lato, con il telefono all\'altezza dell\'anca.');
  }
  const over = depth - cfg.depthMinDeg; // gradi oltre la soglia (positivo = abbastanza profondo)
  // Se in buca manca un pezzo lungo che non si è potuto ricostruire, una profondità "insufficiente"
  // misurata più in alto non vuol dire niente: il punto più basso non l'abbiamo visto.
  if (over < 0 && !estimated) {
    let run = 0;
    for (let i = firstDown; i <= repEnd; i++) {
      run = Number.isFinite(femur[i]) ? 0 : run + 1;
      if (run * dt > 0.3) return unclear('Nel punto più basso anca e ginocchio sono coperti (dischi, rack o altre persone). Riprendi esattamente di lato, con il telefono all\'altezza dell\'anca.');
    }
  }
  if (over >= 0) {
    checks.push({
      id: 'depth', label: 'Profondità: anca sotto il ginocchio', status: 'pass',
      detail: over < cfg.depthBorderlineDeg ? 'Al limite: l\'anca arriva appena all\'altezza del ginocchio.' : 'L\'anca scende sotto il ginocchio.',
      t: [t[depthIdx], t[depthIdx]], value: depth,
    });
    if (over < cfg.depthBorderlineDeg) warnings.push('Profondità al limite: un giudice severo potrebbe darla no rep.');
  } else {
    checks.push({ id: 'depth', label: 'Profondità: anca sotto il ginocchio', status: 'fail', detail: `Squat alto: mancano circa ${fmt(-over, 0)}° per portare l'anca sotto il ginocchio.`, t: [t[depthIdx], t[depthIdx]], value: depth });
  }

  // 3) Nessuna discesa del bilanciere durante la salita (deve durare almeno barDropMinSec).
  let runMin = Infinity, dropIdx = -1, runStart = -1;
  for (let i = bottom; i <= repEnd && dropIdx < 0; i++) {
    if (!Number.isFinite(bar[i])) continue;
    runMin = Math.min(runMin, bar[i]);
    if (bar[i] - runMin > cfg.barDropRatio * bodyLen) {
      if (runStart < 0) runStart = i;
      if (t[i] - t[runStart] >= cfg.barDropMinSec - 1e-6) dropIdx = runStart;
    } else runStart = -1;
  }
  if (dropIdx >= 0) {
    checks.push({ id: 'noDrop', label: 'Salita senza discese del bilanciere', status: 'fail', detail: 'Il bilanciere è sceso durante la salita.', t: [t[dropIdx], t[dropIdx]] });
  } else {
    checks.push({ id: 'noDrop', label: 'Salita senza discese del bilanciere', status: 'pass', detail: 'Salita continua.' });
  }

  // 4) Chiusura a gambe tese + fermo di 1 s (= comando "rack").
  if (upIdx < 0) {
    checks.push(t[t.length - 1] - t[bottom] < 1.2 && H[t.length - 1] && H[t.length - 1].y < H[bottom].y
      ? { id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'unknown', detail: 'Il video finisce prima della chiusura.' }
      : { id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'fail', detail: 'Non hai chiuso l\'alzata: ginocchia non distese.' });
  } else {
    const h = hold(upIdx, +1);
    const need = cfg.holdSec - cfg.holdToleranceSec;
    if (h.found && h.dur >= need) {
      checks.push({ id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'pass', detail: `Fermo di ${fmt(h.dur)} s in chiusura.`, t: [h.start, h.end] });
    } else if (!h.found || h.touchesEnd || t[lastData] - t[upIdx] < need) {
      checks.push({ id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'unknown', detail: 'Il video finisce prima del secondo di fermo.' });
    } else {
      checks.push({ id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'fail', detail: `Fermo di solo ${fmt(h.dur)} s: serve 1 secondo prima del rack.`, t: [h.start, h.end] });
    }
  }

  if (hipSpread > 0.14 * bodyLen) {
    warnings.push('La ripresa sembra frontale o di tre quarti: per misurare bene la profondità riprendi esattamente di lato.');
  }
  if (upIdx >= 0 && bar.slice(upIdx).some(y => y > standHipY + cfg.squatDropRatio * bodyLen)) {
    warnings.push('Nel video ci sono più ripetizioni: ho giudicato la prima.');
  }

  // Regola di Manuel: se mancano dettagli ma niente è sbagliato, è GOOD LIFT,
  // e nell'analisi si spiega cosa non si è potuto controllare.
  const failed = checks.some(c => c.status === 'fail');
  const missing = checks.filter(c => c.status === 'unknown');
  const verdict = failed ? 'norep' : 'good';
  if (verdict === 'good' && missing.length) {
    warnings.push('Mancano alcuni dettagli nel video: per un giudizio completo riprendi anche 1–2 secondi prima e dopo l\'alzata.');
  }

  return {
    lift: 'squat', verdict, missing: missing.length, checks, warnings, side,
    key: { descStart: descStart >= 0 ? t[descStart] : t[0], bottom: t[depthIdx], lockout: upIdx >= 0 ? t[upIdx] : null },
    replay: { t, series, femur, bar, barSource: 'anca', bodyLen },
  };
}

// Cerca un buco nei dati di anca/ginocchio tra discesa e salita e stima l'angolo del femore
// nel punto più basso con una parabola sui fotogrammi visibili subito prima e subito dopo
// (l'angolo del femore cambia in modo regolare e in buca si ferma: forma a "cupola").
function hiddenBottom({ t, femur, from, to }) {
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

function unclear(message) {
  return { lift: 'squat', verdict: 'unclear', checks: [], warnings: [message], key: null, replay: null };
}

export const LIFTS = {
  squat: { name: 'Squat', analyze: analyzeSquat, ready: true, commands: ['Start', 'Rack'] },
  panca: { name: 'Panca', ready: false, commands: ['Start', 'Press', 'Rack'] },
  stacco: { name: 'Stacco', ready: false, commands: ['Down'] },
  trazioni: { name: 'Trazioni', ready: false, commands: ['Start', 'Down'] },
  dip: { name: 'Dip', ready: false, commands: ['Start', 'Down'] },
  muscleup: { name: 'Muscle up', ready: false, commands: ['Start', 'Down'] },
};
