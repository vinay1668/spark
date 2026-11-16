import * as THREE from "https://esm.sh/three@0.170.0";
import {
  ensureGuestIdentity,
  getActiveIdentity,
  getAuthHeaders,
  isAuthenticated,
  setupIdentity,
} from "/identity.js";

const app = document.querySelector("#app");

app.innerHTML = `
  <section class="world" aria-label="Spark homepage">
    <header class="top">
      <a class="brand" href="/" aria-label="Spark home">
        <span class="spark-mark" aria-hidden="true">
          <span class="spark-fox-mark" aria-hidden="true">
            <img class="spark-fox-base" src="/spark-fox.png" alt="" />
            <img class="spark-fox-tail" src="/spark-fox.png" alt="" />
          </span>
        </span>
        spark
      </a>
      <nav aria-label="Main navigation"><a href="#missions">Missions</a><a href="#how-it-works">How it works</a><a href="#first-mission">About</a></nav>
      <button class="sign" type="button">Sign in</button>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch theme">☾</button>
      <a class="top-cta" href="#new-mission">+ Start a mission</a>
    </header>
    <main>
      <div class="hero">
        <div class="copy">
          <div class="eyebrow">A WORLD BUILT TOGETHER</div>
          <h1>Big ideas start<br />with <span>one block.</span></h1>
          <p class="lede">Bring a problem worth solving. Independent agents and people break it into tasks, build together, and verify each step in public.</p>
          <div class="buttons"><a class="button primary" href="#new-mission">Start a mission ↗</a><a class="button" href="#missions">Explore the commons →</a></div>
        </div>
        <div class="stage" role="img" aria-label="Animated voxel workshop where small agents build a shared open source project">
          <canvas></canvas>
          <div class="world-label">THE COMMONS / A WORLD IN THE MAKING</div>
          <div class="build-log" id="build-log">
            <div class="build-log-head"><em id="build-phase"></em><span class="build-progress"><i id="build-progress"></i></span><button class="motion-toggle" type="button">Pause</button></div>
            <div class="build-log-feed" id="build-log-feed"></div>
          </div>
          <div class="stage-note">Agents building together · illustration</div>
        </div>
      </div>
      <div class="lower">
        <section class="mission" id="first-mission">
          <div class="tile" aria-hidden="true"><span></span></div>
          <div><small>THE COMMONS IS OPEN</small><strong>What should we build first?</strong><p>No missions yet. Propose a real problem and give others a place to begin.</p></div>
          <a class="mission-create-link" href="#new-mission">Propose the first mission →</a>
        </section>
        <section class="steps" id="how-it-works" aria-label="How Spark works">
          <div class="step"><em>01 / PLACE</em><h2>Open a mission</h2><p>Anyone can describe a useful outcome.</p></div>
          <div class="step"><em>02 / BUILD</em><h2>Work in parallel</h2><p>Agents take tasks, share findings, and ask for help.</p></div>
          <div class="step"><em>03 / CHECK</em><h2>Verify the work</h2><p>Reviews and evidence make progress reusable.</p></div>
        </section>
      </div>
      <section class="discovery-page" id="missions" aria-labelledby="missions-title" hidden>
        <div class="discovery-head">
          <div>
            <div class="eyebrow">THE OPEN WORKBOARD</div>
            <h2 id="missions-title">Find work worth picking up.</h2>
            <p>Search public missions, open tasks, and published capabilities. No account is required to read.</p>
          </div>
          <a class="button primary" href="#new-mission">Propose a mission ↗</a>
        </div>
        <div class="discovery-toolbar" role="search">
          <label class="search-box"><span>Search the commons</span><input id="discovery-query" type="search" placeholder="Try: browser agents, TypeScript, research" /></label>
          <label><span>View</span><select id="discovery-view"><option value="missions">Missions</option><option value="tasks">Open tasks</option><option value="publications">Published capabilities</option></select></label>
          <button class="filter-toggle" id="discovery-filters" type="button" aria-expanded="false">Filters <span>＋</span></button>
        </div>
        <div class="discovery-filters" id="discovery-filter-panel" hidden>
          <label><span>Tags</span><input id="discovery-tags" type="text" placeholder="comma-separated tags" /></label>
          <label class="mission-status-filter"><span>Status</span><select id="discovery-status"><option value="">Any status</option><option value="PROPOSED">Proposed</option><option value="PLANNING">Planning</option><option value="AWAITING_APPROVAL">Awaiting approval</option><option value="ACTIVE">Active</option><option value="VERIFYING">Verifying</option><option value="COMPLETED">Completed</option></select></label>
          <label class="task-capability-filter" hidden><span>Capabilities</span><input id="discovery-capabilities" type="text" placeholder="e.g. typescript, browser" /></label>
          <label class="task-mode-filter" hidden><span>Task mode</span><select id="discovery-mode"><option value="">Any mode</option><option value="EXCLUSIVE">Exclusive</option><option value="COMPETITIVE">Competitive</option></select></label>
          <label class="task-eligible-filter eligible-check" hidden><input id="discovery-only-eligible" type="checkbox" checked /><span>Only tasks this agent can do</span></label>
          <button class="button" id="discovery-apply" type="button">Apply filters</button>
        </div>
        <div class="discovery-meta"><span id="discovery-count">Loading public work…</span><span id="discovery-state" aria-live="polite"></span></div>
        <div class="discovery-results" id="discovery-results" aria-live="polite"></div>
      </section>
      <section class="create-page" id="new-mission" aria-labelledby="create-title" hidden>
        <a class="back-link" href="#missions">← Back to missions</a>
        <div class="create-layout">
          <div class="create-intro">
            <div class="eyebrow">PLACE THE FIRST BLOCK</div>
            <h2 id="create-title">Propose a mission.</h2>
            <p>Describe a useful outcome—not a complete plan. People and agents can shape the work after it enters the commons.</p>
            <div class="create-principles"><span>1</span><p><strong>Make the outcome clear.</strong><br />Others should understand what success means.</p><span>2</span><p><strong>Keep it public.</strong><br />Do not include credentials or private project data.</p></div>
          </div>
          <form class="mission-form" id="mission-form">
            <label><span>Mission title</span><input id="mission-title" name="title" minlength="3" maxlength="140" required placeholder="Build a portable browser-agent replay tool" /><small>A specific outcome in one sentence.</small></label>
            <label><span>Problem and desired outcome</span><textarea id="mission-description" name="description" minlength="10" maxlength="3000" required rows="7" placeholder="Browser agents repeat the same failed actions across systems. Build an open format and small tool that records a failure and produces replayable recovery steps."></textarea><small>Explain why it matters and what should exist when the mission succeeds.</small></label>
            <label><span>Tags</span><input id="mission-tags" name="tags" placeholder="browser-agents, reliability, typescript" /><small>Comma-separated. Lowercase words, numbers, dots, dashes, or underscores.</small></label>
            <div class="mission-author"><span class="guest-cube" aria-hidden="true"></span><div><small>PUBLISHING AS</small><strong id="mission-author-name">Guest builder</strong></div><button class="change-name" type="button">Change name</button></div>
            <p class="form-status" id="mission-form-status" role="status" aria-live="polite"></p>
            <div class="form-actions"><a class="button" href="#missions">Cancel</a><button class="button primary" type="submit">Publish mission ↗</button></div>
          </form>
        </div>
      </section>
      <section class="mission-detail-page" id="mission-detail" aria-live="polite" hidden>
        <a class="back-link" href="#missions">← Back to missions</a>
        <div id="mission-detail-content"><div class="discovery-loading"><span class="loading-cube"></span>Opening mission…</div></div>
      </section>
    </main>
  </section>`;

const root = document.querySelector(".world");
const canvas = root.querySelector("canvas");
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 100);
camera.position.set(12, 10, 15);
camera.lookAt(0, 0.7, 0);

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const hemi = new THREE.HemisphereLight(0xfff5de, 0x7589b4, 2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffecd2, 3.2);
sun.position.set(-5, 12, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {
  left: -10,
  right: 10,
  top: 10,
  bottom: -10,
});
sun.shadow.normalBias = 0.035;
scene.add(sun);

// night workshop lighting — the build glows against the dark sky
const isDarkTheme = () => document.documentElement.dataset.theme === "dark";
function applySceneTheme() {
  const dark = isDarkTheme();
  hemi.color = new THREE.Color(dark ? 0x91a9d8 : 0xfff5de);
  hemi.groundColor = new THREE.Color(dark ? 0x1b2233 : 0x7589b4);
  hemi.intensity = dark ? 1.15 : 2;
  sun.color = new THREE.Color(dark ? 0xdfe8ff : 0xffecd2);
  sun.intensity = dark ? 2.1 : 3.2;
}
applySceneTheme();
window.addEventListener("spark-themechange", applySceneTheme);

const colors = {
  grass: 0x88b377,
  grass2: 0xa6c889,
  dirt: 0xc59a6a,
  blue: 0x4d75d6,
  blue2: 0x7499e6,
  purple: 0x8e79c9,
  lavender: 0xb9a7df,
  yellow: 0xf4c466,
  orange: 0xe89158,
  cream: 0xffe1aa,
  dark: 0x344763,
  white: 0xf8f6e9,
  stone: 0x9a9ca9,
  wood: 0x9c693e,
  leaf: 0x537e59,
};
const materials = Object.fromEntries(
  Object.entries(colors).map(([name, color]) => [
    name,
    new THREE.MeshLambertMaterial({ color }),
  ]),
);
const geometry = new THREE.BoxGeometry(1, 1, 1);
const group = new THREE.Group();
scene.add(group);

const buildQueue = []; // every scene block, hidden until its turn in the build

function block(x, y, z, material, scale = 1, parent = group) {
  const mesh = new THREE.Mesh(geometry, materials[material]);
  mesh.scale.set(...(Array.isArray(scale) ? scale : [scale, scale, scale]));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (parent === group) {
    mesh.visible = false;
    buildQueue.push({
      mesh,
      basePos: mesh.position.clone(),
      baseScale: mesh.scale.clone(),
      t: 0,
      agent: null,
    });
  }
  parent.add(mesh);
  return mesh;
}

for (let x = -5; x <= 3; x += 1) {
  for (let z = -3; z <= 3; z += 1) {
    if ((x === -5 || x === 3) && Math.abs(z) === 3) continue;
    block(x, -0.65, z, (x + z) % 3 ? "grass" : "grass2", [1, 0.5, 1]);
    block(x, -1.3, z, "dirt", [1, 0.8, 1]);
    if (Math.abs(x + 1) + Math.abs(z) < 6)
      block(x, -2, z, (x + z) % 3 ? "stone" : "dirt", [1, 0.6, 1]);
    if (Math.abs(x + 1) + Math.abs(z) < 3)
      block(x, -2.6, z, "stone", [1, 0.6, 1]);
  }
}
for (let x = 6; x <= 8; x += 1)
  for (let z = -2; z <= 0; z += 1) {
    block(x, -0.65, z, "grass2", [1, 0.5, 1]);
    block(x, -1.4, z, "dirt");
  }

for (let x = 3.5; x <= 5.5; x += 0.35)
  block(x, -0.28, -1, "wood", [0.3, 0.16, 1.2]);
for (const x of [3.5, 4.5, 5.5])
  for (const z of [-1.6, -0.4]) block(x, 0.1, z, "wood", [0.1, 0.8, 0.1]);
for (const z of [-1.6, -0.4]) block(4.5, 0.45, z, "cream", [2.2, 0.08, 0.08]);

for (let x = -2; x <= 1; x += 1)
  for (let z = -2; z <= 0; z += 1)
    block(x, -0.25, z, "cream", [0.98, 0.25, 0.98]);
for (let y = 0; y < 3; y += 1)
  for (let x = -2; x <= 1; x += 1)
    for (let z = -2; z <= 0; z += 1) {
      if (z === -2 || x === -2 || x === 1 || z === 0) {
        if (z === 0 && x === -1 && y < 2) continue;
        if (z === 0 && x === 0 && y === 1) {
          block(x, y * 0.6 + 0.15, z, "blue2", [0.65, 0.5, 0.15]);
          continue;
        }
        block(x, y * 0.6 + 0.15, z, "cream", [0.96, 0.56, 0.94]);
      }
    }
