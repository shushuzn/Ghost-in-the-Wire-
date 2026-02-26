const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const syncLabel = document.getElementById("sync-label");
const syncFill = document.getElementById("sync-fill");

const W = canvas.width;
const H = canvas.height;

const keys = new Set();
let lastT = performance.now();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);

const cfg = {
  colors: {
    cyan: "#00ffff",
    red: "#ff0033",
    white: "#ffffff",
    amber: "#ffbf00",
  },
  player: {
    size: 15,
    baseSpeed: 220,
    dashSpeed: 660,
    dashCooldown: 0.24,
    attachRadius: 92,
  },
  sync: {
    start: 100,
    critical: 35,
    passiveDrain: 4.5,
    dashDrain: 8.8,
  },
  enemy: {
    patrolSpeed: 56,
    chaseSpeed: 100,
    evadeSpeed: 128,
    chaseRadius: 210,
    evadeRadius: 92,
    retargetMin: 0.8,
    retargetMax: 1.8,
  },
};

const nodes = [
  { x: 120, y: 120 },
  { x: 360, y: 90 },
  { x: 640, y: 130 },
  { x: 920, y: 110 },
  { x: 150, y: 340 },
  { x: 380, y: 300 },
  { x: 620, y: 360 },
  { x: 930, y: 330 },
  { x: 100, y: 580 },
  { x: 370, y: 560 },
  { x: 660, y: 540 },
  { x: 950, y: 560 },
];

const links = [
  [0, 1], [1, 2], [2, 3],
  [4, 5], [5, 6], [6, 7],
  [8, 9], [9, 10], [10, 11],
  [0, 4], [4, 8], [1, 5], [5, 9], [2, 6], [6, 10], [3, 7], [7, 11],
  [1, 4], [2, 5], [6, 9], [7, 10],
];

const wires = links.map(([a, b]) => {
  const A = nodes[a];
  const B = nodes[b];
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  return { ax: A.x, ay: A.y, bx: B.x, by: B.y, dx, dy, len: Math.hypot(dx, dy) || 1 };
});

const trails = [];
const particles = [];
const enemies = [];

const player = {
  x: W * 0.5,
  y: H * 0.5,
  vx: 0,
  vy: 0,
  size: cfg.player.size,
  speed: cfg.player.baseSpeed,
  dashSpeed: cfg.player.dashSpeed,
  onWire: false,
  wire: null,
  wireT: 0,
  wireDir: 1,
  dashCd: 0,
  canDash: true,
  sync: cfg.sync.start,
  possessing: false,
  possessT: 0,
  possessDur: 0.32,
  fromX: 0,
  fromY: 0,
  toX: 0,
  toY: 0,
  hurtCd: 0,
};

const feedback = {
  hitFlash: 0,
};

const audio = {
  ctx: null,
  enabled: false,
};

function ensureAudioContext() {
  if (audio.ctx) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  audio.ctx = new Ctor();
  audio.enabled = true;
}

function playTone({ freq = 220, type = "square", gain = 0.03, attack = 0.005, decay = 0.1, slide = null } = {}) {
  if (!audio.enabled || !audio.ctx) return;
  const now = audio.ctx.currentTime;
  const osc = audio.ctx.createOscillator();
  const amp = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slide && Number.isFinite(slide.to)) {
    osc.frequency.linearRampToValueAtTime(slide.to, now + (slide.time || decay));
  }
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.linearRampToValueAtTime(gain, now + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  osc.connect(amp);
  amp.connect(audio.ctx.destination);
  osc.start(now);
  osc.stop(now + decay + 0.03);
}

function sfxDash() {
  playTone({ freq: 280, type: "sawtooth", gain: 0.025, decay: 0.08, slide: { to: 520, time: 0.08 } });
}

function sfxKill() {
  playTone({ freq: 620, type: "square", gain: 0.04, decay: 0.11, slide: { to: 220, time: 0.11 } });
}

