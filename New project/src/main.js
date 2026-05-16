import * as THREE from "../vendor/three.module.js";

const canvas = document.querySelector("#scene");
const speedEl = document.querySelector("#speed");
const positionEl = document.querySelector("#position");
const lapEl = document.querySelector("#lap");
const scoreEl = document.querySelector("#score");
const dashSpeedEl = document.querySelector("#dashSpeed");
const dashRpmEl = document.querySelector("#dashRpm");
const speedNeedleEl = document.querySelector("#speedNeedle");
const rpmNeedleEl = document.querySelector("#rpmNeedle");
const gearEl = document.querySelector("#gear");
const throttleEl = document.querySelector("#throttleTrace");
const brakeEl = document.querySelector("#brakeTrace");
const gripEl = document.querySelector("#gripTrace");
const boostEl = document.querySelector("#boostBar");
const renderProbeEl = document.querySelector("#renderProbe");
const modelProbeEl = document.querySelector("#modelProbe");
const miniCanvas = document.querySelector("#minimap");
const miniCtx = miniCanvas.getContext("2d");
const menu = document.querySelector("#menu");
const startBtn = document.querySelector("#startRace");
const restartBtn = document.querySelector("#restartRace");
const menuBtn = document.querySelector("#menuButton");
const raceStatusEl = document.querySelector("#raceStatus");
const difficultyInputs = [...document.querySelectorAll("input[name='difficulty']")];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc8e8);
scene.fog = new THREE.Fog(0x9fc8e8, 200, 680);

const camera = new THREE.PerspectiveCamera(63, 1, 0.1, 900);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x9fc8e8, 1);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const clock = new THREE.Clock();
const keys = new Set();
const world = new THREE.Group();
scene.add(world);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8a5d, 2.35));
const sun = new THREE.DirectionalLight(0xfff0d2, 2.1);
sun.position.set(-120, 210, 110);
scene.add(sun);

const ROAD_WIDTH = 16;
const TRACK_SAMPLES = 560;
const TOTAL_LAPS = 3;
let track;
let biome;
let seed = Date.now();
let difficulty = "easy";
let lastRenderProbe = 0;
const raceCars = [];

const state = {
  running: false,
  finished: false,
  pos: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  yaw: 0,
  steer: 0,
  throttle: 0,
  brake: 0,
  boost: 1,
  rpm: 900,
  gear: 1,
  lap: 1,
  lapBase: 0,
  lastT: 0,
  distance: 0,
  score: 0,
  slip: 0,
  onRoad: true,
  position: 1,
};

rebuildGame(true);
resize();
animate();

window.addEventListener("keydown", (event) => {
  keys.add(event.key.toLowerCase());
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(event.key.toLowerCase())) event.preventDefault();
  if (event.key.toLowerCase() === "escape") toggleMenu(true);
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("resize", resize);
startBtn.addEventListener("click", () => {
  rebuildGame(false);
  startRace();
});
restartBtn.addEventListener("click", () => {
  rebuildGame(false);
  startRace();
});
menuBtn.addEventListener("click", () => toggleMenu(true));

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (state.running && !state.finished) {
    updatePlayer(dt);
    updateAi(dt);
    updateRaceOrder();
  }
  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
  updateRenderProbe(false);
  requestAnimationFrame(animate);
}

function rebuildGame(showMenu) {
  difficulty = difficultyInputs.find((input) => input.checked)?.value || "easy";
  raceStatusEl.textContent = "Generating circuit...";
  document.body.classList.add("is-loading");
  seed = (Date.now() ^ Math.floor(Math.random() * 9999999)) >>> 0;
  const rng = mulberry32(seed);
  track = buildTrack(rng, difficulty);
  biome = pickBiome(rng);

  world.clear();
  raceCars.splice(0, raceCars.length);
  world.add(createGround());
  world.add(createLakes(rng));
  world.add(createHills(rng));
  world.add(createRoad());
  world.add(createKerbs());
  world.add(createRails());
  world.add(createSmartProps());
  world.add(createStartFinish());
  world.add(createScenery(rng));

  const player = createCar(0xe14bd7, true);
  world.add(player);
  raceCars.push({ id: "player", mesh: player, isPlayer: true, distance: 0, lap: 1 });

  const aiColors = [0x2f80ed, 0xff4d4d, 0xf5b642, 0x32b56b, 0xffffff];
  for (let i = 0; i < 5; i += 1) {
    const ai = createCar(aiColors[i], false);
    world.add(ai);
    raceCars.push({
      id: `ai-${i}`,
      mesh: ai,
      isPlayer: false,
      distance: -0.012 * (i + 1),
      lap: 1,
      lane: [-4.8, -2.4, 2.4, 4.8, 0][i],
      speed: 0,
      skill: difficultySettings().aiSkill + i * 0.035 + rng() * 0.04,
      aggression: difficultySettings().aggression + rng() * 0.25,
      phase: rng() * 10,
    });
  }

  resetRace(showMenu);
  drawMinimap();
  document.body.classList.remove("is-loading");
}

