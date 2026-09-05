export const TRACKS = Object.freeze([
  {id:'BJhj7KrrPSg',title:'Vete Ya'},
  {id:'1wauorb3vyg',title:'Soy Así'},
  {id:'4GufI9pKWFI',title:'Volveré A Amar'},
  {id:'Yqpj6ig-OUc',title:'Te Quiero Así'},
  {id:'FrNTpDH5ruQ',title:'Vencedor'}
].map(Object.freeze));
export const SPOTIFY_ARTIST = '3CAhiUHkUYT1mFtVHM9SHA';

export function installRadio(root) {
  const toggle = document.getElementById('radio-toggle');
  const panel = document.getElementById('radio-panel');
  const mount = document.getElementById('radio-player');
  const select = document.getElementById('radio-track');
  const next = document.getElementById('radio-next');
  const link = document.getElementById('radio-link');
  const note = document.getElementById('radio-note');
  const source = document.createElement('select');
  source.id = 'radio-source'; source.setAttribute('aria-label','Fuente de música');
  source.style.flex = '0 0 66px';
  for (const [value,title] of [['youtube','YouTube'],['spotify','Spotify'],['local','Local']]) {
    const option = document.createElement('option'); option.value=value; option.textContent=title; source.append(option);
  }
  source.value = 'youtube'; select.parentNode.insertBefore(source,select);
  let opened = false, audio = null, files = [], urls = [], localIndex = 0;
  for (const [index,track] of TRACKS.entries()) {
    const option = document.createElement('option'); option.value=String(index); option.textContent=track.title; select.append(option);
  }
  function unload() {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
    mount.replaceChildren();
  }
  function selectFile(index, autoplay = false) {
    if (!audio || !urls.length) return;
    localIndex = (index + urls.length) % urls.length;
    audio.src = urls[localIndex]; note.textContent=files[localIndex].name;
    const localSelect = mount.querySelector('select');
    if (localSelect) localSelect.value=String(localIndex);
    if (autoplay) audio.play().catch(()=>{ note.textContent='Pulsa ▶ para reproducir el archivo.'; });
  }
  function localPlayer(autoplay = false) {
    link.hidden=true;
    const box=document.createElement('div');
    box.style.cssText='height:100%;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:10px';
    const picker=document.createElement('input'); picker.type='file'; picker.multiple=true;
    picker.accept='audio/*,.mp3,.m4a,.ogg,.wav,.flac'; picker.setAttribute('aria-label','Elegir canciones de este dispositivo');
    picker.style.maxWidth='100%';
    const localSelect=document.createElement('select');localSelect.setAttribute('aria-label','Canción local');
    localSelect.style.cssText='width:100%;min-height:36px;background:#263134;color:#f8f3e8;border-radius:5px';
    for(const [i,file] of files.entries()) { const option=document.createElement('option');option.value=String(i);option.textContent=file.name;localSelect.append(option); }
    localSelect.hidden=!files.length;
    audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.style.width='100%';audio.volume=.65;
    localSelect.addEventListener('change',()=>selectFile(Number(localSelect.value),true));
    audio.addEventListener('ended',()=>selectFile(localIndex+1,true));
    audio.addEventListener('error',()=>{note.textContent='No se pudo reproducir el archivo. Prueba MP3 o M4A.';});
    picker.addEventListener('change',()=>{
      const picked=Array.from(picker.files||[]).filter(f=>f.type.startsWith('audio/')||/\.(mp3|m4a|ogg|wav|aac|flac)$/i.test(f.name));
      if(!picked.length)return;
      unload();urls.forEach(url=>URL.revokeObjectURL(url));files=picked;urls=files.map(file=>URL.createObjectURL(file));localIndex=0;
      load(true);
    });
    box.append(picker,localSelect,audio);mount.append(box);
    note.textContent='Selecciona música de tu dispositivo. Los archivos no se suben a internet.';
    next.disabled=!files.length;
    selectFile(localIndex,autoplay);
  }
  function load(autoplay = false) {
    unload();
    const mode=source.value;
    select.disabled=mode!=='youtube'; next.disabled=mode==='spotify'; link.hidden=false;
    if (!opened || document.hidden) return;
    if (mode==='local') { localPlayer(autoplay); return; }
    const frame=document.createElement('iframe');
    frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;
    if(mode==='spotify') {
      frame.title='Valentín Elizalde · reproductor oficial de Spotify';
      frame.src=`https://open.spotify.com/embed/artist/${SPOTIFY_ARTIST}?theme=0`;
      link.href=`https://open.spotify.com/artist/${SPOTIFY_ARTIST}`;link.textContent='Abrir en Spotify';
      note.textContent='Pulsa ▶ en Spotify. La reproducción completa depende de tu sesión y navegador.';
    } else {
      const index=Math.min(TRACKS.length-1,Math.max(0,Number(select.value)||0)),track=TRACKS[index];
      frame.title=`Valentín Elizalde — ${track.title} · canal oficial VEVO`;
      const params=new URLSearchParams({playsinline:'1',controls:'1',rel:'0',autoplay:autoplay?'1':'0',origin:location.origin,
        playlist:TRACKS.slice(index+1).concat(TRACKS.slice(0,index)).map(t=>t.id).join(',')});
      frame.src=`https://www.youtube-nocookie.com/embed/${track.id}?${params}`;
      link.href=`https://www.youtube.com/watch?v=${track.id}`;link.textContent='Abrir en YouTube';
      note.textContent='Pulsa ▶ en el video. YouTube puede mostrar anuncios o restricciones regionales.';
    }
    frame.onerror=()=>{note.textContent='No cargó el reproductor. Cambia de fuente o abre el enlace oficial.';};
    mount.append(frame);
  }
  function close() {
    unload();opened=false;panel.hidden=true;root.classList.remove('radio-open');
    toggle.setAttribute('aria-expanded','false');toggle.classList.remove('enabled');
  }
  toggle.addEventListener('click',()=>{
    if(opened){close();return;}
    opened=true;panel.hidden=false;root.classList.add('radio-open');
    toggle.setAttribute('aria-expanded','true');toggle.classList.add('enabled');load();
  });
  document.getElementById('radio-close').addEventListener('click',close);
  select.addEventListener('change',()=>load(true));source.addEventListener('change',()=>load());
  next.addEventListener('click',()=>{
    if(source.value==='local'){selectFile(localIndex+1,true);return;}
    if(source.value!=='youtube')return;
    select.value=String((Number(select.value)+1)%TRACKS.length);load(true);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)unload();else if(opened)load();});
  window.addEventListener('pagehide',unload);
  // No hidden stream, copied songs, automatic playback on page load or uploaded local files.
  return {close};
}
