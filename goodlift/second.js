// ¿oodLift — "secondo occhio": un altro modello di posa, per quando MediaPipe sbaglia.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
//
// MediaPipe trova la persona partendo da faccia e busto: se sono coperti (squat con i dischi
// davanti al busto) sbaglia anca e ginocchio a caso. Qui si usano due modelli piccoli che
// lavorano in un altro modo: YOLOX-nano trova le persone (riquadri), RTMPose-s trova le
// articolazioni una per una dentro il riquadro, e regge bene le parti coperte.
// Tutto gira nel telefono (onnxruntime-web, WebAssembly). I punti escono nello stesso formato
// di MediaPipe (33 punti, coordinate 0–1), così il resto dell'app non cambia.
// Modelli: RTMPose e YOLOX di OpenMMLab (Apache-2.0).

const base = new URL('.', import.meta.url).href;
let ready = null;

// COCO (17 punti) → indici MediaPipe
const COCO_TO_MP = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

async function modelBytes(name) {
  const url = base + 'models/' + name;
  try {
    const cache = await caches.open('goodlift-models-v1');
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error(url);
      await cache.put(url, res.clone());
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export function loadSecondEye() {
  return (ready ??= (async () => {
    const ort = await import('./vendor/onnxruntime/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = base + 'vendor/onnxruntime/';
    ort.env.wasm.numThreads = (self.crossOriginIsolated && navigator.hardwareConcurrency > 1) ? Math.min(4, navigator.hardwareConcurrency) : 1;
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const [det, pose] = await Promise.all([
      modelBytes('yolox-nano.onnx').then(b => ort.InferenceSession.create(b, opts)),
      modelBytes('rtmpose-s.onnx').then(b => ort.InferenceSession.create(b, opts)),
    ]);
    return { ort, det, pose };
  })().catch(e => { ready = null; throw e; }));
}

let cv = null;
function canvas(w, h) {
  cv ??= document.createElement('canvas');
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return cv.getContext('2d', { willReadFrequently: true });
}

// Persone nel fotogramma: riquadri in pixel del video, i più sicuri per primi.
async function findPeople(m, src, vw, vh) {
  const S = 416, s = S / Math.max(vw, vh);
  const ctx = canvas(S, S);
  ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, S, S);
  ctx.drawImage(src, 0, 0, vw, vh, 0, 0, Math.round(vw * s), Math.round(vh * s));
  const d = ctx.getImageData(0, 0, S, S).data, n = S * S, x = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { x[i] = d[j + 2]; x[n + i] = d[j + 1]; x[2 * n + i] = d[j]; } // BGR
  const out = await m.det.run({ input: new m.ort.Tensor('float32', x, [1, 3, S, S]) });
  const dets = out.dets.data, labels = out.labels.data, boxes = [];
  for (let i = 0; i < labels.length; i++) {
    const sc = dets[i * 5 + 4];
    if (Number(labels[i]) !== 0 || sc < 0.1) continue;
    boxes.push({ x0: dets[i * 5] / s, y0: dets[i * 5 + 1] / s, x1: dets[i * 5 + 2] / s, y1: dets[i * 5 + 3] / s, score: sc });
  }
  return boxes.sort((a, b) => b.score * (b.x1 - b.x0) * (b.y1 - b.y0) - a.score * (a.x1 - a.x0) * (a.y1 - a.y0));
}

const MEAN = [123.675, 116.28, 103.53], STD = [58.395, 57.12, 57.375];
async function posePerson(m, src, vw, vh, b) {
  const W = 192, H = 256;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let bw = (b.x1 - b.x0) * 1.25, bh = (b.y1 - b.y0) * 1.25;
  if (bw / bh > W / H) bh = bw * H / W; else bw = bh * W / H;
  const sc = bw / W;
  const ctx = canvas(W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, cx - bw / 2, cy - bh / 2, bw, bh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data, n = W * H, x = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) for (let c = 0; c < 3; c++) x[c * n + i] = (d[j + c] - MEAN[c]) / STD[c];
  const out = await m.pose.run({ input: new m.ort.Tensor('float32', x, [1, 3, H, W]) });
  const sx = out.simcc_x.data, sy = out.simcc_y.data, K = 17, LX = sx.length / K, LY = sy.length / K;
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (let k = 0; k < K; k++) {
    let bx = 0, mx = -Infinity, by = 0, my = -Infinity;
    for (let i = 0; i < LX; i++) { const v = sx[k * LX + i]; if (v > mx) { mx = v; bx = i; } }
    for (let i = 0; i < LY; i++) { const v = sy[k * LY + i]; if (v > my) { my = v; by = i; } }
    const px = (bx / 2 - W / 2) * sc + cx, py = (by / 2 - H / 2) * sc + cy;
    // la fiducia di RTMPose è più bassa di quella di MediaPipe a parità di sicurezza
    lm[COCO_TO_MP[k]] = { x: px / vw, y: py / vh, visibility: Math.max(0, Math.min(1, Math.min(mx, my) * 1.4)) };
  }
  return lm;
}

// Il detector serve solo ogni tanto: tra un fotogramma e l'altro la persona si sposta poco, quindi
// il riquadro si ricava dai punti trovati al fotogramma prima (più veloce). Se il detector perde
// la persona per un attimo (dischi davanti, mosso), si tiene il riquadro di prima.
let prevBoxes = [], sinceDet = 0;
export const stats = { det: 0, pose: 0, n: 0, people: 0 }; // tempi (per ?debug)
export function resetSecondEye() { prevBoxes = []; sinceDet = 0; }
const DET_EVERY = 3;
function boxOf(lm, vw, vh) {
  const pts = lm.filter(p => p.visibility > 0.3);
  if (pts.length < 6) return null;
  const xs = pts.map(p => p.x * vw), ys = pts.map(p => p.y * vh);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const m = 0.12 * Math.max(x1 - x0, y1 - y0);
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

// Fino a `max` persone nel fotogramma, nel formato di MediaPipe ([lm, …]).
export async function secondEye(src, vw, vh, max = 3) {
  const m = await loadSecondEye();
  let boxes = prevBoxes;
  if (!boxes.length || ++sinceDet >= DET_EVERY) {
    const T = performance.now();
    const found = await findPeople(m, src, vw, vh);
    stats.det += performance.now() - T;
    const sure = found.filter(b => b.score >= 0.3);
    // persone sicure; se non ce ne sono, i riquadri di prima (o i meno sicuri)
    boxes = (sure.length ? sure : prevBoxes.length ? prevBoxes : found).slice(0, max);
    sinceDet = 0;
  }
  const poses = [];
  const T2 = performance.now();
  for (const b of boxes) poses.push(await posePerson(m, src, vw, vh, b));
  stats.pose += performance.now() - T2; stats.n++; stats.people += boxes.length;
  prevBoxes = poses.map((lm, i) => boxOf(lm, vw, vh) || boxes[i]);
  return poses;
}
