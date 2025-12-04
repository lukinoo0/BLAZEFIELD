import * as THREE from "./lib/three.module.js";
import { PointerLockControls } from "./lib/PointerLockControls.js";
import { OBJLoader } from "./lib/OBJLoader.js";
import { MTLLoader } from "./lib/MTLLoader.js";
import { GLTFLoader } from "./lib/GLTFLoader.js";

const canvas = document.getElementById("scene");
const startScreen = document.getElementById("main-menu");
const startBtn = document.getElementById("play-btn");
const nicknameInput = document.getElementById("nickname");
const mapSelect = document.getElementById("map-select");
const hpFill = document.getElementById("hp-fill");
const hpValue = document.getElementById("hp-value");
const logBox = document.getElementById("log");
const damageOverlay = document.getElementById("damage-overlay");
const statusText = document.getElementById("status");
const killfeed = document.getElementById("killfeed");
const scoreboardEl = document.getElementById("scoreboard");
const scoreBody = document.querySelector("#score-table tbody");
const minimap = document.getElementById("minimap");
const minimapCtx = minimap.getContext("2d");
const statKills = document.getElementById("stat-kills");
const statDeaths = document.getElementById("stat-deaths");
const statAmmo = document.getElementById("stat-ammo");
const crosshair = document.getElementById("crosshair");
const pauseMenu = null;
let currentMapDef = null;

const settings = {
  sensitivity: parseFloat(localStorage.getItem("lanfps_sens")) || 1,
  volume: parseFloat(localStorage.getItem("lanfps_vol")) || 0.5,
  music: parseFloat(localStorage.getItem("lanfps_music")) || 0.3,
  graphics: localStorage.getItem("lanfps_gfx") || "high",
  blood: localStorage.getItem("lanfps_blood") || "on",
};
let selectedMap = mapSelect?.value || "dust";
const primarySelect = document.getElementById("primary-select");
const secondarySelect = document.getElementById("secondary-select");
let selectedPrimary = primarySelect?.value || "AssaultRifle_1";
let selectedSecondary = secondarySelect?.value || "Pistol_1";
const volumeSlider = document.getElementById("volume-slider");
const musicSlider = document.getElementById("music-slider");
const sounds = {
  shot: new Audio("/sounds/shot.wav"),
  hit: new Audio("/sounds/hit.wav"),
  ambient: new Audio("/sounds/ambient.wav"),
  reload: new Audio("/sounds/reload.wav"),
  empty: new Audio("/sounds/empty.wav"),
  damage: new Audio("/sounds/damage.wav"),
  assault: new Audio("/sounds/ar_shot.wav"),
  assaultReload: new Audio("/sounds/reload.wav"),
  bullpup: new Audio("/sounds/ar_shot.wav"),
  bullpupReload: new Audio("/sounds/reload.wav"),
  pistol: new Audio("/sounds/pistol_shot.wav"),
  pistolReload: new Audio("/sounds/reload.wav"),
  revolver: new Audio("/sounds/sniper_shot.wav"),
  revolverReload: new Audio("/sounds/reload.wav"),
};
const menuMusic = new Audio("/sounds/ambient.wav");
menuMusic.loop = true;
menuMusic.isMusic = true;
const profileTotalKills = null;
const profileTotalDeaths = null;
const profileTotalKD = null;
const statTotal = null;
const hudName = null;
const hudClass = null;
const hudMode = null;
const baseFov = 75;
const scopedFov = 45;
let scoped = false;
let paused = false;
const MAP_SCALE = 1.8;
const WORLD_HALF_SIZE = 120 * MAP_SCALE;
const GROUND_SIZE = WORLD_HALF_SIZE * 2 + 80;
let audioPrimed = false;

function primeAudio() {
  if (audioPrimed) return;
  audioPrimed = true;
  [...Object.values(sounds), menuMusic].forEach((s) => {
    if (!s) return;
    try {
      s.preload = "auto";
      s.volume = s.isMusic ? settings.music : settings.volume;
      s.muted = true;
      const reset = () => {
        s.pause();
        s.currentTime = 0;
        s.muted = false;
      };
      const p = s.play();
      if (p && p.then) {
        p.then(reset).catch(() => {
          s.muted = false;
        });
      } else {
        reset();
      }
    } catch {
      s.muted = false;
    }
  });
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1120);
scene.fog = new THREE.FogExp2(0x0d1324, 0.0065);

const camera = new THREE.PerspectiveCamera(baseFov, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 1.6, 8);

const controls = new PointerLockControls(camera, document.body);
controls.addEventListener("lock", () => playAmbient());
scene.add(controls.getObject());

const ambient = new THREE.HemisphereLight(0xc4dcff, 0x0a0e18, 0.82);
const dir = new THREE.DirectionalLight(0xfff3db, 0.82);
dir.position.set(30, 48, -14);
dir.castShadow = true;
dir.shadow.mapSize.width = 2048;
dir.shadow.mapSize.height = 2048;
dir.shadow.camera.top = 60;
dir.shadow.camera.bottom = -60;
dir.shadow.camera.left = -60;
dir.shadow.camera.right = 60;
scene.add(ambient, dir);

function addSky() {
  const skyGeo = new THREE.SphereGeometry(800, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x7fb7ff) },
      bottomColor: { value: new THREE.Color(0x0a0e18) },
      offset: { value: 20 },
      exponent: { value: 0.8 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = "sky-dome";
  scene.add(sky);
}

addSky();

const CHARACTER_PATH = "/models/bots/";
const TARGET_CHARACTER_HEIGHT = 1.8;
const characterCache = new Map();
const BUILDING_PATH = "/models/buildings/Models/";
const buildingModelCache = new Map();
let buildingBundlePromise = null;

function loadBuildingBundle() {
  if (!buildingBundlePromise) {
    const loader = new GLTFLoader();
    loader.setPath(BUILDING_PATH);
    buildingBundlePromise = new Promise((resolve, reject) => {
      loader.load(
        "Buildings.glb",
        (gltf) => {
          const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!model) {
            reject(new Error("Buildings.glb missing scene"));
            return;
          }
          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              child.userData = child.userData || {};
              child.userData.sharedModel = true;
            }
          });
          resolve(model);
        },
        undefined,
        (err) => {
          console.error("Failed to load building bundle GLB", err);
          buildingBundlePromise = null;
          reject(err);
        }
      );
    });
  }
  return buildingBundlePromise;
}

function loadCharacterTemplate(index) {
  if (!characterCache.has(index)) {
    const promise = new Promise((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath(CHARACTER_PATH);
      mtlLoader.load(
        `Zed_${index}.mtl`,
        (materials) => {
          materials.preload();

          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.setPath(CHARACTER_PATH);
          objLoader.load(
            `Zed_${index}.obj`,
            (model) => {
              model.traverse((child) => {
                if (child.isMesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });

              const box = new THREE.Box3().setFromObject(model);
              const height = box.max.y - box.min.y;
              let scale = 1;
              if (Number.isFinite(height) && height > 0) {
                scale = Math.min(1, TARGET_CHARACTER_HEIGHT / height);
              }
              model.scale.setScalar(scale);
              if (Number.isFinite(box.min.y)) {
                model.position.y -= box.min.y * scale;
              }

              resolve(model);
            },
            undefined,
            (err) => {
              console.error("Failed to load character OBJ", err);
              characterCache.delete(index);
              reject(err);
            }
          );
        },
        undefined,
        (err) => {
          console.error("Failed to load character MTL", err);
          characterCache.delete(index);
          reject(err);
        }
      );
    });
    characterCache.set(index, promise);
  }
  return characterCache.get(index);
}

function loadCharacter(index, callback) {
  return loadCharacterTemplate(index).then((model) => {
    const clone = model.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.userData = child.userData || {};
        child.userData.sharedModel = true;
      }
    });
    if (callback) callback(clone);
    return clone;
  });
}

function pickCharacterIndex(playerId) {
  const safeId = Math.abs(Number(playerId || 0));
  return (safeId % 6) + 1;
}

function loadBuildingModel(name) {
  if (!buildingModelCache.has(name)) {
    const promise = (async () => {
      const bundle = await loadBuildingBundle();
      const idx = Math.max(0, parseInt(name.split("_")[1], 10) - 1);
      // Prefer child by name, then by index, then whole bundle as fallback.
      const candidateByName = bundle.getObjectByName(name);
      const meshChildren = bundle.children.filter((c) => c.isMesh || c.isGroup || c.isObject3D);
      const candidateByIndex = meshChildren[idx] || meshChildren[0] || bundle;
      const template = candidateByName || candidateByIndex || bundle;
      return template;
    })().catch((err) => {
      console.error("Failed to load building", name, err);
      buildingModelCache.delete(name);
      throw err;
    });
    buildingModelCache.set(name, promise);
  }
  return buildingModelCache.get(name);
}

const weaponModelCache = new Map();
function loadWeaponModel(name, callback) {
  if (!weaponModelCache.has(name)) {
    const promise = new Promise((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath("/models/weapons/");
      mtlLoader.load(
        `${name}.mtl`,
        (materials) => {
          materials.preload();
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.setPath("/models/weapons/");
          objLoader.load(
            `${name}.obj`,
            (model) => {
              model.traverse((child) => {
                if (child.isMesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
                  child.userData = child.userData || {};
                  child.userData.sharedModel = true;
                }
              });
              resolve(model);
              if (callback) callback(model);
            },
            undefined,
            (err) => {
              console.error("Failed to load weapon OBJ", err);
              weaponModelCache.delete(name);
              reject(err);
            }
          );
        },
        undefined,
        (err) => {
          console.error("Failed to load weapon MTL", err);
          weaponModelCache.delete(name);
          reject(err);
        }
      );
    });
    weaponModelCache.set(name, promise);
  }
  return weaponModelCache.get(name);
}

