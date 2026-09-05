import test from 'node:test';
import assert from 'node:assert/strict';
import {Ride, LENGTH, ROAD, PHOTOS, MODES, pointAt, photoAt, streetURL, readRecord, saveRecord} from '../../ride-core.mjs';
const gas = {gas: true};
function advance(r, seconds, controls = gas) { for (let t = 0; t < seconds; t += 1 / 60) r.step(1 / 60, controls); }
function perfect(mode, dt = 1 / 60) {
  const r = new Ride(mode); r.play();
  for (let i = 0; i < 180 / dt && r.status === 'playing'; i++) {
    const next = r.next;
    const target = !next ? 0 : next.kind === 'seal' ? next.lane : next.lane <= 0 ? .55 : -.55;
    const diff = target - r.lane;
    r.step(dt, {gas: true, left: diff < -.05, right: diff > .05});
  }
  return r;
}
test('route stays on the residential segment; final panorama is reachable', () => {
  assert.ok(LENGTH > 400 && LENGTH < 440);
  assert.equal(ROAD.length, 5);
  assert.equal(photoAt(LENGTH), PHOTOS.length - 1);
  assert.equal(PHOTOS.at(-1).distance, LENGTH);
  for (const [i, p] of PHOTOS.entries()) {
    assert.ok(p.lat > 25.589 && p.lat < 25.593);
    assert.ok(p.lng > -108.472 && p.lng < -108.469);
    assert.ok(p.heading > 140 && p.heading < 170);
    assert.equal(new URL(streetURL(p)).searchParams.get('output'), 'svembed');
    if (i) assert.ok(p.distance > PHOTOS[i-1].distance);
  }
  assert.deepEqual(pointAt(0), {lat:PHOTOS[0].lat, lng:PHOTOS[0].lng, heading:PHOTOS[0].heading});
});
test('perfect challenge can be won using steering and gas alone', () => {
  const r = perfect('reto');
  assert.equal(r.status, 'won'); assert.equal(r.collected, 8); assert.equal(r.hits, 0);
  assert.equal(r.stars, 3); assert.ok(r.elapsed < 90); assert.ok(r.score > 1400);
  console.log('Perfect challenge', r.elapsed.toFixed(2), 'seconds;', r.score, 'points');
});
test('paseo has no time limit or obstacles, and is completable', () => {
  const r = perfect('paseo'); assert.equal(r.status, 'won'); assert.equal(r.collected, 8);
  assert.equal(r.remaining, null); assert.equal(r.objects.length, 8);
});
test('frame-rate variation does not change collectible or collision results', () => {
  for (const dt of [1/30, 1/60, 1/120]) { const r = perfect('reto', dt); assert.equal(r.stars, 3); }
});
test('both pedals means brake, never accelerate or reverse', () => {
  const r = new Ride(); r.play(); advance(r, 3); const old = r.speed;
  advance(r, .2, {gas:true, brake:true}); assert.ok(r.speed < old);
  advance(r, 3, {brake:true}); assert.equal(r.speed, 0);
});
test('buffering freezes time, steering, distance, score and checkpoint crossing', () => {
  const r = new Ride(); r.play(); advance(r, 2);
  const before = JSON.stringify(r);
  for (let i=0; i<900; i++) assert.deepEqual(r.step(1/60, {gas:true,left:true}, ()=>false), [{kind:'buffer'}]);
  assert.equal(JSON.stringify(r), before);
  r.step(1/60,gas); assert.ok(r.distance > JSON.parse(before).distance);
});
test('pause is inert; resume continues the same run; restart clears all state', () => {
  const r = new Ride(); r.play(); advance(r, 5); r.pause();
  const before = JSON.stringify(r); advance(r, 20); assert.equal(JSON.stringify(r), before);
  r.play(); advance(r, 3); assert.ok(r.distance > JSON.parse(before).distance);
  r.reset(); assert.equal(r.distance, 0); assert.equal(r.score, 0); assert.equal(r.status, 'ready'); assert.ok(r.objects.every(o=>!o.passed));
});
test('idle challenge loses at 90 seconds and terminal states cannot accrue points', () => {
  const r = new Ride(); r.play(); advance(r, 100, {}); assert.equal(r.status,'lost'); assert.equal(r.stars,0);
  const before = JSON.stringify(r); advance(r,10); assert.equal(JSON.stringify(r),before);
  const winner = perfect('reto'); const won = JSON.stringify(winner); winner.play(); advance(winner,10); assert.equal(JSON.stringify(winner),won);
});
test('hitting cones slows the quad and penalizes; missed seals are not counted', () => {
  const r = new Ride(); r.play(); advance(r,15);
  assert.ok(r.hits>0); assert.ok(r.objects.filter(o=>o.kind==='seal' && o.passed && !o.taken).length>0);
  assert.ok(r.score>=0); assert.ok(r.collected<8);
});
test('controls remain bounded under invalid timing and repeated steering', () => {
  const r = new Ride(); r.play(); r.step(Infinity,gas); r.step(-1,gas); assert.equal(r.distance,0);
  advance(r, 10, {gas:true, right:true}); assert.ok(r.lane<=.85); assert.ok(r.speed<=MODES.reto.maxSpeed);
});
test('records survive reload and reject corrupt/blocked storage', () => {
  const data = new Map(); const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const r = perfect('reto'); assert.equal(saveRecord(storage,r),true); assert.equal(saveRecord(storage,r),false);
  assert.equal(readRecord(storage,'reto').score,r.score); assert.equal(readRecord(storage,'paseo'),null);
  assert.equal(saveRecord(null,r),false); assert.equal(readRecord(null,'reto'),null);
  storage.setItem('cuatrimoto92.record.reto','{"score":-1}'); assert.equal(readRecord(storage,'reto'),null);
  assert.equal(saveRecord(storage,new Ride()),false);
});

