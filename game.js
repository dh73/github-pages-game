import {Ride, MODES, LENGTH, PHOTOS, photoAt, streetURL, clamp, readRecord, saveRecord} from './ride-core.mjs?v=release-2';

const $ = id => document.getElementById(id);
const ui = $('game');
const ride = new Ride();
const input = Object.fromEntries(['gas', 'brake', 'left', 'right'].map(key => [key, new Set()]));
const held = () => Object.fromEntries(Object.entries(input).map(([key, values]) => [key, values.size > 0]));
let screen = 'intro', countdown = 0, last = 0, hudClock = 0, toastTimer = 0, wakeLock = null;
let buffering = true, photoIndex = 0, width = 1, height = 1, particles = [], impact = 0;
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = $('course'), ctx = canvas.getContext('2d');

// Three bounded native embeds; no copied Google imagery, keys, or map fallback.
class StreetPhotos {
  constructor(container) { this.container = container; this.slots = []; this.epoch = 0; this.active = null; }
  dispose(slot) {
    clearTimeout(slot.timeout); clearTimeout(slot.settle);
    slot.frame.onload = null; slot.frame.remove();
    this.slots = this.slots.filter(s => s !== slot);
    if (this.active === slot) this.active = null;
  }
  reset(index) {
    this.epoch++;
    [...this.slots].forEach(slot => this.dispose(slot));
    this.ensure(index); this.ensure(index + 1);
  }
  ensure(index) {
    if (!PHOTOS[index]) return null;
    let slot = this.slots.find(s => s.index === index);
    if (slot) return slot;
    if (this.slots.length >= 3) {
      const disposable = s => s !== this.active && performance.now() >= s.retireAt;
      const victim = this.slots.find(s => disposable(s) && s.index < index - 1) || this.slots.find(s => disposable(s) && Math.abs(s.index - index) > 1);
      if (!victim) return null;
      this.dispose(victim);
    }
    const frame = document.createElement('iframe');
    frame.title = `Google Street View · Vicente Guerrero · tramo ${index + 1}`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.loading = 'eager'; frame.allow = 'fullscreen';
    frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
    const epoch = this.epoch;
    slot = {index, frame, ready: false, failed: false, timeout: 0, settle: 0, retireAt: 0};
    this.slots.push(slot);
    const current = () => this.epoch === epoch && this.slots.includes(slot);
    slot.timeout = setTimeout(() => { if (current()) slot.failed = true; }, 25000);
    frame.onload = () => {
      if (!current()) return;
      clearTimeout(slot.settle);
      // Cross-origin onload confirms the document, not individual panorama tiles.
      // Keep manual repair available; live browser tests inspect Google's actual view.
      slot.settle = setTimeout(() => {
        if (!current()) return;
        clearTimeout(slot.timeout); slot.ready = true; slot.failed = false;
      }, 1300);
    };
    frame.src = streetURL(PHOTOS[index]);
    this.container.append(frame);
    return slot;
  }
  show(index) {
    const slot = this.ensure(index);
    if (!slot?.ready) return false;
    if (this.active !== slot) {
      if (this.active) this.active.retireAt = performance.now() + 350;
      this.active = slot;
      this.slots.forEach(s => {
        s.frame.classList.toggle('visible', s === slot);
        s.frame.setAttribute('aria-hidden', String(s !== slot));
        s.frame.tabIndex = s === slot ? 0 : -1;
      });
      photoIndex = index;
    }
    // A failed speculative preload never interrupts the current ride.
    this.ensure(index + 1); this.ensure(index + 2);
    return true;
  }
  failed(index) { return this.slots.some(s => s.index === index && s.failed); }
}
const photos = new StreetPhotos($('views'));

