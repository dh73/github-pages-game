export const TRACKS = Object.freeze([
  {id:'BJhj7KrrPSg',title:'Vete Ya'},
  {id:'1wauorb3vyg',title:'Soy Así'},
  {id:'4GufI9pKWFI',title:'Volveré A Amar'},
  {id:'Yqpj6ig-OUc',title:'Te Quiero Así'},
  {id:'FrNTpDH5ruQ',title:'Vencedor'}
].map(Object.freeze));

export function installRadio(root) {
  const toggle = document.getElementById('radio-toggle');
  const panel = document.getElementById('radio-panel');
  const mount = document.getElementById('radio-player');
  const select = document.getElementById('radio-track');
  const link = document.getElementById('radio-link');
  const note = document.getElementById('radio-note');
  let opened = false;
  for (const [index,track] of TRACKS.entries()) {
    const option = document.createElement('option'); option.value=String(index); option.textContent=track.title; select.append(option);
  }
  function unload() { mount.replaceChildren(); }
  function load(autoplay = false) {
    unload();
    const index = Number(select.value)||0, track = TRACKS[index];
    link.href=`https://www.youtube.com/watch?v=${track.id}`;
    note.textContent='Pulsa ▶ en el video. YouTube puede mostrar anuncios o restricciones regionales.';
    if (!opened || document.hidden) return;
    const frame=document.createElement('iframe');
    frame.title=`Valentín Elizalde — ${track.title} · canal oficial VEVO`;
    frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen=true;
    const params=new URLSearchParams({playsinline:'1',controls:'1',rel:'0',autoplay:autoplay?'1':'0',origin:location.origin,
      playlist:TRACKS.slice(index+1).concat(TRACKS.slice(0,index)).map(t=>t.id).join(',')});
    frame.src=`https://www.youtube-nocookie.com/embed/${track.id}?${params}`;
    frame.onerror=()=>{ note.textContent='No cargó YouTube. Usa «Abrir en YouTube» o elige otra canción.'; };
    mount.append(frame);
  }
  function close() {
    unload(); opened=false; panel.hidden=true; root.classList.remove('radio-open');
    toggle.setAttribute('aria-expanded','false'); toggle.classList.remove('enabled');
  }
  toggle.addEventListener('click',()=>{
    if (opened) { close(); return; }
    opened=true; panel.hidden=false; root.classList.add('radio-open');
    toggle.setAttribute('aria-expanded','true'); toggle.classList.add('enabled'); load();
  });
  document.getElementById('radio-close').addEventListener('click',close);
  select.addEventListener('change',()=>load(true));
  document.getElementById('radio-next').addEventListener('click',()=>{
    select.value=String((Number(select.value)+1)%TRACKS.length); load(true);
  });
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) unload(); else if (opened) load();
  });
  window.addEventListener('pagehide',unload);
  // No hidden audio player, media downloads, autoplay on page load, or audio extraction.
  return {close};
}
