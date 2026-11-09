// TackleLab: browser review harness. Runs the same headless Simulation as the tests, ahead of what it shows (plan 13a
// look-ahead playback: src/lab/playback.ts), and draws solved state from per-tick snapshots (src/lab/snapshot.ts). Controls: fixture select, run/pause, single-step, reset, speed, camera presets, overlays,
// palette (cosmetic), JSON export. URL: ?fixture=<id>&speed=0.25&cam=side&t=1.2 (run to t, then pause).
// Plan 13c: the select shows the review set (src/lab/review-set.ts) by default; "All fixtures" shows every registered
// fixture, the filter narrows either list, and a ?fixture= outside the review set opens the full list.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { allFixtures } from '../sim/fixtures/index';
import type { FixtureDef } from '../sim/fixture';
import { Simulation } from '../sim/simulation';
import { drawnBall, lerpPose } from './render-pose';
import type { PhysicalPose } from '../sim/pose';
import { initPhysics } from '../sim/physics';
import { lerp, qInvRot, qRot, qSlerp, toLocal, toWorld, v3, type Pose, type Vec3 } from '../sim/vec';
import type { ArmSide } from '../sim/contracts';
import { ArmOverlay, BalanceOverlay, ContactMarkers, PALETTES, PlayerView, RuleOverlay, disposeOwned, type ArmOverlaySide, type OverlayFlags } from './views';
import { ModelAsset } from './player-model';
import { MODEL_CALIBRATION_ID } from '../sim/model/profiles';
import { followCenter } from './follow';
import { Playback } from './playback';
import { f2, FrameCapture, type ArmFrame, type LabFrame, type Tagged } from './snapshot';
import { SUSPENSION_L2_BRAKE, type SuspensionSupport } from '../sim/profiles';
import { filterList, firstReviewId, fixtureList, inReviewSet } from './fixture-list';
import { RUN_JOG } from '../sim/model/run-clips';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- scene
const host = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.position = 'absolute';
labels.domElement.style.inset = '0';
labels.domElement.style.pointerEvents = 'none';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb8c8);
scene.fog = new THREE.Fog(0x9fb8c8, 30, 70);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);

function buildField(area: { halfX: number; halfZ: number }): THREE.Group {
  const g = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(60, 50).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 1 }));
  grass.receiveShadow = true;
  g.add(grass);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
  const strip = (x0: number, z0: number, x1: number, z1: number, w = 0.06): void => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(l, w).rotateX(-Math.PI / 2), lineMat);
    m.position.set((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    g.add(m);
  };
  const { halfX: X, halfZ: Z } = area;
  g.userData = { halfX: X, halfZ: Z };
  strip(-X, -Z, X, -Z, 0.1);
  strip(-X, Z, X, Z, 0.1);
  strip(-X, -Z, -X, Z, 0.1);
  strip(X, -Z, X, Z, 0.1);
  for (let x = -X + 1; x < X; x += 1) {
    if (Math.abs(x) % 4 === 0) strip(x, -Z, x, Z, 0.05);
    else {
      strip(x, -Z, x, -Z + 0.4, 0.04);
      strip(x, Z - 0.4, x, Z, 0.04);
      strip(x, -0.15, x, 0.15, 0.04);
    }
  }
  return g;
}

// ---------------------------------------------------------------- state
const fixtures: FixtureDef[] = allFixtures();
const flags: OverlayFlags = { overlays: true, colliders: false, primitives: params.get('view') === 'primitives' };
let palette = 'default';
let sim: Simulation;
/** Plan 13a: the snapshot buffer the lab plays (the simulation runs ahead of it) and the capture that fills it. */
let playback: Playback<LabFrame>;
let capture: FrameCapture;
/** Wall time each display frame may spend computing ahead (ms). */
const LOOKAHEAD_BUDGET_MS = 8;
/** Loaded supplied-model asset for the current fixture (null: none needed, or the load failed). */
let modelAsset: ModelAsset | null = null;
let modelError: string | null = null;
/** Incremented per load(); a load whose serial is no longer current discards its results (fixture changed). */
let loadSerial = 0;
let views: PlayerView[] = [];
let armOverlays = new Map<string, ArmOverlay>();
let balOverlays = new Map<string, BalanceOverlay>();
let ruleOverlay: RuleOverlay | null = null;
let field: THREE.Group | null = null;
const contactMarkers = new ContactMarkers();
scene.add(contactMarkers.group);
let follow = true;
let camPreset = params.get('cam') ?? 'oblique';
/** Camera distance multiplier (URL ?zoom=0.5 brings the preset twice as close). */
let camZoom = params.has('zoom') ? Number(params.get('zoom')) : 1;
let runToT: number | null = params.has('t') ? Number(params.get('t')) : null;
/** Plan 13c: the select shows every fixture (true) or the review set (false); the choice is remembered per browser. */
const ALL_KEY = 'tackleLab.allFixtures';
let showAll = ((): boolean => {
  try {
    return localStorage.getItem(ALL_KEY) === '1';
  } catch {
    return false;
  }
})();
/** Id of the fixture loaded (or loading); the select keeps it selected when its list changes. */
let currentId = '';

