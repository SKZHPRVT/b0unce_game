'use strict';

// ===== КОНФИГ =====
const CONFIG = {
  W: 480,
  H: 800,
  GRAVITY: 1400,
  JUMP_POWER: 750,
  RESTITUTION: 0.7,
  FRICTION: 0.999,
  STOP_SPEED: 30,
  COYOTE_TIME: 0.22,
  SHOW_ARROW: true,
  BALL_RADIUS: 14,
  SURFACE: 12,
  // виртуальный стик
  STICK_RADIUS: 64,        // внешний радиус
  STICK_KNOB: 28,          // радиус ручки
  STICK_MARGIN: 24,        // отступ от края
  STICK_DEADZONE: 0.15,
  JUMP_BUFFER: 0.15,
  AIR_CONTROL: 900,    // мёртвая зона (0..1)
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = CONFIG.W;
const H = CONFIG.H;

// ===== УРОВЕНЬ 1 =====
const LEVEL = {
  walls: [
    { x: 0, y: 0, w: W, h: CONFIG.SURFACE },
    { x: 0, y: H - CONFIG.SURFACE, w: W, h: CONFIG.SURFACE },
    { x: 0, y: 0, w: CONFIG.SURFACE, h: H },
    { x: W - CONFIG.SURFACE, y: 0, w: CONFIG.SURFACE, h: H },
    { x: 120, y: 600, w: 240, h: CONFIG.SURFACE },
    { x: 60,  y: 420, w: 180, h: CONFIG.SURFACE },
    { x: 260, y: 300, w: 160, h: CONFIG.SURFACE },
  ],
  target: { x: W / 2, y: 90, r: 26 },
};

// ===== ИГРОК =====
const ball = {
  x: W / 2,
  y: H - CONFIG.SURFACE - CONFIG.BALL_RADIUS - 2,
  vx: 0,
  vy: 0,
  onSurface: false,
  lastTouch: 0,
};

// ===== ВИРТУАЛЬНЫЙ СТИК =====
const stick = {
  baseX: CONFIG.STICK_MARGIN + CONFIG.STICK_RADIUS,
  baseY: H - CONFIG.STICK_MARGIN - CONFIG.STICK_RADIUS,
  knobX: 0,
  knobY: 0,
  active: false,
  pointerId: null,
  // нормализованный вектор (-1..1)
  nx: 0,
  ny: 0,
};
stick.knobX = stick.baseX;
stick.knobY = stick.baseY;

const input = {
  angle: -Math.PI / 2, // угол по умолчанию — вверх
  jumpQueued: false,
  jumpBuffer: 0,
};

// ===== ВВОД: стик =====
function updateStickFromPointer(px, py) {
  const dx = px - stick.baseX;
  const dy = py - stick.baseY;
  const dist = Math.hypot(dx, dy);
  const max = CONFIG.STICK_RADIUS;

  // ограничиваем ручку кругом
  let kx, ky;
  if (dist > max) {
    kx = stick.baseX + (dx / dist) * max;
    ky = stick.baseY + (dy / dist) * max;
  } else {
    kx = px;
    ky = py;
  }
  stick.knobX = kx;
  stick.knobY = ky;

  // нормализованный вектор
  const ndx = (kx - stick.baseX) / max;
  const ndy = (ky - stick.baseY) / max;
  const mag = Math.hypot(ndx, ndy);

  if (mag < CONFIG.STICK_DEADZONE) {
    stick.nx = 0;
    stick.ny = 0;
  } else {
    stick.nx = ndx;
    stick.ny = ndy;
    input.angle = Math.atan2(ndy, ndx);
  }
}

function resetStick() {
  stick.knobX = stick.baseX;
  stick.knobY = stick.baseY;
  stick.nx = 0;
  stick.ny = 0;
  stick.active = false;
  stick.pointerId = null;
}

// координаты указателя → координаты canvas (с учётом масштаба CSS)
function pointerToCanvas(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (W / r.width),
    y: (clientY - r.top) * (H / r.height),
  };
}

function isInStickZone(x, y) {
  // зона стика — вся нижняя левая четверть экрана
  return x < W * 0.5 && y > H * 0.5;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = pointerToCanvas(e.clientX, e.clientY);
  if (isInStickZone(p.x, p.y)) {
    // активируем стик — база в точке касания
    stick.baseX = p.x;
    stick.baseY = p.y;
    stick.active = true;
    stick.pointerId = e.pointerId;
    updateStickFromPointer(p.x, p.y);
  } else {
    // вне зоны стика — прыжок
    input.jumpQueued = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (stick.active && e.pointerId === stick.pointerId) {
    const p = pointerToCanvas(e.clientX, e.clientY);
    updateStickFromPointer(p.x, p.y);
  }
});

function endPointer(e) {
  if (stick.active && e.pointerId === stick.pointerId) {
    // если стик почти не двигали — это был тап, считаем прыжком
    const moved = Math.hypot(stick.nx, stick.ny) > CONFIG.STICK_DEADZONE;
    if (!moved) input.jumpQueued = true;
    resetStick();
    // вернуть базу на место (по умолчанию)
    stick.baseX = CONFIG.STICK_MARGIN + CONFIG.STICK_RADIUS;
    stick.baseY = H - CONFIG.STICK_MARGIN - CONFIG.STICK_RADIUS;
    stick.knobX = stick.baseX;
    stick.knobY = stick.baseY;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// клавиатура — только пробел для прыжка (на десктопе удобно тестить)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { input.jumpQueued = true; e.preventDefault(); }
});