class Motor {
  constructor() { this.enabled = false; this.context = null; }
  async toggle() {
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return false;
        this.context = new Audio();
        this.volume = this.context.createGain(); this.volume.gain.value = 0;
        this.volume.connect(this.context.destination);
        this.filter = this.context.createBiquadFilter(); this.filter.type = 'lowpass';
        this.filter.frequency.value = 210; this.filter.connect(this.volume);
        this.motor = this.context.createOscillator(); this.motor.type = 'sawtooth';
        this.motor.frequency.value = 38; this.motor.connect(this.filter); this.motor.start();
        this.lfo = this.context.createOscillator(); this.lfo.frequency.value = 9;
        const tremolo = this.context.createGain(); tremolo.gain.value = 3;
        this.lfo.connect(tremolo); tremolo.connect(this.motor.frequency); this.lfo.start();
      }
      await this.context.resume(); this.enabled = !this.enabled;
    } catch { this.enabled = false; }
    return this.enabled;
  }
  update(speed, playing, gas) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.motor.frequency.setTargetAtTime(38 + speed * 8 + (gas ? 12 : 0), now, .13);
    this.filter.frequency.setTargetAtTime(190 + speed * 38, now, .13);
    this.volume.gain.setTargetAtTime(this.enabled && playing ? .018 + speed * .004 : 0, now, .08);
  }
  tone(hz, end = hz, duration = .18) {
    if (!this.context || !this.enabled) return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain(), now = this.context.currentTime;
    oscillator.frequency.setValueAtTime(hz, now); oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(.04, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain); gain.connect(this.context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(); oscillator.stop(now + duration + .01);
  }
}
const motor = new Motor();
const formatTime = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
function releaseInputs() {
  Object.values(input).forEach(value => value.clear());
  document.querySelectorAll('.drive').forEach(button => button.classList.remove('active'));
}
async function keepAwake() {
  try {
    if (!wakeLock && navigator.wakeLock && !document.hidden) {
      const lock = await navigator.wakeLock.request('screen');
      if (!['playing', 'countdown'].includes(screen)) { await lock.release(); return; }
      wakeLock = lock; lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    }
  } catch { /* Optional on devices without wake lock. */ }
}
function setScreen(value) {
  screen = value; ui.dataset.status = value;
  ui.classList.toggle('running', value === 'playing');
  for (const [id, key] of [['intro', 'intro'], ['pause-screen', 'paused'], ['finish', 'finished'], ['error-screen', 'error']]) $(id).hidden = value !== key;
  $('countdown').hidden = value !== 'countdown';
  $('pause').disabled = !['playing', 'paused', 'countdown'].includes(value);
  $('pause').setAttribute('aria-label', value === 'paused' ? 'Continuar' : 'Pausar');
  if (value !== 'playing') {
    releaseInputs(); motor.update(0, false, false);
    if (wakeLock && value !== 'countdown') { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  $('pedal-controls').inert = value !== 'playing';
  renderHUD();
}
function notify(text) {
  $('toast').textContent = text; $('toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1600);
}
function recordLabel() {
  const best = readRecord(storage, ride.mode);
  $('best').textContent = best ? `TU RÉCORD · ${best.score} pts · ${formatTime(best.time)}` : 'TU PRIMERA VUELTA EMPIEZA AQUÍ';
}
function selectMode(mode) {
  if (screen !== 'intro') return;
  ride.reset(mode);
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === ride.mode)));
  $('mission').textContent = mode === 'paseo' ? 'Recoge 8 sellos y disfruta la calle. Sin reloj, sin conos.' : '8 sellos, 90 segundos. Esquiva los conos y encadena una vuelta perfecta.';
  recordLabel(); renderHUD();
}
function reset(mode = ride.mode) {
  ride.reset(mode); countdown = 0; buffering = true; photoIndex = 0; particles = []; impact = 0;
  photos.reset(0); $('loading').hidden = false; $('start').disabled = true;
  $('start').textContent = 'Cargando la calle…'; clearTimeout(toastTimer); $('toast').classList.remove('show');
  setScreen('intro'); selectMode(mode); last = performance.now();
}
function begin() {
  if (screen === 'paused') {
    if (buffering) return;
    ride.play(); setScreen('playing'); keepAwake(); motor.context?.resume().catch(() => {}); return;
  }
  if (screen !== 'intro' || buffering) return;
  countdown = 3; $('countdown').textContent = '3';
  setScreen('countdown'); keepAwake(); motor.context?.resume().catch(() => {}); motor.tone(440);
}
function pause() {
  if (!['playing', 'countdown'].includes(screen)) return;
  ride.pause(); countdown = 0; setScreen('paused');
}
function error(message = 'La calle está tardando en cargar. Tu avance sigue guardado en esta vuelta.') {
  ride.pause(); buffering = true; $('loading').hidden = true;
  $('error-message').textContent = message; setScreen('error');
}
function repair() {
  const index = photoAt(ride.distance);
  photos.reset(index); buffering = true; $('loading').hidden = false; $('resume').disabled = true;
  if (ride.distance === 0 && ride.elapsed === 0) {
    setScreen('intro'); $('start').disabled = true; $('start').textContent = 'Cargando la calle…';
  } else {
    ride.pause(); setScreen('paused');
    notify('Recargando la vista · tu avance se conserva');
  }
}
function finish() {
  const record = saveRecord(storage, ride);
  setScreen('finished'); $('loading').hidden = true;
  $('finish-title').textContent = ride.status === 'won' ? (ride.stars === 3 ? '¡Vuelta perfecta!' : '¡Llegaste!') : 'Se acabó el tiempo';
  $('finish-eyebrow').textContent = record ? 'NUEVO RÉCORD PERSONAL' : ride.status === 'won' ? 'TRAMO COMPLETADO' : 'RETO 92';
  $('result-stars').textContent = '★'.repeat(ride.stars) + '☆'.repeat(3 - ride.stars);
  $('result-stars').setAttribute('aria-label', `${ride.stars} de 3 estrellas`);
  $('result-score').textContent = ride.score;
  $('result').textContent = `${ride.collected}/8 sellos · ${ride.hits} golpes · ${formatTime(ride.elapsed)} · ${Math.round(ride.distance)} m`;
  $('result-tip').textContent = ride.status === 'lost' ? 'Mantén ACELERA y suelta antes de corregir la dirección. Prueba Paseo para practicar.' : ride.stars === 3 ? 'De principio a fin, con puro estilo sinaloense.' : 'Consigue los 8 sellos sin tocar conos para ganar las tres estrellas.';
  motor.tone(523, ride.status === 'won' ? 1046 : 196, .45);
}
function update(dt) {
  if (screen === 'intro' || screen === 'paused') {
    if (photos.show(photoAt(ride.distance))) {
      buffering = false; $('loading').hidden = true;
      $('start').disabled = false; $('start').textContent = 'Encender y salir';
      $('resume').disabled = false;
    } else {
      $('resume').disabled = true;
      if (photos.failed(photoAt(ride.distance))) error();
    }
    return;
  }
  if (screen === 'countdown') {
    const previous = Math.ceil(countdown); countdown -= dt;
    $('countdown').textContent = countdown > 0 ? Math.ceil(countdown) : '¡VAMOS!';
    if (countdown <= 0) { ride.play(); setScreen('playing'); motor.tone(880); }
    else if (Math.ceil(countdown) !== previous) motor.tone(440);
    return;
  }
  if (screen !== 'playing') return;
  const events = ride.step(dt, held(), index => {
    const ready = photos.show(index);
    if (!ready && photos.failed(index)) error();
    return ready;
  });
  buffering = events.some(e => e.kind === 'buffer');
  $('loading').hidden = !buffering || screen === 'error';
  for (const event of events) {
    if (event.kind === 'seal') {
      notify(`+${event.points} · sello ${ride.collected}/8${ride.combo > 1 ? ` · combo ×${ride.combo}` : ''}`);
      motor.tone(660, 990, .2); vibrate(16); burst(event.lane);
    } else if (event.kind === 'hit') { notify('¡Cono! −50 puntos · recupera el control'); impact = .6; motor.tone(110, 55, .2); vibrate([30, 30, 30]); }
    else if (event.kind === 'miss') notify('Sello perdido · alinea las ruedas con el aro');
    else if (event.kind === 'finish') finish();
  }
}
function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch {} }
function span() { return Math.max(30, Math.min(width * .28, 200, (width - $('rider').offsetWidth - 92) / 2)); }
function ground() { return Math.max(height * .55, height - 77); }
function burst(lane) {
  if (reducedMotion) return;
  for (let i = 0; i < 14; i++) particles.push({x: width / 2 + lane * span(), y: ground() - 34, vx: (Math.random() - .5) * 170, vy: -40 - Math.random() * 120, life: .6});
  particles = particles.slice(-42);
}
function resize() {
  const r = $('street').getBoundingClientRect(); width = Math.max(1, r.width); height = Math.max(1, r.height);
  const ratio = Math.min(devicePixelRatio || 1, 1.6);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); particles = [];
}
function drawCourse(dt) {
  ctx.clearRect(0, 0, width, height);
  if (screen !== 'playing') return;
  const horizon = height * .49, floor = ground(), half = span();
  for (let i = ride.objects.length - 1; i >= 0; i--) {
    const o = ride.objects[i], d = o.distance - ride.distance;
    if (o.passed || d < 0 || d > 65) continue;
    const p = 10 / (d + 10), x = width / 2 + o.lane * half * p, y = horizon + (floor - horizon) * p;
    const radius = clamp(Math.min(width * .065, 31) * p, 3, 31);
    ctx.save(); ctx.globalAlpha = Math.min(1, (65 - d) / 15);
    ctx.fillStyle = '#090d1060'; ctx.beginPath(); ctx.ellipse(x, y, radius * 1.3, radius * .23, 0, 0, 2 * Math.PI); ctx.fill();
    if (o.kind === 'seal') {
      ctx.strokeStyle = '#ffb64f'; ctx.fillStyle = '#fff0bd'; ctx.lineWidth = Math.max(2, radius * .15);
      ctx.shadowColor = '#ffc26d'; ctx.shadowBlur = 9 * p;
      ctx.beginPath(); ctx.arc(x, y - radius * 1.5, radius, 0, 2 * Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - radius * 1.5, radius * .22, 0, 2 * Math.PI); ctx.fill();
    } else {
      ctx.fillStyle = '#ff7845'; ctx.strokeStyle = '#50291d'; ctx.lineWidth = Math.max(1, p * 2);
      ctx.beginPath(); ctx.moveTo(x, y - radius * 2.8); ctx.lineTo(x + radius, y - 3); ctx.lineTo(x - radius, y - 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff0d9'; ctx.beginPath(); ctx.moveTo(x - radius * .37, y - radius * 1.7); ctx.lineTo(x + radius * .37, y - radius * 1.7); ctx.lineTo(x + radius * .59, y - radius * 1.12); ctx.lineTo(x - radius * .59, y - radius * 1.12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3b3630'; ctx.fillRect(x - radius * 1.2, y - 4, radius * 2.4, Math.max(2, radius * .25));
    }
    ctx.shadowBlur = 0;
    if (o === ride.next) {
      const label = `${o.kind === 'cone' ? 'CONO · ' : ''}${Math.ceil(d)} m`;
      ctx.font = '700 11px system-ui'; ctx.textAlign = 'center';
      const tw = ctx.measureText(label).width + 14;
      ctx.fillStyle = '#151b1de0'; ctx.fillRect(x - tw / 2, y - radius * 3 - 23, tw, 19);
      ctx.fillStyle = '#fff1d2'; ctx.fillText(label, x, y - radius * 3 - 10);
    }
    ctx.restore();
  }
  if (LENGTH - ride.distance < 50) {
    const p = 10 / (LENGTH - ride.distance + 10), y = horizon + (floor - horizon) * p;
    const cell = Math.max(3, half * .17 * p);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 12; col++) {
      ctx.fillStyle = (row + col) % 2 ? '#172022cc' : '#fff7e5ee';
      ctx.fillRect(width / 2 + (col - 6) * cell, y + row * cell * .3, cell + .5, cell * .3 + .5);
    }
  }
  for (const p of particles) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt;
    if (p.y > height - 43) continue;
    ctx.globalAlpha = Math.max(0, p.life / .6); ctx.fillStyle = '#ffd28c'; ctx.fillRect(p.x, p.y, 3, 3);
  }
  ctx.globalAlpha = 1; particles = particles.filter(p => p.life > 0);
}
function renderHUD() {
  $('speed').textContent = buffering || screen !== 'playing' ? '0' : String(Math.round(ride.speed * 3.6));
  $('gear').textContent = ride.speed < .5 ? 'N' : ride.speed < 3.5 ? '1' : ride.speed < 6.5 ? '2' : '3';
  $('collected').textContent = ride.collected; $('score').textContent = ride.score;
  $('clock').textContent = formatTime(ride.remaining === null ? ride.elapsed : Math.ceil(ride.remaining));
  $('clock').classList.toggle('urgent', ride.remaining !== null && ride.remaining < 15);
  $('clock').setAttribute('aria-label', ride.remaining === null ? 'Tiempo transcurrido' : 'Tiempo restante');
  $('distance').textContent = `${Math.round(ride.distance)} m`;
  $('remaining').textContent = `${Math.max(0, Math.round(LENGTH - ride.distance))} m`;
  $('progress').style.width = `${ride.distance / LENGTH * 100}%`;
  const next = ride.next;
  $('next-object').textContent = next ? `${next.kind === 'cone' ? 'ESQUIVA' : 'SELLO'} ${next.lane < -.15 ? '←' : next.lane > .15 ? '→' : '↑'} ${Math.ceil(next.distance - ride.distance)} m` : 'META';
  Object.assign(ui.dataset, {distance: ride.distance.toFixed(3), speed: ride.speed.toFixed(3), lane: ride.lane.toFixed(3), photo: String(photoIndex), buffering: String(buffering), score: String(ride.score), collected: String(ride.collected), hits: String(ride.hits), elapsed: ride.elapsed.toFixed(3), mode: ride.mode});
  Object.assign($('next-object').dataset, {lane: String(next?.lane ?? 0), kind: next?.kind || 'finish', distance: String(next ? next.distance - ride.distance : LENGTH - ride.distance)});
}
function frame(now) {
  const dt = clamp((now - (last || now)) / 1000, 0, .05); last = now;
  update(dt); drawCourse(dt); impact = Math.max(0, impact - dt);
  const bounce = !reducedMotion && screen === 'playing' && !buffering ? Math.sin(ride.distance * 3) * Math.min(2, ride.speed * .3) + Math.sin(now * .09) * impact * 4 : 0;
  $('rider').style.transform = `translateX(calc(-50% + ${(ride.lane * span()).toFixed(2)}px)) translateY(${bounce.toFixed(2)}px) rotate(${(-ride.steer * 5).toFixed(2)}deg)`;
  motor.update(buffering ? 0 : ride.speed, screen === 'playing' && !buffering, input.gas.size > 0);
  hudClock += dt; if (hudClock >= .08) { renderHUD(); hudClock = 0; }
  requestAnimationFrame(frame);
}

