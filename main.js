const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const syncLabel = document.getElementById("sync-label");
const syncFill = document.getElementById("sync-fill");

const W = canvas.width;
const H = canvas.height;

const keys = new Set();
let lastT = performance.now();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

const wires = [];
const trails = [];
const particles = [];
const enemies = [];

function makeWire(ax, ay, bx, by) {
  const len = Math.hypot(bx - ax, by - ay);
  return { ax, ay, bx, by, len };
}

function projectPointToSegment(px, py, wire) {
  const vx = wire.bx - wire.ax;
  const vy = wire.by - wire.ay;
  const t = clamp(((px - wire.ax) * vx + (py - wire.ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return {
    x: wire.ax + vx * t,
    y: wire.ay + vy * t,
    t,
    d2: dist2(px, py, wire.ax + vx * t, wire.ay + vy * t),
  };
}

function spawnWires() {
  const margin = 80;
  for (let i = 0; i < 12; i += 1) {
    const ax = rand(margin, W - margin);
    const ay = rand(margin, H - margin);
    const angle = rand(0, Math.PI * 2);
    const length = rand(200, 480);
    const bx = clamp(ax + Math.cos(angle) * length, margin, W - margin);
    const by = clamp(ay + Math.sin(angle) * length, margin, H - margin);
    wires.push(makeWire(ax, ay, bx, by));
  }
}

function spawnEnemies(n = 8) {
  for (let i = 0; i < n; i += 1) {
    enemies.push({
      x: rand(120, W - 120),
      y: rand(100, H - 100),
      vx: rand(-34, 34),
      vy: rand(-34, 34),
      r: 13,
      alive: true,
    });
  }
}

const player = {
  x: W * 0.5,
  y: H * 0.5,
  vx: 0,
  vy: 0,
  size: 15,
  speed: 220,
  dashSpeed: 660,
  onWire: false,
  wire: null,
  wireT: 0,
  wireDir: 1,
  sync: 100,
  canDash: true,
  dashCd: 0,
  possessing: false,
  possessT: 0,
  possessDur: 0.33,
  fromX: 0,
  fromY: 0,
  toX: 0,
  toY: 0,
};

function findNearestWire() {
  let nearest = null;
  let best = Infinity;
  for (const wire of wires) {
    const p = projectPointToSegment(player.x, player.y, wire);
    if (p.d2 < best) {
      best = p.d2;
      nearest = { wire, p };
    }
  }
  return nearest;
}

function startDash() {
  if (!player.canDash || player.possessing) return;
  const nearest = findNearestWire();
  if (!nearest || nearest.p.d2 > 90 * 90) return;

  player.onWire = true;
  player.wire = nearest.wire;
  player.wireT = nearest.p.t;
  player.x = nearest.p.x;
  player.y = nearest.p.y;

  const vx = player.wire.bx - player.wire.ax;
  const vy = player.wire.by - player.wire.ay;
  const len = Math.hypot(vx, vy) || 1;
  const nx = vx / len;
  const ny = vy / len;
  const intentX = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);
  const intentY = (keys.has("ArrowDown") || keys.has("s") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("w") ? 1 : 0);
  const dot = intentX * nx + intentY * ny;
  player.wireDir = dot >= 0 ? 1 : -1;

  player.canDash = false;
  player.dashCd = 0.28;
  player.sync = clamp(player.sync - 5, 0, 100);
}

function spawnTrail() {
  trails.push({
    x: player.x,
    y: player.y,
    life: 0.2,
    max: 0.2,
    speed: Math.hypot(player.vx, player.vy),
  });
}

function spawnPossession(fromX, fromY, toX, toY) {
  for (let i = 0; i < 60; i += 1) {
    const t = Math.random();
    particles.push({
      x: fromX + (toX - fromX) * t + rand(-16, 16),
      y: fromY + (toY - fromY) * t + rand(-16, 16),
      vx: rand(-140, 140),
      vy: rand(-140, 140),
      life: rand(0.16, 0.5),
      max: 0.5,
      c: Math.random() > 0.7 ? "#ff0033" : "#00ffff",
    });
  }
}

function triggerPossession(enemy) {
  player.possessing = true;
  player.possessT = 0;
  player.fromX = player.x;
  player.fromY = player.y;
  player.toX = enemy.x;
  player.toY = enemy.y;
  spawnPossession(player.x, player.y, enemy.x, enemy.y);
}

function update(dt) {
  player.dashCd -= dt;
  if (player.dashCd <= 0) player.canDash = true;

  const syncDrain = player.onWire ? 8.5 : 4.8;
  player.sync = clamp(player.sync - syncDrain * dt, 0, 100);

  const lowSync = player.sync < 35;
  const jitterMag = lowSync ? ((35 - player.sync) / 35) * 70 : 0;

  if (!player.possessing) {
    if (player.onWire && player.wire) {
      const rate = (player.dashSpeed / player.wire.len) * player.wireDir;
      player.wireT += rate * dt;
      if (player.wireT < 0 || player.wireT > 1) {
        player.wireT = clamp(player.wireT, 0, 1);
        player.onWire = false;
        player.wire = null;
      }
      if (player.wire) {
        player.x = player.wire.ax + (player.wire.bx - player.wire.ax) * player.wireT;
        player.y = player.wire.ay + (player.wire.by - player.wire.ay) * player.wireT;
        const vx = player.wire.bx - player.wire.ax;
        const vy = player.wire.by - player.wire.ay;
        const len = Math.hypot(vx, vy) || 1;
        player.vx = (vx / len) * player.dashSpeed * player.wireDir;
        player.vy = (vy / len) * player.dashSpeed * player.wireDir;
      }
    } else {
      let ix = (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("a") ? 1 : 0);
      let iy = (keys.has("ArrowDown") || keys.has("s") ? 1 : 0) - (keys.has("ArrowUp") || keys.has("w") ? 1 : 0);
      if (lowSync) {
        ix += rand(-jitterMag, jitterMag) * 0.015;
        iy += rand(-jitterMag, jitterMag) * 0.015;
      }

      const len = Math.hypot(ix, iy) || 1;
      ix /= len;
      iy /= len;
      const moveSpeed = player.speed + (100 - player.sync) * 1.2;
      player.vx = ix * moveSpeed;
      player.vy = iy * moveSpeed;
      player.x = clamp(player.x + player.vx * dt, 20, W - 20);
      player.y = clamp(player.y + player.vy * dt, 20, H - 20);
    }
  } else {
    player.possessT += dt;
    const t = clamp(player.possessT / player.possessDur, 0, 1);
    const ease = t * t * (3 - 2 * t);
    player.x = player.fromX + (player.toX - player.fromX) * ease;
    player.y = player.fromY + (player.toY - player.fromY) * ease;
    player.vx = (player.toX - player.fromX) / player.possessDur;
    player.vy = (player.toY - player.fromY) / player.possessDur;
    if (t >= 1) {
      player.possessing = false;
      player.onWire = false;
      player.wire = null;
      player.sync = clamp(player.sync + 16, 0, 100);
    }
  }

  const damageMul = player.sync < 35 ? 2 : 1;

  for (const e of enemies) {
    if (!e.alive) continue;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.x < 20 || e.x > W - 20) e.vx *= -1;
    if (e.y < 20 || e.y > H - 20) e.vy *= -1;

    const killRadius = player.onWire ? 26 * damageMul : 11;
    if (dist2(e.x, e.y, player.x, player.y) < (killRadius + e.r) ** 2) {
      e.alive = false;
      triggerPossession(e);
      player.sync = clamp(player.sync + 24, 0, 100);
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
    p.vx *= 0.95;
    p.vy *= 0.95;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (Math.hypot(player.vx, player.vy) > 260) {
    spawnTrail();
  }

  syncLabel.textContent = `SYNC: ${Math.round(player.sync)}% | DMG x${damageMul.toFixed(1)}`;
  syncFill.style.width = `${player.sync}%`;
}

function drawWire(wire) {
  ctx.strokeStyle = "rgba(0,255,255,0.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wire.ax, wire.ay);
  ctx.lineTo(wire.bx, wire.by);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0,255,255,0.2)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(wire.ax, wire.ay);
  ctx.lineTo(wire.bx, wire.by);
  ctx.stroke();
}

function drawPlayer(layerOffsetX = 0, layerOffsetY = 0, color = "#00ffff", alpha = 1) {
  const flicker = 0.84 + Math.random() * 0.16;
  ctx.globalAlpha = alpha * flicker;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  const s = player.size;
  ctx.fillRect(player.x - s / 2 + layerOffsetX, player.y - s / 2 + layerOffsetY, s, s);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function render() {
  const speed = Math.hypot(player.vx, player.vy);
  const glitch = clamp((speed - 180) / 520, 0, 1);
  const lowSyncShake = player.sync < 35 ? ((35 - player.sync) / 35) * 8 : 0;
  const shakeX = rand(-lowSyncShake, lowSyncShake);
  const shakeY = rand(-lowSyncShake, lowSyncShake);

  ctx.save();
  ctx.translate(shakeX, shakeY);

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-20, -20, W + 40, H + 40);

  for (const wire of wires) drawWire(wire);

  for (const trail of trails) {
    const t = trail.life / trail.max;
    const split = clamp((trail.speed - 180) / 520, 0, 1) * 7;

    ctx.globalAlpha = 0.2 * t;
    ctx.fillStyle = "#ff0033";
    ctx.fillRect(trail.x - 9 - split, trail.y - 9, 16, 16);
    ctx.fillStyle = "#00ffff";
    ctx.fillRect(trail.x - 9 + split, trail.y - 9, 16, 16);
    ctx.globalAlpha = 0.1 * t;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(trail.x - 8, trail.y - 8, 14, 14);
    ctx.globalAlpha = 1;
  }

  for (const e of enemies) {
    if (!e.alive) continue;
    ctx.fillStyle = "#ff0033";
    ctx.shadowColor = "#ff0033";
    ctx.shadowBlur = 18;
    ctx.fillRect(e.x - e.r, e.y - e.r, e.r * 2, e.r * 2);
    ctx.shadowBlur = 0;
  }

  const chroma = glitch * 7;
  drawPlayer(-chroma, 0, "#ff0033", 0.45 + glitch * 0.45);
  drawPlayer(chroma, 0, "#00ffff", 0.9);
  if (glitch > 0.12) drawPlayer(0, 0, "#ffffff", 0.18 + glitch * 0.25);

  for (const p of particles) {
    const t = p.life / p.max;
    ctx.globalAlpha = t;
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, 3, 3);
    ctx.globalAlpha = 1;
  }

  if (player.sync < 35) {
    ctx.fillStyle = `rgba(255,0,51,${(35 - player.sync) / 220})`;
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
  if (e.code === "Space") {
    e.preventDefault();
    startDash();
    return;
  }
  keys.add(e.key.toLowerCase());
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});

spawnWires();
spawnEnemies();
requestAnimationFrame(frame);
