export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
export const lerp = (a, b, t) => a + (b - a) * t;
const rad = d => d * Math.PI / 180;
// Residential section of OSM way 121992510; no invented roads or map fallback.
export const ROAD = Object.freeze([
  [25.5928919, -108.4716018], [25.5919436, -108.4711411],
  [25.5909721, -108.4707038], [25.5901240, -108.4702804],
  [25.5893078, -108.4698643]
].map(Object.freeze));
function metres(a, b) {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}
const cumulative = [0];
for (let i = 1; i < ROAD.length; i++) cumulative.push(cumulative[i - 1] + metres(ROAD[i - 1], ROAD[i]));
export const LENGTH = cumulative.at(-1) - 18;
export const PHOTO_STEP = 17;
export function pointAt(distance) {
  const d = clamp(distance + 9, 0, cumulative.at(-1));
  let i = 0;
  while (i < ROAD.length - 2 && d > cumulative[i + 1]) i++;
  const a = ROAD[i], b = ROAD[i + 1], t = (d - cumulative[i]) / (cumulative[i + 1] - cumulative[i]);
  return {lat: lerp(a[0], b[0], t), lng: lerp(a[1], b[1], t),
    heading: (Math.atan2((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]) * 180 / Math.PI + 360) % 360};
}
export const PHOTOS = Object.freeze(Array.from({length: Math.ceil(LENGTH / PHOTO_STEP) + 1}, (_, i) => Object.freeze({distance: Math.min(i * PHOTO_STEP, LENGTH), ...pointAt(Math.min(i * PHOTO_STEP, LENGTH))})));
export function photoAt(distance) { return distance >= LENGTH ? PHOTOS.length - 1 : Math.floor(Math.max(0, distance) / PHOTO_STEP); }
export const MODES = Object.freeze({
  paseo: Object.freeze({name: 'Paseo', limit: null, maxSpeed: 11.5}),
  reto: Object.freeze({name: 'Reto 92', limit: 90, maxSpeed: 15})
});
export function streetURL(photo) {
  const url = new URL('https://maps.google.com/maps');
  url.search = new URLSearchParams({layer: 'c', cbll: `${photo.lat.toFixed(7)},${photo.lng.toFixed(7)}`, cbp: `12,${photo.heading.toFixed(1)},,0,0`, source: 'embed', output: 'svembed', hl: 'es'}).toString();
  return url.toString();
}
// Fixed simulation steps + render interpolation: display refresh never determines physics.
export class FixedClock {
  constructor(hz = 120) { this.dt = 1 / hz; this.reset(); }
  reset() { this.accumulator = 0; }
  advance(seconds, step) {
    this.accumulator += clamp(Number.isFinite(seconds) ? seconds : 0, 0, .1);
    let count = 0;
    while (this.accumulator + 1e-10 >= this.dt && count < 12) {
      step(this.dt); this.accumulator -= this.dt; count++;
    }
    this.accumulator = Math.max(0, this.accumulator);
    return clamp(this.accumulator / this.dt, 0, 1);
  }
}
// Exact critically damped spring; remains stable on low-refresh mobile displays.
export class Spring {
  constructor(value = 0) { this.value = value; this.velocity = 0; }
  snap(value = 0) { this.value = value; this.velocity = 0; }
  step(target, rate, dt) {
    const offset = this.value - target, c = this.velocity + rate * offset;
    const decay = Math.exp(-rate * dt);
    this.value = target + (offset + c * dt) * decay;
    this.velocity = (this.velocity - rate * c * dt) * decay;
    return this.value;
  }
}
export class Ride {
  constructor(mode = 'reto') { this.reset(mode); }
  reset(mode = this.mode) {
    this.mode = Object.hasOwn(MODES, mode) ? mode : 'reto';
    Object.assign(this, {status: 'ready', distance: 0, speed: 0, lane: 0, steer: 0, elapsed: 0, collected: 0, score: 0, combo: 0, hits: 0, maxCombo: 0, throttle: 0, lateralVelocity: 0, acceleration: 0});
    this.objects = [0, .52, -.52, 0, .52, -.52, .45, 0].map((lane, i) => ({kind: 'seal', lane, distance: LENGTH * (i + 1) / 9, passed: false, taken: false}));
    if (this.mode === 'reto') [0, -.48, .48, 0, -.48, .48, 0].forEach((lane, i) => this.objects.push({kind: 'cone', lane, distance: LENGTH * (i + 1.55) / 9, passed: false, taken: false}));
    this.objects.sort((a, b) => a.distance - b.distance);
  }
  play() { if (this.status === 'ready' || this.status === 'paused') this.status = 'playing'; }
  pause() {
    if (this.status === 'playing') {
      this.status = 'paused'; this.speed = 0; this.throttle = 0;
      this.lateralVelocity = 0; this.acceleration = 0;
    }
  }
  get remaining() { return MODES[this.mode].limit === null ? null : Math.max(0, MODES[this.mode].limit - this.elapsed); }
  get stars() { return this.status !== 'won' ? 0 : this.collected === 8 && this.hits === 0 ? 3 : this.collected >= 6 ? 2 : 1; }
  get next() { return this.objects.find(o => !o.passed) || null; }
  step(dt, input = {}, roadReady = () => true) {
    if (this.status !== 'playing') return [];
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    const remaining = this.remaining;
    if (remaining !== null) dt = Math.min(dt, remaining);
    const pedal = value => clamp(Number(value) || 0, 0, 1);
    const brake = pedal(input.brake), gas = brake ? 0 : pedal(input.gas);
    const throttle = damp(this.throttle, gas, 9, dt);
    const max = MODES[this.mode].maxSpeed;
    const drive = gas ? throttle * (6.8 - 1.2 * (this.speed / max) ** 2) : 0;
    const drag = .7 + .011 * this.speed ** 2;
    const force = brake ? -11 * brake - drag : drive - drag;
    const speed = clamp(this.speed + force * dt, 0, max);
    const distance = Math.min(LENGTH, this.distance + (this.speed + speed) * .5 * dt);
    // Calculate candidates before committing: buffering freezes the whole simulation.
    if (!roadReady(photoAt(distance))) return [{kind: 'buffer'}];
    const events = [], oldDistance = this.distance, oldSpeed = this.speed;
    const steer = pedal(input.right) - pedal(input.left);
    this.steer = damp(this.steer, steer, 13, dt);
    const grip = 1 - .22 * (speed / max) ** 2;
    const targetLateral = this.steer * (1.15 + speed * .017) * grip * Math.min(1, speed / 1.2);
    const lateral = damp(this.lateralVelocity, targetLateral, 12, dt);
    this.lane = clamp(this.lane + (this.lateralVelocity + lateral) * .5 * dt, -.85, .85);
    this.lateralVelocity = Math.abs(this.lane) >= .85 && Math.sign(lateral) === Math.sign(this.lane) ? 0 : lateral;
    this.throttle = throttle; this.acceleration = dt > 0 ? (speed - oldSpeed) / dt : 0;
    this.elapsed += dt; this.speed = speed; this.distance = distance;
    for (const o of this.objects) {
      if (o.passed || o.distance > distance || o.distance < oldDistance) continue;
      o.passed = true;
      const aligned = Math.abs(this.lane - o.lane) < (o.kind === 'seal' ? .34 : .27);
      if (o.kind === 'seal') {
        if (aligned) {
          o.taken = true; this.collected++; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
          const points = 100 + Math.min(4, this.combo - 1) * 25;
          this.score += points; events.push({kind: 'seal', points, lane: o.lane});
        } else { this.combo = 0; events.push({kind: 'miss'}); }
      } else if (aligned) {
        this.hits++; this.combo = 0; this.speed *= .45; this.acceleration = -8;
        this.score = Math.max(0, this.score - 50); events.push({kind: 'hit'});
      } else { this.score += 30; events.push({kind: 'dodge'}); }
    }
    if (distance >= LENGTH && (this.remaining === null || this.remaining > 0)) {
      this.status = 'won'; this.speed = 0;
      if (this.remaining !== null) this.score += Math.floor(this.remaining) * 5;
      events.push({kind: 'finish'});
    } else if (this.remaining !== null && this.remaining <= 0) {
      this.status = 'lost'; this.speed = 0; events.push({kind: 'finish'});
    }
    return events;
  }
}
// Physics changed: do not mix old, slower-run scores with the new leaderboard.
const recordKey = mode => `cuatrimoto92.record.v3.${mode}`;
export function readRecord(storage, mode) {
  try {
    const r = JSON.parse(storage.getItem(recordKey(mode)));
    if (!r || !Number.isFinite(r.score) || r.score < 0 || !Number.isFinite(r.time) || r.time < 0 || !Number.isInteger(r.stars) || r.stars < 1 || r.stars > 3) return null;
    return {score: r.score, time: r.time, stars: r.stars};
  } catch { return null; }
}
export function saveRecord(storage, ride) {
  if (ride.status !== 'won') return false;
  const old = readRecord(storage, ride.mode);
  if (old && (old.score > ride.score || (old.score === ride.score && old.time <= ride.elapsed))) return false;
  try { storage.setItem(recordKey(ride.mode), JSON.stringify({score: ride.score, time: ride.elapsed, stars: ride.stars})); return true; }
  catch { return false; }
}
