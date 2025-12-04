// lan_fps_3d.js – jednoduchá 3D LAN FPS s Babylon.js
// Spustenie:
//   npm init -y
//   npm install ws babylonjs
//   node lan_fps_3d.js
//
// Hra:  http://localhost:3000
// LAN:  http://IP_TVOJHO_MACU:3000

const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// ================== HTML / CLIENT ==================
const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>LAN FPS 3D</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: #000;
      color: #fff;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
    }
    #hud {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.6);
      padding: 4px 10px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      gap: 12px;
      align-items: center;
      z-index: 10;
    }
    #crosshair {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 20px;
      color: #ffffffaa;
      pointer-events: none;
      user-select: none;
      z-index: 9;
    }
    #log {
      position: fixed;
      bottom: 8px;
      left: 8px;
      background: rgba(0,0,0,0.6);
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      max-width: 320px;
      white-space: pre-line;
      z-index: 10;
    }
    #hpbar {
      position: fixed;
      bottom: 8px;
      right: 8px;
      background: rgba(0,0,0,0.6);
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      width: 160px;
      z-index: 10;
    }
    #hpbar-inner {
      height: 10px;
      background: #440000;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 2px;
    }
    #hpbar-fill {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #ff3333, #ffaa33);
    }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="hud">
    <div><strong>LAN FPS 3D</strong></div>
    <div>WASD = pohyb · Space = skok · myš = otočka · ľavý klik = streľba</div>
  </div>
  <div id="crosshair">+</div>
  <div id="log">Click na plochu pre ovládanie myšou...</div>
  <div id="hpbar">
    HP
    <div id="hpbar-inner">
      <div id="hpbar-fill"></div>
    </div>
  </div>
  <canvas id="renderCanvas"></canvas>

  <script src="/babylon.js"></script>
  <script>
    var logEl = document.getElementById("log");
    var hpFill = document.getElementById("hpbar-fill");
    function log(msg) { logEl.textContent = msg; }
    function setHP(hp) {
      hp = Math.max(0, Math.min(100, hp || 0));
      hpFill.style.width = hp + "%";
      hpFill.style.background = hp > 30
        ? "linear-gradient(90deg, #ff3333, #ffaa33)"
        : "linear-gradient(90deg, #ff0000, #aa0000)";
    }

    var canvas = document.getElementById("renderCanvas");
    var engine = new BABYLON.Engine(canvas, true);

    var scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.02, 0.03, 0.05, 1);

    // jemný fog
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.01;
    scene.fogColor = new BABYLON.Color3(0.02, 0.03, 0.05);

    // svetlá
    var hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.7;
    var dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.5, -1, 0.3), scene);
    dir.position = new BABYLON.Vector3(20, 40, -20);
    dir.intensity = 0.8;

    var groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.15);
    groundMat.specularColor = BABYLON.Color3.Black();
    var ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 80, height: 80}, scene);
    ground.material = groundMat;
    ground.checkCollisions = true;

    var shadowGen = new BABYLON.ShadowGenerator(2048, dir);
    shadowGen.useExponentialShadowMap = true;

    function createBuilding(x, z, w, d, h, color) {
      var box = BABYLON.MeshBuilder.CreateBox("b", {width: w, depth: d, height: h}, scene);
      box.position = new BABYLON.Vector3(x, h/2, z);
      var m = new BABYLON.StandardMaterial("m", scene);
      m.diffuseColor = color;
      m.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      box.material = m;
      box.checkCollisions = true;
      shadowGen.addShadowCaster(box);
    }

    createBuilding(-10, 0, 10, 10, 6, new BABYLON.Color3(0.3, 0.4, 0.8));
    createBuilding(10, 5, 8, 12, 7, new BABYLON.Color3(0.8, 0.5, 0.2));
    createBuilding(0, -12, 14, 6, 5, new BABYLON.Color3(0.4, 0.8, 0.6));
    createBuilding(15, -10, 6, 6, 9, new BABYLON.Color3(0.7, 0.2, 0.3));
    createBuilding(-18, 10, 6, 8, 5, new BABYLON.Color3(0.5, 0.5, 0.9));

    for (var i = -20; i <= 20; i += 4) {
      createBuilding(i, -20, 4, 1, 3, new BABYLON.Color3(0.3, 0.3, 0.3));
      createBuilding(i, 20, 4, 1, 3, new BABYLON.Color3(0.3, 0.3, 0.3));
      createBuilding(-20, i, 1, 4, 3, new BABYLON.Color3(0.3, 0.3, 0.3));
      createBuilding(20, i, 1, 4, 3, new BABYLON.Color3(0.3, 0.3, 0.3));
    }

    function createTree(x, z) {
      var trunk = BABYLON.MeshBuilder.CreateCylinder("trunk", {height: 3, diameter: 0.6}, scene);
      trunk.position = new BABYLON.Vector3(x, 1.5, z);
      var trunkMat = new BABYLON.StandardMaterial("trunkMat", scene);
      trunkMat.diffuseColor = new BABYLON.Color3(0.35, 0.2, 0.1);
      trunk.material = trunkMat;
      trunk.checkCollisions = true;
      shadowGen.addShadowCaster(trunk);

      var crown = BABYLON.MeshBuilder.CreateSphere("crown", {diameter: 3}, scene);
      crown.position = new BABYLON.Vector3(x, 3.5, z);
      var crownMat = new BABYLON.StandardMaterial("crownMat", scene);
      crownMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1);
      crown.material = crownMat;
      crown.checkCollisions = false;
      shadowGen.addShadowCaster(crown);
    }

    createTree(-5, -5);
    createTree(8, -6);
    createTree(-8, 7);
    createTree(5, 9);

    // ====== KAMERA / HRÁČ ======
    var camera = new BABYLON.UniversalCamera("cam", new BABYLON.Vector3(0, 2, 10), scene);
    camera.attachControl(canvas, true);
    camera.speed = 0.5;
    camera.angularSensibility = 3000;
    camera.applyGravity = true;
    camera.checkCollisions = true;
    camera.ellipsoid = new BABYLON.Vector3(1, 1, 1);

    scene.gravity = new BABYLON.Vector3(0, -0.5, 0);
    scene.collisionsEnabled = true;
    ground.checkCollisions = true;

    // pointer lock
    canvas.addEventListener("click", function() {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener("pointerlockchange", function() {
      if (document.pointerLockElement === canvas) {
        log("Mouse look zapnutý (Esc = vypnúť)");
      } else {
        log("Click na plochu pre ovládanie myšou...");
      }
    });

    var keys = {};
    window.addEventListener("keydown", function(e) {
      keys[e.code] = true;
      if (e.code === "Space") {
        if (Math.abs(camera.position.y - 2) < 0.1) {
          camera.cameraDirection.y = 0.35;
        }
      }
    });
    window.addEventListener("keyup", function(e) {
      keys[e.code] = false;
    });

    // jednoduchý muzzle flash – gulička pred kamerou
    var flash = BABYLON.MeshBuilder.CreateSphere("flash", {diameter: 0.3}, scene);
    var flashMat = new BABYLON.StandardMaterial("flashMat", scene);
    flashMat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.5);
    flash.material = flashMat;
    flash.parent = camera;
    flash.position = new BABYLON.Vector3(0, -0.1, 1);
    flash.isVisible = false;

    // ====== MULTIPLAYER ======
    var socket = null;
    var localPlayerId = null;
    var localHP = 100;
    setHP(localHP);

    var otherPlayers = {}; // id -> { mesh, hp }

    function createRemotePlayerMesh() {
      var body = BABYLON.MeshBuilder.CreateCapsule("playerBody", {height: 2, radius: 0.4}, scene);
      var mat = new BABYLON.StandardMaterial("playerMat", scene);
      mat.diffuseColor = new BABYLON.Color3(1, 0.3, 0.3);
      mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      body.material = mat;
      body.checkCollisions = false;
      shadowGen.addShadowCaster(body);
      return body;
    }

    function connectWS() {
      var protocol = (location.protocol === "https:") ? "wss:" : "ws:";
      var wsUrl = protocol + "//" + location.host;
      socket = new WebSocket(wsUrl);

      socket.addEventListener("open", function() {
        log("Pripojený k serveru, click na plochu...");
      });

      socket.addEventListener("message", function(event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch(e) { return; }

        if (msg.type === "hello") {
          localPlayerId = msg.id;
        } else if (msg.type === "state") {
          var players = msg.players || {};
          var seen = {};
          for (var id in players) {
            if (!players.hasOwnProperty(id)) continue;
            var p = players[id];
            if (String(id) === String(localPlayerId)) {
              camera.position.set(p.x, p.y, p.z);
              camera.rotation.y = p.rotY;
              localHP = p.hp;
              setHP(localHP);
            } else {
              if (!otherPlayers[id]) {
                otherPlayers[id] = {
                  mesh: createRemotePlayerMesh(),
                  hp: p.hp
                };
              }
              otherPlayers[id].mesh.position.set(p.x, p.y - 1, p.z);
              otherPlayers[id].mesh.rotation.y = p.rotY;
              otherPlayers[id].hp = p.hp;
              seen[id] = true;
            }
          }
          // odstránenie odpojených
          for (var oid in otherPlayers) {
            if (!seen[oid]) {
              otherPlayers[oid].mesh.dispose();
              delete otherPlayers[oid];
            }
          }
        } else if (msg.type === "hitInfo") {
          if (localPlayerId != null && msg.victimId === localPlayerId) {
            localHP = msg.hp;
            setHP(localHP);
            if (msg.dead) {
              log("Zostrelili ťa, respawn... HP: " + localHP);
            }
          }
        }
      });

      socket.addEventListener("close", function() {
        log("Disconnected, reconnect...");
        setTimeout(connectWS, 1000);
      });
    }
    connectWS();

    function sendState() {
      if (!socket || socket.readyState !== WebSocket.OPEN || localPlayerId == null) return;
      var msg = {
        type: "state",
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        rotY: camera.rotation.y
      };
      socket.send(JSON.stringify(msg));
    }

    var lastShot = 0;
    function shoot() {
      var now = performance.now();
      if (now - lastShot < 150) return;
      lastShot = now;

      if (!socket || socket.readyState !== WebSocket.OPEN || localPlayerId == null) return;

      flash.isVisible = true;
      setTimeout(function(){ flash.isVisible = false; }, 80);

      var ray = camera.getForwardRay(50);
      var msg = {
        type: "shot",
        origin: {
          x: ray.origin.x,
          y: ray.origin.y,
          z: ray.origin.z
        },
        direction: {
          x: ray.direction.x,
          y: ray.direction.y,
          z: ray.direction.z
        }
      };
      socket.send(JSON.stringify(msg));
    }

    window.addEventListener("mousedown", function(e) {
      if (e.button === 0 && document.pointerLockElement === canvas) {
        shoot();
      }
    });

    scene.onBeforeRenderObservable.add(function() {
      sendState();
    });

    engine.runRenderLoop(function() {
      scene.render();
    });

    window.addEventListener("resize", function() {
      engine.resize();
    });
  </script>
</body>
</html>`;

// ================== SERVER / STATIC ==================
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  } else if (req.url === "/babylon.js") {
    const filePath = path.join(__dirname, "node_modules", "babylonjs", "babylon.js");
    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (err) {
        res.writeHead(500);
        res.end("babylon.js not found, skontroluj 'npm install babylonjs'");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/javascript" });
      fs.createReadStream(filePath).pipe(res);
    });
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ================== WEBSOCKET / LOGIKA ==================
const wss = new WebSocket.Server({ server });

let nextId = 1;
// ws -> { id, state: { x,y,z, rotY, hp } }
const clients = new Map();

const SPAWNS = [
  { x: 0, y: 2, z: 10 },
  { x: -10, y: 2, z: 0 },
  { x: 10, y: 2, z: 5 },
  { x: 0, y: 2, z: -10 },
  { x: -8, y: 2, z: -8 },
];

function randomSpawn() {
  return SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
}

function broadcastState() {
  const players = {};
  for (const [, c] of clients) {
    if (c.state) {
      players[c.id] = {
        x: c.state.x,
        y: c.state.y,
        z: c.state.z,
        rotY: c.state.rotY,
        hp: c.state.hp
      };
    }
  }
  const msg = JSON.stringify({ type: "state", players });
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

function handleShot(shooterWs, data) {
  const shooter = clients.get(shooterWs);
  if (!shooter || !shooter.state) return;

  const origin = data.origin;
  const dir = data.direction;
  if (!origin || !dir) return;

  const maxRange = 50;
  const radius = 1.0;

  let bestVictim = null;
  let bestT = Infinity;

  for (const [ws, c] of clients) {
    if (ws === shooterWs) continue;
    if (!c.state) continue;

    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;

    const vx = c.state.x - ox;
    const vy = c.state.y - oy;
    const vz = c.state.z - oz;

    const t = vx * dx + vy * dy + vz * dz;
    if (t <= 0 || t > maxRange) continue;

    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;

    const ex = c.state.x - px;
    const ey = (c.state.y - 1) - py;
    const ez = c.state.z - pz;
    const d2 = ex*ex + ey*ey + ez*ez;

    if (d2 <= radius * radius && t < bestT) {
      bestT = t;
      bestVictim = c;
    }
  }

  if (bestVictim) {
    bestVictim.state.hp -= 25;
    let dead = false;
    if (bestVictim.state.hp <= 0) {
      const spawn = randomSpawn();
      bestVictim.state.x = spawn.x;
      bestVictim.state.y = spawn.y;
      bestVictim.state.z = spawn.z;
      bestVictim.state.hp = 100;
      dead = true;
    }

    const victimWs = [...clients.entries()].find(([ws, c]) => c === bestVictim)?.[0];
    if (victimWs && victimWs.readyState === WebSocket.OPEN) {
      victimWs.send(JSON.stringify({
        type: "hitInfo",
        victimId: bestVictim.id,
        hp: bestVictim.state.hp,
        dead
      }));
    }
  }
}

wss.on("connection", (ws) => {
  const id = nextId++;
  const spawn = randomSpawn();
  clients.set(ws, {
    id,
    state: {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      rotY: 0,
      hp: 100
    }
  });
  console.log("Client connected:", id);

  ws.send(JSON.stringify({ type: "hello", id }));

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch(e) { return; }
    const c = clients.get(ws);
    if (!c) return;

    if (msg.type === "state") {
      c.state.x = msg.x;
      c.state.y = msg.y;
      c.state.z = msg.z;
      c.state.rotY = msg.rotY;
    } else if (msg.type === "shot") {
      handleShot(ws, msg);
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected:", clients.get(ws)?.id);
    clients.delete(ws);
  });
});

setInterval(broadcastState, 50);

server.listen(PORT, () => {
  console.log("LAN FPS 3D beží na http://localhost:" + PORT);
});
