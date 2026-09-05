export const TRACKS=Object.freeze([
  {id:'BJhj7KrrPSg',title:'Vete Ya'}, {id:'1wauorb3vyg',title:'Soy Así'},
  {id:'4GufI9pKWFI',title:'Volveré A Amar'}, {id:'Yqpj6ig-OUc',title:'Te Quiero Así'},
  {id:'FrNTpDH5ruQ',title:'Vencedor'}
].map(Object.freeze));
let apiPromise;
function youtubeAPI(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const old=window.onYouTubeIframeAPIReady;let done=false;
    const timer=setTimeout(()=>{if(!done){done=true;apiPromise=null;reject(new Error('YouTube no respondió'));}},18000);
    window.onYouTubeIframeAPIReady=()=>{if(typeof old==='function')old();if(!done){done=true;clearTimeout(timer);resolve(window.YT);}};
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;
    script.onerror=()=>{if(!done){done=true;clearTimeout(timer);apiPromise=null;reject(new Error('No se pudo conectar con YouTube'));}};document.head.append(script);
  });return apiPromise;
}
export function installRadio(root){
  const $=id=>document.getElementById(id),panel=$('radio-panel'),mount=$('radio-player'),toggle=$('radio-toggle'),select=$('radio-track'),note=$('radio-note'),audio=$('local-audio');
  let opened=false,player=null,epoch=0,objectURL=null,wasLocalPlaying=false;
  for(const [i,t]of TRACKS.entries()){const o=document.createElement('option');o.value=i;o.textContent=t.title;select.append(o);}
  function status(text,state){note.textContent=text;root.dataset.music=state;}
  function destroyPlayer(){epoch++;if(player){try{player.destroy();}catch{}player=null;}mount.replaceChildren();}
  function current(){return TRACKS[Number(select.value)||0];}
  function load(){
    destroyPlayer();audio.pause();audio.hidden=true;mount.hidden=false;
    const t=current(),ticket=epoch;$('radio-link').href=`https://www.youtube.com/watch?v=${t.id}`;
    status('Conectando con el reproductor oficial…','loading');
    const frame=document.createElement('iframe');frame.id='official-player';frame.title=`Valentín Elizalde — ${t.title}`;frame.referrerPolicy='strict-origin-when-cross-origin';frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;
    frame.src=`https://www.youtube-nocookie.com/embed/${t.id}?${new URLSearchParams({playsinline:'1',controls:'1',rel:'0',enablejsapi:'1',autoplay:'1',origin:location.origin})}`;mount.append(frame);
    youtubeAPI().then(YT=>{
      if(!opened||ticket!==epoch||document.hidden)return;
      player=new YT.Player(frame,{events:{
        onReady:e=>{if(ticket!==epoch)return;e.target.setVolume(65);e.target.unMute();e.target.playVideo();status('Pulsa ▶ en el video si tu navegador solicita un toque.','ready');},
        onStateChange:e=>{if(ticket!==epoch)return;if(e.data===1)status('Reproduciendo · Valentín Elizalde','playing');else if(e.data===2)status('En pausa · pulsa ▶ para escuchar.','paused');else if(e.data===0){select.value=String((Number(select.value)+1)%TRACKS.length);load();}},
        onAutoplayBlocked:()=>{if(ticket===epoch)status('El navegador bloqueó el inicio automático. Toca ▶ dentro del video.','blocked');},
        onError:e=>{if(ticket!==epoch)return;status([101,150].includes(e.data)?'Esta canción no permite reproducción aquí. Elige otra o ábrela en YouTube.':e.data===153?'YouTube requiere identificar este sitio. Prueba «Abrir en YouTube».':'YouTube no pudo reproducir esta canción. Prueba otra o usa un archivo de tu dispositivo.','error');}
      }});
    }).catch(()=>{if(ticket===epoch&&opened)status('Toca ▶ dentro del video. Sin conexión: usa «Tu música» con un archivo local.','error');});
  }
  function close(){destroyPlayer();audio.pause();opened=false;panel.hidden=true;toggle.setAttribute('aria-expanded','false');root.classList.remove('radio-open');root.dataset.music='closed';}
  toggle.addEventListener('click',()=>{if(opened){close();return;}opened=true;panel.hidden=false;root.classList.add('radio-open');toggle.setAttribute('aria-expanded','true');load();});
  $('radio-close').addEventListener('click',close);select.addEventListener('change',load);
  $('radio-next').addEventListener('click',()=>{select.value=String((Number(select.value)+1)%TRACKS.length);load();});
  $('radio-play').addEventListener('click',()=>{if(!audio.hidden){audio.play().catch(()=>status('Toca ▶ en el reproductor de audio.','blocked'));}else if(player){player.unMute();player.playVideo();}else{load();}});
  $('music-file').addEventListener('change',()=>{
    const file=$('music-file').files?.[0];if(!file)return;
    if(!file.type.startsWith('audio/')&&!/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name)){status('Elige un archivo de audio compatible.','error');return;}
    destroyPlayer();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=URL.createObjectURL(file);mount.hidden=true;audio.hidden=false;audio.src=objectURL;audio.volume=.65;
    status(`Tu dispositivo · ${file.name} · no se sube a ningún servidor`,'local');audio.play().catch(()=>status('Archivo preparado. Toca ▶ en el audio para escucharlo.','blocked'));
  });
  audio.addEventListener('playing',()=>status('Reproduciendo tu archivo local · sin conexión','playing'));
  audio.addEventListener('error',()=>status('Este formato de audio no se pudo reproducir. Prueba MP3 o M4A.','error'));
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){wasLocalPlaying=!audio.paused;audio.pause();if(player)player.pauseVideo();}
    else if(opened){status(wasLocalPlaying?'Toca ▶ para continuar tu música.':'Toca ▶ para continuar la canción.','paused');}
  });
  window.addEventListener('pagehide',()=>{destroyPlayer();audio.pause();if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}});
  return {close};
}
