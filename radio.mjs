// Official artist embed. Audio is streamed by Spotify, never copied into this repo.
export const ARTIST = '3CAhiUHkUYT1mFtVHM9SHA';
export function installRadio() {
  const button = document.getElementById('radio-toggle');
  const panel = document.getElementById('radio-panel');
  const mount = document.getElementById('radio-player');
  const audio = document.getElementById('local-audio');
  const select = document.getElementById('local-tracks');
  const note = document.getElementById('radio-status');
  let files = [], urls = [], mode = 'spotify';
  function stopEmbed() { mount.replaceChildren(); }
  function spotify() {
    mode = 'spotify'; audio.pause(); stopEmbed();
    const frame = document.createElement('iframe');
    frame.title = 'Valentín Elizalde · reproductor oficial de Spotify';
    frame.src = `https://open.spotify.com/embed/artist/${ARTIST}?theme=0`;
    frame.width = '100%'; frame.height = '152'; frame.style.border = '0';
    frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    frame.setAttribute('allowfullscreen', '');
    mount.append(frame);
    note.textContent = 'Pulsa ▶ en Spotify. La reproducción completa depende de tu sesión y navegador.';
    document.getElementById('local-player').hidden = true;
  }
  function open() {
    panel.hidden = false; document.body.classList.add('radio-open'); button.setAttribute('aria-expanded', 'true');
    if (mode === 'spotify') spotify();
  }
  function close() {
    audio.pause(); stopEmbed(); panel.hidden = true; document.body.classList.remove('radio-open');
    button.setAttribute('aria-expanded', 'false'); button.focus({preventScroll: true});
  }
  button.addEventListener('click', () => panel.hidden ? open() : close());
  document.getElementById('radio-close').addEventListener('click', close);
  document.getElementById('radio-spotify').addEventListener('click', spotify);
  async function playFile(index) {
    if (!urls[index]) return;
    audio.src = urls[index]; select.value = String(index);
    try { await audio.play(); note.textContent = files[index].name; }
    catch { note.textContent = 'Pulsa reproducir para escuchar el archivo.'; }
  }
  document.getElementById('music-files').addEventListener('change', event => {
    const picked = [...event.target.files].filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|ogg|wav|aac|flac)$/i.test(f.name));
    if (!picked.length) { note.textContent = 'Selecciona archivos de audio de tu dispositivo.'; return; }
    audio.pause(); audio.removeAttribute('src'); audio.load(); urls.forEach(URL.revokeObjectURL);
    stopEmbed(); mode = 'local'; files = picked; urls = files.map(f => URL.createObjectURL(f));
    select.replaceChildren(...files.map((file, i) => { const option = document.createElement('option'); option.value = i; option.textContent = file.name; return option; }));
    document.getElementById('local-player').hidden = false; playFile(0);
  });
  select.addEventListener('change', () => playFile(Number(select.value)));
  audio.addEventListener('ended', () => playFile((Number(select.value) + 1) % urls.length));
  audio.addEventListener('error', () => { note.textContent = 'Este archivo no se puede reproducir. Prueba MP3 o M4A.'; });
  window.addEventListener('pagehide', () => { audio.pause(); stopEmbed(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.pause(); stopEmbed(); } else if (!panel.hidden && mode === 'spotify') spotify(); });
}
