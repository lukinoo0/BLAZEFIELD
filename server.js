const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Configuration
const PORT = process.env.PORT || 3000;
const BROADCAST_RATE_MS = 50; // 20 fps state updates
const BOT_THINK_MS = 200;
const MAP_SCALE = 1.8;
const BOT_COUNT = 14;
const WORLD_HALF_SIZE = 120 * MAP_SCALE; // clamp player positions
const MAX_SHOT_RANGE = 150;
const HIT_RADIUS = 1.1;
const DAMAGE = 15;
const BOT_DAMAGE = 10;
const BOT_SPEED = 4.2;
const BOT_TURN_RATE = 2.5; // radians per second
const KILL_EVENT = "killEvent";
const DEFAULT_PRIMARY = "AssaultRifle_1";
const DEFAULT_SECONDARY = "Pistol_1";

// Each room represents one map instance with its own players/bots.
const rooms = new Map(); // roomId/mapId -> { id, mapId, players: Map, bots: Map, config }
let nextId = 1;
const botNames = [
  "Alfred",
  "Viktor",
  "Lukas",
  "Adrian",
  "Simon",
  "David",
  "Martin",
  "Tobias",
  "Marek",
  "Samuel",
  "Oliver",
  "Daniel",
  "Jakub",
  "Peter",
  "Filip",
];

// Basic map layout used on the client; boxes reused for bot spawning and line-of-sight.
function scaleBox(box) {
  return {
    x: box.x * MAP_SCALE,
    z: box.z * MAP_SCALE,
    w: box.w * MAP_SCALE,
    d: box.d * MAP_SCALE,
    h: box.h * (1 + (MAP_SCALE - 1) * 0.35),
  };
}

const buildingBoxes = [
  { x: -40, z: -10, w: 18, d: 16, h: 12 },
  { x: 30, z: -12, w: 20, d: 16, h: 12 },
  { x: -10, z: 30, w: 16, d: 20, h: 10 },
  { x: 32, z: 30, w: 14, d: 14, h: 12 },
  { x: -55, z: 18, w: 16, d: 16, h: 10 },
  { x: 14, z: -50, w: 18, d: 16, h: 10 },
  { x: 0, z: 0, w: 12, d: 10, h: 9 },
  { x: -34, z: -44, w: 18, d: 16, h: 10 },
  { x: 52, z: 4, w: 14, d: 12, h: 10 },
  { x: 0, z: 60, w: 18, d: 14, h: 9 },
  { x: -60, z: -40, w: 16, d: 16, h: 10 },
].map(scaleBox);

// Spawn points hugging building edges/entrances so bots don't cluster in the open.
const spawnPoints = [
  // Open street/courtyard edges
  { x: -42, z: -16 },
  { x: -36, z: 10 },
  { x: 26, z: -28 },
  { x: 44, z: -12 },
  { x: -10, z: 22 },
  { x: -10, z: 42 },
  { x: 30, z: 14 },
  { x: 40, z: 36 },
  { x: -56, z: 14 },
  { x: -50, z: 32 },
  { x: 8, z: -34 },
  { x: 6, z: -54 },
  { x: -44, z: -30 },
  { x: 52, z: 8 },
  { x: 12, z: 8 },
  { x: -6, z: -10 },
  { x: 0, z: 64 },
  { x: -62, z: -26 },
  { x: 22, z: 50 },
  { x: -30, z: 52 },
].map((p) => ({ x: p.x * MAP_SCALE, z: p.z * MAP_SCALE }));

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/profile", (req, res) => {
  const pid = req.query.id;
  if (pid && profiles[pid]) {
    res.json({ profile: profiles[pid] });
  } else {
    res.json({ profile: null });
  }
});