function resetRace(showMenu = true) {
  const start = sampleTrack(0);
  state.pos.copy(start.point).addScaledVector(start.right, -3).setY(0.42);
  state.velocity.set(0, 0, 0);
  state.yaw = start.yaw;
  state.steer = 0;
  state.throttle = 0;
  state.brake = 0;
  state.boost = 1;
  state.rpm = 900;
  state.gear = 1;
  state.lap = 1;
  state.lapBase = 0;
  state.lastT = 0;
  state.distance = 0;
  state.score = 0;
  state.slip = 0;
  state.onRoad = true;
  state.position = 1;
  state.running = false;
  state.finished = false;

  raceCars.forEach((car, index) => {
    car.distance = car.isPlayer ? 0 : -0.012 * index;
    car.lap = 1;
    car.speed = car.isPlayer ? 0 : 0;
    const s = sampleTrack(car.distance);
    const lane = car.isPlayer ? -3 : car.lane;
    car.mesh.position.copy(s.point).addScaledVector(s.right, lane).setY(0.42);
    car.mesh.rotation.y = s.yaw;
  });

  updateRaceOrder();
  raceStatusEl.textContent = `${difficultyLabel()} circuit ready`;
  modelProbeEl.textContent = "simple:clean-race-car";
  toggleMenu(showMenu);
}

function startRace() {
  state.running = true;
  state.finished = false;
  toggleMenu(false);
  raceStatusEl.textContent = "Race running";
}

function toggleMenu(show) {
  menu.classList.toggle("hidden", !show);
}

function updatePlayer(dt) {
  const throttleInput = held("w", "arrowup") ? 1 : 0;
  const brakeInput = held("s", "arrowdown") ? 1 : 0;
  const steerInput = held("a", "arrowleft") ? 1 : held("d", "arrowright") ? -1 : 0;
  const handbrake = held(" ");
  const boost = held("shift") && state.boost > 0.05 && state.velocity.length() > 12;

  state.throttle = throttleInput;
  state.brake = brakeInput;
  state.steer = THREE.MathUtils.lerp(state.steer, steerInput, 1 - Math.pow(0.001, dt));

  const nearest = findNearestTrack(state.pos);
  const lateral = state.pos.clone().sub(nearest.point).dot(nearest.right);
  state.onRoad = Math.abs(lateral) <= ROAD_WIDTH * 0.55;

  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const speed = state.velocity.length();
  const signedSpeed = state.velocity.dot(forward);
  const lateralSpeed = state.velocity.dot(right);
  const grip = state.onRoad ? (handbrake ? 2.6 : 9.2) : 2.2;
  const engineForce = 17.5 + (boost ? 8.5 : 0);
  const brakeForce = signedSpeed > 0 ? 25 : 10;

  state.velocity.addScaledVector(forward, throttleInput * engineForce * dt);
  state.velocity.addScaledVector(forward, -Math.sign(signedSpeed || 1) * brakeInput * brakeForce * dt);
  state.velocity.addScaledVector(right, -lateralSpeed * grip * dt);
  state.velocity.addScaledVector(state.velocity, -(0.012 + speed * 0.0031) * dt);
  state.velocity.clampLength(0, boost ? 80 : 68);

  const steerPower = THREE.MathUtils.clamp(Math.abs(signedSpeed) / 28, 0.08, 1);
  state.yaw += state.steer * steerPower * (handbrake ? 1.45 : 1.02) * dt * Math.sign(signedSpeed || 1);
  state.pos.addScaledVector(state.velocity, dt);

  const corrected = findNearestTrack(state.pos);
  const off = state.pos.clone().sub(corrected.point).dot(corrected.right);
  if (Math.abs(off) > ROAD_WIDTH * 0.5 + 6) {
    state.pos.addScaledVector(corrected.right, -Math.sign(off) * (Math.abs(off) - ROAD_WIDTH * 0.5 - 6));
    state.velocity.multiplyScalar(0.72);
  }
  state.pos.y = 0.42;

  if (corrected.t < 0.08 && state.lastT > 0.92) state.lapBase += 1;
  state.lastT = corrected.t;
  state.distance = state.lapBase + corrected.t;
  state.lap = Math.floor(state.distance) + 1;
  if (state.lap > TOTAL_LAPS) finishRace();

  const velocityYaw = Math.atan2(state.velocity.x, state.velocity.z);
  state.slip = speed > 4 ? Math.abs(angleDelta(state.yaw, velocityYaw)) : 0;
  if (state.onRoad && speed > 16 && state.slip > 0.16 && state.slip < 0.8) state.score += Math.round((speed * state.slip) * dt * 9);

  state.boost = boost ? Math.max(0, state.boost - dt * 0.22) : Math.min(1, state.boost + dt * 0.075);
  updatePowertrain(speed);

  const player = raceCars[0];
  player.mesh.position.copy(state.pos);
  player.mesh.rotation.set(-signedSpeed * 0.0009, state.yaw, -state.steer * steerPower * 0.07 - lateralSpeed * 0.0035);
  player.distance = state.distance;
  player.lap = state.lap;
}

