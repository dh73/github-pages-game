import test from 'node:test';
import assert from 'node:assert/strict';
import {routeAt,buildRoute,buildQuad,buildSeal,buildCone,junctions} from '../../route-scene.mjs';
import {Ride,FixedClock,pose,interpolate,LENGTH,PHYSICS_STEP} from '../../ride-core.mjs';

test('route is continuous in position and tangent at each mapped knot',()=>{
  for(const s of [...junctions,0,LENGTH]){
    const a=routeAt(s-.001),b=routeAt(s+.001);
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.0021);
    assert.ok(Math.abs(a.fx-b.fx)<.00001);
    assert.ok(Math.abs(a.fz-b.fz)<.00001);
  }
});
test('distance and lateral offsets are in metres, not photo indexes',()=>{
  for(let d=0;d<LENGTH;d+=.25){
    const a=routeAt(d),b=routeAt(d+.01),r=routeAt(d,2.8);
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>.0099);
    assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.0101);
    assert.ok(Math.abs(Math.hypot(a.x-r.x,a.z-r.z)-2.8)<1e-6);
  }
  assert.throws(()=>routeAt(NaN));assert.throws(()=>routeAt(1,Infinity));
});
test('complete static world is generated before playback, finite and deterministic',()=>{
  const a=buildRoute(),b=buildRoute();assert.deepEqual(a,b);
  assert.ok(a.byteLength<18*1024*1024);assert.ok(a.length/30>30000);
  for(const x of a)assert.ok(Number.isFinite(x));
  for(const mesh of [...Object.values(buildQuad()),buildSeal(),buildCone()]){
    assert.equal(mesh.length%30,0);assert.ok(mesh.length>0);for(const x of mesh)assert.ok(Number.isFinite(x));
  }
});
function finishAt(hz){
  const r=new Ride('reto'),c=new FixedClock();r.play();let prev=pose(r),rendered=pose(r),last=-1;
  for(let f=0;f<hz*90&&r.status==='playing';f++){
    const a=c.advance(1/hz,dt=>{
      prev=pose(r);const o=r.next,target=!o?0:o.kind==='seal'?o.lane:o.lane<=0?.55:-.55;
      const error=target-r.lane-r.lateralSpeed*.16/2.8;
      r.step(dt,{gas:true,left:error<-.05,right:error>.05});
    });rendered=interpolate(prev,pose(r),a);assert.ok(rendered.distance>=last);last=rendered.distance;
  }return r;
}
test('complete offline rides preserve perfect outcomes at 30/60/120 render Hz',()=>{
  const r=finishAt(120);assert.equal(r.status,'won');assert.equal(r.collected,8);assert.equal(r.hits,0);
  for(const hz of [30,60]){const q=finishAt(hz);assert.equal(q.score,r.score);assert.equal(q.collected,8);assert.equal(q.hits,0);assert.ok(Math.abs(q.elapsed-r.elapsed)<PHYSICS_STEP);}
});