app.post("/profile/reset", express.json(), (req, res) => {
  const pid = req.body?.id;
  if (pid && profiles[pid]) {
    profiles[pid].totalKills = 0;
    profiles[pid].totalDeaths = 0;
    profiles[pid].matches = 0;
    saveProfiles();
    res.json({ ok: true, profile: profiles[pid] });
  } else {
    res.status(404).json({ ok: false });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Simple JSON-backed profile storage
const PROFILE_PATH = path.join(__dirname, "profiles.json");
let profiles = {};
function loadProfiles() {
  try {
    profiles = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
  } catch {
    profiles = {};
  }
}
function saveProfiles() {
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profiles, null, 2));
  } catch (err) {
    console.error("Failed to save profiles", err);
  }
}
loadProfiles();

function getOrCreateProfile(id, nickname, playerClass) {
  if (id && profiles[id]) {
    const p = profiles[id];
    p.nickname = nickname || p.nickname;
    p.class = playerClass || p.class;
    saveProfiles();
    return p;
  }
  const newId = id || randomUUID();
  const profile = {
    id: newId,
    nickname: nickname || `Player_${newId.slice(0, 5)}`,
    class: playerClass || "assault",
    totalKills: 0,
    totalDeaths: 0,
    matches: 0,
  };
  profiles[newId] = profile;
  saveProfiles();
  return profile;
}

const obstacleBoxes = buildingBoxes.map((b) => ({
  min: { x: b.x - b.w / 2, y: 0, z: b.z - b.d / 2 },
  max: { x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 },
}));
const obstacleExtra = [
  // cover props approx positions/sizes (crates/pillars) for bot collision/LOS
  { min: { x: -8, y: 0, z: 2 }, max: { x: -4, y: 2, z: 6 } },
  { min: { x: 0, y: 0, z: -10 }, max: { x: 4, y: 2, z: -6 } },
  { min: { x: 10, y: 0, z: 4 }, max: { x: 14, y: 3, z: 8 } },
  { min: { x: -14, y: 0, z: -2 }, max: { x: -10, y: 2.5, z: 2 } },
  { min: { x: 6, y: 0, z: 10 }, max: { x: 8, y: 4, z: 12 } },
  { min: { x: -16, y: 0, z: 4 }, max: { x: -14, y: 4, z: 6 } },
  { min: { x: -14, y: 0, z: -10 }, max: { x: -10, y: 2.5, z: -6 } },
  { min: { x: 18, y: 0, z: -14 }, max: { x: 22, y: 3, z: -10 } },
  { min: { x: 6, y: 0, z: 14 }, max: { x: 10, y: 3, z: 18 } },
  { min: { x: -8, y: 0, z: 24 }, max: { x: 2, y: 3.5, z: 30 } },
  { min: { x: 16, y: 0, z: -26 }, max: { x: 28, y: 4, z: -18 } },
  { min: { x: -28, y: 0, z: -28 }, max: { x: -20, y: 3, z: -20 } },
  { min: { x: -12, y: 0, z: 32 }, max: { x: 4, y: 4, z: 38 } },
  { min: { x: 20, y: 0, z: 52 }, max: { x: 34, y: 4, z: 60 } },
  { min: { x: 46, y: 0, z: -8 }, max: { x: 58, y: 6, z: 10 } },
  { min: { x: -14, y: 0, z: 20 }, max: { x: -2, y: 4, z: 30 } },
  { min: { x: 16, y: 0, z: -26 }, max: { x: 28, y: 5, z: -14 } },
  { min: { x: -30, y: 0, z: -30 }, max: { x: -18, y: 4, z: -18 } },
  { min: { x: 6, y: 0, z: 44 }, max: { x: 16, y: 4, z: 56 } },
].map((b) => ({
  min: { x: b.min.x * MAP_SCALE, y: b.min.y, z: b.min.z * MAP_SCALE },
  max: { x: b.max.x * MAP_SCALE, y: b.max.y, z: b.max.z * MAP_SCALE },
}));
const defaultObstacles = obstacleBoxes.concat(obstacleExtra);
const DEFAULT_MAP_ID = "dust";
const MAP_CONFIGS = {
  dust: {
    id: "dust",
    mapId: "dust",
    spawnPoints,
    obstacles: defaultObstacles,
    worldHalfSize: WORLD_HALF_SIZE,
  },
  mirage: {
    id: "mirage",
    mapId: "mirage",
    spawnPoints,
    obstacles: defaultObstacles,
    worldHalfSize: WORLD_HALF_SIZE,
  },
  city: {
    id: "city",
    mapId: "city",
    spawnPoints,
    obstacles: defaultObstacles,
    worldHalfSize: WORLD_HALF_SIZE,
  },
};

