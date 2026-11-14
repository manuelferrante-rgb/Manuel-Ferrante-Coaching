// ¿oodLift — interfaccia.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
import { FilesetResolver, PoseLandmarker } from './vendor/mediapipe/vision_bundle.js';
import { LIFTS, LM, SQUAT, recognize } from './engine.js';
import { pickPerson, countPeople, endMessage, detectLift } from './core.js';
import { trackPlate } from './plates.js';
import { cameraShift, stabilize } from './motion.js';
import { secondEye, resetSecondEye, stats as secondStats } from './second.js';

const $ = id => document.getElementById(id);
const GOLD = '#c9a35a', RED = '#e5484d', WHITE = '#f5f5f0';
const MAX_SECONDS = 45;
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];

// Safari < 16 non ha roundRect: ripiego su un rettangolo semplice.
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };

const state = { lift: null, vision: null, models: {}, live: null, result: null, urls: [], facing: 'environment' };
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

// L'alzata non si sceglie: la riconosce GoodLift dal video (detectLift / recognize). Durante
// l'analisi state.lift è la stima provvisoria (serve solo per la schermata), alla fine quella vera.
// Per le prove: ?lift=squat (o panca, stacco, trazioni, dip, muscleup) la impone.
const guessLift = (frames, w, h) => { try { return detectLift(frames, w, h).lift; } catch { return null; } };

