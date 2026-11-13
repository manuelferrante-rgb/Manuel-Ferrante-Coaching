// ¿oodLift — interfaccia.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
import { FilesetResolver, PoseLandmarker } from './vendor/mediapipe/vision_bundle.js';
import { LIFTS, LM, SQUAT } from './engine.js';
import { pickPerson } from './core.js';
import { trackPlate } from './plates.js';

const $ = id => document.getElementById(id);
const GOLD = '#c9a35a', RED = '#e5484d', WHITE = '#f5f5f0';
const MAX_SECONDS = 45;
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];

// Safari < 16 non ha roundRect: ripiego su un rettangolo semplice.
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };

const state = { lift: 'squat', vision: null, models: {}, live: null, result: null, urls: [], facing: 'environment' };
// Con ?debug nell'indirizzo i dati dell'analisi restano accessibili dalla console (utile per chi contribuisce).
if (new URLSearchParams(location.search).has('debug')) window.__goodlift = state;

// ── navigazione ─────────────────────────────────
function show(screen) {
  if (document.body.dataset.screen === 'home' && screen !== 'home') history.pushState({ screen }, '', '#' + screen);
  document.body.dataset.screen = screen;
  window.scrollTo(0, 0);
}
function goHome() {
  stopLive();
  for (const id of ['scan-video', 'replay-video']) { const v = $(id); v.pause(); v.removeAttribute('src'); v.load(); }
  state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = [];
  state.result = null;
  $('save-video').hidden = true;
  document.body.dataset.screen = 'home';
  if (location.hash) history.replaceState(null, '', location.pathname);
}
document.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', () => history.state ? history.back() : goHome()));
window.addEventListener('popstate', goHome);

// ── scelta dell'alzata ──────────────────────────
function renderLifts() {
  $('lifts').innerHTML = Object.entries(LIFTS).map(([id, l]) =>
    `<button class="lift" data-lift="${id}" aria-pressed="${id === state.lift}" ${l.ready ? '' : 'disabled'}>${l.name}${l.ready ? '' : ' <small>presto</small>'}</button>`).join('');
  $('lifts').querySelectorAll('.lift:not(:disabled)').forEach(b => b.addEventListener('click', () => { state.lift = b.dataset.lift; renderLifts(); }));
}
renderLifts();

// ── modelli MediaPipe (caricati solo quando servono) ──
const QS = new URLSearchParams(location.search);
const MODEL_OVERRIDE = QS.get('model');        // es. ?model=lite per i test
const DELEGATE_OVERRIDE = QS.get('delegate');  // es. ?delegate=CPU
// Il modello si salva nel telefono la prima volta: dalle volte dopo parte subito, anche offline.
const modelUrl = kind => new URL(`models/pose_landmarker_${kind}.task`, import.meta.url).href;
async function modelBuffer(kind) {
  try {
    const cache = await caches.open('goodlift-models-v1');
    let res = await cache.match(modelUrl(kind));
    if (!res) {
      res = await fetch(modelUrl(kind));
      if (!res.ok) return null;
      await cache.put(modelUrl(kind), res.clone());
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; } // niente Cache API (es. navigazione privata): si scarica normalmente
}
const loading = {};
async function getModel(kind) {
  if (kind === 'heavy' && MODEL_OVERRIDE) kind = MODEL_OVERRIDE;
  if (state.models[kind]) return state.models[kind];
  return (loading[kind] ??= createModel(kind).finally(() => { delete loading[kind]; }));
}
async function createModel(kind) {
  state.vision ??= await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, ''));
  const buf = await modelBuffer(kind);
  const opts = delegate => ({
    baseOptions: buf ? { modelAssetBuffer: buf, delegate } : { modelAssetPath: modelUrl(kind), delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  let model;
  if (DELEGATE_OVERRIDE) model = await PoseLandmarker.createFromOptions(state.vision, opts(DELEGATE_OVERRIDE));
  else try { model = await PoseLandmarker.createFromOptions(state.vision, opts('GPU')); }
  catch { model = await PoseLandmarker.createFromOptions(state.vision, opts('CPU')); }
  model.__numPoses = 1;
  return (state.models[kind] = model);
}
let lastTs = 0;
const nextTs = () => (lastTs = Math.max(lastTs + 1, Math.round(performance.now())));
const toPoses = res => (res?.landmarks ?? []).map(lm => lm.map(p => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })));

