// ¿oodLift — motore di giudizio delle alzate.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Lavora su una sequenza di pose (landmark MediaPipe, coordinate normalizzate 0–1)
// e restituisce il verdetto con i controlli effettuati. Non dipende dal DOM:
// si può testare anche in Node.

import { LM, deg, angleAt, dist, median, buildSeries, hiddenBottom, unclear, findReps, assemble, detectLift, pickPerson } from './core.js';
import { analyzeBench, analyzeDeadlift, analyzePullup, analyzeDip, analyzeMuscleUp } from './lifts.js';
export { LM };

// Soglie dello squat. Sono il punto da tarare con i video reali.
export const SQUAT = {
  lockoutKneeDeg: 158,     // ginocchio "teso" (se il video mostra la persona più dritta di così)
  lockoutRelDeg: 10,       // …oppure entro 10° dalla posizione più dritta vista nel video
  lockoutHipDropRatio: 0.045, // in piedi: anca entro il 4,5% del corpo dalla sua posizione più alta
  squattingKneeDeg: 125,   // sotto quest'angolo sei "in squat" (usato dai comandi vocali live)
  squatDropRatio: 0.12,    // sei "in squat" quando l'anca è scesa del 12% della lunghezza del corpo
  barDropMinSec: 0.08,     // la discesa in salita conta solo se dura almeno così (filtra il rumore)
  // Profondità, misurata sulla linea anca–ginocchio di MediaPipe: giudizio severo, come in gara.
  depthMinDeg: 1,          // severo: il femore deve rompere il parallelo (anca sotto il ginocchio)
  depthBorderlineDeg: 4,   // nei primi 4° oltre la soglia è "al limite"
  barDropRatio: 0.018,     // discesa tollerata in salita (~3 cm su un corpo di 1,7 m)
  minVisibility: 0.3,
};