// ── modelli MediaPipe (caricati solo quando servono) ──
const QS = new URLSearchParams(location.search);
const FORCED = LIFTS[QS.get('lift')] ? QS.get('lift') : null; // per le prove: alzata imposta
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
// Analisi: modalità "immagine", cioè ogni fotogramma cerca da capo tutte le persone. In modalità
// "video" il modello insegue le persone già trovate e, se ce n'è più di una (giudici, spotter),
// spesso perde l'atleta. La diretta resta in modalità video (più leggera).
async function createModel(kind, mode = kind === 'lite' ? 'VIDEO' : 'IMAGE') {
  state.vision ??= await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, ''));
  const buf = await modelBuffer(kind);
  const opts = delegate => ({
    baseOptions: buf ? { modelAssetBuffer: buf, delegate } : { modelAssetPath: modelUrl(kind), delegate },
    runningMode: mode, numPoses: 1,
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  let model;
  if (DELEGATE_OVERRIDE) model = await PoseLandmarker.createFromOptions(state.vision, opts(DELEGATE_OVERRIDE));
  else try { model = await PoseLandmarker.createFromOptions(state.vision, opts('GPU')); }
  catch { model = await PoseLandmarker.createFromOptions(state.vision, opts('CPU')); }
  model.__numPoses = 1; model.__mode = mode;
  return (state.models[kind] = model);
}
let lastTs = 0;
const nextTs = () => (lastTs = Math.max(lastTs + 1, Math.round(performance.now())));
const detect = (model, video) => model.__mode === 'IMAGE' ? model.detect(video) : model.detectForVideo(video, nextTs());
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
    // In palestra ci sono quasi sempre altre persone (giudici, spotter): si cercano fino a 3 persone
    // e poi pickPerson sceglie chi fa l'alzata. Con una sola, il modello può agganciare un giudice.
    // Si parte cercando tutti (modalità immagine); se nei primi fotogrammi c'è una persona sola si
    // passa subito alla modalità veloce (samplePlaying).
    if (m.__numPoses !== 3 || m.__mode !== 'IMAGE') { await m.setOptions({ runningMode: 'IMAGE', numPoses: 3 }); m.__numPoses = 3; m.__mode = 'IMAGE'; }
    return m;
  });
  modelP.catch(() => {});
  const T0 = performance.now(); state.timing = {}; // tempi (per ?debug)
  try { await loadVideo(video, url); }
  catch (e) { console.error(e); return stop('Questo video non si apre in questo browser. Prova con un video .mp4, oppure registrati direttamente dall\'app.'); }
  setAspect($('scan-stage'), video);
  const vw = video.videoWidth, vh = video.videoHeight;
  const total = Math.min(MAX_SECONDS, await videoDuration(video, recordedSec));

  // Dove sta l'alzata: se ti sei registrato dall'app lo sappiamo già dalla diretta.
  state.lift = FORCED || null; state.ask = null; state.sure = null; state.chosen = false;
  if (track?.length > 10 && !state.lift) state.lift = guessLift(track, vw, vh);
  const win = track?.length > 10 ? activeWindow(track, state.lift, total) : [0, total];

  let model;
  try { model = await modelP; }
  catch (e) { console.error(e); return stop('Non riesco a caricare il giudice. Controlla la connessione e riprova.'); }

  // Un solo giro sul video. Il video scorre (molto più veloce che saltare da un fotogramma
  // all'altro, soprattutto su iPhone) e la velocità si adatta: veloce quando sei fermo o non
  // c'è nessuno, più lento quando ti muovi, così l'alzata ha sempre ~12 fotogrammi al secondo.
  // Mentre analizza, mostra già quello che trova: le ripetizioni viste finora e com'erano.
  let lastPartial = -Infinity, lastHtml = '';
  const partial = frames => {
    try {
      const raw = frames.filter((f, i) => i === 0 || f.t > frames[i - 1].t + 1e-4);
      if (!FORCED) state.lift = guessLift(raw, vw, vh) || state.lift; // stima provvisoria
      if (!state.lift) return;
      const r = LIFTS[state.lift].analyze(pickPerson(raw, state.lift, vw, vh), vw, vh);
      const reps = r.reps || (r.verdict !== 'unclear' && r.key ? [{ n: 1, verdict: r.verdict }] : []);
      if (!reps.length) return;
      const ok = reps.filter(x => x.verdict === 'good').length;
      const html = `<p class="sum">Finora: ${reps.length} ${reps.length === 1 ? 'ripetizione' : 'ripetizioni'} · ${ok} ${ok === 1 ? 'valida' : 'valide'} (provvisorio)</p>`
        + reps.map(x => `<span class="rep ${x.verdict}">${x.n}º</span>`).join('');
      if (html !== lastHtml) { $('scan-reps').innerHTML = html; lastHtml = html; } // si aggiorna solo se cambia
    } catch { /* risultato parziale non disponibile */ }
  };
  $('scan-reps').innerHTML = '';
  const onPose = (t, poses, frames) => {
    const lm = pickPerson([{ t: 0, poses }], state.lift, vw, vh)[0].lm;
    if (lm) lastLm = lm;
    setPct(100 * Math.min(1, (t - win[0]) / Math.max(0.01, win[1] - win[0])));
    if (frames && t - lastPartial >= 0.8 && frames.length >= 10) { lastPartial = t; partial(frames); }
    return lm;
  };
  const gone = () => document.body.dataset.screen !== 'scan';
  state.timing.ready = performance.now() - T0;
  let frames = await samplePlaying(video, model, win[0], win[1], onPose, gone);
  if (frames === null) frames = await sampleSeeking(video, model, win[0], win[1], total, onPose, gone); // senza riproduzione: a salti
  if (!frames) { alive = false; return; } // l'utente è tornato indietro
  let raw = frames.filter((f, i) => i === 0 || f.t > frames[i - 1].t + 1e-4);
  state.timing.sampled = performance.now() - T0;
  let prep = prepare(raw, vw, vh);
  let { clean, result } = judge(prep, FORCED || recognizeLift(prep, vw, vh), vw, vh);
  state.timing.judged = performance.now() - T0;

  // Secondo occhio: se MediaPipe non riesce a giudicare, o nello squat la sua anca/ginocchio in buca
  // non tornano con quelli dell'altro modello (busto coperto dai dischi), si rifà l'analisi con
  // l'altro modello, che trova le articolazioni una per una e regge le parti coperte.
  state.second = null;
  if (!QS.has('nosecond')) {
    try {
      const why = result.verdict === 'unclear' ? (result.warnings[0] === endMessage(state.lift) ? null : 'unclear') : state.lift === 'squat' ? await depthDisagrees(video, result, clean, vw, vh, gone) : null;
      state.second = { why };
      if (why) {
        $('scan-label').textContent = 'Controllo più preciso…';
        const w2 = clean.some(f => f.lm) ? activeWindow(clean, state.lift, total) : win;
        const f2 = await sampleSecond(video, Math.max(win[0], w2[0]), Math.min(win[1], w2[1]), total, (t, from, to) => setPct(100 * Math.min(1, (t - from) / Math.max(0.01, to - from))), lm => { if (lm) lastLm = lm; }, gone);
        if (f2 === false) { alive = false; return; }
        // con i punti del secondo occhio anche l'alzata si riconosce meglio
        const before = { lift: state.lift, ask: state.ask };
        const prep2 = prepare(f2, vw, vh);
        const { clean: c2, result: r2 } = judge(prep2, FORCED || recognizeLift(prep2, vw, vh), vw, vh);
        state.second.verdict = r2.verdict; state.second.frames = c2; // per ?debug
        if (r2.verdict !== 'unclear') { raw = f2; prep = prep2; clean = c2; result = r2; state.second.used = true; }
        else Object.assign(state, before);
      }
    } catch (e) { console.warn(e); }
    state.timing.second = performance.now() - T0; state.timing.secondEye = { ...secondStats };
  }
  alive = false; cancelAnimationFrame(raf);
  state.raw = raw; // per ?debug
  // tutto quello che serve per rigiudicare subito con un'altra alzata (pillola "SQUAT ▾")
  state.last = { raw, prep, url, blob, vw, vh, total, win };
  finish(result, clean);
  state.timing.plate = performance.now() - T0;
}

