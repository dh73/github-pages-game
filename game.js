const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const resetBtn = document.getElementById('reset');

const state = {
  player: { x: 120, y: 260, r: 18, speed: 260 },
  target: { x: 700, y: 260, r: 13 },
  keys: new Set(),
  pointerTarget: null,
  score: 0,
  lastTime: performance.now()
};

function randomTarget() {
  const margin = 50;
  state.target.x = margin + Math.random() * (canvas.width - margin * 2);
  state.target.y = margin + Math.random() * (canvas.height - margin * 2);
}

function reset() {
  state.player.x = 120;
  state.player.y = canvas.height / 2;
  state.pointerTarget = null;
  state.score = 0;
  scoreEl.textContent = '0';
  randomTarget();
}

function update(dt) {
  let dx = 0;
  let dy = 0;

  if (state.keys.has('ArrowLeft') || state.keys.has('a')) dx -= 1;
  if (state.keys.has('ArrowRight') || state.keys.has('d')) dx += 1;
  if (state.keys.has('ArrowUp') || state.keys.has('w')) dy -= 1;
  if (state.keys.has('ArrowDown') || state.keys.has('s')) dy += 1;

  if (dx || dy) {
    state.pointerTarget = null;
    const length = Math.hypot(dx, dy);
    state.player.x += (dx / length) * state.player.speed * dt;
    state.player.y += (dy / length) * state.player.speed * dt;
  } else if (state.pointerTarget) {
    const px = state.pointerTarget.x - state.player.x;
    const py = state.pointerTarget.y - state.player.y;
    const distance = Math.hypot(px, py);

    if (distance > 3) {
      const step = Math.min(state.player.speed * dt, distance);
      state.player.x += (px / distance) * step;
      state.player.y += (py / distance) * step;
    }
  }

  state.player.x = Math.max(state.player.r, Math.min(canvas.width - state.player.r, state.player.x));
  state.player.y = Math.max(state.player.r, Math.min(canvas.height - state.player.r, state.player.y));

  const distanceToTarget = Math.hypot(
    state.player.x - state.target.x,
    state.player.y - state.target.y
  );

  if (distanceToTarget < state.player.r + state.target.r) {
    state.score += 1;
    scoreEl.textContent = String(state.score);
    randomTarget();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#2e2e2e';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 45) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffd54a';
  ctx.beginPath();
  ctx.arc(state.target.x, state.target.y, state.target.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#62d7ff';
  ctx.beginPath();
  ctx.arc(state.player.x, state.player.y, state.player.r, 0, Math.PI * 2);
  ctx.fill();
}

function frame(now) {
  const dt = Math.min((now - state.lastTime) / 1000, 0.05);
  state.lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key.startsWith('Arrow')) event.preventDefault();
  state.keys.add(key);
});

window.addEventListener('keyup', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  state.keys.delete(key);
});

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  state.pointerTarget = {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
});

resetBtn.addEventListener('click', reset);

reset();
requestAnimationFrame(frame);