function updateAi(dt) {
  const playerDistance = state.distance;
  raceCars.slice(1).forEach((car, index) => {
    const t = normalized(car.distance);
    const curve = curvatureAt(t);
    const settings = difficultySettings();
    const baseTarget = THREE.MathUtils.lerp(settings.aiTopSpeed, settings.aiCornerSpeed, THREE.MathUtils.clamp(curve * 5.2, 0, 1));
    const gap = playerDistance - car.distance;
    const catchUp = THREE.MathUtils.clamp(gap * 2.3, -5, 11);
    const targetSpeed = (baseTarget + catchUp) * car.skill;
    car.speed += (targetSpeed - car.speed) * dt * (0.9 + car.aggression * 0.45);
    car.distance += (car.speed / track.length) * dt;
    car.lap = Math.floor(Math.max(0, car.distance)) + 1;
    if (car.lap > TOTAL_LAPS) car.distance = TOTAL_LAPS + 0.001;

    const sample = sampleTrack(car.distance);
    const turn = signedCurvatureAt(car.distance);
    const apexLine = THREE.MathUtils.clamp(-Math.sign(turn) * Math.min(4.2, Math.abs(turn) * 70), -4.2, 4.2);
    const passBias = gap > -0.05 && gap < 0.08 ? Math.sin(performance.now() * 0.0012 + car.phase) * 1.4 : 0;
    const lane = THREE.MathUtils.clamp(THREE.MathUtils.lerp(car.lane, apexLine, Math.min(0.65, Math.abs(turn) * 8)) + passBias, -5.5, 5.5);
    const next = sampleTrack(car.distance + 0.004);
    car.mesh.position.copy(sample.point).addScaledVector(sample.right, lane).setY(0.42);
    car.mesh.rotation.y = THREE.MathUtils.lerp(sample.yaw, next.yaw, 0.35);
    car.mesh.rotation.z = -passBias * 0.012;
  });
}

function updateRaceOrder() {
  const sorted = [...raceCars].sort((a, b) => b.distance - a.distance);
  state.position = sorted.findIndex((car) => car.id === "player") + 1;
}

function finishRace() {
  state.finished = true;
  state.running = false;
  raceStatusEl.textContent = `Finished P${state.position}`;
  toggleMenu(true);
}

function updatePowertrain(speed) {
  const kmh = speed * 3.6;
  const bands = [0, 55, 96, 142, 188, 236, 290];
  let gear = 1;
  for (let i = 1; i < bands.length; i += 1) if (kmh >= bands[i]) gear = i + 1;
  state.gear = THREE.MathUtils.clamp(gear, 1, 6);
  const low = bands[state.gear - 1] || 0;
  const high = bands[state.gear] || 320;
  const load = THREE.MathUtils.clamp((kmh - low) / Math.max(1, high - low), 0, 1);
  state.rpm = THREE.MathUtils.lerp(state.rpm, 950 + load * 6500 + state.throttle * 500, 0.12);
}