/** First tick at or after simulated time `t` (the `?t=` and `lab.runTo` stop). */
const tickAt = (t: number): number => Math.max(0, Math.ceil((t - 1e-9) / sim.def.solver.outerTickS));

/** The supplied model draws a fixture's players only when their body carries this asset's calibration. */
const usesModel = (def: FixtureDef): boolean => def.players.some((p) => p.body.measured?.calibrationId === MODEL_CALIBRATION_ID);

async function load(id: string): Promise<void> {
  const serial = ++loadSerial;
  const def = fixtures.find((f) => f.id === id) ?? fixtures.find((f) => f.id === firstReviewId()) ?? fixtures[0];
  currentId = def.id;
  fillFixtureSelect();
  await initPhysics();
  const next = await Simulation.create(def);
  let asset: ModelAsset | null = null;
  let error: string | null = null;
  if (usesModel(def))
    try {
      asset = await ModelAsset.load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      console.error('[lab] model load failed', e);
    }
  // a newer load started while this one waited: drop this result (views are built only when sim and asset are ready)
  if (serial !== loadSerial) {
    next.dispose();
    return;
  }
  if (sim) sim.dispose();
  disposeViews();
  // a fixture without the model retires the cached asset (its shared geometry, textures and materials)
  if (modelAsset && modelAsset !== asset) modelAsset.retire();
  sim = next;
  modelAsset = asset;
  modelError = error;
  capture = new FrameCapture(sim);
  playback = new Playback({ capture: () => capture.capture(), step: () => sim.stepTick(), done: () => sim.done }, def.solver.outerTickS, () => performance.now(), LOOKAHEAD_BUDGET_MS);
  playback.speed = Number(($('speed') as HTMLSelectElement).value);
  if (def.cosmetic?.palette && def.cosmetic.palette !== 'default') palette = def.cosmetic.palette;
  buildViews();
  // The field depends only on the practice bounds: reuse it while they match, dispose its resources when replaced.
  if (!field || field.userData.halfX !== def.area.halfX || field.userData.halfZ !== def.area.halfZ) {
    if (field) {
      scene.remove(field);
      disposeOwned(field);
    }
    field = buildField(def.area);
    scene.add(field);
  }
  $('title').textContent = `${def.id} [${def.milestone}] ${def.title}${def.notes ? ` — ${def.notes}` : ''}`;
  buildTune(def);
  buildJogTune(def);
  buildBrakeTune(def);
  setCamera(camPreset, true);
  const u = new URL(location.href);
  u.searchParams.set('fixture', def.id);
  history.replaceState(null, '', u);
  updateRunButton();
}

// ---------------------------------------------------------------- look tuning: run-clip stance width (plan 07)
/**
 * Live slider editor for the run-clip profile's per-clip extra stance width (`stanceWidthAddM`, m per foot, outward).
 * Moving a slider rebuilds the current fixture with the edited profile (reset to t = 0); the copy line is the value to
 * hand back for the profile, verbatim. Shown for fixtures with run clips.
 */
