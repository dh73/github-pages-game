import {Ride, MODES, LENGTH, photoAt, clamp, lerp, FixedClock, Spring, readRecord, saveRecord} from './ride-core.mjs?v=drive-3';
import {StreetStream} from './street-stream.mjs?v=drive-3';
import {installRadio} from './radio.mjs?v=drive-3';
const $ = id => document.getElementById(id), ui = $('game');
const ride = new Ride(), clock = new FixedClock(120);
const input = Object.fromEntries(['gas','brake','left','right'].map(k => [k,new Set()]));
const held = () => Object.fromEntries(Object.entries(input).map(([k,v]) => [k,v.size > 0]));
const photos = new StreetStream($('views'));
const canvas = $('course'), ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bodyRoll = new Spring(), bodyPitch = new Spring(), suspension = new Spring();
let storage; try { storage = window.localStorage; } catch { storage = null; }
let screen = 'intro', countdown = 0, buffering = true, last = 0, hudTime = 0;
let width = 1, height = 1, toastTimer = 0, wakeLock = null, wakePending = false, particles = [];
const snapshot = () => ({distance:ride.distance,lane:ride.lane,speed:ride.speed,steer:ride.steer});
let previous = snapshot(), visual = snapshot();

class Motor {
  constructor() { this.enabled = false; this.context = null; }
  async toggle() {
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return false;
        this.context = new Audio(); this.volume = this.context.createGain(); this.volume.gain.value = 0;
        this.filter = this.context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 210;
        this.motor = this.context.createOscillator(); this.motor.type = 'sawtooth'; this.motor.frequency.value = 38;
        this.motor.connect(this.filter); this.filter.connect(this.volume); this.volume.connect(this.context.destination); this.motor.start();
        const lfo = this.context.createOscillator(), amount = this.context.createGain();
        lfo.frequency.value = 9; amount.gain.value = 3; lfo.connect(amount); amount.connect(this.motor.frequency); lfo.start();
      }
      await this.context.resume(); this.enabled = !this.enabled;
    } catch { this.enabled = false; }
    return this.enabled;
  }
  update(speed, active, throttle) {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.motor.frequency.setTargetAtTime(38 + speed * 5 + throttle * 10, now, .09);
    this.filter.frequency.setTargetAtTime(190 + speed * 30, now, .12);
    this.volume.gain.setTargetAtTime(this.enabled && active ? Math.min(.055,.016 + speed * .0025) : 0, now, .08);
  }
  tone(hz,end=hz,duration=.18) {
    if (!this.context || !this.enabled) return;
    const osc = this.context.createOscillator(), gain = this.context.createGain(), t = this.context.currentTime;
    osc.frequency.setValueAtTime(hz,t); osc.frequency.exponentialRampToValueAtTime(end,t+duration);
    gain.gain.setValueAtTime(.035,t); gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
    osc.connect(gain); gain.connect(this.context.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); }; osc.start(); osc.stop(t+duration+.01);
  }
}
const motor = new Motor();
const formatTime = seconds => `${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds))%60).padStart(2,'0')}`;
function releaseInputs() { Object.values(input).forEach(v=>v.clear()); document.querySelectorAll('.drive').forEach(b=>b.classList.remove('active')); }
async function keepAwake() {
  if (wakeLock || wakePending || !navigator.wakeLock || document.hidden) return;
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!['playing','countdown'].includes(screen)) { await lock.release(); return; }
    wakeLock = lock; lock.addEventListener('release',()=>{ if(wakeLock===lock) wakeLock=null; });
  } catch {} finally { wakePending = false; }
}
function setScreen(value) {
  screen = value; ui.dataset.status=value; ui.classList.toggle('running',value==='playing');
  for(const [id,key] of [['intro','intro'],['pause-screen','paused'],['finish','finished'],['error-screen','error']]) $(id).hidden=value!==key;
  $('countdown').hidden=value!=='countdown';
  $('pause').disabled=!['playing','paused','countdown'].includes(value);
  $('pause').setAttribute('aria-label',value==='paused'?'Continuar':'Pausar');
  $('pedal-controls').inert=value!=='playing';
  if(value!=='playing') {
    releaseInputs(); motor.update(0,false,0);
    if(wakeLock && value!=='countdown') { wakeLock.release().catch(()=>{}); wakeLock=null; }
  }
  renderHUD();
}
function notify(text) {
  $('toast').textContent=text; $('toast').classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').classList.remove('show'),1600);
}
function selectMode(mode) {
  if(screen!=='intro') return;
  ride.reset(mode); previous=snapshot(); visual=snapshot();
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===ride.mode)));
  $('mission').textContent=ride.mode==='paseo'?'Recoge 8 sellos y disfruta la calle. Sin reloj, sin conos.':'8 sellos, 90 segundos. Acelera, esquiva los conos y encadena una vuelta perfecta.';
  const best=readRecord(storage,ride.mode);
  $('best').textContent=best?`TU RÉCORD · ${best.score} pts · ${formatTime(best.time)}`:'TU PRIMERA VUELTA EMPIEZA AQUÍ';
  renderHUD();
}
function reset(mode=ride.mode) {
  ride.reset(mode); clock.reset(); previous=snapshot(); visual=snapshot();
  bodyRoll.snap(); bodyPitch.snap(); suspension.snap(); particles=[]; countdown=0; buffering=true;
  photos.reset(0); $('loading').hidden=false; $('start').disabled=true; $('start').textContent='Preparando la calle…';
  clearTimeout(toastTimer); $('toast').classList.remove('show'); setScreen('intro'); selectMode(mode); last=performance.now();
}
function begin() {
  if(buffering || !['intro','paused'].includes(screen)) return;
  if(screen==='paused') { ride.play(); setScreen('playing'); }
  else { countdown=3; $('countdown').textContent='3'; setScreen('countdown'); motor.tone(440); }
  clock.reset(); last=performance.now(); keepAwake(); motor.context?.resume().catch(()=>{});
}
function pause() {
  if(!['playing','countdown'].includes(screen)) return;
  ride.pause(); countdown=0; clock.reset(); previous=snapshot(); visual=snapshot(); setScreen('paused');
}
function error(text='La conexión con la calle está tardando. Tu vuelta está guardada aquí.') {
  ride.pause(); buffering=true; clock.reset(); $('loading').hidden=true; $('error-message').textContent=text; setScreen('error');
}
function repair() {
  ride.pause(); photos.reset(photoAt(ride.distance)); buffering=true; $('loading').hidden=false;
  $('resume').disabled=true; $('start').disabled=true; $('start').textContent='Recargando la calle…';
  setScreen(ride.distance===0 && ride.elapsed===0?'intro':'paused');
}
function finish() {
  const record=saveRecord(storage,ride);
  setScreen('finished'); $('loading').hidden=true;
  $('finish-title').textContent=ride.status==='won'?(ride.stars===3?'¡Vuelta perfecta!':'¡Llegaste!'):'Se acabó el tiempo';
  $('finish-eyebrow').textContent=record?'NUEVO RÉCORD PERSONAL':ride.status==='won'?'TRAMO COMPLETADO':'RETO 92';
  $('result-stars').textContent='★'.repeat(ride.stars)+'☆'.repeat(3-ride.stars);
  $('result-stars').setAttribute('aria-label',`${ride.stars} de 3 estrellas`);
  $('result-score').textContent=ride.score;
  $('result').textContent=`${ride.collected}/8 sellos · ${ride.hits} golpes · ${formatTime(ride.elapsed)} · ${Math.round(ride.distance)} m`;
  $('result-tip').textContent=ride.status==='lost'?'Mantén ACELERA para salir. Frena antes de corregir.':ride.stars===3?'De principio a fin, con puro estilo sinaloense.':'Consigue los 8 sellos sin tocar conos para ganar tres estrellas.';
  motor.tone(523,ride.status==='won'?1046:196,.4);
}
function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch {} }
function span() { return Math.max(30,Math.min(width*.28,200,(width-$('rider').offsetWidth-92)/2)); }
function ground() { return Math.max(height*.55,height-77); }
function burst(lane) {
  if(reduced) return;
  for(let i=0;i<12;i++) particles.push({x:width/2+lane*span(),y:ground()-34,vx:(Math.random()-.5)*170,vy:-40-Math.random()*120,life:.6});
  particles=particles.slice(-36);
}
function update(dt) {
  if(screen==='intro'||screen==='paused') {
    const index=photoAt(ride.distance);
    if(photos.warm(index)) {
      buffering=false; $('loading').hidden=true; $('start').disabled=false; $('resume').disabled=false;
      $('start').textContent='Encender y salir';
    } else if(photos.failed(index)) error();
    return;
  }
  if(screen==='countdown') {
    const old=Math.ceil(countdown); countdown-=dt;
    $('countdown').textContent=countdown>0?Math.ceil(countdown):'¡VAMOS!';
    if(countdown<=0) { ride.play(); setScreen('playing'); motor.tone(880); }
    else if(old!==Math.ceil(countdown)) motor.tone(440);
    return;
  }
  if(screen!=='playing') return;
  let requested=photoAt(ride.distance);
  const events=ride.step(dt,held(),index=>{requested=index;return photos.canDrive(index);});
  buffering=events.some(e=>e.kind==='buffer'); $('loading').hidden=!buffering;
  if(buffering && photos.failed(requested)) { error(); return; }
  for(const event of events) {
    if(event.kind==='seal') { notify(`+${event.points} · sello ${ride.collected}/8${ride.combo>1?` · combo ×${ride.combo}`:''}`); motor.tone(660,990,.2); vibrate(16); burst(event.lane); }
    else if(event.kind==='hit') { notify('¡Cono! −50 puntos'); suspension.velocity+=24; motor.tone(110,55,.2); vibrate([25,30,25]); }
    else if(event.kind==='miss') notify('Sello perdido · alinea las ruedas con el aro');
    else if(event.kind==='finish') finish();
  }
}
function resize() {
  const r=$('street').getBoundingClientRect(); width=Math.max(1,r.width); height=Math.max(1,r.height);
  const ratio=Math.min(devicePixelRatio||1,1.6); canvas.width=Math.round(width*ratio); canvas.height=Math.round(height*ratio); ctx.setTransform(ratio,0,0,ratio,0,0); particles=[];
}
function drawCourse(dt) {
  ctx.clearRect(0,0,width,height); if(screen!=='playing') return;
  const horizon=height*.49,floor=ground(),half=span();
  for(let i=ride.objects.length-1;i>=0;i--) {
    const o=ride.objects[i],d=o.distance-visual.distance; if(o.passed||d<0||d>80) continue;
    const p=10/(d+10),x=width/2+o.lane*half*p,y=horizon+(floor-horizon)*p;
    const radius=clamp(Math.min(width*.08,33)*p,3,34);
    ctx.save(); ctx.globalAlpha=Math.min(1,(80-d)/16); ctx.lineWidth=Math.max(1.5,4*p);
    ctx.fillStyle='#111a1b50'; ctx.beginPath(); ctx.ellipse(x,y,radius*1.5,Math.max(2,radius*.23),0,0,Math.PI*2); ctx.fill();
    if(o.kind==='seal') {
      ctx.shadowColor='#ffb64f'; ctx.shadowBlur=10*p; ctx.strokeStyle='#ffb64f';
      ctx.beginPath(); ctx.arc(x,y-radius*2,radius,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle='#ffe0a0'; ctx.beginPath(); ctx.arc(x,y-radius*2,radius*.22,0,Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle='#f99137'; ctx.strokeStyle='#714122';
      ctx.beginPath(); ctx.moveTo(x,y-radius*2.8); ctx.lineTo(x+radius,y-3); ctx.lineTo(x-radius,y-3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#fff0d9'; ctx.beginPath(); ctx.moveTo(x-radius*.37,y-radius*1.7); ctx.lineTo(x+radius*.37,y-radius*1.7); ctx.lineTo(x+radius*.59,y-radius*1.12); ctx.lineTo(x-radius*.59,y-radius*1.12); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#3b3630'; ctx.fillRect(x-radius*1.2,y-4,radius*2.4,Math.max(2,radius*.25));
    }
    ctx.shadowBlur=0;
    if(o===ride.next) {
      const label=`${o.kind==='cone'?'CONO · ':''}${Math.ceil(d)} m`;
      ctx.font='700 11px system-ui'; ctx.textAlign='center'; const tw=ctx.measureText(label).width+14;
      ctx.fillStyle='#151b1de0'; ctx.fillRect(x-tw/2,y-radius*3-23,tw,19); ctx.fillStyle='#fff1d2'; ctx.fillText(label,x,y-radius*3-10);
    }
    ctx.restore();
  }
  if(LENGTH-visual.distance<50) {
    const p=10/(LENGTH-visual.distance+10),y=horizon+(floor-horizon)*p,cell=Math.max(3,half*.17*p);
    for(let row=0;row<2;row++) for(let col=0;col<12;col++) {ctx.fillStyle=(row+col)%2?'#172022cc':'#fff7e5ee';ctx.fillRect(width/2+(col-6)*cell,y+row*cell*.3,cell+.5,cell*.3+.5);}
  }
  for(const p of particles) {
    p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=220*dt;
    if(p.y>height-43) continue; ctx.globalAlpha=Math.max(0,p.life/.6);ctx.fillStyle='#ffd28c';ctx.fillRect(p.x,p.y,3,3);
  }
  ctx.globalAlpha=1;particles=particles.filter(p=>p.life>0);
}
function renderHUD() {
  $('speed').textContent=buffering||screen!=='playing'?'0':String(Math.round(ride.speed*3.6));
  $('gear').textContent=ride.speed<.5?'N':ride.speed<5?'1':ride.speed<9?'2':ride.speed<12?'3':'4';
  $('collected').textContent=ride.collected;$('score').textContent=ride.score;
  $('clock').textContent=formatTime(ride.remaining===null?ride.elapsed:Math.ceil(ride.remaining));
  $('clock').classList.toggle('urgent',ride.remaining!==null&&ride.remaining<15);
  $('distance').textContent=`${Math.round(ride.distance)} m`;$('remaining').textContent=`${Math.max(0,Math.round(LENGTH-ride.distance))} m`;
  $('progress').style.width=`${ride.distance/LENGTH*100}%`;
  const next=ride.next;
  $('next-object').textContent=next?`${next.kind==='cone'?'ESQUIVA':'SELLO'} ${next.lane<-.15?'←':next.lane>.15?'→':'↑'} ${Math.ceil(next.distance-ride.distance)} m`:'META';
  Object.assign(ui.dataset,{distance:ride.distance.toFixed(3),speed:ride.speed.toFixed(3),lane:ride.lane.toFixed(3),photo:String(photos.active?.index??0),buffering:String(buffering),score:String(ride.score),collected:String(ride.collected),hits:String(ride.hits),elapsed:ride.elapsed.toFixed(3),mode:ride.mode,physicsHz:'120'});
  Object.assign($('next-object').dataset,{lane:String(next?.lane??0),kind:next?.kind||'finish',distance:String(next?next.distance-ride.distance:LENGTH-ride.distance)});
}
function frame(now) {
  const dt=clamp((now-(last||now))/1000,0,.1);last=now;
  const alpha=clock.advance(dt,step=>{previous=snapshot();update(step);});
  for(const key of ['distance','lane','speed','steer']) visual[key]=lerp(previous[key],ride[key],alpha);
  photos.render(visual.distance,dt);drawCourse(dt);
  const active=screen==='playing'&&!buffering;
  const roll=bodyRoll.step(active?-ride.lateralVelocity*5:0,14,dt);
  const pitch=bodyPitch.step(active?-ride.acceleration*.6:0,12,dt);
  const roadBump=active?Math.sin(visual.distance*1.7)*Math.min(1.5,visual.speed*.12):0;
  const bounce=suspension.step(roadBump,20,dt);
  $('rider').style.transform=`translate3d(calc(-50% + ${(visual.lane*span()).toFixed(2)}px),${reduced?0:bounce.toFixed(2)}px,0) perspective(700px) rotateX(${reduced?0:pitch.toFixed(2)}deg) rotateZ(${reduced?0:roll.toFixed(2)}deg)`;
  motor.update(visual.speed,active,ride.throttle);
  hudTime+=dt;if(hudTime>=.06){renderHUD();hudTime=0;}
  requestAnimationFrame(frame);
}
for(const button of document.querySelectorAll('.drive')) {
  const key=button.dataset.key;
  button.addEventListener('pointerdown',e=>{e.preventDefault();if(screen!=='playing')return;input[key].add(`pointer-${e.pointerId}`);button.classList.add('active');try{button.setPointerCapture(e.pointerId);}catch{}});
  const release=e=>{input[key].delete(`pointer-${e.pointerId}`);button.classList.toggle('active',input[key].size>0);};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,release);
  button.addEventListener('contextmenu',e=>e.preventDefault());
}
const keys={ArrowLeft:'left',a:'left',ArrowRight:'right',d:'right',ArrowUp:'gas',w:'gas',ArrowDown:'brake',s:'brake',' ':'brake'};
window.addEventListener('keydown',e=>{
  if(e.target.closest('input,select,audio'))return;
  const key=e.key.length===1?e.key.toLowerCase():e.key;
  if(keys[key]&&screen==='playing'){e.preventDefault();input[keys[key]].add(`key-${key}`);}
  if(e.repeat)return;
  if(key==='Escape'||key==='p')screen==='paused'?begin():pause();
  if(key==='r'&&['playing','paused','finished'].includes(screen))reset();
});
window.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;if(keys[k])input[keys[k]].delete(`key-${k}`);});
window.addEventListener('blur',releaseInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseInputs();pause();last=0;clock.reset();}});
window.addEventListener('pagehide',()=>{releaseInputs();pause();});
window.addEventListener('offline',()=>{if(screen!=='finished')error('Sin conexión. Tu vuelta se conserva. Reconecta y pulsa Reintentar.');});
function action(id,fn){$(id).addEventListener('click',e=>{e.preventDefault();fn();});}
action('start',begin);action('resume',begin);action('pause',()=>screen==='paused'?begin():pause());
for(const id of ['restart','restart-pause','restart-error'])action(id,()=>reset());
for(const id of ['retry','repair','repair-intro'])action(id,repair);
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.mode)));
action('sound',async()=>{const enabled=await motor.toggle();$('sound').setAttribute('aria-pressed',String(enabled));$('sound').setAttribute('aria-label',enabled?'Silenciar motor':'Activar sonido del motor');$('sound').classList.toggle('enabled',enabled);});
action('fullscreen',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notify('Gira tu pantalla para una vista más amplia');}catch{notify('Tu navegador no permite pantalla completa');}});
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);
new ResizeObserver(resize).observe($('street'));
installRadio();resize();reset();requestAnimationFrame(frame);
