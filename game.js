'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const radians = degrees => degrees * Math.PI / 180;
  // Vicente Guerrero (also Avenida Pípila), Ayuntamiento 92. OSM way 121992510.
  // Only the residential road is used, not its northern pedestrian continuation.
  const road = [
    [25.5928919, -108.4716018], [25.5919436, -108.4711411],
    [25.5909721, -108.4707038], [25.5901240, -108.4702804],
    [25.5893078, -108.4698643]
  ];
  function metres(a, b) {
    const dLat = radians(b[0] - a[0]);
    const dLng = radians(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLng / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
  }
  const cumulative = [0];
  for (let i = 1; i < road.length; i++) cumulative.push(cumulative[i - 1] + metres(road[i - 1], road[i]));
  const total = cumulative.at(-1) - 18;
  function pointAt(distance) {
    const d = clamp(distance + 9, 0, cumulative.at(-1));
    let segment = 0;
    while (segment < road.length - 2 && d > cumulative[segment + 1]) segment++;
    const a = road[segment], b = road[segment + 1];
    const t = (d - cumulative[segment]) / (cumulative[segment + 1] - cumulative[segment]);
    const bearing = Math.atan2((b[1] - a[1]) * Math.cos(radians(a[0])), b[0] - a[0]) * 180 / Math.PI;
    return {lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, heading: (bearing + 360) % 360};
  }
  const step = 17;
  const locations = Array.from({length: Math.ceil(total / step) + 1}, (_, i) => ({distance: Math.min(i * step, total), ...pointAt(Math.min(i * step, total))}));

  class StreetPhotos {
    constructor(container, onFailure) {
      this.container = container;
      this.onFailure = onFailure;
      this.active = null;
      this.generation = 0;
      this.timers = new Set();
      this.slots = [];
    }
    later(callback, delay) {
      const id = setTimeout(() => { this.timers.delete(id); callback(); }, delay);
      this.timers.add(id);
      return id;
    }
    reset(index = 0) {
      this.generation++;
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
      this.container.replaceChildren();
      this.active = null;
      this.slots = [0, 1].map(() => {
        const frame = document.createElement('iframe');
        frame.title = 'Google Street View · Vicente Guerrero, Guasave';
        frame.referrerPolicy = 'no-referrer-when-downgrade';
        frame.loading = 'eager';
        frame.allow = 'fullscreen';
        frame.setAttribute('allowfullscreen', '');
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        return {frame, index: -1, ready: false, loading: false, token: 0};
      });
      this.load(this.slots[0], index);
      if (index + 1 < locations.length) this.load(this.slots[1], index + 1);
    }
    load(slot, index) {
      if (!locations[index] || slot.index === index) return;
      slot.index = index;
      slot.ready = false;
      slot.loading = true;
      const token = ++slot.token, generation = this.generation;
      const isCurrent = () => generation === this.generation && token === slot.token;
      const location = locations[index];
      // Native Google embed: imagery stays on Google's servers with its attribution.
      // No tiles are copied, no API key is embedded, and no map fallback is used.
      const url = new URL('https://maps.google.com/maps');
      url.search = new URLSearchParams({
        layer: 'c', cbll: `${location.lat.toFixed(7)},${location.lng.toFixed(7)}`,
        cbp: `12,${location.heading.toFixed(1)},,0,0`, source: 'embed', output: 'svembed', hl: 'es'
      }).toString();
      const timeout = this.later(() => {
        if (isCurrent() && !slot.ready) { slot.loading = false; this.onFailure(); }
      }, 30000);
      slot.frame.onload = () => {
        if (!isCurrent()) return;
        // The iframe load event precedes some of Google's image requests.
        this.later(() => {
          if (!isCurrent()) return;
          clearTimeout(timeout);
          this.timers.delete(timeout);
          slot.ready = true;
          slot.loading = false;
        }, 1600);
      };
      slot.frame.onerror = () => { if (isCurrent()) this.onFailure(); };
      slot.frame.src = url.toString();
      if (!slot.frame.isConnected) this.container.append(slot.frame);
    }
    show(index) {
      if (this.active?.index === index) return true;
      const slot = this.slots.find(item => item.index === index);
      if (!slot?.ready) return false;
      const previous = this.active;
      this.active = slot;
      for (const item of this.slots) {
        item.frame.classList.toggle('visible', item === slot);
        item.frame.setAttribute('aria-hidden', String(item !== slot));
        item.frame.tabIndex = item === slot ? 0 : -1;
      }
      const generation = this.generation;
      if (previous && index + 1 < locations.length) this.later(() => {
        if (generation === this.generation && this.active === slot) this.load(previous, index + 1);
      }, 500);
      return true;
    }
  }

  class EngineAudio {
    constructor() { this.enabled = false; this.context = null; }
    async toggle() {
      try {
        if (!this.context) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return false;
          this.context = new AudioContext();
          this.volume = this.context.createGain();
          this.volume.gain.value = 0;
          this.volume.connect(this.context.destination);
          this.filter = this.context.createBiquadFilter();
          this.filter.type = 'lowpass';
          this.filter.frequency.value = 260;
          this.filter.connect(this.volume);
          this.motor = this.context.createOscillator();
          this.motor.type = 'sawtooth';
          this.motor.frequency.value = 38;
          this.motor.connect(this.filter);
          this.motor.start();
          this.lfo = this.context.createOscillator();
          const tremolo = this.context.createGain();
          tremolo.gain.value = 3;
          this.lfo.frequency.value = 9;
          this.lfo.connect(tremolo);
          tremolo.connect(this.motor.frequency);
          this.lfo.start();
        }
        await this.context.resume();
        this.enabled = !this.enabled;
        return this.enabled;
      } catch { return false; }
    }
    update(speed, driving, gas) {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.motor.frequency.setTargetAtTime(38 + speed * 8 + (gas ? 12 : 0), now, .12);
      this.filter.frequency.setTargetAtTime(190 + speed * 38, now, .12);
      this.volume.gain.setTargetAtTime(this.enabled && driving ? .018 + speed * .004 : 0, now, .1);
    }
    chime() {
      if (!this.context || !this.enabled) return;
      const oscillator = this.context.createOscillator(), gain = this.context.createGain(), now = this.context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.exponentialRampToValueAtTime(990, now + .13);
      gain.gain.setValueAtTime(.045, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .28);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start();
      oscillator.stop(now + .3);
    }
  }

  const state = {status: 'intro', distance: 0, speed: 0, lane: 0, steer: 0, elapsed: 0, score: 0, frame: 0, buffer: true, waitingFrame: null, last: 0};
  const input = {left: new Set(), right: new Set(), gas: new Set(), brake: new Set()};
  const held = key => input[key].size > 0;
  const audio = new EngineAudio();
  const photos = new StreetPhotos($('views'), fail);
  const canvas = $('course'), ctx = canvas.getContext('2d');
  let width = 1, height = 1, hudTime = 0, toastTimer;
  const lanes = [0, .46, -.46, 0, .48, -.48, .38, 0];
  const gates = lanes.map((lane, i) => ({lane, distance: total * (i + 1) / 9, taken: false, passed: false}));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function releaseAll() {
    for (const value of Object.values(input)) value.clear();
    document.querySelectorAll('.drive').forEach(button => button.classList.remove('active'));
  }
  function setStatus(status) {
    state.status = status;
    $('game').dataset.status = status;
    $('game').classList.toggle('running', status === 'playing');
    $('intro').hidden = status !== 'intro';
    $('pause-screen').hidden = status !== 'paused';
    $('finish').hidden = status !== 'finished';
    $('error-screen').hidden = status !== 'error';
    if (status !== 'playing') releaseAll();
  }
  function message(text) {
    $('toast').textContent = text;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1900);
  }
  function fail() {
    if (state.status === 'finished') return;
    state.speed = 0;
    state.buffer = true;
    $('loading').hidden = true;
    setStatus('error');
  }
  function start() {
    if ((state.buffer && state.status === 'intro') || state.status === 'error') return;
    state.last = performance.now();
    setStatus('playing');
    message('Vicente Guerrero · Ayuntamiento 92');
  }
  function pause() {
    if (state.status !== 'playing') return;
    state.speed = 0;
    setStatus('paused');
  }
  function reset() {
    releaseAll();
    Object.assign(state, {distance: 0, speed: 0, lane: 0, steer: 0, elapsed: 0, score: 0, frame: 0, buffer: true, waitingFrame: null});
    clearTimeout(toastTimer);
    $('toast').classList.remove('show');
    gates.forEach(gate => { gate.taken = false; gate.passed = false; });
    $('collected').textContent = '0';
    $('start').disabled = true;
    $('start').textContent = 'Preparando recorrido…';
    $('loading').hidden = false;
    photos.reset(0);
    setStatus('intro');
    renderHUD();
  }
  function finish() {
    state.speed = 0;
    setStatus('finished');
    $('result').textContent = `${state.score} de 8 sellos · ${Math.round(total)} m · ${formatTime(state.elapsed)}. ${state.score === 8 ? '¡Recorrido perfecto!' : 'Otra vuelta para recogerlos todos.'}`;
    audio.chime();
  }
  function formatTime(seconds) {
    const value = Math.floor(seconds);
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }
  function resize() {
    const bounds = $('street').getBoundingClientRect();
    width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
    const scale = Math.min(window.devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  function tick(dt) {
    if (state.status === 'intro') {
      if (photos.show(state.frame)) {
        state.buffer = false;
        $('loading').hidden = true;
        $('start').disabled = false;
        $('start').textContent = 'Encender y salir';
      }
      return;
    }
    if (state.status !== 'playing') return;
    if (state.waitingFrame !== null) {
      if (!photos.show(state.waitingFrame)) return;
      state.distance = Math.max(state.distance, locations[state.waitingFrame].distance);
      state.frame = state.waitingFrame;
      state.waitingFrame = null;
      state.buffer = false;
      $('loading').hidden = true;
    }
    const direction = Number(held('right')) - Number(held('left'));
    state.steer += (direction - state.steer) * Math.min(1, dt * 9);
    state.lane = clamp(state.lane + state.steer * dt * (.55 + state.speed * .06), -.85, .85);
    let speed = state.speed;
    if (held('brake')) speed -= dt * 7;
    else if (held('gas')) speed += dt * 2.5;
    else speed -= dt * 1.45;
    speed = clamp(speed, 0, 8.3);
    const nextDistance = Math.min(total, state.distance + speed * dt);
    const nextFrame = Math.min(locations.length - 1, Math.floor(nextDistance / step));
    if (!photos.show(nextFrame)) {
      state.waitingFrame = nextFrame;
      state.speed = 0;
      state.buffer = true;
      $('loading').hidden = false;
      return;
    }
    state.buffer = false;
    $('loading').hidden = true;
    state.frame = nextFrame;
    state.speed = speed;
    state.elapsed += dt;
    state.distance = nextDistance;
    for (const gate of gates) {
      if (!gate.passed && state.distance >= gate.distance) {
        gate.passed = true;
        if (Math.abs(state.lane - gate.lane) < .34) {
          gate.taken = true;
          state.score++;
          $('collected').textContent = String(state.score);
          message(`¡Sello ${state.score}/8!`);
          audio.chime();
          if (navigator.vibrate) navigator.vibrate(18);
        } else message('Sello perdido · alinea la cuatrimoto');
      }
    }
    if (state.distance >= total) finish();
  }
  function renderCourse() {
    ctx.clearRect(0, 0, width, height);
    if (state.status !== 'playing') return;
    const horizon = height * .48;
    const ground = height - 73;
    if (ground <= horizon + 10) return;
    for (const gate of [...gates].reverse()) {
      const distance = gate.distance - state.distance;
      if (gate.passed || distance < 0 || distance > 70) continue;
      const perspective = 10 / (distance + 10);
      const x = width / 2 + gate.lane * Math.min(width * .34, 220) * perspective;
      const y = horizon + (ground - horizon) * perspective;
      const radius = clamp(Math.min(width * .078, 33) * perspective, 4, 34);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (70 - distance) / 15);
      ctx.shadowColor = '#ffb64f'; ctx.shadowBlur = 12 * perspective;
      ctx.lineWidth = Math.max(2, 5 * perspective); ctx.strokeStyle = '#ffb64f';
      ctx.beginPath(); ctx.arc(x, y - radius * 2, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffe0a0'; ctx.beginPath(); ctx.arc(x, y - radius * 2, radius * .22, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#151b1dd9';
      const label = `${Math.ceil(distance)} m`;
      ctx.font = '600 11px system-ui'; ctx.textAlign = 'center';
      const textWidth = ctx.measureText(label).width + 15;
      ctx.fillRect(x - textWidth / 2, y - radius * 3 - 23, textWidth, 18);
      ctx.fillStyle = '#fff1d2'; ctx.fillText(label, x, y - radius * 3 - 10);
      ctx.fillStyle = '#ffad4d40'; ctx.beginPath(); ctx.ellipse(x, y, radius * 1.5, Math.max(2, radius * .23), 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  function renderHUD() {
    const speed = state.buffer ? 0 : Math.round(state.speed * 3.6);
    $('speed').textContent = String(speed);
    $('gear').textContent = speed < 1 ? 'N' : speed < 12 ? '1' : speed < 23 ? '2' : '3';
    $('distance').textContent = `${Math.round(state.distance)} m`;
    $('remaining').textContent = `${Math.max(0, Math.round(total - state.distance))} m`;
    $('progress').style.width = `${Math.min(100, state.distance / total * 100)}%`;
    $('clock').textContent = formatTime(state.elapsed);
    $('game').dataset.distance = state.distance.toFixed(2);
    $('game').dataset.speed = speed;
    $('game').dataset.photo = state.frame;
    $('game').dataset.buffering = state.buffer;
  }
  function frame(now) {
    const dt = Math.min(.04, Math.max(0, (now - (state.last || now)) / 1000));
    state.last = now;
    tick(dt);
    renderCourse();
    const offset = state.lane * Math.min(width * .34, 220);
    const bump = !reducedMotion && state.status === 'playing' && !state.buffer ? Math.sin(state.distance * 3) * Math.min(2, state.speed * .3) : 0;
    $('rider').style.transform = `translateX(calc(-50% + ${offset.toFixed(2)}px)) translateY(${bump.toFixed(2)}px) rotate(${(-state.steer * 6).toFixed(2)}deg)`;
    audio.update(state.buffer ? 0 : state.speed, state.status === 'playing', held('gas'));
    hudTime += dt;
    if (hudTime > .1) { renderHUD(); hudTime = 0; }
    requestAnimationFrame(frame);
  }

  document.querySelectorAll('.drive').forEach(button => {
    const key = button.dataset.key;
    const up = event => {
      input[key].delete(`touch-${event.pointerId}`);
      button.classList.toggle('active', held(key));
    };
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (state.status !== 'playing') return;
      input[key].add(`touch-${event.pointerId}`);
      button.classList.add('active');
      button.setPointerCapture(event.pointerId);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, up);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
  const keyboard = {ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'gas', w: 'gas', ArrowDown: 'brake', s: 'brake', ' ': 'brake'};
  window.addEventListener('keydown', event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (keyboard[key]) {
      event.preventDefault();
      if (state.status === 'playing') input[keyboard[key]].add(`key-${key}`);
    }
    if (event.repeat) return;
    if (key === 'Escape' || key === 'p') state.status === 'paused' ? start() : pause();
    if (key === 'r') reset();
    if (key === 'Enter' && state.status === 'intro') start();
  });
  window.addEventListener('keyup', event => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (keyboard[key]) input[keyboard[key]].delete(`key-${key}`);
  });
  window.addEventListener('blur', () => {
    releaseAll();
    // Focusing a native panorama is not leaving the game. In particular, a
    // mobile tap on Resume can return focus to the iframe below the overlay.
    requestAnimationFrame(() => {
      if (document.hidden || (!document.hasFocus() && document.activeElement?.tagName !== 'IFRAME')) pause();
    });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); pause(); } });
  window.addEventListener('offline', fail);
  $('start').addEventListener('click', start);
  $('pause').addEventListener('click', () => state.status === 'paused' ? start() : pause());
  $('resume').addEventListener('click', start);
  for (const id of ['restart', 'restart-pause']) $(id).addEventListener('click', reset);
  $('retry').addEventListener('click', reset);
  $('sound').addEventListener('click', async () => {
    const enabled = await audio.toggle();
    $('sound').setAttribute('aria-label', enabled ? 'Silenciar sonido' : 'Activar sonido');
    $('sound').setAttribute('aria-pressed', String(enabled));
    $('sound').style.color = enabled ? 'var(--accent)' : '';
    $('sound').querySelector('path').setAttribute('d', enabled ? 'M11 5 6 9H3v6h3l5 4V5Zm5 3c3 2 3 6 0 8m3-11c5 4 5 10 0 14' : 'M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6');
  });
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('game').requestFullscreen) await $('game').requestFullscreen();
      else message('Usa tu navegador en horizontal para una vista más amplia');
    } catch { message('La pantalla completa no está disponible en este navegador'); }
  });
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  new ResizeObserver(resize).observe($('street'));
  resize();
  reset();
  requestAnimationFrame(frame);
})();
