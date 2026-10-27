'use strict';

// ===== КОНФИГ =====
const CONFIG = {
  W: 480,
  H: 800,
  GRAVITY: 1400,
  JUMP_POWER: 750,
  RESTITUTION: 0.7,
  FRICTION: 0.998,       // трение по горизонтали (медленное)
  FRICTION_Y: 0.999,     // трение по вертикали
  STOP_SPEED: 30,
  COYOTE_TIME: 0.05,
  SHOW_ARROW: true,
  BALL_RADIUS: 14,
  SURFACE: 12,
  STICK_RADIUS: 64,
  STICK_KNOB: 28,
  STICK_MARGIN: 24,
  STICK_DEADZONE: 0.15,
  STICK_ACCEL: 2200,
  MAX_STICK_SPEED: 420,
  JUMP_BUFFER: 0.15,
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
  onWall: false,
  wallJumpUsed: false,
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
  nx: 0,
  ny: 0,
  // запомненное направление (B-режим)
  dirX: 0,
  dirY: 0,
};
stick.knobX = stick.baseX;
stick.knobY = stick.baseY;

const input = {
  angle: -Math.PI / 2,
  jumpQueued: false,
  jumpBuffer: 0,
};

// ===== ВВОД: СТИК =====
function updateStickFromPointer(px, py) {
  const dx = px - stick.baseX;
  const dy = py - stick.baseY;
  const dist = Math.hypot(dx, dy);
  const max = CONFIG.STICK_RADIUS;

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

  const ndx = (kx - stick.baseX) / max;
  const ndy = (ky - stick.baseY) / max;
  const mag = Math.hypot(ndx, ndy);

  if (mag < CONFIG.STICK_DEADZONE) {
    stick.nx = 0;
    stick.ny = 0;
    stick.dirX = 0;
    stick.dirY = 0;
  } else {
    stick.nx = ndx;
    stick.ny = ndy;
    // ЗАПОМИНАЕМ направление — режим B
    stick.dirX = ndx;
    stick.dirY = ndy;
    input.angle = Math.atan2(ndy, ndx);
  }
}

function resetStickVisual() {
  stick.knobX = stick.baseX;
  stick.knobY = stick.baseY;
  stick.active = false;
  stick.pointerId = null;
  // ВАЖНО: dirX/dirY НЕ сбрасываем — шар продолжает катиться
}

function pointerToCanvas(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left) * (W / r.width),
    y: (clientY - r.top) * (H / r.height),
  };
}

function isInStickZone(x, y) {
  return x < W * 0.5 && y > H * 0.5;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = pointerToCanvas(e.clientX, e.clientY);
  if (isInStickZone(p.x, p.y)) {
    stick.baseX = p.x;
    stick.baseY = p.y;
    stick.active = true;
    stick.pointerId = e.pointerId;
    updateStickFromPointer(p.x, p.y);
  } else {
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
    const moved = Math.hypot(stick.nx, stick.ny) > CONFIG.STICK_DEADZONE;
    if (!moved) {
      // тап по стику без движения = сброс направления + прыжок
      stick.dirX = 0;
      stick.dirY = 0;
      input.jumpQueued = true;
    }
    resetStickVisual();
    stick.baseX = CONFIG.STICK_MARGIN + CONFIG.STICK_RADIUS;
    stick.baseY = H - CONFIG.STICK_MARGIN - CONFIG.STICK_RADIUS;
    stick.knobX = stick.baseX;
    stick.knobY = stick.baseY;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

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
  let touchedFloor = false;
  let touchedWall = false;
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

    if (Math.abs(ny) > 0.7) touchedFloor = true;
    else touchedWall = true;

    ball.lastTouch = performance.now() / 1000;
  }

  const now = performance.now() / 1000;
  ball.onSurface = touchedFloor || touchedWall || (now - ball.lastTouch) < CONFIG.COYOTE_TIME;

  if (touchedFloor) {
    ball.wallJumpUsed = false;
    ball.onWall = false;
  } else if (touchedWall) {
    ball.onWall = true;
  } else {
    ball.onWall = false;
  }
}

function update(dt) {
  const now = performance.now() / 1000;

  // гравитация
  ball.vy += CONFIG.GRAVITY * dt;

  // РЕЖИМ B: шар катится по запомненному направлению стика
  // На полу — только горизонталь. В воздухе — только горизонталь.
  // На стене — ничего (только прыжок). Вертикаль от стика НЕ даём.
  const dirMag = Math.hypot(stick.dirX, stick.dirY);
  if (dirMag > 0) {
    if (ball.onSurface && !ball.onWall) {
      // на полу: катим по горизонтали
      ball.vx += stick.dirX * CONFIG.STICK_ACCEL * dt;
    } else if (!ball.onSurface) {
      // в воздухе: слабое подруливание по горизонтали
      ball.vx += stick.dirX * CONFIG.AIR_CONTROL * dt;
    }
    // на стене — ничего
  }
  // трение
  ball.vx *= Math.pow(CONFIG.FRICTION, dt * 60);
  ball.vy *= Math.pow(CONFIG.FRICTION_Y, dt * 60);

  // ограничение скорости по горизонтали
  if (Math.abs(ball.vx) > CONFIG.MAX_STICK_SPEED) {
    ball.vx = Math.sign(ball.vx) * CONFIG.MAX_STICK_SPEED;
  }

  // движение
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  resolveCollisions();

  // гасим мелочь только если направление не задано
  const speed = Math.hypot(ball.vx, ball.vy);
  if (ball.onSurface && dirMag === 0 && speed < CONFIG.STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }

  // буфер прыжка
  if (input.jumpQueued) {
    input.jumpBuffer = CONFIG.JUMP_BUFFER;
    input.jumpQueued = false;
  }
  if (input.jumpBuffer > 0) {
    input.jumpBuffer -= dt;

    const canFloorJump = ball.onSurface && !ball.onWall && (now - ball.lastTouch) < 0.06;
    const canWallJump = ball.onWall && !ball.wallJumpUsed && (now - ball.lastTouch) < 0.06;

    if (canFloorJump || canWallJump) {
      const ang = (dirMag > 0) ? Math.atan2(stick.dirY, stick.dirX) : -Math.PI / 2;
      ball.vx = Math.cos(ang) * CONFIG.JUMP_POWER;
      ball.vy = Math.sin(ang) * CONFIG.JUMP_POWER;
      ball.onSurface = false;
      ball.onWall = false;
      ball.lastTouch = -999;
      if (canWallJump) ball.wallJumpUsed = true;
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
  ball.onWall = false;
  ball.wallJumpUsed = false;
  ball.lastTouch = performance.now() / 1000;
  stick.dirX = 0;
  stick.dirY = 0;
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
  ctx.beginPath();
  ctx.arc(stick.baseX, stick.baseY, CONFIG.STICK_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fill();
  ctx.strokeStyle = stick.active ? 'rgba(120, 220, 255, 0.8)' : 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

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

  // шар — ВСЕГДА светлый
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, CONFIG.BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#7de3ff';
  ctx.fill();
  ctx.strokeStyle = '#ffffff44';
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
