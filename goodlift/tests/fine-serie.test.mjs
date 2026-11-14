// Fine serie: dopo l'ultima ripetizione l'atleta scende (piedi a terra, lascia le parallele o la
// sbarra) mentre il video continua. Quella fase NON è una ripetizione.
// Esegui con:  node goodlift/tests/fine-serie.test.mjs
import { analyzeDip, analyzePullup } from '../lifts.js';

const W = 1000, H = 1000, FPS = 20, FLOOR = 1.0;
const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));
const lerp = (a, b, f) => a + (b - a) * f;
const rnd = () => (Math.random() - 0.5) * 0.003;

function frame(pts) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
  const put = (ids, p) => ids.forEach((id, k) => { lm[id] = { x: p.x + rnd() + 0.004 * k, y: p.y + rnd(), visibility: 0.95 }; });
  put([11, 12], pts.S); put([13, 14], pts.E); put([15, 16], pts.W);
  put([23, 24], pts.H); put([25, 26], pts.K); put([27, 28], pts.A);
  put([0], { x: pts.S.x + 0.04, y: pts.S.y - 0.07 }); put([9, 10], { x: pts.S.x + 0.04, y: pts.S.y - 0.05 });
  return lm;
}

// DIP di lato. s = 0 braccia tese, 1 in basso (spalla sotto il gomito).
// legs: 0 = ginocchia piegate (piedi in aria, dietro), 1 = gambe distese verso terra.
// bend: piegato in avanti in piedi (per sganciare il disco dalla cintura): spalle giù, anca ferma.
// hands: 0 = mani sulle parallele, 1 = mani lasciate (lungo i fianchi). x = spostamento laterale.
function dipPose(s, { legs = 0, hands = 0, x = 0, stand = 0, bend = 0 } = {}) {
  const Wr = { x: 0.5 + x, y: 0.55 };
  const a = 30 * s * Math.PI / 180, bb = 100 * s * Math.PI / 180;
  const E0 = { x: Wr.x - 0.13 * Math.sin(a), y: Wr.y - 0.13 * Math.cos(a) };
  let S = { x: E0.x + 0.14 * Math.sin(bb), y: E0.y - 0.14 * Math.cos(bb) };
  const Hp = { x: S.x - 0.02, y: S.y + 0.27 };
  const Kn = { x: Hp.x, y: Hp.y + 0.2 };
  let A = { x: lerp(Kn.x - 0.2, Kn.x, legs), y: lerp(Kn.y, Kn.y + 0.2, legs) };
  if (A.y > FLOOR) A = { x: A.x, y: FLOOR };
  if (stand) A = { x: Kn.x, y: FLOOR }; // in piedi: caviglie a terra
  const K = stand || legs ? { x: lerp(Kn.x, (Hp.x + A.x) / 2 + 0.03, Math.max(legs, stand)), y: lerp(Kn.y, (Hp.y + A.y) / 2, Math.max(legs, stand)) } : Kn;
  // mani lasciate: polsi lungo i fianchi, braccia distese verso il basso
  let Wh = { x: lerp(Wr.x, S.x + 0.01, hands), y: lerp(Wr.y, S.y + 0.27, hands) };
  let E = { x: lerp(E0.x, S.x + 0.005, hands), y: lerp(E0.y, S.y + 0.14, hands) };
  if (bend) { // busto in avanti attorno all'anca, braccia che pendono
    const ang = 70 * bend * Math.PI / 180, Sb = { x: Hp.x + 0.27 * Math.sin(ang), y: Hp.y - 0.27 * Math.cos(ang) };
    // come nel video: le mani vanno alla cintura (circa all'altezza delle parallele) a sganciare il disco
    S = Sb; Wh = { x: Hp.x + 0.06, y: 0.55 + 0.05 * bend }; E = { x: (S.x + Wh.x) / 2 + 0.03, y: (S.y + Wh.y) / 2 + 0.04 };
  }
  return frame({ S, E, W: Wh, H: Hp, K, A });
}