function makeNoiseTexture(colorA, colorB) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const t = Math.random() * 0.4;
    const a = colorA.map((c) => c + t * 30);
    const b = colorB.map((c) => c + t * 30);
    const useA = Math.random() > 0.5;
    const base = i * 4;
    img.data[base + 0] = useA ? a[0] : b[0];
    img.data[base + 1] = useA ? a[1] : b[1];
    img.data[base + 2] = useA ? a[2] : b[2];
    img.data[base + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

function makeBrickTexture(primary, secondary) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = secondary;
  for (let y = 0; y < size; y += 16) {
    for (let x = 0; x < size; x += 16) {
      const offset = (y / 16) % 2 === 0 ? 0 : 8;
      ctx.fillRect((x + offset) % size, y, 14, 10);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

function makeGroundMaterial(a, b) {
  const tex = makeNoiseTexture(a, b);
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0.02,
  });
}

const groundMat = makeGroundMaterial([26, 44, 32], [34, 60, 40]);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
let pathMesh = null;

let colliders = [];
let currentMapId = null;
let currentMapMeshes = [];
let latestPlayers = [];
const cityBuildingLayout = [
  // North belt
  { model: "Building_1", x: -52, z: -62, rot: 4, scale: 1.05 },
  { model: "Building_2", x: -27, z: -62, rot: -6, scale: 1.0 },
  { model: "Building_3", x: -2, z: -62, rot: 12, scale: 1.02 },
  { model: "Building_4", x: 23, z: -62, rot: -8, scale: 1.05 },
  { model: "Building_5", x: 48, z: -62, rot: 16, scale: 1.08 },
  // Mid-north row
  { model: "Building_6", x: -52, z: -34, rot: 86, scale: 1.0 },
  { model: "Building_7", x: -27, z: -34, rot: -94, scale: 1.0 },
  { model: "Building_8", x: -2, z: -34, rot: 92, scale: 0.98 },
  { model: "Building_9", x: 23, z: -34, rot: -92, scale: 1.0 },
  { model: "Building_10", x: 48, z: -34, rot: 88, scale: 1.02 },
  // Central tight grid (streets ~8-10u wide pre-scale)
  { model: "Building_3", x: -52, z: -6, rot: 10, scale: 0.98 },
  { model: "Building_2", x: -27, z: -6, rot: 184, scale: 1.0 },
  { model: "Building_1", x: -2, z: -6, rot: -4, scale: 1.0 },
  { model: "Building_4", x: 23, z: -6, rot: 180, scale: 1.0 },
  { model: "Building_5", x: 48, z: -6, rot: -6, scale: 1.0 },
  { model: "Building_6", x: -52, z: 20, rot: 6, scale: 0.98 },
  { model: "Building_7", x: -27, z: 20, rot: -12, scale: 1.0 },
  { model: "Building_8", x: -2, z: 20, rot: 170, scale: 1.0 },
  { model: "Building_9", x: 23, z: 20, rot: -188, scale: 1.0 },
  { model: "Building_10", x: 48, z: 20, rot: 182, scale: 1.02 },
  // Mid-south row
  { model: "Building_1", x: -52, z: 46, rot: 8, scale: 1.05 },
  { model: "Building_2", x: -27, z: 46, rot: -6, scale: 1.0 },
  { model: "Building_3", x: -2, z: 46, rot: 16, scale: 1.02 },
  { model: "Building_4", x: 23, z: 46, rot: -10, scale: 1.05 },
  { model: "Building_5", x: 48, z: 46, rot: 14, scale: 1.08 },
  // South belt
  { model: "Building_6", x: -52, z: 72, rot: 184, scale: 1.05 },
  { model: "Building_7", x: -27, z: 72, rot: 176, scale: 1.02 },
  { model: "Building_8", x: -2, z: 72, rot: -186, scale: 1.02 },
  { model: "Building_9", x: 23, z: 72, rot: 178, scale: 1.05 },
  { model: "Building_10", x: 48, z: 72, rot: -182, scale: 1.08 },
];
const mapDefinitions = {
  dust: {
    name: "Dust Valley",
    ambient: 0xffe9c4,
    ground: { a: [170, 150, 105], b: [190, 170, 120] },
    path: { w: 120, d: 50, color: 0xa07c4a },
    buildings: [
      { x: -30, z: -25, w: 16, d: 14, h: 10, color: 0xc8a070 },
      { x: -50, z: 0, w: 14, d: 30, h: 10, color: 0xb98a5f },
      { x: 30, z: -20, w: 18, d: 14, h: 10, color: 0xcba46e },
      { x: 50, z: 6, w: 14, d: 28, h: 10, color: 0xb88952 },
      { x: 0, z: 30, w: 24, d: 12, h: 10, color: 0xc49b64 },
      { x: -18, z: 18, w: 12, d: 10, h: 8, color: 0xb88755 },
      { x: 22, z: 26, w: 12, d: 10, h: 8, color: 0xb88755 },
    ],
    trees: [],
    cacti: [
      { x: -12, z: -6 }, { x: 10, z: 8 }, { x: -8, z: 18 }, { x: 18, z: -12 }, { x: -24, z: 12 },
    ],
    rocks: [
      { x: -6, z: -18 }, { x: 6, z: 14 }, { x: 20, z: 10 }, { x: -18, z: 8 },
    ],
    crates: [
      { x: -8, z: 0, size: 2.2, color: 0x9f7b48 },
      { x: 8, z: -4, size: 1.8, color: 0x9f7b48 },
      { x: -20, z: -10, size: 2.4, color: 0x8c6a3a },
      { x: 20, z: -10, size: 2.4, color: 0x8c6a3a },
      { x: 0, z: 14, size: 1.8, color: 0xa2845a },
    ],
    pillars: [
      { x: -4, z: -8, h: 3.2, color: 0xd5b48a },
      { x: 12, z: -12, h: 3.2, color: 0xd5b48a },
    ],
    platforms: [
      { x: 0, z: 36, w: 18, d: 8, h: 2 },
    ],
    ramps: [
      { x: 0, z: 28, w: 12, h: 2, rot: 0 },
      { x: -32, z: -6, w: 10, h: 2, rot: Math.PI / 2 },
      { x: 32, z: -6, w: 10, h: 2, rot: -Math.PI / 2 },
    ],
  },
  mirage: {
    name: "Mirage Alley",
    ambient: 0xded7cf,
    ground: { a: [94, 96, 102], b: [112, 114, 120] },
    path: { w: 110, d: 44, color: 0x3e4550 },
    buildings: [
      { x: -10, z: -6, w: 16, d: 14, h: 12, color: 0xd19b78 },
      { x: 16, z: 12, w: 18, d: 14, h: 12, color: 0xc37f68 },
      { x: -26, z: 12, w: 16, d: 14, h: 12, color: 0xb96f59 },
      { x: 0, z: 30, w: 20, d: 12, h: 10, color: 0xb46d58 },
      { x: -40, z: -2, w: 12, d: 20, h: 10, color: 0xc18a70 },
      { x: 40, z: 0, w: 12, d: 20, h: 10, color: 0xc18a70 },
      { x: 0, z: -26, w: 18, d: 10, h: 10, color: 0xd6a07c },
    ],
    trees: [
      [-6, 18], [10, 6], [-18, 6], [4, -14], [18, -8],
    ],
    cacti: [],
    rocks: [
      { x: -14, z: 22 }, { x: 12, z: 20 }, { x: -18, z: -14 },
    ],
    crates: [
      { x: 0, z: 8, size: 2.0, color: 0x77634a },
      { x: 8, z: -6, size: 1.8, color: 0x6b5942 },
      { x: -12, z: -6, size: 1.8, color: 0x6b5942 },
      { x: -6, z: 26, size: 2.4, color: 0x7c664d },
      { x: 12, z: 26, size: 2.0, color: 0x7c664d },
    ],
    pillars: [
      { x: -2, z: 0, h: 3.4, color: 0x8f8c82 },
      { x: 10, z: 12, h: 3.4, color: 0x8f8c82 },
    ],
    platforms: [
      { x: -20, z: 0, w: 10, d: 6, h: 2.2 },
      { x: 20, z: 0, w: 10, d: 6, h: 2.2 },
    ],
    ramps: [
      { x: -20, z: 6, w: 8, h: 2, rot: 0 },
      { x: 20, z: 6, w: 8, h: 2, rot: 0 },
      { x: 0, z: 24, w: 12, h: 2, rot: 0 },
    ],
  },
  city: {
    name: "City Block",
    ambient: 0xd6e3f2,
    ground: { a: [72, 76, 84], b: [80, 86, 96] },
    cityBuildings: cityBuildingLayout,
  },
};

function registerObject(obj) {
  currentMapMeshes.push(obj);
  return obj;
}

function addColliderFromMesh(mesh, padding = 0.2) {
  const box = new THREE.Box3().setFromObject(mesh);
  box.expandByScalar(padding);
  colliders.push(box);
}

function addBuilding(x, z, w, d, h, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: makeBrickTexture("#" + color.toString(16).padStart(6, "0"), "#1f2a3a"),
    roughness: 0.62,
    metalness: 0.12,
  });
  const body = new THREE.Mesh(geo, mat);
  body.position.set(x, 0, z);
  body.castShadow = true;
  body.receiveShadow = true;

  const group = new THREE.Group();
  group.add(body);
  scene.add(group);
  addColliderFromMesh(body, 0.6);
  registerObject(group);
}

