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
  skills: {
    overloadCd: 9,
    shortCd: 11,
    mirrorCd: 13,
  },
  perf: {
    tier: "high",
  },
};

const wires = [];
const trails = [];
const trailPool = [];
const particles = [];
const particlePool = [];
const enemies = [];
const rooms = [];
const mirrorEchoes = [];
const staticLayer = document.createElement("canvas");
staticLayer.width = W;
staticLayer.height = H;
const staticCtx = staticLayer.getContext("2d");
let levelSeed = 1;

const meta = {
  shards: 0,
  unlocked: ["base"],
  protocol: "base",
};

const regression = {
  frameAvgMs: 16.7,
  frameSamples: 0,
  dashAttempts: 0,
  dashSuccesses: 0,
  dashLatencyMsAvg: 0,
  dashLatencySamples: 0,
  lastDashKeydown: 0,
};

window.__ghostMetrics = regression;

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
  possessBuff: null,
  possessBuffT: 0,
  skillCd: { overload: 0, short: 0, mirror: 0 },
};

function updateMetaUnlocks() {
  if (meta.shards >= 6 && !meta.unlocked.includes("rift")) meta.unlocked.push("rift");
  if (meta.shards >= 12 && !meta.unlocked.includes("surge")) meta.unlocked.push("surge");
}

function nextProtocol() {
  const idx = meta.unlocked.indexOf(meta.protocol);
  meta.protocol = meta.unlocked[(idx + 1) % meta.unlocked.length];
}

function protocolDamageBonus() {
  if (meta.protocol === "surge") return 0.35;
  return 0;
}

function protocolDrainMul() {
  if (meta.protocol === "rift") return 0.78;
  return 1;
}


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

const sfxDash = () => playTone({ freq: 280, type: "sawtooth", gain: 0.025, decay: 0.08, slide: { to: 520, time: 0.08 } });
const sfxKill = () => playTone({ freq: 620, type: "square", gain: 0.04, decay: 0.11, slide: { to: 220, time: 0.11 } });
const sfxHit = () => playTone({ freq: 120, type: "triangle", gain: 0.04, decay: 0.14, slide: { to: 70, time: 0.14 } });

const traitTypes = ["swift", "tank", "volatile"];

function sfxSkill() {
  playTone({ freq: 420, type: "square", gain: 0.03, decay: 0.1, slide: { to: 760, time: 0.1 } });
}

function useOverload() {
  if (player.skillCd.overload > 0) return;
  player.skillCd.overload = cfg.skills.overloadCd;
  player.sync = clamp(player.sync - 10, 0, 100);
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const d = Math.hypot(enemy.x - player.x, enemy.y - player.y);
    if (d < 180) {
      enemy.alive = false;
      emitPossessionParticles(enemy.x, enemy.y, enemy.x + rand(-30, 30), enemy.y + rand(-30, 30));
    }
  }
  sfxSkill();
}

function useShortCircuit() {
  if (player.skillCd.short > 0) return;
  player.skillCd.short = cfg.skills.shortCd;
  player.sync = clamp(player.sync - 6, 0, 100);
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    enemy.stateT = 0;
    enemy.vx *= 0.18;
    enemy.vy *= 0.18;
  }
  feedback.hitFlash = Math.max(feedback.hitFlash, 0.5);
  sfxSkill();
}

function useMirror() {
  if (player.skillCd.mirror > 0) return;
  player.skillCd.mirror = cfg.skills.mirrorCd;
  mirrorEchoes.push({ x: player.x, y: player.y, life: 3.2, max: 3.2 });
  sfxSkill();
}


function allocTrail(x, y, speed) {
  const t = trailPool.pop() || { x: 0, y: 0, life: 0, max: 0, speed: 0 };
  t.x = x;
  t.y = y;
  t.life = 0.24;
  t.max = 0.24;
  t.speed = speed;
  trails.push(t);
}

function freeTrail(i) {
  const t = trails[i];
  trails.splice(i, 1);
  trailPool.push(t);
}

function allocParticle(x, y, vx, vy, life, c) {
  const p = particlePool.pop() || { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, c: "#00ffff" };
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = life;
  p.max = life;
  p.c = c;
  particles.push(p);
}

