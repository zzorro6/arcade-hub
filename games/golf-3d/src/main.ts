import * as THREE from 'three';
import './style.css';
import { Editor } from './editor';
import { BALL_RADIUS, Level } from './level';
import { GRID_STEP, gridSize, type LevelData } from './levelData';
import { decodeLevel } from './levelFile';
import { listLevels, listsUserLevels, type LevelEntry } from './levelLibrary';
import { SURFACE_LIST, SURFACES, type Surface } from './surfaces';
import { Ball } from './physics';
import { generateLevel } from './generator';
import { seedForHole, finishBonus, firstGreenBonus } from './round';

const roundSeed = new URLSearchParams(location.search).get('seed') ?? crypto.randomUUID();
let roundPoints = 0;
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.type !== 'arcade-score-request') return;
  window.parent.postMessage({ type: 'arcade-score-response', requestId: event.data.requestId, score: roundPoints }, '*');
});
/** Distance to the pin before the last shot; each shot earns % of the remaining ground it covered. */
let prevDistToPin = 0;
let spinLevel = 0;
let roundEnded = false;
let greenBonusAwarded = false;
let shotStartedOnGreen = false;
let currentData: LevelData | null = null;

/** Each match plays ONE hole — par 3, 4 or 5 picked deterministically from the match seed. */
function parForSeed(): number {
  const h = seedForHole(`${roundSeed}:par`, 0);
  const r = (h % 1000) / 1000;
  return r < 0.35 ? 3 : r < 0.8 ? 4 : 5;
}
function loadRoundHole(): void {
  if (loading || roundEnded) return;
  playLevel(async () => generateLevel(seedForHole(roundSeed, 0), parForSeed()));
}
const shotGains: { label: string; pts: number }[] = [];

/** Bank proximity points: each shot scores the % of the REMAINING distance it covered.
 * 150 of 300 left → +50 pts. Then 75 of 150 left → +50 pts. Last 75 in one shot → +100 pts. */
function bankProgress(sunk = false): void {
  if (!level || prevDistToPin <= 0) return;
  const dist = sunk ? 0 : Math.hypot(ball.position.x - level.hole.x, ball.position.z - level.hole.y);
  if (dist < prevDistToPin) {
    const gain = Math.round((100 * (prevDistToPin - dist)) / prevDistToPin);
    roundPoints += gain;
    if (gain > 0) shotGains.push({ label: `Shot ${strokes}`, pts: gain });
  }
  prevDistToPin = Math.max(dist, 0.1);
}
const bonusMessages: { title: string; detail: string }[] = [];
let bonusAnimating = false;

function animateBonus(title: string, detail: string): void {
  bonusMessages.push({ title, detail });
  if (!bonusAnimating) playBonusMessage();
}

function playBonusMessage(): void {
  const message = bonusMessages.shift();
  if (!message) {
    bonusAnimating = false;
    return;
  }
  bonusAnimating = true;
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:38%;left:50%;width:max-content;max-width:88vw;box-sizing:border-box;padding:18px 24px;text-align:center;border:2px solid #ffd45a;border-radius:20px;background:linear-gradient(135deg,#204d80f5,#102d50f5);color:#ffd45a;box-shadow:0 12px 40px #0008;z-index:10000;pointer-events:none;font-family:inherit;';
  panel.setAttribute('role', 'status');
  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:clamp(20px,5vw,34px);font-weight:900;';
  heading.textContent = message.title;
  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'margin-top:6px;color:#fff;font-size:clamp(14px,3.5vw,20px);';
  subtitle.textContent = message.detail;
  panel.append(heading, subtitle);
  document.body.append(panel);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = panel.animate([
    { opacity: 0, transform: `translate(-50%, ${reduced ? '0' : '20px'}) scale(${reduced ? 1 : 0.8})`, offset: 0 },
    { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.12 },
    { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.85 },
    { opacity: 0, transform: `translate(-50%, ${reduced ? '0' : '-16px'}) scale(1)`, offset: 1 },
  ], { duration: 2600, easing: 'ease-out', fill: 'forwards' });
  animation.onfinish = () => {
    panel.remove();
    playBonusMessage();
  };
}

function awardGreenBonus(sunk = false): void {
  if (greenBonusAwarded || shotStartedOnGreen || (!sunk && level.surfaceAt(ball.position.x, ball.position.z) !== 'green')) return;
  greenBonusAwarded = true;
  const points = firstGreenBonus(sunk ? 0 : distanceToPin() / 0.9144);
  roundPoints += points;
  shotGains.push({ label: 'First green', pts: points });
  const title = points === 400 ? 'Great Shot' : points === 300 ? 'Good Shot' : points === 200 ? 'Meh Shot' : 'Bad Shot';
  const range = points === 400 ? 'Within 6 yards' : points === 300 ? 'Within 10 yards' : points === 200 ? 'Within 15 yards' : 'Over 15 yards';
  animateBonus(`${title} +${points}`, `${range} · First green finish`);
}

function finishRoundHole(sunk: boolean): void {
  if (roundEnded) return;
  bankProgress(sunk);
  if (sunk) {
    awardGreenBonus(true);
    if (!shotStartedOnGreen) {
      roundPoints += 1000;
      shotGains.push({ label: 'Off-green hole-out', pts: 1000 });
      animateBonus('NICE CHIP IN +1000', 'Holed out from off the green!');
    }
  }
  const bonus = finishBonus(level.par, strokes, sunk);
  roundPoints += bonus;
  roundEnded = true;
  showResult();
  const resultName = hud.resultTitle.textContent ?? '';
  hud.resultTitle.textContent = sunk ? resultName : 'Stroke limit reached';
  hud.resultDetail.innerHTML =
    shotGains.map((g) => `<div class="score-row"><span>${g.label}</span><b>+${g.pts}</b></div>`).join('') +
    (bonus > 0 ? `<div class="score-row total"><span>${resultName}</span><b>+${bonus}</b></div>` : '') +
    `<div class="score-row final"><span>Final score</span><b>${roundPoints}</b></div>`;
  hud.result.hidden = false;
  $('result-again').textContent = 'Round complete';
  ($('result-again') as HTMLButtonElement).disabled = true;
  window.parent.postMessage({ type: 'pro-golf-gameover', score: roundPoints, seed: roundSeed }, '*');
}