function updateCamera(dt) {
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  const speed = state.velocity.length();
  const target = state.pos.clone().addScaledVector(forward, -11.8 - speed * 0.035);
  target.y += 5.4 + speed * 0.018;
  camera.position.lerp(target, 1 - Math.pow(0.0007, dt));
  camera.lookAt(state.pos.x + forward.x * 12, 1.1, state.pos.z + forward.z * 12);
}

function updateHud() {
  const kmh = Math.round(state.velocity.length() * 3.6);
  speedEl.textContent = String(kmh).padStart(3, "0");
  positionEl.textContent = `${state.position}/${raceCars.length}`;
  lapEl.textContent = `${Math.min(state.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
  scoreEl.textContent = state.score.toLocaleString("en-US");
  dashSpeedEl.textContent = String(kmh);
  dashRpmEl.textContent = String(Math.round(state.rpm / 100) * 100);
  if (speedNeedleEl) speedNeedleEl.style.transform = `rotate(${THREE.MathUtils.clamp(kmh / 280, 0, 1) * 240 - 120}deg)`;
  if (rpmNeedleEl) rpmNeedleEl.style.transform = `rotate(${THREE.MathUtils.clamp(state.rpm / 8200, 0, 1) * 240 - 120}deg)`;
  gearEl.textContent = state.gear;
  throttleEl.style.transform = `scaleX(${state.throttle})`;
  brakeEl.style.transform = `scaleX(${state.brake})`;
  gripEl.style.transform = `scaleX(${state.onRoad ? THREE.MathUtils.clamp(1 - state.slip * 0.55, 0.25, 1) : 0.18})`;
  boostEl.style.transform = `scaleX(${state.boost})`;
  drawMinimap();
}

function buildTrack(rng, level) {
  const settings = difficultySettings(level);
  const turns = settings.turns + Math.floor(rng() * 3);
  const controls = [];
  for (let i = 0; i < turns; i += 1) {
    const a = (i / turns) * Math.PI * 2;
    const radius = settings.radius + rng() * settings.radiusJitter + Math.sin(a * (2 + rng() * 2)) * settings.wave;
    controls.push(new THREE.Vector3(
      Math.cos(a) * radius + (rng() - 0.5) * settings.noise,
      0,
      Math.sin(a) * radius * (0.72 + rng() * 0.28) + (rng() - 0.5) * settings.noise,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(controls, true, "catmullrom", 0.38);
  const samples = [];
  let length = 0;
  let previous = sampleCurve(curve, 0);
  for (let i = 0; i < TRACK_SAMPLES; i += 1) {
    const sample = sampleCurve(curve, i / TRACK_SAMPLES);
    length += sample.point.distanceTo(previous.point);
    samples.push(sample);
    previous = sample;
  }
  length += samples[0].point.distanceTo(samples[samples.length - 1].point);
  return { curve, controls, samples, length };
}

function sampleCurve(curve, t) {
  const wrapped = normalized(t);
  const point = curve.getPointAt(wrapped);
  const tangent = curve.getTangentAt(wrapped).normalize();
  const flat = new THREE.Vector3(tangent.x, 0, tangent.z).normalize();
  const right = new THREE.Vector3(flat.z, 0, -flat.x);
  return { point, tangent: flat, right, yaw: Math.atan2(flat.x, flat.z), t: wrapped };
}

function sampleTrack(t) {
  return sampleCurve(track.curve, t);
}

function findNearestTrack(pos) {
  let best = track.samples[0];
  let bestDist = Infinity;
  for (const sample of track.samples) {
    const dx = sample.point.x - pos.x;
    const dz = sample.point.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      best = sample;
      bestDist = d;
    }
  }
  return best;
}

function curvatureAt(t) {
  const a = sampleTrack(t - 0.008).yaw;
  const b = sampleTrack(t + 0.008).yaw;
  return Math.abs(angleDelta(a, b));
}

function signedCurvatureAt(t) {
  return angleDelta(sampleTrack(t + 0.01).yaw, sampleTrack(t - 0.01).yaw);
}

function createGround() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(620, 520),
    new THREE.MeshStandardMaterial({ color: biome.grass, roughness: 0.95 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.04;
  return mesh;
}

function createLakes(rng) {
  const group = new THREE.Group();
  const lakeMat = new THREE.MeshBasicMaterial({ color: biome.water, transparent: true, opacity: 0.82 });
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i += 1) {
    const spot = findOpenSpot(rng, 42, 210);
    const radius = 18 + rng() * 22;
    const shore = new THREE.Mesh(new THREE.CircleGeometry(radius + 3.2, 32), new THREE.MeshBasicMaterial({ color: biome.shore }));
    shore.position.set(spot.x, 0.006, spot.z);
    shore.rotation.x = -Math.PI / 2;
    shore.scale.set(1.4 + rng() * 0.8, 0.65 + rng() * 0.45, 1);
    group.add(shore);
    const lake = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), lakeMat);
    lake.position.set(spot.x, 0.012, spot.z);
    lake.rotation.x = -Math.PI / 2;
    lake.scale.copy(shore.scale);
    group.add(lake);
  }
  return group;
}

function createHills(rng) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: biome.hill, roughness: 0.95 });
  for (let i = 0; i < 6; i += 1) {
    const spot = findOpenSpot(rng, 85, 270);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(18 + rng() * 30, 14, 8), mat);
    hill.position.set(spot.x, -9.5 + rng() * 1.2, spot.z);
    hill.scale.set(1.9 + rng() * 0.8, 0.28 + rng() * 0.12, 1.0 + rng() * 0.5);
    hill.rotation.y = rng() * Math.PI;
    group.add(hill);
  }
  return group;
}

function createRoad() {
  const group = new THREE.Group();
  group.add(makeTrackMesh(ROAD_WIDTH + 8.5, 0.005, new THREE.MeshBasicMaterial({ color: 0x746f63, side: THREE.DoubleSide })));
  group.add(makeTrackMesh(ROAD_WIDTH + 0.7, 0.03, new THREE.MeshBasicMaterial({ color: 0x15191d, side: THREE.DoubleSide })));
  group.add(makeTrackMesh(ROAD_WIDTH, 0.055, new THREE.MeshBasicMaterial({ color: 0x30343a, map: makeAsphaltTexture(), side: THREE.DoubleSide })));
  group.add(makeLineStrip(-0.12, 0xffffff));
  return group;
}

function makeTrackMesh(width, y, material) {
  const vertices = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i < TRACK_SAMPLES; i += 1) {
    const s = track.samples[i];
    const left = s.point.clone().addScaledVector(s.right, -width / 2).setY(y);
    const right = s.point.clone().addScaledVector(s.right, width / 2).setY(y);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, i / 12, 1, i / 12);
  }
  for (let i = 0; i < TRACK_SAMPLES; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % TRACK_SAMPLES) * 2;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makeLineStrip(offset, color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < TRACK_SAMPLES; i += 28) {
    const s = track.samples[i];
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 4.2), mat);
    dash.position.copy(s.point).addScaledVector(s.right, offset).setY(0.06);
    dash.rotation.y = s.yaw;
    group.add(dash);
  }
  return group;
}

function createKerbs() {
  const group = new THREE.Group();
  const red = new THREE.MeshBasicMaterial({ color: 0xd82c2c });
  const white = new THREE.MeshBasicMaterial({ color: 0xf6f2ea });
  [-1, 1].forEach((side) => {
    for (let i = 0; i < TRACK_SAMPLES; i += 24) {
      const s = track.samples[i];
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 2.0), (i / 18) % 2 ? red : white);
      kerb.position.copy(s.point).addScaledVector(s.right, side * (ROAD_WIDTH / 2 + 0.35)).setY(0.08);
      kerb.rotation.y = s.yaw;
      group.add(kerb);
    }
  });
  return group;
}

function createRails() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xd5dadb });
  const corners = cornerSamples(0.055);
  corners.forEach((s) => {
    [-1, 1].forEach((side) => {
      for (let j = -2; j <= 2; j += 1) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), mat);
        post.position.copy(s.point).addScaledVector(s.right, side * 12).addScaledVector(s.tangent, j * 2.6).setY(0.55);
        group.add(post);
      }
    });
  });
  return group;
}

function createSmartProps() {
  const group = new THREE.Group();
  const tire = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const boardMat = new THREE.MeshBasicMaterial({ color: 0xf2f0e9 });
  cornerSamples(0.07).forEach((s, corner) => {
    const side = corner % 2 ? -1 : 1;
    for (let i = 0; i < 5; i += 1) {
      const stack = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 8, 16), tire);
      stack.position.copy(s.point).addScaledVector(s.right, side * 15).addScaledVector(s.tangent, i * 0.85 - 1.7).setY(0.45);
      stack.rotation.x = Math.PI / 2;
      group.add(stack);
    }
    [0.018, 0.031, 0.044].forEach((back, index) => {
      const before = sampleTrack(s.t - back);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.08), boardMat);
      board.position.copy(before.point).addScaledVector(before.right, side * 12.2).setY(1.05);
      board.rotation.y = before.yaw - side * Math.PI / 2;
      group.add(board);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.9 - index * 0.16, 0.08, 0.09), new THREE.MeshBasicMaterial({ color: 0x222222 }));
      stripe.position.copy(board.position);
      stripe.position.y += 0.12;
      stripe.rotation.copy(board.rotation);
      group.add(stripe);
    });
  });
  return group;
}

function createStartFinish() {
  const group = new THREE.Group();
  const s = sampleTrack(0);
  const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let x = -7; x < 7; x += 1) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.025, 1.2), x % 2 ? black : white);
    tile.position.copy(s.point).addScaledVector(s.right, x + 0.5).setY(0.08);
    tile.rotation.y = s.yaw;
    group.add(tile);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(20, 0.8, 0.4), new THREE.MeshBasicMaterial({ color: 0x202832 }));
  banner.position.copy(s.point).setY(5.2);
  banner.rotation.y = s.yaw;
  group.add(banner);
  [-10, 10].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 0.35), new THREE.MeshBasicMaterial({ color: 0x202832 }));
    post.position.copy(s.point).addScaledVector(s.right, side).setY(2.7);
    group.add(post);
  });
  return group;
}

function createScenery(rng) {
  const group = new THREE.Group();
  const trunk = new THREE.MeshBasicMaterial({ color: 0x8a5d36 });
  const leaf = new THREE.MeshBasicMaterial({ color: biome.tree });
  for (let i = 0; i < 34; i += 1) {
    const spot = findOpenSpot(rng, 34, 240);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.0, 7), trunk);
    stem.position.set(spot.x, 1, spot.z);
    group.add(stem);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.2 + rng() * 0.5, 2.8 + rng() * 1.2, 8), leaf);
    top.position.set(spot.x, 3, spot.z);
    group.add(top);
  }
  const s = sampleTrack(0.045);
  const standMat = new THREE.MeshBasicMaterial({ color: 0x7d878c });
  const seatMat = new THREE.MeshBasicMaterial({ color: 0x2f596f });
  const base = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 4), standMat);
  base.position.copy(s.point).addScaledVector(s.right, -30).setY(0.6);
  base.rotation.y = s.yaw;
  group.add(base);
  for (let row = 0; row < 3; row += 1) {
    const seats = new THREE.Mesh(new THREE.BoxGeometry(16, 0.34, 0.55), seatMat);
    seats.position.copy(s.point).addScaledVector(s.right, -30).addScaledVector(s.tangent, row * 0.95 - 1.1).setY(1.35 + row * 0.34);
    seats.rotation.y = s.yaw;
    group.add(seats);
  }
  return group;
}

function createCar(color, isPlayer) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b3042, roughness: 0.2, transparent: true, opacity: 0.86 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.52, 4.05), paint);
  base.position.y = 0.44;
  group.add(base);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.28, 1.25), paint);
  nose.position.set(0, 0.6, 1.15);
  group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.62, 1.22), glass);
  cabin.position.set(0, 0.92, -0.35);
  group.add(cabin);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.08, 0.32), dark);
  wing.position.set(0, 0.88, -1.95);
  group.add(wing);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.6 });
  const wheels = [];
  [[-1.16, 0.3, 1.22, true], [1.16, 0.3, 1.22, true], [-1.16, 0.3, -1.22, false], [1.16, 0.3, -1.22, false]].forEach(([x, y, z, front]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 18), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);
    pivot.userData.front = front;
    wheels.push(pivot);
    group.add(pivot);
  });

  const lampMat = new THREE.MeshBasicMaterial({ color: isPlayer ? 0xfff7cf : 0xff3440 });
  [-0.5, 0.5].forEach((x) => {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.08), lampMat);
    light.position.set(x, 0.56, isPlayer ? 2.05 : -2.05);
    group.add(light);
  });

  group.userData.wheels = wheels;
  return group;
}

function makeAsphaltTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2d3034";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i += 1) {
    const v = 34 + Math.random() * 34;
    ctx.fillStyle = `rgba(${v},${v + 1},${v + 2},${0.16 + Math.random() * 0.22})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.8, 1 + Math.random() * 1.8);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 44);
  return texture;
}