function getMapConfig(mapId) {
  return MAP_CONFIGS[mapId] || MAP_CONFIGS[DEFAULT_MAP_ID];
}

function getOrCreateRoom(mapId) {
  const key = mapId && MAP_CONFIGS[mapId] ? mapId : DEFAULT_MAP_ID;
  let room = rooms.get(key);
  if (!room) {
    room = {
      id: key,
      mapId: key,
      players: new Map(),
      bots: new Map(),
      config: getMapConfig(key),
    };
    seedBots(room);
    rooms.set(key, room);
  }
  return room;
}

const WEAPON_STATS = {
  AssaultRifle_1: { damage: 28, fireDelay: 110, range: 120 },
  AssaultRifle_2: { damage: 30, fireDelay: 130, range: 125 },
  AssaultRifle_3: { damage: 38, fireDelay: 190, range: 135 },
  Bullpup_1: { damage: 30, fireDelay: 120, range: 140 },
  Bullpup_2: { damage: 32, fireDelay: 135, range: 145 },
  Pistol_1: { damage: 14, fireDelay: 200, range: 70 },
  Pistol_2: { damage: 16, fireDelay: 190, range: 72 },
  Pistol_3: { damage: 18, fireDelay: 210, range: 75 },
  Pistol_4: { damage: 20, fireDelay: 230, range: 78 },
  Pistol_5: { damage: 22, fireDelay: 240, range: 80 },
  Pistol_6: { damage: 24, fireDelay: 260, range: 82 },
  Revolver_1: { damage: 60, fireDelay: 550, range: 90 },
  Revolver_2: { damage: 70, fireDelay: 620, range: 95 },
  Revolver_3: { damage: 80, fireDelay: 700, range: 100 },
};
const BOT_WEAPON_KEYS = Object.keys(WEAPON_STATS);

// Utility helpers
function randomSpawn(room) {
  const cfg = room?.config || getMapConfig(DEFAULT_MAP_ID);
  const points = cfg.spawnPoints || spawnPoints;
  const existing = [...(room?.players?.values() || []), ...(room?.bots?.values() || [])];
  // pick a spawn not overlapping others
  for (let tries = 0; tries < 20; tries++) {
    const base = points[Math.floor(Math.random() * points.length)];
    const candidate = { x: base.x + (Math.random() - 0.5) * 2, y: 1.6, z: base.z + (Math.random() - 0.5) * 2 };
    let ok = true;
    for (const p of existing) {
      const dx = p.position.x - candidate.x;
      const dz = p.position.z - candidate.z;
      if (dx * dx + dz * dz < 49) {
        ok = false;
        break;
      }
    }
    if (ok) return candidate;
  }
  // fallback
  const base = points[0];
  return { x: base.x, y: 1.6, z: base.z };
}

function clampPosition(pos, room) {
  const half = room?.config?.worldHalfSize ?? WORLD_HALF_SIZE;
  pos.x = Math.max(-half, Math.min(half, pos.x));
  pos.y = Math.max(0.5, Math.min(8, pos.y)); // keep everyone above ground
  pos.z = Math.max(-half, Math.min(half, pos.z));
}

