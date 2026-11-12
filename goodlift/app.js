// ¿oodLift — interfaccia.
// Copyright (C) 2026 Manuel Ferrante Coaching — AGPL-3.0-or-later (vedi LICENSE).
import { FilesetResolver, PoseLandmarker } from './vendor/mediapipe/vision_bundle.js';
import { LIFTS, LM, SQUAT } from './engine.js';

const $ = id => document.getElementById(id);
const GOLD = '#c9a35a', RED = '#e5484d', WHITE = '#f5f5f0';
const MAX_SECONDS = 45;
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];

// Safari < 16 non ha roundRect: ripiego su un rettangolo semplice.
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };

const state = { lift: 'squat', vision: null, models: {}, live: null, result: null, urls: [] };
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
async function getModel(kind) {
  if (kind === 'heavy' && MODEL_OVERRIDE) kind = MODEL_OVERRIDE;
  if (state.models[kind]) return state.models[kind];
  state.vision ??= await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, ''));
  const opts = delegate => ({
    baseOptions: { modelAssetPath: new URL(`models/pose_landmarker_${kind}.task`, import.meta.url).href, delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3,
  });
  let model;
  if (DELEGATE_OVERRIDE) return (state.models[kind] = await PoseLandmarker.createFromOptions(state.vision, opts(DELEGATE_OVERRIDE)));
  try { model = await PoseLandmarker.createFromOptions(state.vision, opts('GPU')); }
  catch { model = await PoseLandmarker.createFromOptions(state.vision, opts('CPU')); }
  return (state.models[kind] = model);
}
let lastTs = 0;
const nextTs = () => (lastTs = Math.max(lastTs + 1, Math.round(performance.now())));
const toLm = res => res?.landmarks?.[0]?.map(p => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })) ?? null;

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
    const s = sideOf(lm), vw = $('scan-video').videoWidth || w, vh = $('scan-video').videoHeight || h;
    const knee = angle(lm[s.H], lm[s.K], lm[s.A], vw, vh), hip = angle(lm[s.S], lm[s.H], lm[s.K], vw, vh);
    if (Number.isFinite(knee)) tag(ctx, `KNEE ${Math.round(knee)}°`, lm[s.K].x * w + 12 * dpr, lm[s.K].y * h, dpr);
    if (Number.isFinite(hip)) tag(ctx, `HIP ${Math.round(hip)}°`, lm[s.H].x * w + 12 * dpr, lm[s.H].y * h, dpr);
  }
}

// ── analisi di un video (caricato o registrato) ──
async function analyzeVideo(url, { recordedSec = null, blob = null } = {}) {
  show('scan');
  $('scan-error').textContent = '';
  $('scan-bar').style.width = '0';
  $('scan-pct').textContent = '';
  $('scan-label').textContent = state.models.heavy ? 'Preparo il giudice…' : 'Preparo il giudice (la prima volta ci vuole qualche secondo)…';
  const video = $('scan-video'), canvas = $('scan-canvas');
  let model;
  // Per l'analisi si usa il modello più preciso: con dischi e rack che coprono le gambe
  // è l'unico che mette anca e ginocchio al posto giusto.
  try { model = await getModel('heavy'); }
  catch (e) { console.error(e); $('scan-error').textContent = 'Non riesco a caricare il giudice. Controlla la connessione e riprova.'; return; }

  video.src = url; video.muted = true; video.playsInline = true;
  try {
    await new Promise((res, rej) => {
      video.onloadeddata = res;
      video.onerror = () => rej(new Error('decode'));
      setTimeout(() => rej(new Error('timeout')), 15000);
    });
  } catch {
    $('scan-error').textContent = 'Questo video non si apre in questo browser. Prova con un video .mp4, oppure registrati direttamente dall\'app.';
    return;
  }
  setAspect($('scan-stage'), video);
  const vw = video.videoWidth, vh = video.videoHeight;
  const total = Math.min(MAX_SECONDS, await videoDuration(video, recordedSec));
  $('scan-label').textContent = 'Analisi del movimento';

  // Campionamento a passo fisso: ci si ferma su ogni fotogramma e lo si analizza.
  // Più lento della riproduzione "al volo", ma preciso anche su telefoni lenti
  // e ripetibile (stesso video → stesso verdetto).
  const fps = total > 20 ? 15 : 20;
  const frames = [];
  let lastLm = null, raf = 0, alive = true;
  const anim = () => { if (!alive) return; drawScan(canvas, lastLm); raf = requestAnimationFrame(anim); };
  anim();
  for (let t = 0; t <= total + 1e-6; t += 1 / fps) {
    if (document.body.dataset.screen !== 'scan') { alive = false; return; } // l'utente è tornato indietro
    await seekTo(video, Math.min(t, Math.max(0, total - 0.02)));
    let lm = null;
    try { lm = toLm(model.detectForVideo(video, nextTs())); } catch (e) { console.warn(e); }
    frames.push({ t: video.currentTime, lm });
    if (lm) lastLm = lm;
    const pct = Math.min(100, Math.round(t / total * 100));
    $('scan-bar').style.width = pct + '%'; $('scan-pct').textContent = pct + '%';
  }
  alive = false; cancelAnimationFrame(raf);
  const clean = frames.filter((f, i) => i === 0 || f.t > frames[i - 1].t + 1e-4);
  const result = LIFTS[state.lift].analyze(clean, vw, vh);
  if (total >= MAX_SECONDS) result.warnings.unshift(`Ho analizzato solo i primi ${MAX_SECONDS} secondi: per i prossimi video taglia il pezzo con l'alzata.`);
  showResult(result, clean, url, blob);
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
      if ('requestVideoFrameCallback' in video) { video.requestVideoFrameCallback(() => finish()); setTimeout(finish, 120); }
      else finish();
    };
    video.addEventListener('seeked', onSeeked);
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) { finish(); return; }
    video.currentTime = t;
    setTimeout(finish, 2500);
  });
}