// ── disegno ─────────────────────────────────────
function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { ctx: canvas.getContext('2d'), w, h, dpr };
}
function setAspect(stage, video) {
  if (video.videoWidth && video.videoHeight) stage.style.setProperty('--ar', video.videoWidth / video.videoHeight);
}
function sideOf(lm) {
  const v = ids => ids.reduce((a, i) => a + (lm[i]?.visibility ?? 0), 0);
  return v([11, 23, 25, 27]) >= v([12, 24, 26, 28]) ? { S: 11, H: 23, K: 25, A: 27 } : { S: 12, H: 24, K: 26, A: 28 };
}
function angle(a, b, c, w, h) {
  const v1x = (a.x - b.x) * w, v1y = (a.y - b.y) * h, v2x = (c.x - b.x) * w, v2y = (c.y - b.y) * h;
  return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y))))) * 180 / Math.PI;
}
function drawSkeleton(ctx, lm, w, h, { color = GOLD, width = 2.5, glow = 0, alpha = 1, dpr = 1 } = {}) {
  if (!lm) return;
  ctx.save();
  ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.lineCap = 'round';
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow * dpr; }
  ctx.beginPath();
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
    ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = WHITE;
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if ((lm[i].visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(lm[i].x * w, lm[i].y * h, 3.2 * dpr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function tag(ctx, text, x, y, dpr, color = GOLD, bg = 'rgba(13,13,13,.78)') {
  ctx.save();
  ctx.font = `${11 * dpr}px "DM Mono", monospace`;
  const pad = 6 * dpr, tw = ctx.measureText(text).width;
  ctx.fillStyle = bg; ctx.strokeStyle = color; ctx.lineWidth = 1 * dpr;
  ctx.beginPath(); ctx.roundRect(x, y - 10 * dpr, tw + pad * 2, 20 * dpr, 5 * dpr); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, x + pad, y);
  ctx.restore();
}
function corners(ctx, w, h, dpr) {
  const m = 14 * dpr, l = 26 * dpr;
  ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2 * dpr; ctx.globalAlpha = .8;
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
    ctx.moveTo(x, y + l * sy); ctx.lineTo(x, y); ctx.lineTo(x + l * sx, y);
  }
  ctx.stroke(); ctx.restore();
}

// Effetto "scan raggi X": griglia, linea di scansione, scheletro luminoso e angoli.
function drawScan(canvas, lm) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.save(); ctx.strokeStyle = 'rgba(201,163,90,.07)'; ctx.lineWidth = 1;
  const step = w / 10;
  for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.restore();
  const y = ((performance.now() / 1700) % 1) * h;
  const g = ctx.createLinearGradient(0, y - 90 * dpr, 0, y);
  g.addColorStop(0, 'rgba(201,163,90,0)'); g.addColorStop(1, 'rgba(201,163,90,.22)');
  ctx.fillStyle = g; ctx.fillRect(0, y - 90 * dpr, w, 90 * dpr);
  ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2 * dpr; ctx.shadowColor = GOLD; ctx.shadowBlur = 14 * dpr;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.restore();
  corners(ctx, w, h, dpr);
  if (lm) {
    drawSkeleton(ctx, lm, w, h, { glow: 16, width: 2.6, dpr });
    // gli angoli che contano per l'alzata scelta
    const left = (lm[11].visibility ?? 0) + (lm[23].visibility ?? 0) >= (lm[12].visibility ?? 0) + (lm[24].visibility ?? 0);
    const id = left ? { S: 11, E: 13, W: 15, H: 23, K: 25, A: 27 } : { S: 12, E: 14, W: 16, H: 24, K: 26, A: 28 };
    const vw = $('scan-video').videoWidth || w, vh = $('scan-video').videoHeight || h;
    const ang = (a, b, c) => angle(lm[id[a]], lm[id[b]], lm[id[c]], vw, vh);
    const TAGS = {
      squat: [['KNEE', 'H', 'K', 'A'], ['HIP', 'S', 'H', 'K']],
      stacco: [['HIP', 'S', 'H', 'K'], ['KNEE', 'H', 'K', 'A']],
      panca: [['ELBOW', 'S', 'E', 'W']],
      trazioni: [['ELBOW', 'S', 'E', 'W'], ['KNEE', 'H', 'K', 'A']],
      dip: [['ELBOW', 'S', 'E', 'W']],
      muscleup: [['KNEE', 'H', 'K', 'A'], ['ELBOW', 'S', 'E', 'W']],
    }[state.lift] || [];
    // stacco: la spalla deve finire dietro il bilanciere (linea verticale del bilanciere = le mani)
    if (state.lift === 'stacco' && (lm[id.S].visibility ?? 0) > 0.4 && (lm[id.W].visibility ?? 0) > 0.4) {
      const bx = lm[id.W].x * w;
      ctx.save(); ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.strokeStyle = 'rgba(245,245,240,.6)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, h); ctx.stroke(); ctx.restore();
      tag(ctx, 'SHOULDER', lm[id.S].x * w + 12 * dpr, lm[id.S].y * h, dpr);
    }
    for (const [name, a, b, c] of TAGS) {
      const v = ang(a, b, c), p = lm[id[b]];
      if (Number.isFinite(v) && (p.visibility ?? 1) > 0.4) tag(ctx, `${name} ${Math.round(v)}°`, p.x * w + 12 * dpr, p.y * h, dpr);
    }
    // trazioni: il mento (sotto la bocca)
    if (state.lift === 'trazioni' && (lm[0].visibility ?? 0) > 0.5) {
      const m = lm[left ? 9 : 10], n = lm[0];
      const cy = m.y + Math.max(0, m.y - n.y);
      ctx.save(); ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(m.x * w, cy * h, 4 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      tag(ctx, 'CHIN', m.x * w + 12 * dpr, cy * h, dpr);
    }
  }
}

// ── analisi di un video (caricato o registrato) ──
// Dove si muove l'atleta: il punto che fa l'alzata (anca nello squat, bilanciere in panca e stacco,
// spalle a corpo libero). Serve a saltare i tempi morti prima e dopo.
const MOVER = { squat: [23, 24], panca: [15, 16], stacco: [15, 16], trazioni: [11, 12], dip: [11, 12], muscleup: [11, 12] };
function activeWindow(track, lift, total) {
  const ids = MOVER[lift] || [23, 24];
  const pts = track.filter(f => f.lm).map(f => ({ t: f.t, y: (f.lm[ids[0]].y + f.lm[ids[1]].y) / 2 }));
  if (pts.length < 6) return [0, total];
  const ys = pts.map(p => p.y).sort((a, b) => a - b);
  const rest = ys[ys.length >> 1];
  const amp = Math.max(...pts.map(p => Math.abs(p.y - rest)));
  if (amp < 0.05) return [0, total]; // nessun movimento chiaro: si analizza tutto
  const act = pts.filter(p => Math.abs(p.y - rest) > 0.35 * amp);
  // margine: 2 s prima e dopo, per vedere i fermi (1 s) con un po' di respiro
  return [Math.max(0, act[0].t - 2.2), Math.min(total, act[act.length - 1].t + 2.2)];
}

async function analyzeVideo(url, { recordedSec = null, blob = null, track = null } = {}) {
  show('scan');
  $('scan-error').textContent = '';
  const setPct = p => { $('scan-bar').style.width = p + '%'; $('scan-pct').textContent = Math.round(p) + '%'; };
  setPct(0);
  $('scan-label').textContent = 'Analisi in corso…';
  const video = $('scan-video'), canvas = $('scan-canvas');
  // l'effetto scansione parte subito, prima ancora che il video sia pronto
  let lastLm = null, raf = 0, alive = true;
  const anim = () => { if (!alive) return; drawScan(canvas, lastLm); raf = requestAnimationFrame(anim); };
  anim();
  const stop = msg => { alive = false; cancelAnimationFrame(raf); $('scan-error').textContent = msg; };

  // modello e video si preparano insieme
  const modelP = getModel('heavy').then(async m => {
    // In panca c'è quasi sempre uno spotter in piedi: si cercano più persone e si sceglie quella sdraiata.
    // Nelle altre alzate una sola: il modello la segue meglio da un fotogramma all'altro.
    const want = state.lift === 'panca' ? 3 : 1;
    if (m.__numPoses !== want) { await m.setOptions({ numPoses: want }); m.__numPoses = want; }
    return m;
  });
  modelP.catch(() => {});
  try { await loadVideo(video, url); }
  catch (e) { console.error(e); return stop('Questo video non si apre in questo browser. Prova con un video .mp4, oppure registrati direttamente dall\'app.'); }
  setAspect($('scan-stage'), video);
  const vw = video.videoWidth, vh = video.videoHeight;
  const total = Math.min(MAX_SECONDS, await videoDuration(video, recordedSec));

  // Dove sta l'alzata: se ti sei registrato dall'app lo sappiamo già dalla diretta.
  const win = track?.length > 10 ? activeWindow(track, state.lift, total) : [0, total];

  let model;
  try { model = await modelP; }
  catch (e) { console.error(e); return stop('Non riesco a caricare il giudice. Controlla la connessione e riprova.'); }

  // Un solo giro sul video. Il video scorre (molto più veloce che saltare da un fotogramma
  // all'altro, soprattutto su iPhone) e la velocità si adatta: veloce quando sei fermo o non
  // c'è nessuno, più lento quando ti muovi, così l'alzata ha sempre ~12 fotogrammi al secondo.
  const onPose = (t, poses) => {
    const lm = pickPerson([{ t: 0, poses }], state.lift, vw, vh)[0].lm;
    if (lm) lastLm = lm;
    setPct(100 * Math.min(1, (t - win[0]) / Math.max(0.01, win[1] - win[0])));
    return lm;
  };
  const gone = () => document.body.dataset.screen !== 'scan';
  let frames = await samplePlaying(video, model, win[0], win[1], onPose, gone);
  if (frames === null) frames = await sampleSeeking(video, model, win[0], win[1], total, onPose, gone); // senza riproduzione: a salti
  if (!frames) { alive = false; return; } // l'utente è tornato indietro
  alive = false; cancelAnimationFrame(raf);
  const raw = frames.filter((f, i) => i === 0 || f.t > frames[i - 1].t + 1e-4);
  const clean = pickPerson(raw, state.lift, vw, vh);
  state.raw = raw; // per ?debug
  const result = LIFTS[state.lift].analyze(clean, vw, vh);
  try { attachPlate(result, raw, vw, vh); } catch (e) { console.warn(e); }
  for (const f of raw) delete f.gray; // memoria: le immagini non servono più
  if (total >= MAX_SECONDS) result.warnings.unshift(`Ho analizzato solo i primi ${MAX_SECONDS} secondi: per i prossimi video taglia il pezzo con l'alzata.`);
  // replay: dall'inizio della prima ripetizione a poco dopo la fine dell'ultima
  const keys = (result.reps || (result.key ? [{ key: result.key }] : [])).map(r => r.key);
  result.trim = keys.length
    ? [Math.max(0, Math.min(...keys.map(k => k.start)) - 0.5), Math.min(total, Math.max(...keys.map(k => k.end ?? k.focus)) + 1.6)]
    : [win[0], win[1]];
  showResult(result, clean, url, blob);
}

const STEP = 1 / 12; // un fotogramma analizzato ogni 1/12 di secondo di video

// Copia in piccolo e in scala di grigi del fotogramma: serve a trovare il disco nell'immagine.
const GRAY_W = 180;
let grayCanvas = null;
function grabGray(video) {
  try {
    const gh = Math.round(GRAY_W * video.videoHeight / video.videoWidth);
    grayCanvas ??= document.createElement('canvas');
    if (grayCanvas.width !== GRAY_W || grayCanvas.height !== gh) { grayCanvas.width = GRAY_W; grayCanvas.height = gh; }
    const ctx = grayCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, GRAY_W, gh);
    const d = ctx.getImageData(0, 0, GRAY_W, gh).data, g = new Uint8Array(GRAY_W * gh);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  } catch { return null; }
}