function buildTune(def: FixtureDef): void {
  const P = def.runClips;
  $('tune').hidden = !P;
  if (!P) return;
  const rows = $('tuneRows');
  rows.textContent = '';
  const cur = (id: string): number => P.stanceWidthAddM?.[id] ?? 0;
  const out = (): string => `stanceWidthAddM: { ${P.clips.map((c) => `'${c.id}': ${cur(c.id).toFixed(3)}`).join(', ')} }`;
  for (const c of P.clips) {
    const row = document.createElement('div');
    const lab = document.createElement('label');
    const val = document.createElement('span');
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = '-0.06';
    inp.max = '0.12';
    inp.step = '0.005';
    inp.value = String(cur(c.id));
    lab.textContent = `${c.id} `;
    val.textContent = ` ${cur(c.id).toFixed(3)}`;
    inp.oninput = () => (val.textContent = ` ${Number(inp.value).toFixed(3)}`);
    inp.onchange = () => {
      const w = { ...(P.stanceWidthAddM ?? {}), [c.id]: Number(inp.value) };
      const base = P.id.replace(/\+width\([^)]*\)/, '');
      const np = { ...P, id: `${base}+width(${P.clips.map((k) => `${k.id} ${(w[k.id] ?? 0).toFixed(3)}`).join(', ')})`, stanceWidthAddM: w };
      const i = fixtures.findIndex((f) => f.id === def.id);
      fixtures[i] = { ...def, runClips: np };
      void load(def.id);
    };
    row.append(lab, inp, val);
    rows.append(row);
  }
  $('tuneOut').textContent = out();
  $('tuneCopy').onclick = () => void navigator.clipboard?.writeText(out());
  $('tuneZero').onclick = () => {
    const i = fixtures.findIndex((f) => f.id === def.id);
    const { stanceWidthAddM: _drop, ...rest } = P;
    fixtures[i] = { ...def, runClips: { ...rest, id: P.id.replace(/\+width\([^)]*\)/, '') } };
    void load(def.id);
  };
}

// ---------------------------------------------------------------- look tuning: the jog (plan 13d)
/**
 * Live slider editor for the run-clip profile's jog (`run`: minStride, the shortest stride share below Fast Run's slowest
 * cadence; liftScale, the exponent of the share that scales the swing lift and the run bob). Moving a slider rebuilds the
 * current fixture with the edited profile (reset to t = 0, id suffix +jog(…)); the copy line is the value to hand back,
 * verbatim. Shown for fixtures whose run-clip profile has the block.
 */
function buildJogTune(def: FixtureDef): void {
  const P = def.runClips;
  const J = P?.run;
  $('jog').hidden = !J;
  if (!P || !J) return;
  const rows = $('jogRows');
  rows.textContent = '';
  const out = (): string => `run: { minStride: ${J.minStride.toFixed(2)}, liftScale: ${J.liftScale.toFixed(2)}, shareRadPerS: ${J.shareRadPerS} }`;
  const base = P.id.replace(/\+jog\([^)]*\)/, '');
  const apply = (nj: NonNullable<typeof J>, id: string): void => {
    const i = fixtures.findIndex((f) => f.id === def.id);
    fixtures[i] = { ...def, runClips: { ...P, id, run: nj } };
    void load(def.id);
  };
  const slider = (key: 'minStride' | 'liftScale', min: number, max: number, step: number): void => {
    const row = document.createElement('div');
    const lab = document.createElement('label');
    const val = document.createElement('span');
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(J[key]);
    lab.textContent = `${key} `;
    val.textContent = ` ${J[key].toFixed(2)}`;
    inp.oninput = () => (val.textContent = ` ${Number(inp.value).toFixed(2)}`);
    inp.onchange = () => {
      const nj = { ...J, [key]: Number(inp.value) };
      apply(nj, `${base}+jog(minStride ${nj.minStride.toFixed(2)}, liftScale ${nj.liftScale.toFixed(2)})`);
    };
    row.append(lab, inp, val);
    rows.append(row);
  };
  slider('minStride', 0.2, 1, 0.01);
  slider('liftScale', 0, 3, 0.05);
  $('jogOut').textContent = out();
  $('jogCopy').onclick = () => void navigator.clipboard?.writeText(out());
  $('jogReset').onclick = () => apply({ ...RUN_JOG }, base);
}

// ---------------------------------------------------------------- look tuning: braking stance (plan 07 item 4)
/**
 * Live slider editor for the support profile's braking stance (`brakingStance.heightM`: the root height braking blends
 * toward; `fullSpeedMps`: the speed from which the full depth applies). Moving a slider rebuilds the current fixture with
 * the edited profile (reset to t = 0); the copy line is the value to hand back, verbatim. Shown for fixtures whose
 * support has a braking stance.
 */