interface Club {
  name: string;
  /** Launch angle (radians). */
  loft: number;
  /** Ball speed at full power (m/s). */
  maxSpeed: number;
  /** Backspin at full power (rad/s); scales with power. */
  spin: number;
  /** Sidespin per degree of swing path off the target line, at full power (rad/s per degree). */
  sideSpin: number;
}

const deg = (d: number) => (d * Math.PI) / 180;
const CLUBS: Club[] = [
  { name: 'Driver', loft: deg(26), maxSpeed: 52, spin: 120, sideSpin: 180 / 12 },
  { name: 'Iron', loft: deg(38), maxSpeed: 31, spin: 400, sideSpin: 95 / 12 },
  { name: 'Wedge', loft: deg(52), maxSpeed: 21, spin: 250, sideSpin: 30 / 12 },
  { name: 'Putter', loft: 0, maxSpeed: 7, spin: 0, sideSpin: 0 },
];
/**
 * Swing path off the target line (the camera's view direction) beyond which sidespin stops
 * growing. A full-power driver aimed 12° right draws back to about the target line.
 */
const MAX_PATH_ANGLE = deg(48);
/** Lowest launch angle a downhill lie can reduce a club to. */
const MIN_LOFT = deg(4);
/**
 * Degrees of swing path per degree of sidehill slope. Ground rising to the right puts the
 * ball above the feet, which closes the face: a draw bias. Ball below the feet fades.
 */