function addTree(x, z, scale = 1) {
  const trunkGeo = new THREE.CylinderGeometry(0.25 * scale, 0.35 * scale, 2.8 * scale, 8);
  const trunk = new THREE.Mesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: 0x5c3b1c, roughness: 1 })
  );
  trunk.position.set(x, 1.4 * scale, z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  scene.add(trunk);
  registerObject(trunk);

  const variant = Math.random();
  let crown;
  if (variant < 0.33) {
    crown = new THREE.Mesh(
      new THREE.SphereGeometry(1.4 * scale, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x2da860, roughness: 0.75 })
    );
  } else if (variant < 0.66) {
    crown = new THREE.Mesh(
      new THREE.ConeGeometry(1.5 * scale, 2.6 * scale, 10),
      new THREE.MeshStandardMaterial({ color: 0x3bbf7a, roughness: 0.7 })
    );
  } else {
    crown = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.4 * scale),
      new THREE.MeshStandardMaterial({ color: 0x1f8f5d, roughness: 0.8 })
    );
  }
  crown.position.set(x, 3 * scale, z);
  crown.castShadow = true;
  scene.add(crown);
  registerObject(crown);

  const trunkBox = new THREE.Box3().setFromCenterAndSize(
    new THREE.Vector3(x, 1.5 * scale, z),
    new THREE.Vector3(0.8 * scale, 3 * scale, 0.8 * scale)
  );
  colliders.push(trunkBox);
}

function addCrate(x, z, size, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, map: makeBrickTexture("#" + color.toString(16).padStart(6, "0"), "#2a2a2a") })
  );
  mesh.position.set(x, size / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  registerObject(mesh);
  addColliderFromMesh(mesh, 0.3);
}

function addPillar(x, z, h, color) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.5, h, 10),
    new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.6, map: makeBrickTexture("#" + color.toString(16).padStart(6, "0"), "#303030") })
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  registerObject(mesh);
  addColliderFromMesh(mesh, 0.2);
}

function addPlatform(x, z, w, d, h) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x3a4b6a, roughness: 0.4, metalness: 0.2, map: makeBrickTexture("#3a4b6a", "#1c2230") })
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  registerObject(mesh);
  addColliderFromMesh(mesh, 0.3);
}

function addRamp(x, z, w, h, rot) {
  const geo = new THREE.BoxGeometry(w, h, w * 2);
  geo.rotateX(-Math.PI / 6);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.5 }));
  mesh.position.set(x, h / 2, z);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  registerObject(mesh);
  addColliderFromMesh(mesh, 0.5);
}

function clearMap() {
  currentMapMeshes.forEach((obj) => {
    scene.remove(obj);
    disposeObject(obj);
  });
  currentMapMeshes.length = 0;
  colliders = [];
  pathMesh = null;
}

function buildCityMap(sceneRef, def, mapId) {
  const placements = def.cityBuildings || [];
  if (!placements.length) return;
  const expectedMap = mapId;
  const tasks = placements.map(async (entry) => {
    try {
      const base = await loadBuildingModel(entry.model);
      if (currentMapId !== expectedMap) return null;
      const clone = base.clone(true);
      clone.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.userData = child.userData || {};
          child.userData.sharedModel = true;
        }
      });
      const scale = entry.scale ?? 1;
      clone.scale.setScalar(scale);
      clone.position.set(entry.x * MAP_SCALE, entry.y ?? 0, entry.z * MAP_SCALE);
      clone.rotation.y = THREE.MathUtils.degToRad(entry.rot || 0);
      clone.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(clone);
      if (Number.isFinite(box.min.y) && Math.abs(box.min.y) > 0.001) {
        clone.position.y -= box.min.y;
        clone.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(clone);
      }
      sceneRef.add(clone);
      registerObject(clone);
      addColliderFromMesh(clone, entry.padding ?? 0.8);
      return {
        x: (box.max.x + box.min.x) / 2,
        z: (box.max.z + box.min.z) / 2,
        w: box.max.x - box.min.x,
        d: box.max.z - box.min.z,
      };
    } catch (err) {
      console.error("Failed to load building", entry.model, err);
      return null;
    }
  });

  Promise.all(tasks).then((bounds) => {
    if (currentMapId !== expectedMap) return;
    const valid = bounds.filter(Boolean);
    if (valid.length) {
      currentMapDef.buildings = valid;
      drawMinimap();
    }
  });
}

function loadMap(key) {
  const def = mapDefinitions[key] || mapDefinitions.dust;
  const mapChanged = currentMapId && currentMapId !== key;
  currentMapId = mapDefinitions[key] ? key : "dust";
  if (mapChanged) {
    clearRemotePlayers();
    playersSnapshot.clear();
    latestPlayers = [];
    updateScoreboard();
  }
  clearMap();
  const scaleH = (h) => h * (1 + (MAP_SCALE - 1) * 0.35);
  const isCity = Array.isArray(def.cityBuildings) && def.cityBuildings.length > 0;
  const scaledBuildings = isCity
    ? []
    : (def.buildings || []).map((b) => ({
        ...b,
        x: b.x * MAP_SCALE,
        z: b.z * MAP_SCALE,
        w: b.w * MAP_SCALE,
        d: b.d * MAP_SCALE,
        h: scaleH(b.h),
      }));
  currentMapDef = { ...def, buildings: scaledBuildings };
  ground.material = makeGroundMaterial(def.ground.a, def.ground.b);
  ground.material.needsUpdate = true;
  if (def.ambient) {
    ambient.color = new THREE.Color(def.ambient);
  }

  if (!isCity && def.path) {
    const mat = new THREE.MeshStandardMaterial({
      color: def.path.color,
      roughness: 0.9,
      metalness: 0.08,
      opacity: 0.7,
      transparent: true,
    });
    pathMesh = new THREE.Mesh(new THREE.PlaneGeometry(def.path.w * MAP_SCALE, def.path.d * MAP_SCALE), mat);
    pathMesh.rotation.x = -Math.PI / 2;
    pathMesh.position.set(0, 0.02, 0);
    scene.add(pathMesh);
    registerObject(pathMesh);
  }

  if (isCity) {
    currentMapDef.buildings = [];
    buildCityMap(scene, def, currentMapId);
  } else {
    scaledBuildings?.forEach((b) => addBuilding(b.x, b.z, b.w, b.d, b.h, b.color));
    def.trees?.forEach(([x, z]) => addTree(x * MAP_SCALE, z * MAP_SCALE, (0.9 + Math.random() * 0.5) * (1 + (MAP_SCALE - 1) * 0.2)));
    def.crates?.forEach((c) => addCrate(c.x * MAP_SCALE, c.z * MAP_SCALE, c.size * MAP_SCALE * 0.9, c.color));
    def.pillars?.forEach((p) => addPillar(p.x * MAP_SCALE, p.z * MAP_SCALE, scaleH(p.h), p.color));
    def.platforms?.forEach((p) => addPlatform(p.x * MAP_SCALE, p.z * MAP_SCALE, p.w * MAP_SCALE, p.d * MAP_SCALE, scaleH(p.h)));
    def.ramps?.forEach((r) => addRamp(r.x * MAP_SCALE, r.z * MAP_SCALE, r.w * MAP_SCALE, scaleH(r.h), r.rot));
    def.cacti?.forEach((c) => addCactus(c.x * MAP_SCALE, c.z * MAP_SCALE, 3 * (1 + (MAP_SCALE - 1) * 0.25)));
    def.rocks?.forEach((r) => addRock(r.x * MAP_SCALE, r.z * MAP_SCALE));
  }
  const mapIndicator = document.getElementById("map-indicator");
  if (mapIndicator) {
    mapIndicator.textContent = `Map: ${def.name || currentMapId}`;
  }
  drawMinimap();
}

loadMap(selectedMap);
menuMusic.volume = settings.music;
menuMusic.play().catch(() => {});

function addCactus(x, z, height = 3) {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, height, 8),
    new THREE.MeshStandardMaterial({ color: 0x4f8a4f, roughness: 0.7 })
  );
  body.position.set(x, height / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);
  registerObject(body);
  addColliderFromMesh(body, 0.3);
}

function addRock(x, z) {
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.9 + Math.random() * 0.5),
    new THREE.MeshStandardMaterial({ color: 0x88827a, roughness: 1 })
  );
  mesh.position.set(x, mesh.geometry.parameters.radius || 1, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  registerObject(mesh);
  addColliderFromMesh(mesh, 0.2);
}

// Player state
const player = {
  id: null,
  nickname: "",
  hp: 100,
  position: new THREE.Vector3(0, 1.6, 6),
  velocity: new THREE.Vector3(),
  onGround: false,
  loadout: { primary: "AssaultRifle_1", secondary: "Pistol_1", melee: "knife" },
  weapon: "AssaultRifle_1",
  weapons: {},
  currentSlot: "primary",
  ammo: {
    mag: 30,
    magSize: 30,
    reserve: 120,
    reloading: false,
    reloadTime: 1.5,
    damage: 15,
    fireDelay: 180,
    sound: "assault",
    reloadSound: "assaultReload",
    range: 120,
  },
};

const PLAYER_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.65;
const GRAVITY = 26;
const JUMP_FORCE = 9;
const MOVE_ACCEL = 42;
const AIR_ACCEL = 14;
const FRICTION = 8;
const scopeOverlay = document.createElement("div");
scopeOverlay.id = "scope-overlay";
scopeOverlay.style.position = "fixed";
scopeOverlay.style.inset = "0";
scopeOverlay.style.background = "radial-gradient(circle at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 70%)";
scopeOverlay.style.pointerEvents = "none";
scopeOverlay.style.opacity = "0";
scopeOverlay.style.transition = "opacity 0.1s ease";
scopeOverlay.style.zIndex = "8";
document.body.appendChild(scopeOverlay);

const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
};

let ws = null;
let myNickname = "";
let lastShotAt = 0;

const remotePlayers = new Map(); // id -> { mesh, tag, hp }
function clearRemotePlayers() {
  for (const entry of remotePlayers.values()) {
    scene.remove(entry.mesh);
    disposeObject(entry.mesh);
  }
  remotePlayers.clear();
}
const clock = new THREE.Clock();
const playersSnapshot = new Map();
const killfeedItems = [];
let bobTime = 0;
let profileId = null;
const profileTotals = { kills: 0, deaths: 0 };
let fireTimer = null;
updateAmmoUI();
if (startScreen) startScreen.classList.add("active");
if (mapSelect) {
  mapSelect.addEventListener("change", () => {
    selectedMap = mapSelect.value;
    loadMap(selectedMap);
  });
}
if (primarySelect) {
  primarySelect.addEventListener("change", () => {
    selectedPrimary = primarySelect.value;
  });
}
if (secondarySelect) {
  secondarySelect.addEventListener("change", () => {
    selectedSecondary = secondarySelect.value;
  });
}

