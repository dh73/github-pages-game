export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const PHYSICS_STEP = 1 / 120;
export const RULESET = 'motion-3';
const rad = d => d * Math.PI / 180;
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
  return {lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t,
    heading: (Math.atan2((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]) * 180 / Math.PI + 360) % 360};
}
export const PHOTOS = Object.freeze(Array.from({length: Math.ceil(LENGTH / PHOTO_STEP) + 1}, (_, i) => Object.freeze({distance: Math.min(i * PHOTO_STEP, LENGTH), ...pointAt(Math.min(i * PHOTO_STEP, LENGTH))})));
export function photoAt(distance) { return distance >= LENGTH ? PHOTOS.length - 1 : Math.floor(Math.max(0, distance) / PHOTO_STEP); }
export const MODES = Object.freeze({
  paseo: Object.freeze({name: 'Paseo', limit: null, maxSpeed: 11.11}),
  reto: Object.freeze({name: 'Reto 92', limit: 90, maxSpeed: 15.28})
});
export function streetURL(photo) {
  const url = new URL('https://maps.google.com/maps');
  url.search = new URLSearchParams({layer: 'c', cbll: `${photo.lat.toFixed(7)},${photo.lng.toFixed(7)}`, cbp: `12,${photo.heading.toFixed(1)},,0,0`, source: 'embed', output: 'svembed', hl: 'es'}).toString();
  return url.toString();
}
export const damp = (current, target, rate, dt) => target + (current - target) * Math.exp(-rate * dt);
// Analytic critically damped suspension: stable even when rendering is irregular.
export function spring(position, velocity, target, omega, dt) {
  const offset = position - target, impulse = velocity + omega * offset, decay = Math.exp(-omega * dt);
  return [target + (offset + impulse * dt) * decay, (velocity - omega * impulse * dt) * decay];
}
export class FixedClock {
  constructor() { this.accumulator = 0; }
  reset() { this.accumulator = 0; }
  advance(seconds, tick) {
    this.accumulator += clamp(Number.isFinite(seconds) ? seconds : 0, 0, .25);
    let steps = 0;
    while (this.accumulator + 1e-12 >= PHYSICS_STEP && steps < 30) {
      if (tick(PHYSICS_STEP) === false) { this.accumulator = 0; return 1; }
      this.accumulator = Math.max(0, this.accumulator - PHYSICS_STEP); steps++;
    }
    return clamp(this.accumulator / PHYSICS_STEP, 0, 1);
  }
}
export function pose(r) { return {distance:r.distance, lane:r.lane, speed:r.speed, steer:r.steer, roll:r.roll, pitch:r.pitch, heading:r.heading}; }
export function interpolate(a, b, alpha) {
  return Object.fromEntries(Object.keys(b).map(key => [key, a[key] + (b[key] - a[key]) * clamp(alpha, 0, 1)]));
}
export class Ride {
  constructor(mode = 'reto') { this.reset(mode); }
  reset(mode = this.mode) {
    this.mode = Object.hasOwn(MODES, mode) ? mode : 'reto';
    Object.assign(this, {status:'ready', distance:0, speed:0, lane:0, steer:0, elapsed:0, collected:0, score:0, combo:0, hits:0, maxCombo:0,
      throttle:0, acceleration:0, heading:0, lateralSpeed:0, roll:0, rollVelocity:0, pitch:0, pitchVelocity:0});
    this.objects = [0,.52,-.52,0,.52,-.52,.45,0].map((lane,i) => ({kind:'seal',lane,distance:LENGTH*(i+1)/9,passed:false,taken:false}));
    if (this.mode === 'reto') [0,-.48,.48,0,-.48,.48,0].forEach((lane,i) => this.objects.push({kind:'cone',lane,distance:LENGTH*(i+1.55)/9,passed:false,taken:false}));
    this.objects.sort((a,b) => a.distance-b.distance);
  }
  play() { if (this.status === 'ready' || this.status === 'paused') this.status = 'playing'; }
  pause() { if (this.status === 'playing') this.status = 'paused'; }
  get remaining() { return MODES[this.mode].limit === null ? null : Math.max(0, MODES[this.mode].limit - this.elapsed); }
  get stars() { return this.status !== 'won' ? 0 : this.collected === 8 && this.hits === 0 ? 3 : this.collected >= 6 ? 2 : 1; }
  get next() { return this.objects.find(o => !o.passed) || null; }
  step(dt, input = {}, roadReady = () => true) {
    if (this.status !== 'playing') return [];
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    if (this.remaining !== null) dt = Math.min(dt, this.remaining);
    if (!dt) return [];
    const maxSpeed = MODES[this.mode].maxSpeed;
    const throttle = damp(this.throttle, input.gas && !input.brake ? 1 : 0, 12, dt);
    const requested = input.brake ? -10.5 : throttle * 6.8 * (1 - .38 * (this.speed/maxSpeed)**2) - .45 - .012 * this.speed**2;
    const acceleration = this.acceleration + clamp(requested - this.acceleration, -42*dt, 25*dt);
    const speed = clamp(this.speed + acceleration*dt, 0, maxSpeed);
    const oldDistance = this.distance;
    const distance = Math.min(LENGTH, oldDistance + (this.speed + speed)*.5*dt);
    // Callbacks may delay scenery, but a deliberate pause must freeze every field.
    if (!roadReady(photoAt(distance))) return [{kind:'buffer'}];
    this.throttle = throttle; this.acceleration = acceleration;
    const steering = Number.isFinite(input.steer) ? clamp(input.steer,-1,1) : Number(!!input.right)-Number(!!input.left);
    this.steer = damp(this.steer, steering, 12, dt);
    // Assisted bicycle steering, speed-sensitive wheel angle and bounded tire grip.
    const wheelAngle = this.steer * .36 / (1 + .012*speed*speed);
    const desiredHeading = speed / 1.25 * Math.tan(wheelAngle) / 4.8;
    this.heading = damp(this.heading, desiredHeading, 9, dt);
    const oldLateral = this.lateralSpeed;
    const lateralAcceleration = clamp((speed*Math.sin(this.heading) - oldLateral)*10, -6.8, 6.8);
    this.lateralSpeed = clamp(oldLateral + lateralAcceleration*dt, -speed, speed);
    const lane = this.lane + (oldLateral+this.lateralSpeed)*.5*dt/2.8;
    this.lane = clamp(lane,-.85,.85);
    if (lane !== this.lane) { this.lateralSpeed = 0; this.heading *= Math.exp(-12*dt); }
    [this.roll,this.rollVelocity] = spring(this.roll,this.rollVelocity,-lateralAcceleration*1.25,12,dt);
    [this.pitch,this.pitchVelocity] = spring(this.pitch,this.pitchVelocity,clamp(acceleration,-10.5,6.8)*.45,10,dt);
    this.speed = speed; this.distance = distance;
    this.elapsed = MODES[this.mode].limit === null ? this.elapsed+dt : Math.min(MODES[this.mode].limit,this.elapsed+dt);
    const events = [];
    for (const o of this.objects) {
      if (o.passed || o.distance > distance || o.distance < oldDistance) continue;
      o.passed = true;
      const aligned = Math.abs(this.lane-o.lane) < (o.kind === 'seal' ? .34 : .27);
      if (o.kind === 'seal') {
        if (aligned) {
          o.taken = true; this.collected++; this.combo++; this.maxCombo = Math.max(this.maxCombo,this.combo);
          const points = 100+Math.min(4,this.combo-1)*25; this.score += points;
          events.push({kind:'seal',points,lane:o.lane});
        } else { this.combo = 0; events.push({kind:'miss'}); }
      } else if (aligned) {
        this.hits++; this.combo=0; this.speed*=.48; this.acceleration=-4; this.pitchVelocity-=18;
        this.score=Math.max(0,this.score-50); events.push({kind:'hit'});
      } else { this.score+=30; events.push({kind:'dodge'}); }
    }
    if (distance >= LENGTH && (this.remaining === null || this.remaining > 0)) {
      this.status='won'; this.speed=0;
      if (this.remaining !== null) this.score+=Math.floor(this.remaining)*5;
      events.push({kind:'finish'});
    } else if (this.remaining !== null && this.remaining <= 0) {
      this.status='lost'; this.speed=0; events.push({kind:'finish'});
    }
    return events;
  }
}
export function readRecord(storage, mode) {
  try {
    const r = JSON.parse(storage.getItem(`cuatrimoto92.${RULESET}.${mode}`));
    if (!r || !Number.isFinite(r.score) || r.score<0 || !Number.isFinite(r.time) || r.time<0 || !Number.isInteger(r.stars) || r.stars<1 || r.stars>3) return null;
    return {score:r.score,time:r.time,stars:r.stars};
  } catch { return null; }
}
export function saveRecord(storage, ride) {
  if (ride.status !== 'won') return false;
  const old = readRecord(storage,ride.mode);
  if (old && (old.score>ride.score || (old.score===ride.score && old.time<=ride.elapsed))) return false;
  try { storage.setItem(`cuatrimoto92.${RULESET}.${ride.mode}`,JSON.stringify({score:ride.score,time:ride.elapsed,stars:ride.stars})); return true; } catch { return false; }
}