const SIDEHILL_PATH_BIAS = 1.5;
const PUTTER = CLUBS.length - 1;
const LIE_NAMES: Record<Surface, string> = {
  tee: 'Tee',
  fairway: 'Fairway',
  green: 'Green',
  rough: 'Rough',
  bunker: 'Bunker',
  water: 'Water',
  oob: 'Out of bounds',
};
/** Shots from bad lies come off shorter: rough half distance, sand a quarter. */
const LIE_SPEED: Partial<Record<Surface, number>> = { rough: 0.75, bunker: 0.25 };
/** Sand still launches with extra spin. */
const BUNKER_SPIN = 1.5;
/** The camera faces a point this far down the fairway (m) rather than the far-off pin. */
const AIM_AHEAD = 180;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hud = {
  par: $('par'),
  length: $('length'),
  loading: $('loading'),
  pinMarker: $('pin-marker'),
  infoPanel: $('info'),
  windPanel: $('wind'),
  pinDist: $('pin-dist'),
  pinElev: $('pin-elev'),
  pinLeftDeg: $('pin-left-deg'),
  pinRightDeg: $('pin-right-deg'),
  strokes: $('strokes'),
  club: $('club'),
  lie: $('lie'),
  slope: $('slope'),
  windArrow: document.getElementById('wind-arrow') as unknown as SVGPathElement,
  windSpeed: $('wind-speed'),
  windRelative: $('wind-relative'),
  power: $('power'),
  powerFill: $('power-fill'),
  powerLabel: $('power-label'),
  toast: $('toast'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultDetail: $('result-detail'),
  root: $('hud'),
  start: $('start'),
  officialLevels: $('official-levels'),
  userSection: $('user-section'),
  userLevels: $('user-levels'),
  startError: $('start-error'),
  fileInput: $<HTMLInputElement>('file-input'),
  dragLine: document.getElementById('drag-line') as unknown as SVGLineElement,
  map: $('minimap') as unknown as HTMLCanvasElement,
  mapPanel: $('map'),
  mapLabel: $('map-label'),
};

// --- Renderer, scene, lighting -------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('app').appendChild(renderer.domElement);

const HORIZON = new THREE.Color(0xcfe7f7);
const scene = new THREE.Scene();
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 150, 520);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(700, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x4a90d9) }, horizon: { value: HORIZON } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        float t = clamp(vDir.y * 1.6, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(t, 0.7)), 1.0);
        #include <colorspace_fragment>
      }`,
  }),
);
scene.add(sky);

// Fog hides everything past ~520 m, so the far plane can cull distant terrain tiles.
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 900);

scene.add(new THREE.HemisphereLight(0xd8ecff, 0x4b6b2f, 1.1));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(40, 70, 25);

// --- Ball and aiming visuals -----------------------------------------------

function makeBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f7f7f4';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0, 0, 0, 0.07)';
  for (let i = 0; i < 600; i++) {
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 128, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  // Alignment line so the roll is visible.
  g.fillStyle = '#d63a2f';
  g.fillRect(0, 61, 256, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
  new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.35 }),
);
ballMesh.castShadow = true;
scene.add(ballMesh);

const readyRing = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.27, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }),
);
scene.add(readyRing);

const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x5bd65b, depthTest: false, transparent: true, opacity: 0.9 });
const arrowShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.035, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5),
  arrowMaterial,
);
const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 12).rotateX(Math.PI / 2), arrowMaterial);
const arrow = new THREE.Group();
arrow.add(arrowShaft, arrowHead);
arrow.renderOrder = 10;
arrowShaft.renderOrder = 10;
arrowHead.renderOrder = 10;
arrow.visible = false;
scene.add(arrow);

// Target line: the camera's view direction, which the swing path is measured against.
const targetLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 14)]),
  new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.3, transparent: true, opacity: 0.6, depthTest: false }),
);
targetLine.computeLineDistances();
targetLine.renderOrder = 9;
targetLine.visible = false;
scene.add(targetLine);

// Shot preview: simulated flight path and where the ball will come to rest.
const trajectory = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
);
trajectory.renderOrder = 11;
trajectory.visible = false;
scene.add(trajectory);

const landingRing = new THREE.Mesh(
  new THREE.RingGeometry(0.45, 0.6, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
);
landingRing.renderOrder = 11;
landingRing.visible = false;
scene.add(landingRing);

const carryDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.9, depthWrite: false }),
);
carryDot.renderOrder = 11;
carryDot.visible = false;
scene.add(carryDot);

// Green read: a grid of flat arrows pointing downhill, so break direction is visible.
const greenArrows = new THREE.Group();
greenArrows.visible = false;
scene.add(greenArrows);
let arrowsOn = true;

/** Lays arrows over the green pointing along each spot's downhill direction. */
function buildGreenArrows(): void {
  greenArrows.clear();
  if (!level || !currentData) return;
  const greenId = SURFACE_LIST.indexOf('green');
  const { cols, rows } = gridSize(level.width, level.length);
  let minC = cols;
  let maxC = -1;
  let minR = rows;
  let maxR = -1;
  const surface = currentData.grids.surface;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (surface[r * cols + c] !== greenId) continue;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  if (maxC < 0) return;

  // Thin flat chevron lying on the grass, like the reference game's break indicators.
  const shape = new THREE.Shape();
  shape.moveTo(-0.4, -0.15);
  shape.lineTo(0, 0.05);
  shape.lineTo(0.4, -0.15);
  shape.lineTo(0.4, 0.02);
  shape.lineTo(0, 0.22);
  shape.lineTo(-0.4, 0.02);
  shape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const nrm = new THREE.Vector3();
  for (let z = minR * GRID_STEP - 1; z <= maxR * GRID_STEP + 1; z += 1.6) {
    for (let x = minC * GRID_STEP - 1; x <= maxC * GRID_STEP + 1; x += 1.6) {
      if (level.surfaceAt(x, z) !== 'green') continue;
      level.normalAt(x, z, nrm);
      const dx = nrm.x;
      const dz = nrm.z;
      const slope = Math.hypot(dx, dz);
      if (slope < 0.012) continue;
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(x, level.heightAt(x, z) + 0.05, z);
      arrow.rotation.y = Math.atan2(dx, dz) + Math.PI;
      // Steeper greens get slightly bigger, more opaque arrows.
      const s = 0.55 + Math.min(1, slope * 5) * 0.45;
      arrow.scale.setScalar(s);
      greenArrows.add(arrow);
    }
  }
}

interface Prediction { points: THREE.Vector3[]; end: THREE.Vector3; carryPos: THREE.Vector3; carry: number; total: number; surface: string }
let prediction: Prediction | null = null;
let predictAt = 0;
/** Aim state the last prediction was computed from, so tiny pointer jitter doesn't re-sim. */
const lastSim = { power: -1, path: 0, spin: 0, club: -1 };
/** Smoothed position of the landing ring; eases toward each new prediction. */
const markerPos = new THREE.Vector3();
let markerInit = false;

/** Replays the exact shot physics on a throwaway ball and records the flight path. */
function simulateShot(): void {
  const club = CLUBS[clubIndex];
  const ghost = new Ball(level);
  ghost.placeAt(ball.position);
  const lie = level.surfaceAt(ball.position.x, ball.position.z);
  const inSand = lie === 'bunker';
  const speed = club.maxSpeed * aim.power * (LIE_SPEED[lie] ?? 1);
  const backspin = clubIndex === PUTTER ? -speed / BALL_RADIUS : (club.spin - spinLevel * 60) * aim.power * (inSand ? BUNKER_SPIN : 1);
  const { loft, path } = shotParams();
  ghost.strike(aim.dir, speed, loft, backspin, -club.sideSpin * aim.power * ((path * 180) / Math.PI));

  const points: THREE.Vector3[] = [ghost.position.clone()];
  let carry = -1;
  const carryPos = new THREE.Vector3();
  const start = ball.position;
  for (let i = 0; i < 1200; i++) {
    const event = ghost.update(1 / 30);
    if (carry < 0 && ghost.position.y - BALL_RADIUS <= level.heightAt(ghost.position.x, ghost.position.z) + 0.01 && i > 3) {
      carry = Math.hypot(ghost.position.x - start.x, ghost.position.z - start.z);
      carryPos.copy(ghost.position);
    }
    if (i % 3 === 0) points.push(ghost.position.clone());
    if (event) break;
  }
  points.push(ghost.position.clone());
  const end = ghost.position;
  const surface = ball.position.equals(end) ? '' : LIE_NAMES[level.surfaceAt(end.x, end.z)];
  prediction = {
    points,
    end: end.clone(),
    carryPos: carry < 0 ? end.clone() : carryPos,
    carry: carry < 0 ? Math.hypot(end.x - start.x, end.z - start.z) : carry,
    total: Math.hypot(end.x - start.x, end.z - start.z),
    surface,
  };
}

// --- Game state ------------------------------------------------------------

type State = 'ready' | 'aiming' | 'flying' | 'won';

// Both are set once the first level is chosen; nothing reads them before then.
let level!: Level;
let ball!: Ball;
let strokes = 0;
let loading = false;
/** True while play-testing from the editor: leaving the hole goes back to it. */
let fromEditor = false;
let state: State = 'ready';
let clubIndex = 0;
let wonTimer = -1;
const lastRest = new THREE.Vector3();

const rig = { target: new THREE.Vector3(), yaw: 0, pitch: 0.3, distance: 8, yawGoal: null as number | null };
/** `path` is the signed angle of the shot from the target line; positive is right (in-to-out). */
const aim = { pointerX: 0, pointerY: 0, power: 0, path: 0, dir: new THREE.Vector3() };
const drag = { mode: null as 'aim' | 'orbit' | null, lastX: 0, lastY: 0, pointerId: -1 };

function startHole(): void {
  lastRest.copy(level.tee);
  strokes = 0;
  prevDistToPin = Math.hypot(level.tee.x - level.hole.x, level.tee.z - level.hole.y);
  state = 'ready';
  wonTimer = -1;
  hud.result.hidden = true;
  rig.target.copy(ball.position);
  rig.yaw = yawDownFairway();
  rig.yawGoal = null;
  rig.pitch = 0.3;
  rig.distance = 8;
  autoSelectClub();
  hud.par.textContent = String(level.par);
  hud.length.textContent = Math.round(level.distance * 1.09361).toLocaleString();
}

/** Starts the current hole over from the tee. */
function replayHole(): void {}

/** Loads a level and starts playing it. Building one takes a moment, so show a message first. */
async function playLevel(load: () => Promise<LevelData>, testing = false): Promise<void> {
  if (loading) return;
  loading = true;
  fromEditor = testing;
  for (const id of ['menu', 'result-menu']) $(id).textContent = testing ? 'Editor' : 'Levels';
  hud.startError.hidden = true;
  hud.loading.hidden = false;
  try {
    const data = await load();
    currentData = data;
    bakeMinimap(data);
    // Wait two frames so the message is painted before the main thread is busy.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const next = new Level(data);
    if (level) {
      scene.remove(level.group);
      level.dispose();
    }
    level = next;
    scene.add(level.group);
    buildGreenArrows();
    if (ball) ball.setLevel(level);
    else ball = new Ball(level);
    hud.start.hidden = true;
    hud.root.hidden = false;
    startHole();
  } catch (err) {
    if (testing) {
      alert(`Couldn't play this level: ${errorMessage(err)}`);
      editor.show();
    } else {
      hud.startError.textContent = errorMessage(err);
      hud.startError.hidden = false;
    }
  } finally {
    hud.loading.hidden = true;
    loading = false;
  }
}