// Ultimi ritocchi e risultato a schermo (anche quando si cambia alzata dalla pillola).
function finish(result, clean) {
  const { raw, url, blob, vw, vh, total, win } = state.last;
  try { attachPlate(result, raw, vw, vh); } catch (e) { console.warn(e); }
  if (total >= MAX_SECONDS) result.warnings.unshift(`Ho analizzato solo i primi ${MAX_SECONDS} secondi: per i prossimi video taglia il pezzo con l'alzata.`);
  // replay: dall'inizio della prima ripetizione a poco dopo la fine dell'ultima
  const keys = (result.reps || (result.key ? [{ key: result.key }] : [])).map(r => r.key);
  result.trim = keys.length
    ? [Math.max(0, Math.min(...keys.map(k => k.start)) - 0.5), Math.min(total, Math.max(...keys.map(k => k.end ?? k.focus)) + 1.6)]
    : [win[0], win[1]];
  showResult(result, clean, url, blob);
}

// Rigiudica lo stesso video con un'altra alzata: niente nuova analisi, solo il giudizio (istantaneo).
function rejudge(lift) {
  if (!state.last) return;
  state.ask = null; state.chosen = true; // scelta dalla persona: niente più domande
  const { clean, result } = judge(state.last.prep, lift, state.last.vw, state.last.vh);
  finish(result, clean);
}

// Riconosce l'alzata (e il dubbio da proporre, es. "Era un muscle up?").
function recognizeLift(prep, vw, vh) {
  try {
    const r = recognize(prep.frames, vw, vh);
    state.recognized = r; state.ask = r.ask; state.sure = r.sure; // per ?debug
    return r.lift;
  } catch (e) { console.warn(e); return state.lift || 'squat'; }
}

