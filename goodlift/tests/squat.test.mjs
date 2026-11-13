// Test del giudice dello squat su ripetizioni sintetiche (vista laterale).
// Esegui con:  node goodlift/tests/squat.test.mjs
import { analyzeSquat, SQUAT } from '../engine.js';

const W = 1000, H = 1000, FPS = 20;

// s = 0 in piedi, 1 in buca. depthDeg = angolo del femore in buca (+ = anca sotto il ginocchio).
function pose(s, depthDeg, shiftX = 0, noise = 0) {
  const r = () => (Math.random() - 0.5) * 2 * noise;
  const ankle = { x: 0.5 + shiftX, y: 0.9 };
  const shin = 0.2, thigh = 0.2, torso = 0.3;
  const ts = (35 * s) * Math.PI / 180;
  const phi = (-90 + (depthDeg + 90) * s) * Math.PI / 180;
  const alpha = (40 * s) * Math.PI / 180;
  const knee = { x: ankle.x + shin * Math.sin(ts), y: ankle.y - shin * Math.cos(ts) };
  const hip = { x: knee.x - thigh * Math.cos(phi), y: knee.y + thigh * Math.sin(phi) };
  const sh = { x: hip.x + torso * Math.sin(alpha), y: hip.y - torso * Math.cos(alpha) };
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
  const put = (ids, p) => ids.forEach(id => { lm[id] = { x: p.x + r(), y: p.y + r(), visibility: 0.95 }; });
  put([11, 12], sh); put([13, 14], { x: sh.x + 0.05, y: sh.y + 0.05 }); put([15, 16], { x: sh.x + 0.02, y: sh.y });
  put([23, 24], hip); put([25, 26], knee); put([27, 28], ankle);
  lm[12].x += 0.01; // spalle quasi sovrapposte (vista di profilo)
  return lm;
}

const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x)));

// segmenti: [{dur, s0, s1, shift0?, shift1?}]
function clip(segments, depthDeg, noise = 0.0015) {
  const frames = [];
  let t0 = 0;
  for (const seg of segments) {
    const n = Math.round(seg.dur * FPS);
    for (let i = 0; i < n; i++) {
      const f = ease(i / n);
      const s = seg.s0 + (seg.s1 - seg.s0) * f;
      const sx = (seg.x0 ?? 0) + ((seg.x1 ?? 0) - (seg.x0 ?? 0)) * f;
      frames.push({ t: t0 + i / FPS, lm: pose(s, seg.d ?? depthDeg, sx, noise) });
    }
    t0 += n / FPS;
  }
  return frames;
}

const hold = d => ({ dur: d, s0: 0, s1: 0 });
const down = { dur: 1.2, s0: 0, s1: 1 };
const up = { dur: 1.4, s0: 1, s1: 0 };