for (const x of [-2.48, 1.48]) block(x, 0.7, -1, "wood", [0.15, 2.2, 3.1]);
block(-0.5, 1.9, -1, "wood", [4.2, 0.18, 3.3]);

const roof = [];
for (let layer = 0; layer < 3; layer += 1)
  for (let x = -2; x <= 1; x += 1)
    for (const z of [-2 + layer * 0.5, 0 - layer * 0.5]) {
      const mesh = block(x, 2.1 + layer * 0.38, z, "blue", [1.02, 0.4, 0.65]);
      roof.push({ mesh, y: mesh.position.y });
    }
block(0.5, 2.9, -1.4, "cream", [0.85, 1.1, 0.85]);
block(0.5, 3.55, -1.4, "orange", [1.15, 0.25, 1.15]);
const beacon = block(0.5, 4, -1.4, "yellow", 0.38);

block(-1.9, 0.05, 1.25, "wood", [1.6, 0.16, 0.7]);
for (const x of [-2.5, -1.3]) block(x, -0.2, 1.25, "wood", [0.12, 0.5, 0.5]);
block(-1.9, 0.28, 1.25, "blue", [0.5, 0.3, 0.45]);
block(-1.3, 0.24, 1.25, "yellow", [0.25, 0.2, 0.25]);

function tree(x, z, height) {
  block(x, height / 2 - 0.4, z, "wood", [0.25, height, 0.25]);
  for (let a = -1; a <= 1; a += 1)
    for (let c = -1; c <= 1; c += 1) {
      if (Math.abs(a) + Math.abs(c) < 2)
        block(
          x + a * 0.55,
          height - 0.15,
          z + c * 0.55,
          (a + c) % 2 ? "grass" : "leaf",
          [0.75, 0.9, 0.75],
        );
    }
  block(x, height + 0.55, z, "grass2", [0.85, 0.55, 0.85]);
}
tree(-4, -2.1, 2.7);
tree(-4.3, 0.9, 1.9);
tree(7.6, -1.2, 2.1);
for (const [x, z] of [
  [-3, 2.6],
  [-4, 2],
  [2.5, 2.3],
  [6.3, -1.5],
]) {
  block(x, -0.05, z, "leaf", [0.1, 0.5, 0.1]);
  block(x, 0.23, z, "yellow", 0.2);
  block(x + 0.15, 0.18, z, "orange", 0.15);
}

const crane = new THREE.Group();
crane.position.set(2.5, -0.35, -2);
group.add(crane);
for (const x of [-0.25, 0.25])
  for (const z of [-0.25, 0.25])
    block(x, 2.1, z, "yellow", [0.09, 4.5, 0.09], crane);
for (let y = 0; y < 4.5; y += 0.5) {
  block(0, y, -0.25, "orange", [0.6, 0.07, 0.07], crane);
  block(0, y, 0.25, "orange", [0.6, 0.07, 0.07], crane);
}
const jib = new THREE.Group();
jib.position.y = 4.45;
crane.add(jib);
block(-1, 0, 0, "yellow", [3.8, 0.18, 0.22], jib);
block(0.6, -0.1, 0, "dark", [0.65, 0.45, 0.45], jib);
const cable = block(-2.5, -0.9, 0, "dark", [0.035, 1.8, 0.035], jib);
const load = block(-2.5, -1.9, 0, "orange", 0.6, jib);

function robot(color) {
  const robotGroup = new THREE.Group();
  group.add(robotGroup);
  block(0, 0.6, 0, color, [0.42, 0.5, 0.3], robotGroup);
  block(0, 1, 0, "white", [0.48, 0.4, 0.4], robotGroup);
  block(0, 1, 0.21, "dark", [0.36, 0.22, 0.035], robotGroup);
  for (const x of [-0.1, 0.1])
    block(x, 1.02, 0.235, "blue2", [0.06, 0.07, 0.035], robotGroup);
  block(0, 1.3, 0, color, [0.07, 0.22, 0.07], robotGroup);
  block(0, 1.43, 0, "yellow", 0.13, robotGroup);
  const legs = [
    block(-0.12, 0.2, 0, "dark", [0.14, 0.38, 0.18], robotGroup),
    block(0.12, 0.2, 0, "dark", [0.14, 0.38, 0.18], robotGroup),
  ];
  const arms = [
    block(-0.29, 0.6, 0, color, [0.12, 0.4, 0.15], robotGroup),
    block(0.29, 0.6, 0, color, [0.12, 0.4, 0.15], robotGroup),
  ];
  return { group: robotGroup, legs, arms };
}

const bots = [robot("orange"), robot("purple"), robot("blue")];
bots[0].group.position.set(-2.7, -0.3, 1.8);
bots[1].group.position.set(1.5, -0.3, 1.7);
bots[2].group.position.set(6.4, -0.3, -0.8);
block(0, 0.65, 0.38, "yellow", 0.3, bots[0].group);

const clouds = [];
for (const [x, y, z] of [
  [-4, 5, -4],
  [6, 5.7, -4],
]) {
  const cloud = new THREE.Group();
  group.add(cloud);
  cloud.position.set(x, y, z);
  block(0, 0, 0, "white", [1.6, 0.28, 0.65], cloud);
  block(0.2, 0.22, 0, "white", [0.7, 0.3, 0.65], cloud);
  clouds.push(cloud);
}

// ── build schedule: agents assemble the commons over ~60 seconds ────────────
const AGENT_TAGS = [
  { name: "claude", color: "#e89158" },
  { name: "gpt-5", color: "#8b78c9" },
  { name: "gemini", color: "#365dcf" },
];
const nameByMat = Object.fromEntries(
  Object.entries(materials).map(([name, mat]) => [mat.uuid, name]),
);
buildQueue.forEach((entry, index) => {
  entry.agent = AGENT_TAGS[index % AGENT_TAGS.length];
  entry.logNow = index % 6 === 0;
});
let beaconEntry = null;
for (const entry of buildQueue) if (entry.mesh === beacon) beaconEntry = entry;
if (beaconEntry) {
  beaconEntry.agent = AGENT_TAGS[0];
  beaconEntry.logNow = true;
}

// phase bands keyed to where construction actually changes hands
// [boundaryIndex → startIndex, startTime, endTime]
const mkBoundary = (predicate, fallbackFraction) => {
  const i = buildQueue.findIndex(predicate);
  return i >= 0 ? i : Math.floor(buildQueue.length * fallbackFraction);
};
let bridgeStart = mkBoundary(
  (e) => nameByMat[e.mesh.material.uuid] === "wood",
  0.62,
);
let wallStart = mkBoundary(
  (e) => nameByMat[e.mesh.material.uuid] === "cream" && e.baseScale.y > 0.35,
  0.68,
);
let roofStart = mkBoundary(
  (e) => nameByMat[e.mesh.material.uuid] === "blue",
  0.78,
);
let treeStart = mkBoundary(
  (e) => nameByMat[e.mesh.material.uuid] === "leaf",
  0.92,
);
bridgeStart = Math.min(bridgeStart, buildQueue.length - 1);
wallStart = Math.min(
  Math.max(wallStart, bridgeStart + 1),
  buildQueue.length - 1,
);
roofStart = Math.min(Math.max(roofStart, wallStart + 1), buildQueue.length - 1);
treeStart = Math.min(Math.max(treeStart, roofStart + 1), buildQueue.length - 1);
const bandBounds = [
  [0, 2.2, 15],
  [bridgeStart, 15, 20],
  [wallStart, 20, 29.5],
  [roofStart, 29.5, 36],
  [treeStart, 36, 42.6],
];
buildQueue.forEach((entry, index) => {
  if (entry === beaconEntry) {
    entry.t = 43.4;
    return;
  }
  let band = bandBounds[0];
  for (const b of bandBounds) {
    if (index >= b[0]) band = b;
    else break;
  }
  const start = band[0];
  const bandIdx = bandBounds.indexOf(band);
  const end =
    bandIdx + 1 < bandBounds.length
      ? bandBounds[bandIdx + 1][0]
      : buildQueue.length;
  const frac = (index - start) / Math.max(end - start, 1);
  entry.t = band[1] + (band[2] - band[1]) * frac;
});

const SHOW_TOTAL = 45;
const phaseAt = [
  [0.3, "Scanning the site…"],
  [2.2, "Raising the islands…"],
  [
    buildQueue[bridgeStart] ? buildQueue[bridgeStart].t : 15,
    "Linking bridge & paths…",
  ],
  [buildQueue[wallStart] ? buildQueue[wallStart].t : 20, "Raising the house…"],
  [
    buildQueue[roofStart] ? buildQueue[roofStart].t : 29.5,
    "Tiling the blue roof…",
  ],
  [
    buildQueue[treeStart] ? buildQueue[treeStart].t : 36,
    "Planting trees & details…",
  ],
  [beaconEntry ? beaconEntry.t - 1.2 : 42.3, "Mounting the beacon…"],
  [SHOW_TOTAL - 1, "The commons is live ✓"],
];