// segmenti: [durata, (f) => posa]
function clip(segs) {
  const out = []; let t = 0;
  for (const [dur, at] of segs) { const n = Math.round(dur * FPS); for (let i = 0; i < n; i++) { out.push({ t, lm: at(ease(i / n)) }); t += 1 / FPS; } }
  return out;
}
const dipRep = [[1.0, f => dipPose(f)], [0.3, () => dipPose(1)], [1.0, f => dipPose(1 - f)], [0.4, () => dipPose(0)]];
const dipEnd3 = [ // il video di Manuel: piedi a terra, lascia le parallele, si piega a sganciare il disco
  [0.8, f => dipPose(0, { legs: f })],
  [0.6, f => dipPose(0, { legs: 1, stand: 1, hands: f })],
  [1.2, f => dipPose(0, { legs: 1, stand: 1, hands: 1, bend: f })],
  [1.0, () => dipPose(0, { legs: 1, stand: 1, hands: 1, bend: 1 })],
];
const dipEnd2 = [ // scende e resta giù con i piedi a terra, poi lascia le mani
  [1.0, f => dipPose(f)],
  [0.6, f => dipPose(1, { legs: f })],
  [1.0, f => dipPose(1, { legs: 1, hands: f })],
  [1.5, f => dipPose(1, { legs: 1, hands: 1, x: 0.3 * f })],
];

// TRAZIONI di lato. s = 0 appeso a braccia tese, 1 mento sopra la sbarra. drop: scende dalla sbarra.
function pullPose(s, { drop = 0, hands = 0 } = {}) {
  const bar = { x: 0.5, y: 0.2 };
  const Wr = { x: bar.x, y: bar.y };
  const sy = lerp(0.2 + 0.26, 0.2 - 0.02, s) + 0.25 * drop;
  const S = { x: 0.5 + 0.04 * s, y: sy };
  const E = { x: lerp(S.x, 0.57, s), y: lerp((S.y + Wr.y) / 2, S.y - 0.02, s) };
  const Wh = { x: lerp(Wr.x, S.x, hands), y: lerp(Wr.y, S.y + 0.27, hands) };
  const Eh = { x: lerp(E.x, S.x, hands), y: lerp(E.y, S.y + 0.14, hands) };
  const Hp = { x: S.x, y: S.y + 0.27 }, Kn = { x: S.x, y: S.y + 0.47 };
  const A = { x: S.x, y: Math.min(FLOOR, S.y + 0.67) };
  return frame({ S, E: Eh, W: Wh, H: Hp, K: Kn, A });
}
const pullRep = [[0.4, () => pullPose(0)], [1.0, f => pullPose(f)], [0.3, () => pullPose(1)], [1.0, f => pullPose(1 - f)]];
const pullEnd = [
  [0.6, f => pullPose(0, { drop: f * 0.4 })],           // si lascia scendere fino a toccare terra
  [0.6, f => pullPose(0, { drop: 0.4, hands: f })],     // lascia la sbarra
  [1.5, () => pullPose(0, { drop: 0.4, hands: 1 })],
];

const reps = r => r.reps ? r.reps.map(x => x.verdict) : r.verdict === 'unclear' ? [] : [r.verdict];
const cases = [
  ['dip: 3 ripetizioni', clip([...dipRep, ...dipRep, ...dipRep]), analyzeDip, 3],
  ['dip: 3 + piedi a terra e si piega', clip([...dipRep, ...dipRep, ...dipRep, ...dipEnd3]), analyzeDip, 3],
  ['dip: 3 + scende e resta giù', clip([...dipRep, ...dipRep, ...dipRep, ...dipEnd2]), analyzeDip, 3],
  ['trazioni: 3 ripetizioni', clip([...pullRep, ...pullRep, ...pullRep, [0.5, () => pullPose(0)]]), analyzePullup, 3],
  ['trazioni: 3 + scende dalla sbarra', clip([...pullRep, ...pullRep, ...pullRep, [0.5, () => pullPose(0)], ...pullEnd]), analyzePullup, 3],
];

// video vero (solo lo scheletro): 3 dip, poi piedi a terra e si piega a sganciare il disco
import { readFileSync } from 'fs';
const real = JSON.parse(readFileSync(new URL('./fixtures/dip-fine-serie.json', import.meta.url)));
const realFrames = real.frames.map(f => ({ t: f.t, lm: f.lm && f.lm.map(([x, y, v]) => ({ x, y, visibility: v })) }));
cases.push(['dip vero di Manuel: 3 + fine serie', realFrames, (fr) => analyzeDip(fr, real.vw, real.vh), 3]);

let failed = 0;
for (const [name, frames, fn, want] of cases) {
  const r = fn(frames, W, H);
  const v = reps(r);
  const ok = v.length === want && v.every(x => x === 'good');
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(36)} → ${v.length} ripetizioni: ${v.join(' ') || r.warnings[0]}`);
  if (!ok && r.reps) r.reps.forEach(x => console.log('       ', x.n, x.verdict, x.reason || ''));
}
console.log(failed ? `\n${failed} test falliti` : '\nTutti i test passati');
process.exit(failed ? 1 : 0);