/** Leaves the hole: back to the editor when play-testing, otherwise to the level list. */
function leaveHole(): void {
  hud.result.hidden = true;
  if (fromEditor) {
    fromEditor = false;
    hud.root.hidden = true;
    editor.show();
  } else {
    showLevelList();
  }
}

function showLevelList(): void {
  hud.result.hidden = true;
  hud.root.hidden = true;
  hud.start.hidden = false;
}

const editor = new Editor({
  playTest: (data) => {
    editor.hide();
    playLevel(async () => data, true);
  },
  exit: showLevelList,
});

function fillLevelList(): void {
  const entries = listLevels();
  const fill = (list: HTMLElement, source: LevelEntry['source']) => {
    const mine = entries.filter((e) => e.source === source);
    list.replaceChildren(
      ...(mine.length === 0
        ? [Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No levels yet.' })]
        : mine.map((entry) => {
            const button = Object.assign(document.createElement('button'), { type: 'button', textContent: entry.title });
            button.addEventListener('click', () => playLevel(entry.load));
            const li = document.createElement('li');
            li.append(button);
            return li;
          })),
    );
  };
  fill(hud.officialLevels, 'official');
  fill(hud.userLevels, 'user');
  hud.userSection.hidden = !listsUserLevels;
}

/** Distance left to play, measured along the fairway. */
function distanceToPin(): number {
  return level.remainingDistance(ball.position.x, ball.position.z);
}

const _ahead = new THREE.Vector2();

/** The point the camera and wind readout face: a long shot down the fairway, or the pin. */
function targetAhead(): THREE.Vector2 {
  return level.targetAhead(ball.position.x, ball.position.z, AIM_AHEAD, _ahead);
}

function yawDownFairway(): number {
  const t = targetAhead();
  return Math.atan2(-(t.x - ball.position.x), -(t.y - ball.position.z));
}

function autoSelectClub(): void {
  const lie = level.surfaceAt(ball.position.x, ball.position.z);
  const d = distanceToPin();
  clubIndex = lie === 'green' ? PUTTER : lie === 'bunker' && d < 70 ? 2 : d > 120 ? 0 : d > 55 ? 1 : 2;
}

function onBallStopped(): void {
  state = 'ready';
  // On the green the flagstick hovers above the cup so putts can't hit it.
  level.liftPin(level.surfaceAt(ball.position.x, ball.position.z) === 'green');
  autoSelectClub();
  rig.yawGoal = yawDownFairway();
  bankProgress();
  // Live score: the hub records it so a player who closes mid-round still counts.
  window.parent.postMessage({ type: 'pro-golf-progress', score: roundPoints, seed: roundSeed }, '*');
  spinLevel = 0;
  spinValue.textContent = 'Spin: neutral';
  if (strokes >= level.par + 5) {
    state = 'won';
    finishRoundHole(false);
  }
}

const _lieNormal = new THREE.Vector3();

/** True where a placed ball can rest: over land, in bounds, and on ground flat enough to hold it. */
function isRestable(x: number, z: number): boolean {
  if (!Number.isNaN(level.waterLevelAt(x, z)) || level.isOutOfBounds(x, z)) return false;
  const height = level.heightAt(x, z);
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const px = x + Math.cos(angle) * 4;
    const pz = z + Math.sin(angle) * 4;
    if (level.isOutOfBounds(px, pz) || !Number.isNaN(level.waterLevelAt(px, pz)) || Math.abs(level.heightAt(px, pz) - height) > 0.7) return false;
  }
  const n = level.normalAt(x, z, _lieNormal);
  if (n.y < Math.cos(8 * Math.PI / 180)) return false;
  const surface = SURFACES[level.surfaceAt(x, z)];
  const pull = Math.sqrt(1 - n.y * n.y) * (5 / 7);
  const hold = surface.rolling * n.y;
  return pull < hold;
}

/** Walks from the hazard crossing back toward where the shot was hit; first restable spot wins. */
function findDropSpot(crossing: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
  const steps = Math.max(1, Math.ceil(crossing.distanceTo(origin) / 1.5)) + 8;
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(1, i / steps);
    const x = crossing.x + (origin.x - crossing.x) * t;
    const z = crossing.z + (origin.z - crossing.z) * t;
    if (isRestable(x, z)) return new THREE.Vector3(x, 0, z);
  }
  return origin;
}

/** Slope of the ground under the ball (radians): `up` along `dir`, `side` rising to the right of it. */
function lieAngles(dir: THREE.Vector3): { up: number; side: number } {
  const n = level.normalAt(ball.position.x, ball.position.z, _lieNormal);
  const gx = -n.x / n.y;
  const gz = -n.z / n.y;
  return { up: Math.atan(gx * dir.x + gz * dir.z), side: Math.atan(gx * -dir.z + gz * dir.x) };
}

/** Launch angle and effective swing path for the current aim, including the lie's slope. */
function shotParams(): { loft: number; path: number } {
  const club = CLUBS[clubIndex];
  if (clubIndex === PUTTER) return { loft: club.loft, path: 0 };
  const lie = lieAngles(aim.dir);
  return {
    // Uphill lies add loft; downhill lies take it away.
    loft: Math.max(MIN_LOFT, club.loft + lie.up),
    path: THREE.MathUtils.clamp(aim.path + lie.side * SIDEHILL_PATH_BIAS, -MAX_PATH_ANGLE, MAX_PATH_ANGLE),
  };
}