function drawMinimap() {
  const size = 148;
  const scale = 0.42;
  miniCanvas.width = size * devicePixelRatio;
  miniCanvas.height = size * devicePixelRatio;
  miniCanvas.style.width = `${size}px`;
  miniCanvas.style.height = `${size}px`;
  miniCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  miniCtx.clearRect(0, 0, size, size);
  miniCtx.lineWidth = 6;
  miniCtx.strokeStyle = "rgba(17,24,32,.2)";
  miniCtx.beginPath();
  track.samples.forEach((s, i) => {
    const x = size / 2 + s.point.x * scale;
    const y = size / 2 + s.point.z * scale;
    if (i === 0) miniCtx.moveTo(x, y);
    else miniCtx.lineTo(x, y);
  });
  miniCtx.closePath();
  miniCtx.stroke();
  miniCtx.strokeStyle = "#087d91";
  miniCtx.lineWidth = 2;
  miniCtx.stroke();
  raceCars.forEach((car) => {
    const pos = car.isPlayer ? state.pos : car.mesh.position;
    miniCtx.fillStyle = car.isPlayer ? "#b51b63" : "#111820";
    miniCtx.beginPath();
    miniCtx.arc(size / 2 + pos.x * scale, size / 2 + pos.z * scale, car.isPlayer ? 4 : 3, 0, Math.PI * 2);
    miniCtx.fill();
  });
}