function freeParticle(i) {
  const p = particles[i];
  particles.splice(i, 1);
  particlePool.push(p);
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function makeWire(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y, dx, dy, len: Math.hypot(dx, dy) || 1 };
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

function buildRooms(seed) {
  rooms.length = 0;
  const cols = 3;
  const rows = 2;
  const pad = 56;
  const gap = 28;
  const rw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const rh = (H - pad * 2 - gap * (rows - 1)) / rows;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const density = 0.45 + (((seed + x * 7 + y * 13) % 9) / 8) * 0.55;
      rooms.push({
        id: y * cols + x,
        x: pad + x * (rw + gap),
        y: pad + y * (rh + gap),
        w: rw,
        h: rh,
        density,
      });
    }
  }
}

function buildWiresFromRooms() {
  wires.length = 0;

  for (const room of rooms) {
    const cx = room.x + room.w * 0.5;
    const cy = room.y + room.h * 0.5;

    const nodeCount = Math.floor(4 + room.density * 5);
    const nodes = [];
    for (let i = 0; i < nodeCount; i += 1) {
      const edge = i % 4;
      if (edge === 0) nodes.push({ x: rand(room.x + 18, room.x + room.w - 18), y: room.y + 10 });
      if (edge === 1) nodes.push({ x: room.x + room.w - 10, y: rand(room.y + 18, room.y + room.h - 18) });
      if (edge === 2) nodes.push({ x: rand(room.x + 18, room.x + room.w - 18), y: room.y + room.h - 10 });
      if (edge === 3) nodes.push({ x: room.x + 10, y: rand(room.y + 18, room.y + room.h - 18) });
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      wires.push(makeWire(a, b));
      if (room.density > 0.72 && i % 2 === 0) wires.push(makeWire(a, { x: cx, y: cy }));
    }
  }

  // room connectors
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      const ax = a.x + a.w * 0.5;
      const ay = a.y + a.h * 0.5;
      const bx = b.x + b.w * 0.5;
      const by = b.y + b.h * 0.5;
      const sameRow = Math.abs(ay - by) < 5;
      const sameCol = Math.abs(ax - bx) < 5;
      if (sameRow || sameCol) wires.push(makeWire({ x: ax, y: ay }, { x: bx, y: by }));
    }
  }
}

function createEnemiesFromRooms() {
  enemies.length = 0;
  for (const room of rooms) {
    const count = Math.max(1, Math.floor(1 + room.density * 3));
    for (let i = 0; i < count; i += 1) {
      enemies.push({
        x: rand(room.x + 24, room.x + room.w - 24),
        y: rand(room.y + 24, room.y + room.h - 24),
        vx: rand(-48, 48),
        vy: rand(-48, 48),
        r: 13,
        alive: true,
        state: "patrol",
        stateT: rand(cfg.enemy.retargetMin, cfg.enemy.retargetMax),
        patrolAngle: rand(0, Math.PI * 2),
        trait: traitTypes[Math.floor(rand(0, traitTypes.length))],
      });
    }
  }
}


function buildStaticLayer() {
  staticCtx.clearRect(0, 0, W, H);
  staticCtx.fillStyle = "rgba(0,0,0,1)";
  staticCtx.fillRect(0, 0, W, H);

  staticCtx.strokeStyle = "rgba(0,255,255,0.12)";
  staticCtx.lineWidth = 1;
  for (const room of rooms) {
    staticCtx.strokeRect(room.x, room.y, room.w, room.h);
  }

  for (const wire of wires) {
    staticCtx.strokeStyle = "rgba(0,255,255,0.18)";
    staticCtx.lineWidth = 7;
    staticCtx.beginPath();
    staticCtx.moveTo(wire.ax, wire.ay);
    staticCtx.lineTo(wire.bx, wire.by);
    staticCtx.stroke();

    staticCtx.strokeStyle = "rgba(0,255,255,0.62)";
    staticCtx.lineWidth = 2;
    staticCtx.beginPath();
    staticCtx.moveTo(wire.ax, wire.ay);
    staticCtx.lineTo(wire.bx, wire.by);
    staticCtx.stroke();
  }
}