// La traiettoria va disegnata dove sta davvero il bilanciere (la punta, sul lato vicino al telefono)
// o il disco: lo si cerca nell'immagine come cerchio e lo si segue. Se non si trova (disco visto di
// taglio, ripresa frontale) resta la stima dalla posizione del corpo.
function attachPlate(result, raw, vw, vh) {
  const R = result.replay; if (!R?.path || !raw.some(f => f.gray)) return;
  const key = { squat: 'S', panca: 'W', stacco: 'W', trazioni: 'K', dip: 'K', muscleup: 'K' }[result.lift] || 'S';
  const sc = GRAY_W / vw, gh = Math.round(GRAY_W * vh / vw);
  const { H, A } = R.series;
  const lens = R.t.map((_, i) => H[i] && A[i] ? Math.hypot(H[i].x - A[i].x, H[i].y - A[i].y) * 1.9 : NaN).filter(Number.isFinite).sort((a, b) => a - b);
  const body = lens.length ? lens[lens.length >> 1] * sc : 0;
  const frames = raw.map((f, i) => {
    const p = R.series[key][i];
    return { gray: f.gray, seed: p ? { x: p.x * sc, y: p.y * sc } : null };
  });
  const found = trackPlate(frames, GRAY_W, gh, body);
  const n = found.filter(Boolean).length;
  state.plate = { frames: raw.length, gray: frames.filter(f => f.gray).length, seeds: frames.filter(f => f.seed).length, body, found: n }; // per ?debug
  if (n < 0.4 * raw.length) return;
  R.path = { ...R.path, a: null, pts: found.map(c => c && { x: c.x / sc, y: c.y / sc }) };
}