function buildBrakeTune(def: FixtureDef): void {
  const S = def.support && def.support.kind === 'suspension' ? (def.support as SuspensionSupport) : null;
  const B = S?.brakingStance;
  $('brake').hidden = !B;
  if (!S || !B) return;
  const rows = $('brakeRows');
  rows.textContent = '';
  const out = (): string => `brakingStance: { heightM: ${B.heightM.toFixed(3)}, fullSpeedMps: ${B.fullSpeedMps.toFixed(2)} }`;
  const base = S.id.replace(/\+brake\(.*\)$/, '');
  const apply = (nb: NonNullable<SuspensionSupport['brakingStance']>, id: string): void => {
    const i = fixtures.findIndex((f) => f.id === def.id);
    fixtures[i] = { ...def, support: { ...S, id, brakingStance: nb } };
    void load(def.id);
  };
  const slider = (name: string, key: 'heightM' | 'fullSpeedMps', min: number, max: number, step: number, digits: number): void => {
    const row = document.createElement('div');
    const lab = document.createElement('label');
    const val = document.createElement('span');
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(B[key]);
    lab.textContent = `${name} `;
    val.textContent = ` ${B[key].toFixed(digits)}`;
    inp.oninput = () => (val.textContent = ` ${Number(inp.value).toFixed(digits)}`);
    inp.onchange = () => {
      const nb = { ...B, [key]: Number(inp.value) };
      apply(nb, `${base}+brake(${nb.heightM.toFixed(3)} m, ${nb.fullSpeedMps.toFixed(2)} m/s)`);
    };
    row.append(lab, inp, val);
    rows.append(row);
  };
  slider('height m', 'heightM', S.targetRangeM[0], S.standingHeightM, 0.005, 3);
  slider('full depth from m/s', 'fullSpeedMps', 0.5, 6, 0.25, 2);
  $('brakeOut').textContent = out();
  $('brakeCopy').onclick = () => void navigator.clipboard?.writeText(out());
  $('brakeReset').onclick = () => apply({ ...SUSPENSION_L2_BRAKE.brakingStance! }, base);
}

function buildViews(): void {
  const R = sim.def.ragdoll;
  const f0 = playback.frames[0];
  for (const [i, pl] of sim.players.entries()) {
    const role = pl.setup.role;
    const model = modelAsset && pl.body.measured?.calibrationId === MODEL_CALIBRATION_ID ? modelAsset.instantiate(`${palette}:${role}`, (PALETTES[palette] ?? PALETTES.default)[role]) : null;
    const v = new PlayerView(pl, palette, f0.players[i].colliderSet, !sim.rules, R, model);
    views.push(v);
    scene.add(v.root);
    if (sim.arms?.hasArms(pl.id)) {
      const o = new ArmOverlay();
      armOverlays.set(pl.id, o);
      scene.add(o.root);
    }
    if (sim.balanced) {
      const b = new BalanceOverlay();
      balOverlays.set(pl.id, b);
      scene.add(b.root);
    }
  }
  if (sim.rules) {
    const sl = sim.rules.profile.sideline;
    ruleOverlay = new RuleOverlay(sl.enabled ? sl : null);
    scene.add(ruleOverlay.root);
  }
}

function disposeViews(): void {
  for (const v of views) {
    scene.remove(v.root);
    v.dispose();
  }
  views = [];
  for (const o of armOverlays.values()) {
    scene.remove(o.root);
    o.dispose();
  }
  armOverlays = new Map();
  for (const o of balOverlays.values()) {
    scene.remove(o.root);
    o.dispose();
  }
  balOverlays = new Map();
  if (ruleOverlay) {
    scene.remove(ruleOverlay.root);
    ruleOverlay.dispose();
    ruleOverlay = null;
  }
}

function resetSim(): void {
  disposeViews();
  sim.reset();
  capture = new FrameCapture(sim);
  playback.restart();
  buildViews();
  updateRunButton();
}

/**
 * The shown frame pair of each player: `cur` the tick drawn as current (the next frame once the blend has begun) and
 * `prev` the tick it blends from (itself across a representation change: no blend from the proxy into ten new bodies).
 */