function resetPlayerPosition() {
  const hub = rooms[Math.floor(rooms.length / 2)] || { x: W * 0.5, y: H * 0.5, w: 0, h: 0 };
  player.x = hub.x + hub.w * 0.5;
  player.y = hub.y + hub.h * 0.5;
  player.vx = 0;
  player.vy = 0;
  player.sync = cfg.sync.start;
  if (meta.protocol === "rift") player.sync = clamp(player.sync + 12, 0, 100);
  player.onWire = false;
  player.wire = null;
  player.possessing = false;
  player.skillCd.overload = 0;
  player.skillCd.short = 0;
  player.skillCd.mirror = 0;
  mirrorEchoes.length = 0;
  trails.length = 0;
  particles.length = 0;
  trailPool.length = 0;
  particlePool.length = 0;
}

function buildLevel(seed) {
  levelSeed = seed;
  buildRooms(seed);
  buildWiresFromRooms();
  buildStaticLayer();
  createEnemiesFromRooms();
  resetPlayerPosition();
}

function beginDash() {
  regression.dashAttempts += 1;
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
  regression.dashSuccesses += 1;
  if (regression.lastDashKeydown > 0) {
    const lat = performance.now() - regression.lastDashKeydown;
    regression.dashLatencySamples += 1;
    regression.dashLatencyMsAvg += (lat - regression.dashLatencyMsAvg) / regression.dashLatencySamples;
  }
  sfxDash();
}


function emitTrail() {
  allocTrail(player.x, player.y, Math.hypot(player.vx, player.vy));
}

function emitPossessionParticles(fromX, fromY, toX, toY) {
  for (let i = 0; i < 80; i += 1) {
    const t = Math.random();
    const life = rand(0.16, 0.52);
    allocParticle(
      fromX + (toX - fromX) * t + rand(-22, 22),
      fromY + (toY - fromY) * t + rand(-22, 22),
      rand(-160, 160),
      rand(-160, 160),
      life,
      Math.random() > 0.72 ? cfg.colors.red : cfg.colors.cyan,
    );
  }
}

function applyPossessBuff(trait) {
  player.possessBuff = trait;
  player.possessBuffT = 8.5;
}

