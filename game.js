const START = { lat: 25.59315805, lng: -108.47109297 };
const ZOOM = 19;

const speedEl = document.getElementById('speed');
const checkpointsEl = document.getElementById('checkpoints');
const messageEl = document.getElementById('message');

const map = L.map('map', {
  zoomControl: false,
  attributionControl: true,
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  keyboard: false,
  boxZoom: false,
  zoomSnap: 0.25,
  preferCanvas: true
}).setView([START.lat, START.lng], ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  minZoom: 16,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const quadSvg = `
  <div class="quad-rotator" id="quad-rotator">
    <svg viewBox="0 0 86 86" aria-hidden="true">
      <ellipse cx="43" cy="71" rx="28" ry="8" fill="rgba(0,0,0,.22)"/>
      <rect x="13" y="16" width="13" height="24" rx="5" fill="#171717"/>
      <rect x="60" y="16" width="13" height="24" rx="5" fill="#171717"/>
      <rect x="13" y="50" width="13" height="24" rx="5" fill="#171717"/>
      <rect x="60" y="50" width="13" height="24" rx="5" fill="#171717"/>
      <path d="M26 18 L60 18 L65 31 L59 69 L27 69 L21 31 Z" fill="#a92118" stroke="#4d100c" stroke-width="3"/>
      <path d="M29 24 H57 L54 37 H32 Z" fill="#e0b428"/>
      <circle cx="43" cy="21" r="4" fill="#fff0a3"/>
      <path d="M31 55 Q43 48 55 55 L52 67 H34 Z" fill="#242424"/>
      <path d="M29 40 Q43 32 57 40 L53 57 H33 Z" fill="#f1eee4" stroke="#27231e" stroke-width="2"/>
      <circle cx="43" cy="35" r="8" fill="#a9653d"/>
      <ellipse cx="43" cy="30" rx="15" ry="5.4" fill="#f3e7b2" stroke="#5a4527" stroke-width="2"/>
      <path d="M36 28 Q43 18 50 28 Z" fill="#f3e7b2" stroke="#5a4527" stroke-width="2"/>
      <path d="M24 43 L15 37 M62 43 L71 37" stroke="#27231e" stroke-width="4" stroke-linecap="round"/>
      <path d="M32 41 L24 44 M54 41 L62 44" stroke="#a9653d" stroke-width="4" stroke-linecap="round"/>
    </svg>
  </div>`;

const quadIcon = L.divIcon({
  className: 'quad-icon',
  html: quadSvg,
  iconSize: [86, 86],
  iconAnchor: [43, 43]
});

const playerMarker = L.marker([START.lat, START.lng], {
  icon: quadIcon,
  interactive: false,
  zIndexOffset: 1000
}).addTo(map);

const checkpointCoords = [
  [25.59356, -108.47110],
  [25.59402, -108.47111],
  [25.59447, -108.47112],
  [25.59448, -108.47168],
  [25.59402, -108.47169],
  [25.59355, -108.47167]
];

const checkpointMarkers = checkpointCoords.map((coord, index) => {
  const icon = L.divIcon({
    className: 'checkpoint-icon',
    html: `<div class="checkpoint-dot" title="Punto ${index + 1}"></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
  return L.marker(coord, { icon, interactive: false, zIndexOffset: 400 }).addTo(map);
});

const state = {
  lat: START.lat,
  lng: START.lng,
  angle: 0,
  speed: 0,
  checkpoint: 0,
  lap: 0,
  lastTime: performance.now(),
  cameraTimer: 0,
  keys: {
    gas: false,
    brake: false,
    left: false,
    right: false
  }
};

function metersBetween(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLng - aLng) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function showMessage(text, timeout = 1700) {
  messageEl.textContent = text;
  messageEl.classList.remove('hide');
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => messageEl.classList.add('hide'), timeout);
}

function setCheckpointVisuals() {
  checkpointMarkers.forEach((marker, i) => {
    const el = marker.getElement();
    if (el) el.classList.toggle('done', i < state.checkpoint);
  });
  checkpointsEl.textContent = `${state.checkpoint}/${checkpointCoords.length}`;
}

function resetGame() {
  state.lat = START.lat;
  state.lng = START.lng;
  state.angle = 0;
  state.speed = 0;
  state.checkpoint = 0;
  state.cameraTimer = 0;
  state.lastTime = performance.now();
  playerMarker.setLatLng([state.lat, state.lng]);
  map.setView([state.lat, state.lng], ZOOM, { animate: false });
  speedEl.textContent = '0';
  setCheckpointVisuals();
  showMessage('Sigue las calles del mapa y pasa por los puntos amarillos', 3200);
}

function updatePhysics(dt) {
  const maxForward = 14.5;
  const maxReverse = -4.2;
  const accel = 7.2;
  const braking = 10.5;
  const rolling = 2.0;

  if (state.keys.gas) {
    if (state.speed < 0) state.speed += braking * dt;
    else state.speed += accel * dt;
  } else if (state.keys.brake) {
    if (state.speed > 0.25) state.speed -= braking * dt;
    else state.speed -= accel * 0.62 * dt;
  } else {
    if (state.speed > 0) state.speed = Math.max(0, state.speed - rolling * dt);
    if (state.speed < 0) state.speed = Math.min(0, state.speed + rolling * dt);
  }

  state.speed = Math.max(maxReverse, Math.min(maxForward, state.speed));

  const steerInput = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
  const moving = Math.min(1, Math.abs(state.speed) / 3.2);
  if (steerInput && Math.abs(state.speed) > 0.08) {
    const reverseSign = state.speed >= 0 ? 1 : -1;
    const steerRate = 1.75 - Math.min(.72, Math.abs(state.speed) / maxForward * .72);
    state.angle += steerInput * steerRate * moving * reverseSign * dt;
  }

  const distance = state.speed * dt;
  const north = Math.cos(state.angle) * distance;
  const east = Math.sin(state.angle) * distance;
  state.lat += north / 111320;
  state.lng += east / (111320 * Math.cos(state.lat * Math.PI / 180));

  const distanceFromStart = metersBetween(START.lat, START.lng, state.lat, state.lng);
  if (distanceFromStart > 900) {
    const bearingBack = Math.atan2(
      (START.lng - state.lng) * Math.cos(state.lat * Math.PI / 180),
      START.lat - state.lat
    );
    state.angle = bearingBack;
    state.speed *= .25;
    showMessage('Te estás saliendo del sector Ayuntamiento 92');
  }
}

function updateCheckpoint() {
  if (state.checkpoint >= checkpointCoords.length) return;
  const [lat, lng] = checkpointCoords[state.checkpoint];
  const distance = metersBetween(state.lat, state.lng, lat, lng);
  if (distance < 17) {
    state.checkpoint += 1;
    setCheckpointVisuals();
    if (state.checkpoint === checkpointCoords.length) {
      state.lap += 1;
      showMessage(`¡Vuelta ${state.lap} completa en Ayuntamiento 92!`, 3200);
      setTimeout(() => {
        state.checkpoint = 0;
        checkpointMarkers.forEach(marker => marker.getElement()?.classList.remove('done'));
        setCheckpointVisuals();
        showMessage('Otra vuelta. Dale.', 1800);
      }, 3300);
    } else {
      showMessage(`Punto ${state.checkpoint}/${checkpointCoords.length}`);
    }
  }
}

function render(dt) {
  playerMarker.setLatLng([state.lat, state.lng]);
  const rotator = document.getElementById('quad-rotator');
  if (rotator) rotator.style.transform = `rotate(${state.angle * 180 / Math.PI}deg)`;

  speedEl.textContent = String(Math.round(Math.abs(state.speed) * 3.6));

  state.cameraTimer += dt;
  if (state.cameraTimer > .065) {
    state.cameraTimer = 0;
    map.panTo([state.lat, state.lng], { animate: false, noMoveStart: true });
  }
}

function frame(now) {
  const dt = Math.min((now - state.lastTime) / 1000, 0.04);
  state.lastTime = now;
  updatePhysics(dt);
  updateCheckpoint();
  render(dt);
  requestAnimationFrame(frame);
}

function setKeyFromKeyboard(key, value) {
  if (key === 'w' || key === 'ArrowUp') state.keys.gas = value;
  if (key === 's' || key === 'ArrowDown') state.keys.brake = value;
  if (key === 'a' || key === 'ArrowLeft') state.keys.left = value;
  if (key === 'd' || key === 'ArrowRight') state.keys.right = value;
}

window.addEventListener('keydown', event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key.startsWith('Arrow')) event.preventDefault();
  if (key === 'r') resetGame();
  setKeyFromKeyboard(key, true);
});

window.addEventListener('keyup', event => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  setKeyFromKeyboard(key, false);
});

window.addEventListener('blur', () => {
  Object.keys(state.keys).forEach(key => { state.keys[key] = false; });
});

document.querySelectorAll('.control').forEach(button => {
  const input = button.dataset.key;
  const down = event => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    state.keys[input] = true;
    button.classList.add('active');
  };
  const up = event => {
    event.preventDefault();
    state.keys[input] = false;
    button.classList.remove('active');
  };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('lostpointercapture', up);
});

map.whenReady(() => {
  setTimeout(() => map.invalidateSize(), 50);
  resetGame();
  requestAnimationFrame(frame);
});