function cornerSamples(threshold) {
  const corners = [];
  for (let i = 0; i < TRACK_SAMPLES; i += 24) {
    const s = track.samples[i];
    if (curvatureAt(s.t) > threshold) corners.push(s);
  }
  return corners.filter((sample, index) => index % 3 === 0).slice(0, 8);
}

function findOpenSpot(rng, minTrackDistance, maxRadius) {
  for (let attempts = 0; attempts < 80; attempts += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 70 + rng() * maxRadius;
    const spot = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.78);
    const nearest = findNearestTrack(spot);
    if (nearest.point.distanceTo(spot) > minTrackDistance) return spot;
  }
  return new THREE.Vector3(220, 0, 120);
}

function pickBiome(rng) {
  const biomes = [
    { grass: 0x4f7b3a, hill: 0x88a368, tree: 0x2f6b30, water: 0x4aa6c8, shore: 0xd2c69e, tent: 0xe8e2d7 },
    { grass: 0x6f8f4d, hill: 0xb8a86f, tree: 0x496f2f, water: 0x3d91b8, shore: 0xd8c493, tent: 0xf1f0e5 },
    { grass: 0x3f735a, hill: 0x5f8d7a, tree: 0x1f5c42, water: 0x327ca9, shore: 0xb9b08b, tent: 0xe7e1cf },
  ];
  return biomes[Math.floor(rng() * biomes.length)];
}

