import test from 'node:test';
import assert from 'node:assert/strict';
import {StreetPlayer} from '../../street-player.mjs';
import {PHOTOS} from '../../ride-core.mjs';

// Deterministic DOM/clock fixture: no network or provider imagery is involved.
function fixture() {
  const saved={document:globalThis.document,performance:globalThis.performance,setTimeout,clearTimeout};
  let now=0,serial=0; const timers=new Map();
  globalThis.performance={now:()=>now};
  globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{at:now+ms,fn});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const mount={children:[],append(frame){this.children.push(frame);frame.remove=()=>{this.children=this.children.filter(f=>f!==frame);};}};
  globalThis.document={createElement:()=>({style:{},classList:{toggle(){}},setAttribute(){}})};
  const tick=ms=>{const end=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
  const ready=(player,index)=>{const slot=player.slots.find(s=>s.index===index);assert.ok(slot,`expected frame ${index}`);slot.frame.onload();tick(451);};
  return {mount,tick,ready,restore(){Object.assign(globalThis,saved);}};
}
test('one late photograph does not stop the ride, but a prolonged outage does',()=>{
  const f=fixture();try{
    const player=new StreetPlayer(f.mount);player.reset();f.ready(player,0);f.ready(player,1);
    assert.equal(player.prepare(0),true);assert.equal(player.update(18).ready,true);
    assert.equal(player.index,1);
    const delayed=player.update(35);assert.equal(delayed.lag,1);assert.equal(delayed.stalled,false);
    const severe=player.update(69);assert.equal(severe.stalled,true);
    f.ready(player,3);f.ready(player,4);
    assert.equal(player.update(69).stalled,false);assert.equal(player.index,4);
  }finally{f.restore();}
});
test('look-ahead is bounded across a full route and never starts more than two loads',()=>{
  const f=fixture();try{
    const player=new StreetPlayer(f.mount,{maxFrames:5});player.reset();
    for(let index=0;index<PHOTOS.length;index++){
      player.update(PHOTOS[index].distance);
      for(let pass=0;pass<8;pass++){
        const loading=player.slots.filter(s=>s.loading);assert.ok(loading.length<=2);
        for(const slot of loading){if(player.slots.includes(slot))f.ready(player,slot.index);}
        player.update(PHOTOS[index].distance);f.tick(700);
      }
      assert.equal(player.index,index);assert.ok(player.count<=5);assert.equal(f.mount.children.length,player.count);
    }
  }finally{f.restore();}
});
test('reset rejects stale load callbacks and keeps attributed frames uncropped',()=>{
  const f=fixture();try{
    const player=new StreetPlayer(f.mount);player.reset();const stale=player.slots[0].frame.onload;
    player.reset(5);stale();f.tick(1000);assert.ok(player.slots.every(s=>!s.ready));
    f.ready(player,5);f.ready(player,6);assert.equal(player.prepare(PHOTOS[5].distance),true);
    player.render(PHOTOS[5].distance);const first=player.active.frame.style.transform;
    player.render(PHOTOS[5].distance+8);const second=player.active.frame.style.transform;
    assert.notEqual(first,second);assert.ok(Number(second.match(/[\d.]+/)[0])<=1);
    player.render(PHOTOS[5].distance+100);assert.equal(player.active.frame.style.transform,'scale(1.00000)');
  }finally{f.restore();}
});
test('a failed speculative load does not invalidate an already displayed panorama',()=>{
  const f=fixture();try{
    const player=new StreetPlayer(f.mount);player.reset();f.ready(player,0);f.ready(player,1);player.prepare(0);
    player.slots.find(s=>s.index===2).frame.onerror();
    assert.equal(player.update(0).stalled,false);assert.equal(player.failed(2),true);
    player.reset();assert.equal(player.failed(2),false);
  }finally{f.restore();}
});