// Giudizio: si sceglie l'atleta e si giudica. Se il telefono si è mosso (video fatto a mano),
// prima si toglie il movimento dell'inquadratura, così non cambia il verdetto. Il replay rimette
// lo spostamento (result.replay.shift) per disegnare le linee sopra il video vero.
function prepare(raw, vw, vh) {
  const T = performance.now();
  let shift = null;
  try { shift = cameraShift(raw, GRAY_W, Math.round(GRAY_W * vh / vw)); } catch (e) { console.warn(e); }
  state.timing.motion = performance.now() - T; state.shift = shift; // per ?debug
  return { frames: stabilize(raw, shift), shift };
}
function judge({ frames, shift }, lift, vw, vh) {
  state.lift = lift;
  const clean = pickPerson(frames, lift, vw, vh);
  const result = LIFTS[lift].analyze(clean, vw, vh);
  if (result.replay) result.replay.shift = shift && shift.map(s => ({ x: s.dx * vw, y: s.dy * vh }));
  // lo scheletro si disegna dove sta davvero nel video
  return { clean: shift ? clean.map(f => ({ ...f, lm: f.lm?.orig ?? f.lm })) : clean, result };
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
    const p = R.series[key][i], o = R.shift?.[i] || { x: 0, y: 0 };
    return { gray: f.gray, seed: p ? { x: (p.x + o.x) * sc, y: (p.y + o.y) * sc } : null };
  });
  const found = trackPlate(frames, GRAY_W, gh, body);
  const n = found.filter(Boolean).length;
  state.plate = { frames: raw.length, gray: frames.filter(f => f.gray).length, seeds: frames.filter(f => f.seed).length, body, found: n }; // per ?debug
  if (n < 0.4 * raw.length) return;
  // a corpo libero/zavorrato il disco si muove con l'atleta: un cerchio fermo nello sfondo
  // (un'altra macchina, un disco appoggiato) non è il suo, e allora restano i piedi
  if (['trazioni', 'dip', 'muscleup'].includes(result.lift)) {
    const span = arr => { const v = arr.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(0.95 * (v.length - 1))] - v[Math.floor(0.05 * (v.length - 1))] : 0; };
    const plateMove = span(found.map(c => c ? c.y / sc : NaN)), hipMove = span(R.series.H.map(p => p ? p.y : NaN));
    if (!(plateMove > 0.4 * hipMove)) return;
  }
  R.path = { ...R.path, a: null, pts: found.map(c => c && { x: c.x / sc, y: c.y / sc }) };
}

// Analisi mentre il video scorre. Restituisce null se il browser non lo permette.
async function samplePlaying(video, model, from, to, onPose, gone) {
  if (!('requestVideoFrameCallback' in video)) return null;
  await seekTo(video, from);
  return new Promise(resolve => {
    const frames = [];
    let lastT = -1, cost = 0.06, stillFor = 0, prev = null, done = false, rate = 1;
    // Più persone? Si guarda nei primi fotogrammi: se c'è solo l'atleta, la ricerca di altre persone
    // si spegne e l'analisi va veloce (il modello segue l'atleta da un fotogramma all'altro).
    const probe = { left: 6, one: 0, many: false, switching: false };
    state.people = { probe };
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
        try { poses = toPoses(detect(model, video)); } catch (e) { console.warn(e); }
        cost = 0.7 * cost + 0.3 * (performance.now() - c0) / 1000;
        const c1 = performance.now();
        frames.push({ t, poses, gray: grabGray(video) });
        const c2 = performance.now();
        if (probe.left > 0 && model.__mode === 'IMAGE') {
          const n = countPeople(poses, video.videoWidth, video.videoHeight);
          if (n > 1) probe.many = true; else if (n === 1) probe.one++;
          if (--probe.left === 0 && !probe.many && probe.one >= 4) probe.switching = true;
        }
        const lm = onPose(t, poses, frames);
        const tm = state.timing; tm.detect = (tm.detect || 0) + (c1 - c0); tm.gray = (tm.gray || 0) + (c2 - c1); tm.onPose = (tm.onPose || 0) + (performance.now() - c2); tm.n = (tm.n || 0) + 1;
        // fermo o assente → si va più veloce; in movimento → ~12 fotogrammi al secondo
        const y = lm ? (lm[ids[0]].y + lm[ids[1]].y) / 2 : null;
        const moving = y != null && prev != null && Math.abs(y - prev) / Math.max(1e-3, t - lastT) > 0.05;
        stillFor = moving ? 0 : stillFor + (t - lastT > 0 ? t - lastT : 0);
        prev = y; lastT = t;
        const base = Math.max(0.25, Math.min(2, 0.85 * STEP / cost));
        // da fermo si corre (fino a 4×): niente da giudicare. In panca no: il fermo al petto va misurato bene.
        const cap = state.lift === 'panca' ? 2 : 4;
        const want = stillFor > 0.6 ? Math.min(cap, base * 4) : base;
        if (Math.abs(want - rate) / rate > 0.12) { rate = want; video.playbackRate = rate; }
      }
      if (probe.switching) {
        probe.switching = false;
        video.pause();
        model.setOptions({ runningMode: 'VIDEO', numPoses: 1 })
          .then(() => { model.__mode = 'VIDEO'; model.__numPoses = 1; state.people.single = true; })
          .catch(e => console.warn(e))
          .finally(() => { if (done) return; video.requestVideoFrameCallback(onFrame); video.play().catch(() => finish(false)); });
        return;
      }
      video.requestVideoFrameCallback(onFrame);
    };
    video.onended = () => finish(true);
    video.requestVideoFrameCallback(onFrame);
    video.muted = true;
    video.play().catch(() => finish(false));
  });
}