// ===== ФИЗИКА =====
function circleRectCollide(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  const dist = Math.hypot(dx, dy);
  return { hit: dist < r, nx, ny, dx, dy, dist };
}

function resolveCollisions() {
  let touchedThisFrame = false;
  for (const rect of LEVEL.walls) {
    const c = circleRectCollide(ball.x, ball.y, CONFIG.BALL_RADIUS, rect);
    if (!c.hit) continue;
    let nx, ny;
    if (c.dist === 0) {
      const left = ball.x - rect.x;
      const right = rect.x + rect.w - ball.x;
      const top = ball.y - rect.y;
      const bottom = rect.y + rect.h - ball.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left)  { nx = -1; ny = 0; }
      else if (m === right) { nx = 1; ny = 0; }
      else if (m === top) { nx = 0; ny = -1; }
      else { nx = 0; ny = 1; }
    } else {
      nx = c.dx / c.dist;
      ny = c.dy / c.dist;
    }
    const overlap = CONFIG.BALL_RADIUS - c.dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= (1 + CONFIG.RESTITUTION) * vn * nx;
      ball.vy -= (1 + CONFIG.RESTITUTION) * vn * ny;
    }
    touchedThisFrame = true;
    ball.lastTouch = performance.now() / 1000;
  }
  // "залипание": onSurface держится COYOTE_TIME после последнего касания
  const now = performance.now() / 1000;
  ball.onSurface = touchedThisFrame || (now - ball.lastTouch) < CONFIG.COYOTE_TIME;
}

function update(dt) {
  const now = performance.now() / 1000;

  // гравитация
  ball.vy += CONFIG.GRAVITY * dt;

  // подруливание в воздухе (стик влияет на траекторию)
  if (!ball.onSurface && (stick.nx !== 0 || stick.ny !== 0)) {
    ball.vx += stick.nx * CONFIG.AIR_CONTROL * dt;
    ball.vy += stick.ny * CONFIG.AIR_CONTROL * dt;
  }

  // трение
  ball.vx *= Math.pow(CONFIG.FRICTION, dt * 60);

  // движение
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  resolveCollisions();

  // "лежит" на поверхности — гасим мелочь
  const speed = Math.hypot(ball.vx, ball.vy);
  if (ball.onSurface && speed < CONFIG.STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }

  // буфер прыжка: если нажали, но прыжок недоступен — запоминаем на JUMP_BUFFER
  if (input.jumpQueued) {
    input.jumpBuffer = CONFIG.JUMP_BUFFER;
    input.jumpQueued = false;
  }
  if (input.jumpBuffer > 0) {
    input.jumpBuffer -= dt;
    if (ball.onSurface) {
      ball.vx = Math.cos(input.angle) * CONFIG.JUMP_POWER;
      ball.vy = Math.sin(input.angle) * CONFIG.JUMP_POWER;
      ball.onSurface = false;
      ball.lastTouch = -999;
      input.jumpBuffer = 0;
    }
  }

  // мишень
  const t = LEVEL.target;
  if (Math.hypot(ball.x - t.x, ball.y - t.y) < t.r + CONFIG.BALL_RADIUS) {
    win();
  }
}

function win() {
  document.getElementById('level').textContent = 'Уровень 1 — пройден!';
  document.getElementById('hint').textContent = 'F5 — заново.';
  ball.vx = 0;
  ball.vy = 0;
  ball.x = W / 2;
  ball.y = H - CONFIG.SURFACE - CONFIG.BALL_RADIUS - 2;
  ball.onSurface = true;
  ball.lastTouch = performance.now() / 1000;
}

// ===== РЕНДЕР =====
function drawArrow() {
  if (!CONFIG.SHOW_ARROW) return;
  const len = 70;
  const ax = ball.x + Math.cos(input.angle) * len;
  const ay = ball.y + Math.sin(input.angle) * len;
  const active = ball.onSurface;
  ctx.save();
  ctx.strokeStyle = active ? 'rgba(120, 220, 255, 0.95)' : 'rgba(120, 220, 255, 0.20)';
  ctx.lineWidth = active ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(ball.x, ball.y);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  const head = 10;
  const ang = Math.atan2(ay - ball.y, ax - ball.x);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - Math.cos(ang - 0.5) * head, ay - Math.sin(ang - 0.5) * head);
  ctx.lineTo(ax - Math.cos(ang + 0.5) * head, ay - Math.sin(ang + 0.5) * head);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.restore();
}

function drawStick() {
  // внешний круг
  ctx.beginPath();
  ctx.arc(stick.baseX, stick.baseY, CONFIG.STICK_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fill();
  ctx.strokeStyle = stick.active ? 'rgba(120, 220, 255, 0.8)' : 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ручка
  ctx.beginPath();
  ctx.arc(stick.knobX, stick.knobY, CONFIG.STICK_KNOB, 0, Math.PI * 2);
  ctx.fillStyle = stick.active ? 'rgba(120, 220, 255, 0.85)' : 'rgba(255, 255, 255, 0.35)';
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#3a3a44';
  for (const r of LEVEL.walls) {
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  const t = LEVEL.target;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 200, 80, 0.25)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 200, 80, 0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawArrow();

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, CONFIG.BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = ball.onSurface ? '#7de3ff' : '#4aa9c4';
  ctx.fill();
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth = 1;
  ctx.stroke();

  drawStick();
}

// ===== ЦИКЛ =====
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