function distance2(a, b) {
  const dx = a.x - b.x;
  const dy = (a.y || 0) - (b.y || 0);
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// Basic segment vs AABB test to approximate line-of-sight against buildings so bots don't shoot through walls.
function hasLineOfSight(origin, target, room) {
  const dir = {
    x: target.x - origin.x,
    y: (target.y || 1.6) - origin.y,
    z: target.z - origin.z,
  };
  const dist = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  dir.x /= dist;
  dir.y /= dist;
  dir.z /= dist;

  const obs = room?.config?.obstacles || defaultObstacles;
  for (const box of obs) {
    let tmin = 0;
    let tmax = dist;
    const axes = ["x", "y", "z"];
    for (const axis of axes) {
      const o = origin[axis];
      const d = dir[axis];
      const min = box.min[axis];
      const max = box.max[axis];
      if (Math.abs(d) < 1e-6) {
        if (o < min || o > max) {
          tmin = Infinity;
          break;
        }
      } else {
        const t1 = (min - o) / d;
        const t2 = (max - o) / d;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        tmin = Math.max(tmin, tNear);
        tmax = Math.min(tmax, tFar);
        if (tmin > tmax) {
          tmin = Infinity;
          break;
        }
      }
    }
    if (tmin >= 0 && tmin <= dist) {
      return false;
    }
  }
  return true;
}

function collides(pos, room) {
  const obs = room?.config?.obstacles || defaultObstacles;
  for (const b of obs) {
    if (
      pos.x > b.min.x - HIT_RADIUS &&
      pos.x < b.max.x + HIT_RADIUS &&
      pos.z > b.min.z - HIT_RADIUS &&
      pos.z < b.max.z + HIT_RADIUS &&
      pos.y > b.min.y - 0.5 &&
      pos.y < (b.max.y || 4) + 1
    ) {
      return true;
    }
  }
  return false;
}

function rayPointDistance(origin, dir, point) {
  // dir is assumed normalized
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  const dx = dir.x;
  const dy = dir.y;
  const dz = dir.z;
  const px = point.x - ox;
  const py = point.y - oy;
  const pz = point.z - oz;
  const t = Math.max(0, Math.min(MAX_SHOT_RANGE, (px * dx + py * dy + pz * dz)));
  const cx = ox + dx * t;
  const cy = oy + dy * t;
  const cz = oz + dz * t;
  const distSq = (point.x - cx) ** 2 + (point.y - cy) ** 2 + (point.z - cz) ** 2;
  return { distance: Math.sqrt(distSq), t };
}

function applyDamage(target, shooter, room, dmg = DAMAGE) {
  target.hp -= dmg;
  let killed = false;
  let spawn = null;

  if (target.hp <= 0) {
    killed = true;
    target.hp = 100;
    spawn = randomSpawn(room);
    target.position = spawn;
    target.rotY = 0;
    target.deaths = (target.deaths || 0) + 1;
    if (shooter) shooter.kills = (shooter.kills || 0) + 1;
  }

  if (!target.isBot && target.ws && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(
      JSON.stringify({
        type: "hitInfo",
        hp: target.hp,
        killed,
        killer: shooter?.nickname || "Unknown",
        spawn,
      })
    );
  }

  if (killed && shooter) {
    broadcastKill(room, shooter.id, target.id);
  }

  // Send hit confirmation back to shooter for local feedback.
  if (shooter && !shooter.isBot && shooter.ws && shooter.ws.readyState === WebSocket.OPEN) {
    shooter.ws.send(JSON.stringify({ type: "hitConfirm", targetId: target.id }));
  }

  // Persist profile totals
  if (killed) {
    if (!target.isBot && target.profileId && profiles[target.profileId]) {
      profiles[target.profileId].totalDeaths += 1;
      saveProfiles();
      sendProfile(target);
    }
    if (shooter && !shooter.isBot && shooter.profileId && profiles[shooter.profileId]) {
      profiles[shooter.profileId].totalKills += 1;
      saveProfiles();
      sendProfile(shooter);
    }
  }
}

function raySphere(origin, dir, center, radius, maxRange = MAX_SHOT_RANGE) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxRange) return null;
  return t;
}