function applyVolumeSettings() {
  if (volumeSlider) {
    volumeSlider.value = settings.volume;
  }
  if (musicSlider) {
    musicSlider.value = settings.music;
  }
  Object.values(sounds).forEach((s) => {
    if (s && s.volume !== undefined && !s.isMusic) {
      s.volume = settings.volume;
    }
  });
  if (menuMusic) {
    menuMusic.volume = settings.music;
  }
}

if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    settings.volume = parseFloat(volumeSlider.value);
    localStorage.setItem("lanfps_vol", settings.volume);
    applyVolumeSettings();
  });
}
if (musicSlider) {
  musicSlider.addEventListener("input", () => {
    settings.music = parseFloat(musicSlider.value);
    localStorage.setItem("lanfps_music", settings.music);
    applyVolumeSettings();
  });
}

const storedNick = localStorage.getItem("lanfps_nick");
if (storedNick && nicknameInput) {
  nicknameInput.value = storedNick;
  player.nickname = storedNick;
}

// Single start screen only

function applySettingsUI() {
  const sensSlider = document.getElementById("sens-slider");
  const volSlider = document.getElementById("volume-slider");
  const gfxSelect = document.getElementById("graphics-select");
  const bloodSelect = document.getElementById("blood-select");
  if (sensSlider) sensSlider.value = settings.sensitivity;
  if (volSlider) volSlider.value = settings.volume;
  if (gfxSelect) gfxSelect.value = settings.graphics;
  if (bloodSelect) bloodSelect.value = settings.blood;
}

function saveSettings() {
  const sensSlider = document.getElementById("sens-slider");
  const volSlider = document.getElementById("volume-slider");
  const gfxSelect = document.getElementById("graphics-select");
  const bloodSelect = document.getElementById("blood-select");
  settings.sensitivity = sensSlider ? parseFloat(sensSlider.value) : settings.sensitivity;
  settings.volume = volSlider ? parseFloat(volSlider.value) : settings.volume;
  settings.graphics = gfxSelect ? gfxSelect.value : settings.graphics;
  settings.blood = bloodSelect ? bloodSelect.value : settings.blood;
  localStorage.setItem("lanfps_sens", settings.sensitivity);
  localStorage.setItem("lanfps_vol", settings.volume);
  localStorage.setItem("lanfps_gfx", settings.graphics);
  localStorage.setItem("lanfps_blood", settings.blood);
  Object.values(sounds).forEach((s) => {
    if (s && s.volume !== undefined) s.volume = settings.volume;
  });
}

applySettingsUI();

sounds.shot.volume = 0.2;
sounds.hit.volume = 0.25;
sounds.ambient.loop = true;
sounds.ambient.volume = 0.05;
sounds.empty.volume = 0.25;
sounds.shot.playbackRate = 0.95;
applyVolumeSettings();

function log(message) {
  logBox.textContent = message;
}

function playAmbient() {
  sounds.ambient.play().catch(() => {});
}

function showStatus(message, duration = 1200) {
  statusText.textContent = message;
  statusText.style.opacity = 1;
  setTimeout(() => (statusText.style.opacity = 0), duration);
}

function setHP(hp) {
  player.hp = hp;
  const clamped = Math.max(0, Math.min(100, hp));
  hpFill.style.width = `${clamped}%`;
  if (hpValue) hpValue.textContent = `${Math.round(clamped)}`;
  if (clamped > 65) {
    hpFill.style.background = "linear-gradient(90deg, #5df18f, #8cf16a)";
  } else if (clamped > 35) {
    hpFill.style.background = "linear-gradient(90deg, #ffb347, #ff9b3f)";
  } else {
    hpFill.style.background = "linear-gradient(90deg, #ff5a5f, #d60032)";
  }
}

function updateAmmoUI() {
  if (statAmmo) {
    if (player.ammo.weaponKey === "knife") {
      statAmmo.textContent = `Ammo: --`;
    } else {
      statAmmo.textContent = `Ammo: ${player.ammo.mag} / ${player.ammo.reserve}`;
    }
  }
}

function resetAmmoForLoadout(playSound = false) {
  const loadout = player.loadout || { primary: selectedPrimary, secondary: selectedSecondary, melee: "knife" };
  const targetSlot = player.currentSlot || "primary";
  player.weapons = player.weapons || {};
  ["primary", "secondary", "melee"].forEach((slot) => {
    const key = loadout[slot];
    const def = weaponDefs[key];
    if (!def) return;
    player.weapons[key] = {
      mag: def.magazineSize || def.mag || 1,
      reserve: def.reserve === Infinity ? Infinity : def.reserve ?? 0,
    };
  });
  equipWeapon(targetSlot);
  player.ammo.reloading = false;
  if (playSound && player.ammo.weaponKey !== "knife") {
    const reloadKey = player.ammo.reloadSound || `${player.ammo.sound}Reload`;
    const rel = sounds[reloadKey] || sounds.reload || sounds.empty;
    if (rel) {
      rel.currentTime = 0;
      rel.play().catch(() => {});
    }
  }
  updateAmmoUI();
}

function equipWeapon(slotName) {
  const loadout = player.loadout || { primary: selectedPrimary, secondary: selectedSecondary, melee: "knife" };
  const weaponKey = loadout[slotName];
  const def = weaponDefs[weaponKey];
  if (!def) return;
  player.currentSlot = slotName;
  player.weapon = weaponKey;
  const state = player.weapons[weaponKey] || {
    mag: def.magazineSize || def.mag || 1,
    reserve: def.reserve === Infinity ? Infinity : def.reserve ?? 0,
  };
  player.weapons[weaponKey] = state;
  player.ammo = {
    ...state,
    magSize: def.magazineSize || def.mag || 1,
    reloading: false,
    reloadTime: def.reloadTime ?? def.reload ?? 0,
    damage: def.damage,
    fireDelay: def.fireDelay,
    fireRate: def.fireRate,
    range: def.range ?? 120,
    bulletSpeed: def.bulletSpeed ?? 220,
    sound: def.sound || def.soundFire,
    reloadSound: def.reloadSound || def.soundReload,
    recoil: def.recoil || 0,
    auto: !!def.auto,
    reserve: def.reserve === Infinity ? Infinity : state.reserve,
    scoped: !!def.scoped,
    weaponKey,
  };
  updateAmmoUI();
  updateViewmodel(weaponKey);
  applyScope(scoped);
}

function switchWeapon(slot) {
  equipWeapon(slot);
}

function updateKDUI() {
  if (!statKills || !statDeaths) return;
  const me = playersSnapshot.get(player.id);
  if (me) {
    statKills.textContent = `Kills: ${me.kills || 0}`;
    statDeaths.textContent = `Deaths: ${me.deaths || 0}`;
  }
}

function updateProfileUI() {
  const kd = profileTotals.deaths ? (profileTotals.kills / profileTotals.deaths).toFixed(2) : profileTotals.kills.toFixed(2);
  if (profileTotalKills) profileTotalKills.textContent = profileTotals.kills;
  if (profileTotalDeaths) profileTotalDeaths.textContent = profileTotals.deaths;
  if (profileTotalKD) profileTotalKD.textContent = kd;
  if (statTotal) statTotal.textContent = `Total K: ${profileTotals.kills} / D: ${profileTotals.deaths}`;
}

function flashDamage() {
  damageOverlay.classList.add("active");
  setTimeout(() => damageOverlay.classList.remove("active"), 220);
  sounds.hit.currentTime = 0;
  sounds.hit.play().catch(() => {});
}

function makeNameTag(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(12,16,26,0.8)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#6ee7ff";
  ctx.font = "bold 32px 'Space Grotesk', 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.4, 0.6, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  return sprite;
}

function disposeObject(object) {
  if (!object) return;
  const disposeTex = (tex) => {
    if (tex && typeof tex.dispose === "function") {
      tex.dispose();
    }
  };
  object.traverse((child) => {
    if (child.isMesh) {
      if (child.userData?.sharedModel) return;
      if (child.geometry?.dispose) child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat) return;
        disposeTex(mat.map);
        disposeTex(mat.lightMap);
        disposeTex(mat.aoMap);
        disposeTex(mat.emissiveMap);
        disposeTex(mat.bumpMap);
        disposeTex(mat.normalMap);
        disposeTex(mat.displacementMap);
        disposeTex(mat.roughnessMap);
        disposeTex(mat.metalnessMap);
        disposeTex(mat.alphaMap);
        disposeTex(mat.envMap);
        if (mat.dispose) mat.dispose();
      });
    } else if (child.material?.dispose) {
      child.material.dispose();
    }
  });
}

function applyWorldWeaponTransform(mesh, weaponKey) {
  const t = weaponWorldOffsets[weaponKey] || weaponWorldOffsets.default;
  const deg = THREE.MathUtils.degToRad;
  mesh.position.set(t.pos.x, t.pos.y, t.pos.z);
  mesh.rotation.set(deg(t.rot.x), deg(t.rot.y), deg(t.rot.z));
  mesh.scale.setScalar(t.scale || 1);
}

async function setRemoteWeapon(entry, weaponKey) {
  if (entry.weaponKey === weaponKey) return;
  if (entry.weaponMesh) {
    entry.mesh.remove(entry.weaponMesh);
    disposeObject(entry.weaponMesh);
    entry.weaponMesh = null;
  }
  entry.weaponKey = weaponKey;
  const def = weaponDefs[weaponKey];
  if (!def || !def.model) return;
  try {
    const base = await loadWeaponModel(def.model);
    if (entry.weaponKey !== weaponKey) return;
    const clone = base.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    applyWorldWeaponTransform(clone, weaponKey);
    entry.mesh.add(clone);
    entry.weaponMesh = clone;
  } catch (err) {
    console.error("Failed to attach remote weapon", err);
  }
}