function shownPlayers(): { cur: LabFrame['players'][number]; prev: LabFrame['players'][number] }[] {
  const { a, b, alpha } = playback.view();
  return a.players.map((pa, i) => {
    const pb = b.players[i];
    const cur = alpha > 0 ? pb : pa;
    return { cur, prev: pa.rep === pb.rep ? pa : cur };
  });
}

/** Camera target: the players' COM interpolated like the drawn poses. */
function actionCenter(): THREE.Vector3 {
  const c = followCenter(
    shownPlayers().map(({ cur, prev }) => ({ prev: prev.com, cur: cur.com })),
    playback.view().alpha,
  );
  return new THREE.Vector3(c.x, c.y, c.z);
}

function setCamera(preset: string, snap = false): void {
  camPreset = preset;
  const c = actionCenter();
  const off: Record<string, THREE.Vector3> = {
    side: new THREE.Vector3(0, 0.6, 6),
    front: new THREE.Vector3(6, 0.8, 0),
    oblique: new THREE.Vector3(4, 3, 5),
    overhead: new THREE.Vector3(0, 9, 0.01),
  };
  const o = (off[preset] ?? off.oblique).clone().multiplyScalar(camZoom);
  camera.position.copy(c).add(o);
  controls.target.copy(c);
  if (snap) controls.update();
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === preset));
}

// ---------------------------------------------------------------- UI
/**
 * Plan 13c: rebuild the select from the chosen list (review set or all fixtures) and the filter, keeping the loaded
 * fixture selected. A loaded fixture the list does not show (filtered out, or outside the review set) stays at the top
 * under "Loaded", so the select always names what is on screen.
 */
function fillFixtureSelect(): void {
  const sel = $('fixture') as HTMLSelectElement;
  const groups = filterList(fixtureList(fixtures, showAll), ($('filter') as HTMLInputElement).value);
  const shown = groups.some((g) => g.options.some((o) => o.id === currentId));
  sel.textContent = '';
  const group = (label: string): HTMLOptGroupElement => {
    const g = document.createElement('optgroup');
    g.label = label;
    sel.appendChild(g);
    return g;
  };
  const option = (g: HTMLOptGroupElement, value: string, text: string): void => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    g.appendChild(o);
  };
  if (currentId && !shown) {
    const cur = fixtures.find((f) => f.id === currentId);
    if (cur) option(group('Loaded'), cur.id, `${cur.id} · ${cur.title}`);
  }
  for (const g of groups) {
    const og = group(g.label);
    for (const o of g.options) option(og, o.id, o.text);
  }
  if (groups.length === 0) {
    const o = document.createElement('option');
    o.disabled = true;
    o.textContent = 'no fixture matches the filter';
    sel.appendChild(o);
  }
  sel.value = currentId;
  ($('allFixtures') as HTMLInputElement).checked = showAll;
  $('allLabel').textContent = `All fixtures (${fixtures.length})`;
}

function wireFixtureList(): void {
  const sel = $('fixture') as HTMLSelectElement;
  sel.onchange = () => {
    if (sel.value && sel.value !== currentId) void load(sel.value);
  };
  const filter = $('filter') as HTMLInputElement;
  filter.oninput = () => fillFixtureSelect();
  // Enter loads the first match; Escape clears the filter
  filter.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const first = filterList(fixtureList(fixtures, showAll), filter.value)[0]?.options[0];
      if (first && first.id !== currentId) void load(first.id);
    } else if (e.key === 'Escape') {
      filter.value = '';
      fillFixtureSelect();
    }
  };
  ($('allFixtures') as HTMLInputElement).onchange = (e) => {
    showAll = (e.target as HTMLInputElement).checked;
    try {
      localStorage.setItem(ALL_KEY, showAll ? '1' : '0');
    } catch {
      // storage blocked (private window, previews): the choice lasts for this page only
    }
    fillFixtureSelect();
  };
}

function updateRunButton(): void {
  const b = $('run');
  b.textContent = playback.paused ? 'Run' : 'Pause';
  b.classList.toggle('on', !playback.paused);
}