function possessTo(enemy) {
  player.possessing = true;
  player.possessT = 0;
  player.fromX = player.x;
  player.fromY = player.y;
  player.toX = enemy.x;
  player.toY = enemy.y;
  emitPossessionParticles(player.x, player.y, enemy.x, enemy.y);
  applyPossessBuff(enemy.trait || "swift");
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
  let tx = player.x;
  let ty = player.y;
  if (mirrorEchoes.length > 0) {
    const e = mirrorEchoes[0];
    tx = e.x;
    ty = e.y;
  }
  const dx = tx - enemy.x;
  const dy = ty - enemy.y;
  const d = Math.hypot(dx, dy) || 1;

  if (d < cfg.enemy.evadeRadius || player.onWire) enemy.state = "evade";
  else if (d < cfg.enemy.chaseRadius) enemy.state = "chase";
  else enemy.state = "patrol";

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
  player.skillCd.overload = Math.max(0, player.skillCd.overload - dt);
  player.skillCd.short = Math.max(0, player.skillCd.short - dt);
  player.skillCd.mirror = Math.max(0, player.skillCd.mirror - dt);
  feedback.hitFlash = Math.max(0, feedback.hitFlash - dt * 4.2);
  if (player.dashCd <= 0) player.canDash = true;

  if (player.possessBuffT > 0) player.possessBuffT -= dt;
  if (player.possessBuffT <= 0) player.possessBuff = null;

  const drainMul = (player.possessBuff === "tank" ? 0.65 : 1) * protocolDrainMul();
  player.sync = clamp(player.sync - (player.onWire ? cfg.sync.dashDrain : cfg.sync.passiveDrain) * drainMul * dt, 0, 100);
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
      const buffSpeed = player.possessBuff === "swift" ? 90 : 0;
      const speed = player.speed + buffSpeed + (100 - player.sync) * 1.15;
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

  const buffDamage = player.possessBuff === "volatile" ? 0.6 : 0;
  const damageMul = (critical ? 2 : 1) + buffDamage + protocolDamageBonus();
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
      meta.shards += 1;
      updateMetaUnlocks();
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
    if (trails[i].life <= 0) freeTrail(i);
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
    if (p.life <= 0) freeParticle(i);
  }

  for (let i = mirrorEchoes.length - 1; i >= 0; i -= 1) {
    mirrorEchoes[i].life -= dt;
    if (mirrorEchoes[i].life <= 0) mirrorEchoes.splice(i, 1);
  }

  if (Math.hypot(player.vx, player.vy) > 240 && (cfg.perf.tier === "high" || Math.random() > 0.6)) emitTrail();

  const buffText = player.possessBuff ? ` | BUFF ${player.possessBuff.toUpperCase()} ${player.possessBuffT.toFixed(1)}s` : "";
  const skillText = ` | SKL O:${player.skillCd.overload.toFixed(1)} S:${player.skillCd.short.toFixed(1)} M:${player.skillCd.mirror.toFixed(1)}`;
  const metaText = ` | META ${meta.protocol.toUpperCase()} [${meta.shards} shards]`;
  const perfText = ` | PERF ${cfg.perf.tier.toUpperCase()}`;
  const dashRate = regression.dashAttempts > 0 ? (regression.dashSuccesses / regression.dashAttempts) * 100 : 0;
  const regText = ` | REG f:${regression.frameAvgMs.toFixed(1)}ms d:${dashRate.toFixed(0)}% i:${regression.dashLatencyMsAvg.toFixed(1)}ms`;
  syncLabel.textContent = `SYNC: ${Math.round(player.sync)}% | DMG x${damageMul.toFixed(1)} | SEED ${levelSeed}${buffText}${skillText}${metaText}${perfText}${regText}${critical ? " // CRITICAL" : ""}`;
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
  const traitColor = enemy.trait === "swift" ? "#4dff88" : enemy.trait === "tank" ? "#8d7dff" : "#ff6a00";
  ctx.fillStyle = stateColor;
  ctx.shadowColor = stateColor;
  ctx.shadowBlur = 16;
  ctx.fillRect(enemy.x - enemy.r, enemy.y - enemy.r, enemy.r * 2, enemy.r * 2);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = traitColor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(enemy.x - enemy.r - 1, enemy.y - enemy.r - 1, enemy.r * 2 + 2, enemy.r * 2 + 2);
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

  ctx.drawImage(staticLayer, 0, 0);

  const near = nearestWire(player.x, player.y);
  const highlighted = near && near.p.d2 < cfg.player.attachRadius ** 2 ? near.wire : null;
  if (highlighted) drawWire(highlighted, true);

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

  for (const echo of mirrorEchoes) {
    const k = echo.life / echo.max;
    ctx.globalAlpha = 0.2 * k;
    ctx.fillStyle = "#9b7bff";
    ctx.fillRect(echo.x - player.size / 2, echo.y - player.size / 2, player.size, player.size);
    ctx.globalAlpha = 1;
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

  const frameMs = dt * 1000;
  regression.frameSamples += 1;
  regression.frameAvgMs += (frameMs - regression.frameAvgMs) / regression.frameSamples;

  update(dt);
  render();
  requestAnimationFrame(frame);
}

window.addEventListener("keydown", (e) => {
  ensureAudioContext();
  if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();

  if (e.key.toLowerCase() === "r") {
    buildLevel(levelSeed + 1);
    return;
  }

  if (e.key.toLowerCase() === "q") {
    nextProtocol();
    return;
  }

  if (e.key.toLowerCase() === "p") {
    cfg.perf.tier = cfg.perf.tier === "high" ? "low" : "high";
    return;
  }

  if (e.code === "Space") {
    e.preventDefault();
    regression.lastDashKeydown = performance.now();
    beginDash();
    return;
  }

  if (e.key === "1") {
    useOverload();
    return;
  }
  if (e.key === "2") {
    useShortCircuit();
    return;
  }
  if (e.key === "3") {
    useMirror();
    return;
  }

  keys.add(e.key.toLowerCase());
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});

buildLevel(levelSeed);
requestAnimationFrame(frame);