// Capsule centerline p1->p2 with radius r
function rayCapsule(origin, dir, p1, p2, r, maxRange = MAX_SHOT_RANGE) {
  // from https://iquilezles.org/articles/intersectors/ (ray vs capsule)
  const ba = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const oa = { x: origin.x - p1.x, y: origin.y - p1.y, z: origin.z - p1.z };
  const baba = ba.x * ba.x + ba.y * ba.y + ba.z * ba.z;
  const bard = ba.x * dir.x + ba.y * dir.y + ba.z * dir.z;
  const baoa = ba.x * oa.x + ba.y * oa.y + ba.z * oa.z;
  const rdoa = dir.x * oa.x + dir.y * oa.y + dir.z * oa.z;
  const oaoa = oa.x * oa.x + oa.y * oa.y + oa.z * oa.z;

  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    if (t > 0 && t < maxRange) {
      const y = baoa + t * bard;
      if (y > 0 && y < baba) return t;
      // ends
      const end1 = raySphere(origin, dir, p1, r, maxRange);
      const end2 = raySphere(origin, dir, p2, r, maxRange);
      const tEnd = [end1, end2].filter((v) => v !== null).sort((a, b) => a - b)[0];
      if (tEnd !== undefined) return tEnd;
    }
  }
  return null;
}

// Simple raycast hit test against all players/bots with head/body damage.
function handleShot(shooter, payload, room) {
  if (!room) return;
  const origin = payload.origin;
  const dir = payload.dir;
  if (!origin || !dir) return;

  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len;
  dir.y /= len;
  dir.z /= len;

  const maxRange = Math.max(1, Math.min(payload.range || MAX_SHOT_RANGE, MAX_SHOT_RANGE));
  broadcastShotEvent(room, shooter, origin, dir);

  let closestTarget = null;
  let closestT = Infinity;
  let headshot = false;
  const everyone = [...room.players.values(), ...room.bots.values()];

  for (const target of everyone) {
    if (target.id === shooter.id) continue;
    const headCenter = { x: target.position.x, y: target.position.y + 0.95, z: target.position.z };
    const bodyA = { x: target.position.x, y: target.position.y - 0.9, z: target.position.z };
    const bodyB = { x: target.position.x, y: target.position.y + 0.9, z: target.position.z };
    const th = raySphere(origin, dir, headCenter, 0.45, maxRange);
    const tb = rayCapsule(origin, dir, bodyA, bodyB, 0.7, maxRange);
    const tHit = th !== null && th < (tb ?? Infinity) ? { t: th, head: true } : tb !== null ? { t: tb, head: false } : null;
    if (tHit && tHit.t < closestT) {
      closestT = tHit.t;
      closestTarget = target;
      headshot = !!tHit.head;
    }
  }

  if (closestTarget) {
    const mult = headshot ? 2.5 : 1;
    applyDamage(closestTarget, shooter, room, (payload.damage || DAMAGE) * mult);
  }
}