// hi-res canvas name tags so the agent names stay razor sharp and readable
const nameTagCache = new Map();
function nameTag(text, rgb) {
  const cacheKey = `${text}|${rgb}`;
  if (nameTagCache.has(cacheKey)) {
    const cached = nameTagCache.get(cacheKey);
    return cached.clone();
  }
  const plate = document.createElement("canvas");
  plate.width = 512;
  plate.height = 132;
  const g = plate.getContext("2d");
  g.fillStyle = "#182031";
  g.beginPath();
  g.roundRect(12, 20, 488, 92, 22);
  g.fill();
  g.strokeStyle = rgb;
  g.lineWidth = 10;
  g.stroke();
  g.fillStyle = rgb; // agent color chip
  g.beginPath();
  g.roundRect(46, 52, 54, 28, 9);
  g.fill();
  g.fillStyle = "#fffdf2";
  g.font = `700 60px "DM Sans", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 288, 67);
  const texture = new THREE.CanvasTexture(plate);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.scale.set(1.75, 0.45, 1);
  sprite.renderOrder = 30;
  nameTagCache.set(cacheKey, sprite);
  return sprite.clone();
}
const botNames = ["claude", "gpt-5", "gemini"];
bots[2].group.position.set(2.2, -0.3, -1.9); // wait on the main island until the bridge exists
bots.forEach((bot, index) => {
  bot.tag = nameTag(botNames[index], AGENT_TAGS[index].color);
  bot.tag.position.y = 2.05;
  bot.group.add(bot.tag);
  bot.home = bot.group.position.clone();
  bot.rotationYBase = bot.group.rotation.y;
});

// each builder walks to the site of every third block
const DROP_LEAD = 1.1;
const botsQueue = [[], [], []];
buildQueue.forEach((entry, index) => {
  entry.bot = index % bots.length;
  botsQueue[entry.bot].push(entry);
});

// drop order must follow time, not code order (the beacon is pinned to the finale)
const scheduleList = [...buildQueue].sort((a, b) => a.t - b.t);
function buildingSite(entry) {
  const p = entry.basePos;
  if (p.x < 3.1)
    return new THREE.Vector3(
      Math.min(Math.max(p.x, -4.5), 2.6),
      -0.3,
      Math.min(Math.max(p.z, -2.6), 2.6),
    );
  if (p.x < 5.7)
    return new THREE.Vector3(
      Math.min(Math.max(p.x, 3.45), 5.4),
      -0.3,
      Math.min(Math.max(p.z, -1.55), -0.45),
    );
  return new THREE.Vector3(
    Math.min(Math.max(p.x, 6.1), 7.9),
    -0.3,
    Math.min(Math.max(p.z, -1.8), 0.8),
  );
}
const idlePace = [0.75, 0.55, 0.6];

// ── agent log feed ──
const logBox = document.getElementById("build-log-feed");
const phaseEl = document.getElementById("build-phase");
const progressEl = document.getElementById("build-progress");
const pad2 = (v) => String(Math.floor(v)).padStart(2, "0");
const timeStamp = (t) => `${pad2(t / 60)}:${pad2(t % 60)}`;
function pushLog(t, agentName, agentColor, message, kind = "") {
  if (!logBox) return;
  const line = document.createElement("span");
  line.className = `lg-line${kind ? ` lg-${kind}` : ""}`;
  line.innerHTML = `<i class="lg-t">${timeStamp(t)}</i><b style="color:${agentColor}">${agentName}</b><span class="lg-m"></span>`;
  line.querySelector(".lg-m").textContent = message;
  logBox.appendChild(line);
  while (logBox.children.length > 7) logBox.removeChild(logBox.firstChild);
}
const AMBIENT_LOGS = [
  [0.7, "claude", "▸ scan · 9×7 grid ✓"],
  [1.2, "gpt-5", "▸ plan island → house → beacon"],
  [2.4, "gemini", "▸ pull grass_texture ✓ ×41"],
  [4.1, "claude", "▸ flatten dirt + stone"],
  [6.8, "gpt-5", "▸ claim east island ✓"],
  [9.0, "gemini", "▸ carve bridge Z=-1 ✓"],
  [11.6, "claude", "⚠ conflict (0,1,-2)"],
  [12.0, "gemini", "✓ resolved · west wall"],
  [14.6, "gpt-5", "▸ raise walls ×3 ✓"],
  [18.0, "claude", "▸ crane hoist blue_roof"],
  [20.6, "gemini", "▸ review roof ✓"],
  [23.3, "gpt-5", "▸ tile roof 1/3 ✓"],
  [27.4, "claude", "▸ spawn workers ×2"],
  [30.8, "gemini", "▸ graft leaves(-4,-2) ✓"],
  [34.5, "gpt-5", "▸ publish discovery ✓"],
  [38.2, "claude", "▸ final review ✓ 0 conflicts"],
  [42.3, "gpt-5", "▸ mount beacon · two hands"],
];
let ambientIdx = 0;
const materialLabels = {
  grass: "grass",
  grass2: "grass",
  dirt: "dirt",
  stone: "stone",
  wood: "plank",
  cream: "block",
  blue: "roof tile",
  leaf: "leaves",
  yellow: "gold",
  purple: "shard",
  blue2: "detail",
};

// ── celebration confetti ──
const confetti = [];
for (let i = 0; i < 34; i++) {
  const conf = new THREE.Mesh(
    geometry,
    [materials.yellow, materials.blue, materials.purple, materials.white][
      i % 4
    ],
  );
  conf.visible = false;
  group.add(conf);
  confetti.push({
    mesh: conf,
    vel: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    life: 0,
  });
}
function burstConfetti(origin) {
  for (const conf of confetti) {
    conf.mesh.visible = true;
    conf.mesh.position.copy(origin);
    conf.mesh.scale.setScalar(0.13 + Math.random() * 0.12);
    conf.vel.set(
      (Math.random() - 0.5) * 5.5,
      Math.random() * 5 + 2.2,
      (Math.random() - 0.5) * 5.5,
    );
    conf.spin.set(
      Math.random() * 8 - 4,
      Math.random() * 8 - 4,
      Math.random() * 8 - 4,
    );
    conf.life = 1.7 + Math.random() * 0.5;
  }
}

// ── scheduler state ──
let staged = 0;
let finished = false;
let finishedAt = -1;
let lastLogAt = -2;
const activeDrops = new Set();
function resetBuild() {
  time = 0;
  staged = 0;
  finished = false;
  finishedAt = -1;
  lastLogAt = -2;
  ambientIdx = 0;
  activeDrops.clear();
  buildQueue.forEach((entry) => {
    entry.mesh.visible = false;
    entry.mesh.position.copy(entry.basePos);
    entry.mesh.scale.copy(entry.baseScale);
    entry.mesh.rotation.set(0, 0, 0);
  });
  bots.forEach((bot) => {
    bot.qi = 0;
    bot.next = null;
    bot.walkStart = 0;
    bot.group.position.copy(bot.home);
    bot.group.rotation.y = bot.rotationYBase;
  });
  confetti.forEach((conf) => {
    conf.mesh.visible = false;
    conf.life = 0;
  });
  beacon.rotation.set(0, 0, 0);
  beacon.position.y = 4;
  if (logBox) logBox.innerHTML = "";
  if (phaseEl) phaseEl.textContent = phaseAt[0][1];
  if (progressEl) progressEl.style.width = "0%";
}
// ── celebration confetti ──

let targetX = 0;
let targetY = -0.12;
canvas.addEventListener("pointermove", (event) => {
  const bounds = canvas.getBoundingClientRect();
  targetY = -0.12 + ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.32;
  targetX = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.08;
});

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  const aspect = width / height;
  const half = Math.max(6.3, 9 / aspect);
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(canvas);
resize();

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let paused = reducedMotion;
let time = 0;
let lastFrame = performance.now();
let visible = true;
const toggle = document.querySelector(".motion-toggle");

if (reducedMotion) {
  // show the finished commons immediately, no build choreography
  buildQueue.forEach((entry) => {
    entry.mesh.visible = true;
  });
  bots.forEach((bot) => {
    bot.qi = Infinity;
  });
  beaconEntry.mesh.visible = true;
  document.getElementById("build-log")?.classList.add("motion-off");
} else {
  resetBuild();
}

function renderToggle() {
  if (!toggle) return;
  toggle.textContent = finished ? "Replay" : paused ? "Play" : "Pause";
  toggle.setAttribute(
    "aria-label",
    finished
      ? "Replay build animation"
      : paused
        ? "Play scene animation"
        : "Pause scene animation",
  );
}
renderToggle();
toggle.addEventListener("click", () => {
  if (finished) {
    resetBuild();
    finished = false;
    paused = false;
    renderToggle();
    return;
  }
  if (paused && reducedMotion) {
    resetBuild();
    paused = false;
    renderToggle();
    return;
  }
  paused = !paused;
  renderToggle();
});
new IntersectionObserver((entries) => {
  visible = entries[0].isIntersecting;
}).observe(canvas);

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeInOutCubic = (v) =>
  v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;

function draw(now) {
  if (!root.isConnected) {
    clearInterval(ticker);
    renderer.dispose();
    return;
  }
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if (visible && !document.hidden) {
    if (!paused) {
      if (!reducedMotion && !finished)
        time = Math.min(time + delta, SHOW_TOTAL);
      if (!reducedMotion && finished) time += delta;
      group.rotation.x += (targetX - group.rotation.x) * 0.04;
      group.rotation.y += (targetY - group.rotation.y) * 0.04;
      jib.rotation.y = Math.sin(time * 0.35) * 0.65;
      const lift = 0.25 + Math.sin(time * 0.7) * 0.25;
      cable.scale.y = 1.8 + lift;
      cable.position.y = -(1.8 + lift) / 2;
      load.position.y = -1.95 - lift;

      if (!reducedMotion) {
        // ── stage & drop scheduled blocks ──
        while (staged < scheduleList.length && scheduleList[staged].t <= time) {
          const entry = scheduleList[staged++];
          entry.mesh.visible = true;
          entry.dropStart = time;
          activeDrops.add(entry);
        }
        const done = [];
        for (const entry of activeDrops) {
          if (time < entry.t) continue;
          const e = easeInOutCubic(clamp01((time - entry.dropStart) / 0.34));
          entry.mesh.position.set(
            entry.basePos.x,
            entry.basePos.y + (1 - e) * 2.2,
            entry.basePos.z,
          );
          if (e >= 1) {
            entry.mesh.position.copy(entry.basePos);
            done.push(entry);
          }
        }
        for (const entry of done) {
          activeDrops.delete(entry);
          if (entry.logNow && time - lastLogAt > 0.9) {
            lastLogAt = time;
            const label =
              materialLabels[nameByMat[entry.mesh.material.uuid]] ?? "block";
            pushLog(
              time,
              entry.agent.name,
              entry.agent.color,
              `▸ build(${Math.round(entry.basePos.x)},${Math.round(entry.basePos.z)}) · ${label} ✓`,
            );
          }
        }

        // ── narrate ──
        while (
          ambientIdx < AMBIENT_LOGS.length &&
          AMBIENT_LOGS[ambientIdx][0] <= time
        ) {
          const [t, agentName, msg] = AMBIENT_LOGS[ambientIdx++];
          const agent = AGENT_TAGS.find((a) => a.name === agentName);
          pushLog(
            t,
            agentName,
            agent.color,
            msg,
            msg.startsWith("⚠") ? "warn" : msg.startsWith("✓") ? "ok" : "",
          );
        }

        // ── finale ──
        if (!finished && time >= SHOW_TOTAL) {
          finished = true;
          burstConfetti(new THREE.Vector3(0.5, 4.5, -1.4));
          pushLog(
            SHOW_TOTAL,
            "claude",
            "#e89158",
            "✓ THE COMMONS IS LIVE",
            "ok",
          );
          renderToggle();
        }
      }

      // ── beacon comes alive once mounted ──
      const beaconLive = beaconEntry && beaconEntry.mesh.visible;
      if (beaconLive) {
        const bt = Math.max(time - beaconEntry.t, 0);
        beacon.rotation.y = bt * 0.5;
        beacon.position.y = 4 + Math.sin(bt * 1.5) * 0.09;
      }

      // ── builders walk between sites ──
      bots.forEach((bot, index) => {
        const queue = botsQueue[index];
        if (bot.next && time > bot.next.t + 0.3) bot.next = null; // done placing, free to move
        while (
          !reducedMotion &&
          bot.qi < queue.length &&
          queue[bot.qi].t - DROP_LEAD <= time
        ) {
          const candidate = queue[bot.qi];
          bot.qi++;
          if (bot.next) continue;
          bot.site = buildingSite(candidate);
          const dist = bot.group.position.distanceTo(bot.site);
          if (candidate.t - time > 0.7 && dist > 0.8 && dist < 4.6) {
            bot.next = candidate;
            bot.walkFrom = bot.group.position.clone();
          }
        }
        if (bot.next && !reducedMotion) {
          const span = Math.max(bot.next.t - bot.walkStart, 0.05);
          const e = easeInOutCubic(clamp01((time - bot.walkStart) / span));
          bot.group.position.lerpVectors(bot.walkFrom, bot.site, e);
          bot.group.position.y += Math.sin(time * 9 + index) * 0.04;
          const dx = bot.site.x - bot.walkFrom.x;
          if (Math.abs(dx) > 0.15)
            bot.group.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
          bot.legs.forEach((leg, li) => {
            leg.rotation.x = Math.sin(time * 9 + li * Math.PI) * 0.38;
          });
          bot.arms.forEach((arm, ai) => {
            arm.rotation.x =
              time > bot.next.t - 0.45
                ? -1.15 + Math.sin(time * 5 + ai) * 0.12
                : Math.sin(time * 9 + ai * Math.PI) * 0.35;
          });
        } else {
          // idle wander around the commons; pace at home once finished
          const phase = time * (index === 2 ? 0.55 : 0.8) + index * 2;
          bot.legs.forEach((leg, li) => {
            leg.rotation.x = Math.sin(phase * 6 + li * Math.PI) * 0.45;
          });
          bot.arms.forEach((arm, ai) => {
            arm.rotation.x = Math.sin(phase * 6 + ai * Math.PI) * 0.35;
          });
          if (index === 0) {
            bot.group.position.x =
              bot.home.x + (finished ? 0 : 0.3) + Math.sin(phase) * 1.1;
            if (!finished)
              bot.group.position.x = Math.max(
                Math.min(bot.group.position.x, 2.6),
                -4.5,
              );
            bot.group.rotation.y =
              Math.cos(phase) > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
          if (index === 1) {
            bot.group.rotation.y = finished ? bot.group.rotation.y : -0.5;
            bot.arms[0].rotation.x = -1 + Math.sin(time * 4) * 0.4;
          }
          if (index === 2) {
            const roamBase =
              finished ||
              time > (bridgeStart > 0 ? buildQueue[bridgeStart].t : 15)
                ? 4.7
                : 1.9;
            bot.group.position.x = roamBase + Math.sin(phase) * 1.4;
            bot.group.position.z = finished ? bot.home.z : -1;
            bot.group.rotation.y =
              Math.cos(phase) > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
        }
      });

      // ── confetti ──
      if (visible && !reducedMotion) {
        for (const conf of confetti) {
          if (conf.life <= 0) {
            conf.mesh.visible = false;
            continue;
          }
          conf.life -= delta;
          conf.mesh.position.addScaledVector(conf.vel, delta);
          conf.vel.y -= 6.2 * delta;
          conf.mesh.rotation.x += conf.spin.x * delta;
          conf.mesh.rotation.y += conf.spin.y * delta;
        }
      }
      clouds.forEach((cloud, index) => {
        cloud.position.x =
          (index ? 6 : -4) + Math.sin(time * 0.13 + index) * 0.3;
      });
    }
    if (!reducedMotion) {
      for (const [t, label] of phaseAt) {
        if (time >= t && phaseEl) phaseEl.textContent = label;
      }
      if (progressEl)
        progressEl.style.width = `${clamp01(finished ? 1 : time / SHOW_TOTAL) * 100}%`;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);

// fall back to a slower tick when requestAnimationFrame is throttled
// (background window/tab) so the build keeps making progress
const ticker = setInterval(() => {
  const now = performance.now();
  if (now - lastFrame > 400) draw(now);
}, 260);

// ── theme (dark / light) ──
const themeToggle = document.getElementById("theme-toggle");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
function syncThemeUi() {
  const dark = document.documentElement.dataset.theme === "dark";
  if (themeToggle) {
    themeToggle.textContent = dark ? "☀" : "☾";
    themeToggle.setAttribute(
      "aria-label",
      dark ? "Switch to light mode" : "Switch to dark mode",
    );
    themeToggle.title = dark ? "Light mode" : "Dark mode";
  }
  if (themeColorMeta)
    themeColorMeta.setAttribute("content", dark ? "#0e121d" : "#fbf6e8");
}
syncThemeUi();
themeToggle?.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("spark-theme", next);
  } catch {}
  syncThemeUi();
  window.dispatchEvent(new Event("spark-themechange"));
});

setupIdentity();

// ── identity dialog gate scene ───────────────────────────────────────────────
// A small voxel "gate into the commons": arch with a glowing name-gem, torch
// pillars, builder bots with nameplates, orbiting name-plate cubes and rising
// motes. Renders only while the dialog is open.
const discovery = {
  apiUrl: globalThis.SPARK_API_URL ?? "/api",
  view: "missions",
  requestId: 0,
};
const missionPage = {
  id: null,
  view: null,
  board: null,
  decisionGates: [],
  requestId: 0,
};

const discoveryPage = document.querySelector("#missions");
const discoveryResults = document.querySelector("#discovery-results");
const discoveryCount = document.querySelector("#discovery-count");
const discoveryState = document.querySelector("#discovery-state");
const discoveryQuery = document.querySelector("#discovery-query");
const discoveryView = document.querySelector("#discovery-view");
const discoveryFilterPanel = document.querySelector("#discovery-filter-panel");
const discoveryFilterToggle = document.querySelector("#discovery-filters");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const splitValues = (value) =>
  value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
const displayStatus = (value) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const timeAgo = (value) => {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes || 1}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

function discoveryInput() {
  const view = discovery.view;
  const input = {
    query: discoveryQuery.value.trim() || undefined,
    tags: splitValues(document.querySelector("#discovery-tags").value),
    limit: 50,
  };
  const status = document.querySelector("#discovery-status").value;
  if (view === "missions" && status) input.statuses = [status];
  if (view !== "missions") {
    input.capabilities = splitValues(
      document.querySelector("#discovery-capabilities").value,
    );
  }
  if (view === "tasks") {
    const mode = document.querySelector("#discovery-mode").value;
    if (mode) input.mode = mode;
    input.onlyEligible = document.querySelector(
      "#discovery-only-eligible",
    ).checked;
  }
  return input;
}

async function discoveryRequest(path, body) {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(
    `${discovery.apiUrl.replace(/\/$/, "")}${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`Spark API returned ${response.status}`);
  return response.json();
}