/** Export the whole run (computed to its end first: the simulation may be ahead of or behind what is shown). */
function exportJson(): void {
  playback.finish();
  const data = { fixture: sim.exportFixture(), summary: sim.summary(), events: sim.events, trace: sim.trace };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sim.def.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function wire(): void {
  $('run').onclick = () => {
    if (playback.ended) resetSim();
    playback.paused = !playback.paused;
    updateRunButton();
  };
  $('step').onclick = () => {
    playback.step();
    updateRunButton();
  };
  $('reset').onclick = () => resetSim();
  ($('speed') as HTMLSelectElement).onchange = (e) => {
    playback.speed = Number((e.target as HTMLSelectElement).value);
  };
  ($('scrub') as HTMLInputElement).oninput = (e) => {
    playback.paused = true;
    playback.seek(Number((e.target as HTMLInputElement).value));
    updateRunButton();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => (b.onclick = () => setCamera(b.dataset.cam!, true)));
  $('follow').onclick = () => {
    follow = !follow;
    $('follow').classList.toggle('on', follow);
  };
  $('ovl').onclick = () => {
    flags.overlays = !flags.overlays;
    $('ovl').classList.toggle('on', flags.overlays);
  };
  $('col').onclick = () => {
    flags.colliders = !flags.colliders;
    $('col').classList.toggle('on', flags.colliders);
  };
  $('prim').onclick = () => {
    flags.primitives = !flags.primitives;
    $('prim').classList.toggle('on', flags.primitives);
  };
  $('prim').classList.toggle('on', flags.primitives);
  $('palette').onclick = () => {
    palette = palette === 'default' ? 'alt' : 'default';
    for (const v of views) v.setPalette(palette);
    $('palette').classList.toggle('on', palette !== 'default');
  };
  $('export').onclick = exportJson;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === ' ') $('run').click();
    else if (e.key === '.') $('step').click();
    else if (e.key === 'r') $('reset').click();
  });
}

// ---------------------------------------------------------------- arm overlay data (from the frame, re-expressed)
/** A frame's arm overlay input, its tagged points re-expressed into the drawn (interpolated) poses. */
function armOverlayData(d: Partial<Record<ArmSide, ArmFrame>>, mapPt: (t: Tagged) => Vec3, mapDir: (t: Tagged) => Vec3): Partial<Record<ArmSide, ArmOverlaySide>> {
  const out: Partial<Record<ArmSide, ArmOverlaySide>> = {};
  for (const s of ['left', 'right'] as ArmSide[]) {
    const a = d[s];
    if (!a) continue;
    out[s] = {
      palm: mapPt(a.palm),
      requested: a.requested ? mapPt(a.requested) : null,
      phase: a.phase,
      anchor: a.anchor ? { p: mapPt(a.anchor.p), n: mapDir(a.anchor.n), tension: a.anchor.tension, ceiling: a.anchor.ceiling } : null,
      clamp: a.clamp ? { p: mapPt(a.clamp.p), n: mapDir(a.clamp.n), normalN: a.clamp.normalN, tangent: mapDir(a.clamp.tangent) } : null,
      azFrom: a.azFrom ? mapPt(a.azFrom) : null,
      azDeg: a.azDeg,
      label: a.label,
    };
  }
  return out;
}

// ---------------------------------------------------------------- info panel
function info(): void {
  const { a, b, alpha } = playback.view();
  const F = alpha > 0 ? b : a;
  const lines: string[] = [];
  if (modelError) lines.push(`MODEL LOAD FAILED (primitive view shown): ${modelError}`);
  else if (modelAsset) lines.push(`model bew-v6 (${MODEL_CALIBRATION_ID})${flags.primitives ? '  [primitive diagnostic view]' : ''}`);
  const newest = playback.frames[playback.newest];
  lines.push(`playback ${playback.speed}×  computed to ${f2(newest.t, 3)} s${playback.complete ? ' (end)' : ''}${playback.computing ? '  COMPUTING' : ''}`);
  lines.push(...F.info);
  const el = $('info');
  el.textContent = lines.join('\n');
  el.classList.toggle('bad', F.bad || !!modelError);
  const sc = $('scrub') as HTMLInputElement;
  sc.max = String(playback.newest);
  if (document.activeElement !== sc) sc.value = String(Math.round(playback.shown));
  $('scrubOut').textContent = `${f2(F.t, 2)} / ${f2(newest.t, 2)} s`;
}

