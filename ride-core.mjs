export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = d => d * Math.PI / 180;
// Residential section of OSM way 121992510; the pedestrian continuation is excluded.
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
  return {
    lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t,
    heading: (Math.atan2((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]) * 180 / Math.PI + 360) % 360
  };
}
export const PHOTOS = Object.freeze(Array.from({length: Math.ceil(LENGTH / PHOTO_STEP) + 1}, (_, i) => Object.freeze({distance: Math.min(i * PHOTO_STEP, LENGTH), ...pointAt(Math.min(i * PHOTO_STEP, LENGTH))})));
export function photoAt(distance) {
  return distance >= LENGTH ? PHOTOS.length - 1 : Math.floor(Math.max(0, distance) / PHOTO_STEP);
}
export const MODES = Object.freeze({
  paseo: Object.freeze({name: 'Paseo', limit: null, maxSpeed: 7.2}),
  reto: Object.freeze({name: 'Reto 92', limit: 90, maxSpeed: 8.3})
});
export function streetURL(photo) {
  const url = new URL('https://maps.google.com/maps');
  url.search = new URLSearchParams({layer: 'c', cbll: `${photo.lat.toFixed(7)},${photo.lng.toFixed(7)}`, cbp: `12,${photo.heading.toFixed(1)},,0,0`, source: 'embed', output: 'svembed', hl: 'es'}).toString();
  return url.toString();
}
export class Ride {
  constructor(mode = 'reto') { this.reset(mode); }
  reset(mode = this.mode) {
    this.mode = Object.hasOwn(MODES, mode) ? mode : 'reto';
    Object.assign(this, {status: 'ready', distance: 0, speed: 0, lane: 0, steer: 0, elapsed: 0, collected: 0, score: 0, combo: 0, hits: 0, maxCombo: 0});
    this.objects = [0, .52, -.52, 0, .52, -.52, .45, 0].map((lane, i) => ({kind: 'seal', lane, distance: LENGTH * (i + 1) / 9, passed: false, taken: false}));
    // Cones are game objects, not claimed to exist in the photographed street.
    if (this.mode === 'reto') [0, -.48, .48, 0, -.48, .48, 0].forEach((lane, i) => this.objects.push({kind: 'cone', lane, distance: LENGTH * (i + 1.55) / 9, passed: false, taken: false}));
    this.objects.sort((a, b) => a.distance - b.distance);
  }
  play() { if (this.status === 'ready' || this.status === 'paused') this.status = 'playing'; }
  pause() { if (this.status === 'playing') { this.status = 'paused'; this.speed = 0; } }
  get remaining() { return MODES[this.mode].limit === null ? null : Math.max(0, MODES[this.mode].limit - this.elapsed); }
  get stars() { return this.status !== 'won' ? 0 : this.collected === 8 && this.hits === 0 ? 3 : this.collected >= 6 ? 2 : 1; }
  get next() { return this.objects.find(o => !o.passed) || null; }
  step(dt, input, roadReady = () => true) {
    if (this.status !== 'playing') return [];
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    // Clip before physics and panorama gating: expired time cannot move the quad.
    const remaining = this.remaining;
    if (remaining !== null) dt = Math.min(dt, remaining);
    // Braking wins if both pedals are held. The frame gate prevents invisible travel.
    let speed = clamp(this.speed + (input.brake ? -7.5 : input.gas ? 2.8 : -1.6) * dt, 0, MODES[this.mode].maxSpeed);
    const distance = Math.min(LENGTH, this.distance + speed * dt);
    if (!roadReady(photoAt(distance))) return [{kind: 'buffer'}];
    const events = [];
    const steer = Number(!!input.right) - Number(!!input.left);
    this.steer += (steer - this.steer) * Math.min(1, dt * 10);
    this.lane = clamp(this.lane + this.steer * dt * (.45 + speed * .065), -.85, .85);
    this.elapsed += dt;
    this.speed = speed;
    const oldDistance = this.distance;
    this.distance = distance;
    for (const o of this.objects) {
      if (o.passed || o.distance > distance || o.distance < oldDistance) continue;
      o.passed = true;
      const aligned = Math.abs(this.lane - o.lane) < (o.kind === 'seal' ? .34 : .27);
      if (o.kind === 'seal') {
        if (aligned) {
          o.taken = true; this.collected++; this.combo++;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          const points = 100 + Math.min(4, this.combo - 1) * 25;
          this.score += points;
          events.push({kind: 'seal', points, lane: o.lane});
        } else { this.combo = 0; events.push({kind: 'miss'}); }
      } else if (aligned) {
        this.hits++; this.combo = 0; this.speed *= .3;
        this.score = Math.max(0, this.score - 50);
        events.push({kind: 'hit'});
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
export function readRecord(storage, mode) {
  try {
    const r = JSON.parse(storage.getItem(`cuatrimoto92.record.${mode}`));
    if (!r || !Number.isFinite(r.score) || r.score < 0 || !Number.isFinite(r.time) || r.time < 0 || !Number.isInteger(r.stars) || r.stars < 1 || r.stars > 3) return null;
    return {score: r.score, time: r.time, stars: r.stars};
  } catch { return null; }
}
export function saveRecord(storage, ride) {
  if (ride.status !== 'won') return false;
  const old = readRecord(storage, ride.mode);
  if (old && (old.score > ride.score || (old.score === ride.score && old.time <= ride.elapsed))) return false;
  try {
    storage.setItem(`cuatrimoto92.record.${ride.mode}`, JSON.stringify({score: ride.score, time: ride.elapsed, stars: ride.stars}));
    return true;
  } catch { return false; }
}