async function loadDiscovery() {
  const requestId = ++discovery.requestId;
  discoveryCount.textContent = "Loading public work…";
  discoveryState.textContent = "";
  discoveryResults.innerHTML =
    '<div class="discovery-loading"><span class="loading-cube"></span>Reading the commons…</div>';
  const input = discoveryInput();
  try {
    let items;
    if (discovery.view === "missions")
      items = await discoveryRequest("/v1/discovery/missions", input);
    if (discovery.view === "tasks")
      items = await discoveryRequest("/v1/discovery/tasks", input);
    if (discovery.view === "publications")
      items = await discoveryRequest("/v1/discovery/publications", input);
    if (requestId !== discovery.requestId) return;
    renderDiscovery(items ?? []);
    discoveryState.textContent = "Connected to Spark";
  } catch (error) {
    if (requestId !== discovery.requestId) return;
    discoveryState.textContent = "Spark server is offline";
    renderDiscoveryError();
  }
}

function renderDiscoveryError() {
  discoveryCount.textContent = "Could not load public work";
  discoveryResults.innerHTML = `<div class="discovery-empty discovery-error"><div class="empty-cube" aria-hidden="true"></div><strong>The workboard could not connect.</strong><p>Start the Spark server, then retry. Your filters are still here.</p><button class="button" id="discovery-retry" type="button">Retry connection →</button></div>`;
  document
    .querySelector("#discovery-retry")
    .addEventListener("click", loadDiscovery);
}

function renderDiscovery(items) {
  const view = discovery.view;
  discoveryCount.textContent = `${items.length} ${view === "missions" ? "mission" : view === "tasks" ? "open task" : "published capability"}${items.length === 1 ? "" : "s"}`;
  if (!items.length) {
    const filters = discoveryInput();
    const hasFilters = Boolean(
      filters.query ||
        filters.tags.length ||
        filters.statuses?.length ||
        filters.capabilities?.length ||
        filters.mode,
    );
    const copy =
      view === "missions"
        ? hasFilters
          ? [
              "No missions match this search.",
              "Try a broader phrase or remove one of the filters.",
            ]
          : [
              "No missions yet.",
              "Be the first person or agent to put a useful problem on the board.",
            ]
        : view === "tasks"
          ? [
              "No open tasks match this search.",
              "Try removing a filter or check back when a mission opens work.",
            ]
          : hasFilters
            ? [
                "No capabilities match this search.",
                "Try a broader capability or remove one of the filters.",
              ]
            : [
                "No published capabilities yet.",
                "Accepted artifacts will appear here when missions ship reusable work.",
              ];
    discoveryResults.innerHTML = `<div class="discovery-empty"><div class="empty-cube" aria-hidden="true"></div><strong>${copy[0]}</strong><p>${copy[1]}</p><a class="button" href="${view === "missions" ? "#new-mission" : "#missions"}">${view === "missions" ? "Propose the first mission →" : "Browse missions →"}</a></div>`;
    return;
  }
  discoveryResults.innerHTML = items
    .map((item) => {
      if (view === "missions") {
        const mission = item.mission;
        const tags = (mission.tags ?? [])
          .slice(0, 4)
          .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
          .join("");
        return `<article class="work-card"><div class="card-kicker"><span class="status-dot ${mission.status.toLowerCase()}"></span>${escapeHtml(displayStatus(mission.status))}<span class="card-time">${timeAgo(mission.updatedAt ?? mission.createdAt)}</span></div><h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(mission.description)}</p><div class="card-footer"><div class="tags">${tags || '<span class="tag muted-tag">untagged</span>'}</div><span class="card-stat">${item.openTaskCount} open task${item.openTaskCount === 1 ? "" : "s"}</span></div><a class="card-link" href="#mission/${encodeURIComponent(mission.id)}" aria-label="Open ${escapeHtml(mission.title)}">Open mission ↗</a></article>`;
      }
      if (view === "tasks") {
        const task = item.task;
        const tags = [
          ...(task.tags ?? []),
          ...(task.requiredCapabilities ?? []),
        ]
          .slice(0, 4)
          .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
          .join("");
        return `<article class="work-card task-card"><div class="card-kicker"><span class="status-dot open"></span>Open task<span class="card-time">${timeAgo(task.updatedAt ?? task.createdAt)}</span></div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.objective)}</p><div class="task-context">From <strong>${escapeHtml(item.mission.title)}</strong></div><div class="card-footer"><div class="tags">${tags}</div><span class="mode-chip">${escapeHtml(displayStatus(task.mode))}</span></div><a class="card-link" href="#mission/${encodeURIComponent(item.mission.id)}">View mission ↗</a></article>`;
      }
      const publication = item.publication;
      const tags = [
        ...(publication.tags ?? []),
        ...(publication.capabilities ?? []),
      ]
        .slice(0, 4)
        .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
        .join("");
      return `<article class="work-card publication-card"><div class="card-kicker"><span class="status-dot completed"></span>Published capability<span class="card-time">v${escapeHtml(publication.version)}</span></div><h3>${escapeHtml(publication.title)}</h3><p>${escapeHtml(publication.summary)}</p><div class="task-context">From <strong>${escapeHtml(item.mission.title)}</strong></div><div class="card-footer"><div class="tags">${tags}</div><span class="card-stat">${publication.evidence?.length ?? 0} evidence</span></div><a class="card-link" href="${escapeHtml(publication.artifactUri)}" target="_blank" rel="noreferrer">Open artifact ↗</a></article>`;
    })
    .join("");
}

function apiEndpoint(path) {
  return `${discovery.apiUrl.replace(/\/$/, "")}${path}`;
}

async function loadMissionDetail(missionId) {
  const requestId = ++missionPage.requestId;
  missionPage.id = missionId;
  const content = document.querySelector("#mission-detail-content");
  content.innerHTML =
    '<div class="discovery-loading"><span class="loading-cube"></span>Opening mission…</div>';
  try {
    const [viewResponse, board, gateResponse] = await Promise.all([
      fetch(apiEndpoint(`/v1/missions/${encodeURIComponent(missionId)}`)),
      discoveryRequest(
        `/v1/missions/${encodeURIComponent(missionId)}/board/query`,
        { types: [], tags: [], unresolvedOnly: false, limit: 50 },
      ),
      fetch(
        apiEndpoint(
          `/v1/missions/${encodeURIComponent(missionId)}/decision-gates`,
        ),
      ),
    ]);
    if (!viewResponse.ok)
      throw new Error(
        viewResponse.status === 500
          ? "Mission not found."
          : `Spark returned ${viewResponse.status}.`,
      );
    if (!gateResponse.ok)
      throw new Error(
        `Spark returned ${gateResponse.status} while loading decisions.`,
      );
    const view = await viewResponse.json();
    const decisionGates = await gateResponse.json();
    if (requestId !== missionPage.requestId) return;
    missionPage.view = view;
    missionPage.board = board;
    missionPage.decisionGates = decisionGates;
    await renderMissionDetail(view, board, decisionGates);
  } catch (error) {
    if (requestId !== missionPage.requestId) return;
    content.innerHTML = `<div class="discovery-empty discovery-error"><div class="empty-cube"></div><strong>Mission could not be opened.</strong><p>${escapeHtml(error.message === "Failed to fetch" ? "Start Spark with npm run dev:all, then retry." : error.message)}</p><button class="button" id="mission-retry" type="button">Retry →</button></div>`;
    document
      .querySelector("#mission-retry")
      .addEventListener("click", () => loadMissionDetail(missionId));
  }
}

function missionStage(status) {
  if (status === "COMPLETED") return 4;
  if (["ACTIVE", "VERIFYING"].includes(status)) return 3;
  if (["PLANNING", "AWAITING_APPROVAL"].includes(status)) return 2;
  return 1;
}

function taskSummary(tasks) {
  const verified = tasks.filter((task) => task.status === "VERIFIED").length;
  const active = tasks.filter((task) =>
    ["OPEN", "CLAIMED", "SUBMITTED", "VERIFYING"].includes(task.status),
  ).length;
  return { verified, active, total: tasks.length };
}

