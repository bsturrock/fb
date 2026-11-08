// TackleLab: browser review harness. Runs the same headless Simulation as the tests through a fixed-step driver and
// draws solved state. Controls: fixture select, run/pause, single-step, reset, speed, camera presets, overlays,
// palette (cosmetic), JSON export. URL: ?fixture=<id>&speed=0.25&cam=side&t=1.2 (run to t, then pause).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { allFixtures } from '../sim/fixtures/index';
import type { FixtureDef } from '../sim/fixture';
import { Simulation, type PlayerRuntime } from '../sim/simulation';
import { FixedStepDriver } from '../sim/driver';
import { lerpSeat } from '../sim/carry';
import { forwardBallQ } from './football';
import { carriedBall, type PhysicalPose } from '../sim/pose';
import { initPhysics } from '../sim/physics';
import { forwardOf, horiz, len, qInvRot, qRot, round, toLocal, toWorld, v3, type Pose, type Quat, type Vec3 } from '../sim/vec';
import type { ArmSide } from '../sim/contracts';
import { ArmOverlay, BalanceOverlay, ContactMarkers, PALETTES, PlayerView, RuleOverlay, disposeOwned, type ArmOverlaySide, type OverlayFlags } from './views';
import { ModelAsset } from './player-model';
import { MODEL_CALIBRATION_ID } from '../sim/model/profiles';
import { playbackLabel } from '../sim/run-clip';
import { followCenter } from './follow';
import { SUSPENSION_L2_BRAKE, type SuspensionSupport } from '../sim/profiles';

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
let driver: FixedStepDriver;
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
/** Previous solved tick per player (pose + representation) for render interpolation; reset at a handoff. */
const prevPose = new Map<string, { core: Pose; pose: PhysicalPose | null; rep: string; com: Vec3 }>();
const seenRep = new Map<string, string>();
let follow = true;
let camPreset = params.get('cam') ?? 'oblique';
/** Camera distance multiplier (URL ?zoom=0.5 brings the preset twice as close). */
let camZoom = params.has('zoom') ? Number(params.get('zoom')) : 1;
let runToT: number | null = params.has('t') ? Number(params.get('t')) : null;

function corePose(pl: PlayerRuntime): { p: Vec3; q: Quat } {
  return sim.poseOf(pl);
}

const clonePose = (p: PhysicalPose | null): PhysicalPose | null => (p ? structuredClone(p) : null);