function shoot(): void {
  const club = CLUBS[clubIndex];
  lastRest.copy(ball.position);
  const lie = level.surfaceAt(ball.position.x, ball.position.z);
  shotStartedOnGreen = lie === 'green';
  const inSand = lie === 'bunker';
  const speed = club.maxSpeed * aim.power * (LIE_SPEED[lie] ?? 1);
  // A putt leaves the face already rolling (topspin matching its speed) so it doesn't skid.
  const backspin = clubIndex === PUTTER ? -speed / BALL_RADIUS : (club.spin - spinLevel * 60) * aim.power * (inSand ? BUNKER_SPIN : 1);
  // An in-to-out path (aimed right of the target line) draws; out-to-in fades.
  const { loft, path } = shotParams();
  // Negative: positive spin.y curves left, so negate to curve the way the player aims.
  const sidespin = -club.sideSpin * aim.power * ((path * 180) / Math.PI);
  ball.strike(aim.dir, speed, loft, backspin, sidespin);
  strokes++;
  state = 'flying';
}

function formatToPar(diff: number): string {
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff);
}

function showResult(): void {
  const diff = strokes - level.par;
  const names: Record<string, string> = {
    '-3': 'Albatross!',
    '-2': 'Eagle!',
    '-1': 'Birdie!',
    '0': 'Par',
    '1': 'Bogey',
    '2': 'Double bogey',
    '3': 'Triple bogey',
    '4': 'Quadruple bogey',
    '5': 'Quintuple bogey',
  };
  hud.resultTitle.textContent = strokes === 1 ? 'Hole in one!' : (names[String(diff)] ?? `${diff > 0 ? '+' : ''}${diff}`);
  hud.resultDetail.textContent = `${strokes} stroke${strokes === 1 ? '' : 's'} (${formatToPar(diff)}) on a ${Math.round(level.distance).toLocaleString()} m par ${level.par}.`;
  hud.result.hidden = false;
  $('result-again').focus();
}

let toastTimer = 0;
function toast(message: string): void {
  hud.toast.textContent = message;
  hud.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => hud.toast.classList.remove('show'), 2200);
}

// --- Input -----------------------------------------------------------------

const _v = new THREE.Vector3();

function ballScreenPosition(): { x: number; y: number; radius: number } {
  _v.copy(ball.position).project(camera);
  const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
  const dist = camera.position.distanceTo(ball.position);
  const radius = (BALL_RADIUS / (dist * Math.tan(deg(camera.fov / 2)))) * (window.innerHeight / 2);
  return { x, y, radius };
}

function maxDragPixels(): number {
  return Math.min(260, Math.max(140, window.innerHeight * 0.3));
}

/** Pull-back aiming: drag down to charge power; dragging left/right aims that same way. */
function updateAim(): void {
  const s = ballScreenPosition();
  const dx = aim.pointerX - s.x;
  const dy = aim.pointerY - s.y;
  const len = Math.hypot(dx, dy);
  aim.power = Math.min(1, len / maxDragPixels());
  if (len > 1e-3) {
    // Camera's horizontal basis: forward is down-screen, right is screen-right.
    const fx = -Math.sin(rig.yaw);
    const fz = -Math.cos(rig.yaw);
    const rx = -fz;
    const rz = fx;
    // Sideways drag deflects the aim; a mostly-horizontal drag caps at the draw/fade limit.
    const theta = THREE.MathUtils.clamp(
      Math.atan2(dx * 0.9, Math.max(dy, len * 0.05)),
      -MAX_PATH_ANGLE * 0.9,
      MAX_PATH_ANGLE * 0.9,
    );
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    aim.dir.set(fx * c + rx * sn, 0, fz * c + rz * sn).normalize();
    aim.path = theta;
  }
}

const canvas = renderer.domElement;

canvas.addEventListener('pointerdown', (e) => {
  if (drag.mode) return;
  const s = ballScreenPosition();
  const nearBall = Math.hypot(e.clientX - s.x, e.clientY - s.y) < Math.max(30, s.radius * 2.5);
  if (e.button === 0 && state === 'ready' && nearBall) {
    drag.mode = 'aim';
    state = 'aiming';
    aim.pointerX = e.clientX;
    aim.pointerY = e.clientY;
    aim.power = 0;
    rig.yawGoal = null;
  } else if (e.button === 0 || e.button === 2) {
    drag.mode = 'orbit';
  } else {
    return;
  }
  drag.pointerId = e.pointerId;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drag.pointerId) return;
  if (drag.mode === 'aim') {
    aim.pointerX = e.clientX;
    aim.pointerY = e.clientY;
  } else if (drag.mode === 'orbit') {
    rig.yaw -= (e.clientX - drag.lastX) * 0.006;
    rig.pitch = THREE.MathUtils.clamp(rig.pitch + (e.clientY - drag.lastY) * 0.004, 0.05, 1.45);
    rig.yawGoal = null;
  }
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
});

function endDrag(e: PointerEvent, cancelled: boolean): void {
  if (e.pointerId !== drag.pointerId) return;
  if (drag.mode === 'aim' && state === 'aiming') {
    updateAim();
    if (!cancelled && aim.power > 0.03) shoot();
    else state = 'ready';
  }
  drag.mode = null;
  drag.pointerId = -1;
}

canvas.addEventListener('pointerup', (e) => endDrag(e, false));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    rig.distance = THREE.MathUtils.clamp(rig.distance * Math.exp(e.deltaY * 0.0012), 2.5, 150);
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  // The level list and the editor cover the game; keys don't reach it.
  if (!hud.start.hidden || editor.visible) return;
  const key = e.key.toLowerCase();
  if (key === 'escape' && state === 'aiming') {
    state = 'ready';
    drag.mode = null;
    drag.pointerId = -1;
  } else if (key === 'escape' && fromEditor && !loading) {
    leaveHole();
  } else if (key === 'c' && (state === 'ready' || state === 'aiming')) {
    clubIndex = (clubIndex + 1) % CLUBS.length;
  } else if (key === 'enter' && state === 'won' && !hud.result.hidden) {
    e.preventDefault();
    replayHole();
  }
});

$('menu').addEventListener('click', leaveHole);
$('result-again').addEventListener('click', replayHole);
$('result-menu').addEventListener('click', leaveHole);
$('editor-start').addEventListener('click', () => {
  hud.start.hidden = true;
  editor.show();
});
$('open-file').addEventListener('click', () => hud.fileInput.click());
hud.fileInput.addEventListener('change', () => {
  const file = hud.fileInput.files?.[0];
  // Clear it so choosing the same file again still fires a change.
  hud.fileInput.value = '';
  if (file) playLevel(() => readLevelFile(file));
});