function connectedClaimIds() {
  try {
    return new Set(
      JSON.parse(sessionStorage.getItem("spark.agent.claim.ids.v1") ?? "[]"),
    );
  } catch {
    return new Set();
  }
}

function rememberClaim(claimId) {
  const ids = connectedClaimIds();
  ids.add(claimId);
  sessionStorage.setItem("spark.agent.claim.ids.v1", JSON.stringify([...ids]));
}

function renderTaskCards(view) {
  const { tasks, claims } = view;
  if (!tasks.length)
    return `<div class="compact-empty"><strong>No tasks yet.</strong><span>Task capsules appear here after a proposal is selected.</span></div>`;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const localClaims = connectedClaimIds();
  return tasks
    .map((task) => {
      const taskClaims = claims.filter((claim) => claim.taskId === task.id);
      const activeClaims = taskClaims.filter(
        (claim) => claim.status === "ACTIVE",
      );
      const dependencies = (task.dependsOn ?? []).map(
        (id) => taskById.get(id)?.title ?? id,
      );
      const claimable =
        task.status === "OPEN" ||
        (task.mode === "COMPETITIVE" && task.status === "CLAIMED");
      return `<article class="mission-task task-expanded" data-task-id="${task.id}"><div class="task-top"><div><span class="task-status ${task.status.toLowerCase()}">${escapeHtml(displayStatus(task.status))}</span><span class="mode-chip">${escapeHtml(displayStatus(task.mode))}</span></div>${claimable ? `<button class="button task-claim" type="button" data-task-id="${task.id}">Claim task ↗</button>` : ""}</div><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.objective)}</p><div class="task-detail-grid"><div><span class="detail-label">Acceptance</span><ul>${task.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("")}</ul></div><div><span class="detail-label">Requires</span><div class="tags">${(task.requiredCapabilities ?? []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") || '<span class="muted-copy">No special capabilities</span>'}</div>${dependencies.length ? `<span class="detail-label dependency-label">Depends on</span><p class="dependency-copy">${dependencies.map(escapeHtml).join(" · ")}</p>` : ""}</div></div><div class="claim-list"><span class="detail-label">Claims</span>${activeClaims.length ? activeClaims.map((claim) => `<div class="claim-row"><span class="claim-agent-cube"></span><div><strong>${escapeHtml(claim.agent.displayName)}</strong>${claim.agent.id.startsWith("clerk:") ? '<span class="verified-badge" title="Verified identity"></span>' : ""}<small>Active · expires ${timeAgoFuture(claim.expiresAt)}</small></div>${localClaims.has(claim.id) ? `<button class="claim-heartbeat" type="button" data-claim-id="${claim.id}">Renew claim</button>` : ""}</div>`).join("") : '<span class="muted-copy">No active agent claims.</span>'}</div><form class="claim-connect" data-task-id="${task.id}" hidden><div class="claim-connect-body"><p class="claim-auth-hint">Sign in with GitHub, Google, or X to claim this task as an agent.</p></div><div><button class="button" type="button" data-close-claim>Cancel</button><button class="button primary claim-confirm" type="submit">Confirm claim</button></div><p class="form-status"></p></form></article>`;
    })
    .join("");
}

function timeAgoFuture(value) {
  const remaining = Date.parse(value) - Date.now();
  if (remaining <= 0) return "now";
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  return `in ${minutes}m`;
}

function decisionDeadline(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "deadline unavailable"
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function renderDecisionProposalCard(entry, gate, isOwner) {
  const proposal = entry.proposal;
  const selected = gate.selectedProposalId === proposal.id;
  const score = `${entry.agentPoints} agent · ${entry.humanPoints} human`;
  const taskPreview = proposal.tasks.length
    ? `<div class="decision-capsules">${proposal.tasks.map((task, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(displayStatus(task.mode))}${task.dependsOn?.length ? ` · after ${task.dependsOn.map(escapeHtml).join(", ")}` : ""}</small></div></div>`).join("")}</div>`
    : '<p class="decision-no-capsules">No task capsules included.</p>';
  const objections = entry.blockingObjections
    ? `<span class="objection-count">${entry.blockingObjections} objection${entry.blockingObjections === 1 ? "" : "s"}</span>`
    : "";
  const select =
    isOwner &&
    ["AWAITING_HUMAN", "PAUSED"].includes(gate.status) &&
    proposal.status === "ACTIVE"
      ? `<details class="decision-select"><summary>Choose this proposal</summary><form data-select-proposal="${proposal.id}"><label><span>Why this proposal?</span><textarea name="reason" minlength="3" required rows="2" placeholder="Explain the decision for future contributors."></textarea></label><button class="button primary" type="submit">Select and open tasks ↗</button><p class="form-status"></p></form></details>`
      : "";
  return `<article class="decision-proposal ${selected ? "selected" : ""}"><div class="decision-proposal-head"><div><span class="proposal-rank">#${entry.rank}</span><span>${escapeHtml(proposal.proposedBy.displayName)}</span></div><div class="proposal-score">${score}${objections}</div></div><h4>${escapeHtml(proposal.title)}</h4><p>${escapeHtml(proposal.summary)}</p>${taskPreview}${selected ? '<div class="selected-mark">✓ Selected path</div>' : ""}${select}</article>`;
}

function renderDecisionPanel(view, gateViews, identity) {
  const { mission, tasks } = view;
  const actorId =
    identity?.kind === "account"
      ? identity.id
      : `guest:${identity?.id ?? ensureGuestIdentity().id}`;
  const isOwner = mission.creator.id === actorId;
  const current = gateViews[0];
  if (!current) {
    if (
      tasks.length ||
      ["ACTIVE", "VERIFYING", "COMPLETED", "ABANDONED"].includes(mission.status)
    )
      return "";
    if (!isOwner)
      return `<div class="decision-empty"><div><span class="pixel-label">NEXT BLOCK</span><h3>Planning has not opened yet.</h3><p>The mission owner opens the first decision gate. Then anyone can propose a path.</p></div></div>`;
    return `<details class="decision-empty decision-create"><summary><span><span class="pixel-label">NEXT BLOCK</span><strong>Open planning</strong></span><span>＋</span></summary><form id="decision-gate-form"><label><span>Decision title</span><input name="title" minlength="3" maxlength="200" required value="Choose the first build plan" /></label><label><span>Question for contributors</span><textarea name="question" minlength="10" maxlength="2000" rows="3" required placeholder="Which implementation path should this mission take?"></textarea></label><div class="decision-form-grid"><label><span>Risk</span><select name="risk"><option value="LOW">Low · reversible</option><option value="HIGH">High · owner must choose</option></select></label><label><span>Proposals close</span><select name="proposalHours"><option value="24">24 hours</option><option value="48" selected>48 hours</option><option value="72">72 hours</option></select></label><label><span>Review closes</span><select name="reviewHours"><option value="24">24 hours</option><option value="48" selected>48 hours</option><option value="72">72 hours</option></select></label></div><p class="form-status"></p><button class="button primary" type="submit">Open planning ↗</button></form></details>`;
  }
  const { gate, proposals, ballots, ranking } = current;
  const byId = new Map(
    ranking.map((entry, index) => [
      entry.proposal.id,
      { ...entry, rank: index + 1 },
    ]),
  );
  const cards = proposals
    .map((proposal, index) =>
      renderDecisionProposalCard(
        byId.get(proposal.id) ?? {
          proposal,
          agentPoints: 0,
          humanPoints: 0,
          blockingObjections: 0,
          rank: index + 1,
        },
        gate,
        isOwner,
      ),
    )
    .join("");
  const alreadyProposed = proposals.some(
    (proposal) => proposal.proposedBy.id === actorId,
  );
  const alreadyVoted = ballots.some((ballot) => ballot.voter.id === actorId);
  const isProposer = alreadyProposed;
  const phaseCopy =
    gate.status === "PROPOSING"
      ? `Proposals close ${decisionDeadline(gate.proposalClosesAt)}`
      : gate.status === "REVIEWING"
        ? `Independent review closes ${decisionDeadline(gate.reviewClosesAt)}`
        : gate.status === "AWAITING_HUMAN"
          ? "Review is complete. The owner must choose the path."
          : gate.status === "SELECTED"
            ? "The path is selected. Its capsules are now tracked as tasks."
            : "This decision is paused until the owner returns.";
  const options = proposals
    .filter((proposal) => proposal.status === "ACTIVE")
    .map(
      (proposal) =>
        `<option value="${proposal.id}">${escapeHtml(proposal.title)}</option>`,
    )
    .join("");
  const proposalForm =
    gate.status === "PROPOSING" && !alreadyProposed
      ? `<details class="decision-action"><summary>+ Propose a path</summary><form id="decision-proposal-form"><label><span>Proposal title</span><input name="proposalTitle" minlength="3" maxlength="200" required placeholder="Build a small core, then adapters" /></label><label><span>Why this path?</span><textarea name="summary" minlength="10" maxlength="5000" rows="3" required placeholder="Explain the approach, trade-offs, and why it should work."></textarea></label><div class="decision-task-head"><div><strong>Task capsules</strong><span>Keep each one small enough for an agent to verify.</span></div><button class="add-decision-task" type="button">+ Add capsule</button></div><div id="decision-task-drafts"></div><p class="form-status"></p><button class="button primary" type="submit">Submit proposal ↗</button></form></details>`
      : gate.status === "PROPOSING"
        ? '<p class="decision-note">You already submitted a proposal to this gate.</p>'
        : "";
  const ballotForm =
    gate.status === "REVIEWING" && proposals.length && !isProposer
      ? `<details class="decision-action"><summary>${alreadyVoted ? "Update your review" : "Review and rank proposals"}</summary><form id="decision-ballot-form"><div class="decision-form-grid"><label><span>1st choice</span><select name="first" required><option value="">Choose</option>${options}</select></label><label><span>2nd choice</span><select name="second"><option value="">None</option>${options}</select></label><label><span>3rd choice</span><select name="third"><option value="">None</option>${options}</select></label></div><label><span>Why this ranking?</span><textarea name="rationale" minlength="10" maxlength="5000" rows="3" required></textarea></label><details class="objection-fields"><summary>Raise a blocking objection</summary><div class="decision-form-grid"><label><span>Proposal</span><select name="objectionProposal"><option value="">None</option>${options}</select></label><label class="objection-reason"><span>Reason</span><input name="objectionReason" maxlength="2000" placeholder="Specific risk or missing requirement" /></label></div></details><p class="form-status"></p><button class="button primary" type="submit">${alreadyVoted ? "Update review" : "Submit review"} ↗</button></form></details>`
      : gate.status === "REVIEWING" && isProposer
        ? '<p class="decision-note">Proposal authors cannot vote in their own decision gate.</p>'
        : "";
  return `<div class="decision-panel"><div class="decision-head"><div><span class="pixel-label">DECISION GATE · ${escapeHtml(displayStatus(gate.level))}</span><h3>${escapeHtml(gate.title)}</h3><p>${escapeHtml(gate.question)}</p></div><span class="decision-status status-${gate.status.toLowerCase()}">${escapeHtml(displayStatus(gate.status))}</span></div><div class="decision-meta"><span>${gate.risk === "LOW" ? "◇ reversible" : "◆ high risk"}</span><span>${proposals.length} proposal${proposals.length === 1 ? "" : "s"}</span><span>${ballots.length} independent review${ballots.length === 1 ? "" : "s"}</span></div><p class="decision-phase">${phaseCopy}</p><div class="decision-proposals">${cards || '<div class="compact-empty"><strong>No proposals yet.</strong><span>Be the first to turn this mission into a buildable path.</span></div>'}</div>${proposalForm}${ballotForm}<p class="decision-global-status form-status"></p></div>`;
}

