// ¿oodLift — panca, stacco, trazioni, dip, muscle up.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// Stessa struttura dello squat (engine.js): ogni alzata ha le sue soglie in cima,
// una lista di controlli (fermi, posizione chiave, nessuna discesa…) e il verdetto:
// un controllo sbagliato = NO REP; un dettaglio non visibile = GOOD LIFT con nota.
// Le soglie segnate "provvisoria" vanno tarate su video reali di alzate valide e no rep.

import { deg, angleAt, dist, median, buildSeries, fmt, unclear, findReps, assemble } from './core.js';

// ── soglie ─────────────────────────────────────────────────────────────
// Le distanze sono in frazioni di un segmento del corpo (braccio = spalla-gomito-polso,
// corpo = anca-caviglia × 1,9), così valgono a qualsiasi distanza dal telefono.
const HOLD = { holdSec: 1.0, holdToleranceSec: 0.12, holdSlackSec: 0.45 };

export const BENCH = {
  ...HOLD,
  holdSec: 0.8, holdToleranceSec: 0.08, // fermo al petto: 0,8 s (deciso con Manuel), un fotogramma di tolleranza
  lockElbowDeg: 155, lockRelDeg: 14,  // braccia tese: gomito oltre 155° o entro 14° dal più teso visto
  topRatio: 0.12,                      // in alto: bilanciere entro il 12% del braccio dal punto più alto
  downRatio: 0.3,                      // "è scesa": bilanciere sceso del 30% del braccio
  chestNearRatio: 0.06,                // al petto: entro il 6% del braccio dal punto più basso
  stillRatio: 0.035,                   // fermo: movimento massimo, in frazione del braccio
  // Gomito all'altezza della spalla: regola accessoria. Sdraiati la misura è meno precisa, quindi
  // è no rep solo se il gomito resta chiaramente sopra la spalla; vicino alla soglia è "al limite".
  elbowMinDeg: -3, elbowBorderlineDeg: 4, elbowFailDeg: -12,
  dropRatio: 0.04, dropMinSec: 0.08,   // discesa del bilanciere durante la spinta
  buttRiseRatio: 0.15,                 // il bacino non si alza più del 15% del busto (provvisoria)
  feetRiseRatio: 0.12,                 // i piedi non si alzano più del 12% del busto (provvisoria)
};

export const DEADLIFT = {
  ...HOLD,
  lockKneeDeg: 160, lockHipDeg: 160, lockRelDeg: 12,
  minRangeRatio: 0.15,                 // il bilanciere deve salire almeno così (frazione del corpo)
  liftRatio: 0.06,                     // il bilanciere si è staccato da terra
  topRatio: 0.05,                      // in chiusura: bilanciere vicino al punto più alto
  stillRatio: 0.025,
  dropRatio: 0.03, dropMinSec: 0.1,
  shoulderTolRatio: 0.02,              // spalla al massimo così davanti al bilanciere (provvisoria)
};

export const PULLUP = {
  ...HOLD,
  hangElbowDeg: 150, hangRelDeg: 15,
  pullRatio: 0.15,                     // ha iniziato a tirare: spalle salite del 15% del braccio
  stillRatio: 0.045,
  kipRatio: 0.07, kipWindowSec: 0.7,   // spalle che scendono prima di tirare = kip (provvisoria)
  legSwingDegPerSec: 320,              // gambe: oltre questa velocità è uno scatto (provvisoria)
  kneeKickDegPerSec: 450,
  chinBelowMouth: 1.0,                 // mento ≈ bocca + 1× (bocca − naso) in verticale
  barAboveWristRatio: 0.06,            // la sbarra sta un po' sopra il polso (presa)
  chinMarginRatio: 0,                  // quanto il mento deve superare la sbarra (provvisoria)
  chinGuessOkRatio: 0.4,               // mento non visibile: spalle entro 0,4 braccia sotto le mani = valida (provvisoria)
  chinGuessFailRatio: 0.5,             // oltre 0,5 braccia = no rep a impressione (provvisoria)
};

export const DIP = {
  ...HOLD,
  lockElbowDeg: 155, lockRelDeg: 14,
  topRatio: 0.1, downRatio: 0.2,
  stillRatio: 0.04,
  depthMinDeg: 0, depthBorderlineDeg: 4, // spalla sotto il gomito (provvisoria)
  dropRatio: 0.04, dropMinSec: 0.08,
};

export const MUSCLEUP = {
  ...HOLD,
  hangElbowDeg: 150, hangRelDeg: 15,
  pullRatio: 0.15,
  stillRatio: 0.045,
  kipRatio: 0.07, kipWindowSec: 0.7,
  aboveBarRatio: 0.12,                 // sopra la sbarra: spalle sopra il polso di almeno così
  topElbowDeg: 150, topRelDeg: 15,
  kneeTolDeg: 5, kneeNoiseMinDeg: 4,   // ginocchio: 5° di tolleranza + il rumore della misura
  hipSnapDegPerSec: 520,               // anca: flessione fluida sì, scatto no (provvisoria)
};

// ── strumenti comuni ───────────────────────────────────────────────────
const pct = (arr, p) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const NOT_SEEN = lift => unclear('Non ti vedo nel video. Riprendi tutto il corpo, con il telefono fermo.', lift);

function prepare(frames, width, height, lift, need) {
  if (frames.filter(f => f.lm).length < 8) return { error: NOT_SEEN(lift) };
  const b = buildSeries(frames, width, height, 0.3);
  const vis = Math.min(...need.map(k => b.visibility[k]));
  if (!(vis >= 0.21)) return { error: unclear('Non vedo bene braccia e busto. Riprendi tutto il corpo nell\'inquadratura.', lift) };
  const { S, E, W, H, K, A } = b.series;
  const t = b.t;
  const series = (P, Q) => t.map((_, i) => P[i] && Q[i] ? dist(P[i], Q[i]) : NaN);
  b.arm = median(t.map((_, i) => S[i] && E[i] && W[i] ? dist(S[i], E[i]) + dist(E[i], W[i]) : NaN));
  b.torso = median(series(S, H));
  b.body = median(series(H, A)) * 1.9;
  b.elbow = t.map((_, i) => S[i] && E[i] && W[i] ? angleAt(S[i], E[i], W[i]) : NaN);
  b.knee = t.map((_, i) => H[i] && K[i] && A[i] ? angleAt(H[i], K[i], A[i]) : NaN);
  b.hip = t.map((_, i) => S[i] && H[i] && K[i] ? angleAt(S[i], H[i], K[i]) : NaN);
  b.y = P => t.map((_, i) => P[i]?.y);
  b.present = frames.map(f => !!f.lm); // persona presente nel fotogramma (anche se in parte coperta)
  // Ripresa da davanti o da dietro: le due spalle sono ben separate (di lato quasi coincidono).
  // Si giudica lo stesso; quello che da davanti non si vede diventa una nota.
  const shoulderSpread = median(frames.map(f => {
    const l = f.lm?.[11], r = f.lm?.[12];
    return l && r && l.visibility > 0.6 && r.visibility > 0.6 ? Math.abs(l.x - r.x) * width : NaN;
  }));
  b.frontal = shoulderSpread > 0.45 * b.torso;
  // da dietro la spalla sinistra sta a sinistra nell'immagine (da davanti a destra): la faccia non si vede
  const lr = median(frames.map(f => f.lm && f.lm[11].visibility > 0.6 && f.lm[12].visibility > 0.6 ? (f.lm[11].x - f.lm[12].x) * width : NaN));
  b.fromBehind = lr < -0.2 * b.torso; // anche di tre quarti da dietro
  return b;
}