function createRemotePlayer(nickname, isBot, playerId) {
  const color = isBot ? 0xc8d14c : 0xd44a4a;
  const tag = makeNameTag(nickname);
  tag.position.set(0, 2.2, 0);
  tag.userData = { label: nickname };

  const group = new THREE.Group();
  const placeholder = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.8, 6, 12),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.12 })
  );
  placeholder.castShadow = true;
  placeholder.receiveShadow = true;
  placeholder.position.y = 0.9;
  group.add(placeholder, tag);
  scene.add(group);

  const entry = {
    mesh: group,
    tag,
    targetPos: new THREE.Vector3(),
    rotTarget: 0,
    placeholder,
    characterIndex: pickCharacterIndex(playerId),
    weaponMesh: null,
    weaponKey: null,
  };

  loadCharacter(entry.characterIndex)
    .then((model) => {
      if (!remotePlayers.has(playerId)) {
        disposeObject(model);
        return;
      }
      entry.model = model;
      group.add(model);
      if (entry.placeholder) {
        group.remove(entry.placeholder);
        entry.placeholder.geometry.dispose();
        entry.placeholder.material.dispose();
        entry.placeholder = null;
      }
    })
    .catch((err) => console.error("Failed to load character model", err));

  return entry;
}

function updateRemotePlayers(serverPlayers) {
  const seen = new Set();
  for (const p of serverPlayers) {
    seen.add(p.id);
    if (p.id === player.id) {
      setHP(p.hp);
      continue;
    }

    let entry = remotePlayers.get(p.id);
    if (!entry) {
      entry = createRemotePlayer(p.nickname, p.isBot, p.id);
      remotePlayers.set(p.id, entry);
      entry.mesh.position.set(p.x, p.y - PLAYER_HEIGHT, p.z);
    }

    // Update name tag text if nickname changed
    if (entry.tag.userData?.label !== p.nickname) {
      entry.mesh.remove(entry.tag);
      entry.tag = makeNameTag(p.nickname);
      entry.tag.position.set(0, 2.2, 0);
      entry.mesh.add(entry.tag);
      entry.tag.userData = { label: p.nickname };
    }

    if (p.weapon) {
      setRemoteWeapon(entry, p.weapon);
    }

    entry.targetPos.set(p.x, p.y - PLAYER_HEIGHT, p.z);
    entry.rotTarget = p.rotY || 0;
  }

  for (const [id, entry] of remotePlayers.entries()) {
    if (!seen.has(id)) {
      scene.remove(entry.mesh);
      disposeObject(entry.mesh);
      remotePlayers.delete(id);
    }
  }
}

function updatePlayersSnapshot(list) {
  playersSnapshot.clear();
  for (const p of list) {
    playersSnapshot.set(p.id, p);
  }
  latestPlayers = list;
  updateKDUI();
}

function nameFor(id) {
  const snap = playersSnapshot.get(id);
  if (snap) return snap.nickname || `Player${id}`;
  if (id === player.id) return player.nickname || "You";
  const remote = remotePlayers.get(id);
  if (remote) return remote.tag?.userData?.label || `Player${id}`;
  return `Player${id}`;
}

function pushKillfeed(killerId, victimId) {
  const text = `${nameFor(killerId)} killed ${nameFor(victimId)}`;
  killfeedItems.unshift({ text, at: performance.now() });
  while (killfeedItems.length > 5) killfeedItems.pop();
  killfeed.innerHTML = killfeedItems.map((k) => `<div class="item">${k.text}</div>`).join("");
  if (killerId === player.id) {
    showStatus(`You killed ${nameFor(victimId)}`, 1000);
  }
  const killer = playersSnapshot.get(killerId);
  if (killer) killer.kills = (killer.kills || 0) + 1;
  const victim = playersSnapshot.get(victimId);
  if (victim) victim.deaths = (victim.deaths || 0) + 1;
  updateKDUI();
  updateScoreboard();
}

function hitMarker() {
  if (crosshair) {
    crosshair.classList.add("hit");
    setTimeout(() => crosshair.classList.remove("hit"), 160);
  }
}

function highlightTarget(targetId) {
  const entry = remotePlayers.get(targetId);
  if (!entry) return;
  const mats = [];
  entry.mesh.traverse((child) => {
    if (child.isMesh) {
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((mat) => {
        if (mat && mat.emissive && typeof mat.emissive.set === "function") {
          mats.push(mat);
        }
      });
    }
  });

  mats.forEach((mat) => {
    if (!mat.userData) mat.userData = {};
    if (!mat.userData.__lanHighlightEmissive) {
      mat.userData.__lanHighlightEmissive = mat.emissive.clone();
    }
    mat.emissive.set(0.6, 0, 0);
  });

  setTimeout(() => {
    mats.forEach((mat) => {
      if (mat.userData?.__lanHighlightEmissive) {
        mat.emissive.copy(mat.userData.__lanHighlightEmissive);
        delete mat.userData.__lanHighlightEmissive;
      } else {
        mat.emissive.set(0, 0, 0);
      }
    });
  }, 220);
  hitMarker();
}

function renderIncomingShot(msg) {
  if (!msg?.origin || !msg?.dir) return;
  const origin = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
  const dir = new THREE.Vector3(msg.dir.x, msg.dir.y, msg.dir.z).normalize();
  const color = msg.isBot ? 0xffa04d : 0x7cc3ff;
  spawnTracer(origin, dir, color, 140, 12);
  const flash = new THREE.PointLight(color, 2, 10);
  flash.position.copy(origin);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 140);

  const shooter = remotePlayers.get(msg.shooterId);
  if (shooter?.body?.material) {
    shooter.body.material.emissive = new THREE.Color(0.35, 0.18, 0);
    setTimeout(() => (shooter.body.material.emissive = new THREE.Color(0, 0, 0)), 160);
  }

  const listenerPos = controls.getObject().position;
  if (listenerPos.distanceTo(origin) < 38) {
    const snd = sounds.shot;
    snd.currentTime = 0;
    snd.play().catch(() => {});
  }
}

let scoreboardVisible = false;
function updateScoreboard() {
  if (!scoreBody) return;
  const rows = [...latestPlayers].sort((a, b) => (b.kills || 0) - (a.kills || 0));
  scoreBody.innerHTML = rows
    .map((p) => {
      const kd = p.deaths ? (p.kills || 0) / p.deaths : p.kills || 0;
      return `<tr><td>${p.nickname}</td><td>${p.kills || 0}</td><td>${p.deaths || 0}</td><td>${kd.toFixed(2)}</td></tr>`;
    })
    .join("");
  scoreboardEl.classList.toggle("visible", scoreboardVisible);
}

function drawMinimap() {
  if (!minimapCtx) return;
  const size = minimap.width;
  const scale = size / (WORLD_HALF_SIZE * 2);
  const center = size / 2;
  minimapCtx.clearRect(0, 0, size, size);
  minimapCtx.fillStyle = "rgba(18,24,36,0.9)";
  minimapCtx.fillRect(0, 0, size, size);
  minimapCtx.strokeStyle = "rgba(255,255,255,0.05)";
  minimapCtx.strokeRect(1, 1, size - 2, size - 2);

  // buildings
  minimapCtx.fillStyle = "rgba(90,130,180,0.8)";
  (currentMapDef?.buildings || []).forEach((b) => {
    const x = center + b.x * scale;
    const z = center + b.z * scale;
    minimapCtx.fillRect(x - (b.w / 2) * scale, z - (b.d / 2) * scale, b.w * scale, b.d * scale);
  });

  // players
  latestPlayers.forEach((p) => {
    const x = center + p.x * scale;
    const z = center + p.z * scale;
    if (p.id === player.id) {
      const angle = (p.rotY || 0);
      minimapCtx.fillStyle = "#5df18f";
      minimapCtx.beginPath();
      minimapCtx.moveTo(x + Math.sin(angle) * 6, z + Math.cos(angle) * 6);
      minimapCtx.lineTo(x + Math.sin(angle + Math.PI * 0.8) * 5, z + Math.cos(angle + Math.PI * 0.8) * 5);
      minimapCtx.lineTo(x + Math.sin(angle - Math.PI * 0.8) * 5, z + Math.cos(angle - Math.PI * 0.8) * 5);
      minimapCtx.closePath();
      minimapCtx.fill();
    } else {
      minimapCtx.fillStyle = p.isBot ? "#f0c14b" : "#62a5ff";
      minimapCtx.beginPath();
      minimapCtx.arc(x, z, p.isBot ? 4 : 3, 0, Math.PI * 2);
      minimapCtx.fill();
    }
  });
}

function pruneKillfeed() {
  const now = performance.now();
  let changed = false;
  for (let i = killfeedItems.length - 1; i >= 0; i--) {
    if (now - killfeedItems[i].at > 6500) {
      killfeedItems.splice(i, 1);
      changed = true;
    }
  }
  if (changed) {
    killfeed.innerHTML = killfeedItems.map((k) => `<div class="item">${k.text}</div>`).join("");
  }
}

function clampPlayerPosition(pos) {
  pos.x = Math.max(-WORLD_HALF_SIZE + 1, Math.min(WORLD_HALF_SIZE - 1, pos.x));
  pos.z = Math.max(-WORLD_HALF_SIZE + 1, Math.min(WORLD_HALF_SIZE - 1, pos.z));
}