function broadcastState(room) {
  const payload = {
    type: "state",
    mapId: room.mapId,
    players: [...room.players.values(), ...room.bots.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname || `Player${p.id}`,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      rotY: p.rotY || 0,
      hp: p.hp,
      isBot: !!p.isBot,
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      class: p.class,
      gamemode: p.gamemode || "ffa",
      weapon: p.weapon || null,
    })),
  };
  const data = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function broadcastShotEvent(room, shooter, origin, dir) {
  const data = JSON.stringify({
    type: "shotEvent",
    shooterId: shooter?.id ?? null,
    origin,
    dir,
    isBot: !!shooter?.isBot,
  });
  for (const player of room.players.values()) {
    if (shooter && player.id === shooter.id) continue;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function broadcastKill(room, killerId, victimId) {
  const data = JSON.stringify({ type: "killEvent", killerId, victimId });
  for (const player of room.players.values()) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  }
}

function sendProfile(player) {
  if (!player || player.isBot || !player.ws || player.ws.readyState !== WebSocket.OPEN) return;
  const profile = profiles[player.profileId];
  if (!profile) return;
  player.ws.send(JSON.stringify({ type: "profile", profile }));
}

function createBot(room, name) {
  const id = nextId++;
  const spawn = randomSpawn(room);
  const weapon = BOT_WEAPON_KEYS[Math.floor(Math.random() * BOT_WEAPON_KEYS.length)] || DEFAULT_PRIMARY;
  const stats = WEAPON_STATS[weapon] || {};
  room.bots.set(id, {
    id,
    nickname: name,
    position: spawn,
    rotY: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    class: "assault",
    gamemode: "ffa",
    isBot: true,
    weapon,
    roomId: room.id,
    ai: {
      heading: Math.random() * Math.PI * 2,
      target: null,
      shootCooldown: stats.fireDelay || 800,
    },
  });
}

function seedBots(room) {
  for (let i = 1; i <= BOT_COUNT; i++) {
    const name = botNames[Math.floor(Math.random() * botNames.length)];
    createBot(room, name);
  }
}

function nearestHuman(bot, room) {
  if (!room) return null;
  let best = null;
  let bestDistSq = Infinity;
  for (const p of room.players.values()) {
    const dx = p.position.x - bot.position.x;
    const dz = p.position.z - bot.position.z;
    const dy = p.position.y - bot.position.y;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      best = p;
      bestDistSq = distSq;
    }
  }
  return best;
}

// Lightweight bot AI: wander inside the map, face the nearest human, and occasionally shoot.
function updateBotsForRoom(room) {
  for (const bot of room.bots.values()) {
    if (!bot.weapon) {
      bot.weapon = BOT_WEAPON_KEYS[Math.floor(Math.random() * BOT_WEAPON_KEYS.length)] || DEFAULT_PRIMARY;
    }
    const ai = bot.ai;
    const dt = BOT_THINK_MS / 1000;
    const stats = WEAPON_STATS[bot.weapon] || { damage: BOT_DAMAGE, fireDelay: 800, range: MAX_SHOT_RANGE };

    if (!ai.target || distance2(bot.position, ai.target) < 4 || collides(ai.target, room)) {
      ai.target = randomSpawn(room);
    }

    const target = nearestHuman(bot, room);
    const desiredDir = ai.target
      ? Math.atan2(ai.target.x - bot.position.x, ai.target.z - bot.position.z)
      : ai.heading;

    const lerpAngle = (a, b, t) => {
      const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      return a + diff * t;
    };
    ai.heading = lerpAngle(ai.heading, desiredDir, Math.min(1, BOT_TURN_RATE * dt));
    bot.rotY = ai.heading;

    const nextPos = {
      x: bot.position.x + Math.sin(ai.heading) * BOT_SPEED * dt,
      y: bot.position.y,
      z: bot.position.z + Math.cos(ai.heading) * BOT_SPEED * dt,
    };
    clampPosition(nextPos, room);
    if (collides(nextPos, room)) {
      // pick new heading away from obstacle
      ai.heading += (Math.random() > 0.5 ? 1 : -1) * Math.PI * 0.5;
      ai.target = randomSpawn(room);
    } else {
      bot.position = nextPos;
    }

    if (target) {
      ai.shootCooldown -= BOT_THINK_MS;
      const dx = target.position.x - bot.position.x;
      const dz = target.position.z - bot.position.z;
      const dy = target.position.y - bot.position.y;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (ai.shootCooldown <= 0 && distSq < (stats.range || MAX_SHOT_RANGE) * (stats.range || MAX_SHOT_RANGE)) {
        const origin = { ...bot.position, y: 1.6 };
        const dir = {
          x: dx + (Math.random() - 0.5) * 0.8,
          y: dy + (Math.random() - 0.5) * 0.3,
          z: dz + (Math.random() - 0.5) * 0.8,
        };
        if (hasLineOfSight(origin, target.position, room)) {
          ai.shootCooldown = stats.fireDelay + Math.random() * 120;
          handleShot(bot, { origin, dir, damage: stats.damage || BOT_DAMAGE, range: stats.range }, room);
        } else {
          ai.shootCooldown = stats.fireDelay;
        }
      }
    }
  }
}