function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
function slerpQ(a: Quat, b: Quat, t: number): Quat {
  const q = new THREE.Quaternion(a.x, a.y, a.z, a.w).slerp(new THREE.Quaternion(b.x, b.y, b.z, b.w), t);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
/** Interpolate two compatible solved poses (same representation; reset at a representation change). */
function lerpPose(a: PhysicalPose, b: PhysicalPose, t: number): PhysicalPose {
  const segments = { ...b.segments };
  for (const k of Object.keys(b.segments) as (keyof PhysicalPose['segments'])[]) {
    const sa = a.segments[k];
    const sb = b.segments[k];
    if (sa && sb) segments[k] = { segmentId: k, originWorld: lerpV(sa.originWorld, sb.originWorld, t), rotationWorld: slerpQ(sa.rotationWorld, sb.rotationWorld, t) };
  }
  const jointLandmarksWorld: Record<string, Vec3> = {};
  for (const [k, v] of Object.entries(b.jointLandmarksWorld)) jointLandmarksWorld[k] = a.jointLandmarksWorld[k] ? lerpV(a.jointLandmarksWorld[k], v, t) : v;
  const out: PhysicalPose = { ...b, segments, jointLandmarksWorld };
  if (a.carry && b.carry) out.carry = lerpSeat(a.carry, b.carry, t);
  if (b.anklePitchDeg) {
    const ap: NonNullable<PhysicalPose['anklePitchDeg']> = {};
    for (const s of ['left', 'right'] as const) {
      const vb = b.anklePitchDeg[s] ?? 0;
      ap[s] = (a.anklePitchDeg?.[s] ?? vb) + (vb - (a.anklePitchDeg?.[s] ?? vb)) * t;
    }
    out.anklePitchDeg = ap;
  }
  return out;
}

/** The supplied model draws a fixture's players only when their body carries this asset's calibration. */
const usesModel = (def: FixtureDef): boolean => def.players.some((p) => p.body.measured?.calibrationId === MODEL_CALIBRATION_ID);

async function load(id: string): Promise<void> {
  const serial = ++loadSerial;
  const def = fixtures.find((f) => f.id === id) ?? fixtures[0];
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
  driver = new FixedStepDriver(def.solver.outerTickS, def.solver.maxTicksPerFrame);
  driver.paused = true;
  driver.speed = Number(($('speed') as HTMLSelectElement).value);
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
  ($('fixture') as HTMLSelectElement).value = def.id;
  buildTune(def);
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
      const base = P.id.replace(/\+width\(.*\)$/, '');
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
    fixtures[i] = { ...def, runClips: { ...rest, id: P.id.replace(/\+width\(.*\)$/, '') } };
    void load(def.id);
  };
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
  prevPose.clear();
  seenRep.clear();
  const R = sim.def.ragdoll;
  for (const pl of sim.players) {
    const role = pl.setup.role;
    const model = modelAsset && pl.body.measured?.calibrationId === MODEL_CALIBRATION_ID ? modelAsset.instantiate(`${palette}:${role}`, (PALETTES[palette] ?? PALETTES.default)[role]) : null;
    const v = new PlayerView(pl, palette, sim.activeColliders(pl), !sim.rules, R, model);
    views.push(v);
    scene.add(v.root);
    prevPose.set(pl.id, { core: corePose(pl), pose: clonePose(pl.pose), rep: pl.representation, com: { ...sim.bulk(pl).com } });
    seenRep.set(pl.id, pl.representation);
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
  driver.reset();
  buildViews();
  updateRunButton();
}

/** Camera target: the players' COM interpolated like the drawn poses (alpha 1 = the current tick). */
function actionCenter(alpha = 1): THREE.Vector3 {
  const c = followCenter(
    sim.players.map((pl) => {
      const cur = sim.bulk(pl).com;
      const pp = prevPose.get(pl.id);
      return { prev: pp && pp.rep === pl.representation ? pp.com : cur, cur };
    }),
    alpha,
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
function fillFixtureSelect(): void {
  const sel = $('fixture') as HTMLSelectElement;
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const f of fixtures) {
    const key = f.milestone === 'L1' ? 'L1 · supplied run clips' : f.milestone === 'RH' ? 'RH · ride height and support' : f.milestone === 'L2' ? 'L2 · support recovery and footwork' : f.milestone === 'HC' ? 'HC · ragdoll handoff during contact' : f.milestone === 'L3' ? 'L3 · locomotion transitions and contact integration' : f.milestone === 'L4' ? 'L4 · active falls and joint limits' : `Gate ${f.gate} · ${f.milestone}`;
    let g = groups.get(key);
    if (!g) {
      g = document.createElement('optgroup');
      g.label = key;
      groups.set(key, g);
      sel.appendChild(g);
    }
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.id;
    g.appendChild(o);
  }
  sel.onchange = () => void load(sel.value);
}

function updateRunButton(): void {
  const b = $('run');
  b.textContent = driver.paused ? 'Run' : 'Pause';
  b.classList.toggle('on', !driver.paused);
}

function stepOnce(): void {
  capturePrev();
  sim.stepTick();
}

function capturePrev(): void {
  for (const pl of sim.players) prevPose.set(pl.id, { core: corePose(pl), pose: clonePose(pl.pose), rep: pl.representation, com: { ...sim.bulk(pl).com } });
}

function exportJson(): void {
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
    if (sim.done) resetSim();
    driver.paused = !driver.paused;
    updateRunButton();
  };
  $('step').onclick = () => {
    driver.paused = true;
    stepOnce();
    updateRunButton();
  };
  $('reset').onclick = () => resetSim();
  ($('speed') as HTMLSelectElement).onchange = (e) => {
    driver.speed = Number((e.target as HTMLSelectElement).value);
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

// ---------------------------------------------------------------- arm overlay data (read-only views of ArmSystem state)
type ArmObsRec = NonNullable<ReturnType<NonNullable<Simulation['arms']>['obs']>>;
function armOverlayData(
  id: string,
  o: ArmObsRec,
  mapPt: (id: string, w: Vec3) => Vec3,
  mapDir: (id: string, d: Vec3) => Vec3,
): Partial<Record<ArmSide, ArmOverlaySide>> {
  const A = sim.arms!;
  const out: Partial<Record<ArmSide, ArmOverlaySide>> = {};
  const w = A.wrap.get(id);
  for (const s of ['left', 'right'] as ArmSide[]) {
    const a = o[s]!;
    if (!a.enabled) continue;
    const f = A.lastForce.get(`${id}:${s}`);
    let anchor: ArmOverlaySide['anchor'] = null;
    if (a.gripId) {
      const g = A.grips.get(a.gripId);
      const tgt = g ? sim.byId.get(g.targetId) : undefined;
      if (g && tgt) {
        const tp = corePose(tgt);
        anchor = {
          p: mapPt(g.targetId, toWorld(tp, g.targetPointLocal)),
          n: mapDir(g.targetId, qRot(tp.q, g.targetNormalLocal)),
          tension: f?.actual ?? 0,
          ceiling: A.profile.hold.perArmCeilingN,
        };
      }
    }
    const c = A.clampOf(id, s);
    const clamp = c ? { p: mapPt(c.targetId, c.pointWorld), n: mapDir(c.targetId, c.outwardNormalWorld), normalN: c.normalForceN, tangent: mapDir(c.targetId, c.tangentForceN) } : null;
    const tgtId = w?.target ?? null;
    const az = w?.azimuthDeg[s];
    const tgtView = tgtId ? views.find((x) => x.pl.id === tgtId) : undefined;
    const azFrom = tgtView && az !== undefined ? mapPt(tgtView.pl.id, toWorld(corePose(tgtView.pl), v3(0, 0.22, 0))) : null;
    const force = f ? ` ${Math.round(f.actual)}N` : '';
    out[s] = {
      palm: mapPt(id, a.palmContactWorld),
      requested: a.requestedWorld && sim.byId.get(id)?.controlMode !== 'falling' ? mapPt(id, a.requestedWorld) : null, // falling: no voluntary request
      phase: a.phase,
      anchor,
      clamp,
      azFrom,
      azDeg: az ?? null,
      label: `${s[0].toUpperCase()} ${a.phase}${a.gripId ? ' grip' : ''}${c ? ' clamp' : ''}${force}${a.poseValid ? '' : ' INVALID'}`,
    };
  }
  return out;
}

function balanceInfo(pl: PlayerRuntime, lines: string[]): void {
  if (!sim.balanced) return;
  const B = sim.balanceProfile;
  const b = pl.balance;
  const a = pl.applied;
  const dg = (r: number): string => f2((r * 180) / Math.PI, 1);
  const st = sim.balanceState(pl);
  lines.push(`  lean ${dg(b.theta)}°  out rate ${f2(b.outwardRate, 2)} rad/s  proj ${dg(b.projected)}°  [min ${dg(B.minLeanRad)} env ${dg(B.envelopeRad)} hard ${dg(B.hardLeanRad)}]  cnt ${b.counter}/${B.confirmSubsteps}`);
  lines.push(`  support ${st.supportingContact ? 'contact' : 'NONE'}  mode ${pl.controlMode}  posture ${dg(Math.acos(Math.min(1, b.desiredUp.y)))}° (max ${dg(B.maxPostureLeanRad)})`);
  lines.push(`  balance τ req ${f2(len(a.balanceRequested), 0)} → ${f2(len(a.balanceCapped), 0)} / ${f2(a.balanceCap, 0)} N·m${a.balanceSaturated ? ' SAT' : ''}  yaw ${f2(a.yawTorque, 0)}  support |τ| ${f2(len(a.supportTorque), 0)} / ${B.combinedCeilingNm} ×${f2(a.supportScale, 2)}`);
  lines.push(`  drive lean scale ×${f2(a.leanScale, 2)}`);
  const loss = sim.events.find((e) => e.type === 'lossOfSupport' && e.playerId === pl.id);
  if (loss) lines.push(`  LOSS @${f2(loss.t, 3)} s  ${loss.data!.reason}  lean ${f2(Number(loss.data!.leanDeg), 1)}°  proj ${f2(Number(loss.data!.projectedLeanDeg), 1)}°`);
}

function armInfo(id: string, lines: string[]): void {
  const A = sim.arms;
  const o = A?.obs(id);
  if (!A || !o) return;
  for (const s of ['left', 'right'] as ArmSide[]) {
    const a = o[s]!;
    if (!a.enabled) continue;
    const f = A.lastForce.get(`${id}:${s}`);
    const head = `  arm ${s[0].toUpperCase()} ${a.mode} ${a.phase}/${a.action}${a.poseValid ? '' : ' POSE INVALID'}${a.obstructed ? ' obstructed' : ''}${a.armedForFreshContact ? ' armed' : ''}`;
    lines.push(head);
    if (a.gripId) {
      const g = A.grips.get(a.gripId)!;
      lines.push(`    grip ${a.gripId} on ${g.targetId}:${g.targetPart}  T raw ${f ? f2(f.raw, 0) : '-'} act ${f ? f2(f.actual, 0) : '-'} alloc ${f ? f2(f.allocated, 0) : '-'} N  exp ${f2(g.overloadExposureS, 3)} s`);
    }
    if (a.clampContactId) {
      const c = A.clampOf(id, s)!;
      lines.push(`    clamp ${c.id} on ${c.targetId}:${c.targetPart}  N ${f2(c.normalForceN, 0)}  Ft ${f ? f2(f.tangentActual, 0) : '-'}/${f ? f2(f.frictionCap, 0) : '-'}  alloc ${f ? f2(f.allocated, 0) : '-'}  xT ${f ? f2(f.xT, 4) : '-'}`);
    }
    if (a.lastRelease) lines.push(`    last release ${a.lastRelease.reason} @ ${f2(a.lastRelease.t, 3)} s`);
  }
  const al = A.lastAllocation.get(id);
  if (al && al.sumDemand > 0) lines.push(`  arm budget demand ${f2(al.sumDemand, 0)} N  scale ${f2(al.scale, 3)}  actual ${f2(al.sumActual, 0)} / ${A.profile.hold.ownerBudgetN} N`);
  const w = A.wrap.get(id);
  if (w) {
    const az = Object.entries(w.azimuthDeg).map(([k, v]) => `${k[0].toUpperCase()} ${f2(v as number, 0)}°`).join(' ');
    lines.push(`  wrap ${w.status}${w.target ? ` on ${w.target}` : ''}${az ? `  az ${az}` : ''}${w.reasons.length ? `  (${w.reasons.join(',')})` : ''}`);
  }
}

// ---------------------------------------------------------------- info panel
const f2 = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const yawDeg = (q: Quat): number => (Math.atan2(forwardOf(q).x, forwardOf(q).z) * 180) / Math.PI;
const headDeg = (v: Vec3): number => (Math.atan2(v.x, v.z) * 180) / Math.PI;

function info(): void {
  const lines: string[] = [];
  if (modelError) lines.push(`MODEL LOAD FAILED (primitive view shown): ${modelError}`);
  else if (modelAsset) lines.push(`model bew-v6 (${MODEL_CALIBRATION_ID})${flags.primitives ? '  [primitive diagnostic view]' : ''}`);
  const bad = sim.result === 'numericalFailure';
  lines.push(`t ${f2(sim.t, 3)} s  tick ${sim.tick}  substeps/tick ${sim.def.solver.substeps}  dt ${f2(sim.dt * 1000, 2)} ms`);
  lines.push(`result ${sim.result}${bad ? '  << NUMERICAL FAILURE (not a stop)' : ''}  speed ${driver.speed}×${driver.discardedWallS > 0 ? `  dropped ${f2(driver.discardedWallS, 2)} s` : ''}`);
  lines.push(`solver ${sim.def.solver.id}  stance ${sim.def.stance.id}`);
  const gaps = Object.entries(sim.pairGap).map(([k, g]) => `${k} gap ${f2(g, 3)}`);
  if (gaps.length) lines.push(gaps.join('  ') + `  min ${Number.isFinite(sim.minPairGap) ? f2(sim.minPairGap, 3) : '-'}`);
  const cn = sim.counts();
  lines.push(`engine bodies ${cn.bodies}  joints ${cn.joints}  colliders ${cn.colliders}  grips ${cn.grips}  clamps ${cn.clamps}${sim.def.ragdoll ? `  ragdoll ${sim.def.ragdoll.id}` : ''}`);
  for (const pl of sim.players) {
    const k = sim.bulk(pl);
    const v = k.v;
    const a = pl.applied;
    const q = corePose(pl).q;
    lines.push('');
    lines.push(`${pl.id} (${pl.setup.role}) ${pl.body.id}  ${f2(k.massKg, 1)} kg  ${pl.representation}${pl.rag ? ` (${sim.bodyCount(pl.id)} bodies)` : ''}`);
    if (pl.handoff) {
      const h = pl.handoff;
      if (h.audit)
        lines.push(`  HANDOFF${h.outcome === 'transferFailed' ? ' TRANSFER FAILED' : ''} @${f2(h.t, 3)} ${h.reason}  P err ${h.audit.linearRelErr.toExponential(1)}  L err ${h.audit.angularRelErr.toExponential(1)}  ΔKE ${f2(h.audit.energyDeltaJ, 1)} / ${f2(h.audit.energyGainLimitJ, 1)} J  anchors ${f2(h.report.maxAnchorErrM * 1000, 2)} mm  pen ${f2(h.report.maxNewExternalPenetrationM * 1000, 1)} mm${h.audit.ok ? '' : `  (${h.audit.reasons.join(',')}: diagnostic state, no completion)`}`);
      else lines.push(`  HANDOFF REJECTED @${f2(h.t, 3)} ${h.report.reasons.join(',')} — falling proxy kept`);
    }
    if (pl.ragStats) lines.push(`  ragdoll max joint sep ${f2(pl.ragStats.maxAnchorErrM * 1000, 1)} mm  max floor pen ${f2(pl.ragStats.maxFloorPenM * 1000, 1)} mm  hinge ${Object.entries(pl.pose?.hingeDeg ?? {}).filter(([kk]) => kk !== 'neck').map(([kk, vv]) => `${kk.replace('left', 'L').replace('right', 'R')} ${f2(vv, 0)}°`).join(' ')}`);
    if (pl.fall) {
      const fe = pl.fall;
      const armText = (arm: typeof fe.arms.left): string => `${arm.task}${arm.brace === 'none' ? '' : `/${arm.brace}`}`;
      const st = fe.stats;
      lines.push(`  FALL effort ${f2(fe.effort, 2)}${fe.done ? ' done' : fe.exhausted ? ' exhausted' : ''}  L ${armText(fe.arms.left)}  R ${armText(fe.arms.right)}  work +${f2(st.positiveWorkJ, 1)} / -${f2(st.negativeWorkJ, 1)} J  peak ${f2(st.peakPositiveW, 0)} W${st.overPowerSubsteps || st.overWork ? '  OVER CAP' : ''}`);
      const torques = fe.applied.filter((c) => c.entry.appliedNm > 0.05).map((c) => `${c.entry.joint.replace('left', 'L').replace('right', 'R')} ${f2(c.entry.appliedNm, 1)}`);
      if (torques.length) lines.push(`  effort N·m ${torques.join(' ')}`);
    }
    if (pl.rag?.envelope) {
      const past = pl.rag.envelope.filter((e) => e.overDeg > 0.05).map((e) => `${e.jointId.replace('left', 'L').replace('right', 'R')} ${f2(e.overDeg, 1)}°`);
      lines.push(`  limits max past ${f2(Math.max(0, ...pl.rag.envelope.map((e) => e.maxOverDeg)), 1)}°${past.length ? `  now ${past.join(' ')}` : ''}`);
    }
    lines.push(`  v ${f2(Math.hypot(v.x, v.z))} m/s  req ${f2(len(horiz(a.requestedVelocity)))}  ${pl.grounded ? 'grounded' : 'AIRBORNE'}  ${pl.controlMode}`);
    lines.push(`  drive ${f2(len(a.drive), 0)} / ${f2(a.driveCap, 0)} N${a.driveSaturated ? ' SAT' : ''}  yawT ${f2(a.yawTorque, 0)} / ${f2(a.yawCap, 0)} N·m`);
    lines.push(`  facing ${f2(yawDeg(q), 1)}°  req ${f2(headDeg(pl.intent.locomotion.desiredFacingWorld), 1)}°  ωy ${f2(k.w.y)}`);
    const obs = sim.contactObs[pl.id] ?? [];
    if (obs.length) lines.push(`  contact ${[...new Set(obs.map((o) => `${o.ownClass}>${o.other}:${o.otherClass}`))].join(' ')}`);
    if (pl.run && sim.def.runClips && !pl.rag) {
      const st = pl.run;
      const res = Object.entries(pl.pose?.targetResidualM ?? {}).map(([kk, vv]) => `${kk.replace('left', 'L').replace('right', 'R')} ${f2(vv, 3)}`);
      lines.push(`  run ${st.w > 0 ? playbackLabel(st, sim.def.runClips) : 'procedural gait'}  u ${f2(st.u, 3)}  w ${f2(st.w, 2)} (→${f2(st.wTarget, 2)})  rate ${f2(st.rate, 3)}  v ${f2(st.speed, 2)}${res.length ? `  res ${res.join(' ')} m` : ''}`);
    }
    if (pl.sus && !pl.rag) {
      // plan 06a suspension: requested vs achieved root height, force (commanded / applied / ceiling), authority, probe
      const u = pl.sus;
      const W = k.massKg * Math.abs(sim.def.solver.gravityY);
      const S = sim.suspension!;
      const sat = u.saturated === 'max' ? ' SAT-MAX' : u.saturated === 'zero' && u.active ? ' at 0' : '';
      lines.push(
        `  support h ${Number.isFinite(u.probe.heightM) ? f2(u.probe.heightM, 3) : '-'} / target ${f2(u.targetM, 3)} m (req ${f2(u.requestM, 2)}${Number.isFinite(u.runM) ? `  clip ${f2(u.runM, 3)} ×${f2(u.bobScale, 2)}` : ''})  ` +
          `F ${f2(u.appliedN / W, 2)} BW (cmd ${f2(u.commandedN / W, 2)}, max ${S.maxForceBW}; pivot ${f2(u.pivotN / W, 2)} + COM ${f2(u.comN / W, 2)}, tip ${f2(Math.hypot(u.tipTorqueNm.x, u.tipTorqueNm.z), 0)} N m)${sat}  auth ${f2(u.authority, 2)}  probe ${u.probe.status}${u.bottomed ? '  GUARD DOWN' : ''}${u.active ? '' : '  (off)'}`,
      );
    }
    if (pl.feet && !pl.rag) {
      // plan 07 foot planner: mode (planted / step swing / follow swing / airborne), contact-feature error and drift while
      // planted, swing progress and commanded speed, last release reason
      const one = (s: ArmSide): string => {
        const ft = pl.feet!.feet[s];
        const m = ft.mode === 'planted' ? 'planted' : ft.mode === 'airborne' ? 'airborne' : ft.source === 'step' ? 'step' : 'follow';
        const body =
          ft.mode === 'planted'
            ? `err ${f2(ft.featureErrM * 100, 2)} cm drift ${f2(ft.driftM * 100, 2)} cm`
            : ft.mode === 'swing' && ft.source === 'step'
              ? `${f2(ft.durS > 0 ? Math.min(1, ft.elapsedS / ft.durS) : 0, 2)} of ${f2(ft.durS, 2)} s  ${f2(ft.speedMps, 2)} m/s`
              : `${f2(ft.speedMps, 2)} m/s`;
        return `${s === 'left' ? 'L' : 'R'} ${m}${ft.mode === 'planted' && ft.tentative ? ' (proposed)' : ''} ${body}  res ${f2(ft.residualM * 100, 1)} cm${ft.releaseReason ? `  (released: ${ft.releaseReason})` : ''}${ft.fails ? `  failed ${ft.fails}/${ft.attempts} (last: ${ft.failReason})` : ''}`;
      };
      const st = pl.feet.stats;
      const cov = (s: ArmSide): string => (st.cover[s].eligibleS > 0 ? `${f2((100 * st.cover[s].plantedS) / st.cover[s].eligibleS, 0)}%` : '-');
      lines.push(`  feet ${pl.feet.profile.id}  ${one('left')}  |  ${one('right')}`);
      lines.push(`  plants confirmed ${st.confirmed}/${st.attempts} proposed, failed ${st.failed}, sustained ${st.sustained}; eligible stance planted L ${cov('left')} R ${cov('right')}`);
    }
    if (pl.loco && !pl.rag) lines.push(`  locomotion ${pl.loco.mode} (${pl.loco.reason})  prep ${f2(pl.loco.prepW, 2)}  contact ${f2(pl.loco.contactW, 2)}  arm swing ${f2(pl.loco.swing, 2)}${pl.feet?.brakeHeld ? '  planner holds legs (braking)' : ''}`);
    balanceInfo(pl, lines);
    armInfo(pl.id, lines);
    const d = pl.intent.debug;
    if (d && d.phase && d.selectedShoulder) {
      const lev = d.leverageLat as Vec3 | undefined;
      const levLocal = lev ? qInvRot(q, lev) : null;
      lines.push(`  phase ${d.phase}  shoulder ${d.selectedShoulder} (strike surface)  fit ${d.fitCompatible ? 'ok' : 'NO'}`);
      lines.push(`  gap ${f2(Number(d.gap), 2)}  horizon ${f2(Number(d.horizon), 2)} s  ceiling ${f2(Number(d.entryCeiling), 2)}  headClear ${f2(Number(d.headClearance), 3)}`);
      if (lev) lines.push(`  leverage (${f2(lev.x, 2)}, ${f2(lev.z, 2)}) world  ${levLocal && levLocal.x > 0 ? 'own-left' : 'own-right'}`);
    }
  }
  if (sim.rules) {
    const R = sim.rules;
    const row = R.lastRow;
    lines.push('');
    lines.push(`rules ${R.profile.id}  runner ${R.runnerId}${R.disabledReason ? `  DISABLED (${R.disabledReason})` : ''}`);
    if (row) {
      lines.push(`  influence ${row.infl ? 'ACTIVE' : 'none'}  ground ${row.gnd.length ? row.gnd.join(' ') : '-'}  (? = achieved-pose probe)`);
      if (row.prog) lines.push(`  progress window ${f2(row.prog.win, 2)} / ${R.profile.progress.windowS} s  advance ${f2(row.prog.adv, 3)} m  request ${f2(row.prog.req, 1)} m/s  restraint ${f2(row.prog.res, 0)} N`);
    }
    const e = sim.ending;
    if (e) lines.push(`  ENDING ${e.kind} @${f2(e.t, 3)} s (substep ${e.substep})  spot (${f2(e.ballSpot.x, 2)}, ${f2(e.ballSpot.z, 2)})  ${String(e.evidence.region ?? '')}`);
  }
  const recent = sim.events.filter((e) => e.type !== 'grounded').slice(-6);
  if (recent.length) {
    lines.push('');
    for (const e of recent) lines.push(`${f2(e.t, 3)} ${e.type} ${e.playerId ?? ''} ${compact(e.data)}`);
  }
  const el = $('info');
  el.textContent = lines.join('\n');
  el.classList.toggle('bad', bad || !!modelError);
}

function compact(d: Record<string, unknown> | undefined): string {
  return Object.entries(d ?? {})
    .filter(([k]) => k !== 'point')
    .map(([k, v]) => `${k}=${typeof v === 'number' ? round(v, 3) : Array.isArray(v) ? compactArray(v) : v && typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}

/** Vectors as rounded tuples; id lists shortened to the first few entries. */
function compactArray(v: unknown[]): string {
  if (v.every((x) => typeof x === 'number')) return `(${v.map((x) => round(x as number, 2)).join(', ')})`;
  const head = v.slice(0, 3).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
  return `[${head.join(',')}${v.length > 3 ? `,+${v.length - 3}` : ''}]`;
}

// ---------------------------------------------------------------- frame loop
let last = performance.now();
function frame(now: number): void {
  const wall = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (sim && driver) {
    if (runToT !== null) {
      while (!sim.done && sim.t < runToT - 1e-9) stepOnce();
      runToT = null;
      driver.paused = true;
      updateRunButton();
    }
    const n = sim.done ? 0 : driver.frame(wall);
    for (let i = 0; i < n && !sim.done; i++) stepOnce();
    if (sim.done && !driver.paused) {
      driver.paused = true;
      updateRunButton();
    }
    const alpha = driver.paused ? 1 : driver.alpha();
    // contacts
    const pts: { p: Vec3; color: number }[] = [];
    for (const c of sim.contacts) {
      if (c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) for (const p of c.points) pts.push({ p: p.pointWorld, color: 0xff2020 });
    }
    // plan 07 foot anchors: planted contact feature (green), step swing destination (amber)
    for (const pl of sim.players) {
      if (!pl.feet || pl.rag) continue;
      for (const s of ['left', 'right'] as const) {
        const ft = pl.feet.feet[s];
        if (ft.mode === 'planted' && ft.anchorW) pts.push({ p: ft.anchorW, color: 0x20e040 });
        else if (ft.mode === 'swing' && ft.source === 'step' && ft.dest) pts.push({ p: ft.dest, color: 0xffb020 });
      }
    }
    contactMarkers.set(pts, flags.overlays);
    // interpolated core poses; sim-state points are re-expressed in each body's frame so arms stay attached
    const interp = new Map<string, Pose>();
    const current = new Map<string, Pose>();
    const poses = new Map<string, PhysicalPose | null>();
    for (const v of views) {
      const pl = v.pl;
      const cur = corePose(pl);
      // a representation change resets the interpolation history (no blend from the proxy into ten new bodies)
      if (seenRep.get(pl.id) !== pl.representation) {
        seenRep.set(pl.id, pl.representation);
        prevPose.set(pl.id, { core: cur, pose: clonePose(pl.pose), rep: pl.representation, com: { ...sim.bulk(pl).com } });
        v.syncColliders(sim.activeColliders(pl));
      }
      const pp = prevPose.get(pl.id);
      const compatible = pp && pp.rep === pl.representation;
      const prev = compatible ? pp.core : cur;
      poses.set(pl.id, compatible && pp.pose && pl.pose ? lerpPose(pp.pose, pl.pose, alpha) : pl.pose);
      const p = new THREE.Vector3(prev.p.x, prev.p.y, prev.p.z).lerp(new THREE.Vector3(cur.p.x, cur.p.y, cur.p.z), alpha);
      const q = new THREE.Quaternion(prev.q.x, prev.q.y, prev.q.z, prev.q.w).slerp(new THREE.Quaternion(cur.q.x, cur.q.y, cur.q.z, cur.q.w), alpha);
      interp.set(pl.id, { p: v3(p.x, p.y, p.z), q: { x: q.x, y: q.y, z: q.z, w: q.w } });
      current.set(pl.id, cur);
    }
    const mapPt = (id: string, w: Vec3): Vec3 => toWorld(interp.get(id)!, toLocal(current.get(id)!, w));
    const mapDir = (id: string, d: Vec3): Vec3 => qRot(interp.get(id)!.q, qInvRot(current.get(id)!.q, d));
    if (ruleOverlay && sim.rules && interp.has(sim.rules.runnerId)) {
      const rid = sim.rules.runnerId;
      const src = sim.rules.profile.ballSource;
      const rp = poses.get(rid) ?? null;
      const core = interp.get(rid)!;
      const seated = src === 'carryPose' ? carriedBall(rp) : null;
      const palm = src === 'carryPalm' ? rp?.jointLandmarksWorld.rightPalm : undefined;
      ruleOverlay.update(seated ?? { p: palm ?? toWorld(core, sim.rules.profile.ballLocal), q: forwardBallQ(core.q) }, sim.ending?.ballSpot ?? null);
    }
    for (const v of views) {
      const pl = v.pl;
      const core = interp.get(pl.id)!;
      const armObs = sim.arms?.obs(pl.id);
      const pose = poses.get(pl.id) ?? null;
      v.update(core, pose, flags, sim.bulk(pl));
      const ov = armOverlays.get(pl.id);
      if (ov && armObs) ov.update(armOverlayData(pl.id, armObs, mapPt, mapDir), flags.overlays);
      const bo = balOverlays.get(pl.id);
      if (bo) {
        const B = sim.balanceProfile;
        const bal = pl.balance;
        const deg = (r: number): number => (r * 180) / Math.PI;
        bo.update(
          {
            com: sim.bulk(pl).com,
            bodyUp: qRot(core.q, v3(0, 1, 0)),
            desiredUp: bal.desiredUp,
            leanDeg: deg(bal.theta),
            projectedDeg: deg(bal.projected),
            envelopeDeg: deg(B.envelopeRad),
            falling: pl.controlMode === 'falling',
            label: `${pl.id} ${f2(deg(bal.theta), 1)}°  proj ${f2(deg(bal.projected), 1)}°${pl.controlMode === 'falling' ? '  FALLING' : ''}`,
          },
          flags.overlays,
        );
      }
    }
    if (follow) {
      const c = actionCenter(alpha);
      const d = c.clone().sub(controls.target);
      controls.target.add(d);
      camera.position.add(d);
    }
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
  runTo: (t: number) => {
    while (!sim.done && sim.t < t - 1e-9) stepOnce();
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

fillFixtureSelect();
wire();
resize();
const sp = params.get('speed');
if (sp) ($('speed') as HTMLSelectElement).value = sp;
void load(params.get('fixture') ?? fixtures[0].id);
requestAnimationFrame(frame);
