import test from 'node:test';
import assert from 'node:assert/strict';
import {Ride,PHYSICS_STEP,PHOTOS,pointAt,photoAt} from '../../ride-core.mjs';
test('brake immediately cuts forward acceleration even during a throttle ramp',()=>{
  for(const ticks of [20,60,120,180,240]){
    const r=new Ride('paseo');r.play();for(let i=0;i<ticks;i++)r.step(PHYSICS_STEP,{gas:true});
    const before=r.speed;r.step(PHYSICS_STEP,{gas:true,brake:true});assert.ok(r.speed<=before);
  }
});
test('resting brakes and steady cruising do not produce fictitious suspension load',()=>{
  const r=new Ride('paseo');r.play();for(let i=0;i<120;i++)r.step(PHYSICS_STEP,{brake:true});
  assert.equal(r.pitch,0);assert.equal(r.acceleration,0);
  r.step(PHYSICS_STEP,{gas:true});assert.ok(r.speed>0,'releasing the brake responds on the first tick');
  for(let i=0;i<1200;i++)r.step(PHYSICS_STEP,{gas:true});
  assert.equal(r.acceleration,0);assert.ok(Math.abs(r.pitch)<1e-9);
});

test('ambiguous intersection samples use the verified on-street positions without changing gameplay distance',()=>{
  for(const i of [13,19]){
    const actual=PHOTOS[i], expected=pointAt(actual.distance-7);
    assert.equal(actual.lat,expected.lat);assert.equal(actual.lng,expected.lng);
    assert.equal(actual.distance,i*17);assert.equal(photoAt(actual.distance),i);
    assert.ok(actual.lat<PHOTOS[i-1].lat && actual.lat>PHOTOS[i+1].lat);
  }
});