// Femore in buca (di lato): positivo = anca sotto il ginocchio. Si usa il lato più visibile.
function femurOf(lm) {
  const v = i => lm[i]?.visibility ?? 0;
  const [h, k] = v(23) + v(25) >= v(24) + v(26) ? [23, 25] : [24, 26];
  if (v(h) < 0.3 || v(k) < 0.3) return NaN;
  return Math.atan2(lm[h].y - lm[k].y, Math.abs(lm[h].x - lm[k].x)) * 180 / Math.PI;
}
function suspicious(best, clean) {
  const v = i => best.lm[i]?.visibility ?? 0;
  const [h, k] = v(23) + v(25) >= v(24) + v(26) ? [23, 25] : [24, 26];
  if (v(h) < 0.8 || v(k) < 0.8) return true;
  const f0 = femurOf(best.lm);
  const near = clean.filter(f => f !== best && f.lm && Math.abs(f.t - best.t) <= 0.25).map(f => femurOf(f.lm)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!near.length || !Number.isFinite(f0)) return true;
  return Math.abs(f0 - near[near.length >> 1]) > 12;
}
// Controllo veloce dello squat: nel punto più basso di ogni ripetizione si guarda anche con il
// secondo occhio (un fotogramma per ripetizione). Se anca e ginocchio non tornano, si rifà tutto.
async function depthDisagrees(video, result, clean, vw, vh, gone) {
  if (result.warnings.some(w => w.startsWith('Ripresa da davanti'))) return null; // da davanti si misura in altro modo
  const reps = result.reps || [result];
  for (const r of reps) {
    const c = r.checks?.find(x => x.id === 'depth');
    if (!c?.t) continue;
    const t = c.t[0];
    let best = null;
    for (const f of clean) if (f.lm && (!best || Math.abs(f.t - t) < Math.abs(best.t - t))) best = f;
    // Il secondo occhio si scarica solo se serve: si controlla solo se MediaPipe in buca è incerto
    // (anca o ginocchio poco visibili, femore che salta da un fotogramma all'altro, buca ricostruita).
    if (best && !suspicious(best, clean) && !result.warnings.some(w => w.includes('ricostruita'))) continue;
    if (gone()) return null;
    await seekTo(video, t);
    resetSecondEye();
    const poses = await secondEye(video, vw, vh, 3);
    // la persona del secondo occhio è quella più vicina all'atleta scelto da MediaPipe (le anche)
    const mid = lm => ({ x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 });
    const a = best && mid(best.lm);
    const p = a ? poses.sort((p, q) => Math.hypot(mid(p).x - a.x, mid(p).y - a.y) - Math.hypot(mid(q).x - a.x, mid(q).y - a.y))[0] : poses[0];
    if (!p) continue;
    const f2 = femurOf(p), f1 = best ? femurOf(best.lm) : NaN;
    (state.secondCheck ??= []).push({ t, mediapipe: f1, second: f2 });
    if (!Number.isFinite(f2)) continue;
    if (!Number.isFinite(f1) || Math.abs(f2 - f1) > 10) return 'depth';
  }
  return null;
}