test('the final challenge tick cannot travel or collect beyond the deadline', () => {
  const r = new Ride('reto'); r.play();
  const seal = r.objects.find(o => o.kind === 'seal');
  r.elapsed = MODES.reto.limit - .01;
  r.speed = MODES.reto.maxSpeed;
  r.distance = seal.distance - .12;
  r.lane = seal.lane;
  const before = r.distance;
  const events = r.step(.05, gas);
  assert.equal(r.elapsed, MODES.reto.limit);
  assert.ok(r.distance - before <= MODES.reto.maxSpeed * .01 + 1e-9);
  assert.equal(seal.passed, false);
  assert.equal(r.collected, 0);
  assert.equal(r.score, 0);
  assert.equal(r.status, 'lost');
  assert.deepEqual(events, [{kind: 'finish'}]);
});

test('buffering at the deadline freezes the run and resumes only remaining time', () => {
  const r = new Ride('reto'); r.play();
  r.elapsed = MODES.reto.limit - .01;
  r.speed = MODES.reto.maxSpeed;
  r.distance = PHOTOS[1].distance - .04;
  const before = JSON.stringify(r);
  const requested = [];
  for (let i = 0; i < 120; i++) {
    assert.deepEqual(r.step(.05, gas, index => {
      requested.push(index); return false;
    }), [{kind: 'buffer'}]);
  }
  assert.equal(JSON.stringify(r), before);
  assert.ok(requested.every(index => index === 1));
  assert.deepEqual(r.step(.05, gas, () => true), [{kind: 'finish'}]);
  assert.equal(r.elapsed, MODES.reto.limit);
  assert.ok(r.distance - JSON.parse(before).distance <= MODES.reto.maxSpeed * .01 + 1e-9);
  assert.equal(r.status, 'lost');
});

test('deadline never waits for a panorama the quad cannot reach in time', () => {
  const r = new Ride('reto'); r.play();
  r.elapsed = MODES.reto.limit - .01;
  r.speed = MODES.reto.maxSpeed;
  r.distance = PHOTOS[1].distance - .2;
  const requested = [];
  const events = r.step(.05, gas, index => {
    requested.push(index); return index === 0;
  });
  assert.deepEqual(requested, [0]);
  assert.equal(r.elapsed, MODES.reto.limit);
  assert.equal(r.status, 'lost');
  assert.deepEqual(events, [{kind: 'finish'}]);
});