// Il punto `y` dovrebbe solo salire (y che cala, in pixel) tra from e to: trova una discesa
// di almeno thr che dura almeno minSec. Restituisce l'indice di inizio o -1.
function reversal(t, y, from, to, thr, minSec) {
  let runMin = Infinity, runStart = -1;
  for (let i = from; i <= to; i++) {
    if (!Number.isFinite(y[i])) continue;
    runMin = Math.min(runMin, y[i]);
    if (y[i] - runMin > thr) {
      if (runStart < 0) runStart = i;
      if (t[i] - t[runStart] >= minSec - 1e-6) return runStart;
    } else runStart = -1;
  }
  return -1;
}

// Velocità angolare massima (°/s) di una serie di angoli tra from e to.
function peakRate(t, a, from, to) {
  let peak = 0, at = -1;
  for (let i = Math.max(1, from); i <= to; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(a[i - 1])) continue;
    const r = Math.abs(a[i] - a[i - 1]) / (t[i] - t[i - 1]);
    if (r > peak) { peak = r; at = i; }
  }
  return { peak, at };
}

// Ripetizione vera: la persona c'è per buona parte del tempo e le braccia si piegano davvero.
// Ripetizione vera = l'atleta la fa davvero: si vede per quasi tutto il movimento, le braccia
// si piegano davvero e, se il video non finisce prima, torna indietro.
// Da davanti il gomito piegato può sembrare quasi dritto: vale anche una corsa ampia delle spalle.
const bentArms = (b, hasData, minElbow = 125) => ({ fd, bottom, up, end }) => {
  // se dopo la ripetizione la persona sparisce (esce, qualcuno le passa davanti), si conta fin lì
  while (end > fd && !b.present[end]) end--;
  let seen = 0, bent = false, lo = Infinity, hi = -Infinity;
  for (let i = fd; i <= end; i++) {
    if (b.present[i]) seen++;
    if (b.elbow[i] < minElbow) bent = true;
    const y = b.series.S[i]?.y; if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  // corsa misurata anche un po' prima della ripetizione (da dove parte)
  for (let i = Math.max(0, fd - Math.round(0.6 / b.dt)); i < fd; i++) { const y = b.series.S[i]?.y; if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
  return seen >= Math.max(3, 0.7 * (end - fd + 1)) && (bent || (b.frontal && hi - lo >= 0.5 * b.arm));
};
// Fine serie: quando scendi dalla sbarra o dalle parallele, o lasci il bilanciere, e ti riposi
// mentre il video continua, il corpo si abbassa e le braccia si piegano come in una ripetizione.
// Ma le mani non sono più al loro posto: una ripetizione vera ha le mani in presa nel punto chiave.
// ok(i) → true/false, o null se in quel fotogramma non si vede.
const handsOn = (t, ok, at) => {
  let good = 0, seen = 0;
  for (let i = 0; i < t.length; i++) {
    if (Math.abs(t[i] - t[at]) > 0.15) continue;
    const v = ok(i); if (v == null) continue;
    seen++; if (v) good++;
  }
  return !seen || 2 * good >= seen;
};
const both = (f, g) => r => f(r) && g(r);
const firstFrom = (arr, from, cond) => { for (let i = Math.max(0, from); i < arr.length; i++) if (cond(i)) return i; return -1; };
const lastBefore = (from, cond) => { for (let i = from; i >= 0; i--) if (cond(i)) return i; return -1; };

// ── PANCA ──────────────────────────────────────────────────────────────
// Discesa · fermo di 0,8 s al petto · gomito almeno all'altezza della spalla · spinta senza
// discese · chiusura a braccia tese · sedere e piedi sempre giù. (Start e rack non si giudicano.)
export function analyzeBench(frames, width, height, cfg = BENCH) {
  const b = prepare(frames, width, height, 'panca', ['S', 'E', 'W']);
  if (b.error) return b.error;
  const { t, dt, series: { S, E, W, H, A, T }, arm, torso, elbow } = b;
  const bar = b.y(W);
  const hasData = t.map((_, i) => !!(S[i] && E[i] && W[i]));
  const top = pct(bar, 0.08);
  const lockElb = Math.min(cfg.lockElbowDeg, pct(elbow, 0.9) - cfg.lockRelDeg);
  const locked = t.map((_, i) => elbow[i] >= lockElb && bar[i] <= top + cfg.topRatio * arm);
  const reps = findReps(t.length, i => bar[i] > top + cfg.downRatio * arm, locked, (i, j) => bar[i] > (bar[j] ?? -Infinity),
    // al petto il bilanciere è sopra la spalla; a braccia lungo i fianchi (riposo) no
    both(bentArms(b, hasData), ({ bottom }) => handsOn(t, i => W[i] && S[i] ? W[i].y <= S[i].y + 0.15 * arm : null, bottom)));
  if (!reps.length) return unclear('Non ho visto una panca completa: il bilanciere non scende al petto e risale. Riprendi tutta l\'alzata, fino alle braccia tese, con il telefono all\'altezza della panca.', 'panca');
  // gomito rispetto alla spalla: di lato l'angolo del braccio; da davanti (piedi o testa) conta
  // il dislivello gomito-spalla, rapportato alla lunghezza del braccio
  const upper = pct(t.map((_, i) => S[i] && E[i] ? dist(S[i], E[i]) : NaN), 0.9);
  const hum = t.map((_, i) => !S[i] || !E[i] ? NaN : b.frontal
    ? deg(Math.asin(Math.max(-1, Math.min(1, (E[i].y - S[i].y) / upper))))
    : deg(Math.atan2(E[i].y - S[i].y, Math.abs(E[i].x - S[i].x))));
  const hy = b.y(H);
  const foot = t.map((_, i) => (T[i] || A[i])?.y);
  const thr = cfg.stillRatio * arm;
  const pauses = [];

  const judged = reps.map(({ desc: descStart, fd: firstDown, bottom, up: upIdx, end: repEnd }, k) => {
    const checks = [], warnings = [];
    // fermo al petto: tratto più lungo vicino al punto più basso in cui il bilanciere è fermo
    const near = i => Number.isFinite(bar[i]) && bar[i] >= bar[bottom] - cfg.chestNearRatio * arm;
    let pa = bottom, pb = bottom, lo = bar[bottom], hi = bar[bottom];
    while (pa - 1 > firstDown && near(pa - 1) && Math.max(hi, bar[pa - 1]) - Math.min(lo, bar[pa - 1]) <= thr) { pa--; lo = Math.min(lo, bar[pa]); hi = Math.max(hi, bar[pa]); }
    while (pb + 1 <= repEnd && near(pb + 1) && Math.max(hi, bar[pb + 1]) - Math.min(lo, bar[pb + 1]) <= thr) { pb++; lo = Math.min(lo, bar[pb]); hi = Math.max(hi, bar[pb]); }
    const pause = t[pb] - t[pa] + dt;
    checks.push(pause >= cfg.holdSec - cfg.holdToleranceSec
      ? { id: 'chestHold', label: `Fermo al petto (${fmt(cfg.holdSec)} s)`, status: 'pass', detail: `Fermo di ${fmt(pause)} s al petto prima della spinta.`, t: [t[pa], t[pb] + dt] }
      : { id: 'chestHold', label: `Fermo al petto (${fmt(cfg.holdSec)} s)`, status: 'fail', close: pause >= cfg.holdSec - cfg.holdToleranceSec - 0.25, detail: pause < 0.25 ? 'Nessun fermo al petto: il bilanciere rimbalza.' : `Fermo al petto di solo ${fmt(pause)} s: serve ${fmt(cfg.holdSec)} s prima della spinta.`, t: [t[pa], t[pb] + dt] });

    pauses.push({ a: t[pa], b: t[pb] + dt, dur: pause });
    const key = { start: descStart >= 0 ? t[descStart] : t[firstDown], focus: (t[pa] + t[pb]) / 2, end: upIdx >= 0 ? t[upIdx] : null };

    // gomito almeno all'altezza della spalla (regola accessoria)
    let depth = -Infinity, depthIdx = bottom;
    for (let i = firstDown; i <= repEnd; i++) if ((Math.abs(t[i] - t[bottom]) <= 0.3 || (i >= pa && i <= pb)) && hum[i] > depth) { depth = hum[i]; depthIdx = i; }
    const over = depth - cfg.elbowMinDeg;
    if (!Number.isFinite(depth)) checks.push({ id: 'depth', label: 'Gomito all\'altezza della spalla', status: 'unknown', detail: 'Al petto non vedo bene spalla e gomito.' });
    else if (over >= 0) checks.push({ id: 'depth', label: 'Gomito all\'altezza della spalla', status: 'pass', detail: 'Il gomito scende all\'altezza della spalla.', t: [t[depthIdx], t[depthIdx]], value: depth });
    else if (depth >= cfg.elbowFailDeg) {
      checks.push({ id: 'depth', label: 'Gomito all\'altezza della spalla', status: 'pass', detail: 'Al limite: il gomito arriva appena all\'altezza della spalla.', t: [t[depthIdx], t[depthIdx]], value: depth });
      warnings.push('Gomito al limite: porta il bilanciere bene al petto.');
    } else checks.push({ id: 'depth', label: 'Gomito all\'altezza della spalla', status: 'fail', close: depth >= cfg.elbowFailDeg - cfg.elbowBorderlineDeg, detail: 'Discesa corta: il gomito resta sopra la spalla.', t: [t[depthIdx], t[depthIdx]], value: depth });

    const drop = reversal(t, bar, pb, repEnd, cfg.dropRatio * arm, cfg.dropMinSec);
    checks.push(drop >= 0
      ? { id: 'noDrop', label: 'Spinta senza discese del bilanciere', status: 'fail', detail: 'Il bilanciere è sceso durante la spinta.', t: [t[drop], t[drop]] }
      : { id: 'noDrop', label: 'Spinta senza discese del bilanciere', status: 'pass', detail: 'Spinta continua.' });

    checks.push(upIdx >= 0 ? { id: 'lockout', label: 'Chiusura a braccia tese', status: 'pass', detail: 'Braccia tese in chiusura.', t: [t[upIdx], t[upIdx]] }
      : { id: 'lockout', label: 'Chiusura a braccia tese', status: t[t.length - 1] - t[bottom] < 1.5 ? 'unknown' : 'fail', detail: t[t.length - 1] - t[bottom] < 1.5 ? 'Il video finisce prima della chiusura.' : 'Non hai chiuso l\'alzata a braccia tese.' });

    // Sedere e piedi: dal secondo di fermo a braccia tese (con l'arco già impostato) fino alla
    // chiusura devono restare giù. Il riferimento è la posizione durante quel fermo, quindi l'arco
    // lombare non conta; conta solo un sollevamento vero, che dura almeno un quinto di secondo.
    const from = descStart >= 0 ? descStart : firstDown, to = upIdx >= 0 ? upIdx : repEnd;
    const span = Math.max(1, Math.round(0.2 / dt));
    const riseOf = y => {
      const base = median(y.slice(Math.max(0, from - Math.round(0.6 / dt)), from + 1));
      if (!Number.isFinite(base)) return null;
      let rise = 0, at = -1;
      for (let i = from; i + span - 1 <= to; i++) {
        let low = -Infinity, ok = true;
        for (let j = i; j < i + span; j++) { if (!Number.isFinite(y[j])) { ok = false; break; } low = Math.max(low, y[j]); }
        if (ok && base - low > rise) { rise = base - low; at = i; }
      }
      return { rise, at };
    };
    const butt = b.visibility.H >= 0.5 ? riseOf(hy) : null;
    checks.push(!butt ? { id: 'butt', label: 'Sedere sempre sulla panca', status: 'unknown', detail: 'Non vedo bene il bacino.' }
      : butt.rise > cfg.buttRiseRatio * torso ? { id: 'butt', label: 'Sedere sempre sulla panca', status: 'fail', detail: 'Il sedere si è staccato dalla panca.', t: [t[butt.at], t[butt.at]] }
        : { id: 'butt', label: 'Sedere sempre sulla panca', status: 'pass', detail: 'Il sedere resta sulla panca.' });
    const feet = (b.visibility.T >= 0.5 || b.visibility.A >= 0.5) ? riseOf(foot) : null;
    checks.push(!feet ? { id: 'feet', label: 'Piedi sempre a terra', status: 'unknown', detail: 'Non vedo bene i piedi.' }
      : feet.rise > cfg.feetRiseRatio * torso ? { id: 'feet', label: 'Piedi sempre a terra', status: 'fail', detail: 'Un piede si è alzato da terra.', t: [t[feet.at], t[feet.at]] }
        : { id: 'feet', label: 'Piedi sempre a terra', status: 'pass', detail: 'I piedi restano a terra.' });
    return { checks, warnings, key };
  });

  return assemble('panca', b, judged, [], {
    path: { a: 'W', label: 'Traiettoria bilanciere' },
    trail: 'W',
    focus: {
      // la cosa che conta in panca: il fermo al petto
      point: i => W[i] || null,
      label: i => {
        const p = pauses.find(q => t[i] >= q.a - 0.45 && t[i] <= q.b + 0.45);
        if (!p) return null;
        return p.dur >= cfg.holdSec - cfg.holdToleranceSec ? [`FERMO AL PETTO ${fmt(p.dur)} s`, false] : p.dur < 0.25 ? ['NESSUN FERMO AL PETTO', true] : [`FERMO AL PETTO SOLO ${fmt(p.dur)} s`, true];
      },
    },
    dropText: 'IL BILANCIERE SCENDE',
  });
}

// ── STACCO ─────────────────────────────────────────────────────────────
// Partenza libera · nessuna discesa del bilanciere · chiusura a gambe tese con la spalla
// dietro il bilanciere. (Il "giù" non si giudica.)
export function analyzeDeadlift(frames, width, height, cfg = DEADLIFT) {
  const b = prepare(frames, width, height, 'stacco', ['S', 'W', 'H', 'K', 'A']);
  if (b.error) return b.error;
  const { t, series: { S, W, H, K, T, Hl }, body, knee, hip } = b;
  const bar = b.y(W);
  const hasData = t.map((_, i) => !!(S[i] && W[i] && H[i] && K[i]));
  const floor = pct(bar, 0.92), top = pct(bar, 0.08);
  if (!(floor - top > cfg.minRangeRatio * body)) return unclear('Non ho visto uno stacco: il bilanciere non sale abbastanza. Controlla di aver caricato il video giusto.', 'stacco');
  const lockKnee = Math.min(cfg.lockKneeDeg, pct(knee, 0.9) - cfg.lockRelDeg);
  const lockHip = Math.min(cfg.lockHipDeg, pct(hip, 0.9) - cfg.lockRelDeg);
  const locked = t.map((_, i) => knee[i] >= lockKnee && hip[i] >= lockHip && bar[i] <= top + cfg.topRatio * body);
  const firstData = hasData.indexOf(true);
  // Per lo stacco la ripetizione va da terra alla chiusura: "giù" = bilanciere vicino a terra.
  const onFloor = t.map((_, i) => bar[i] > floor - cfg.liftRatio * body);
  const reps = [];
  let from = firstData;
  while (from >= 0 && from < t.length) {
    let ls = firstFrom(bar, from, i => bar[i] < floor - cfg.liftRatio * body);
    if (ls < 0) break;
    const lk = firstFrom(locked, ls, i => locked[i]);
    // La tirata parte dall'ultimo istante in cui il bilanciere è a terra: i movimenti delle mani
    // mentre ci si prepara (o un bilanciere che si stacca e si riappoggia) non sono "discese".
    for (let i = (lk >= 0 ? lk : t.length - 1); i > ls; i--) if (onFloor[i]) { ls = i + 1; break; }
    let seen = 0; const stopAt = lk >= 0 ? lk : t.length - 1;
    for (let i = ls; i <= stopAt; i++) if (hasData[i]) seen++;
    // falso allarme (persona che esce dall'inquadratura, video senza nessuno): si ignora
    if (seen < Math.max(3, 0.5 * (stopAt - ls + 1))) { if (lk < 0) break; from = lk + 1; continue; }
    reps.push({ ls, lk, seen: ls > from + 1 || (from > firstData) });
    if (lk < 0) break;
    const back = firstFrom(onFloor, lk, i => onFloor[i]);
    if (back < 0) break;
    from = back;
  }
  if (!reps.length) return unclear('Non ho visto uno stacco: il bilanciere non si stacca da terra.', 'stacco');
  const toes = median(t.map((_, i) => T[i] && Hl[i] ? T[i].x - Hl[i].x : NaN));

  const aheads = [];
  const judged = reps.map(({ ls: liftStart, lk: lockIdx, seen: startSeen }, k) => {
    const checks = [], warnings = [];
    const drop = reversal(t, bar, liftStart, lockIdx >= 0 ? lockIdx : t.length - 1, cfg.dropRatio * body, cfg.dropMinSec);
    checks.push(drop >= 0
      ? { id: 'noDrop', label: 'Tirata senza discese del bilanciere', status: 'fail', detail: 'Il bilanciere è sceso durante la tirata.', t: [t[drop], t[drop]] }
      : { id: 'noDrop', label: 'Tirata senza discese del bilanciere', status: startSeen ? 'pass' : 'unknown', detail: startSeen ? 'Tirata continua.' : 'Il video inizia con il bilanciere già staccato da terra.' });

    if (lockIdx < 0) {
      let peak = liftStart; for (let i = liftStart; i < t.length; i++) if (bar[i] < bar[peak]) peak = i;
      const short = t[t.length - 1] - t[peak] < 0.6;
      checks.push({ id: 'lockout', label: 'Chiusura a gambe e anche tese', status: short ? 'unknown' : 'fail', detail: short ? 'Il video finisce prima della chiusura.' : 'Chiusura incompleta: ginocchia o anche non distese.' });
    } else checks.push({ id: 'lockout', label: 'Chiusura a gambe e anche tese', status: 'pass', detail: 'Ginocchia e anche distese.', t: [t[lockIdx], t[lockIdx]] });

    let ahead = NaN;
    if (lockIdx >= 0) {
      const facing = Number.isFinite(toes) && Math.abs(toes) > 2 ? Math.sign(toes)
        : Math.sign(median(t.slice(liftStart, liftStart + 6).map((_, j) => K[liftStart + j] && H[liftStart + j] ? K[liftStart + j].x - H[liftStart + j].x : NaN)) || 1);
      const vals = [];
      for (let i = lockIdx; i < t.length && t[i] - t[lockIdx] <= 0.6; i++) if (S[i] && W[i]) vals.push((S[i].x - W[i].x) * facing);
      ahead = median(vals);
    }
    aheads.push(ahead);
    if (b.frontal) checks.push({ id: 'shoulder', label: 'Spalla dietro il bilanciere', status: 'unknown', detail: 'Da davanti non si vede se la spalla è dietro il bilanciere: per questo controllo riprendi di lato.' });
    else if (!Number.isFinite(ahead)) checks.push({ id: 'shoulder', label: 'Spalla dietro il bilanciere', status: 'unknown', detail: 'In chiusura non vedo bene spalla e bilanciere.' });
    else checks.push(ahead > cfg.shoulderTolRatio * body
      ? { id: 'shoulder', label: 'Spalla dietro il bilanciere', status: 'fail', detail: 'In chiusura la spalla resta davanti al bilanciere.', t: [t[lockIdx], t[lockIdx]] }
      : { id: 'shoulder', label: 'Spalla dietro il bilanciere', status: 'pass', detail: 'In chiusura la spalla è dietro il bilanciere.', t: [t[lockIdx], t[lockIdx]] });

    // chiusa ma il video finisce prima che il bilanciere torni a terra: valida, con una nota
    if (lockIdx >= 0 && firstFrom(onFloor, lockIdx, i => onFloor[i]) < 0) warnings.push('Il video finisce prima che riporti il bilanciere a terra: non l\'ho potuto vedere, ma l\'alzata è già completa.');
    return { checks, warnings, key: { start: t[liftStart], focus: lockIdx >= 0 ? t[lockIdx] : t[liftStart], end: lockIdx >= 0 ? t[lockIdx] : null } };
  });

  return assemble('stacco', b, judged, [], {
    path: { a: 'W', label: 'Traiettoria bilanciere' },
    trail: 'W',
    focus: {
      a: 'S', b: 'H',
      vline: i => W[i] ? W[i].x : null, // linea verticale del bilanciere
      label: () => { const a = aheads.find(Number.isFinite); return !Number.isFinite(a) ? null : a > cfg.shoulderTolRatio * body ? ['SPALLA DAVANTI AL BILANCIERE', true] : ['SPALLA DIETRO IL BILANCIERE', false]; },
    },
    dropText: 'IL BILANCIERE SCENDE',
  });
}

// ── TRAZIONI ───────────────────────────────────────────────────────────
// Niente kip di spalla · gambe fluide, senza scatti · mento sopra la sbarra · ritorno a braccia
// tese. (Start e giù non si giudicano.)
// Appeso o no si capisce dalla geometria del braccio, non dal resto del video: appeso a braccia
// tese la spalla sta sotto la mano di circa un braccio. Così non disturbano i momenti in piedi
// prima di saltare alla sbarra, o le ripetizioni in serie.
function hangPhases(b, cfg, allowAbove = false) {
  const { t, arm, elbow } = b;
  const sy = b.y(b.series.S), wy = b.y(b.series.W);
  const rel = t.map((_, i) => sy[i] - wy[i]); // quanto la spalla è sotto la mano
  const hangElb = Math.min(cfg.hangElbowDeg, pct(elbow, 0.9) - cfg.hangRelDeg);
  const low = t.map((_, i) => rel[i] >= 0.72 * arm);                // tornato giù
  const hang = t.map((_, i) => low[i] && elbow[i] >= hangElb);       // giù e a braccia tese
  const pulled = i => rel[i] < 0.55 * arm && (allowAbove || rel[i] > -0.3 * arm);
  const hasData = t.map((_, i) => !!(b.series.S[i] && b.series.E[i] && b.series.W[i]));
  // nel muscle up la transizione è velocissima e il gomito piegato si vede poco: basta che le spalle
  // arrivino all'altezza delle mani
  const real = allowAbove
    ? ({ fd, end }) => { while (end > fd && !b.present[end]) end--; let seen = 0, high = false; for (let i = fd; i <= end; i++) { if (b.present[i]) seen++; if (rel[i] < 0.2 * arm) high = true; } return seen >= Math.max(3, 0.7 * (end - fd + 1)) && high; }
    : bentArms(b, hasData);
  const grip = median(wy.filter((_, i) => hang[i])); // le mani sulla sbarra
  const onBar = ({ bottom }) => !Number.isFinite(grip) || handsOn(t, i => Number.isFinite(wy[i]) ? Math.abs(wy[i] - grip) <= 0.3 * arm : null, bottom);
  const reps = findReps(t.length, pulled, low, (i, j) => rel[i] < (rel[j] ?? Infinity), both(real, onBar));
  return { sy, hang, low, reps };
}

function kipCheck(b, cfg, hang, pullStart, sy) {
  const { t, arm } = b;
  const holdIdx = lastBefore(pullStart, i => hang[i]);
  if (holdIdx < 0) return { id: 'kip', label: 'Niente kip di spalla', status: 'unknown', detail: 'Non vedo la partenza da appeso.' };
  const ref = median(sy.slice(Math.max(0, holdIdx - Math.round(0.5 / b.dt)), holdIdx + 1));
  let dip = 0, at = -1;
  for (let i = holdIdx; i <= pullStart; i++) if (t[pullStart] - t[i] <= cfg.kipWindowSec && sy[i] - ref > dip) { dip = sy[i] - ref; at = i; }
  return dip > cfg.kipRatio * arm
    ? { id: 'kip', label: 'Niente kip di spalla', status: 'fail', detail: 'Kip di spalla: le spalle scendono e risalgono per prendere slancio.', t: [t[at], t[at]] }
    : { id: 'kip', label: 'Niente kip di spalla', status: 'pass', detail: 'Partenza pulita, senza slancio.' };
}

// Traiettoria a corpo libero o zavorrato: un solo pulsante, "Traiettoria dischi". Si parte dai
// piedi; se nell'immagine si trova il disco appeso alla cintura (app.js, plates.js) si segue lui.
function feet(b) {
  const { t, series: { A, T } } = b;
  return { pts: t.map((_, i) => T[i] && A[i] ? { x: (T[i].x + A[i].x) / 2, y: (T[i].y + A[i].y) / 2 } : A[i] || T[i] || null), label: 'Traiettoria dischi' };
}

export function analyzePullup(frames, width, height, cfg = PULLUP) {
  const b = prepare(frames, width, height, 'trazioni', ['S', 'E', 'W']);
  if (b.error) return b.error;
  const { t, series: { S, E, W, H, K, M, N }, arm } = b;
  const hasData = t.map((_, i) => !!(S[i] && E[i] && W[i]));
  const { sy, hang, reps } = hangPhases(b, cfg);
  const nextPull = k => (k + 1 < reps.length ? reps[k + 1].fd : t.length);
  if (!reps.length) return unclear('Non ho visto una trazione: le spalle non salgono abbastanza. Riprendi con la sbarra nell\'inquadratura.', 'trazioni');
  const barY = median(b.y(W)) - cfg.barAboveWristRatio * arm;
  const chin = t.map((_, i) => M[i] && N[i] ? M[i].y + cfg.chinBelowMouth * Math.max(0, M[i].y - N[i].y) : N[i] ? N[i].y + 0.12 * arm : NaN);
  const thigh = t.map((_, i) => H[i] && K[i] ? deg(Math.atan2(K[i].x - H[i].x, K[i].y - H[i].y)) : NaN);
  const margins = [], guessed = [];

  const judged = reps.map(({ desc: hangStart, fd: pullStart, bottom: topIdx, up: downIdx }, k) => {
    const checks = [], warnings = [];
    checks.push(kipCheck(b, cfg, hang, pullStart, sy));

    if (!(b.visibility.K >= 0.4)) checks.push({ id: 'legs', label: 'Gambe senza scatti', status: 'unknown', detail: 'Non vedo bene le gambe.' });
    else {
      const from = Math.max(0, pullStart - Math.round(0.3 / b.dt));
      const sw = peakRate(t, thigh, from, topIdx), kk = peakRate(t, b.knee, from, topIdx);
      const bad = sw.peak > cfg.legSwingDegPerSec ? sw : kk.peak > cfg.kneeKickDegPerSec ? kk : null;
      checks.push(bad
        ? { id: 'legs', label: 'Gambe senza scatti', status: 'fail', detail: 'Scatto delle gambe che aiuta la tirata.', t: [t[bad.at], t[bad.at]] }
        : { id: 'legs', label: 'Gambe senza scatti', status: 'pass', detail: 'Gambe ferme o in movimento fluido.' });
    }

    let best = Infinity, chinIdx = topIdx;
    for (let i = pullStart; i < t.length && (downIdx < 0 || i <= downIdx); i++) if (Math.abs(t[i] - t[topIdx]) <= 0.3 && chin[i] < best) { best = chin[i]; chinIdx = i; }
    const key = { start: hangStart >= 0 ? t[hangStart] : t[pullStart], focus: t[chinIdx], end: downIdx >= 0 ? t[downIdx] : null };
    // Mento non visibile (ripresa da dietro, testa fuori o coperta): si giudica a impressione da
    // quanto le spalle arrivano vicino alle mani. Mento alla sbarra ≈ spalle sotto le mani di circa
    // un quarto di braccio. Valida con nota; no rep solo se le spalle restano chiaramente basse.
    if (b.fromBehind || !Number.isFinite(best)) {
      let rel = Infinity, at = topIdx;
      for (let i = pullStart; i < t.length && (downIdx < 0 || i <= downIdx); i++) {
        if (Math.abs(t[i] - t[topIdx]) > 0.3 || !S[i] || !W[i]) continue;
        const r = (S[i].y - W[i].y) / arm; if (r < rel) { rel = r; at = i; }
      }
      key.focus = t[at];
      guessed.push({ a: t[at] - 0.45, b: t[at] + 0.45, ok: rel <= cfg.chinGuessFailRatio });
      if (!Number.isFinite(rel)) checks.push({ id: 'chin', label: 'Mento sopra la sbarra', status: 'unknown', detail: 'In alto non vedo né la testa né le spalle.' });
      else if (rel <= cfg.chinGuessOkRatio) checks.push({ id: 'chin', label: 'Mento sopra la sbarra', status: 'pass', detail: 'Il mento non si vede bene, ma a impressione supera la sbarra: le spalle arrivano vicino alle mani.', t: [t[at], t[at]] });
      else if (rel <= cfg.chinGuessFailRatio) checks.push({ id: 'chin', label: 'Mento sopra la sbarra', status: 'pass', detail: 'Al limite: il mento non si vede bene e a impressione arriva appena alla sbarra.', t: [t[at], t[at]] });
      else checks.push({ id: 'chin', label: 'Mento sopra la sbarra', status: 'fail', close: rel <= cfg.chinGuessFailRatio + 0.1, detail: 'Il mento non si vede bene, ma le spalle restano lontane dalle mani: a impressione il mento non supera la sbarra.', t: [t[at], t[at]] });
      warnings.push('Il mento non si vede bene nel video (ripresa da dietro o testa coperta): il giudizio sul mento è a impressione. Per un giudizio sicuro riprendi di lato, con la testa nell\'inquadratura.');
    } else {
    const margin = barY - best; // positivo = mento sopra la sbarra
    margins.push(margin);
    checks.push(margin >= cfg.chinMarginRatio * arm
      ? { id: 'chin', label: 'Mento sopra la sbarra', status: 'pass', detail: margin < 0.04 * arm ? 'Al limite: il mento arriva appena sopra la sbarra.' : 'Il mento supera la sbarra.', t: [t[chinIdx], t[chinIdx]], value: margin / arm }
      : { id: 'chin', label: 'Mento sopra la sbarra', status: 'fail', close: margin > -0.04 * arm, detail: 'Il mento non supera la sbarra.', t: [t[chinIdx], t[chinIdx]], value: margin / arm });
    if (margin >= 0 && margin < 0.04 * arm) warnings.push('Mento al limite: un giudice severo potrebbe darla no rep.');
    }

    // giù a braccia tese: tra il ritorno in basso e la tirata successiva
    const ext = downIdx < 0 ? -1 : firstFrom(hang, downIdx, i => hang[i] && i < nextPull(k));
    const L = 'Ritorno a braccia tese';
    if (downIdx < 0 || (ext < 0 && !hasData.slice(downIdx, nextPull(k)).some(Boolean))) {
      const short = t[t.length - 1] - t[topIdx] < 1.5;
      checks.push({ id: 'lockout', label: L, status: short ? 'unknown' : 'fail', detail: short ? 'Il video finisce prima del ritorno a braccia tese.' : 'Non sei tornato giù a braccia tese.' });
    } else if (ext < 0) {
      checks.push({ id: 'lockout', label: L, status: 'fail', detail: 'Sei tornato giù ma senza distendere del tutto le braccia.', t: [t[downIdx], t[downIdx]] });
    } else checks.push({ id: 'lockout', label: L, status: 'pass', detail: 'Ritorno giù a braccia tese.', t: [t[ext], t[ext]] });
    return { checks, warnings, key };
  });

  return assemble('trazioni', b, judged, [], {
    path: feet(b),
    trail: 'S',
    focus: {
      a: 'M', b: 'N', hline: () => barY, point: i => Number.isFinite(chin[i]) && M[i] ? { x: M[i].x, y: chin[i] } : null,
      label: i => {
        const g = guessed.find(q => t[i] >= q.a && t[i] <= q.b);
        if (g) return g.ok ? ['MENTO SOPRA (A IMPRESSIONE)', false] : ['MENTO SOTTO (A IMPRESSIONE)', true];
        if (b.fromBehind) return null;
        const m = barY - chin[i]; return !Number.isFinite(m) ? null : m >= cfg.chinMarginRatio * arm ? ['MENTO SOPRA LA SBARRA', false] : ['MENTO SOTTO LA SBARRA', true];
      },
    },
  });
}

// ── DIP ────────────────────────────────────────────────────────────────
// In basso la spalla scende sotto il gomito · salita senza discese · chiusura a braccia tese.
// (Start e giù non si giudicano.)
export function analyzeDip(frames, width, height, cfg = DIP) {
  const b = prepare(frames, width, height, 'dip', ['S', 'E', 'W']);
  if (b.error) return b.error;
  const { t, series: { S, E, W }, arm, elbow } = b;
  const sy = b.y(S);
  const hasData = t.map((_, i) => !!(S[i] && E[i] && W[i]));
  const top = pct(sy, 0.08);
  const lockElb = Math.min(cfg.lockElbowDeg, pct(elbow, 0.9) - cfg.lockRelDeg);
  const locked = t.map((_, i) => elbow[i] >= lockElb && sy[i] <= top + cfg.topRatio * arm);
  const wy = b.y(W), grip = median(wy.filter((_, i) => locked[i])); // le mani sulle parallele
  const onBars = ({ bottom }) => !Number.isFinite(grip) || handsOn(t, i => Number.isFinite(wy[i]) ? Math.abs(wy[i] - grip) <= 0.3 * arm : null, bottom);
  const reps = findReps(t.length, i => sy[i] > top + cfg.downRatio * arm, locked, (i, j) => sy[i] > (sy[j] ?? -Infinity), both(bentArms(b, hasData), onBars));
  if (!reps.length) return unclear('Non ho visto un dip: le spalle non scendono abbastanza. Riprendi con le parallele nell\'inquadratura.', 'dip');
  // spalla rispetto al gomito: di lato l'angolo del braccio; da davanti il braccio va indietro
  // e conta solo il dislivello spalla-gomito, rapportato alla lunghezza del braccio
  const upper = pct(t.map((_, i) => S[i] && E[i] ? dist(S[i], E[i]) : NaN), 0.9);
  const ang = t.map((_, i) => !S[i] || !E[i] ? NaN : b.frontal
    ? deg(Math.asin(Math.max(-1, Math.min(1, (S[i].y - E[i].y) / upper))))
    : deg(Math.atan2(S[i].y - E[i].y, Math.abs(S[i].x - E[i].x))));

  const judged = reps.map(({ desc: descStart, fd: firstDown, bottom, up: upIdx, end: repEnd }, k) => {
    const checks = [], warnings = [];
    let depth = -Infinity, depthIdx = bottom;
    for (let i = firstDown; i <= repEnd; i++) if (Math.abs(t[i] - t[bottom]) <= 0.3 && ang[i] > depth) { depth = ang[i]; depthIdx = i; }
    const key = { start: descStart >= 0 ? t[descStart] : t[firstDown], focus: t[depthIdx], end: upIdx >= 0 ? t[upIdx] : null };
    if (!Number.isFinite(depth)) return { unclear: 'In basso non vedo bene spalla e gomito. Riprendi esattamente di lato.', checks, warnings, key };
    const over = depth - cfg.depthMinDeg;
    if (over >= 0) {
      checks.push({ id: 'depth', label: 'Spalla sotto il gomito', status: 'pass', detail: over < cfg.depthBorderlineDeg ? 'Al limite: la spalla arriva appena all\'altezza del gomito.' : 'La spalla scende sotto il gomito.', t: [t[depthIdx], t[depthIdx]], value: depth });
      if (over < cfg.depthBorderlineDeg) warnings.push('Profondità al limite: un giudice severo potrebbe darla no rep.');
    } else checks.push({ id: 'depth', label: 'Spalla sotto il gomito', status: 'fail', close: -over < cfg.depthBorderlineDeg, detail: 'Dip alto: la spalla resta sopra il gomito.', t: [t[depthIdx], t[depthIdx]], value: depth });

    const drop = reversal(t, sy, bottom, repEnd, cfg.dropRatio * arm, cfg.dropMinSec);
    checks.push(drop >= 0
      ? { id: 'noDrop', label: 'Salita senza discese', status: 'fail', detail: 'Durante la salita sei sceso di nuovo.', t: [t[drop], t[drop]] }
      : { id: 'noDrop', label: 'Salita senza discese', status: 'pass', detail: 'Salita continua.' });

    checks.push(upIdx >= 0 ? { id: 'lockout', label: 'Chiusura a braccia tese', status: 'pass', detail: 'Braccia tese in chiusura.', t: [t[upIdx], t[upIdx]] }
      : { id: 'lockout', label: 'Chiusura a braccia tese', status: t[t.length - 1] - t[bottom] < 1.2 ? 'unknown' : 'fail', detail: t[t.length - 1] - t[bottom] < 1.2 ? 'Il video finisce prima della chiusura.' : 'Non hai chiuso a braccia tese.' });
    return { checks, warnings, key };
  });

  return assemble('dip', b, judged, [], {
    path: feet(b),
    trail: 'S',
    focus: {
      a: 'S', b: 'E',
      ref: i => !S[i] || !E[i] ? null : b.frontal ? E[i].y + Math.sin(cfg.depthMinDeg * Math.PI / 180) * upper : E[i].y - Math.tan(cfg.depthMinDeg * Math.PI / 180) * Math.abs(S[i].x - E[i].x),
      label: i => { const o = ang[i] - cfg.depthMinDeg; return !Number.isFinite(o) ? null : o >= cfg.depthBorderlineDeg ? ['PROFONDITÀ OK', false] : o >= 0 ? ['PROFONDITÀ AL LIMITE', false] : ['SPALLA SOPRA IL GOMITO', true]; },
    },
    dropText: 'SCENDI DI NUOVO',
  });
}

// ── MUSCLE UP ──────────────────────────────────────────────────────────
// Niente kip di spalla · anca fluida, nessuno scatto · ginocchio sempre teso (5° di tolleranza) ·
// sopra la sbarra a braccia tese. (Start e giù non si giudicano.)
export function analyzeMuscleUp(frames, width, height, cfg = MUSCLEUP) {
  const b = prepare(frames, width, height, 'muscleup', ['S', 'E', 'W']);
  if (b.error) return b.error;
  const { t, series: { S, E, W }, arm, elbow, knee, hip } = b;
  const hasData = t.map((_, i) => !!(S[i] && E[i] && W[i]));
  const { sy, hang, reps: pulls } = hangPhases(b, cfg, true);
  if (!pulls.length) return unclear('Non ho visto un muscle up: le spalle non salgono abbastanza. Riprendi con la sbarra nell\'inquadratura.', 'muscleup');
  const wy = b.y(W);
  const barY = median(wy.filter((_, i) => hang[i])) || median(wy); // la sbarra: dove stanno le mani da appeso
  const topElb = Math.min(cfg.topElbowDeg, pct(elbow, 0.9) - cfg.topRelDeg);
  // sopra la sbarra = spalle sopra le mani (che sono sulla sbarra) e braccia tese
  const above = t.map((_, i) => sy[i] < wy[i] - cfg.aboveBarRatio * arm && elbow[i] >= topElb);
  // Durante la transizione le braccia possono distendersi un attimo: non è una nuova ripetizione.
  // Una tirata che non arriva sopra la sbarra si unisce a quella che segue subito dopo.
  for (let k = 0; k < pulls.length - 1;) {
    const p = pulls[k], q = pulls[k + 1];
    const reached = above.slice(p.fd, p.end + 1).some(Boolean);
    if (!reached && t[q.fd] - t[p.end] < 1.0) { pulls.splice(k, 2, { ...p, end: q.end, up: q.up }); } else k++;
  }

  const judged = pulls.map(({ desc: hangStart, fd: pullStart, up, end }, k) => {
    const checks = [], warnings = [];
    const topIdx = firstFrom(above, pullStart, i => above[i] && i <= end);
    checks.push(kipCheck(b, cfg, hang, pullStart, sy));

    const stop = topIdx >= 0 ? topIdx : end;
    if (!(b.visibility.K >= 0.4 && b.visibility.A >= 0.3)) checks.push({ id: 'knee', label: 'Ginocchia tese', status: 'unknown', detail: 'Non vedo bene le gambe.' });
    else {
      const refFrom = hangStart >= 0 ? Math.max(0, hangStart - Math.round(0.6 / b.dt)) : Math.max(0, pullStart - Math.round(0.4 / b.dt));
      const refK = knee.slice(refFrom, pullStart + 1).filter(Number.isFinite);
      const base = median(refK);
      const sd = refK.length > 2 ? Math.sqrt(refK.reduce((a, v) => a + (v - base) ** 2, 0) / refK.length) : 0;
      const noise = Math.max(cfg.kneeNoiseMinDeg, 2 * sd);
      let minK = Infinity, at = -1;
      for (let i = pullStart; i <= stop; i++) if (knee[i] < minK) { minK = knee[i]; at = i; }
      const bend = base - minK;
      checks.push(!Number.isFinite(bend) ? { id: 'knee', label: 'Ginocchia tese', status: 'unknown', detail: 'Non vedo bene le gambe.' }
        : bend > cfg.kneeTolDeg + noise ? { id: 'knee', label: 'Ginocchia tese', status: 'fail', detail: `Ginocchio piegato di circa ${fmt(bend, 0)}° durante l'alzata.`, t: [t[at], t[at]], value: bend }
          : { id: 'knee', label: 'Ginocchia tese', status: 'pass', detail: 'Ginocchia tese per tutta l\'alzata.' });
    }
    const hs = peakRate(t, hip, Math.max(0, pullStart - Math.round(0.3 / b.dt)), stop);
    checks.push(!(b.visibility.H >= 0.4 && b.visibility.K >= 0.4)
      ? { id: 'snap', label: 'Movimento fluido, senza scatti', status: 'unknown', detail: 'Non vedo bene anca e gambe.' }
      : hs.peak > cfg.hipSnapDegPerSec
        ? { id: 'snap', label: 'Movimento fluido, senza scatti', status: 'fail', detail: 'Scatto/kip dell\'anca che spezza l\'alzata.', t: [t[hs.at], t[hs.at]] }
        : { id: 'snap', label: 'Movimento fluido, senza scatti', status: 'pass', detail: 'Movimento fluido.' });

    if (topIdx < 0) {
      const short = t[t.length - 1] - t[pullStart] < 1.2;
      checks.push({ id: 'top', label: 'Sopra la sbarra a braccia tese', status: short ? 'unknown' : 'fail', detail: short ? 'Il video finisce prima della chiusura.' : 'Non sei arrivato sopra la sbarra a braccia tese.' });
    } else {
      checks.push({ id: 'top', label: 'Sopra la sbarra a braccia tese', status: 'pass', detail: 'Chiusura sopra la sbarra a braccia tese.', t: [t[topIdx], t[topIdx]] });
    }
    // arrivato sopra a braccia tese ma il video finisce prima che torni giù: valida, con una nota
    if (topIdx >= 0 && up < 0) warnings.push('Il video finisce prima che torni giù dalla sbarra: non l\'ho potuto vedere, ma l\'alzata è già completa.');
    // fine della ripetizione: quando torna giù dalla sbarra, o l'ultimo fotogramma in cui si vede
    let last = end; while (last > pullStart && !b.present[last]) last--;
    return { checks, warnings, key: { start: hangStart >= 0 ? t[hangStart] : t[pullStart], focus: topIdx >= 0 ? t[topIdx] : t[pullStart], end: up >= 0 ? t[up] : t[last] } };
  });

  return assemble('muscleup', b, judged, [], {
    path: { ...feet(b), bar: () => barY },
    trail: 'S',
    focus: {
      a: 'S', b: 'E', hline: () => barY,
      label: i => !Number.isFinite(sy[i]) ? null : above[i] ? ['SOPRA LA SBARRA', false] : null,
    },
  });
}