const cases = [
  ['valido con fermi', clip([hold(1.4), down, up, hold(1.4)], 6), r => r.verdict === 'good' && r.checks.every(c => c.status === 'pass')],
  ['squat alto', clip([hold(1.4), down, up, hold(1.4)], SQUAT.depthMinDeg - 8), r => r.verdict === 'norep' && st(r, 'depth') === 'fail' && !r.close],
  ['no rep per poco', clip([hold(1.4), down, up, hold(1.4)], SQUAT.depthMinDeg - 1.5), r => r.verdict === 'norep' && r.close === true && !r.borderline],
  ['al limite', clip([hold(1.4), down, up, hold(1.4)], SQUAT.depthMinDeg + 1.5), r => r.verdict === 'good' && r.borderline && !r.close && r.warnings.some(w => w.includes('limite'))],
  ['cedimento in salita', clip([hold(1.4), down, { dur: 0.6, s0: 1, s1: 0.55 }, { dur: 0.35, s0: 0.55, s1: 0.75 }, { dur: 0.8, s0: 0.75, s1: 0 }, hold(1.4)], 6), r => r.verdict === 'norep' && st(r, 'noDrop') === 'fail'],
  // start e rack non si giudicano più: niente fermi richiesti
  ['senza fermo iniziale', clip([{ dur: 0.7, s0: 0, s1: 0.2 }, { dur: 0.5, s0: 0.2, s1: 0 }, hold(0.35), down, up, hold(1.4)], 6), r => r.verdict === 'good' && !r.checks.some(c => /Hold/.test(c.id))],
  ['video senza fermi (tagliato)', clip([{ dur: 0.15, s0: 0, s1: 0 }, down, up, { dur: 0.1, s0: 0, s1: 0 }], 6), r => r.verdict === 'good' && st(r, 'lockout') === 'pass'],
  ['se ne va dopo mezzo secondo', clip([hold(1.4), down, up, hold(0.35), { dur: 0.8, s0: 0, s1: 0, x0: 0, x1: 0.15 }], 6), r => r.verdict === 'good' && !r.reps],
  ['persona non vista a inizio/fine', blank(clip([hold(0.5), down, up, hold(0.4), hold(1)], 6), f => f.t < 0.3 || f.t > 3.4), r => r.verdict === 'good' && st(r, 'lockout') === 'pass'],
  ['buca coperta', hideLower(clip([hold(1.4), down, up, hold(1.4)], 6), f => f.t > 2.4 && f.t < 2.85), r => r.verdict === 'good'],
  ['buca coperta, squat alto', hideLower(clip([hold(1.4), down, up, hold(1.4)], SQUAT.depthMinDeg - 12), f => f.t > 2.4 && f.t < 2.85), r => r.verdict === 'norep' && st(r, 'depth') === 'fail'],
  ['3 ripetizioni, la seconda alta', clip([hold(1.4), down, up, hold(0.3), { ...down, d: SQUAT.depthMinDeg - 12 }, { ...up, d: SQUAT.depthMinDeg - 12 }, hold(0.3), down, up, hold(1.4)], 6),
    r => r.verdict === 'norep' && r.reps?.length === 3 && r.reps.map(x => x.verdict).join() === 'good,norep,good' && r.summary === '2 valide su 3'],
  ['5 ripetizioni, poi esce dall\'inquadratura', ghostTail(clip([hold(1.4), down, up, hold(0.3), down, up, hold(0.3), down, up, hold(0.3), down, up, hold(0.3), down, up, hold(1.4)], 6)),
    r => r.reps?.length === 5 && r.verdict === 'good'],
  // fine serie: rimette il bilanciere e si riposa piegato, mani sulle ginocchia → non è una ripetizione
  ['2 ripetizioni, poi si riposa piegato', rest(clip([hold(1.4), down, up, hold(0.3), down, up, hold(1)], 6), 4.5), r => r.reps?.length === 2 && r.verdict === 'good'],
  ['niente squat', clip([hold(3)], 6), r => r.verdict === 'unclear'],
];

// dopo l'alzata: qualche fotogramma vuoto e poi un "fantasma" (rilevamento sbagliato, più in basso e a gambe dritte)
function ghostTail(frames) {
  const t0 = frames[frames.length - 1].t;
  const out = frames.slice();
  for (let i = 1; i <= 40; i++) {
    const t = t0 + i / FPS;
    out.push(i < 10 ? { t, lm: null } : { t, lm: pose(0, 6, 0.3).map(p => ({ ...p, y: p.y + 0.12 })) });
  }
  return out;
}
// riposo: si piega come in uno squat ma senza bilanciere, con le mani giù sulle ginocchia
function rest(frames, dur) {
  const t0 = frames[frames.length - 1].t, out = frames.slice(), n = Math.round(dur * FPS);
  for (let i = 1; i <= n; i++) {
    const s = Math.sin(Math.PI * i / n) * 0.9;
    const lm = pose(s, 6);
    for (const id of [15, 16]) lm[id] = { ...lm[25], visibility: 0.95 };
    for (const id of [13, 14]) lm[id] = { x: (lm[11].x + lm[25].x) / 2, y: (lm[11].y + lm[25].y) / 2, visibility: 0.95 };
    out.push({ t: t0 + i / FPS, lm });
  }
  return out;
}
function blank(frames, cond) { return frames.map(f => cond(f) ? { t: f.t, lm: null } : f); }
function hideLower(frames, cond) {
  return frames.map(f => cond(f) ? { t: f.t, lm: f.lm.map((p, i) => [23, 24, 25, 26].includes(i) ? { ...p, visibility: 0.05 } : p) } : f);
}
function st(r, id) { return r.checks.find(c => c.id === id)?.status; }

let failed = 0;
for (const [name, frames, ok] of cases) {
  const r = analyzeSquat(frames, W, H);
  const pass = ok(r);
  if (!pass) failed++;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(30)} → ${r.verdict.toUpperCase()}  ${r.checks.map(c => `${c.id}:${c.status}`).join(' ')}${r.warnings.length ? '  | ' + r.warnings.join(' / ') : ''}`);
  if (!pass) for (const c of r.checks) console.log('       ', c.id, c.status, c.detail);
}
console.log(failed ? `\n${failed} test falliti` : '\nTutti i test passati');
process.exit(failed ? 1 : 0);