// WebSocket protocol:
//  - join: { nickname }
//  - state: { x, y, z, rotY }
//  - shot: { origin: {x,y,z}, dir: {x,y,z} }
wss.on("connection", (ws) => {
  const id = nextId++;
  const player = {
    id,
    ws,
    nickname: "",
    class: "assault",
    gamemode: "ffa",
    profileId: null,
    position: { x: 0, y: 1.6, z: 0 },
    rotY: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    isBot: false,
    lastUpdate: Date.now(),
    room: null,
    roomId: null,
    mapId: null,
    loadout: { primary: DEFAULT_PRIMARY, secondary: DEFAULT_SECONDARY, melee: "knife" },
    weapon: DEFAULT_PRIMARY,
  };

  ws.on("message", (data) => {
    let msg = null;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    if (msg.type === "join") {
      const profileId = msg.profileId || null;
      const profile = getOrCreateProfile(profileId, msg.nickname, msg.class);
      player.nickname = String(profile.nickname || `Player${id}`).slice(0, 24);
      player.class = profile.class || msg.class || "assault";
      player.gamemode = msg.gamemode || "ffa";
      player.profileId = profile.id;
      player.loadout = {
        primary: msg.primary || player.loadout?.primary || DEFAULT_PRIMARY,
        secondary: msg.secondary || player.loadout?.secondary || DEFAULT_SECONDARY,
        melee: "knife",
      };
      player.weapon = player.loadout.primary;
      const desiredMap = msg.map || msg.mapId || DEFAULT_MAP_ID;
      const room = getOrCreateRoom(desiredMap);
      if (player.room && player.room !== room) {
        player.room.players.delete(player.id);
      }
      player.room = room;
      player.roomId = room.id;
      player.mapId = room.mapId;
      player.position = randomSpawn(room);
      player.hp = 100;
      player.rotY = 0;
      player.kills = 0;
      player.deaths = 0;
      room.players.set(player.id, player);
      ws.send(
        JSON.stringify({
          type: "hello",
          id,
          spawn: player.position,
          hp: player.hp,
          mapId: room.mapId,
          weapon: player.weapon,
        })
      );
      sendProfile(player);
      return;
    }

    if (msg.type === "resetProfile" && player.profileId && profiles[player.profileId]) {
      profiles[player.profileId].totalKills = 0;
      profiles[player.profileId].totalDeaths = 0;
      profiles[player.profileId].matches = 0;
      saveProfiles();
      sendProfile(player);
      return;
    }

    if (msg.type === "state") {
      if (!player.room) return;
      const { x, y, z, rotY } = msg;
      if ([x, y, z, rotY].every((n) => typeof n === "number" && Number.isFinite(n))) {
        player.position = { x, y, z };
        clampPosition(player.position, player.room);
        player.rotY = rotY;
        player.lastUpdate = Date.now();
      }
      if (typeof msg.weapon === "string") {
        player.weapon = msg.weapon;
      }
      return;
    }

    if (msg.type === "shot") {
      if (!player.room) return;
      handleShot(player, msg, player.room);
    }
  });

  ws.on("close", () => {
    if (player.room) {
      player.room.players.delete(player.id);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size > 0) {
      broadcastState(room);
    }
  }
}, BROADCAST_RATE_MS);
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    updateBotsForRoom(room);
  }
}, BOT_THINK_MS);

server.listen(PORT, () => {
  console.log(`LAN FPS server listening on http://localhost:${PORT}`);
});