// Analisi mentre il video scorre. Restituisce null se il browser non lo permette.
async function samplePlaying(video, model, from, to, onPose, gone) {
  if (!('requestVideoFrameCallback' in video)) return null;
  await seekTo(video, from);
  return new Promise(resolve => {
    const frames = [];
    let lastT = -1, cost = 0.06, stillFor = 0, prev = null, done = false, rate = 1;
    const ids = MOVER[state.lift] || [23, 24];
    const finish = ok => { if (done) return; done = true; video.pause(); video.playbackRate = 1; resolve(ok ? frames : null); };
    const onFrame = (_, meta) => {
      if (done) return;
      if (gone()) { done = true; video.pause(); return resolve(false); }
      const t = meta?.mediaTime ?? video.currentTime;
      if (t >= to - 1e-3) return finish(true);
      if (t - lastT >= STEP * 0.75) {
        const c0 = performance.now();
        let poses = [];
        try { poses = toPoses(model.detectForVideo(video, nextTs())); } catch (e) { console.warn(e); }
        cost = 0.7 * cost + 0.3 * (performance.now() - c0) / 1000;
        frames.push({ t, poses, gray: grabGray(video) });
        const lm = onPose(t, poses);
        // fermo o assente → si va più veloce; in movimento → ~12 fotogrammi al secondo
        const y = lm ? (lm[ids[0]].y + lm[ids[1]].y) / 2 : null;
        const moving = y != null && prev != null && Math.abs(y - prev) / Math.max(1e-3, t - lastT) > 0.05;
        stillFor = moving ? 0 : stillFor + (t - lastT > 0 ? t - lastT : 0);
        prev = y; lastT = t;
        const base = Math.max(0.25, Math.min(2, 0.85 * STEP / cost));
        const want = stillFor > 0.6 ? Math.min(2, base * 2.5) : base;
        if (Math.abs(want - rate) / rate > 0.12) { rate = want; video.playbackRate = rate; }
      }
      video.requestVideoFrameCallback(onFrame);
    };
    video.onended = () => finish(true);
    video.requestVideoFrameCallback(onFrame);
    video.muted = true;
    video.play().catch(() => finish(false));
  });
}

// Analisi a salti (browser senza requestVideoFrameCallback): più lenta ma funziona ovunque.
async function sampleSeeking(video, model, from, to, total, onPose, gone) {
  const frames = [];
  for (let t = from; t <= to + 1e-6; t += STEP) {
    if (gone()) return false;
    await seekTo(video, Math.min(t, Math.max(0, total - 0.02)));
    let poses = [];
    try { poses = toPoses(model.detectForVideo(video, nextTs())); } catch (e) { console.warn(e); }
    frames.push({ t: video.currentTime, poses, gray: grabGray(video) });
    onPose(video.currentTime, poses);
  }
  return frames;
}

// Carica un video in modo che i fotogrammi siano leggibili. Su iPhone (Safari) il video non
// decodifica niente finché non parte la riproduzione: lo si avvia muto per un attimo e lo si ferma.
function waitFor(video, events, ms) {
  return new Promise((res, rej) => {
    const ok = () => { clean(); res(); };
    const ko = () => { clean(); rej(new Error('decode')); };
    const to = setTimeout(() => { clean(); rej(new Error('timeout')); }, ms);
    const clean = () => { clearTimeout(to); events.forEach(e => video.removeEventListener(e, ok)); video.removeEventListener('error', ko); };
    events.forEach(e => video.addEventListener(e, ok));
    video.addEventListener('error', ko);
  });
}
async function loadVideo(video, url) {
  video.muted = true; video.defaultMuted = true; video.playsInline = true;
  video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.src = url;
  video.load();
  if (video.readyState < 1) await waitFor(video, ['loadedmetadata'], 20000);
  if (video.readyState < 2) {
    const ready = waitFor(video, ['loadeddata', 'canplay', 'playing'], 15000);
    try { await video.play(); } catch { /* può fallire senza tocco: ci pensa il seek */ }
    if (video.readyState < 2) { video.currentTime = 0.001; }
    await ready.catch(() => { if (video.readyState < 2) throw new Error('nodata'); });
  }
  video.pause();
}

// I video registrati dal browser (webm) spesso non dichiarano la durata: la si ricava così.
async function videoDuration(video, fallback) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise(res => {
    const done = () => { video.removeEventListener('durationchange', done); res(); };
    video.addEventListener('durationchange', done);
    video.currentTime = 1e7;
    setTimeout(done, 3000);
  });
  const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : (fallback || 10);
  await seekTo(video, 0);
  return d;
}
function seekTo(video, t) {
  return new Promise(res => {
    let done = false;
    const finish = () => { if (done) return; done = true; video.removeEventListener('seeked', onSeeked); res(); };
    const onSeeked = () => {
      // aspetta che il fotogramma sia davvero pronto da leggere
      if ('requestVideoFrameCallback' in video) { video.requestVideoFrameCallback(() => finish()); setTimeout(finish, 40); }
      else finish();
    };
    video.addEventListener('seeked', onSeeked);
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) { finish(); return; }
    video.currentTime = t;
    setTimeout(finish, 2500);
  });
}