export function analyzeSquat(frames, width, height, cfg = SQUAT) {
  const valid = frames.filter(f => f.lm);
  if (valid.length < 8) {
    return unclear('Non ti vedo nel video. Riprendi tutto il corpo, di lato, con il telefono fermo.');
  }
  const b = buildSeries(frames, width, height, cfg.minVisibility);
  const { t, dt, series, visibility, hipSpread } = b;
  const { H, K, A, W } = series;

  // Punti impossibili: di profilo tibia e femore non si accorciano. Se il modello "schiaccia"
  // il ginocchio sulla caviglia o sull'anca (succede quando i dischi coprono le gambe),
  // quei fotogrammi si buttano e la buca si ricostruisce dal movimento prima e dopo.
  const lenRef = (P, Q) => { const v = t.map((_, i) => P[i] && Q[i] ? dist(P[i], Q[i]) : NaN).filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length * 0.75)] : NaN; };
  const shinRef = lenRef(K, A), thighRef = lenRef(H, K);
  // Ripresa da davanti o da dietro: le due anche sono ben separate. Si giudica lo stesso.
  const bodyLen0 = median(t.map((_, i) => H[i] && A[i] ? dist(H[i], A[i]) * 1.9 : NaN)) || thighRef * 3.8;
  const frontal = hipSpread > 0.15 * bodyLen0;
  // da davanti il femore in buca punta verso il telefono e sembra corto: è normale, non un errore
  for (let i = 0; i < t.length && !frontal; i++) {
    if (!K[i]) continue;
    const badShin = A[i] && dist(K[i], A[i]) < 0.6 * shinRef;
    const badThigh = H[i] && dist(H[i], K[i]) < 0.45 * thighRef;
    if (badShin || badThigh) { K[i] = null; if (badThigh) H[i] = null; }
  }

  // per la profondità servono anca e ginocchio; la caviglia no (se manca, si fa senza)
  const lowerBodyVis = Math.min(visibility.H, visibility.K);
  if (!(lowerBodyVis >= cfg.minVisibility * 0.7)) {
    return unclear('Non vedo bene anca, ginocchio e caviglia. Riprendi di lato, con tutto il corpo nell\'inquadratura.');
  }

  // Lunghezza del corpo (riferimento per tutte le distanze): anca-caviglia è la misura più stabile,
  // perché nello squat busto e spalle sono spesso coperti dai dischi.
  const bodyLen = median(t.map((_, i) => H[i] && A[i] ? dist(H[i], A[i]) * 1.9 : NaN)) || thighRef * 3.8;
  const kneeAng = t.map((_, i) => H[i] && K[i] && A[i] ? angleAt(H[i], K[i], A[i]) : NaN);
  // Femore rispetto all'orizzontale: positivo = anca sotto il ginocchio.
  // Di lato si misura l'angolo direttamente. Da davanti il femore in buca punta verso il telefono:
  // conta solo quanto l'anca sta sopra o sotto il ginocchio (in verticale si vede da ogni lato),
  // rapportato alla lunghezza del femore (misurata da in piedi).
  const femur = t.map((_, i) => !H[i] || !K[i] ? NaN : frontal
    ? deg(Math.asin(Math.max(-1, Math.min(1, (H[i].y - K[i].y) / thighRef))))
    : deg(Math.atan2(H[i].y - K[i].y, Math.abs(H[i].x - K[i].x))));
  // Il bilanciere sta sulla schiena e sale e scende con l'anca, che a differenza delle spalle
  // non viene coperta dai dischi. Se l'anca scende durante la salita, è sceso anche il bilanciere.
  const bar = t.map((_, i) => H[i]?.y);

  // "In piedi" è relativo alla persona del video: il modello può sbagliare l'angolo del ginocchio
  // di qualche grado in modo costante, quindi si confronta con la sua posizione più dritta.
  const pct = (arr, p) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const standKnee = pct(kneeAng, 0.9);
  const standHipY = pct(bar, 0.08);
  const kneeLock = Math.min(cfg.lockoutKneeDeg, standKnee - cfg.lockoutRelDeg);
  // caviglia non vista: in piedi = anca tornata alla sua altezza più alta
  const locked = t.map((_, i) => (Number.isFinite(kneeAng[i]) ? kneeAng[i] >= kneeLock : Number.isFinite(standKnee) ? false : true) && bar[i] <= standHipY + cfg.lockoutHipDropRatio * bodyLen);
  const hasData = kneeAng.map(Number.isFinite);

  const reps = findReps(t.length, i => bar[i] > standHipY + cfg.squatDropRatio * bodyLen, locked,
    (i, j) => H[i] && (!H[j] || H[i].y > H[j].y),
    // Ripetizione vera = l'atleta la fa davvero: si vede mentre scende, si piega davvero
    // (ginocchio chiuso o femore quasi orizzontale) e, se il video non finisce prima, risale.
    ({ fd, bottom, up, end }) => {
      while (end > fd && !frames[end].lm) end--; // persona sparita dopo la ripetizione: si conta fin lì
      let seen = 0, bent = false, after = 0;
      for (let i = fd; i <= end; i++) {
        if (frames[i].lm) { seen++; if (i > bottom) after++; } // persona presente (anche se in parte coperta)
        if (kneeAng[i] < 135 || femur[i] > -30) bent = true;
      }
      if (!(seen >= Math.max(3, 0.7 * (end - fd + 1)) && (bent || !!hiddenBottom({ t, femur, from: fd, to: end })))) return false;
      // fine serie: senza bilanciere sulla schiena le mani scendono sotto l'anca (riposo, piegato
      // sulle ginocchia). In buca, con il bilanciere, le mani stanno sopra l'anca.
      let hi = 0, lo = 0;
      // solo polsi visti bene: in buca i dischi coprono le mani e il modello le "inventa" all'anca
      const wristSeen = i => { const l = frames[i].lm; return !!l && Math.max(l[15]?.visibility ?? 0, l[16]?.visibility ?? 0) >= 0.5; };
      for (let i = 0; i < t.length; i++) if (Math.abs(t[i] - t[bottom]) <= 0.15 && W[i] && H[i] && wristSeen(i)) { if (W[i].y < H[i].y) hi++; else lo++; }
      return !(hi + lo) || hi >= lo;
    }, i => bar[i], t);
  if (!reps.length) {
    // l'anca scende e sale ma le ginocchia "non si piegano": il modello non vede bene le gambe
    const hy = bar.filter(Number.isFinite).sort((a, b) => a - b);
    if (hy.length && hy[Math.floor(0.95 * (hy.length - 1))] - hy[Math.floor(0.05 * (hy.length - 1))] > 0.08 * bodyLen) {
      return unclear('Vedo che scendi e risali, ma dischi, rack o barre di sicurezza coprono anca e ginocchio e non riesco a vedere la profondità. Riprendi un po\' più da lontano, con tutto il corpo (anche la testa) nell\'inquadratura.');
    }
    return unclear('Non ho visto uno squat: le ginocchia non si piegano abbastanza. Controlla di aver caricato il video giusto.');
  }
  const COVERED = 'Nel punto più basso anca e ginocchio sono coperti (dischi, rack o altre persone). Riprendi esattamente di lato, con il telefono all\'altezza dell\'anca.';

  const judged = reps.map(({ desc: descStart, fd: firstDown, bottom, up: upIdx, end: repEnd }) => {
    const checks = [], warnings = [];

    // 1) Profondità: anca sotto il ginocchio.
    let depth = -Infinity, depthIdx = bottom;
    for (const win of [0.25, 0.6]) {
      for (let i = Math.max(0, firstDown - 2); i <= Math.min(t.length - 1, repEnd + 2); i++) {
        if (Math.abs(t[i] - t[bottom]) <= win && Number.isFinite(femur[i]) && femur[i] > depth) { depth = femur[i]; depthIdx = i; }
      }
      if (Number.isFinite(depth)) break;
    }
    // Buca coperta (dischi, rack, altre persone): se manca un pezzo di traiettoria vicino al punto
    // più basso, si ricostruisce dalla dinamica (l'angolo del femore cambia in modo regolare).
    let estimated = false;
    const hidden = hiddenBottom({ t, femur, from: firstDown, to: repEnd });
    if (hidden && (!Number.isFinite(depth) || hidden.femur > depth)) {
      depth = hidden.femur; depthIdx = hidden.idx; estimated = true;
      warnings.push('In buca anca e ginocchio erano coperti: la profondità è ricostruita dal movimento prima e dopo.');
    }
    const key = { start: descStart >= 0 ? t[descStart] : t[firstDown], focus: t[depthIdx], end: upIdx >= 0 ? t[upIdx] : null };
    // Senza la profondità non c'è giudizio possibile: è l'unico controllo che non si può "dare per buono".
    if (!Number.isFinite(depth)) return { unclear: COVERED, checks, warnings, key };
    const over = depth - cfg.depthMinDeg; // gradi oltre la soglia (positivo = abbastanza profondo)
    // Se in buca manca un pezzo lungo che non si è potuto ricostruire, una profondità "insufficiente"
    // misurata più in alto non vuol dire niente: il punto più basso non l'abbiamo visto.
    if (over < 0 && !estimated) {
      let run = 0;
      for (let i = firstDown; i <= repEnd; i++) {
        run = Number.isFinite(femur[i]) ? 0 : run + 1;
        if (run * dt > 0.3) return { unclear: COVERED, checks, warnings, key };
      }
    }
    if (over >= 0) {
      checks.push({
        id: 'depth', label: 'Profondità: anca sotto il ginocchio', status: 'pass',
        detail: over < cfg.depthBorderlineDeg ? 'Al limite: il femore rompe appena il parallelo.' : 'Il femore rompe il parallelo: anca sotto il ginocchio.',
        t: [t[depthIdx], t[depthIdx]], value: depth,
      });
      if (over < cfg.depthBorderlineDeg) warnings.push('Profondità al limite: un giudice severo potrebbe darla no rep.');
    } else {
      checks.push({ id: 'depth', label: 'Profondità: anca sotto il ginocchio', status: 'fail', close: -over < cfg.depthBorderlineDeg, detail: 'Squat alto: il femore non rompe il parallelo, l\'anca non scende sotto il ginocchio.', t: [t[depthIdx], t[depthIdx]], value: depth });
    }

    // 2) Nessuna discesa del bilanciere durante la salita (deve durare almeno barDropMinSec).
    let runMin = Infinity, dropIdx = -1, runStart = -1;
    for (let i = bottom; i <= repEnd && dropIdx < 0; i++) {
      if (!Number.isFinite(bar[i])) continue;
      runMin = Math.min(runMin, bar[i]);
      if (bar[i] - runMin > cfg.barDropRatio * bodyLen) {
        if (runStart < 0) runStart = i;
        if (t[i] - t[runStart] >= cfg.barDropMinSec - 1e-6) dropIdx = runStart;
      } else runStart = -1;
    }
    checks.push(dropIdx >= 0
      ? { id: 'noDrop', label: 'Salita senza discese del bilanciere', status: 'fail', detail: 'Il bilanciere è sceso durante la salita.', t: [t[dropIdx], t[dropIdx]] }
      : { id: 'noDrop', label: 'Salita senza discese del bilanciere', status: 'pass', detail: 'Salita continua.' });

    // 3) Chiusura a gambe tese (il comando "rack" non si giudica: niente fermo richiesto).
    if (upIdx < 0) {
      checks.push(t[t.length - 1] - t[bottom] < 1.2 && H[t.length - 1] && H[t.length - 1].y < H[bottom].y
        ? { id: 'lockout', label: 'Chiusura a gambe tese', status: 'unknown', detail: 'Il video finisce prima della chiusura.' }
        : { id: 'lockout', label: 'Chiusura a gambe tese', status: 'fail', detail: 'Non hai chiuso l\'alzata: ginocchia non distese.' });
    } else {
      checks.push({ id: 'lockout', label: 'Chiusura a gambe tese', status: 'pass', detail: 'Ginocchia distese in chiusura.', t: [t[upIdx], t[upIdx]] });
    }
    return { checks, warnings, key };
  });

  const warnings = [];
  if (frontal) warnings.push('Ripresa da davanti o da dietro: la profondità si misura lo stesso, ma per la massima precisione riprendi di lato, con il telefono all\'altezza dell\'anca.');
  else if (hipSpread > 0.09 * bodyLen) warnings.push('La ripresa sembra di tre quarti: per misurare bene la profondità riprendi esattamente di lato.');
  return assemble('squat', b, judged, warnings, {
    femur, bar, bodyLen,
    path: { a: 'S', label: 'Traiettoria bilanciere' },
    trail: 'H',
    focus: {
      a: 'H', b: 'K',
      // niente linee di riferimento: conta il femore (anca–ginocchio) e il suo angolo col parallelo
      label: i => {
        const f = femur[i], o = f - cfg.depthMinDeg;
        if (!Number.isFinite(f)) return null;
        if (o >= cfg.depthBorderlineDeg) return [`FEMORE ${Math.round(f)}° SOTTO IL PARALLELO`, false];
        if (o >= 0) return [`AL LIMITE: ${Math.max(1, Math.round(f))}° SOTTO IL PARALLELO`, false];
        return f >= 0 ? ['FEMORE SUL PARALLELO', true] : [`FEMORE ${Math.max(1, Math.round(-f))}° SOPRA IL PARALLELO`, true];
      },
    },
    dropText: 'IL BILANCIERE SCENDE',
  });
}

export const LIFTS = {
  squat: { name: 'Squat', analyze: analyzeSquat, ready: true },
  panca: { name: 'Panca', analyze: analyzeBench, ready: true },
  stacco: { name: 'Stacco', analyze: analyzeDeadlift, ready: true },
  trazioni: { name: 'Trazioni', analyze: analyzePullup, ready: true },
  dip: { name: 'Dip', analyze: analyzeDip, ready: true },
  muscleup: { name: 'Muscle up', analyze: analyzeMuscleUp, ready: true },
};

// Riconosce l'alzata: la più probabile dalla postura (detectLift). Se il giudice di quell'alzata non
// trova niente ("non riesco") si prova la seconda candidata, se è comunque plausibile.
export function recognize(frames, width, height) {
  const d = detectLift(frames, width, height);
  const plausible = d.rank.filter(([, s], k) => k === 0 || s >= 0.3);
  for (const [lift] of plausible.slice(0, 4)) {
    const r = LIFTS[lift].analyze(pickPerson(frames, lift, width, height), width, height);
    if (r.verdict !== 'unclear') return { ...d, lift, ask: lift === d.lift ? d.ask : null, sure: lift === d.lift && d.sure };
  }
  return d;
}