function resolveCollisions(nextPos) {
  player.onGround = false;
  if (nextPos.y < PLAYER_HEIGHT) {
    nextPos.y = PLAYER_HEIGHT;
    player.velocity.y = 0;
    player.onGround = true;
  }

  for (const box of colliders) {
    const minX = box.min.x - PLAYER_RADIUS;
    const maxX = box.max.x + PLAYER_RADIUS;
    const minZ = box.min.z - PLAYER_RADIUS;
    const maxZ = box.max.z + PLAYER_RADIUS;
    const minY = box.min.y - 0.5;
    const maxY = box.max.y + PLAYER_HEIGHT;

    if (
      nextPos.x > minX &&
      nextPos.x < maxX &&
      nextPos.z > minZ &&
      nextPos.z < maxZ &&
      nextPos.y > minY &&
      nextPos.y < maxY
    ) {
      const dx = Math.min(maxX - nextPos.x, nextPos.x - minX);
      const dz = Math.min(maxZ - nextPos.z, nextPos.z - minZ);
      if (dx < dz) {
        nextPos.x = nextPos.x < (minX + maxX) / 2 ? minX : maxX;
        player.velocity.x = 0;
      } else {
        nextPos.z = nextPos.z < (minZ + maxZ) / 2 ? minZ : maxZ;
        player.velocity.z = 0;
      }
    }
  }

  clampPlayerPosition(nextPos);
}

function updateMovement(delta) {
  if (paused) return;
  if (!controls.isLocked) return;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  right.y = 0;
  right.normalize();

  const slow = scoped ? 0.55 : 1;
  const accel = (player.onGround ? MOVE_ACCEL : AIR_ACCEL) * slow;
  const friction = player.onGround ? FRICTION : 1;

  if (keys.forward) player.velocity.addScaledVector(forward, accel * delta);
  if (keys.backward) player.velocity.addScaledVector(forward, -accel * delta);
  if (keys.left) player.velocity.addScaledVector(right, -accel * delta);
  if (keys.right) player.velocity.addScaledVector(right, accel * delta);

  player.velocity.x -= player.velocity.x * friction * delta;
  player.velocity.z -= player.velocity.z * friction * delta;
  player.velocity.y -= GRAVITY * delta;

  if (keys.jump && player.onGround) {
    player.velocity.y = JUMP_FORCE;
    player.onGround = false;
  }

  const nextPos = player.position.clone().addScaledVector(player.velocity, delta);
  resolveCollisions(nextPos);
  player.position.copy(nextPos);
  controls.getObject().position.copy(player.position);
}

const muzzleLight = new THREE.PointLight(0xffddaa, 2.2, 12);
muzzleLight.visible = false;

// Viewmodel gun attached to camera.
const weapon = new THREE.Group();
weapon.position.set(0, 0, 0);
weapon.rotation.set(0, 0, 0);
let currentWeaponMesh = null;
let currentWeaponKeyForView = null;

const muzzleFlash = new THREE.Mesh(
  new THREE.SphereGeometry(0.1, 8, 8),
  new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0 })
);
weapon.add(muzzleFlash);
weapon.add(muzzleLight);
camera.add(weapon);

const weaponViewOffsets = {
  default: { pos: { x: 0.42, y: -0.36, z: -0.56 }, rot: { x: -6, y: 460, z: 0 }, scale: 0.36, muzzle: { x: 0.04, y: -0.08, z: -0.679 } },
  AssaultRifle_1: { pos: { x: 0.44, y: -0.38, z: -0.616 }, rot: { x: -6, y: 460, z: 0 }, scale: 0.34, muzzle: { x: 0.02, y: -0.08, z: -0.749 } },
  AssaultRifle_2: { pos: { x: 0.44, y: -0.4, z: -0.63 }, rot: { x: -6, y: 460, z: 0 }, scale: 0.34, muzzle: { x: 0.02, y: -0.08, z: -0.749 } },
  AssaultRifle_3: { pos: { x: 0.43, y: -0.42, z: -0.658 }, rot: { x: -7, y: 460, z: 0 }, scale: 0.35, muzzle: { x: 0.02, y: -0.08, z: -0.784 } },
  Bullpup_1: { pos: { x: 0.4, y: -0.36, z: -0.574 }, rot: { x: -5, y: 460, z: 0 }, scale: 0.35, muzzle: { x: 0.0, y: -0.06, z: -0.679 } },
  Bullpup_2: { pos: { x: 0.4, y: -0.36, z: -0.588 }, rot: { x: -5, y: 460, z: 0 }, scale: 0.35, muzzle: { x: 0.0, y: -0.06, z: -0.679 } },
  Pistol_1: { pos: { x: 0.38, y: -0.32, z: -0.42 }, rot: { x: -4, y: 460, z: 0 }, scale: 0.42, muzzle: { x: 0.04, y: -0.03, z: -0.518 } },
  Pistol_2: { pos: { x: 0.38, y: -0.32, z: -0.42 }, rot: { x: -4, y: 460, z: 0 }, scale: 0.42, muzzle: { x: 0.04, y: -0.03, z: -0.518 } },
  Pistol_3: { pos: { x: 0.38, y: -0.32, z: -0.42 }, rot: { x: -4, y: 460, z: 0 }, scale: 0.42, muzzle: { x: 0.04, y: -0.03, z: -0.518 } },
  Pistol_4: { pos: { x: 0.38, y: -0.32, z: -0.42 }, rot: { x: -4, y: 460, z: 0 }, scale: 0.42, muzzle: { x: 0.04, y: -0.03, z: -0.518 } },
  Pistol_5: { pos: { x: 0.38, y: -0.32, z: -0.42 }, rot: { x: -4, y: 460, z: 0 }, scale: 0.42, muzzle: { x: 0.04, y: -0.03, z: -0.518 } },
  Pistol_6: { pos: { x: 0.38, y: -0.32, z: -0.42 }, rot: { x: -4, y: 460, z: 0 }, scale: 0.42, muzzle: { x: 0.04, y: -0.03, z: -0.518 } },
  Revolver_1: { pos: { x: 0.4, y: -0.33, z: -0.462 }, rot: { x: -6, y: 460, z: 0 }, scale: 0.44, muzzle: { x: 0.05, y: -0.04, z: -0.574 } },
  Revolver_2: { pos: { x: 0.4, y: -0.33, z: -0.462 }, rot: { x: -6, y: 460, z: 0 }, scale: 0.44, muzzle: { x: 0.05, y: -0.04, z: -0.574 } },
  Revolver_3: { pos: { x: 0.4, y: -0.33, z: -0.462 }, rot: { x: -6, y: 460, z: 0 }, scale: 0.44, muzzle: { x: 0.05, y: -0.04, z: -0.574 } },
};