function difficultySettings(level = difficulty) {
  return {
    easy: { turns: 8, radius: 132, radiusJitter: 42, wave: 14, noise: 20, aiSkill: 0.76, aggression: 0.34, aiTopSpeed: 45, aiCornerSpeed: 27 },
    pro: { turns: 11, radius: 162, radiusJitter: 60, wave: 26, noise: 34, aiSkill: 0.94, aggression: 0.62, aiTopSpeed: 58, aiCornerSpeed: 34 },
    expert: { turns: 15, radius: 200, radiusJitter: 84, wave: 44, noise: 52, aiSkill: 1.08, aggression: 0.88, aiTopSpeed: 70, aiCornerSpeed: 41 },
  }[level];
}

function difficultyLabel() {
  return { easy: "Flow", pro: "Pro", expert: "Expert" }[difficulty] || "Flow";
}

function updateRenderProbe(force = false) {
  const now = performance.now();
  if (!force && now - lastRenderProbe < 1000) return;
  lastRenderProbe = now;
  try {
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const energy = pixel.reduce((sum, value) => sum + value, 0);
    renderProbeEl.textContent = energy > 40 ? `nonblank:${energy}` : `blank:${energy}`;
  } catch (error) {
    renderProbeEl.textContent = `probe-error:${error.name}`;
  }
}

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  setTimeout(() => updateRenderProbe(true), 120);
}

function held(...names) {
  return names.some((name) => keys.has(name));
}

function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function normalized(value) {
  return ((value % 1) + 1) % 1;
}

function mulberry32(initialSeed) {
  let s = initialSeed >>> 0;
  return function random() {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