/** Reads a level from a file the player picked, naming the file in any error. */
async function readLevelFile(file: File): Promise<LevelData> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name}: Not a level file (it isn't JSON)`);
  }
  try {
    return await decodeLevel(json);
  } catch (err) {
    throw new Error(`${file.name}: ${errorMessage(err)}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Frame loop --------------------------------------------------------------

const _normal = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function updateCamera(dt: number): void {
  const follow = 1 - Math.exp(-dt * (ball.moving ? 5 : 8));
  rig.target.lerp(ball.position, follow);
  if (rig.yawGoal !== null) {
    const diff = Math.atan2(Math.sin(rig.yawGoal - rig.yaw), Math.cos(rig.yawGoal - rig.yaw));
    rig.yaw += diff * (1 - Math.exp(-dt * 3));
    if (Math.abs(diff) < 0.002) rig.yawGoal = null;
  }
  const cp = Math.cos(rig.pitch);
  camera.position.set(
    rig.target.x + Math.sin(rig.yaw) * cp * rig.distance,
    rig.target.y + Math.sin(rig.pitch) * rig.distance,
    rig.target.z + Math.cos(rig.yaw) * cp * rig.distance,
  );
  const minY = level.heightAt(camera.position.x, camera.position.z) + 0.4;
  if (camera.position.y < minY) camera.position.y = minY;
  const focusY = rig.target.y + 0.3;
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    const x = rig.target.x + (camera.position.x - rig.target.x) * t;
    const z = rig.target.z + (camera.position.z - rig.target.z) * t;
    const clearance = 0.12 + 0.4 * t;
    const requiredY = focusY + (level.heightAt(x, z) + clearance - focusY) / t;
    camera.position.y = Math.max(camera.position.y, requiredY);
  }
  camera.lookAt(rig.target.x, focusY, rig.target.z);
  sky.position.copy(camera.position);
  sun.position.copy(rig.target).add(SUN_OFFSET);
  sun.target.position.copy(rig.target);
}

function updateAimVisuals(time: number): void {
  const p = ball.position;
  readyRing.visible = state === 'ready';
  if (readyRing.visible) {
    level.normalAt(p.x, p.z, _normal);
    readyRing.position.set(p.x, p.y - BALL_RADIUS + 0.015, p.z);
    readyRing.quaternion.setFromUnitVectors(Z_AXIS, _normal);
    readyRing.scale.setScalar(1 + Math.sin(time * 4) * 0.12);
  }

  const aiming = state === 'aiming';
  arrow.visible = aiming && aim.power > 0.01;
  targetLine.visible = aiming && clubIndex !== PUTTER;
  hud.power.hidden = !aiming;
  hud.dragLine.style.visibility = aiming ? 'visible' : 'hidden';
  if (!aiming) {
    trajectory.visible = false;
    landingRing.visible = false;
    carryDot.visible = false;
    prediction = null;
    return;
  }

  updateAim();
  // Re-run the sim only when the aim meaningfully changes (20×/s max); jitter won't move the marker.
  const aimChanged =
    Math.abs(aim.power - lastSim.power) > 0.008 ||
    Math.abs(aim.path - lastSim.path) > 0.006 ||
    lastSim.spin !== spinLevel ||
    lastSim.club !== clubIndex;
  if (aim.power > 0.03 && aimChanged && time - predictAt > 1 / 20) {
    predictAt = time;
    lastSim.power = aim.power;
    lastSim.path = aim.path;
    lastSim.spin = spinLevel;
    lastSim.club = clubIndex;
    simulateShot();
  }
  const showPrediction = !!prediction && aim.power > 0.03;
  trajectory.visible = showPrediction && clubIndex !== PUTTER;
  landingRing.visible = showPrediction;
  carryDot.visible = showPrediction && clubIndex !== PUTTER;
  if (showPrediction && prediction) {
    trajectory.geometry.setFromPoints(prediction.points);
    if (!markerInit) {
      markerPos.set(prediction.end.x, 0, prediction.end.z);
      markerInit = true;
    }
    markerPos.lerp(_v.set(prediction.end.x, 0, prediction.end.z), 0.3);
    landingRing.position.set(markerPos.x, level.heightAt(markerPos.x, markerPos.z) + 0.06, markerPos.z);
    landingRing.material.color.set(prediction.surface === 'Water' || prediction.surface === 'Out of bounds' ? 0xff5544 : prediction.surface === 'Green' ? 0x7dff8a : 0xffffff);
    carryDot.position.copy(prediction.carryPos);
  } else {
    markerInit = false;
  }
  const club = CLUBS[clubIndex];
  const length = 0.6 + aim.power * 5;
  arrow.position.set(p.x, p.y + 0.05, p.z);
  arrow.rotation.set(-shotParams().loft, Math.atan2(aim.dir.x, aim.dir.z), 0, 'YXZ');
  arrowShaft.scale.set(1, 1, length);
  arrowHead.position.set(0, 0, length);
  arrowMaterial.color.setHSL((1 - aim.power) * 0.33, 0.85, 0.55);

  hud.powerFill.style.width = `${aim.power * 100}%`;
  const yardage = prediction ? (clubIndex === PUTTER ? `${Math.round(prediction.total * 1.09361)} yd` : `${Math.round(prediction.carry * 1.09361)} yd carry · ${Math.round(prediction.total * 1.09361)} yd`) : '';
  hud.powerLabel.textContent = clubIndex === PUTTER ? `${club.name}${yardage ? ` · ${yardage}` : ''}` : `${club.name} · ${shotShape()}${yardage ? ` · ${yardage}` : ''}`;
  targetLine.position.set(p.x, p.y, p.z);
  targetLine.rotation.y = rig.yaw + Math.PI;
  const s = ballScreenPosition();
  hud.dragLine.setAttribute('x1', String(s.x));
  hud.dragLine.setAttribute('y1', String(s.y));
  hud.dragLine.setAttribute('x2', String(aim.pointerX));
  hud.dragLine.setAttribute('y2', String(aim.pointerY));
}

const _ballWind = new THREE.Vector3();

/** Wind where the ball is, which is what the HUD shows. */
function ballWind(): THREE.Vector3 {
  return level.windAt(ball.position.x, ball.position.z, _ballWind);
}

/** Describes the wind relative to the line the camera turns to after each shot (down the fairway). */
function windRelativeLabel(): string {
  const w = ballWind();
  const speed = w.length();
  if (speed < 0.5) return 'Calm';
  const t = targetAhead();
  const hx = t.x - ball.position.x;
  const hz = t.y - ball.position.z;
  const len = Math.hypot(hx, hz) || 1;
  const along = (w.x * hx + w.z * hz) / (len * speed);
  // Positive when the wind blows to the right of the pin line.
  const cross = (w.x * -hz + w.z * hx) / (len * speed);
  if (along > 0.75) return 'Helping';
  if (along < -0.75) return 'Into you';
  const side = cross > 0 ? 'left to right' : 'right to left';
  return along > 0.3 ? `Helping, ${side}` : along < -0.3 ? `Into, ${side}` : `Cross, ${side}`;
}

function updateWindIndicator(): void {
  const w = ballWind();
  // Rotate so "up" on the dial is the camera's view direction.
  const fx = -Math.sin(rig.yaw);
  const fz = -Math.cos(rig.yaw);
  const angle = Math.atan2(w.x * -fz + w.z * fx, w.x * fx + w.z * fz);
  hud.windArrow.setAttribute('transform', `rotate(${(angle * 180) / Math.PI})`);
  hud.windArrow.style.visibility = w.length() < 0.5 ? 'hidden' : 'visible';
  hud.windSpeed.textContent = `${(w.length() * 2.23694).toFixed(1)} mph`;
  hud.windRelative.textContent = windRelativeLabel();
}

function shotShape(): string {
  const { path } = shotParams();
  const amount = Math.abs(path) / MAX_PATH_ANGLE;
  if (amount < 0.06) return 'Straight';
  const shape = path > 0 ? 'Curve right' : 'Curve left';
  // Sidespin stops growing past MAX_PATH_ANGLE.
  if (amount < 0.25) return `Slight ${shape.toLowerCase()}`;
  if (amount < 0.6) return shape;
  return amount < 0.95 ? `Big ${shape.toLowerCase()}` : `Max ${shape.toLowerCase()}`;
}

/**
 * Places the pin marker at a fixed height, horizontally over the pin's bearing from the
 * camera. Off screen, it sticks to that edge and shows how far to turn to face the pin.
 */
function updatePinMarker(): void {
  const el = hud.pinMarker;
  el.hidden = state === 'won';
  if (el.hidden) return;

  const d = distanceToPin() * 1.09361;
  hud.pinDist.textContent = `${d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString()} yd`;
  const rise = level.rimY - (ball.position.y - BALL_RADIUS);
  hud.pinElev.textContent = Math.abs(rise) < 0.1 ? 'level' : `${rise > 0 ? '↑' : '↓'} ${Math.abs(rise).toFixed(1)} m`;

  // Pin bearing from the camera's view direction, positive to the right.
  const fx = -Math.sin(rig.yaw);
  const fz = -Math.cos(rig.yaw);
  const dx = level.hole.x - camera.position.x;
  const dz = level.hole.y - camera.position.z;
  const bearing = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
  const halfFov = Math.atan(Math.tan(deg(camera.fov / 2)) * camera.aspect);

  const w = window.innerWidth;
  const onScreen = Math.abs(bearing) < halfFov;
  const x = onScreen ? w / 2 + (Math.tan(bearing) / Math.tan(halfFov)) * (w / 2) : bearing < 0 ? 0 : w;

  // Level with the wind panel, and kept in the gap between the side panels.
  const info = hud.infoPanel.getBoundingClientRect();
  const wind = hud.windPanel.getBoundingClientRect();
  el.style.top = `${wind.top + wind.height / 2 - el.offsetHeight / 2}px`;
  // Fixed half-width: using offsetWidth makes the arrow-on/off state feed back
  // into the clamp and flicker the layout every frame.
  const half = 64;
  const minX = info.right + 10 + half;
  const maxX = wind.left - 10 - half;
  const fits = minX <= maxX;
  el.style.left = `${fits ? THREE.MathUtils.clamp(x, minX, maxX) : (info.right + wind.left) / 2}px`;
  // Beyond the marker's range (not just off screen), show which way to turn instead of the pointer.
  el.classList.toggle('off-left', fits ? x < minX : !onScreen && bearing < 0);
  el.classList.toggle('off-right', fits ? x > maxX : !onScreen && bearing > 0);
  const turn = `${Math.round((Math.abs(bearing) * 180) / Math.PI)}°`;
  hud.pinLeftDeg.textContent = turn;
  hud.pinRightDeg.textContent = turn;
}

const mapCtx = hud.map.getContext('2d')!;

/** Tap the map to enlarge it for a close look; tap again to shrink back. */
hud.mapPanel.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const zoomed = hud.mapPanel.classList.toggle('zoomed');
  hud.map.width = zoomed ? 340 : 150;
  hud.map.height = zoomed ? 420 : 170;
});
let mapTerrain: HTMLCanvasElement | null = null;

/** Minimap palette, indexed by surface id (tee, fairway, green, rough, bunker, water, oob). */
const MAP_COLORS = ['#7ec46a', '#4f9e34', '#63c24a', '#2f6b25', '#e3cd94', '#3f8fd9', '#152d14'];

/** Pre-renders the hole's surfaces and trees once, so the minimap just blits it each frame. */
function bakeMinimap(data: LevelData): void {
  const { cols, rows } = gridSize(data.width, data.length);
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  const g = c.getContext('2d')!;
  const img = g.createImageData(cols, rows);
  const rgb = MAP_COLORS.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  const surface = data.grids.surface;
  for (let i = 0; i < surface.length; i++) {
    const color = rgb[surface[i]] ?? rgb[6];
    img.data[i * 4] = color[0];
    img.data[i * 4 + 1] = color[1];
    img.data[i * 4 + 2] = color[2];
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Trees as dark canopy dots.
  g.fillStyle = 'rgba(10, 35, 15, 0.85)';
  for (const o of data.objects) {
    if (!o.type.startsWith('tree')) continue;
    g.beginPath();
    g.arc(o.x / GRID_STEP, o.z / GRID_STEP, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  mapTerrain = c;
}

/** Top-down map of the hole: terrain, hazards, flag, ball and the predicted landing spot. */
function drawMinimap(): void {
  const ctx = mapCtx;
  const w = hud.map.width;
  const h = hud.map.height;
  ctx.clearRect(0, 0, w, h);
  if (!level || !currentData) return;
  const m = 10;
  const s = Math.min((w - 2 * m) / level.width, (h - 2 * m) / level.length);
  const ox = m + (w - 2 * m - level.width * s) / 2;
  const oz = m + (h - 2 * m - level.length * s) / 2;
  const X = (x: number) => ox + x * s;
  const Z = (z: number) => oz + z * s;

  if (mapTerrain) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapTerrain, ox, oz, level.width * s, level.length * s);
  }

  const dot = (x: number, z: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(X(x), Z(z), r, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(currentData.cup.x, currentData.cup.z, 3.5, '#ff5a3c');
  if (trajectory.visible && prediction) dot(prediction.end.x, prediction.end.z, 3, '#ffd34d');
  dot(ball.position.x, ball.position.z, 3, '#ffffff');

  const aiming = state === 'aiming' && prediction && aim.power > 0.03;
  hud.mapLabel.textContent = aiming && prediction
    ? `lands ≈${Math.round(prediction.total * 1.09361)} yd`
    : `${Math.round(distanceToPin() * 1.09361)} yd to pin`;
}

function updateHud(): void {
  drawMinimap();
  // Slope arrows only matter when the ball is near the green.
  greenArrows.visible =
    arrowsOn && state !== 'won' && Math.hypot(ball.position.x - level.hole.x, ball.position.z - level.hole.y) < 30;
  updateWindIndicator();
  updatePinMarker();
  hud.strokes.textContent = String(strokes);
  hud.club.textContent = CLUBS[clubIndex].name;
  hud.lie.textContent = ball.sunk ? 'Cup' : ball.moving ? '–' : LIE_NAMES[level.surfaceAt(ball.position.x, ball.position.z)];
  hud.slope.textContent = ball.sunk || ball.moving ? '–' : slopeLabel();
}

/** Describes the lie's slope along the aim (or, before aiming, the target line). */
function slopeLabel(): string {
  const dir = state === 'aiming' ? aim.dir : _v.set(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw));
  const { up, side } = lieAngles(dir);
  const upDeg = Math.round((up * 180) / Math.PI);
  const sideDeg = Math.round((side * 180) / Math.PI);
  const parts: string[] = [];
  if (upDeg !== 0) parts.push(`${upDeg > 0 ? 'Up' : 'Down'} ${Math.abs(upDeg)}°`);
  if (sideDeg !== 0) parts.push(`${sideDeg > 0 ? 'Above feet' : 'Below feet'} ${Math.abs(sideDeg)}°`);
  return parts.length ? parts.join(' · ') : 'Flat';
}

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;
  requestAnimationFrame(frame);
  // Nothing to draw until a level has been chosen, or while the editor covers the game.
  if (!level || editor.visible) return;

  if (ball.moving) {
    const event = ball.update(dt);
    if (event === 'sunk') {
      state = 'won';
      wonTimer = 0.9;
    } else if (event === 'stopped' && state === 'flying') {
      awardGreenBonus();
      onBallStopped();
    } else if ((event === 'out' || event === 'water') && state === 'flying') {
      // Penalty drop: +1 stroke, ball returns to the closest PLAYABLE spot — a place the
      // ball can actually come to rest — walking back from where it crossed the hazard.
      strokes++;
      toast(event === 'water' ? 'Water hazard · +1 stroke, dropped on playable land' : 'Out of bounds · +1 stroke, dropped on playable land');
      const drop = _v.copy(findDropSpot(ball.lastSafe, lastRest));
      drop.y = level.heightAt(drop.x, drop.z) + BALL_RADIUS;
      ball.placeAt(drop);
      if (level.surfaceAt(drop.x, drop.z) === 'green') greenBonusAwarded = true;
      onBallStopped();
    }
  }
  if (wonTimer > 0) {
    wonTimer -= dt;
    if (wonTimer <= 0) finishRoundHole(true);
  }

  ballMesh.position.copy(ball.position);
  ballMesh.quaternion.copy(ball.orientation);
  level.update(time);
  if (!ball.moving) level.updateGrass(ball.position.x, ball.position.z);
  updateCamera(dt);
  updateAimVisuals(time);
  updateHud();
  renderer.render(scene, camera);
}

fillLevelList();
hud.officialLevels.replaceChildren();
const teeOff = document.createElement('button');
teeOff.textContent = 'Tee off · play your hole';
teeOff.onclick = loadRoundHole;
hud.officialLevels.appendChild(teeOff);
for (const id of ['open-file', 'editor-start', 'menu', 'result-menu']) $(id).hidden = true;
const controls = document.createElement('div');
controls.id = 'arcade-controls';
for (const [index, club] of CLUBS.entries()) {
  const button = document.createElement('button');
  button.textContent = club.name;
  button.onclick = () => { if (state === 'ready') clubIndex = index; };
  controls.appendChild(button);
}
const spinValue = document.createElement('span');
spinValue.textContent = 'Spin: neutral';
function changeSpin(delta: number): void {
  if (state !== 'ready') return;
  spinLevel = THREE.MathUtils.clamp(spinLevel + delta, -3, 3);
  spinValue.textContent = spinLevel === 0 ? 'Spin: neutral' : `${spinLevel > 0 ? 'Topspin' : 'Backspin'} ${Math.abs(spinLevel)}/3`;
}
const lessSpin = document.createElement('button');
lessSpin.textContent = '−';
lessSpin.setAttribute('aria-label', 'More backspin');
lessSpin.onclick = () => changeSpin(-1);
const moreSpin = document.createElement('button');
moreSpin.textContent = '+';
moreSpin.setAttribute('aria-label', 'More topspin');
moreSpin.onclick = () => changeSpin(1);
controls.append(lessSpin, spinValue, moreSpin);
const arrowsButton = document.createElement('button');
arrowsButton.textContent = 'Slopes: ON';
arrowsButton.onclick = () => {
  arrowsOn = !arrowsOn;
  arrowsButton.textContent = arrowsOn ? 'Slopes: ON' : 'Slopes: OFF';
};
controls.appendChild(arrowsButton);
hud.root.appendChild(controls);
requestAnimationFrame(frame);