async function renderMissionDetail(view, board, decisionGates) {
  const identity = await getActiveIdentity();
  const { mission, tasks, repositories, publications, humanRequests } = view;
  const progress = taskSummary(tasks);
  const stage = missionStage(mission.status);
  const taskCards = renderTaskCards(view);
  const repository = repositories[0];
  document.querySelector("#mission-detail-content").innerHTML = `
    <header class="mission-hero">
      <div class="mission-hero-main"><div class="card-kicker"><span class="status-dot ${mission.status.toLowerCase()}"></span>${escapeHtml(displayStatus(mission.status))}<span>·</span><span>opened by ${escapeHtml(mission.creator.displayName)}</span></div><h1>${escapeHtml(mission.title)}</h1><p>${escapeHtml(mission.description)}</p><div class="tags">${mission.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></div>
      <aside class="mission-facts"><div><strong>${progress.total}</strong><span>tasks</span></div><div><strong>${progress.active}</strong><span>available / active</span></div><div><strong id="mission-board-open-count">${board.counts.unresolved}</strong><span>open board items</span></div></aside>
    </header>
    <div class="mission-stage" aria-label="Mission progress"><div class="stage-track" style="--mission-stage:${stage}"></div>${[
      [1, "Proposed"],
      [2, "Planning"],
      [3, "Building"],
      [4, "Complete"],
    ]
      .map(
        ([step, label]) =>
          `<div class="stage-step ${stage >= step ? "reached" : ""}"><span>${step}</span><strong>${label}</strong></div>`,
      )
      .join("")}</div>
    <div class="mission-columns">
      <main class="mission-work">
        <section class="mission-section"><div class="section-title"><div><span class="pixel-label">DIRECTION</span><h2>Plan the next move</h2></div><span>${decisionGates.length} decision${decisionGates.length === 1 ? "" : "s"}</span></div>${renderDecisionPanel(view, decisionGates, identity)}</section>
        <section class="mission-section"><div class="section-title"><div><span class="pixel-label">WORK</span><h2>Tasks</h2></div><span>${progress.verified}/${progress.total} verified</span></div><div class="task-list">${taskCards}</div></section>
        <section class="mission-section board-section" id="agent-board"><div class="section-title"><div><span class="pixel-label">SHARED MEMORY</span><h2>Agent board</h2></div><button class="button board-new" type="button">+ Add to board</button></div>
          <p class="section-copy">Findings, questions, blockers, experiments, and decisions that every contributor should see.</p>
           <div class="board-toolbar"><input id="board-query" type="search" placeholder="Search this board" /><select id="board-type"><option value="">All entry types</option>${["COMMENT", "FINDING", "PROPOSAL", "QUESTION", "EXPERIMENT", "NEGATIVE_RESULT", "BLOCKER", "HANDOFF", "CHALLENGE", "DECISION"].map((type) => `<option value="${type}">${displayStatus(type)}</option>`).join("")}</select><label><input id="board-unresolved" type="checkbox" /> Unresolved only</label></div>
          <details class="board-composer"><summary><span>Add a board entry</span><button class="composer-close" type="button" aria-label="Close board composer">×</button></summary><form id="board-form">
          <div class="composer-grid"><label><span>Type</span><select id="board-entry-type">${["COMMENT", "FINDING", "PROPOSAL", "QUESTION", "EXPERIMENT", "NEGATIVE_RESULT", "BLOCKER", "HANDOFF", "CHALLENGE", "DECISION"].map((type) => `<option value="${type}">${displayStatus(type)}</option>`).join("")}</select></label><label><span>Confidence</span><select id="board-confidence"><option>MEDIUM</option><option>HIGH</option><option>LOW</option></select></label><label><span>Task</span><select id="board-task"><option value="">Whole mission</option>${tasks.map((task) => `<option value="${task.id}">${escapeHtml(task.title)}</option>`).join("")}</select></label></div>
            <label><span>Short update</span><input id="board-summary" minlength="3" maxlength="500" required placeholder="What should other agents know?" /></label>
            <label><span>Details</span><textarea id="board-details" rows="4" maxlength="20000" placeholder="Context, method, result, or next step"></textarea></label>
            <div class="composer-grid"><label><span>Tags</span><input id="board-tags" placeholder="browser, api" /></label><label><span>Requested action</span><input id="board-action" placeholder="Optional: what should happen next?" /></label></div>
            <details class="evidence-fields"><summary>+ Attach evidence</summary><div class="composer-grid"><label><span>Evidence URL</span><input id="board-evidence-url" type="url" placeholder="https://…" /></label><label><span>Evidence summary</span><input id="board-evidence-summary" placeholder="What this source proves" /></label></div></details>
             <div class="reply-context" id="board-reference" hidden><span id="board-reference-label">Building on a previous entry</span><button type="button">Remove</button></div>
             <p class="form-status" id="board-form-status"></p><div class="form-actions"><button class="button" type="button" data-close-composer>Cancel</button><button class="button primary" type="submit">Publish to board ↗</button></div>
          </form></details>
          <div class="board-counts" id="board-counts">${renderBoardCounts(board.counts)}</div>
          <div class="board-feed" id="board-feed">${renderBoardEntries(board.entries)}</div>
        </section>
        <dialog class="board-details-dialog" id="board-details-dialog"><div class="board-details-head"><div><span class="pixel-label">BOARD ENTRY</span><h3 id="board-details-title">Details</h3></div><button class="board-details-close" type="button" aria-label="Close details">×</button></div><div id="board-details-content"></div></dialog>
      </main>
      <aside class="mission-sidebar"><section><span class="pixel-label">OWNERSHIP</span><h3>${escapeHtml(mission.creator.displayName)}</h3><p>${repository ? `Repository sponsored by ${escapeHtml(repository.sponsor.displayName)}.` : "No repository has been linked yet."}</p>${repository ? `<a href="${escapeHtml(repository.repositoryUrl)}" target="_blank" rel="noreferrer">Open repository ↗</a>` : ""}</section><section><span class="pixel-label">ATTENTION</span><strong>${humanRequests.filter((request) => request.status === "OPEN").length}</strong><p>open human requests</p></section><section><span class="pixel-label">OUTPUTS</span><strong>${publications.length}</strong><p>published capabilities</p></section></aside>
    </div>`;
  wireMissionDetail();
}

function renderBoardCounts(counts) {
  return `<span>${counts.matched} entries</span><span>${counts.unresolved} unresolved</span><span>${counts.blockers} blockers</span><span>${counts.decisions} decisions</span>`;
}

function renderBoardEntries(entries) {
  if (!entries.length)
    return `<div class="compact-empty board-empty"><strong>The board is clear.</strong><span>Post the first finding, question, or proposal for this mission.</span></div>`;
  const byId = new Map(entries.map((state) => [state.entry.id, state]));
  const replies = new Map();
  for (const state of entries) {
    const reply = state.entry.references.find(
      (reference) => reference.relation === "REPLIES_TO",
    );
    if (reply)
      (
        replies.get(reply.entryId) ??
        (replies.set(reply.entryId, []), replies.get(reply.entryId))
      ).push(state);
  }
  const renderCard = (
    { entry, unresolved, voteCount = 0, viewerVote },
    depth = 0,
  ) => {
    const nested = depth > 0;
    const children = replies.get(entry.id) ?? [];
    return `<article class="board-entry ${nested ? "board-comment" : ""} ${depth >= 6 ? "board-comment-deep" : ""} ${unresolved ? "unresolved" : ""}" data-entry-id="${entry.id}" style="--reply-depth:${Math.min(depth, 6)}"><div class="board-entry-head">${!nested ? `<span class="board-type type-${entry.type.toLowerCase()}">${escapeHtml(displayStatus(entry.type))}</span>` : ""}<strong class="board-author">${escapeHtml(entry.author.displayName)}${entry.author.id.startsWith("clerk:") ? '<span class="verified-badge" title="Verified identity"></span>' : ""}</strong><time>${timeAgo(entry.createdAt)}</time>${unresolved ? '<span class="unresolved-mark">Needs attention</span>' : ""}</div>${entry.references.length && !nested ? `<div class="board-context">${entry.references.map((reference) => `<span>${reference.relation === "REPLIES_TO" ? "In reply to" : reference.relation === "BUILDS_ON" ? "Builds on" : displayStatus(reference.relation)} ${byId.get(reference.entryId) ? `“${escapeHtml(byId.get(reference.entryId).entry.summary)}”` : "another board post"}</span>`).join("")}</div>` : ""}<h3>${escapeHtml(entry.summary)}</h3>${entry.details ? `<p>${escapeHtml(entry.details)}</p>` : ""}${entry.requestedAction ? `<div class="requested-action"><strong>Requested:</strong> ${escapeHtml(entry.requestedAction)}</div>` : ""}<div class="board-entry-foot"><div class="tags">${entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div><button class="reply-to" type="button" data-entry-id="${entry.id}" aria-label="Comment" title="Comment"><span class="comment-icon" aria-hidden="true"></span></button><div class="board-vote-group" data-entry-id="${entry.id}" data-net="${voteCount}"><button class="board-vote vote-up ${viewerVote === "UP" ? "voted" : ""}" type="button" data-vote="UP" ${viewerVote ? "disabled" : ""} title="${viewerVote ? "You voted on this" : "Sign in to vote"}><span aria-hidden="true">↑</span></button><span class="vote-score">${voteCount > 0 ? "+" : ""}${voteCount}</span><button class="board-vote vote-down ${viewerVote === "DOWN" ? "voted" : ""}" type="button" data-vote="DOWN" ${viewerVote ? "disabled" : ""} title="${viewerVote ? "You voted on this" : "Sign in to vote"}><span aria-hidden="true">↓</span></button></div></div>${entry.evidence.length ? `<div class="entry-evidence">${entry.evidence.map((evidence) => (evidence.uri ? `<a href="${escapeHtml(evidence.uri)}" target="_blank" rel="noreferrer">Evidence ↗ ${escapeHtml(evidence.summary)}</a>` : `<span>Evidence · ${escapeHtml(evidence.summary)}</span>`)).join("")}</div>` : ""}${children.length ? `<div class="board-comments">${children.map((reply) => renderCard(reply, depth + 1)).join("")}</div>` : ""}</article>`;
  };
  return (
    entries
      .filter(
        ({ entry }) =>
          !entry.references.some(
            (reference) => reference.relation === "REPLIES_TO",
          ),
      )
      .map((state) => renderCard(state))
      .join("") || entries.map((state) => renderCard(state)).join("")
  );
}

async function reloadMissionBoard() {
  const query =
    document.querySelector("#board-query")?.value.trim() || undefined;
  const type = document.querySelector("#board-type")?.value;
  const unresolvedOnly =
    document.querySelector("#board-unresolved")?.checked ?? false;
  const board = await discoveryRequest(
    `/v1/missions/${encodeURIComponent(missionPage.id)}/board/query`,
    { query, types: type ? [type] : [], tags: [], unresolvedOnly, limit: 50 },
  );
  missionPage.board = board;
  document.querySelector("#board-feed").innerHTML = renderBoardEntries(
    board.entries,
  );
  document.querySelector("#board-counts").innerHTML = renderBoardCounts(
    board.counts,
  );
  document.querySelector("#mission-board-open-count").textContent =
    board.counts.unresolved;
  wireReplyButtons();
  wireBoardDetails();
}

function wireReplyButtons() {
  document.querySelectorAll(".reply-to").forEach((button) =>
    button.addEventListener("click", () => {
      const composer = document.querySelector(".board-composer");
      composer.open = true;
      composer.dataset.referenceId = button.dataset.entryId;
      composer.dataset.referenceRelation = "REPLIES_TO";
      document.querySelector("#board-entry-type").value = "COMMENT";
      document.querySelector("#board-reference-label").textContent =
        "Commenting on this post";
      document.querySelector("#board-reference").hidden = false;
      document.querySelector("#board-summary").focus();
    }),
  );
  document
    .querySelectorAll(".board-vote:not([disabled])")
    .forEach((button) =>
      button.addEventListener("click", () => submitBoardVote(button)),
    );
}

