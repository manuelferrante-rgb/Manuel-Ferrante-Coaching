// ¿oodLift — motore di giudizio delle alzate.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Lavora su una sequenza di pose (landmark MediaPipe, coordinate normalizzate 0–1)
// e restituisce il verdetto con i controlli effettuati. Non dipende dal DOM:
// si può testare anche in Node.

import { LM, deg, angleAt, dist, median, buildSeries, measureHold, fmt, hiddenBottom, unclear, findReps, assemble } from './core.js';
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
  holdSec: 1.0,            // fermo richiesto in partenza e in chiusura
  holdToleranceSec: 0.12,  // margine per il campionamento dei fotogrammi
  holdSlackSec: 0.45,      // tempo max tra fine del fermo e inizio del movimento (e viceversa)
  stillRatio: 0.022,       // movimento max da fermo, in frazione della lunghezza del corpo
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
  const { H, K, A } = series;

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
  // Il bilanciere sta sulla schiena e sale e scende con l'anca, che a differenza delle spalle
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
  const need = cfg.holdSec - cfg.holdToleranceSec;
  const hold = (anchor, dir) => measureHold({
    t, dt, anchor, dir, locked, tracks: [H, A], thr: cfg.stillRatio * bodyLen, slackSec: cfg.holdSlackSec, hasData,
  });

  const reps = findReps(t.length, i => bar[i] > standHipY + cfg.squatDropRatio * bodyLen, locked,
    (i, j) => H[i] && (!H[j] || H[i].y > H[j].y));
  if (!reps.length) {
    return unclear('Non ho visto uno squat: le ginocchia non si piegano abbastanza. Controlla di aver caricato il video giusto.');
  }
  const COVERED = 'Nel punto più basso anca e ginocchio sono coperti (dischi, rack o altre persone). Riprendi esattamente di lato, con il telefono all\'altezza dell\'anca.';

  const judged = reps.map(({ desc: descStart, fd: firstDown, bottom, up: upIdx, end: repEnd }, k) => {
    const isFirst = k === 0, isLast = k === reps.length - 1;
    const checks = [], warnings = [];

    // 1) Fermo iniziale a gambe tese (solo prima ripetizione).
    if (isFirst) {
      if (descStart < 0) {
        checks.push(t[firstDown] - t[Math.max(0, firstData)] < 0.6
          ? { id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'unknown', detail: 'Il video inizia già durante la discesa.' }
          : { id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'fail', detail: 'Non sei partito a gambe tese.' });
      } else {
        const h = hold(descStart, -1);
        if (h.found && h.dur >= need) checks.push({ id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'pass', detail: `Fermo di ${fmt(h.dur)} s prima di scendere.`, t: [h.start, h.end] });
        else if (!h.found || h.touchesStart || t[descStart] - t[firstData] < need) checks.push({ id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'unknown', detail: 'Il video inizia troppo tardi per vedere il secondo di fermo.' });
        else checks.push({ id: 'startHold', label: 'Fermo iniziale a gambe tese (1 s)', status: 'fail', close: h.dur >= need - 0.25, detail: `Fermo di solo ${fmt(h.dur)} s: serve 1 secondo prima di scendere.`, t: [h.start, h.end] });
      }
    }

    // 2) Profondità: anca sotto il ginocchio.
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
    checks.push(dropIdx >= 0
      ? { id: 'noDrop', label: 'Salita senza discese del bilanciere', status: 'fail', detail: 'Il bilanciere è sceso durante la salita.', t: [t[dropIdx], t[dropIdx]] }
      : { id: 'noDrop', label: 'Salita senza discese del bilanciere', status: 'pass', detail: 'Salita continua.' });

    // 4) Chiusura a gambe tese (+ fermo di 1 s = "rack", solo ultima ripetizione).
    if (upIdx < 0) {
      checks.push(t[t.length - 1] - t[bottom] < 1.2 && H[t.length - 1] && H[t.length - 1].y < H[bottom].y
        ? { id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'unknown', detail: 'Il video finisce prima della chiusura.' }
        : { id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'fail', detail: 'Non hai chiuso l\'alzata: ginocchia non distese.' });
    } else if (isLast) {
      const h = hold(upIdx, +1);
      if (h.found && h.dur >= need) checks.push({ id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'pass', detail: `Fermo di ${fmt(h.dur)} s in chiusura.`, t: [h.start, h.end] });
      else if (!h.found || h.touchesEnd || t[lastData] - t[upIdx] < need) checks.push({ id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'unknown', detail: 'Il video finisce prima del secondo di fermo.' });
      else checks.push({ id: 'endHold', label: 'Chiusura a gambe tese e fermo (1 s)', status: 'fail', close: h.dur >= need - 0.25, detail: `Fermo di solo ${fmt(h.dur)} s: serve 1 secondo prima del rack.`, t: [h.start, h.end] });
    } else {
      checks.push({ id: 'lockout', label: 'Chiusura a gambe tese', status: 'pass', detail: 'Ginocchia distese prima della ripetizione successiva.', t: [t[upIdx], t[upIdx]] });
    }
    return { checks, warnings, key };
  });

  // Ripresa da dietro o davanti: le due anche sono ben separate e l'angolo del femore non dice
  // niente sulla profondità. Meglio dirlo che sbagliare.
  if (hipSpread > 0.15 * bodyLen) {
    return unclear('Il video è ripreso da dietro o da davanti: per giudicare la profondità serve la ripresa di lato.');
  }
  const warnings = [];
  if (hipSpread > 0.09 * bodyLen) {
    warnings.push('La ripresa sembra frontale o di tre quarti: per misurare bene la profondità riprendi esattamente di lato.');
  }
  return assemble('squat', b, judged, warnings, {
    femur, bar, bodyLen,
    path: { a: 'S', label: 'Traiettoria bilanciere' },
    trail: 'H',
    focus: {
      a: 'H', b: 'K',
      // linea del parallelo (all'altezza del ginocchio): il femore deve finire sotto
      ref: i => H[i] && K[i] ? K[i].y + Math.tan(cfg.depthMinDeg * Math.PI / 180) * Math.abs(H[i].x - K[i].x) : null,
      label: i => {
        const o = femur[i] - cfg.depthMinDeg;
        return !Number.isFinite(o) ? null : o >= cfg.depthBorderlineDeg ? ['PROFONDITÀ OK', false] : o >= 0 ? ['PROFONDITÀ AL LIMITE', false] : ['NON ROMPE IL PARALLELO', true];
      },
    },
    dropText: 'IL BILANCIERE SCENDE',
  });
}

export const LIFTS = {
  squat: { name: 'Squat', analyze: analyzeSquat, ready: true, commands: ['Start', 'Rack'] },
  panca: { name: 'Panca', analyze: analyzeBench, ready: true, commands: ['Start', 'Press', 'Rack'] },
  stacco: { name: 'Stacco', analyze: analyzeDeadlift, ready: true, commands: ['Down'] },
  trazioni: { name: 'Trazioni', analyze: analyzePullup, ready: true, commands: ['Start', 'Down'] },
  dip: { name: 'Dip', analyze: analyzeDip, ready: true, commands: ['Start', 'Down'] },
  muscleup: { name: 'Muscle up', analyze: analyzeMuscleUp, ready: true, commands: ['Start', 'Down'] },
};