const weaponWorldOffsets = {
  default: { pos: { x: 0.32, y: 0.95, z: 0.18 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.3 },
  AssaultRifle_1: { pos: { x: 0.34, y: 0.98, z: 0.2 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.32 },
  AssaultRifle_2: { pos: { x: 0.34, y: 0.98, z: 0.2 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.32 },
  AssaultRifle_3: { pos: { x: 0.34, y: 0.98, z: 0.2 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.34 },
  Bullpup_1: { pos: { x: 0.32, y: 0.96, z: 0.18 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.32 },
  Bullpup_2: { pos: { x: 0.32, y: 0.96, z: 0.18 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.32 },
  Pistol_1: { pos: { x: 0.26, y: 0.9, z: 0.12 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.38 },
  Pistol_2: { pos: { x: 0.26, y: 0.9, z: 0.12 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.38 },
  Pistol_3: { pos: { x: 0.26, y: 0.9, z: 0.12 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.38 },
  Pistol_4: { pos: { x: 0.26, y: 0.9, z: 0.12 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.38 },
  Pistol_5: { pos: { x: 0.26, y: 0.9, z: 0.12 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.38 },
  Pistol_6: { pos: { x: 0.26, y: 0.9, z: 0.12 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.38 },
  Revolver_1: { pos: { x: 0.28, y: 0.92, z: 0.14 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.42 },
  Revolver_2: { pos: { x: 0.28, y: 0.92, z: 0.14 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.42 },
  Revolver_3: { pos: { x: 0.28, y: 0.92, z: 0.14 }, rot: { x: 0, y: 460, z: 0 }, scale: 0.42 },
};

function applyViewWeaponTransform(mesh, weaponKey) {
  const t = weaponViewOffsets[weaponKey] || weaponViewOffsets.default;
  const deg = THREE.MathUtils.degToRad;
  mesh.position.set(t.pos.x, t.pos.y, t.pos.z);
  mesh.rotation.set(deg(t.rot.x), deg(t.rot.y), deg(t.rot.z));
  mesh.scale.setScalar(t.scale || 1);
  if (t.muzzle) {
    muzzleFlash.position.set(t.muzzle.x, t.muzzle.y, t.muzzle.z);
    muzzleLight.position.set(t.muzzle.x, t.muzzle.y, (t.muzzle.z || 0) + 0.08);
  }
}

async function updateViewmodel(weaponKey) {
  if (currentWeaponKeyForView === weaponKey) return;
  const def = weaponDefs[weaponKey];
  if (!def || def.slot === "melee" || !def.model) {
    const t = weaponViewOffsets.default;
    if (t?.muzzle) {
      muzzleFlash.position.set(t.muzzle.x, t.muzzle.y, t.muzzle.z);
      muzzleLight.position.set(t.muzzle.x, t.muzzle.y, (t.muzzle.z || 0) + 0.08);
    }
    if (currentWeaponMesh) {
      weapon.remove(currentWeaponMesh);
      currentWeaponMesh = null;
      currentWeaponKeyForView = null;
    }
    return;
  }
  try {
    const base = await loadWeaponModel(def.model);
    if (player.ammo.weaponKey !== weaponKey) return;
    const clone = base.clone(true);
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    if (currentWeaponMesh) {
      weapon.remove(currentWeaponMesh);
    }
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.set(1, 1, 1);
    applyViewWeaponTransform(clone, weaponKey);
    weapon.add(clone);
    currentWeaponMesh = clone;
    currentWeaponKeyForView = weaponKey;
  } catch (err) {
    console.error("Failed to apply viewmodel", err);
  }
}

function spawnTracer(origin, dir, color = 0xffdd88, duration = 80, length = 6) {
  const end = origin.clone().addScaledVector(dir, length);
  const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  setTimeout(() => {
    scene.remove(line);
    geometry.dispose();
    material.dispose();
  }, duration);
}

function updateWeapon(delta) {
  const speed = Math.sqrt(player.velocity.x * player.velocity.x + player.velocity.z * player.velocity.z);
  bobTime += delta * speed * 3;
  const bobOffset = Math.sin(bobTime) * 0.02;
  const bobHeight = Math.cos(bobTime * 2) * 0.01;
  weapon.position.set(0.35 + bobOffset * 0.6, -0.35 + bobHeight, -0.6);
}

function shoot() {
  const now = performance.now();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (now - lastShotAt < player.ammo.fireDelay) return;
  if (player.ammo.reloading) return;
  if (player.ammo.weaponKey === "knife") {
    lastShotAt = now;
    performMelee();
    return;
  }
  if (player.ammo.mag <= 0) {
    sounds.empty.currentTime = 0;
    sounds.empty.play().catch(() => {});
    showStatus("Reload!", 600);
    return;
  }
  lastShotAt = now;
  player.ammo.mag = Math.max(0, player.ammo.mag - 1);
  const state = player.weapons[player.ammo.weaponKey];
  if (state) state.mag = player.ammo.mag;
  if (player.ammo.mag === 0) {
    setTimeout(() => reload(), 50);
  }
  updateAmmoUI();

  const origin = controls.getObject().position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  ws.send(
    JSON.stringify({
      type: "shot",
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      damage: player.ammo.damage,
      range: player.ammo.range,
    })
  );

  const snd = sounds[player.ammo.sound] || sounds.shot;
  snd.currentTime = 0;
  snd.play().catch(() => {});
  muzzleLight.visible = true;
  setTimeout(() => (muzzleLight.visible = false), 40);
  muzzleFlash.material.opacity = 1;
  setTimeout(() => (muzzleFlash.material.opacity = 0), 50);
  spawnTracer(origin, dir, 0xffdd88, 100, 10);
  // crosshair bump only (recoil disabled)
  crosshair.style.transform = "translate(-50%, -50%) scale(1.15)";
  setTimeout(() => (crosshair.style.transform = "translate(-50%, -50%) scale(1)"), 100);
}

function performMelee() {
  const origin = controls.getObject().position.clone();
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const reach = 2;
  const targetPoint = origin.clone().addScaledVector(dir, reach);
  ws.send(
    JSON.stringify({
      type: "shot",
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      damage: weaponDefs.knife.damage,
      range: player.ammo.range || reach,
    })
  );
  const snd = sounds.damage;
  snd.currentTime = 0;
  snd.play().catch(() => {});
  crosshair.classList.add("hit");
  setTimeout(() => crosshair.classList.remove("hit"), 150);
}

function reload() {
  if (player.ammo.weaponKey === "knife") return;
  if (player.ammo.reloading) return;
  if (player.ammo.mag >= player.ammo.magSize || player.ammo.reserve <= 0) return;
  player.ammo.reloading = true;
  const reloadKey = player.ammo.reloadSound || `${player.ammo.sound}Reload`;
  const rel = sounds[reloadKey] || sounds.reload || sounds.empty;
  if (rel) {
    rel.currentTime = 0;
    rel.play().catch(() => {});
  }
  setTimeout(() => {
    const needed = player.ammo.magSize - player.ammo.mag;
    const take = player.ammo.reserve === Infinity ? needed : Math.min(needed, player.ammo.reserve);
    player.ammo.mag += take;
    if (player.ammo.reserve !== Infinity) player.ammo.reserve -= take;
    player.ammo.reloading = false;
    const state = player.weapons[player.ammo.weaponKey];
    if (state) {
      state.mag = player.ammo.mag;
      state.reserve = player.ammo.reserve;
    }
    updateAmmoUI();
  }, player.ammo.reloadTime * 1000);
}

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    log("Connected. Click to lock pointer and play.");
    ws.send(
      JSON.stringify({
        type: "join",
        nickname: myNickname,
        map: selectedMap,
        primary: selectedPrimary,
        secondary: selectedSecondary,
      })
    );
  });

  ws.addEventListener("message", (ev) => {
    let msg = null;
    try {
      msg = JSON.parse(ev.data);
    } catch (err) {
      return;
    }

    if (msg.mapId && msg.mapId !== currentMapId) {
      selectedMap = msg.mapId;
      if (mapSelect) mapSelect.value = msg.mapId;
      loadMap(msg.mapId);
    }

    if (msg.type === "hello") {
      player.id = msg.id;
      if (msg.spawn) {
        player.position.set(msg.spawn.x, msg.spawn.y, msg.spawn.z);
        controls.getObject().position.copy(player.position);
      }
      if (typeof msg.hp === "number") {
        setHP(msg.hp);
      }
    } else if (msg.type === "state") {
      if (msg.mapId && msg.mapId !== currentMapId) return;
      updatePlayersSnapshot(msg.players);
      updateRemotePlayers(msg.players);
      updateScoreboard();
      drawMinimap();
    } else if (msg.type === "hitInfo") {
      setHP(msg.hp);
      flashDamage();
      sounds.damage.currentTime = 0;
      sounds.damage.play().catch(() => {});
      if (msg.killed && msg.spawn) {
        resetAmmoForLoadout(true);
        lastShotAt = 0;
        player.position.set(msg.spawn.x, msg.spawn.y, msg.spawn.z);
        controls.getObject().position.copy(player.position);
        player.velocity.set(0, 0, 0);
        showStatus(`Killed by ${msg.killer || "someone"}`, 1200);
        setTimeout(() => showStatus("Respawned", 900), 300);
        log(`Respawned. Killed by ${msg.killer || "someone"}.`);
      } else if (msg.killed) {
        resetAmmoForLoadout(true);
        showStatus("You died", 1200);
      }
    } else if (msg.type === "killEvent") {
      pushKillfeed(msg.killerId, msg.victimId);
      updateKDUI();
    } else if (msg.type === "hitConfirm") {
      highlightTarget(msg.targetId);
    } else if (msg.type === "shotEvent") {
      renderIncomingShot(msg);
    } 
  });

  ws.addEventListener("close", () => {
    log("Disconnected from server.");
    clearRemotePlayers();
    latestPlayers = [];
    updateScoreboard();
    drawMinimap();
  });
}

function sendState() {
  if (!ws || ws.readyState !== WebSocket.OPEN || player.id === null) return;
  const pos = controls.getObject().position;
  const rotY = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y;
  ws.send(
    JSON.stringify({
      type: "state",
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rotY,
      weapon: player.ammo.weaponKey,
    })
  );
}

if (startBtn) {
  startBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    paused = false;
    myNickname = nicknameInput.value.trim() || "Player";
    player.nickname = myNickname;
    player.loadout = { primary: selectedPrimary, secondary: selectedSecondary, melee: "knife" };
    player.map = selectedMap;
    player.currentSlot = "primary";
    primeAudio();
    resetAmmoForLoadout(true);
    updateProfileUI();
    killfeedItems.length = 0;
    killfeed.innerHTML = "";
    clearRemotePlayers();
    playersSnapshot.clear();
    latestPlayers = [];
    updateScoreboard();
    drawMinimap();
    loadMap(selectedMap);
    menuMusic.pause();
    if (startScreen) {
      startScreen.classList.remove("active");
      startScreen.classList.add("hidden");
    }
    connect();
    controls.lock();
  });
}

nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (startBtn) startBtn.click();
  }
});

document.addEventListener("pointerlockchange", () => {
  if (controls.isLocked) {
    log("Pointer locked. Move with WASD, space to jump, click to shoot.");
  } else {
    log("Pointer released.");
  }
});

document.body.addEventListener("click", () => {
  primeAudio();
  if (!controls.isLocked && startScreen && startScreen.classList.contains("hidden")) {
    controls.lock();
  }
});

document.addEventListener("keydown", (e) => {
  switch (e.code) {
    case "KeyW":
      keys.forward = true;
      break;
    case "KeyS":
      keys.backward = true;
      break;
    case "KeyA":
      keys.left = true;
      break;
    case "KeyD":
      keys.right = true;
      break;
    case "Space":
      keys.jump = true;
      break;
    case "Tab":
      e.preventDefault();
      scoreboardVisible = true;
      updateScoreboard();
      break;
    case "KeyR":
      reload();
      break;
    case "Digit1":
      switchWeapon("primary");
      break;
    case "Digit2":
      switchWeapon("secondary");
      break;
    case "Digit3":
      switchWeapon("melee");
      break;
    case "KeyE":
      scoped = true;
      applyScope(true);
      break;
    case "KeyM":
      if (startScreen) {
        const showing = startScreen.classList.contains("active") && !startScreen.classList.contains("hidden");
        if (showing) {
          startScreen.classList.add("hidden");
          startScreen.classList.remove("active");
          paused = false;
          controls.lock();
          menuMusic.pause();
        } else {
          startScreen.classList.remove("hidden");
          startScreen.classList.add("active");
          paused = true;
          controls.unlock();
          menuMusic.play().catch(() => {});
        }
      }
      break;
    case "Escape":
      // Unlock pointer without reopening any menu.
      controls.unlock();
      break;
  }
});

document.addEventListener("keyup", (e) => {
  switch (e.code) {
    case "KeyW":
      keys.forward = false;
      break;
    case "KeyS":
      keys.backward = false;
      break;
    case "KeyA":
      keys.left = false;
      break;
    case "KeyD":
      keys.right = false;
      break;
    case "Space":
      keys.jump = false;
      break;
    case "Tab":
      e.preventDefault();
      scoreboardVisible = false;
      updateScoreboard();
      break;
    case "KeyE":
      scoped = false;
      applyScope(false);
      break;
  }
});

document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && controls.isLocked) {
    if (player.ammo.auto) {
      shoot();
      fireTimer = setInterval(() => shoot(), player.ammo.fireDelay);
    } else {
      shoot();
    }
  }
});

document.addEventListener("mouseup", (e) => {
  if (e.button === 0 && fireTimer) {
    clearInterval(fireTimer);
    fireTimer = null;
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setInterval(sendState, 50);

log("Set nickname, class, map, mode and press Play.");

function animate() {
  const delta = Math.min(0.05, clock.getDelta());
  updateMovement(delta);
  updateWeapon(delta);
  for (const entry of remotePlayers.values()) {
    if (entry.targetPos) {
      entry.mesh.position.lerp(entry.targetPos, Math.min(1, delta * 6));
    }
    if (typeof entry.rotTarget === "number") {
      const current = entry.mesh.rotation.y;
      const diff = ((entry.rotTarget - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      entry.mesh.rotation.y = current + diff * Math.min(1, delta * 6);
    }
  }
  // keep local snapshot fresh for minimap smoothness
  const me = playersSnapshot.get(player.id);
  if (me) {
    const pos = controls.getObject().position;
    me.x = pos.x;
    me.y = pos.y;
    me.z = pos.z;
    me.rotY = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y;
  }
  drawMinimap();
  pruneKillfeed();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
const weaponDefs = {
  AssaultRifle_1: {
    slot: "primary",
    name: "Assault Rifle 1",
    model: "AssaultRifle_1",
    damage: 28,
    fireDelay: 110,
    fireRate: 545,
    recoil: 0.012,
    mag: 30,
    magazineSize: 30,
    reserve: 180,
    reload: 2.5,
    reloadTime: 2.5,
    range: 120,
    bulletSpeed: 260,
    sound: "assault",
    soundFire: "assault",
    reloadSound: "assaultReload",
    soundReload: "assaultReload",
    auto: true,
    scoped: false,
  },
  AssaultRifle_2: {
    slot: "primary",
    name: "Assault Rifle 2",
    model: "AssaultRifle_2",
    damage: 30,
    fireDelay: 130,
    fireRate: 480,
    recoil: 0.013,
    mag: 30,
    magazineSize: 30,
    reserve: 180,
    reload: 2.7,
    reloadTime: 2.7,
    range: 125,
    bulletSpeed: 270,
    sound: "assault",
    soundFire: "assault",
    reloadSound: "assaultReload",
    soundReload: "assaultReload",
    auto: true,
    scoped: false,
  },
  AssaultRifle_3: {
    slot: "primary",
    name: "Assault Rifle 3",
    model: "AssaultRifle_3",
    damage: 38,
    fireDelay: 190,
    fireRate: 360,
    recoil: 0.018,
    mag: 28,
    magazineSize: 28,
    reserve: 168,
    reload: 2.9,
    reloadTime: 2.9,
    range: 135,
    bulletSpeed: 285,
    sound: "assault",
    soundFire: "assault",
    reloadSound: "assaultReload",
    soundReload: "assaultReload",
    auto: true,
    scoped: true,
  },
  Bullpup_1: {
    slot: "primary",
    name: "Bullpup 1",
    model: "Bullpup_1",
    damage: 30,
    fireDelay: 120,
    fireRate: 500,
    recoil: 0.007,
    mag: 25,
    magazineSize: 25,
    reserve: 175,
    reload: 2.6,
    reloadTime: 2.6,
    range: 140,
    bulletSpeed: 300,
    sound: "bullpup",
    soundFire: "bullpup",
    reloadSound: "bullpupReload",
    soundReload: "bullpupReload",
    auto: true,
    scoped: true,
  },
  Bullpup_2: {
    slot: "primary",
    name: "Bullpup 2",
    model: "Bullpup_2",
    damage: 32,
    fireDelay: 135,
    fireRate: 440,
    recoil: 0.008,
    mag: 25,
    magazineSize: 25,
    reserve: 175,
    reload: 2.7,
    reloadTime: 2.7,
    range: 145,
    bulletSpeed: 310,
    sound: "bullpup",
    soundFire: "bullpup",
    reloadSound: "bullpupReload",
    soundReload: "bullpupReload",
    auto: true,
    scoped: true,
  },
  Pistol_1: {
    slot: "secondary",
    name: "Pistol 1",
    model: "Pistol_1",
    damage: 14,
    fireDelay: 200,
    fireRate: 300,
    recoil: 0.002,
    mag: 15,
    magazineSize: 15,
    reserve: 90,
    reload: 1.6,
    reloadTime: 1.6,
    range: 70,
    bulletSpeed: 200,
    sound: "pistol",
    soundFire: "pistol",
    reloadSound: "pistolReload",
    soundReload: "pistolReload",
    auto: false,
    scoped: false,
  },
  Pistol_2: {
    slot: "secondary",
    name: "Pistol 2",
    model: "Pistol_2",
    damage: 16,
    fireDelay: 190,
    fireRate: 315,
    recoil: 0.0025,
    mag: 15,
    magazineSize: 15,
    reserve: 90,
    reload: 1.7,
    reloadTime: 1.7,
    range: 72,
    bulletSpeed: 205,
    sound: "pistol",
    soundFire: "pistol",
    reloadSound: "pistolReload",
    soundReload: "pistolReload",
    auto: false,
    scoped: false,
  },
  Pistol_3: {
    slot: "secondary",
    name: "Pistol 3",
    model: "Pistol_3",
    damage: 18,
    fireDelay: 210,
    fireRate: 285,
    recoil: 0.003,
    mag: 14,
    magazineSize: 14,
    reserve: 84,
    reload: 1.9,
    reloadTime: 1.9,
    range: 75,
    bulletSpeed: 210,
    sound: "pistol",
    soundFire: "pistol",
    reloadSound: "pistolReload",
    soundReload: "pistolReload",
    auto: false,
    scoped: false,
  },
  Pistol_4: {
    slot: "secondary",
    name: "Pistol 4",
    model: "Pistol_4",
    damage: 20,
    fireDelay: 230,
    fireRate: 260,
    recoil: 0.0035,
    mag: 12,
    magazineSize: 12,
    reserve: 72,
    reload: 2.0,
    reloadTime: 2.0,
    range: 78,
    bulletSpeed: 215,
    sound: "pistol",
    soundFire: "pistol",
    reloadSound: "pistolReload",
    soundReload: "pistolReload",
    auto: false,
    scoped: false,
  },
  Pistol_5: {
    slot: "secondary",
    name: "Pistol 5",
    model: "Pistol_5",
    damage: 22,
    fireDelay: 240,
    fireRate: 250,
    recoil: 0.004,
    mag: 12,
    magazineSize: 12,
    reserve: 72,
    reload: 2.0,
    reloadTime: 2.0,
    range: 80,
    bulletSpeed: 220,
    sound: "pistol",
    soundFire: "pistol",
    reloadSound: "pistolReload",
    soundReload: "pistolReload",
    auto: false,
    scoped: false,
  },
  Pistol_6: {
    slot: "secondary",
    name: "Pistol 6",
    model: "Pistol_6",
    damage: 24,
    fireDelay: 260,
    fireRate: 230,
    recoil: 0.0045,
    mag: 10,
    magazineSize: 10,
    reserve: 60,
    reload: 2.1,
    reloadTime: 2.1,
    range: 82,
    bulletSpeed: 225,
    sound: "pistol",
    soundFire: "pistol",
    reloadSound: "pistolReload",
    soundReload: "pistolReload",
    auto: false,
    scoped: false,
  },
  Revolver_1: {
    slot: "secondary",
    name: "Revolver 1",
    model: "Revolver_1",
    damage: 60,
    fireDelay: 550,
    fireRate: 140,
    recoil: 0.015,
    mag: 6,
    magazineSize: 6,
    reserve: 36,
    reload: 2.8,
    reloadTime: 2.8,
    range: 90,
    bulletSpeed: 240,
    sound: "revolver",
    soundFire: "revolver",
    reloadSound: "revolverReload",
    soundReload: "revolverReload",
    auto: false,
    scoped: false,
  },
  Revolver_2: {
    slot: "secondary",
    name: "Revolver 2",
    model: "Revolver_2",
    damage: 70,
    fireDelay: 620,
    fireRate: 120,
    recoil: 0.017,
    mag: 6,
    magazineSize: 6,
    reserve: 30,
    reload: 3.0,
    reloadTime: 3.0,
    range: 95,
    bulletSpeed: 245,
    sound: "revolver",
    soundFire: "revolver",
    reloadSound: "revolverReload",
    soundReload: "revolverReload",
    auto: false,
    scoped: false,
  },
  Revolver_3: {
    slot: "secondary",
    name: "Revolver 3",
    model: "Revolver_3",
    damage: 80,
    fireDelay: 700,
    fireRate: 100,
    recoil: 0.019,
    mag: 6,
    magazineSize: 6,
    reserve: 24,
    reload: 3.2,
    reloadTime: 3.2,
    range: 100,
    bulletSpeed: 250,
    sound: "revolver",
    soundFire: "revolver",
    reloadSound: "revolverReload",
    soundReload: "revolverReload",
    auto: false,
    scoped: false,
  },
  knife: {
    slot: "melee",
    name: "Knife",
    damage: 50,
    fireDelay: 700,
    fireRate: 85,
    mag: 1,
    magazineSize: 1,
    reserve: 0,
    reload: 0,
    reloadTime: 0,
    recoil: 0,
    range: 2.5,
    bulletSpeed: 0,
    sound: null,
    reloadSound: null,
    auto: false,
    scoped: false,
  },
};
function applyScope(state) {
  const def = weaponDefs[player.ammo.weaponKey];
  const applies = !!def?.scoped;
  if (!applies) {
    scoped = false;
    scopeOverlay.style.opacity = "0";
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    return;
  }
  if (state) {
    scopeOverlay.style.opacity = "1";
    camera.fov = scopedFov;
  } else {
    scopeOverlay.style.opacity = "0";
    camera.fov = baseFov;
  }
  camera.updateProjectionMatrix();
}