function sfxHit() {
  playTone({ freq: 120, type: "triangle", gain: 0.04, decay: 0.14, slide: { to: 70, time: 0.14 } });
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function projectToWire(px, py, wire) {
  const t = clamp(((px - wire.ax) * wire.dx + (py - wire.ay) * wire.dy) / (wire.len * wire.len), 0, 1);
  const x = wire.ax + wire.dx * t;
  const y = wire.ay + wire.dy * t;
  return { t, x, y, d2: dist2(px, py, x, y) };
}

function nearestWire(px, py) {
  let best = Infinity;
  let hit = null;
  for (const wire of wires) {
    const p = projectToWire(px, py, wire);
    if (p.d2 < best) {
      best = p.d2;
      hit = { wire, p };
    }
  }
  return hit;
}

function createEnemies(count = 10) {
  for (let i = 0; i < count; i += 1) {
    enemies.push({
      x: rand(120, W - 120),
      y: rand(100, H - 100),
      vx: rand(-48, 48),
      vy: rand(-48, 48),
      r: 13,
      alive: true,
      state: "patrol",
      stateT: rand(cfg.enemy.retargetMin, cfg.enemy.retargetMax),
      patrolAngle: rand(0, Math.PI * 2),
    });
  }
}

function beginDash() {
  if (!player.canDash || player.possessing) return;
  const nearest = nearestWire(player.x, player.y);
  if (!nearest || nearest.p.d2 > cfg.player.attachRadius ** 2) return;

  player.onWire = true;
  player.wire = nearest.wire;
  player.wireT = nearest.p.t;
  player.x = nearest.p.x;
  player.y = nearest.p.y;

  const nx = player.wire.dx / player.wire.len;
  const ny = player.wire.dy / player.wire.len;
  const inputX = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  const inputY = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  player.wireDir = inputX * nx + inputY * ny >= 0 ? 1 : -1;

  player.canDash = false;
  player.dashCd = cfg.player.dashCooldown;
  player.sync = clamp(player.sync - 6, 0, 100);
  sfxDash();
}

function emitTrail() {
  trails.push({ x: player.x, y: player.y, life: 0.24, max: 0.24, speed: Math.hypot(player.vx, player.vy) });
}

function emitPossessionParticles(fromX, fromY, toX, toY) {
  for (let i = 0; i < 80; i += 1) {
    const t = Math.random();
    particles.push({
      x: fromX + (toX - fromX) * t + rand(-22, 22),
      y: fromY + (toY - fromY) * t + rand(-22, 22),
      vx: rand(-160, 160),
      vy: rand(-160, 160),
      life: rand(0.16, 0.52),
      max: 0.52,
      c: Math.random() > 0.72 ? cfg.colors.red : cfg.colors.cyan,
    });
  }
}

function possessTo(enemy) {
  player.possessing = true;
  player.possessT = 0;
  player.fromX = player.x;
  player.fromY = player.y;
  player.toX = enemy.x;
  player.toY = enemy.y;
  emitPossessionParticles(player.x, player.y, enemy.x, enemy.y);
}

function tryChainWire() {
  if (!player.wire) return;
  if (player.wireT > 0.05 && player.wireT < 0.95) return;

  const edgeX = player.wireT <= 0 ? player.wire.ax : player.wire.bx;
  const edgeY = player.wireT <= 0 ? player.wire.ay : player.wire.by;

  let target = null;
  let best = 18 * 18;
  for (const wire of wires) {
    if (wire === player.wire) continue;
    const dA = dist2(edgeX, edgeY, wire.ax, wire.ay);
    const dB = dist2(edgeX, edgeY, wire.bx, wire.by);
    if (dA < best) {
      best = dA;
      target = { wire, t: 0, dir: 1 };
    }
    if (dB < best) {
      best = dB;
      target = { wire, t: 1, dir: -1 };
    }
  }

  if (target) {
    player.wire = target.wire;
    player.wireT = target.t;
    player.wireDir = target.dir;
    player.x = edgeX;
    player.y = edgeY;
  }
}

function updateEnemyAI(enemy, dt) {
  const dx = player.x - enemy.x;
  const dy = player.y - enemy.y;
  const d = Math.hypot(dx, dy) || 1;

  if (d < cfg.enemy.evadeRadius || player.onWire) {
    enemy.state = "evade";
  } else if (d < cfg.enemy.chaseRadius) {
    enemy.state = "chase";
  } else {
    enemy.state = "patrol";
  }

  enemy.stateT -= dt;
  if (enemy.stateT <= 0) {
    enemy.patrolAngle += rand(-0.9, 0.9);
    enemy.stateT = rand(cfg.enemy.retargetMin, cfg.enemy.retargetMax);
  }

  if (enemy.state === "patrol") {
    enemy.vx = Math.cos(enemy.patrolAngle) * cfg.enemy.patrolSpeed;
    enemy.vy = Math.sin(enemy.patrolAngle) * cfg.enemy.patrolSpeed;
  } else if (enemy.state === "chase") {
    enemy.vx = (dx / d) * cfg.enemy.chaseSpeed;
    enemy.vy = (dy / d) * cfg.enemy.chaseSpeed;
  } else {
    enemy.vx = (-dx / d) * cfg.enemy.evadeSpeed;
    enemy.vy = (-dy / d) * cfg.enemy.evadeSpeed;
  }
}

function update(dt) {
  player.dashCd -= dt;
  player.hurtCd -= dt;
  feedback.hitFlash = Math.max(0, feedback.hitFlash - dt * 4.2);
  if (player.dashCd <= 0) player.canDash = true;

  player.sync = clamp(player.sync - (player.onWire ? cfg.sync.dashDrain : cfg.sync.passiveDrain) * dt, 0, 100);

  const critical = player.sync < cfg.sync.critical;
  const jitter = critical ? ((cfg.sync.critical - player.sync) / cfg.sync.critical) * 76 : 0;

  if (!player.possessing) {
    if (player.onWire && player.wire) {
      player.wireT += ((player.dashSpeed * player.wireDir) / player.wire.len) * dt;
      if (player.wireT < 0 || player.wireT > 1) {
        tryChainWire();
        player.wireT = clamp(player.wireT, 0, 1);
        if (!player.wire || (player.wireT === 0 && player.wireDir < 0) || (player.wireT === 1 && player.wireDir > 0)) {
          player.onWire = false;
          player.wire = null;
        }
      }
      if (player.wire) {
        player.x = player.wire.ax + player.wire.dx * player.wireT;
        player.y = player.wire.ay + player.wire.dy * player.wireT;
        player.vx = (player.wire.dx / player.wire.len) * player.dashSpeed * player.wireDir;
        player.vy = (player.wire.dy / player.wire.len) * player.dashSpeed * player.wireDir;
      }
    } else {
      let ix = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      let iy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      if (critical) {
        ix += rand(-jitter, jitter) * 0.014;
        iy += rand(-jitter, jitter) * 0.014;
      }
      const len = Math.hypot(ix, iy) || 1;
      ix /= len;
      iy /= len;
      const speed = player.speed + (100 - player.sync) * 1.15;
      player.vx = ix * speed;
      player.vy = iy * speed;
      player.x = clamp(player.x + player.vx * dt, 16, W - 16);
      player.y = clamp(player.y + player.vy * dt, 16, H - 16);
    }
  } else {
    player.possessT += dt;
    const t = clamp(player.possessT / player.possessDur, 0, 1);
    const eased = t * t * (3 - 2 * t);
    player.x = player.fromX + (player.toX - player.fromX) * eased;
    player.y = player.fromY + (player.toY - player.fromY) * eased;
    player.vx = (player.toX - player.fromX) / player.possessDur;
    player.vy = (player.toY - player.fromY) / player.possessDur;
    if (t >= 1) {
      player.possessing = false;
      player.onWire = false;
      player.wire = null;
      player.sync = clamp(player.sync + 18, 0, 100);
    }
  }

  const damageMul = critical ? 2 : 1;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    updateEnemyAI(enemy, dt);
    enemy.x += enemy.vx * dt;
    enemy.y += enemy.vy * dt;

    if (enemy.x < 18 || enemy.x > W - 18) {
      enemy.vx *= -1;
      enemy.patrolAngle += Math.PI * 0.7;
    }
    if (enemy.y < 18 || enemy.y > H - 18) {
      enemy.vy *= -1;
      enemy.patrolAngle += Math.PI * 0.7;
    }

    enemy.x = clamp(enemy.x, 18, W - 18);
    enemy.y = clamp(enemy.y, 18, H - 18);

    const killRadius = player.onWire ? 26 * damageMul : 10;
    if (dist2(player.x, player.y, enemy.x, enemy.y) < (killRadius + enemy.r) ** 2) {
      enemy.alive = false;
      possessTo(enemy);
      player.sync = clamp(player.sync + 24, 0, 100);
      sfxKill();
      continue;
    }

    const bodyHitRadius = enemy.r + player.size * 0.46;
    if (!player.onWire && !player.possessing && player.hurtCd <= 0 && dist2(player.x, player.y, enemy.x, enemy.y) < bodyHitRadius ** 2) {
      player.sync = clamp(player.sync - 12, 0, 100);
      player.hurtCd = 0.55;
      feedback.hitFlash = 1;
      sfxHit();
    }
  }

  for (let i = trails.length - 1; i >= 0; i -= 1) {
    trails[i].life -= dt;
    if (trails[i].life <= 0) trails.splice(i, 1);
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (Math.hypot(player.vx, player.vy) > 240) emitTrail();

  syncLabel.textContent = `SYNC: ${Math.round(player.sync)}% | DMG x${damageMul.toFixed(1)}${critical ? " // CRITICAL" : ""}`;
  syncFill.style.width = `${player.sync}%`;
}

function drawWire(wire, highlighted = false) {
  ctx.strokeStyle = highlighted ? "rgba(255,0,51,0.8)" : "rgba(0,255,255,0.62)";
  ctx.lineWidth = highlighted ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(wire.ax, wire.ay);
  ctx.lineTo(wire.bx, wire.by);
  ctx.stroke();

  ctx.strokeStyle = highlighted ? "rgba(255,0,51,0.22)" : "rgba(0,255,255,0.18)";
  ctx.lineWidth = highlighted ? 10 : 7;
  ctx.beginPath();
  ctx.moveTo(wire.ax, wire.ay);
  ctx.lineTo(wire.bx, wire.by);
  ctx.stroke();
}

function drawGhost(offsetX, color, alpha) {
  const flicker = 0.84 + Math.random() * 0.16;
  ctx.globalAlpha = alpha * flicker;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillRect(player.x - player.size / 2 + offsetX, player.y - player.size / 2, player.size, player.size);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawEnemy(enemy) {
  const stateColor = enemy.state === "chase" ? cfg.colors.amber : enemy.state === "evade" ? cfg.colors.cyan : cfg.colors.red;
  ctx.fillStyle = stateColor;
  ctx.shadowColor = stateColor;
  ctx.shadowBlur = 16;
  ctx.fillRect(enemy.x - enemy.r, enemy.y - enemy.r, enemy.r * 2, enemy.r * 2);
  ctx.shadowBlur = 0;
}

function render() {
  const speed = Math.hypot(player.vx, player.vy);
  const glitch = clamp((speed - 160) / 560, 0, 1);
  const critical = player.sync < cfg.sync.critical;
  const shakePower = critical ? ((cfg.sync.critical - player.sync) / cfg.sync.critical) * 9 : 0;
  const shakeX = rand(-shakePower, shakePower);
  const shakeY = rand(-shakePower, shakePower);

  ctx.save();
  ctx.translate(shakeX, shakeY);

  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(-24, -24, W + 48, H + 48);

  const near = nearestWire(player.x, player.y);
  const highlighted = near && near.p.d2 < cfg.player.attachRadius ** 2 ? near.wire : null;
  for (const wire of wires) drawWire(wire, wire === highlighted);

  for (const t of trails) {
    const k = t.life / t.max;
    const split = clamp((t.speed - 160) / 560, 0, 1) * 8;
    ctx.globalAlpha = 0.25 * k;
    ctx.fillStyle = cfg.colors.red;
    ctx.fillRect(t.x - 9 - split, t.y - 9, 16, 16);
    ctx.fillStyle = cfg.colors.cyan;
    ctx.fillRect(t.x - 9 + split, t.y - 9, 16, 16);
    ctx.globalAlpha = 0.09 * k;
    ctx.fillStyle = cfg.colors.white;
    ctx.fillRect(t.x - 8, t.y - 8, 14, 14);
    ctx.globalAlpha = 1;
  }

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    drawEnemy(enemy);
  }

  const chroma = glitch * 8;
  drawGhost(-chroma, cfg.colors.red, 0.48 + glitch * 0.42);
  drawGhost(chroma, cfg.colors.cyan, 0.9);
  if (glitch > 0.12) drawGhost(0, cfg.colors.white, 0.2 + glitch * 0.22);

  for (const p of particles) {
    const k = p.life / p.max;
    ctx.globalAlpha = k;
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, 3, 3);
    ctx.globalAlpha = 1;
  }

  if (critical) {
    ctx.fillStyle = `rgba(255,0,51,${(cfg.sync.critical - player.sync) / 190})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (feedback.hitFlash > 0) {
    ctx.fillStyle = `rgba(255,191,0,${feedback.hitFlash * 0.2})`;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.033);
  lastT = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

window.addEventListener("keydown", (e) => {
  ensureAudioContext();
  if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
  if (e.code === "Space") {
    e.preventDefault();
    beginDash();
    return;
  }
  keys.add(e.key.toLowerCase());
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});

createEnemies();
requestAnimationFrame(frame);