// ---------------------------------------------------------------- frame loop
/** Draw the shown time: the frame pair around it, interpolated; sim-state points re-expressed so arms stay attached. */
function draw(): void {
  const { a, b, alpha } = playback.view();
  const F = alpha > 0 ? b : a;
  contactMarkers.set(F.markers, flags.overlays);
  const interp = new Map<string, Pose>();
  const current = new Map<string, Pose>();
  const poses = new Map<string, PhysicalPose | null>();
  const shown = shownPlayers();
  views.forEach((v, i) => {
    const { cur, prev } = shown[i];
    v.syncColliders(cur.colliderSet);
    poses.set(cur.id, prev !== cur && prev.pose && cur.pose ? lerpPose(prev.pose, cur.pose, alpha) : cur.pose);
    // the core blends as `lerpPose` blends segments; at alpha 1 it is the current core itself
    interp.set(cur.id, alpha >= 1 || prev === cur ? cur.core : { p: lerp(prev.core.p, cur.core.p, alpha), q: qSlerp(prev.core.q, cur.core.q, alpha) });
    current.set(cur.id, cur.core);
  });
  const mapPt = (t: Tagged): Vec3 => toWorld(interp.get(t.id)!, toLocal(current.get(t.id)!, t.v));
  const mapDir = (t: Tagged): Vec3 => qRot(interp.get(t.id)!.q, qInvRot(current.get(t.id)!.q, t.v));
  if (ruleOverlay && sim.rules && F.rules && interp.has(F.rules.runnerId)) {
    const rid = F.rules.runnerId;
    ruleOverlay.update(drawnBall(poses.get(rid) ?? null, interp.get(rid)!, sim.rules.profile), F.rules.ballSpot);
  }
  views.forEach((v, i) => {
    const fr = F.players[i];
    const core = interp.get(fr.id)!;
    v.update(core, poses.get(fr.id) ?? null, flags, fr);
    const ov = armOverlays.get(fr.id);
    if (ov && fr.arms) ov.update(armOverlayData(fr.arms, mapPt, mapDir), flags.overlays);
    const bo = balOverlays.get(fr.id);
    if (bo && fr.balance) bo.update({ ...fr.balance, bodyUp: qRot(core.q, v3(0, 1, 0)) }, flags.overlays);
  });
  if (follow) {
    const c = actionCenter();
    const d = c.clone().sub(controls.target);
    controls.target.add(d);
    camera.position.add(d);
  }
}

let last = performance.now();
function frame(now: number): void {
  const wall = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (sim && playback) {
    if (runToT !== null) {
      playback.seek(tickAt(runToT));
      runToT = null;
      playback.paused = true;
      updateRunButton();
    }
    const wasPaused = playback.paused;
    playback.frame(wall);
    if (playback.paused !== wasPaused) updateRunButton();
    draw();
    info();
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize(): void {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Scripted inspection hook (used for automated screenshots; never used by the simulation).
(window as unknown as { lab: unknown }).lab = {
  load: (id: string, t?: number) => {
    runToT = t ?? null;
    return load(id);
  },
  /** Show simulated time `t` (computing up to it). */
  runTo: (t: number) => playback.seek(tickAt(t)),
  /** Simulated time shown, and computed. */
  get shownT() {
    return playback.view().a.t;
  },
  get computedT() {
    return playback.frames[playback.newest].t;
  },
  camera: (p: string, zoom?: number) => {
    if (zoom !== undefined) camZoom = zoom;
    setCamera(p, true);
  },
  overlays: (on: boolean, colliders = flags.colliders) => {
    flags.overlays = on;
    flags.colliders = colliders;
  },
  get sim() {
    return sim;
  },
  fixtures: () => fixtures.map((f) => f.id),
  /** GPU resource counts and live model clones (resource-stability checks across loads and resets). */
  memory: () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0, modelInstances: modelAsset?.liveInstances ?? 0, modelError }),
  primitives: (on: boolean) => {
    flags.primitives = on;
    $('prim').classList.toggle('on', on);
  },
  reset: () => resetSim(),
};

// a ?fixture= outside the review set opens the full list (for this page; the remembered choice is unchanged)
const urlFixture = params.get('fixture');
if (urlFixture && !inReviewSet(urlFixture) && fixtures.some((f) => f.id === urlFixture)) showAll = true;
fillFixtureSelect();
wireFixtureList();
wire();
resize();
const sp = params.get('speed');
if (sp) ($('speed') as HTMLSelectElement).value = sp;
void load(urlFixture ?? firstReviewId());
requestAnimationFrame(frame);