for (const button of document.querySelectorAll('.drive')) {
  const key = button.dataset.key;
  button.addEventListener('pointerdown', e => {
    e.preventDefault(); if (screen !== 'playing') return;
    input[key].add(`pointer-${e.pointerId}`); button.classList.add('active');
    try { button.setPointerCapture(e.pointerId); } catch {}
  });
  const release = e => { input[key].delete(`pointer-${e.pointerId}`); button.classList.toggle('active', input[key].size > 0); };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
  button.addEventListener('contextmenu', e => e.preventDefault());
}
const keys = {ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'gas', w: 'gas', ArrowDown: 'brake', s: 'brake', ' ': 'brake'};
window.addEventListener('keydown', e => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (keys[key] && screen === 'playing') { e.preventDefault(); input[keys[key]].add(`key-${key}`); }
  if (e.repeat) return;
  if (key === 'Escape' || key === 'p') screen === 'paused' ? begin() : pause();
  if (key === 'r' && ['playing', 'paused', 'finished'].includes(screen)) reset();
});
window.addEventListener('keyup', e => {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (keys[key]) input[keys[key]].delete(`key-${key}`);
});
// Native iframe focus is not a tab switch. Never re-pause a Resume tap on blur.
window.addEventListener('blur', releaseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseInputs(); pause(); } });
window.addEventListener('pagehide', () => { releaseInputs(); pause(); });
window.addEventListener('offline', () => { if (screen !== 'finished') error('Sin conexión. Tu vuelta está pausada; reconecta y pulsa Reintentar.'); });
window.addEventListener('online', () => { if (screen === 'error') notify('Conexión recuperada · pulsa Reintentar'); });
function action(id, callback) {
  $(id).addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); callback(); });
}
action('start', begin); action('resume', begin); action('pause', () => screen === 'paused' ? begin() : pause());
for (const id of ['restart', 'restart-pause', 'restart-error']) action(id, () => reset());
action('retry', repair); action('repair', repair); action('repair-intro', repair);
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => selectMode(b.dataset.mode)));
action('sound', async () => {
  const enabled = await motor.toggle(); $('sound').setAttribute('aria-pressed', String(enabled));
  $('sound').setAttribute('aria-label', enabled ? 'Silenciar motor' : 'Activar sonido del motor');
  $('sound').classList.toggle('enabled', enabled);
});
action('fullscreen', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (ui.requestFullscreen) await ui.requestFullscreen();
    else notify('Gira tu pantalla para una vista más amplia');
  } catch { notify('Tu navegador no permite pantalla completa'); }
});
window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('street'));
resize(); reset(); requestAnimationFrame(frame);