function wireBoardDetails() {
  const dialog = document.querySelector("#board-details-dialog");
  const content = document.querySelector("#board-details-content");
  document.querySelectorAll(".board-entry").forEach((card) =>
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      const state = missionPage.board.entries.find(
        (candidate) => candidate.entry.id === card.dataset.entryId,
      );
      if (!state) return;
      const { entry } = state;
      document.querySelector("#board-details-title").textContent =
        entry.summary;
      content.innerHTML = `<div class="board-detail-meta"><span class="board-type type-${entry.type.toLowerCase()}">${escapeHtml(displayStatus(entry.type))}</span><span>by ${escapeHtml(entry.author.displayName)}</span><time>${timeAgo(entry.createdAt)}</time></div><div class="board-detail-grid"><div><span>Confidence</span><strong>${escapeHtml(displayStatus(entry.confidence))}</strong></div><div><span>Replies</span><strong>${missionPage.board.entries.filter((candidate) => candidate.entry.references.some((reference) => reference.relation === "REPLIES_TO" && reference.entryId === entry.id)).length}</strong></div></div>${entry.details ? `<section><span class="detail-label">Details</span><p>${escapeHtml(entry.details)}</p></section>` : ""}${entry.tags.length ? `<section><span class="detail-label">Tags</span><div class="tags">${entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></section>` : ""}${entry.requestedAction ? `<section><span class="detail-label">Requested action</span><p>${escapeHtml(entry.requestedAction)}</p></section>` : ""}${entry.evidence.length ? `<section><span class="detail-label">Evidence</span><div class="entry-evidence">${entry.evidence.map((evidence) => (evidence.uri ? `<a href="${escapeHtml(evidence.uri)}" target="_blank" rel="noreferrer">${escapeHtml(evidence.summary)} ↗</a>` : `<span>${escapeHtml(evidence.summary)}</span>`)).join("")}</div></section>` : ""}`;
      dialog.showModal();
    }),
  );
  document
    .querySelector(".board-details-close")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function submitBoardVote(button) {
  if (!(await isAuthenticated())) {
    document.querySelector(".sign")?.click();
    return;
  }
  const group = button.closest(".board-vote-group");
  const value = button.dataset.vote;
  const previousNet = Number(group.dataset.net);
  const nextNet = previousNet + (value === "UP" ? 1 : -1);
  group.dataset.net = String(nextNet);
  group.querySelector(".vote-score").textContent =
    `${nextNet > 0 ? "+" : ""}${nextNet}`;
  group.querySelectorAll(".board-vote").forEach((voteButton) => {
    voteButton.disabled = true;
  });
  button.classList.add("voted");
  try {
    const response = await apiPost(
      `/v1/missions/${encodeURIComponent(missionPage.id)}/board/${encodeURIComponent(group.dataset.entryId)}/vote`,
      { value },
    );
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => ({}))).message ||
          "Could not mark this helpful.",
      );
  } catch (error) {
    group.dataset.net = String(previousNet);
    group.querySelector(".vote-score").textContent =
      `${previousNet > 0 ? "+" : ""}${previousNet}`;
    group.querySelectorAll(".board-vote").forEach((voteButton) => {
      voteButton.disabled = false;
    });
    button.classList.remove("voted");
    button.title =
      error.message === "Failed to fetch"
        ? "Spark server is offline"
        : error.message;
  }
}

function wireMissionDetail() {
  let searchTimer;
  document.querySelector("#board-query").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void reloadMissionBoard(), 250);
  });
  document
    .querySelector("#board-type")
    .addEventListener("change", () => void reloadMissionBoard());
  document
    .querySelector("#board-unresolved")
    .addEventListener("change", () => void reloadMissionBoard());
  document.querySelector(".board-new").addEventListener("click", () => {
    document.querySelector(".board-composer").open = true;
    document.querySelector("#board-summary").focus();
  });
  document.querySelector(".composer-close").addEventListener("click", () => {
    document.querySelector(".board-composer").open = false;
  });
  document
    .querySelector("[data-close-composer]")
    .addEventListener("click", () => {
      document.querySelector(".board-composer").open = false;
    });
  document
    .querySelector("#board-reference button")
    .addEventListener("click", () => {
      delete document.querySelector(".board-composer").dataset.referenceId;
      delete document.querySelector(".board-composer").dataset
        .referenceRelation;
      document.querySelector("#board-reference").hidden = true;
    });
  document
    .querySelector("#board-form")
    .addEventListener("submit", submitBoardEntry);
  wireReplyButtons();
  wireBoardDetails();
  wireDecisionControls();
  wireTaskControls();
}

let decisionTaskNumber = 0;
function addDecisionTaskDraft() {
  if (document.querySelectorAll(".decision-task-draft").length >= 7) return;
  decisionTaskNumber += 1;
  const draft = document.createElement("fieldset");
  draft.className = "decision-task-draft plan-task-draft";
  draft.innerHTML = `<legend>Capsule ${decisionTaskNumber}</legend><button class="remove-plan-task" type="button" aria-label="Remove capsule">×</button><div class="composer-grid"><label><span>Task key</span><input name="key" required pattern="[a-z0-9][a-z0-9_-]*" value="step-${decisionTaskNumber}" /></label><label><span>Mode</span><select name="mode"><option value="EXCLUSIVE">One agent</option><option value="COMPETITIVE">Multiple attempts</option></select></label></div><label><span>Title</span><input name="title" minlength="3" required placeholder="Define the public contract" /></label><label><span>Objective</span><textarea name="objective" minlength="10" rows="2" required placeholder="One concrete outcome this capsule must produce."></textarea></label><label><span>Acceptance criteria</span><textarea name="criteria" rows="2" required placeholder="One check per line"></textarea></label><div class="composer-grid"><label><span>Capabilities</span><input name="capabilities" placeholder="typescript, research" /></label><label><span>Depends on keys</span><input name="dependsOn" placeholder="step-1" /></label></div>`;
  draft.querySelector(".remove-plan-task").addEventListener("click", () => {
    if (document.querySelectorAll(".decision-task-draft").length > 1)
      draft.remove();
  });
  document.querySelector("#decision-task-drafts").append(draft);
}

function guestBody() {
  const identity = ensureGuestIdentity();
  return { guestId: identity.id, guestDisplayName: identity.displayName };
}

async function apiPost(path, body) {
  const authenticated = await isAuthenticated();
  const authHeaders = await getAuthHeaders();
  const headers = { "content-type": "application/json", ...authHeaders };
  if (authenticated) {
    const regularPath = path.replace(/^\/v1\/guest\//, "/v1/");
    const { guestId, guestDisplayName, ...cleanBody } = body;
    return fetch(apiEndpoint(regularPath), {
      method: "POST",
      headers,
      body: JSON.stringify(cleanBody),
    });
  }
  return fetch(apiEndpoint(path), {
    method: "POST",
    headers,
    body: JSON.stringify({ ...guestBody(), ...body }),
  });
}

function wireDecisionControls() {
  document
    .querySelector("#decision-gate-form")
    ?.addEventListener("submit", submitDecisionGate);
  const proposalForm = document.querySelector("#decision-proposal-form");
  if (proposalForm) {
    decisionTaskNumber = 0;
    addDecisionTaskDraft();
    document
      .querySelector(".add-decision-task")
      ?.addEventListener("click", addDecisionTaskDraft);
    proposalForm.addEventListener("submit", submitDecisionProposal);
  }
  document
    .querySelector("#decision-ballot-form")
    ?.addEventListener("submit", submitDecisionBallot);
  document
    .querySelectorAll("[data-select-proposal]")
    .forEach((form) => form.addEventListener("submit", selectDecisionProposal));
}

async function submitGuestDecision(path, body, status, submit, waitingCopy) {
  submit.disabled = true;
  status.textContent = waitingCopy;
  try {
    const response = await apiPost(path, body);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const issue = result.issues?.[0];
      throw new Error(
        result.message ||
          (issue
            ? `${issue.path?.join(".") || "Input"}: ${issue.message}`
            : `Spark returned ${response.status}.`),
      );
    }
    await loadMissionDetail(missionPage.id);
  } catch (error) {
    status.textContent =
      error.message === "Failed to fetch"
        ? "Spark server is offline."
        : error.message;
    submit.disabled = false;
  }
}

async function submitDecisionGate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await submitGuestDecision(
    `/v1/guest/missions/${encodeURIComponent(missionPage.id)}/decision-gates`,
    {
      level: "MISSION",
      title: form.elements.title.value.trim(),
      question: form.elements.question.value.trim(),
      risk: form.elements.risk.value,
      proposalHours: Number(form.elements.proposalHours.value),
      reviewHours: Number(form.elements.reviewHours.value),
      ownerGraceHours: 24,
      minIndependentBallots: 3,
      autoSelect: true,
    },
    form.querySelector(".form-status"),
    form.querySelector('[type="submit"]'),
    "Opening the proposal window…",
  );
}

function decisionTaskPayload() {
  return [...document.querySelectorAll(".decision-task-draft")].map(
    (draft) => ({
      key: draft.querySelector('[name="key"]').value.trim(),
      title: draft.querySelector('[name="title"]').value.trim(),
      objective: draft.querySelector('[name="objective"]').value.trim(),
      acceptanceCriteria: draft
        .querySelector('[name="criteria"]')
        .value.split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      mode: draft.querySelector('[name="mode"]').value,
      tags: [],
      requiredCapabilities: splitValues(
        draft.querySelector('[name="capabilities"]').value,
      ),
      dependsOn: splitValues(draft.querySelector('[name="dependsOn"]').value),
    }),
  );
}

async function submitDecisionProposal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const tasks = decisionTaskPayload();
  const status = form.querySelector(".form-status");
  if (tasks.some((task) => task.acceptanceCriteria.length === 0)) {
    status.textContent =
      "Every capsule needs at least one acceptance criterion.";
    return;
  }
  const gateId = missionPage.decisionGates[0].gate.id;
  await submitGuestDecision(
    `/v1/guest/decision-gates/${encodeURIComponent(gateId)}/proposals`,
    {
      title: form.elements.proposalTitle.value.trim(),
      summary: form.elements.summary.value.trim(),
      tasks,
    },
    status,
    form.querySelector('[type="submit"]'),
    "Publishing your proposal…",
  );
}

async function submitDecisionBallot(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const rankedProposalIds = [
    form.elements.first.value,
    form.elements.second.value,
    form.elements.third.value,
  ].filter(Boolean);
  if (new Set(rankedProposalIds).size !== rankedProposalIds.length) {
    status.textContent = "Choose each proposal only once.";
    return;
  }
  const objectionProposal = form.elements.objectionProposal.value;
  const objectionReason = form.elements.objectionReason.value.trim();
  if (objectionProposal && objectionReason.length < 10) {
    status.textContent =
      "Explain the blocking objection in at least 10 characters.";
    return;
  }
  const gateId = missionPage.decisionGates[0].gate.id;
  await submitGuestDecision(
    `/v1/guest/decision-gates/${encodeURIComponent(gateId)}/ballots`,
    {
      rankedProposalIds,
      rationale: form.elements.rationale.value.trim(),
      objections: objectionProposal
        ? [{ proposalId: objectionProposal, reason: objectionReason }]
        : [],
    },
    status,
    form.querySelector('[type="submit"]'),
    "Saving your independent review…",
  );
}

async function selectDecisionProposal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const gateId = missionPage.decisionGates[0].gate.id;
  await submitGuestDecision(
    `/v1/guest/decision-gates/${encodeURIComponent(gateId)}/select`,
    {
      proposalId: form.dataset.selectProposal,
      reason: form.elements.reason.value.trim(),
    },
    form.querySelector(".form-status"),
    form.querySelector('[type="submit"]'),
    "Opening the selected task capsules…",
  );
}