// ── risultato + replay ──────────────────────────
const TEXT = { good: 'GOOD LIFT', norep: 'NO REP', unclear: 'NON RIESCO A GIUDICARE' };
const ICON = { pass: '✓', fail: '✕', unknown: '–' };
function showResult(result, frames, url, blob) {
  state.result = { result, frames };
  show('result');
  const v = $('verdict');
  v.className = 'verdict ' + result.verdict;
  $('vtext').textContent = TEXT[result.verdict];
  const firstFail = result.checks.find(c => c.status === 'fail');
  const name = LIFTS[result.lift].name;
  if (result.reps) {
    const bad = result.reps.find(r => r.verdict === 'norep');
    $('vsub').textContent = `${result.reps.length} ripetizioni: ${result.summary}.` + (bad ? ` ${bad.n}º: ${bad.reason}` : '');
  } else {
    $('vsub').textContent = result.verdict === 'good' ? (result.borderline ? `${name}: alzata valida, ma al limite.` : `${name}: alzata valida.`) : result.verdict === 'norep' ? firstFail.detail : result.warnings[0];
  }
  $('vlimit').hidden = !(result.verdict === 'good' && result.borderline);
  $('vclose').hidden = !(result.verdict === 'norep' && result.close);
  $('vbadge').hidden = !(result.verdict === 'good' && result.missing);
  requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add('show')));

  // ripetizioni: un chip per ognuna, si tocca per vedere il dettaglio
  const reps = $('reps');
  reps.hidden = !result.reps;
  if (result.reps) {
    reps.innerHTML = `<p class="sum">${result.reps.length} ripetizioni · ${result.summary}</p>` + result.reps.map(r =>
      `<button class="rep ${r.verdict}" data-n="${r.n}" aria-label="${r.n}ª ripetizione: ${r.verdict === 'good' ? 'valida' : r.verdict === 'norep' ? 'no rep' : 'non giudicabile'}">${r.n}º</button>`).join('');
    reps.querySelectorAll('.rep').forEach(btn => btn.addEventListener('click', () => selectRep(+btn.dataset.n, true)));
  }
  const warns = result.verdict === 'unclear' ? result.warnings.slice(1) : result.warnings;
  $('warns').innerHTML = warns.map(w => `<li>${w}</li>`).join('');

  if (blob) {
    const a = $('save-video'); a.hidden = false; a.href = url;
    a.download = `goodlift-${result.lift}-${new Date().toISOString().slice(0, 10)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
  }
  $('rp-path').textContent = result.replay?.path?.label || 'Traiettoria';
  $('rp-path').hidden = !result.replay?.path;
  $('rp-path2').textContent = result.replay?.path2?.label || '';
  $('rp-path2').hidden = !result.replay?.path2;
  setupReplay(url, result, frames);
  selectRep(result.mainRep || 1, false);
}

function selectRep(n, seek) {
  const result = state.result?.result; if (!result) return;
  const rep = result.reps ? result.reps[n - 1] : null;
  const checks = rep ? rep.checks : result.checks;
  state.selRep = n;
  $('reps').querySelectorAll('.rep').forEach(b => b.classList.toggle('sel', +b.dataset.n === n));
  $('checks').innerHTML = checks.map((c, i) => `<li><button class="check ${c.status}${c.borderline ? ' limit' : ''}" data-i="${i}"><span class="ci">${ICON[c.status]}</span><span><b>${c.label}</b><span>${c.status === 'unknown' ? 'Non visibile: ' + c.detail : c.detail}</span></span></button></li>`).join('');
  $('checks').querySelectorAll('.check').forEach(b => b.addEventListener('click', () => {
    const c = checks[+b.dataset.i];
    if (c.t) seekReplay(Math.max(0, c.t[0] - 0.3), true);
  }));
  // consigli: cosa sistemare (no rep) o cosa migliorare (valida ma al limite)
  const verdict = rep ? rep.verdict : result.verdict;
  const tips = (rep ? rep.tips : result.tips) || [];
  $('tips').hidden = !tips.length || verdict === 'unclear';
  $('tips').classList.toggle('fix', verdict === 'norep');
  $('tips-title').textContent = verdict === 'norep' ? 'Come sistemarla' : 'Da migliorare';
  $('tips-list').innerHTML = tips.map(t => `<li>${t}</li>`).join('');
  if (seek && rep) seekReplay(Math.max(0, rep.key.start - 0.3), false);
}
const replay = { video: null, raf: 0, keyPaused: false, slow: false, path: null, range: [0, Infinity] };
function setPathButtons() {
  for (const [id, v] of [['rp-path', 'path'], ['rp-path2', 'path2']]) { $(id).classList.toggle('on', replay.path === v); $(id).setAttribute('aria-pressed', replay.path === v); }
}
function setupReplay(url, result, frames) {
  const video = $('replay-video'), canvas = $('replay-canvas');
  replay.video = video; replay.keyPaused = false;
  replay.range = result.trim || [0, Infinity];
  video.loop = false;
  loadVideo(video, url).then(() => {
    setAspect($('replay-stage'), video);
    video.currentTime = replay.range[0];
    video.playbackRate = replay.slow ? 0.5 : 1;
    video.play().catch(() => {});
  }).catch(e => console.error(e));
  $('rp-slow').classList.toggle('on', replay.slow); $('rp-slow').setAttribute('aria-pressed', replay.slow);
  setPathButtons();
  cancelAnimationFrame(replay.raf);
  const draw = () => {
    // si guarda solo l'alzata: niente tempi morti prima e dopo
    if (!video.paused && video.currentTime >= replay.range[1]) video.pause();
    drawReplay(canvas, video, result, frames);
    const ft = result.replay?.focusTs || [];
    const k = ft.find(f => f != null && video.currentTime >= f && video.currentTime - f < 0.2);
    if (k != null && replay.keyPaused !== k && !video.paused) {
      replay.keyPaused = k; video.pause();
      setTimeout(() => { if (document.body.dataset.screen === 'result' && replay.keyPaused === k) video.play().catch(() => {}); }, 900);
    }
    replay.raf = requestAnimationFrame(draw);
  };
  draw();
}
function seekReplay(t, pause) {
  const v = replay.video; if (!v) return;
  replay.keyPaused = t;
  v.currentTime = t;
  if (pause) v.pause(); else v.play().catch(() => {});
  $('replay-stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('rp-play').addEventListener('click', () => { const v = replay.video; if (!v) return; replay.keyPaused = false; v.currentTime = replay.range[0]; v.playbackRate = replay.slow ? 0.5 : 1; v.play().catch(() => {}); });
$('rp-slow').addEventListener('click', () => {
  replay.slow = !replay.slow; $('rp-slow').classList.toggle('on', replay.slow); $('rp-slow').setAttribute('aria-pressed', replay.slow);
  if (replay.video) replay.video.playbackRate = replay.slow ? 0.4 : 1;
});
// dischi o piedi (a corpo libero): uno solo alla volta
$('rp-path').addEventListener('click', () => { replay.path = replay.path === 'path' ? null : 'path'; setPathButtons(); });
$('rp-path2').addEventListener('click', () => { replay.path = replay.path === 'path2' ? null : 'path2'; setPathButtons(); });
$('rp-key').addEventListener('click', () => {
  const r = state.result?.result; if (!r) return;
  const rep = r.reps ? r.reps[(state.selRep || 1) - 1] : null;
  const k = rep ? rep.key.focus : r.key?.focus;
  if (k != null) seekReplay(k, true);
});

function nearest(ts, t) {
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; }
  return lo > 0 && Math.abs(ts[lo - 1] - t) < Math.abs(ts[lo] - t) ? lo - 1 : lo;
}
function drawReplay(canvas, video, result, frames) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const R = result.replay;
  if (!R || !frames.length || !video.videoWidth) return;
  const ts = R.t, series = R.series;
  const now = video.currentTime, i = nearest(ts, now);
  const sx = w / video.videoWidth, sy = h / video.videoHeight;
  const P = p => p && { x: p.x * sx, y: p.y * sy };
  const line = (a, b, color, width, dash) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.lineCap = 'round';
    if (dash) ctx.setLineDash([8 * dpr, 7 * dpr]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  };

  drawSkeleton(ctx, frames[i]?.lm, w, h, { color: WHITE, width: 1.6, alpha: .45, dpr });

  // traiettoria del bilanciere / dei dischi (pulsante): una ripetizione alla volta, poi si azzera.
  // Oro quando sale, bianco quando scende: si vedono bene fase eccentrica e concentrica.
  const PATH = replay.path && R[replay.path];
  if (PATH) {
    const pt = k => {
      if (PATH.pts) return P(PATH.pts[k]);
      const a = series[PATH.a][k]; if (!a) return null;
      const b = PATH.b ? series[PATH.b][k] : null;
      const f = PATH.f || 0;
      return P(b ? { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f } : a);
    };
    const keys = (result.reps || [{ key: result.key }]).map(r => r.key).filter(Boolean);
    let cur = -1;
    keys.forEach((k, n) => { if (now >= k.start - 0.3) cur = n; });
    if (cur >= 0) {
      const k = keys[cur];
      const k0 = nearest(ts, k.start), kEnd = nearest(ts, (k.end ?? ts[ts.length - 1]) + 0.4);
      const upto = Math.min(i, kEnd);
      // linea sottile e netta, come una penna (con un filo scuro sotto per vederla su ogni sfondo)
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let prev = null;
      for (let q = k0; q <= upto; q++) {
        const p = pt(q); if (!p) { prev = null; continue; }
        if (prev) {
          ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3.6 * dpr;
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.strokeStyle = p.y < prev.y ? GOLD : '#ffffff'; ctx.lineWidth = 1.8 * dpr;
          ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        prev = p;
      }
      ctx.restore();
      const c = pt(upto);
      if (c) { ctx.save(); ctx.fillStyle = GOLD; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(c.x, c.y, 4 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
    }
    if (PATH.bar) { const y = PATH.bar() * sy; line({ x: 0, y }, { x: w, y }, 'rgba(245,245,240,.6)', 1.5, true); }
  }

  // discesa del bilanciere (o del corpo) durante la salita
  const rep = result.reps ? result.reps[(state.selRep || 1) - 1] : null;
  const allChecks = result.reps ? result.reps.flatMap(r => r.checks) : result.checks;
  for (const c of allChecks) {
    if (c.id !== 'noDrop' || c.status !== 'fail' || now < c.t[0] || now > c.t[0] + 1.5) continue;
    const p = P(series[R.trail || 'H'][nearest(ts, c.t[0])]);
    if (!p) continue;
    ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(p.x, p.y, 16 * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    tag(ctx, R.dropText || 'SCENDE', p.x + 20 * dpr, p.y, dpr, RED);
  }

  // posizione chiave: segmento, linea di riferimento, etichetta
  const F = R.focus; if (!F) return;
  const near = (R.focusTs || []).some(f => f != null && Math.abs(now - f) < 0.45);
  const A = P(series[F.a]?.[i]), B = P(series[F.b]?.[i]);
  const lab = near && F.label ? F.label(i) : null;
  const col = lab?.[1] ? RED : GOLD;
  if (near) {
    if (F.ref) { const y = F.ref(i); if (y != null) line({ x: 0, y: y * sy }, { x: w, y: y * sy }, 'rgba(245,245,240,.75)', 1.5, true); }
    if (F.hline) { const y = F.hline() * sy; line({ x: 0, y }, { x: w, y }, 'rgba(245,245,240,.75)', 1.5, true); }
    if (F.vline) { const x = F.vline(i); if (x != null) line({ x: x * sx, y: 0 }, { x: x * sx, y: h }, 'rgba(245,245,240,.75)', 1.5, true); }
  }
  if (A && B && (near || result.lift === 'squat')) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 5 * dpr; ctx.lineCap = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 10 * dpr;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.restore();
  }
  if (near && F.point) { const p = F.point(i); if (p) { ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } }
  const pt0 = near && F.point ? F.point(i) : null;
  if (lab && (A || B || pt0)) {
    const ref = A && B ? { x: Math.min(A.x, B.x), y: Math.max(A.y, B.y) } : (A || B || { x: pt0.x * sx, y: pt0.y * sy });
    tag(ctx, lab[0], Math.max(8 * dpr, Math.min(ref.x, w - 200 * dpr)), Math.min(h - 20 * dpr, ref.y + 26 * dpr), dpr, col);
  }
}

// ── modalità live ───────────────────────────────
async function startLive() {
  if (document.body.dataset.screen !== 'live') show('live');
  $('live-stage').classList.toggle('mirror', state.facing === 'user');
  $('flip-label').textContent = state.facing === 'user' ? 'Posteriore' : 'Frontale';
  $('live-error').textContent = ''; $('live-msg').textContent = 'Accendo la fotocamera…';
  const video = $('live-video');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    console.error(e);
    $('live-msg').textContent = '';
    $('live-error').innerHTML = 'Non riesco ad accedere alla fotocamera. Consenti l\'accesso dalle impostazioni del browser, oppure torna indietro e <b>carica un video</b>.';
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  await new Promise(r => video.videoWidth ? r() : (video.onloadedmetadata = r));
  setAspect($('live-stage'), video);
  state.live = { stream, rec: null, chunks: [], startedAt: 0, timer: 0, step: 0, track: [] };
  $('live-msg').textContent = 'Carico il giudice…';
  let model;
  try { model = await getModel('lite'); } catch (e) { console.error(e); }
  $('live-msg').textContent = '';
  const canvas = $('live-canvas');
  let lastRun = 0;
  const loop = () => {
    if (!state.live || state.live.stream !== stream) return;
    const now = performance.now();
    if (model && video.readyState >= 2 && now - lastRun > 60) {
      lastRun = now;
      let lm = null;
      try { lm = pickPerson([{ t: 0, poses: toPoses(model.detectForVideo(video, nextTs())) }], state.lift, video.videoWidth, video.videoHeight)[0].lm; } catch { /* frame non pronto */ }
      const { ctx, w, h, dpr } = fitCanvas(canvas);
      ctx.clearRect(0, 0, w, h);
      corners(ctx, w, h, dpr);
      drawSkeleton(ctx, lm, w, h, { glow: 10, width: 2.4, dpr });
      $('live-msg').textContent = lm ? '' : 'Non ti vedo: mettiti di lato, con tutto il corpo nell\'inquadratura.';
      if (lm) voiceCoach(lm, video.videoWidth, video.videoHeight, now / 1000);
      // traccia della diretta: serve dopo a saltare i tempi morti senza rianalizzare tutto
      if (state.live.rec) state.live.track.push({ t: (now - state.live.startedAt) / 1000, lm });
    }
    requestAnimationFrame(loop);
  };
  loop();
}

// Comandi vocali (opzionali): come in gara, prima il fermo, poi il comando.
// Se in audio/ ci sono le registrazioni dei comandi (start.mp3, rack.mp3, …) si usano quelle:
// partono all'istante. Altrimenti si usa la voce sintetica del telefono.
const VOICE_FILES = ['start', 'rack', 'press', 'down']; // registrazioni in audio/ (voce di Manuel)
// I file si suonano con <audio> e non con Web Audio: su iPhone Web Audio resta muto quando il
// telefono è in silenzioso, mentre l'audio "da video" si sente sempre.
const voice = { els: {}, synth: null };
function pickSynthVoice() {
  const vs = window.speechSynthesis?.getVoices?.() || [];
  const pref = ['Daniel', 'Arthur', 'Aaron', 'Alex', 'Google UK English Male', 'Google US English'];
  return pref.map(n => vs.find(v => v.name.startsWith(n) && /^en/i.test(v.lang))).find(Boolean)
    || vs.find(v => /^en-(GB|US)/i.test(v.lang)) || null;
}
window.speechSynthesis?.addEventListener?.('voiceschanged', () => { voice.synth = pickSynthVoice(); });
// Da chiamare durante un tocco dell'utente: su iPhone l'audio si sblocca solo così.
function unlockVoice() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari vecchio */ }
  for (const k of VOICE_FILES) {
    let el = voice.els[k];
    if (!el) {
      el = new Audio(new URL(`audio/${k}.wav`, import.meta.url).href);
      el.preload = 'auto'; el.playsInline = true; el.setAttribute('playsinline', '');
      voice.els[k] = el;
    }
    // sblocco: parte in muto e si ferma subito, dentro il tocco
    el.muted = true;
    const p = el.play();
    if (p) p.then(() => { el.pause(); el.currentTime = 0; el.muted = false; }).catch(() => { el.muted = false; });
  }
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* niente sintesi */ }
  voice.synth ??= pickSynthVoice();
}
function speak(word) {
  try {
    const u = new SpeechSynthesisUtterance(word + '!');
    if (voice.synth) u.voice = voice.synth;
    u.lang = voice.synth?.lang || 'en-GB'; u.rate = 1.25; u.pitch = 0.9; u.volume = 1;
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* sintesi vocale non disponibile */ }
}
function say(word) {
  const el = voice.els[word.toLowerCase()];
  if (!el) return speak(word);
  try {
    el.muted = false; el.volume = 1; el.currentTime = 0;
    const p = el.play();
    if (p) p.catch(() => speak(word));
  } catch { speak(word); }
}
// Il comando arriva quando sei a gambe tese e fermo da COMMAND_HOLD secondi (il giudizio poi
// chiede 1 s di fermo prima della discesa: aspettando il comando ci si arriva sempre).
// Il comando arriva quando sei in posizione e fermo da COMMAND_HOLD secondi (il giudizio poi
// chiede 1 s di fermo: aspettando il comando ci si arriva sempre).
const COMMAND_HOLD = 0.7;
// Sequenza di ogni alzata: condizione da raggiungere, fermo richiesto, comando da dare.
const SEQ = {
  squat: [{ c: 'locked', hold: COMMAND_HOLD, say: 'Start' }, { c: 'down' }, { c: 'locked', hold: COMMAND_HOLD, say: 'Rack' }],
  panca: [{ c: 'locked', hold: COMMAND_HOLD, say: 'Start' }, { c: 'down' }, { c: 'chest', hold: COMMAND_HOLD, say: 'Press' }, { c: 'locked', hold: COMMAND_HOLD, say: 'Rack' }],
  stacco: [{ c: 'lifted' }, { c: 'locked', hold: COMMAND_HOLD, say: 'Down' }],
  trazioni: [{ c: 'hang', hold: COMMAND_HOLD, say: 'Start' }, { c: 'pulled' }, { c: 'hang', hold: 0.4, say: 'Down' }],
  dip: [{ c: 'locked', hold: COMMAND_HOLD, say: 'Start' }, { c: 'down' }, { c: 'locked', hold: COMMAND_HOLD, say: 'Down' }],
  muscleup: [{ c: 'hang', hold: COMMAND_HOLD, say: 'Start' }, { c: 'top', hold: COMMAND_HOLD, say: 'Down' }],
};
function flashCommand(word) {
  const el = $('live-cmd'); if (!el) return;
  el.textContent = word.toUpperCase();
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
function voiceCoach(lm, vw, vh, t) {
  const L = state.live;
  if (!L?.rec || !$('voice').checked) return;
  const seq = SEQ[state.lift]; if (!seq) return;
  const left = (lm[11].visibility ?? 0) + (lm[23].visibility ?? 0) >= (lm[12].visibility ?? 0) + (lm[24].visibility ?? 0);
  const id = left ? { S: 11, E: 13, W: 15, H: 23, K: 25, A: 27 } : { S: 12, E: 14, W: 16, H: 24, K: 26, A: 28 };
  const P = k => ({ x: lm[id[k]].x * vw, y: lm[id[k]].y * vh, v: lm[id[k]].visibility ?? 0 });
  const S = P('S'), E = P('E'), W = P('W'), H = P('H'), K = P('K'), A = P('A');
  const ang = (a, b, c) => angle({ x: a.x / vw, y: a.y / vh }, { x: b.x / vw, y: b.y / vh }, { x: c.x / vw, y: c.y / vh }, vw, vh);
  const arm = Math.hypot(S.x - E.x, S.y - E.y) + Math.hypot(E.x - W.x, E.y - W.y) || vh * 0.3;
  const body = Math.hypot(H.x - A.x, H.y - A.y) * 1.9 || vh * 0.7;
  const elb = ang(S, E, W), knee = ang(H, K, A), hip = ang(S, H, K);
  const R = L.ref ??= { elb: 0, knee: 0, hip: 0, topH: Infinity, topW: Infinity, topS: Infinity, hangS: -Infinity, floorW: -Infinity };
  const legsSeen = K.v > 0.3 && A.v > 0.3;
  if (Number.isFinite(elb)) R.elb = Math.max(R.elb, elb);
  if (legsSeen && Number.isFinite(knee)) R.knee = Math.max(R.knee, knee);
  if (Number.isFinite(hip)) R.hip = Math.max(R.hip, hip);
  R.topH = Math.min(R.topH, H.y); R.topW = Math.min(R.topW, W.y); R.topS = Math.min(R.topS, S.y);
  R.hangS = Math.max(R.hangS, S.y); R.floorW = Math.max(R.floorW, W.y);
  const elbLocked = elb >= Math.min(155, R.elb - 14);
  const hangLocked = elb >= Math.min(150, R.elb - 15) && S.y >= R.hangS - 0.12 * arm;
  const cond = {
    squat: {
      // se le gambe sono coperte (rack, dischi) basta l'anca alla sua altezza "in piedi"
      locked: () => (legsSeen ? knee >= Math.min(158, R.knee - 14) : true) && H.y <= R.topH + 0.05 * body,
      down: () => H.y - R.topH > 0.12 * body || (legsSeen && knee < 125),
    },
    panca: {
      locked: () => elbLocked && W.y <= R.topW + 0.12 * arm,
      down: () => W.y > R.topW + 0.3 * arm,
      chest: () => W.y > R.topW + 0.3 * arm,
    },
    stacco: {
      lifted: () => W.y < R.floorW - 0.1 * body,
      locked: () => W.y < R.floorW - 0.1 * body && knee >= Math.min(160, R.knee - 12) && hip >= Math.min(160, R.hip - 12),
    },
    trazioni: { hang: () => hangLocked, pulled: () => S.y < R.hangS - 0.15 * arm },
    dip: { locked: () => elbLocked && S.y <= R.topS + 0.1 * arm, down: () => S.y > R.topS + 0.2 * arm },
    muscleup: { hang: () => hangLocked, top: () => S.y < W.y - 0.1 * arm && elb >= Math.min(150, R.elb - 15) },
  }[state.lift];
  const pts = { squat: [H, A], panca: [W, S], stacco: [W, H], trazioni: [S, H], dip: [S, H], muscleup: [S, H] }[state.lift];
  const tol = ['squat', 'stacco'].includes(state.lift) ? 0.03 * body : 0.045 * arm;

  if (L.step >= seq.length) { if (t - L.doneAt > 4) { L.step = 0; L.since = null; } return; }
  const st = seq[L.step];
  if (!cond[st.c]()) { L.since = null; return; }
  if (!st.hold) { L.step++; L.since = null; return; }
  // fermo: il tempo riparte se uno dei punti si sposta più della tolleranza
  if (!L.since || pts.some((p, k) => Math.abs(p.x - L.box[k].x) > tol || Math.abs(p.y - L.box[k].y) > tol)) {
    L.since = t; L.box = pts.map(p => ({ x: p.x, y: p.y }));
    return;
  }
  if (t - L.since >= st.hold - 0.03) {
    say(st.say); flashCommand(st.say);
    L.step++; L.since = null;
    if (L.step >= seq.length) L.doneAt = t;
  }
}

function pickMime() {
  const opts = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return opts.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}
function toggleRec() {
  const L = state.live; if (!L) return;
  if (!L.rec) {
    if (!window.MediaRecorder) { $('live-error').textContent = 'Questo browser non può registrare video. Usa "Carica un video".'; return; }
    if ($('voice').checked) unlockVoice(); // sblocca l'audio su iPhone (serve un tocco dell'utente)
    const mimeType = pickMime();
    const rec = new MediaRecorder(L.stream, mimeType ? { mimeType } : undefined);
    L.chunks = []; L.rec = rec; L.step = 0; L.since = null; L.ref = null; L.track = [];
    rec.ondataavailable = e => e.data.size && L.chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(L.chunks, { type: rec.mimeType || mimeType || 'video/webm' });
      const secs = (performance.now() - L.startedAt) / 1000;
      const url = URL.createObjectURL(blob); state.urls.push(url);
      stopLive();
      analyzeVideo(url, { recordedSec: secs, blob, track: L.track });
    };
    rec.start(250);
    L.startedAt = performance.now();
    $('rec').classList.add('on'); $('rec').setAttribute('aria-label', 'Ferma');
    $('live-hint').textContent = 'Fai la tua alzata. Quando hai finito, premi di nuovo per fermare.';
    L.timer = setInterval(() => {
      const s = Math.floor((performance.now() - L.startedAt) / 1000);
      $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s >= MAX_SECONDS) toggleRec();
    }, 250);
  } else {
    clearInterval(L.timer);
    if (L.rec.state !== 'inactive') L.rec.stop();
  }
}
function stopLive() {
  const L = state.live; if (!L) return;
  clearInterval(L.timer);
  if (L.rec && L.rec.state !== 'inactive') { L.rec.onstop = null; L.rec.stop(); }
  L.stream.getTracks().forEach(tr => tr.stop());
  $('live-video').srcObject = null;
  state.live = null;
  $('rec').classList.remove('on'); $('rec-time').textContent = '0:00';
  $('live-hint').textContent = 'Mettiti di lato, con tutto il corpo nell\'inquadratura, e premi il pallino rosso.';
}

// ── avvio ───────────────────────────────────────
$('btn-live').addEventListener('click', () => {
  $('home-error').textContent = '';
  if (!navigator.mediaDevices?.getUserMedia) { $('home-error').textContent = 'Questo browser non dà accesso alla fotocamera. Usa "Carica un video".'; return; }
  startLive();
});
$('btn-upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => {
  // L'input ha "multiple": su iPhone così la galleria seleziona il video con un tocco (spunta)
  // invece di aprirne l'anteprima. Si analizza il primo video scelto.
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f); state.urls.push(url);
  analyzeVideo(url);
});
$('rec').addEventListener('click', toggleRec);
$('voice').addEventListener('change', e => { if (e.target.checked) unlockVoice(); });
$('flip').addEventListener('click', () => {
  if (state.live?.rec) return; // non durante la registrazione
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  stopLive(); startLive();
});
// Il giudice si prepara appena si apre la pagina, in background: mentre scegli l'alzata,
// ti registri o cerchi il video in galleria, lui si scarica e si avvia. Così anche la prima
// analisi parte subito. La volta dopo è già salvato nel telefono.
// (Con "risparmio dati" attivo si aspetta che l'utente scelga cosa fare.)
const preloadJudge = () => {
  modelBuffer('lite').catch(() => {});      // solo download: serve per la diretta
  getModel('heavy').catch(() => {});         // download + avvio: serve per l'analisi
};
if (navigator.connection?.saveData) {
  document.querySelectorAll('[data-preload]').forEach(el => el.addEventListener('pointerdown', preloadJudge, { once: true }));
} else if (document.readyState === 'complete') setTimeout(preloadJudge, 300);
else window.addEventListener('load', () => setTimeout(preloadJudge, 300), { once: true });