// Analisi a salti con il secondo occhio, solo nel pezzo con l'alzata.
async function sampleSecond(video, from, to, total, onProgress, onLm, gone) {
  const frames = [];
  resetSecondEye();
  for (let t = from; t <= to + 1e-6; t += STEP) {
    if (gone()) return false;
    await seekTo(video, Math.min(t, Math.max(0, total - 0.02)));
    let poses = [];
    try { poses = await secondEye(video, video.videoWidth, video.videoHeight, 3); } catch (e) { console.warn(e); }
    frames.push({ t: video.currentTime, poses, gray: grabGray(video) });
    onLm(pickPerson([{ t: 0, poses }], state.lift, video.videoWidth, video.videoHeight)[0].lm);
    onProgress(t, from, to);
  }
  return frames.filter((f, i) => i === 0 || f.t > frames[i - 1].t + 1e-4);
}

// Analisi a salti (browser senza requestVideoFrameCallback): più lenta ma funziona ovunque.
async function sampleSeeking(video, model, from, to, total, onPose, gone) {
  const frames = [];
  for (let t = from; t <= to + 1e-6; t += STEP) {
    if (gone()) return false;
    await seekTo(video, Math.min(t, Math.max(0, total - 0.02)));
    let poses = [];
    try { poses = toPoses(detect(model, video)); } catch (e) { console.warn(e); }
    frames.push({ t: video.currentTime, poses, gray: grabGray(video) });
    onPose(video.currentTime, poses, frames);
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
  // alzata riconosciuta: pillola (tocca per cambiarla) e, se c'è un dubbio, la domanda
  $('lift-name').textContent = name;
  $('lift-menu').hidden = true; $('lift-pill').setAttribute('aria-expanded', 'false');
  const ask = state.ask && state.ask !== result.lift ? state.ask : null;
  // non riesco a giudicare (e non perché il video è tagliato): forse l'alzata non è quella giusta
  const lost = result.verdict === 'unclear' && result.warnings[0] !== endMessage(result.lift);
  // alzata riconosciuta con poche prove: si chiede conferma (sempre con un tocco solo)
  const unsure = !FORCED && !state.chosen && (lost || state.sure === false);
  $('lift-ask').hidden = !ask && !unsure;
  $('lift-ask').innerHTML = lost && !state.chosen && !FORCED ? `Che alzata è? <b>Toccala qui sopra</b> e la rigiudico subito.`
    : ask ? `Era un ${LIFTS[ask].name.toLowerCase()}? <b>Giudicalo come ${LIFTS[ask].name.toLowerCase()}</b>`
    : unsure ? `È ${['a', 'e', 'i', 'o', 'u'].includes(name[0].toLowerCase()) ? 'un' : 'uno'} ${name.toLowerCase()}? Se no, <b>tocca l'alzata giusta qui sopra</b>.` : '';
  $('lift-ask').dataset.lift = lost ? '' : ask || '';
  if (unsure) openLiftMenu(result.lift);
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
  setupReplay(url, result, frames);
  selectRep(result.mainRep || 1, false);
}

// pillola dell'alzata: apre l'elenco; scegliendo un'alzata si rigiudica subito lo stesso video
function openLiftMenu(cur) {
  const m = $('lift-menu');
  m.innerHTML = Object.entries(LIFTS).map(([id, l]) => `<button data-lift="${id}" aria-pressed="${id === cur}">${l.name}</button>`).join('');
  m.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.dataset.lift !== cur) rejudge(b.dataset.lift); else m.hidden = true; }));
  m.hidden = false; $('lift-pill').setAttribute('aria-expanded', 'true');
}
$('lift-pill').addEventListener('click', () => {
  if ($('lift-menu').hidden) openLiftMenu(state.result?.result?.lift);
  else { $('lift-menu').hidden = true; $('lift-pill').setAttribute('aria-expanded', 'false'); }
});
$('lift-ask').addEventListener('click', () => { const l = $('lift-ask').dataset.lift; if (l) rejudge(l); else openLiftMenu(state.result?.result?.lift); });

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
  $('rp-path').classList.toggle('on', replay.path === 'path'); $('rp-path').setAttribute('aria-pressed', replay.path === 'path');
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
$('rp-path').addEventListener('click', () => { replay.path = replay.path === 'path' ? null : 'path'; setPathButtons(); });
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
  // telefono che si muove: i punti del giudizio sono "fermi", per disegnarli si rimette lo spostamento
  const off = k => R.shift?.[k] || { x: 0, y: 0 };
  const Pk = (p, k) => p && { x: (p.x + off(k).x) * sx, y: (p.y + off(k).y) * sy };
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
      const a = series[PATH.a][k]; if (!a) return null; // (PATH.pts sopra: già nell'immagine vera)
      const b = PATH.b ? series[PATH.b][k] : null;
      const f = PATH.f || 0;
      return Pk(b ? { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f } : a, k);
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
    if (PATH.bar) { const y = (PATH.bar() + off(i).y) * sy; line({ x: 0, y }, { x: w, y }, 'rgba(245,245,240,.6)', 1.5, true); }
  }

  // discesa del bilanciere (o del corpo) durante la salita
  const rep = result.reps ? result.reps[(state.selRep || 1) - 1] : null;
  const allChecks = result.reps ? result.reps.flatMap(r => r.checks) : result.checks;
  for (const c of allChecks) {
    if (c.id !== 'noDrop' || c.status !== 'fail' || now < c.t[0] || now > c.t[0] + 1.5) continue;
    const di = nearest(ts, c.t[0]), p = Pk(series[R.trail || 'H'][di], di);
    if (!p) continue;
    ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(p.x, p.y, 16 * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    tag(ctx, R.dropText || 'SCENDE', p.x + 20 * dpr, p.y, dpr, RED);
  }

  // posizione chiave: segmento, linea di riferimento, etichetta
  const F = R.focus; if (!F) return;
  const near = (R.focusTs || []).some(f => f != null && Math.abs(now - f) < 0.45);
  const A = Pk(series[F.a]?.[i], i), B = Pk(series[F.b]?.[i], i);
  const lab = near && F.label ? F.label(i) : null;
  const col = lab?.[1] ? RED : GOLD;
  if (near) {
    if (F.ref) { let y = F.ref(i); if (y != null) { y = (y + off(i).y) * sy; line({ x: 0, y }, { x: w, y }, 'rgba(245,245,240,.75)', 1.5, true); } }
    if (F.hline) { const y = (F.hline() + off(i).y) * sy; line({ x: 0, y }, { x: w, y }, 'rgba(245,245,240,.75)', 1.5, true); }
    if (F.vline) { let x = F.vline(i); if (x != null) { x = (x + off(i).x) * sx; line({ x, y: 0 }, { x, y: h }, 'rgba(245,245,240,.75)', 1.5, true); } }
  }
  if (A && B && (near || result.lift === 'squat')) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 5 * dpr; ctx.lineCap = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 10 * dpr;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.restore();
  }
  const pt0 = near && F.point ? Pk(F.point(i), i) : null;
  if (pt0) { ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pt0.x, pt0.y, 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  if (lab && (A || B || pt0)) {
    const ref = A && B ? { x: Math.min(A.x, B.x), y: Math.max(A.y, B.y) } : (A || B || pt0);
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
      // traccia della diretta: serve dopo a saltare i tempi morti senza rianalizzare tutto
      if (state.live.rec) state.live.track.push({ t: (now - state.live.startedAt) / 1000, lm });
    }
    requestAnimationFrame(loop);
  };
  loop();
}

function pickMime() {
  const opts = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return opts.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}
function toggleRec() {
  const L = state.live; if (!L) return;
  if (!L.rec) {
    if (!window.MediaRecorder) { $('live-error').textContent = 'Questo browser non può registrare video. Usa "Carica un video".'; return; }
    const mimeType = pickMime();
    const rec = new MediaRecorder(L.stream, mimeType ? { mimeType } : undefined);
    L.chunks = []; L.rec = rec; L.track = [];
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