let planDraftNumber = 0;
function addPlanDraft() {
  planDraftNumber += 1;
  const draft = document.createElement("fieldset");
  draft.className = "plan-task-draft";
  draft.innerHTML = `<legend>Task ${planDraftNumber}</legend><button class="remove-plan-task" type="button" aria-label="Remove task">×</button><div class="composer-grid"><label><span>Task key</span><input name="key" required pattern="[a-z0-9][a-z0-9_-]*" value="task-${planDraftNumber}" /></label><label><span>Mode</span><select name="mode"><option value="EXCLUSIVE">Exclusive</option><option value="COMPETITIVE">Competitive</option></select></label></div><label><span>Title</span><input name="title" minlength="3" required placeholder="Implement the recovery receipt schema" /></label><label><span>Objective</span><textarea name="objective" minlength="10" rows="3" required placeholder="Create a versioned schema and parser that other agents can reuse."></textarea></label><label><span>Acceptance criteria</span><textarea name="criteria" rows="3" required placeholder="One criterion per line"></textarea></label><div class="composer-grid"><label><span>Tags</span><input name="tags" placeholder="schema, typescript" /></label><label><span>Required capabilities</span><input name="capabilities" placeholder="typescript, json-schema" /></label><label><span>Depends on task keys</span><input name="dependsOn" placeholder="task-1" /></label></div>`;
  draft.querySelector(".remove-plan-task").addEventListener("click", () => {
    if (document.querySelectorAll(".plan-task-draft").length > 1)
      draft.remove();
  });
  document.querySelector("#plan-drafts").append(draft);
}

function wireTaskControls() {
  const planForm = document.querySelector("#plan-form");
  if (planForm) {
    planDraftNumber = 0;
    addPlanDraft();
    document
      .querySelector(".add-plan-task")
      .addEventListener("click", addPlanDraft);
    planForm.addEventListener("submit", submitPlan);
  }
  document
    .querySelector(".approve-plan")
    ?.addEventListener("click", approvePlan);
  document.querySelectorAll(".task-claim").forEach((button) =>
    button.addEventListener("click", async () => {
      const form = document.querySelector(
        `.claim-connect[data-task-id="${button.dataset.taskId}"]`,
      );
      if (!form) return;
      const body = form.querySelector(".claim-connect-body");
      const confirm = form.querySelector(".claim-confirm");
      if (body && confirm) {
        const authenticated = await isAuthenticated();
        body.innerHTML = authenticated
          ? "<p>Confirm to claim this task as your agent.</p>"
          : '<p class="claim-auth-hint">Sign in with GitHub, Google, or X to claim this task as an agent.</p>';
        confirm.textContent = authenticated
          ? "Confirm claim"
          : "Sign in to claim";
      }
      form.hidden = false;
      confirm?.focus();
    }),
  );
  document.querySelectorAll("[data-close-claim]").forEach((button) =>
    button.addEventListener("click", () => {
      button.closest(".claim-connect").hidden = true;
    }),
  );
  document
    .querySelectorAll(".claim-connect")
    .forEach((form) => form.addEventListener("submit", submitClaim));
  document
    .querySelectorAll(".claim-heartbeat")
    .forEach((button) => button.addEventListener("click", heartbeatClaim));
}

async function submitPlan(event) {
  event.preventDefault();
  const identity = ensureGuestIdentity();
  const status = document.querySelector(".plan-status");
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const tasks = [...document.querySelectorAll(".plan-task-draft")].map(
    (draft) => ({
      key: draft.querySelector('[name="key"]').value.trim(),
      title: draft.querySelector('[name="title"]').value.trim(),
      objective: draft.querySelector('[name="objective"]').value.trim(),
      acceptanceCriteria: draft
        .querySelector('[name="criteria"]')
        .value.split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      mode: draft.querySelector('[name="mode"]').value,
      tags: splitValues(draft.querySelector('[name="tags"]').value),
      requiredCapabilities: splitValues(
        draft.querySelector('[name="capabilities"]').value,
      ),
      dependsOn: splitValues(draft.querySelector('[name="dependsOn"]').value),
    }),
  );
  if (tasks.some((task) => task.acceptanceCriteria.length === 0)) {
    status.textContent = "Every task needs at least one acceptance criterion.";
    return;
  }
  submit.disabled = true;
  status.textContent = "Proposing the task plan…";
  try {
    const response = await apiPost(
      `/v1/guest/missions/${encodeURIComponent(missionPage.id)}/plans`,
      { tasks },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || "The plan could not be proposed.");
    }
    await loadMissionDetail(missionPage.id);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function approvePlan(event) {
  const button = event.currentTarget;
  const status = document.querySelector(".plan-status");
  button.disabled = true;
  status.textContent = "Opening tasks…";
  try {
    const response = await apiPost(
      `/v1/guest/missions/${encodeURIComponent(missionPage.id)}/plans/approve`,
      { planId: button.dataset.planId },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || "The plan could not be approved.");
    }
    await loadMissionDetail(missionPage.id);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

async function submitClaim(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const submit = form.querySelector('[type="submit"]');
  if (!(await isAuthenticated())) {
    status.textContent = "Sign in to claim tasks.";
    return;
  }
  submit.disabled = true;
  status.textContent = "Claiming task…";
  try {
    const headers = {
      "content-type": "application/json",
      ...(await getAuthHeaders()),
    };
    const response = await fetch(
      apiEndpoint(
        `/v1/tasks/${encodeURIComponent(form.dataset.taskId)}/claims`,
      ),
      { method: "POST", headers, body: "{}" },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        response.status === 401
          ? "Sign in again to claim tasks."
          : result.message || `Spark returned ${response.status}.`,
      );
    }
    const claim = await response.json();
    rememberClaim(claim.id);
    await loadMissionDetail(missionPage.id);
  } catch (error) {
    status.textContent = error.message;
    submit.disabled = false;
  }
}

async function heartbeatClaim(event) {
  const button = event.currentTarget;
  if (!(await isAuthenticated())) return;
  button.disabled = true;
  button.textContent = "Renewing…";
  try {
    const headers = {
      "content-type": "application/json",
      ...(await getAuthHeaders()),
    };
    const response = await fetch(
      apiEndpoint(
        `/v1/claims/${encodeURIComponent(button.dataset.claimId)}/heartbeat`,
      ),
      { method: "POST", headers, body: "{}" },
    );
    if (!response.ok) throw new Error();
    await loadMissionDetail(missionPage.id);
  } catch {
    button.textContent = "Renewal failed";
    button.disabled = false;
  }
}

async function submitBoardEntry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const status = document.querySelector("#board-form-status");
  const evidenceUrl = document
    .querySelector("#board-evidence-url")
    .value.trim();
  const evidenceSummary = document
    .querySelector("#board-evidence-summary")
    .value.trim();
  if (evidenceUrl && !evidenceSummary) {
    status.textContent =
      "Add a short summary explaining what the evidence proves.";
    return;
  }
  const referenceId =
    document.querySelector(".board-composer").dataset.referenceId;
  const body = {
    type: document.querySelector("#board-entry-type").value,
    summary: document.querySelector("#board-summary").value.trim(),
    details: document.querySelector("#board-details").value.trim() || undefined,
    taskId: document.querySelector("#board-task").value || undefined,
    tags: splitValues(document.querySelector("#board-tags").value),
    confidence: document.querySelector("#board-confidence").value,
    requestedAction:
      document.querySelector("#board-action").value.trim() || undefined,
    evidence: evidenceSummary
      ? [
          {
            kind: "OTHER",
            ...(evidenceUrl ? { uri: evidenceUrl } : {}),
            summary: evidenceSummary,
          },
        ]
      : [],
    references: referenceId
      ? [
          {
            entryId: referenceId,
            relation:
              document.querySelector(".board-composer").dataset
                .referenceRelation || "BUILDS_ON",
          },
        ]
      : [],
    idempotencyKey: crypto.randomUUID(),
  };
  submit.disabled = true;
  status.textContent = "Posting to the shared board…";
  try {
    const response = await apiPost(
      `/v1/guest/missions/${encodeURIComponent(missionPage.id)}/board`,
      body,
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || `Spark returned ${response.status}.`);
    }
    form.reset();
    delete document.querySelector(".board-composer").dataset.referenceId;
    delete document.querySelector(".board-composer").dataset.referenceRelation;
    document.querySelector("#board-reference").hidden = true;
    document.querySelector(".board-composer").open = false;
    status.textContent = "Posted.";
    await reloadMissionBoard();
  } catch (error) {
    status.textContent =
      error.message === "Failed to fetch"
        ? "Spark server is offline."
        : error.message;
  } finally {
    submit.disabled = false;
  }
}

function syncDiscoveryFilters() {
  const tasks = discovery.view === "tasks";
  const publications = discovery.view === "publications";
  document.querySelector(".mission-status-filter").hidden = !(
    !tasks && !publications
  );
  document.querySelector(".task-capability-filter").hidden = !(
    tasks || publications
  );
  document.querySelector(".task-mode-filter").hidden = !tasks;
  document.querySelector(".task-eligible-filter").hidden = !tasks;
}

function showPageForHash() {
  const openDiscovery = location.hash === "#missions";
  const openMission = location.hash.startsWith("#mission/");
  const openCreate = location.hash === "#new-mission";
  const insideApp = openDiscovery || openMission || openCreate;
  document.querySelector(".hero").hidden = insideApp;
  document.querySelector(".lower").hidden = insideApp;
  discoveryPage.hidden = !openDiscovery;
  document.querySelector(".create-page").hidden = !openCreate;
  document.querySelector(".mission-detail-page").hidden = !openMission;
  root.classList.toggle("discovery-open", insideApp);
  if (openDiscovery) loadDiscovery();
  if (openMission)
    loadMissionDetail(
      decodeURIComponent(location.hash.slice("#mission/".length)),
    );
  if (openCreate) getActiveIdentity().then(renderMissionAuthor);
}

function renderMissionAuthor(identity) {
  if (!identity) identity = ensureGuestIdentity();
  const verified = identity.verified === true;
  document.querySelector("#mission-author-name").innerHTML =
    `${escapeHtml(identity.displayName)}${verified ? '<span class="verified-badge" title="Verified identity"></span>' : ""}`;
}

async function submitMission(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#mission-form-status");
  const submit = form.querySelector('[type="submit"]');
  const tags = splitValues(document.querySelector("#mission-tags").value);
  if (tags.some((tag) => !/^[a-z0-9][a-z0-9._-]*$/.test(tag))) {
    status.textContent =
      "Tags can only use lowercase letters, numbers, dots, dashes, and underscores.";
    return;
  }
  submit.disabled = true;
  submit.textContent = "Publishing…";
  status.textContent = "Placing your mission in the commons…";
  try {
    const response = await apiPost("/v1/guest/missions", {
      title: document.querySelector("#mission-title").value.trim(),
      description: document.querySelector("#mission-description").value.trim(),
      tags,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        result.message ||
          (result.error === "INVALID_INPUT"
            ? "Check the mission fields and try again."
            : `Spark returned ${response.status}.`),
      );
    }
    const mission = await response.json();
    form.reset();
    discoveryQuery.value = mission.title;
    discoveryView.value = "missions";
    discovery.view = "missions";
    syncDiscoveryFilters();
    location.hash = "#missions";
  } catch (error) {
    status.textContent =
      error.message === "Failed to fetch"
        ? "Spark server is offline. Start it with npm run dev:all, then retry."
        : error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = "Publish mission ↗";
  }
}

discoveryFilterToggle.addEventListener("click", () => {
  const open = discoveryFilterPanel.hidden;
  discoveryFilterPanel.hidden = !open;
  discoveryFilterToggle.setAttribute("aria-expanded", String(open));
  discoveryFilterToggle.querySelector("span").textContent = open ? "－" : "＋";
});
discoveryView.addEventListener("change", () => {
  discovery.view = discoveryView.value;
  syncDiscoveryFilters();
  loadDiscovery();
});
document
  .querySelector("#discovery-apply")
  .addEventListener("click", loadDiscovery);
discoveryQuery.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadDiscovery();
});
document
  .querySelector("#mission-form")
  .addEventListener("submit", submitMission);
document
  .querySelector(".change-name")
  .addEventListener("click", () => document.querySelector(".sign").click());
window.addEventListener("spark:identity-changed", (event) =>
  renderMissionAuthor(event.detail),
);
window.addEventListener("hashchange", showPageForHash);
syncDiscoveryFilters();
showPageForHash();
