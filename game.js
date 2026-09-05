import {Ride,FixedClock,pose,interpolate,LENGTH,readRecord,saveRecord} from './ride-core.mjs?v=route-4';
import {RouteRenderer} from './route-renderer.mjs?v=route-4';
import {EngineAudio} from './engine-audio.mjs?v=route-4';
import {installRadio} from './radio.mjs?v=route-4';

const $=id=>document.getElementById(id),ui=$('game'),ride=new Ride(),clock=new FixedClock();
const controls=Object.fromEntries(['gas','brake','left','right'].map(k=>[k,new Set()]));
const held=()=>Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.size>0]));
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let renderer=null,screen='loading',previous=pose(ride),visual=pose(ride),last=0,countdown=0,hudClock=0,toastTimer=0,wakeLock=null,frameTimes=[],rafId=0;
let storage;try{storage=localStorage;}catch{storage=null;}
const audio=new EngineAudio(state=>{
  ui.dataset.audio=state;
  $('sound').setAttribute('aria-pressed',String(audio.enabled));
  $('sound').setAttribute('aria-label',audio.enabled?'Silenciar motor':'Activar motor');
  $('audio-state').textContent=state==='running'?'Sonido del motor activo.':state==='muted'?'Motor silenciado.':state==='blocked'?'Toca el altavoz para activar el sonido.':state==='unavailable'?'Este navegador no pudo iniciar el audio.':'El motor se enciende al salir.';
});
installRadio(ui);
const time=seconds=>`${Math.floor(Math.max(0,seconds)/60)}:${String(Math.floor(Math.max(0,seconds))%60).padStart(2,'0')}`;
function inputsOff(){for(const v of Object.values(controls))v.clear();document.querySelectorAll('.drive').forEach(b=>b.classList.remove('active'));}
function notify(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),1800);}
function setScreen(value){
  screen=value;ui.dataset.status=value;clock.reset();previous=pose(ride);visual=pose(ride);
  for(const [id,s]of [['intro','intro'],['pause-screen','paused'],['finish','finished'],['error-screen','error']])$(id).hidden=value!==s;
  $('countdown').hidden=value!=='countdown';$('pedal-controls').inert=value!=='playing';
  $('pause').disabled=!['playing','countdown','paused'].includes(value);$('pause').setAttribute('aria-label',value==='paused'?'Continuar':'Pausar');
  if(value!=='playing')inputsOff();if(!['playing','countdown'].includes(value)){audio.silence();releaseWake();}
  renderHUD();
}
async function keepAwake(){
  try{if(!wakeLock&&navigator.wakeLock&&!document.hidden){const lock=await navigator.wakeLock.request('screen');if(!['playing','countdown'].includes(screen)){await lock.release();return;}wakeLock=lock;lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;});}}catch{}
}
function releaseWake(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}
function chooseMode(mode){
  if(screen!=='intro')return;ride.reset(mode);previous=pose(ride);visual=pose(ride);clock.reset();renderer?.resetCamera();
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===ride.mode)));
  $('mission').textContent=ride.mode==='paseo'?'Recoge 8 sellos y disfruta el recorrido. Sin reloj ni obstáculos.':'8 sellos, 90 segundos. Esquiva los conos y completa la vuelta.';
  const record=readRecord(storage,ride.mode);$('best').textContent=record?`TU RÉCORD · ${record.score} PTS · ${time(record.time)}`:'TU PRIMERA VUELTA EMPIEZA AQUÍ';renderHUD();
}
function reset(){
  inputsOff();ride.reset();previous=pose(ride);visual=pose(ride);clock.reset();renderer?.resetCamera();countdown=0;clearTimeout(toastTimer);$('toast').classList.remove('show');
  setScreen('intro');chooseMode(ride.mode);$('loading').hidden=true;$('start').disabled=!renderer?.ready;last=performance.now();
}
function unlockAudio(){
  return audio.unlock().then(ok=>{if(!ok&&audio.enabled)notify('Toca el altavoz y comprueba el volumen multimedia.');return ok;});
}
function begin(){
  if(!renderer?.ready||!['intro','paused'].includes(screen))return;
  // This call deliberately happens in the user's click, BEFORE the countdown.
  unlockAudio();keepAwake();
  if(screen==='paused'){ride.play();setScreen('playing');keepAwake();return;}
  countdown=3;$('countdown').textContent='3';setScreen('countdown');keepAwake();audio.update(ride,true);
}
function pause(){if(!['playing','countdown'].includes(screen))return;ride.pause();setScreen('paused');}
function fail(message){ride.pause();setScreen('error');$('loading').hidden=true;$('error-message').textContent=message||'El dispositivo pausó los gráficos. Tu avance se conserva; vuelve a activar la vista.';}
function finish(){
  const record=saveRecord(storage,ride);setScreen('finished');
  $('finish-eyebrow').textContent=record?'NUEVO RÉCORD PERSONAL':ride.status==='won'?'TRAMO COMPLETADO':'RETO 92';
  $('finish-title').textContent=ride.status==='won'?(ride.stars===3?'¡Vuelta perfecta!':'¡Llegaste!'):'Se acabó el tiempo';
  $('result-stars').textContent='★'.repeat(ride.stars)+'☆'.repeat(3-ride.stars);$('result-stars').setAttribute('aria-label',`${ride.stars} de 3 estrellas`);
  $('result-score').textContent=ride.score;$('result').textContent=`${ride.collected}/8 sellos · ${ride.hits} golpes · ${time(ride.elapsed)} · ${Math.round(ride.distance)} m`;
  $('result-tip').textContent=ride.status==='lost'?'Prueba Paseo para practicar sin reloj.':ride.stars===3?'De principio a fin, con puro estilo sinaloense.':'Recoge los 8 sellos sin tocar conos para ganar tres estrellas.';
  audio.tone(523,ride.status==='won'?1046:196,.4);
}
function events(items){
  for(const e of items){
    if(e.kind==='seal'){notify(`+${e.points} · sello ${ride.collected}/8`);audio.tone(660,990,.19);try{navigator.vibrate?.(16);}catch{}}
    else if(e.kind==='hit'){notify('¡Cono! −50 puntos');audio.tone(110,55,.18);try{navigator.vibrate?.([25,20,25]);}catch{}}
    else if(e.kind==='miss')notify('Sello perdido · alinea la cuatrimoto con el aro');
    else if(e.kind==='finish')finish();
  }
}
function renderHUD(){
  const km=Math.round(ride.speed*3.6);$('speed').textContent=km;$('gear').textContent=km<1?'N':km<14?'1':km<29?'2':km<43?'3':'4';
  $('distance').textContent=`${Math.round(ride.distance)} m`;$('remaining').textContent=`${Math.max(0,Math.round(LENGTH-ride.distance))} m`;$('progress').style.width=`${Math.min(100,ride.distance/LENGTH*100)}%`;
  $('clock').textContent=time(ride.remaining??ride.elapsed);$('collected').textContent=ride.collected;$('score').textContent=ride.score;
  const next=ride.next,cue=$('next-object');cue.textContent=next?`${next.kind==='seal'?'SELLO':'CONO'} ${next.lane<-.2?'←':next.lane>.2?'→':'↑'} ${Math.ceil(next.distance-ride.distance)}m`:'META';
  cue.dataset.kind=next?.kind||'';cue.dataset.lane=next?.lane??0;cue.dataset.distance=next?.distance??LENGTH;
  Object.assign(ui.dataset,{distance:ride.distance.toFixed(3),speed:ride.speed.toFixed(3),lane:ride.lane.toFixed(4),collected:String(ride.collected),hits:String(ride.hits),elapsed:ride.elapsed.toFixed(3),mode:ride.mode,lateralSpeed:ride.lateralSpeed.toFixed(4),buffering:'false',renderer:'local-webgl',sceneReady:String(!!renderer?.ready)});
}
function frame(now){
  const dt=Math.max(0,Math.min(.25,(now-(last||now))/1000));last=now;
  if(screen==='countdown'){
    const old=Math.ceil(countdown);countdown-=dt;$('countdown').textContent=String(Math.max(1,Math.ceil(countdown)));
    if(countdown<=0){ride.play();setScreen('playing');audio.tone(880,1046,.2);}else if(Math.ceil(countdown)!==old)audio.tone(440);
  }
  if(screen==='playing'){
    const alpha=clock.advance(dt,h=>{if(screen!=='playing')return false;previous=pose(ride);events(ride.step(h,held()));return screen==='playing';});
    visual=screen==='playing'?interpolate(previous,pose(ride),alpha):pose(ride);
  }else visual=pose(ride);
  renderer?.render(visual,ride.objects,dt,{playing:screen==='playing',reducedMotion});
  audio.update(ride,['playing','countdown'].includes(screen));
  hudClock+=dt;if(hudClock>=.10){renderHUD();hudClock=0;}
  if(screen==='playing'&&dt>0){frameTimes.push(dt);if(frameTimes.length>180)frameTimes.shift();}
  rafId=requestAnimationFrame(frame);
}
function resize(){const r=$('street').getBoundingClientRect();renderer?.resize(r.width,r.height);}
function changeCamera(){if(!renderer)return;renderer.camera=renderer.camera==='chase'?'driver':'chase';renderer.resetCamera();$('camera-label').textContent=renderer.camera==='chase'?'· CÁMARA TRASERA':'· AL MANILLAR';$('camera').setAttribute('aria-label',renderer.camera==='chase'?'Cambiar a vista del conductor':'Cambiar a cámara trasera');ui.dataset.camera=renderer.camera;}
for(const button of document.querySelectorAll('.drive')){
  const key=button.dataset.key;
  button.addEventListener('pointerdown',e=>{e.preventDefault();if(screen!=='playing')return;controls[key].add(`p${e.pointerId}`);button.classList.add('active');try{button.setPointerCapture(e.pointerId);}catch{}if(audio.enabled&&audio.context?.state!=='running')unlockAudio();});
  const up=e=>{controls[key].delete(`p${e.pointerId}`);button.classList.toggle('active',controls[key].size>0);};
  for(const t of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(t,up);
  button.addEventListener('contextmenu',e=>e.preventDefault());
}
const keys={w:'gas',ArrowUp:'gas',s:'brake',ArrowDown:'brake',' ':'brake',a:'left',ArrowLeft:'left',d:'right',ArrowRight:'right'};
window.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  if(keys[k]){if(screen==='playing'){e.preventDefault();controls[keys[k]].add(`k${k}`);}return;}
  if(e.repeat)return;if(k==='p'||k==='Escape')screen==='paused'?begin():pause();if(k==='r')reset();if(k==='c')changeCamera();
});
window.addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;if(keys[k])controls[keys[k]].delete(`k${k}`);});
window.addEventListener('blur',()=>{inputsOff();if(document.activeElement?.tagName!=='IFRAME')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){inputsOff();pause();audio.silence();releaseWake();}last=performance.now();});
window.addEventListener('pagehide',()=>{inputsOff();pause();audio.silence();releaseWake();cancelAnimationFrame(rafId);});
window.addEventListener('pageshow',e=>{if(e.persisted){last=performance.now();rafId=requestAnimationFrame(frame);}});
$('start').addEventListener('click',begin);$('resume').addEventListener('click',begin);$('pause').addEventListener('click',()=>screen==='paused'?begin():pause());
for(const id of ['restart','restart-pause'])$(id).addEventListener('click',reset);
$('retry').addEventListener('click',()=>{if(renderer?.ready){setScreen('paused');begin();}else location.reload();});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>chooseMode(b.dataset.mode)));
$('sound').addEventListener('click',()=>audio.toggle());
$('audio-check').addEventListener('click',()=>{if(!audio.enabled)audio.enabled=true;unlockAudio().then(ok=>{if(ok)audio.tone(440,660,.5);});});
$('engine-volume').addEventListener('input',e=>audio.setVolume(Number(e.target.value)/100));
$('camera').addEventListener('click',changeCamera);
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(ui.requestFullscreen)await ui.requestFullscreen();else notify('Gira tu dispositivo para ampliar la vista.');}catch{notify('Pantalla completa no disponible en este navegador.');}});
window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);new ResizeObserver(resize).observe($('street'));
// Read-only diagnostics allow tests to measure real rendering and PCM output.
Object.defineProperty(window,'cuatrimoto',{value:Object.freeze({version:'4.0',diagnostics:()=>({status:screen,distance:ride.distance,sceneReady:!!renderer?.ready,triangles:renderer?.triangles||0,frames:renderer?.frameCount||0,quality:renderer?.quality,camera:renderer?.lastPose,audio:audio.meter(),meanFrameMs:frameTimes.length?frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length*1000:0})})});
requestAnimationFrame(()=>{
  try{
    renderer=new RouteRenderer($('route-canvas'),{onLost:()=>fail('El dispositivo interrumpió WebGL. Tu vuelta está en pausa; al recuperar los gráficos podrás continuar.'),onRestored:()=>{resize();if(ride.distance===0)reset();else{setScreen('paused');notify('Gráficos restaurados. Tu avance se conserva.');}}});
    resize();renderer.render(pose(ride),ride.objects,0);renderer.gl.finish();
    $('loading').hidden=true;$('start').textContent='Encender y salir';$('start').disabled=false;setScreen('intro');chooseMode('reto');ui.dataset.camera='chase';
    last=performance.now();rafId=requestAnimationFrame(frame);
  }catch(e){fail(e.message);}
});