// ── risultato + replay ──────────────────────────
function showResult(result, frames, url, blob) {
  state.result = { result, frames };
  show('result');
  const v = $('verdict');
  v.className = 'verdict ' + result.verdict;
  const text = { good: 'GOOD LIFT', norep: 'NO REP', unclear: 'NON RIESCO A GIUDICARE' }[result.verdict];
  $('vtext').textContent = text;
  const firstFail = result.checks.find(c => c.status === 'fail');
  $('vsub').textContent = result.verdict === 'good' ? `${LIFTS[result.lift].name} valido.` : result.verdict === 'norep' ? firstFail.detail : result.warnings[0];
  $('vbadge').hidden = !(result.verdict === 'good' && result.missing);
  requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add('show')));

  const icon = { pass: '✓', fail: '✕', unknown: '–' };
  $('checks').innerHTML = result.checks.map((c, i) => `<li><button class="check ${c.status}" data-i="${i}"><span class="ci">${icon[c.status]}</span><span><b>${c.label}</b><span>${c.status === 'unknown' ? 'Non visibile: ' + c.detail : c.detail}</span></span></button></li>`).join('');
  const warns = result.verdict === 'unclear' ? result.warnings.slice(1) : result.warnings;
  $('warns').innerHTML = warns.map(w => `<li>${w}</li>`).join('');

  if (blob) {
    const a = $('save-video'); a.hidden = false; a.href = url;
    a.download = `goodlift-${result.lift}-${new Date().toISOString().slice(0, 10)}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
  }
  setupReplay(url, result, frames);
  $('checks').querySelectorAll('.check').forEach(b => b.addEventListener('click', () => {
    const c = result.checks[+b.dataset.i];
    if (c.t) seekReplay(Math.max(0, c.t[0] - 0.3), true);
  }));
}

const replay = { video: null, raf: 0, keyPaused: false, slow: true };
function setupReplay(url, result, frames) {
  const video = $('replay-video'), canvas = $('replay-canvas');
  replay.video = video; replay.keyPaused = false;
  video.src = url; video.muted = true; video.playsInline = true; video.loop = false;
  video.onloadeddata = () => {
    setAspect($('replay-stage'), video);
    video.playbackRate = replay.slow ? 0.5 : 1;
    video.play().catch(() => {});
  };
  $('rp-slow').classList.toggle('on', replay.slow);
  cancelAnimationFrame(replay.raf);
  const draw = () => {
    drawReplay(canvas, video, result, frames);
    const k = result.key?.bottom;
    if (k != null && !replay.keyPaused && !video.paused && video.currentTime >= k) {
      replay.keyPaused = true; video.pause();
      setTimeout(() => { if (document.body.dataset.screen === 'result') video.play().catch(() => {}); }, 1400);
    }
    replay.raf = requestAnimationFrame(draw);
  };
  draw();
}
function seekReplay(t, pause) {
  const v = replay.video; if (!v) return;
  replay.keyPaused = true;
  v.currentTime = t;
  if (pause) v.pause(); else v.play().catch(() => {});
  $('replay-stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('rp-play').addEventListener('click', () => { const v = replay.video; if (!v) return; replay.keyPaused = false; v.currentTime = 0; v.playbackRate = replay.slow ? 0.5 : 1; v.play().catch(() => {}); });
$('rp-slow').addEventListener('click', () => { replay.slow = !replay.slow; $('rp-slow').classList.toggle('on', replay.slow); if (replay.video) replay.video.playbackRate = replay.slow ? 0.5 : 1; });
$('rp-key').addEventListener('click', () => { const k = state.result?.result.key?.bottom; if (k != null) seekReplay(k, true); });

function nearest(ts, t) {
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; }
  return lo > 0 && Math.abs(ts[lo - 1] - t) < Math.abs(ts[lo] - t) ? lo - 1 : lo;
}
function drawReplay(canvas, video, result, frames) {
  const { ctx, w, h, dpr } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!result.replay || !frames.length || !video.videoWidth) return;
  const { t: ts, series, femur, bar, barSource } = result.replay;
  const now = video.currentTime, i = nearest(ts, now);
  const sx = w / video.videoWidth, sy = h / video.videoHeight;
  const P = p => p && { x: p.x * sx, y: p.y * sy };

  drawSkeleton(ctx, frames[i]?.lm, w, h, { color: WHITE, width: 1.6, alpha: .45, dpr });

  // traiettoria del "bilanciere"
  const t0 = result.key.descStart ?? ts[0];
  const src = barSource === 'spalla' ? series.S : series.H;
  const noDrop = result.checks.find(c => c.id === 'noDrop');
  ctx.save(); ctx.strokeStyle = GOLD; ctx.lineWidth = 3 * dpr; ctx.globalAlpha = .85; ctx.lineJoin = 'round';
  ctx.beginPath(); let started = false;
  for (let k = 0; k <= i; k++) {
    if (ts[k] < t0 || !src[k] || !Number.isFinite(bar[k])) continue;
    const x = src[k].x * sx, y = bar[k] * sy;
    started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true;
  }
  ctx.stroke(); ctx.restore();
  if (noDrop?.status === 'fail' && now >= noDrop.t[0]) {
    const k = nearest(ts, noDrop.t[0]);
    if (src[k]) {
      ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(src[k].x * sx, bar[k] * sy, 16 * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      tag(ctx, 'IL BILANCIERE SCENDE', src[k].x * sx + 20 * dpr, bar[k] * sy, dpr, RED);
    }
  }

  // femore + riferimento del parallelo
  const H = P(series.H[i]), K = P(series.K[i]);
  const depth = result.checks.find(c => c.id === 'depth');
  if (H && K) {
    const nearBottom = Math.abs(now - result.key.bottom) < 0.45;
    const col = depth?.status === 'fail' && nearBottom ? RED : GOLD;
    if (nearBottom) {
      ctx.save(); ctx.setLineDash([8 * dpr, 7 * dpr]); ctx.strokeStyle = 'rgba(245,245,240,.75)'; ctx.lineWidth = 1.5 * dpr;
      // linea di soglia: l'anca deve arrivare qui (già corretta per la posizione del punto "anca" del modello)
      const yLine = K.y + Math.tan(SQUAT.depthMinDeg * Math.PI / 180) * Math.abs(H.x - K.x);
      ctx.beginPath(); ctx.moveTo(0, yLine); ctx.lineTo(w, yLine); ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 5 * dpr; ctx.lineCap = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 10 * dpr;
    ctx.beginPath(); ctx.moveTo(H.x, H.y); ctx.lineTo(K.x, K.y); ctx.stroke(); ctx.restore();
    if (nearBottom && Number.isFinite(femur[i])) {
      const f = femur[i];
      const over = f - SQUAT.depthMinDeg;
      const label = over >= SQUAT.depthBorderlineDeg ? 'PROFONDITÀ OK' : over >= 0 ? 'PROFONDITÀ AL LIMITE' : `ALTO DI ${Math.max(1, Math.round(-over))}°`;
      tag(ctx, label, Math.min(H.x, K.x), Math.max(H.y, K.y) + 26 * dpr, dpr, col);
    }
  }

  // fermi: cronometro durante i secondi di fermo
  for (const c of result.checks) {
    if (!['startHold', 'endHold'].includes(c.id) || !c.t) continue;
    if (now >= c.t[0] && now <= c.t[1] + 0.25) {
      const sec = Math.min(now - c.t[0], c.t[1] - c.t[0]);
      tag(ctx, `FERMO ${sec.toFixed(1).replace('.', ',')} s${now > c.t[1] ? (c.status === 'pass' ? ' ✓' : ' ✕') : ''}`, 14 * dpr, 24 * dpr, dpr, c.status === 'fail' ? RED : GOLD);
    }
  }
  corners(ctx, w, h, dpr);
}

// ── modalità live ───────────────────────────────
async function startLive() {
  show('live');
  $('live-error').textContent = ''; $('live-msg').textContent = 'Accendo la fotocamera…';
  $('rec-lift').textContent = LIFTS[state.lift].name.toUpperCase();
  const video = $('live-video');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
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
  state.live = { stream, rec: null, chunks: [], startedAt: 0, timer: 0, phase: 'wait', hist: [], spoke: 0 };
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
      try { lm = toLm(model.detectForVideo(video, nextTs())); } catch { /* frame non pronto */ }
      const { ctx, w, h, dpr } = fitCanvas(canvas);
      ctx.clearRect(0, 0, w, h);
      corners(ctx, w, h, dpr);
      drawSkeleton(ctx, lm, w, h, { glow: 10, width: 2.4, dpr });
      $('live-msg').textContent = lm ? '' : 'Non ti vedo: mettiti di lato, con tutto il corpo nell\'inquadratura.';
      if (lm) voiceCoach(lm, video.videoWidth, video.videoHeight, now / 1000);
    }
    requestAnimationFrame(loop);
  };
  loop();
}

// Comandi vocali (opzionali): come in gara, prima il fermo di 1 s, poi il comando.
function say(word) {
  try {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US'; u.rate = 1; u.volume = 1;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* sintesi vocale non disponibile */ }
}
function voiceCoach(lm, vw, vh, t) {
  const L = state.live;
  if (!L?.rec || !$('voice').checked || state.lift !== 'squat') return;
  const s = sideOf(lm);
  if ((lm[s.K].visibility ?? 0) < 0.5 || (lm[s.A].visibility ?? 0) < 0.5) return;
  const knee = angle(lm[s.H], lm[s.K], lm[s.A], vw, vh);
  const body = Math.hypot((lm[s.S].x - lm[s.A].x) * vw, (lm[s.S].y - lm[s.A].y) * vh) || vh * 0.7;
  L.hist.push({ t, knee, hx: lm[s.H].x * vw, hy: lm[s.H].y * vh, ax: lm[s.A].x * vw });
  L.hist = L.hist.filter(p => t - p.t <= 1.1);
  const span = L.hist.length ? t - L.hist[0].t : 0;
  const rng = k => Math.max(...L.hist.map(p => p[k])) - Math.min(...L.hist.map(p => p[k]));
  const lockedStill = span >= 0.95 && L.hist.every(p => p.knee >= SQUAT.lockoutKneeDeg) && rng('hy') < SQUAT.stillRatio * body && rng('hx') < SQUAT.stillRatio * body && rng('ax') < SQUAT.stillRatio * body;
  const [startCmd, endCmd] = LIFTS[state.lift].commands;
  if (L.phase === 'wait' && lockedStill) { say(startCmd); L.phase = 'started'; }
  else if (L.phase === 'started' && knee < SQUAT.squattingKneeDeg) { L.phase = 'rep'; }
  else if (L.phase === 'rep' && lockedStill) { say(endCmd); L.phase = 'done'; L.doneAt = t; }
  else if (L.phase === 'done' && t - L.doneAt > 4) { L.phase = 'wait'; L.hist = []; }
}

function pickMime() {
  const opts = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return opts.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}
function toggleRec() {
  const L = state.live; if (!L) return;
  if (!L.rec) {
    if (!window.MediaRecorder) { $('live-error').textContent = 'Questo browser non può registrare video. Usa "Carica un video".'; return; }
    if ($('voice').checked) say(' '); // sblocca l'audio su iPhone (serve un tocco dell'utente)
    const mimeType = pickMime();
    const rec = new MediaRecorder(L.stream, mimeType ? { mimeType } : undefined);
    L.chunks = []; L.rec = rec; L.phase = 'wait'; L.hist = [];
    rec.ondataavailable = e => e.data.size && L.chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(L.chunks, { type: rec.mimeType || mimeType || 'video/webm' });
      const secs = (performance.now() - L.startedAt) / 1000;
      const url = URL.createObjectURL(blob); state.urls.push(url);
      stopLive();
      analyzeVideo(url, { recordedSec: secs, blob });
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
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f); state.urls.push(url);
  analyzeVideo(url);
});
$('rec').addEventListener('click', toggleRec);
$('voice').addEventListener('change', e => { if (e.target.checked) say(' '); });
// Precarica il giudice in background (non con "risparmio dati" attivo), così l'analisi parte subito.
// Il modello di analisi (~30 MB) si scarica appena l'utente sceglie cosa fare, non alla sola visita.
const preloadJudge = () => { if (!navigator.connection?.saveData) getModel('heavy').catch(() => {}); };
document.querySelectorAll('[data-preload]').forEach(el => el.addEventListener('pointerdown', preloadJudge, { once: true }));
