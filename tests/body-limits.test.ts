// The body's own limits, plans 11 and 12, both opt in under the L3, L4 and HC fixtures; every other fixture is unchanged.
//
// Plan 11: arm self-clearance. Arms used to ignore the player's own body (supported pose arms, arm-task arms and the
// ragdoll's same-owner filter), so forearms and hands crossed the torso by up to 28 cm. Under the opt-in profile (the
// L3, L4 and HC fixtures) each arm's self shapes (forearm over its joints, palm, fingers) stay out of the player's
// measured trunk (mesh-fit convex pieces) beyond the skin-contact tolerance; every other fixture is unchanged.
//
// Plan 12: joint range for shoulders and ankles. Under the opt-in profile (the L3, L4 and HC fixtures) one shoulder swing cone
// (45 deg behind the side line hanging, 30 deg at horizontal) limits the supported pose arms, the arm-task arms and the ragdoll
// envelope; the supported ankle dorsiflexes at most 25 deg (past it the heel lifts and the foot stands on its ball); a ragdoll's
// limp foot eases to 15 deg toe down. Each check is shown failing with the profile removed (the twin).
//
// Plan 13b: self-clearance and joint range in one file, so a fixture both read is simulated once (see `watched`).
//
// Plan 13f: the predictive leg guard. Under the opt-in profile (the L3, L4 and HC fixtures) the supported pose's leg guard
// measures and pushes legs against other bodies where they are now and where they will be one physics substep on, so a
// candidate built from the pose stays inside the conversion's penetration tolerance while another player closes in.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import type { FixtureDef } from '../src/sim/fixture';
import { MODEL_CALIBRATION as C } from '../src/sim/model/profiles';
import { armSelfShapes, buildProxyPose, CONT_LEG_MPS, HARD_OK, hingeChain, LEG_SWEEP_M, poseLimbShapes, twoBone, type PhysicalPose, type PoseClearance, type PoseMemory, type PoseShape, type ProxyPoseInput } from '../src/sim/pose';
import { initPhysics, RAPIER, trunkShapes } from '../src/sim/physics';
import { armTwistRad, behindDeg, fitElbowTwist, swingExcess, swingExtentDeg, twistWindow, TWIST_FIT_TOL_RAD } from '../src/sim/joint-cone';
import { FOOTWORK_L3 } from '../src/sim/footwork';
import { ENVELOPE_L4, JOINT_RANGE_V1, JOINT_RANGE_V2, LEG_GUARD_V1, LEG_GUARD_V2, LEG_GUARD_V3, SELF_CLEARANCE_V1, sideSignX, withoutBornOverlap, withoutConversionRetry } from '../src/sim/profiles';
import { externalTwistRad, SEGMENTS, swingTwistOf, type ExternalShape, type RagdollCollider } from '../src/sim/ragdoll';
import { LIMP_SHOE_CLEARANCE_M, Simulation, type PlayerRuntime, type SimOptions } from '../src/sim/simulation';
import { add, addScaled, cross, dist, len, norm, qConj, qFromAxisAngle, qFromUnitVectors, qFromYaw, qMul, qRot, scale, sub, v3, vc, wrapPi, type Pose, type Quat, type Vec3 } from '../src/sim/vec';
import { FIX, preBornOverlap, preFlip, preMetArmStay, rows, runSim } from './helpers';
import { holdArmBehind, jointPastRange, limbInBody } from './visible-bar';

/** A table of named checks: each runs, and the test fails once with every failing check's name and first failure. */
type Check = [string, () => void | Promise<void>];
const checks = (cs: Check[]): Promise<void> => rows(cs, ([n]) => n, ([, f]) => f());

type Src = 'pose' | 'armTask' | 'ragdoll';

// ------------------------------------------------------------------ plan 11: the own-trunk depth
const TOL = SELF_CLEARANCE_V1.toleranceM;

function rapierShape(s: PoseShape): { shape: RAPIER.Shape; p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } } {
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), p: s.c, q: { x: 0, y: 0, z: 0, w: 1 } };
  if (s.kind !== 'capsule') throw new Error('unexpected shape');
  const d = sub(s.b, s.a);
  const l = Math.max(len(d), 1e-9);
  return { shape: new RAPIER.Capsule(l / 2, s.r), p: addScaled(s.a, d, 0.5), q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) };
}

/**
 * Deepest penetration (m) of either arm's self shapes, at their full radii, in the player's own measured trunk; and
 * (ladder 15) whether a bone axis of the arm (the forearm's elbow to wrist, the hand's palm to tip: the self shapes'
 * axes, at 1 mm) is inside a trunk piece.
 */
function selfDepth(def: FixtureDef, pl: PlayerRuntime, side: 'left' | 'right'): { d: number; axisIn: boolean } {
  const T = trunkShapes(pl.body);
  if (!T || !pl.pose) return { d: 0, axisIn: false };
  const lm = pl.pose.jointLandmarksWorld;
  const core = pl.pose.segments.core;
  let d = 0;
  let axisIn = false;
  for (const s of armSelfShapes(def.ragdoll!.radii, pl.body.measured!.handTipM!, side, lm[`${side}Elbow`], lm[`${side}Wrist`], lm[`${side}Palm`])) {
    const q = rapierShape(s);
    const ax = s.kind === 'capsule' ? rapierShape({ ...s, r: AXIS_R }) : null;
    for (const t of T) {
      const r = t.contactShape(core.originWorld, core.rotationWorld, q.shape, q.p, q.q, 0.02);
      if (r) d = Math.max(d, -r.distance);
      if (ax && !axisIn) {
        const a = t.contactShape(core.originWorld, core.rotationWorld, ax.shape, ax.p, ax.q, 0);
        if (a && -a.distance > AXIS_R) axisIn = true;
      }
    }
  }
  return { d, axisIn };
}
const AXIS_R = 0.001;

/**
 * The worst own-trunk depth per arm source, every tick of a run; and (ladder 15) the visible-bar rule per source, a
 * limb in a body (tests/visible-bar.ts limbInBody), fed every drawn frame of every arm.
 */
function depthObserver(def: FixtureDef): { out: Record<Src, { d: number; at: string }>; limb: Record<Src, ReturnType<typeof limbInBody>>; tick: (s: Simulation) => void } {
  const out: Record<Src, { d: number; at: string }> = { pose: { d: 0, at: '' }, armTask: { d: 0, at: '' }, ragdoll: { d: 0, at: '' } };
  const limb: Record<Src, ReturnType<typeof limbInBody>> = { pose: limbInBody(), armTask: limbInBody(), ragdoll: limbInBody() };
  let last = 0;
  return {
    out,
    limb,
    tick: (s) => {
      const dt = s.t - last;
      last = s.t;
      for (const pl of s.players)
        for (const side of ['left', 'right'] as const) {
          const src: Src = pl.rag ? 'ragdoll' : s.arms?.obs(pl.id)?.[side]?.enabled ? 'armTask' : 'pose';
          const { d, axisIn } = selfDepth(def, pl, side);
          const at = `${def.id} ${pl.id}.${side}@${s.t.toFixed(3)}`;
          if (d > out[src].d) out[src] = { d, at: `${pl.id}.${side}@${s.t.toFixed(3)}` };
          for (const k of ['pose', 'armTask', 'ragdoll'] as const) limb[k].sample(`${pl.id}.${side}`, s.t, dt, k === src ? d : 0, k === src && axisIn, at);
        }
    },
  };
}

const without = (def: FixtureDef): FixtureDef => ({ ...def, id: `${def.id}-noSelf`, selfClearance: undefined });

// The ragdoll negative control's deliberate drive: from the substep a player's ragdoll takes over, for PULL_S, each
// forearm's palm is pulled toward its own core by an equal and opposite PULL_N pair (on the forearm at the palm, on the
// core at the same point: internal, so the body's momentum is unchanged). Every converted forearm is then driven into its
// own trunk, whatever the run before the switch did, so the profile and its twin meet the same load: with the profile the
// trunk pieces stop it, without them it passes through. Runs listed with `pulled` take it.
const PULL_N = 300;
const PULL_S = 0.3;
const PULLED = new Set<string>();
const pulled = (def: FixtureDef): FixtureDef => {
  const d = { ...def, id: `${def.id}-pulled` };
  PULLED.add(d.id);
  return d;
};
function pullForearms(): (s: Simulation) => void {
  const from = new Map<string, number>();
  return (s) => {
    for (const pl of s.players) {
      if (!pl.rag || !pl.pose) continue;
      if (!from.has(pl.id)) from.set(pl.id, s.t);
      if (s.t - from.get(pl.id)! > PULL_S) continue;
      const core = pl.rag.bodies.core;
      const c = core.translation();
      for (const side of ['left', 'right'] as const) {
        const palm = pl.pose.jointLandmarksWorld[`${side}Palm`];
        const j = scale(norm(sub(v3(c.x, c.y, c.z), palm)), PULL_N * s.physics.dt);
        pl.rag.bodies[`${side}Forearm`].applyImpulseAtPoint(j, palm, true);
        core.applyImpulseAtPoint(scale(j, -1), palm, true);
      }
    }
  };
}

// ------------------------------------------------------------------ plan 12: the joint-range probe

const J = JOINT_RANGE_V1;
const D = Math.PI / 180;
const twin = (d: FixtureDef): FixtureDef => ({ ...d, id: `${d.id}-noRange`, jointRange: undefined });
/** Ladder rung 7d: `d` pinned to LEG_GUARD_V1, the guard a natural sample was taken under (its own id while it registers V1, the runs being cached by id). */
const pinV1 = (d: FixtureDef): FixtureDef => (!d.legGuard || d.legGuard.id === LEG_GUARD_V1.id ? d : { ...d, id: `${d.id}~v1`, legGuard: LEG_GUARD_V1 });
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** The upper arm's direction in the core frame (unit). */
function upperArm(pl: PlayerRuntime, side: Side): Vec3 {
  const lm = pl.pose!.jointLandmarksWorld;
  const u = sub(lm[`${side}Elbow`], lm[`${side}Shoulder`]);
  return qRot(qConj(pl.pose!.segments.core.rotationWorld), scale(u, 1 / len(u)));
}

/** Shoulder swing excess past the profile's cone (deg, negative inside). */
const excessDeg = (pl: PlayerRuntime, side: Side): number => swingExcess(J.shoulder, upperArm(pl, side), sideSignX(pl.body, side)).rad / D;

interface Probe {
  /** Worst excess (deg) and behind angle (deg) per arm source, with where. */
  worst: Record<Src, { ex: number; behind: number; at: string }>;
  /** Longest run (s) of a ragdoll arm more than the envelope's 5 deg tolerance past the cone (printed, ladder 15). */
  ragOverRunS: number;
  /** Ladder 15: the visible-bar rule on the ragdoll arms, past the cone (tests/visible-bar.ts jointPastRange). */
  ragPast: ReturnType<typeof jointPastRange>;
  /** Supported ankle minimum (deg). */
  ankleMin: number;
  /** Per ragdoll: the published pitch on its first ragdoll tick, 0.35 s later, and the limp foot's held substeps then. */
  feet: Map<string, { t: number; conv: Partial<Record<Side, number>>; late?: Partial<Record<Side, number>>; held?: Record<Side, number> }>;
  /** Planted (held) supported feet: ticks, ticks past the ankle range, worst contact gap and slide (m). */
  planted: { n: number; past: number; gapM: number; hzM: number };
}

/** The joint-range probe, every tick of a run. */
function rangeObserver(): { out: Probe; tick: (s: Simulation) => void } {
  const worst = { pose: { ex: -999, behind: -999, at: '' }, armTask: { ex: -999, behind: -999, at: '' }, ragdoll: { ex: -999, behind: -999, at: '' } };
  const run = new Map<string, number>();
  const out: Probe = { worst, ragOverRunS: 0, ragPast: jointPastRange(), ankleMin: 999, feet: new Map(), planted: { n: 0, past: 0, gapM: 0, hzM: 0 } };
  let last = 0;
  return {
    out,
    tick: (s) => {
      const dt = s.t - last;
      last = s.t;
      for (const pl of s.players) {
        if (!pl.pose) continue;
        const ap = pl.pose.anklePitchDeg ?? {};
        for (const side of SIDES) {
          const src: Src = pl.rag ? 'ragdoll' : s.arms?.obs(pl.id)?.[side]?.enabled ? 'armTask' : 'pose';
          const ex = excessDeg(pl, side);
          const w = worst[src];
          if (ex > w.ex) [w.ex, w.at] = [ex, `${pl.id}.${side}@${s.t.toFixed(3)}`];
          w.behind = Math.max(w.behind, behindDeg(upperArm(pl, side)));
          const k = `${pl.id}.${side}`;
          if (src === 'ragdoll') out.ragPast.sample(k, s.t, dt, ex, `${pl.id}.${side}@${s.t.toFixed(3)}`);
          const r = src === 'ragdoll' && ex > 5 ? (run.get(k) ?? 0) + dt : 0;
          run.set(k, r);
          out.ragOverRunS = Math.max(out.ragOverRunS, r);
          const f = pl.feet?.feet[side];
          if (!pl.rag && ap[side] !== undefined) {
            out.ankleMin = Math.min(out.ankleMin, ap[side]!);
            if (f && f.mode === 'planted' && !f.tentative) {
              out.planted.n++;
              if (ap[side]! < -J.ankle.dorsiDeg - 1e-9) out.planted.past++;
              out.planted.gapM = Math.max(out.planted.gapM, f.gapM);
              out.planted.hzM = Math.max(out.planted.hzM, f.featureHzM);
            }
          }
        }
        if (pl.rag) {
          const c = out.feet.get(pl.id);
          if (!c) out.feet.set(pl.id, { t: s.t, conv: { ...ap } });
          else if (!c.late && s.t >= c.t + 0.35 - 1e-9) c.late = { ...ap }, (c.held = { ...(pl.rag.limpFoot?.heldSubsteps ?? { left: 0, right: 0 }) });
        }
      }
    },
  };
}

// ------------------------------------------------------------------ plan 12: the limp-shoe rule
// The limp shoe's hold (Simulation.shoeDeeper, called by easeLimpFeet once per easing shoe per substep): a shoe waits
// when its turn would bring it closer to another player inside LIMP_SHOE_CLEARANCE_M (that player's active colliders, or
// the published limbs of a player that can still convert; floor and obstacles not counted). The recorder wraps the
// decision on the run's Simulation and recomputes the condition itself, uncached and unculled (Rapier's contact query
// between the shapes, beyond the clearance nothing), so the check reads the rule, not which fixture happens to reach it.
type ShoeDecide = (pl: PlayerRuntime, c: RagdollCollider, from: Pose, to: Pose, limbs: Map<string, ExternalShape[]>) => boolean;
interface LimpCall {
  /** fixture-local shoe key `player.side` */
  k: string;
  step: number;
  /** the shoe's pitch when asked (deg), its target and the step one substep allows (deg) */
  pitch: number;
  target: number;
  stepDeg: number;
  held: boolean;
  /** the rule's condition, recomputed */
  cond: boolean;
}
const LIMP = new Set<string>();
const limpRule = (defs: FixtureDef[]): void => defs.forEach((d) => LIMP.add(d.id));

/** Records every hold decision of `sim`; `fault` replaces the decision (given the simulation's own) for a fault control. */
function recordLimp(sim: Simulation, fault?: (own: ShoeDecide) => ShoeDecide): LimpCall[] {
  const calls: LimpCall[] = [];
  const own = sim.shoeDeeper.bind(sim) as ShoeDecide;
  const decide = fault ? fault(own) : own;
  const M = LIMP_SHOE_CLEARANCE_M;
  const gap = (e: { shape: RAPIER.Shape; pose: Pose }, shape: RAPIER.Shape, at: Pose): number =>
    e.shape.contactShape(e.pose.p, e.pose.q, shape, at.p, at.q, M)?.distance ?? M;
  sim.shoeDeeper = ((pl, c, from, to, limbs) => {
    const F = pl.rag!.limpFoot!;
    const side: Side = F.shoes.left === c ? 'left' : 'right';
    let cond = false;
    for (const o of sim.players) {
      if (o === pl) continue;
      const ext = sim.activeColliders(o).map((k) => ({ shape: k.shape, pose: { p: vc(k.translation()), q: { ...k.rotation() } } }));
      if (!o.rag && !o.handoff) ext.push(...(limbs.get(o.id) ?? []));
      for (const e of ext) {
        const g = gap(e, c.collider.shape, to);
        if (g < M && g < gap(e, c.collider.shape, from) - 1e-6) cond = true;
      }
    }
    const held = decide(pl, c, from, to, limbs);
    calls.push({ k: `${pl.id}.${side}`, step: sim.steps, pitch: pl.rag!.anklePitchDeg![side] ?? 0, target: F.targetDeg, stepDeg: F.rateDegPerS[side] * sim.physics.dt, held, cond });
    return held;
  }) as typeof sim.shoeDeeper;
  return calls;
}

/**
 * Every way the recorded calls break plan 12's rule: a shoe held without the condition or turned with it, a held shoe
 * that moved, or a turned shoe that moved other than one rate step toward its target (the remainder on the last).
 */
function limpViolations(id: string, calls: LimpCall[]): string[] {
  const bad: string[] = [];
  const last = new Map<string, LimpCall>();
  for (const c of calls) {
    if (c.held !== c.cond) bad.push(`${id} ${c.k}@${c.step}: ${c.held ? 'held without' : 'turned with'} the condition`);
    const p = last.get(c.k);
    if (p && c.step === p.step + 1) {
      const want = p.held ? p.pitch : Math.abs(p.target - p.pitch) <= p.stepDeg ? p.target : p.pitch + Math.sign(p.target - p.pitch) * p.stepDeg;
      if (Math.abs(c.pitch - want) > 1e-9) bad.push(`${id} ${c.k}@${p.step}: ${p.held ? 'held' : 'turned'} ${p.pitch.toFixed(4)} -> ${c.pitch.toFixed(4)} deg, the rule gives ${want.toFixed(4)}`);
    }
    last.set(c.k, c);
  }
  return bad;
}

// ------------------------------------------------------------------ one run per fixture
// Plan 13b: the self-clearance and joint-range checks read the same run (`Simulation.create(def)`, to its end), so each
// fixture is simulated once, with the joint-range probe (cheap) on every run and the own-trunk depth (shape queries every
// tick) on the runs whose fixtures a self-clearance test lists with `measureDepth` while the file is collected, before any
// test runs. Both observers only read.
const DEPTH = new Set<string>();
const measureDepth = (defs: FixtureDef[]): void => defs.forEach((d) => DEPTH.add(d.id));

type Watched = { depth?: Record<Src, { d: number; at: string }>; limb?: Record<Src, ReturnType<typeof limbInBody>>; range: Probe; limp?: LimpCall[] };
const runs = new Map<string, Promise<Watched>>();
const watched = (def: FixtureDef): Promise<Watched> => {
  if (!runs.has(def.id)) runs.set(def.id, runWatched(def));
  return runs.get(def.id)!;
};
async function runWatched(def: FixtureDef, fault?: (own: ShoeDecide) => ShoeDecide): Promise<Watched> {
  const sim = await Simulation.create(def, PULLED.has(def.id) ? { onSubstep: pullForearms() } : {});
  const depth = DEPTH.has(def.id) ? depthObserver(def) : null;
  const range = rangeObserver();
  const limp = LIMP.has(def.id) || fault ? recordLimp(sim, fault) : undefined;
  await runSim(sim, Infinity, (s) => {
    depth?.tick(s);
    range.tick(s);
  });
  sim.dispose();
  return { depth: depth?.out, limb: depth?.limb, range: range.out, limp };
}

/** Ladder 15: the limb-in-a-body rule per arm source over a whole run (its depth measured: listed with measureDepth). */
async function limbBySource(def: FixtureDef): Promise<Record<Src, ReturnType<typeof limbInBody>>> {
  const w = (await watched(def)).limb;
  if (!w) throw new Error(`${def.id}: its run does not measure the own-trunk depth (list it with measureDepth)`);
  return w;
}

/** Worst own-trunk depth per arm source over a whole run. */
async function worstBySource(def: FixtureDef): Promise<Record<Src, { d: number; at: string }>> {
  const w = (await watched(def)).depth;
  if (!w) throw new Error(`${def.id}: its run does not measure the own-trunk depth (list it with measureDepth)`);
  return w;
}

const probe = async (def: FixtureDef): Promise<Probe> => (await watched(def)).range;

// ------------------------------------------------------------------ plan 11: arm self-clearance
describe('arm self-clearance: profile and geometry', () => {
  it('the profile is on for exactly the L3, L4 and HC fixtures, over a measured trunk of seven convex slabs inside the padded proxy boxes', async () => {
    await checks([
      [
        'is on for exactly the L3, L4 and HC fixtures',
        () => {
          for (const d of allFixtures()) expect(d.selfClearance, d.id).toBe(/^(L3|L4|HC)$/.test(d.milestone) ? SELF_CLEARANCE_V1 : undefined);
        },
      ],
      [
        'the measured trunk is seven convex slabs of the spine and hips skin, inside the padded proxy boxes',
        () => {
          expect(C.trunkHull.pieces).toHaveLength(7);
          const lo = [Math.min(C.pelvis.center[1] - C.pelvis.halfExtents[1], C.torso.center[1] - C.torso.halfExtents[1])];
          for (const pc of C.trunkHull.pieces) {
            expect(pc.points.length).toBeGreaterThanOrEqual(8);
            for (const [x, y, z] of pc.points) {
              // the boxes are 2-98 percentile bounds (with the clavicles): the hull may pass them by a few cm only
              expect(Math.abs(x)).toBeLessThan(C.torso.halfExtents[0] + 0.03);
              expect(y).toBeGreaterThan(lo[0] - 0.03);
              expect(Math.abs(z - C.torso.center[2])).toBeLessThan(C.torso.halfExtents[2] + 0.06);
            }
          }
          const body = FIX('L3-F16-sprint').players[0].body;
          expect(body.measured?.trunkHull).toHaveLength(7);
          expect(body.measured?.handTipM).toBe(C.glove.tipAlongM);
        },
      ],
    ]);
  });
});

describe('arm self-clearance: supported and arm-task arms stay out of the own trunk', () => {
  // free running (6.6 m/s), stopping, starting, walking and the carry: no other body near the arms
  const POSE = ['L3-F16-sprint', 'L3-F16-runStop', 'L3-F17-runStart', 'L3-F14-forward', 'L3-F13-carrier', 'L3-F13-free'];
  // tackles: the tackler's arm-task arms (reach, close, hold) never through its own torso
  const ARM_TASK = ['L3-F1-low', 'HC-F3-mirror', 'L3-F5-dragMirror'];
  measureDepth([...POSE, ...ARM_TASK].map(FIX));
  // plan 13d: the negative control is the walk swing. Fast Run's swing at 6.6 m/s stays off the trunk without the profile
  // (0.7 cm); the walk's swing still crosses it (3.6 cm, R.left at 1.45 s)
  measureDepth([without(FIX('L3-F14-forward'))]);

  // ladder 15: the visible bar (tests/visible-bar.ts limbInBody: deeper than 10 cm in a frame, 5 cm for 0.1 s, or the bone
  // axis inside for 0.1 s) replaced the skin tolerance plus 1.2 cm (pose arms) and plus 5 mm (arm-task arms); the deepest
  // per fixture is printed
  it('pose arms and arm-task arms never pass through the own trunk, on every free-running and tackle fixture listed', async () => {
    const said: string[] = [];
    await checks([
      ...POSE.map(
        (id): Check => [
          `${id}: pose arms not through the own trunk`,
          async () => {
            const l = (await limbBySource(FIX(id))).pose;
            said.push(`${id} pose ${(l.deepest().d * 100).toFixed(2)} cm (${l.deepest().at})`);
            expect(l.breaches()).toEqual([]);
          },
        ],
      ),
      ...ARM_TASK.map(
        (id): Check => [
          `${id}: arm-task arms not through the own trunk`,
          async () => {
            const l = (await limbBySource(FIX(id))).armTask;
            said.push(`${id} armTask ${(l.deepest().d * 100).toFixed(2)} cm (${l.deepest().at})`);
            expect(l.breaches()).toEqual([]);
          },
        ],
      ),
    ]);
    console.log(`arms in the own trunk, supported (ladder 15 meter; skin tolerance ${TOL * 100} cm): ${said.join('; ')}`);
  }, 240000);

  it('without the profile the same walk swing crosses the trunk (the historical path is unchanged)', async () => {
    // plan 14: 2.17 cm (was over 2.5) with the walk's free arms in the ground frame (its chest leans 3 to 7 deg)
    const w = await worstBySource(without(FIX('L3-F14-forward')));
    expect(w.pose.d).toBeGreaterThan(0.02);
  });
});

describe('arm self-clearance: ragdoll forearms collide with their own trunk', () => {
  const RAGDOLL = ['HC-F1-low', 'L3-F3-recover', 'L3-F16-handoff'];
  // contact motion M1: the twin also takes plan 12's joint-range-v1: with the twist kept in range L3-F3-recover's runner
  // converts with its forearm clear of the trunk, so without self-clearance alone it no longer crosses (0 cm)
  const withoutV1 = (def: FixtureDef): FixtureDef => ({ ...without(def), id: `${def.id}-noSelf-v1`, jointRange: JOINT_RANGE_V1 });
  measureDepth(RAGDOLL.flatMap((id) => [FIX(id), withoutV1(FIX(id)), pulled(FIX(id)), pulled(without(FIX(id)))]));

  it('ragdoll forearms stay out of the trunk; without the profile they pass through, on every ragdoll fixture listed', async () => {
    // ladder 15: the visible bar (limbInBody) replaced 2.5 cm; the deepest is printed
    const said: string[] = [];
    await rows(RAGDOLL, (id) => id, async (id) => {
      const l = (await limbBySource(FIX(id))).ragdoll;
      said.push(`${id} ${(l.deepest().d * 100).toFixed(2)} cm (${l.deepest().at})`);
      expect(l.breaches()).toEqual([]);
      const off = await worstBySource(withoutV1(FIX(id)));
      expect(off.ragdoll.d, off.ragdoll.at).toBeGreaterThan(0.05);
    });
    console.log(`arms in the own trunk, ragdoll (ladder 15 meter): ${said.join('; ')}`);
  }, 240000);

  it('negative control, driven: a forearm pulled into its own trunk is stopped by the profile and passes through without it, on every ragdoll fixture listed', async () => {
    // the natural sample above depends on where each run puts its forearms at the switch; the pulled pair does not: the
    // same fixture with and without the profile under the same deliberate pull of each converted forearm into its own trunk
    const said: string[] = [];
    await rows(RAGDOLL, (id) => id, async (id) => {
      // ladder 18e: the visible bar (limbInBody) replaced 2.5 cm here too. A ragdoll starts with its forearms where the
      // supported pose left them, and since the met-arm flip a met arm keeps its natural pose, which may be in its own
      // trunk (HC-F1-low R's left, 6.5 cm and its bone axis inside from 0.95 s: the MET_ARM_REQUEST_IN_TRUNK defect): the
      // ragdoll's first frame is then 5.7 cm in, and the profile takes it out under the pull (2.2 cm 0.17 s later; the
      // twin without the profile passes through). The deepest depth is where the run starts the forearm, not where the
      // profile stops it; it is printed
      const on = await worstBySource(pulled(FIX(id)));
      said.push(`${id} ${(on.ragdoll.d * 100).toFixed(2)} cm (${on.ragdoll.at})`);
      const off = await worstBySource(pulled(without(FIX(id))));
      expect(off.ragdoll.d, `pulled twin ${off.ragdoll.at}`).toBeGreaterThan(0.05);
      // ladder 15, the fault twin of the visible bar above: the profile holds the pulled forearms out of the trunk by the
      // rule; without it the rule sees them through it
      expect((await limbBySource(pulled(FIX(id)))).ragdoll.breaches(), id).toEqual([]);
      expect((await limbBySource(pulled(without(FIX(id))))).ragdoll.breaches().length, id).toBeGreaterThan(0);
    });
    console.log(`pulled forearms in the own trunk, ragdoll (ladder 18e meter): ${said.join('; ')}`);
  }, 240000);

  it('the plan 09 impact guard sees a forearm meeting its own trunk (L4-F9-contact)', async () => {
    // R's left forearm hits its own trunk at 1.14 s with a 41 N s impulse; unseen by the guard, the elbow realised 221 W
    // over the 150 W ceiling. The guard now holds that arm (its own trunk is an impact) and the episode stays within it
    const def = FIX('L4-F9-contact');
    let peak = 0;
    const sim = await Simulation.create(def, {
      onSubstep: (s) => {
        const pl = s.players.find((p) => p.id === 'R')!;
        if (pl.rag) for (const j of Object.values(s.selfImpulses(pl.rag))) peak = Math.max(peak, j);
      },
    });
    await runSim(sim, Infinity);
    expect(peak).toBeGreaterThan(def.fallResponse!.impactGuard.impulseNs);
    const r = (sim.exportFixture() as { fallEffort: Record<string, { overPowerSubsteps: number; heldSubsteps: number }> }).fallEffort.R;
    expect(r.overPowerSubsteps).toBe(0);
    sim.dispose();
  });

  it('the self colliders are massless, never in a contact record and never meet another player', async () => {
    const def = FIX('HC-F1-low');
    const on = await Simulation.create(def);
    const off = await Simulation.create(without(def));
    let checked = 0;
    const seen = (s: Simulation) => {
      for (const c of s.contacts) expect(c.a.key.startsWith('self') || c.b.key.startsWith('self')).toBe(false);
    };
    while (!on.done && !off.done) {
      on.stepTick();
      off.stepTick();
      seen(on);
      for (const pl of on.players) {
        if (!pl.rag) continue;
        const twin = off.players.find((p) => p.id === pl.id)!;
        if (!twin.rag) continue;
        for (const id of SEGMENTS) expect(pl.rag.bodies[id].mass(), `${pl.id}.${id}`).toBeCloseTo(twin.rag.bodies[id].mass(), 9);
        checked++;
      }
      if (checked > 20) break;
    }
    expect(checked).toBeGreaterThan(20);
    on.dispose();
    off.dispose();
  });
});

// ------------------------------------------------------------------ plan 12: joint range
describe('plan 12 joint range: profile and cone', () => {
  it('the shoulder cone: 45 deg behind the side line hanging, 30 deg at horizontal, forward and out about unlimited', () => {
    const at = (elevDeg: number): number => {
      // the behind angle where the cone's boundary crosses, at this elevation from hanging, along the back of the side line
      for (let a = 0; a <= 180; a += 0.25) {
        const dir = v3(Math.sin(elevDeg * D) * Math.sin(a * D), -Math.cos(elevDeg * D), Math.sin(elevDeg * D) * Math.cos(a * D));
        if (swingExcess(J.shoulder, dir, 1).rad > 0) return behindDeg(dir);
      }
      return 180;
    };
    expect(swingExtentDeg(J.shoulder, 180)).toBeCloseTo(44.5, 0);
    expect(at(45)).toBeCloseTo(45, 0);
    expect(at(90)).toBeGreaterThan(29);
    expect(at(90)).toBeLessThan(32);
    expect(swingExtentDeg(J.shoulder, 0)).toBeGreaterThan(170);
    expect(swingExtentDeg(J.shoulder, 90)).toBeGreaterThan(170);
    expect(J.ankle).toEqual({ dorsiDeg: 25, plantarDeg: 50 });
    expect(J.limpFoot).toEqual({ pitchDeg: 15, easeS: 0.3 });
  });
});

describe('plan 12 joint range: shoulders', () => {
  it('supported pose arms are within 0.5 deg of the cone; without the profile they are far past it', async () => {
    // plan 13d: Fast Run's swing at 6.6 m/s is inside the cone with or without the profile (the twin 7 deg inside), so it
    // is checked with the profile only and the second twin control is a contact case, the re-bump
    for (const id of ['L3-F9-convert-prep', 'L3-F16-sprint', 'L3-F8-recontact']) {
      const on = await probe(FIX(id));
      expect(on.worst.pose.ex, `${id} ${on.worst.pose.at}`).toBeLessThanOrEqual(0.5);
    }
    for (const id of ['L3-F9-convert-prep', 'L3-F8-recontact']) {
      const off = await probe(twin(FIX(id)));
      expect(off.worst.pose.ex, id).toBeGreaterThan(4);
    }
  }, 120000);

  it('arm-task arms stay inside the cone (a guard: the twins\' worst is also inside, 5 deg)', async () => {
    for (const id of ['HC-F5-invalidOne', 'L3-F4-twoArm', 'L4-F5-onePalm-on', 'L4-F6-break']) {
      const on = await probe(FIX(id));
      expect(on.worst.armTask.ex, `${id} ${on.worst.armTask.at}`).toBeGreaterThan(-999);
      expect(on.worst.armTask.ex, `${id} ${on.worst.armTask.at}`).toBeLessThanOrEqual(1e-6);
    }
  }, 120000);

  it('ragdoll shoulders: the runner cases are never long past the cone (15 deg for 0.25 s); the twins go far behind', async () => {
    // plan 13d: HC-F3-phase0 (margin 14.6 deg) and L3-F1-phase0 (twin 25.8 behind) no longer load the runner's arm behind
    // with Fast Run's contact timing; HC-F3-falling and HC-F3-mirror do (margins 32.9 and 32.0 deg). Plan 13e: on the L3
    // planner with the idle and walk clips HC-F3-falling's twin is 28.3 deg behind (the profile's 46.6, inside the cone by
    // 0.7 deg past it); HC-F3-phase50 loads it (twin 82.4, profile 50.4). Plan 13f: the twin keeps the leg guard, under
    // which HC-F3-phase50's twin is 63.2 deg behind (profile 50.7: margin 12.5); HC-F3-phase0 loads it again (twin 62.7,
    // profile 37.8). Ladder rung 7d: HC-F3-lowRunner pinned to LEG_GUARD_V1 (under the physical legs its profile arm is
    // 49.99 deg behind against the twin's 64.2, inside the margin)
    // Ladder 18: the comparison with the twin runs on the definition before the met-arm flip (`preMetArmStay`), whose
    // supported arms load the runner's arm behind at the conversion: under the flip a met arm keeps its natural pose and
    // HC-F3-phase0's twin arm goes only 23.6 deg behind (the case no longer loads it); the registered run keeps the bar
    const said: string[] = [];
    for (const id of ['HC-F3-phase0', 'HC-F3-lowRunner', 'HC-F3-mirror', 'L3-F1-low']) {
      const d = id === 'HC-F3-lowRunner' ? pinV1(FIX(id)) : FIX(id);
      const pre = preMetArmStay(d);
      const on = await probe(d);
      const onPre = pre === d ? on : await probe(pre);
      const off = await probe(twin(pre));
      expect(off.worst.ragdoll.behind, id).toBeGreaterThan(45);
      // plan 14: margin 15 (was 20): the profile's supported back swing now eases to 42 deg behind (the clip arm in the
      // ground frame), and L3-F1-low's runner ragdoll arm is 47.3 deg behind against its twin's 63.1
      expect(onPre.worst.ragdoll.behind, id).toBeLessThan(off.worst.ragdoll.behind - 15);
      if (pre !== d) expect(onPre.ragPast.breaches(), `${id} before the met-arm flip`).toEqual([]);
      // ladder 15: never more than 15 deg past the cone for 0.25 s (jointPastRange; it was past the 5 deg tolerance for
      // less than the envelope's persistence limit, and never 15 deg past); both are printed
      said.push(`${id} ${on.worst.ragdoll.ex.toFixed(1)} deg past (${on.worst.ragdoll.at}), ${on.ragOverRunS.toFixed(3)} s past ${ENVELOPE_L4.toleranceDeg} deg`);
      expect(on.ragPast.breaches(), id).toEqual([]);
    }
    // a standing pile: the twin's ragdoll arm goes past the cone, with the profile it is inside. Plan 13f: was HC-F1-low
    // (twin 13 deg past); under the leg guard, which the twin keeps, its twin stays 22.5 deg inside. L3-F10-bothMirror:
    // the twin's R right arm 9.9 deg past, the profile's 24.6 deg inside. Ladder rung 7d: pinned to LEG_GUARD_V1 (under the
    // physical legs the twin's arm stays 3.6 deg inside the cone). Ladder 8l: and to the profile before the visible flip
    // (under it the twin's arm stays inside the cone, 0.01 deg past at most; with any one of its hip stops, PGS and knee
    // stop off, 47-64 deg past)
    const pile = pinV1(preFlip(FIX('L3-F10-bothMirror')));
    const on = await probe(pile);
    const off = await probe(twin(pile));
    expect(off.worst.ragdoll.ex).toBeGreaterThan(5);
    // (ladder 15: the visible bar; it was within 5 deg)
    said.push(`L3-F10-bothMirror (pre-flip, V1) ${on.worst.ragdoll.ex.toFixed(1)} deg past, twin ${off.worst.ragdoll.ex.toFixed(1)}`);
    expect(on.ragPast.breaches()).toEqual([]);
    console.log(`ragdoll shoulders past the cone (ladder 15 meter): ${said.join('; ')}`);
  }, 240000);
});

describe('ladder 15: the visible bar for ragdoll shoulders past the cone, its fault twin', () => {
  it('a ragdoll arm held 100 deg behind hanging for 0.6 s (a driven fault, L4-F8-passive) fails the rule the runner cases pass; undriven it passes', async () => {
    const probeOf = async (drive?: (s: Simulation) => void): Promise<Probe> => {
      const range = rangeObserver();
      const sim = await Simulation.create(FIX('L4-F8-passive'), drive ? { onSubstep: drive } : {});
      await runSim(sim, Infinity, (s) => range.tick(s));
      sim.dispose();
      return range.out;
    };
    expect((await probeOf()).ragPast.breaches()).toEqual([]);
    const held = await probeOf(holdArmBehind(100, 0.6));
    expect(held.ragPast.breaches()).toHaveLength(1);
    expect(held.ragPast.breaches()[0]).toMatch(/^R\.left@/);
  }, 120000);
});

describe('plan 12 joint range: ankles', () => {
  it('supported ankles never dorsiflex past 25 deg; the twins reach 36-45 deg', async () => {
    // plan 13d: the run case is the 6 m/s stop (twin 45 deg); Fast Run at a constant 6.6 m/s leans the twin's shin 34 deg
    for (const id of ['HC-F1-low', 'L3-F1-low', 'L3-F16-runStop']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      expect(on.ankleMin, id).toBeGreaterThanOrEqual(-J.ankle.dorsiDeg);
      expect(off.ankleMin, id).toBeLessThan(-J.ankle.dorsiDeg - 10);
    }
  }, 120000);

  it('heel lift: a planted foot past the range stands on its ball, the contact held within the plant tolerance', async () => {
    for (const id of ['L3-F1-low', 'L3-F16-runStop']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      // the twin plants with the shin leaning past the range; with the profile the heel lifts instead, no foot lost
      expect(off.planted.past, id).toBeGreaterThan(10);
      expect(on.planted.past, id).toBe(0);
      expect(on.planted.n, id).toBeGreaterThanOrEqual(off.planted.n);
      expect(on.planted.gapM, id).toBeLessThanOrEqual(FOOTWORK_L3.plantTolM);
      expect(on.planted.hzM, id).toBeLessThanOrEqual(FOOTWORK_L3.plantTolM);
    }
  }, 120000);

  const LIMP_CASES = ['L4-F3-forward-on', 'L4-F8-passive', 'HC-F1-low', 'HC-F1-lowMirror'].map(FIX);
  limpRule(LIMP_CASES);
  it('ragdoll feet: in range at conversion, relaxed to 15 deg within 1 deg 0.35 s later unless the limp shoe is held near another player', async () => {
    // plan 12's hold (Simulation.shoeDeeper, docs/handoff/plan12.md): a shoe waits only while its turn would bring it
    // closer to another player inside 8 cm, and then keeps its pitch; otherwise it turns one rate step toward its target.
    // Checked on every substep's decision over these fixtures, whichever shoes the trajectories bring near another player
    let held = 0;
    let turned = 0;
    let first: { def: FixtureDef; at: string } | undefined;
    for (const def of LIMP_CASES) {
      const id = def.id;
      const w = await watched(def);
      const on = w.range;
      expect(on.feet.size, id).toBeGreaterThan(0);
      expect(w.limp!.length, `${id}: the limp feet ease`).toBeGreaterThan(0);
      const bad = limpViolations(id, w.limp!);
      expect(bad, `${id}: ${bad.length} breaches of the rule, first ${bad.slice(0, 4).join('; ')}`).toEqual([]);
      for (const c of w.limp!) {
        if (c.held) held++, (first ??= { def, at: `${id} ${c.k}@${c.step}` });
        else turned++;
      }
      for (const [pid, c] of on.feet) {
        expect(c.late, `${id} ${pid}`).toBeTruthy();
        for (const side of SIDES) {
          const p = c.conv[side]!;
          expect(p, `${id} ${pid} ${side}`).toBeGreaterThanOrEqual(-J.ankle.dorsiDeg);
          expect(p, `${id} ${pid} ${side}`).toBeLessThanOrEqual(J.ankle.plantarDeg);
          if (c.held![side] === 0) expect(Math.abs(c.late![side]! - J.limpFoot.pitchDeg), `${id} ${pid} ${side}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // positive sample: the rule is exercised, at least one shoe held (at rung 4b: HC-F1-low R.left, HC-F1-lowMirror D.right
    // and R.right, each within 8 cm of the other player) and at least one turned
    expect(first, 'some limp shoe is held').toBeTruthy();
    expect(held, 'held substeps').toBeGreaterThan(0);
    expect(turned, 'turned substeps').toBeGreaterThan(0);
    // fault controls on the first fixture that holds: the rule disabled (never held) and inverted (held exactly when the
    // turn is clear) each break it
    const never = await runWatched({ ...first!.def, id: `${first!.def.id}-noHold` }, () => () => false);
    expect(limpViolations(first!.def.id, never.limp!).some((v) => v.includes('turned with the condition')), `${first!.at}: disabled`).toBe(true);
    const inv = await runWatched({ ...first!.def, id: `${first!.def.id}-invHold` }, (own) => (...a) => !own(...a));
    expect(limpViolations(first!.def.id, inv.limp!).some((v) => v.includes('held without the condition')), `${first!.at}: inverted`).toBe(true);
    // the twin keeps the supported pitch it converted with, past the range
    const off = await probe(twin(FIX('HC-F1-low')));
    for (const [pid, c] of off.feet) expect(Math.min(c.conv.left!, c.conv.right!), pid).toBeLessThan(-J.ankle.dorsiDeg);
  }, 120000);
});

// ------------------------------------------------------------------ plan 13f: the predictive leg guard
describe('plan 13f leg guard: a conversion beside a closing body', () => {
  /** The defender's handoff in one run. */
  const handoffOf = async (def: FixtureDef, opts: SimOptions = {}) => {
    const sim = await Simulation.create(def, opts);
    await runSim(sim);
    const h = sim.players.find((p) => p.id === 'D')!.handoff!;
    sim.dispose();
    return { outcome: h.outcome, t: h.t.toFixed(4), newM: h.report.maxNewExternalPenetrationM, reasons: h.report.reasons.join(',') };
  };

  it('converts where the guard without prediction (and the twin without the profile) is rejected for external penetration', async () => {
    // the reversed L3-F9-noProbe-contact D (13e): its left thigh in R's right shoe, 1.74 cm (1.64 before plan 14).
    // Tolerance 1.5 cm.
    // (HC-F3-phase75 D, 13e's other case, converts without the prediction too since plan 14 shows the clip arms as the
    // clip has them, so it no longer tells the guard from the fault). Ladder rung 7d: pinned to LEG_GUARD_V1, the
    // predictive guard this case is for (under the physical legs R's shoe is stopped by D's leg colliders, and the fault
    // twin converts too)
    const CASES: [string, boolean, number][] = [['L3-F9-noProbe-contact', true, 0.01736]];
    await rows(
      CASES,
      ([id, rev]) => `${id}${rev ? ' reversed' : ''}`,
      async ([id, rev, beforeM]) => {
        const o = rev ? { reverseOrder: true } : {};
        // (ladder 8l: the sample as measured before the visible flip; under it R's shoe is moved and the fault twins
        // convert, 1.46 cm, with the deferred conversion off too; ladder 17b: and before the born-overlap flip, under which
        // the fault twins' thigh in a shoe converts, held out of the solve; ladder 18e: and before the met-arm flip, under
        // which the run differs from its first met arm and the guard this case is for rejects D: the closing shoe is a
        // sample of the run before it. Registered (LEG_GUARD_V3), D converts as before the flip)
        const def = pinV1(preFlip(preBornOverlap(preMetArmStay(FIX(id)))));
        const on = await handoffOf(def, o);
        expect(on.outcome, id).toBe('accepted');
        expect(on.newM, id).toBeLessThan(0.012);
        // the fault put back: the guard measuring other bodies where they are now only, and the twin without the profile.
        // Both also without the plan 10c deep push that contact motion M1 adds to L3 (it clears this case on its own)
        const noDeep = (d: FixtureDef): FixtureDef => ({ ...d, ragdoll: { ...d.ragdoll!, poseGuard: undefined } });
        for (const off of [await handoffOf(noDeep(def), { ...o, debug: { pose: { noLegAhead: true } } }), await handoffOf(noDeep({ ...def, id: `${id}-noGuard`, legGuard: undefined }), o)]) {
          expect(off.outcome, id).toBe('rejected');
          expect(off.reasons, id).toContain('externalPenetration');
          expect(off.newM, id).toBeCloseTo(beforeM, 4);
        }
      },
    );
  }, 120000);

  // The same check on a constructed closing body, under the swept leg guard (LEG_GUARD_V2, rung 5; no fixture runs it):
  // L3-F9-convert-free with D (running, free) converting by label at THROW.atS and R (converted by label at 0.15 s)
  // thrown at D's leg two substeps before. R's ragdoll is moved rigidly so its head lies outside D's most protruding
  // thigh, 60 % of the way to the knee, along the direction square to the thigh and to its motion, and given D's
  // velocity plus THROW.mps toward it. The gap is one substep of travel plus 1 cm: after the first substep the head is
  // 1 cm clear of the thigh, where only the prediction finds it in the leg, and the switch comes after the second, with
  // the head in where the leg was. The target is taken from D's pose when R is thrown, so the case does not depend on
  // where D's run puts its legs. The bounds are the rule's: the conversion's penetration tolerance and the guard's
  // accepted depth, not measured values.
  const THROW = { atS: 0.4, mps: 10, along: 0.6, clearM: 0.01 };
  // The case is the conversion's validation at the switch. Since the visible flip L3 carries the deferred conversion
  // (ladder rung 8j), which retries a conversion rejected for external penetration and takes it once the thrown head has
  // passed (7 tries later, at 0.429 s); the case runs without it (tests/conversion-retry.test.ts holds the retry's own).
  // Since ladder 17b L3 also converts a candidate born in another body, the pair held out of the solve (the thrown head in
  // the thigh): the case runs without that too (tests/born-overlap.test.ts holds its own)
  const atSwitch = (d: FixtureDef): FixtureDef => ({ ...d, ragdoll: withoutBornOverlap(withoutConversionRetry(d.ragdoll!)) });
  const vecOf = (v: { x: number; y: number; z: number }): Vec3 => v3(v.x, v.y, v.z);
  type Sd = 'left' | 'right';
  const thrownAt = async (def: FixtureDef, opts: SimOptions = {}) => {
    const d: FixtureDef = { ...def, id: `${def.id}-thrown`, durationS: THROW.atS + 0.05, diagnostics: { conversions: [{ playerId: 'R', atS: 0.15 }, { playerId: 'D', atS: THROW.atS }] } };
    let thrown = false;
    let prev: Partial<Record<Sd, Vec3>> = {};
    const segR = d.ragdoll!.radii.thigh;
    const sim = await Simulation.create(d, {
      ...opts,
      onSubstep: (s) => {
        const D = s.players.find((p) => p.id === 'D')!;
        const R = s.players.find((p) => p.id === 'R')!;
        if (!D.pose || D.rag || D.handoff) return;
        const lm = D.pose.jointLandmarksWorld;
        const root = vecOf(D.proxy.body.translation());
        const at = (sd: Sd): Vec3 => add(lm[`${sd}Hip`], scale(sub(lm[`${sd}Knee`], lm[`${sd}Hip`]), THROW.along));
        const now = { left: sub(at('left'), root), right: sub(at('right'), root) };
        if (!thrown && R.rag && s.t >= THROW.atS - 2 * s.physics.dt - 1e-9) {
          thrown = true;
          const out = (sd: Sd): number => Math.hypot(now[sd].x, now[sd].z);
          const sd: Sd = out('left') > out('right') ? 'left' : 'right';
          let u = norm(cross(norm(sub(lm[`${sd}Knee`], lm[`${sd}Hip`])), sub(now[sd], prev[sd] ?? now[sd])));
          if (u.x * now[sd].x + u.z * now[sd].z < 0) u = scale(u, -1);
          const hc = R.rag.bodies.head.collider(0);
          const head = vecOf(hc.translation());
          const q = qFromUnitVectors(norm(sub(vecOf(R.rag.bodies.core.translation()), head)), u);
          const to = add(at(sd), scale(u, (hc.shape as RAPIER.Ball).radius + segR + THROW.mps * s.physics.dt + THROW.clearM));
          const v = add(vecOf(D.proxy.body.linvel()), scale(u, -THROW.mps));
          for (const b of Object.values(R.rag.bodies)) {
            b.setTranslation(add(to, qRot(q, sub(vecOf(b.translation()), head))), true);
            b.setRotation(qMul(q, b.rotation()), true);
            b.setLinvel(v, true);
            b.setAngvel(v3(), true);
          }
        }
        prev = now;
      },
    });
    await runSim(sim);
    const h = sim.players.find((p) => p.id === 'D')!.handoff!;
    // rung 6: what D's physical legs took from the other bodies (N s; none without the profile's physical legs)
    const leg = sim.legLedger?.get('D');
    sim.dispose();
    expect(thrown, 'R was thrown').toBe(true);
    return { outcome: h.outcome, newM: h.report.maxNewExternalPenetrationM, reasons: h.report.reasons.join(','), worst: `${h.report.worstExternal?.own} in ${h.report.worstExternal?.other}`, legNs: leg?.impulseNs ?? 0, headNs: Object.entries(leg?.byOther ?? {}).reduce((a, [k, j]) => a + (k.startsWith('R:head') ? j : 0), 0) };
  };

  it('the swept guard (V2) converts beside a thrown closing body; without its prediction, and on the twin, the thrown head is in the thigh', async () => {
    const base = atSwitch(FIX('L3-F9-convert-free'));
    // without the plan 10c deep push that contact motion M1 adds to L3 (it would clear the leg on its own)
    const noDeep = (d: FixtureDef): FixtureDef => ({ ...d, ragdoll: { ...d.ragdoll!, poseGuard: undefined } });
    const tol = base.ragdoll!.validation.penetrationTolM;
    const v2 = noDeep({ ...base, legGuard: LEG_GUARD_V2 });
    await checks([
      [
        'V2 with its prediction converts beside the thrown body',
        async () => {
          const on = await thrownAt(v2);
          expect(on.outcome, `${on.worst} ${on.newM}`).toBe('accepted');
          expect(on.newM, on.worst).toBeLessThanOrEqual(tol);
        },
      ],
      ...(
        [
          ['V2 measuring other bodies where they are now only (the fault put back) is rejected for external penetration', v2, { debug: { pose: { noLegAhead: true } } }],
          ['the twin without the profile is rejected for external penetration', noDeep({ ...base, id: `${base.id}-noGuard`, legGuard: undefined }), {}],
        ] as [string, FixtureDef, SimOptions][]
      ).map(
        ([name, d, o]): Check => [
          name,
          async () => {
            const off = await thrownAt(d, o);
            expect(off.outcome, off.worst).toBe('rejected');
            expect(off.reasons).toContain('externalPenetration');
            expect(off.newM).toBeGreaterThan(tol);
            // the thrown head in the thigh it was thrown at
            expect(off.worst).toMatch(/^(left|right)Thigh:thigh in R:head:head$/);
          },
        ],
      ),
    ]);
  }, 240000);

  // Rung 6 (LEG_GUARD_V3, physical supported legs; no fixture runs it): the same thrown body meets D's thigh in the solve
  // and stops on it, so V3 converts with or without the 13f prediction. The no-physical-legs variant is V2 (V3 less
  // `physicalLegs`), which without its prediction is rejected with the head in the thigh (the V2 case above).
  it('under physical legs (V3) the thrown head stops on the thigh and D converts, with or without the prediction; without physical legs (V2) and without it, it is rejected', async () => {
    const base = atSwitch(FIX('L3-F9-convert-free'));
    const noDeep = (d: FixtureDef): FixtureDef => ({ ...d, ragdoll: { ...d.ragdoll!, poseGuard: undefined } });
    const tol = base.ragdoll!.validation.penetrationTolM;
    const v3d = noDeep({ ...base, legGuard: LEG_GUARD_V3 });
    await checks([
      ...(
        [
          ['V3 converts beside the thrown body, the head met by the thigh in the solve', {}],
          ['V3 without the prediction (noLegAhead) converts too: the solve stops the head', { debug: { pose: { noLegAhead: true } } }],
        ] as [string, SimOptions][]
      ).map(
        ([name, o]): Check => [
          name,
          async () => {
            const on = await thrownAt(v3d, o);
            expect(on.outcome, `${on.worst} ${on.newM}`).toBe('accepted');
            expect(on.newM, on.worst).toBeLessThanOrEqual(HARD_OK);
            expect(on.headNs, 'R:head on D\'s legs (N s)').toBeGreaterThan(0);
          },
        ],
      ),
      [
        'the no-physical-legs variant (V2) without the prediction is rejected, the head in the thigh; no leg ledger',
        async () => {
          const off = await thrownAt(noDeep({ ...base, legGuard: LEG_GUARD_V2 }), { debug: { pose: { noLegAhead: true } } });
          expect(off.outcome, off.worst).toBe('rejected');
          expect(off.newM).toBeGreaterThan(tol);
          expect(off.worst).toMatch(/^(left|right)Thigh:thigh in R:head:head$/);
          expect(off.legNs).toBe(0);
        },
      ],
    ]);
  }, 240000);
});

// ------------------------------------------------------------------ rung 5: the swept leg step (LEG_GUARD_V2)
// The swept guard (`LegGuardProfile.sweep`, the pose input `legSweep`; no fixture runs it yet) on constructed poses: one
// standing L3 body (yaw 0, its left leg at +x), its left leg's continuity memory seeded where a test needs the shown leg
// to start, and fixed balls as the physical bodies (the clearance's every query). Each case is the sweep off (V1's
// guard, the fault twin) against on. Bounds are the guard's rule: HARD_OK, the departure rate, the sweep spacing.
describe('rung 5: the swept leg step (constructed poses, the sweep on and off)', () => {
  const def = FIX('L3-F9-convert-free');
  const R = def.ragdoll!;
  const I: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const toRapier = (s: PoseShape): { shape: RAPIER.Shape; p: Vec3; q: Quat } => (s.kind === 'box' ? { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), p: s.c, q: s.q } : (rapierShape(s) as { shape: RAPIER.Shape; p: Vec3; q: Quat }));
  /** Fixed balls as the clearance: depth and push-out of pose shapes in them (the runtime's rule: deepest contact per shape). */
  const ballsClearance = (bs: { c: Vec3; r: number }[]): PoseClearance => {
    const hits = (s: PoseShape) => {
      const q = toRapier(s);
      return bs.map((b) => q.shape.contactShape(q.p, q.q, new RAPIER.Ball(b.r), b.c, I, 0.5)).filter((r) => !!r && r.distance < 0);
    };
    const depth = (shapes: PoseShape[]): number => Math.max(0, ...shapes.flatMap((s) => hits(s).map((r) => -r!.distance)));
    const push = (shapes: PoseShape[], tol = 0): Vec3 => {
      let v = v3();
      for (const s of shapes) {
        const best = hits(s).sort((a, b) => a!.distance - b!.distance)[0];
        if (best) v = addScaled(v, vc(best.normal1), Math.max(0, -best.distance - tol));
      }
      return v;
    };
    return { external: depth, push, legs: { external: depth, push, physical: depth } };
  };
  const at = (z = 0): Pose => ({ p: v3(0, 0.95, z), q: qFromYaw(0) });
  const input = (over: Partial<ProxyPoseInput>): ProxyPoseInput => ({ playerId: 'D', body: def.players[0].body, ragdoll: R, jointRange: def.jointRange, pose: at(), gait: { phase: 0 }, speed: 0, ground: { y: 0, staggerM: 0, fixedGait: true }, ...over });
  const leftLeg = (p: PhysicalPose): PoseShape[] => poseLimbShapes(R, p).filter((s) => /^left(Thigh|Shin|Shoe)$/.test(s.key));
  /** The standing pose's continuity memory, the left leg's shown departure (body frame) replaced by `d`. */
  const seeded = (d: Vec3): PoseMemory => {
    const m: PoseMemory = {};
    buildProxyPose(input({ memory: m, dtS: 1 / 60 }));
    buildProxyPose(input({ memory: m, dtS: 1 / 60 }));
    Object.assign(m, { 'leftLeg:d:x': d.x, 'leftLeg:d:y': d.y, 'leftLeg:d:z': d.z });
    return m;
  };
  const departure = (m: PoseMemory): Vec3 => v3(m['leftLeg:d:x'], m['leftLeg:d:y'], m['leftLeg:d:z']);

  it('(i) a leg obstructed where it stands takes another placement that is clear, its foot kept on the ground where it was', async () => {
    await initPhysics();
    // a ball (8 cm) in front of the inside of the left thigh, at once: every one of the guard's placements and its
    // rate-limited (and fast) steps toward the best of them leave the leg past HARD_OK
    const cl = ballsClearance([{ c: v3(-0.06, 0.7, 0.16), r: 0.08 }]);
    const free = buildProxyPose(input({ memory: seeded(v3()), dtS: 1 / 60 })).jointLandmarksWorld.leftAnkle;
    const run = (legSweep: boolean) => {
      const m = seeded(v3());
      const p = buildProxyPose(input({ memory: m, dtS: 1 / 60, clearance: cl, legSweep }));
      return { depth: cl.external(leftLeg(p)), ankle: p.jointLandmarksWorld.leftAnkle };
    };
    const off = run(false);
    const on = run(true);
    // the fault twin (no sweep): the shown leg in the ball past the conversion's tolerance
    expect(off.depth).toBeGreaterThan(R.validation.penetrationTolM);
    // swept: clear within HARD_OK, the ankle where the unobstructed leg stands (the knee turned outward about it)
    expect(on.depth).toBeLessThanOrEqual(HARD_OK);
    expect(dist(on.ankle, free)).toBeLessThan(1e-3);
  });

  it('(ii)-(iv) a step through a body stops at its last clear sample, keeps limb lengths and hip while the hip moves, and resumes without a jump', async () => {
    await initPhysics();
    // the shown left ankle 0.5 m outward of its standing request; one pose 0.2 s on (a departure step of
    // CONT_LEG_MPS * 0.2 = 0.5 m, longer than a leg is thick) brings it back to the request, through a 2 cm ball between
    // the two. Both ends are clear of the ball: a check of the step's start and end only does not see it
    const D0 = v3(0.5, 0, 0);
    const DT = 0.2;
    const BALL = [{ c: v3(0.29, 0.1, 0), r: 0.02 }];
    const cl = ballsClearance(BALL);
    // the step's path, test side: the shown leg at fraction f of the way, no clearance (the departure held; the knee and
    // reach not held to the standing leg's last ones, which a pose 0.2 s on is not)
    const shownAt = (f: number): PhysicalPose => {
      const m = seeded(scale(D0, 1 - f));
      for (const k of Object.keys(m)) if (/^leftLeg:(e|r):|^leftLeg:reachLimited$/.test(k)) delete m[k];
      return buildProxyPose(input({ memory: m, dtS: 1e-9, handoffPossible: false }));
    };
    const pathDepth = (f: number): number => cl.external(leftLeg(shownAt(f)));
    const N = Math.round(len(D0) / LEG_SWEEP_M);
    const path = Array.from({ length: N + 1 }, (_, i) => pathDepth(i / N));
    expect(path[0], 'the start is clear').toBeLessThanOrEqual(HARD_OK);
    expect(path[N], 'the end is clear').toBeLessThanOrEqual(HARD_OK);
    const entry = path.findIndex((d) => d > HARD_OK);
    expect(Math.max(...path), 'the path crosses the ball').toBeGreaterThan(R.validation.penetrationTolM);
    // poses 0-4 with the ball, the body moving forward 3 cm a pose from pose 1; then the ball gone (poses 5-7)
    const seq = (legSweep: boolean) => {
      const m = seeded(D0);
      const start = shownAt(0);
      let prev = sub(start.jointLandmarksWorld.leftAnkle, at().p);
      let prevRes = start.targetResidualM!.leftLeg;
      const out: { depth: number; f: number; jump: number; bound: number; hip: number; thigh: number; shin: number }[] = [];
      for (let i = 0; i < 8; i++) {
        const pose = at(0.03 * Math.min(i, 4));
        const p = buildProxyPose(input({ pose, memory: m, dtS: DT, clearance: ballsClearance(i < 5 ? BALL : []), legSweep }));
        const lm = p.jointLandmarksWorld;
        const hip = buildProxyPose(input({ pose, memory: {} })).jointLandmarksWorld.leftHip;
        const res = p.targetResidualM!.leftLeg;
        // body frame (yaw 0): the shown ankle's move from the last pose; the target moves at most the departure rate,
        // the achieved ankle by that and the two poses' IK residuals
        const bf = sub(lm.leftAnkle, pose.p);
        out.push({ depth: cl.external(leftLeg(p)), f: 1 - departure(m).x / D0.x, jump: dist(bf, prev), bound: CONT_LEG_MPS * DT + res + prevRes + 1e-9, hip: dist(lm.leftHip, hip), thigh: Math.abs(dist(lm.leftHip, lm.leftKnee) - R.lengths.thigh), shin: Math.abs(dist(lm.leftKnee, lm.leftAnkle) - R.lengths.shin) });
        prev = bf;
        prevRes = res;
      }
      return out;
    };
    const off = seq(false);
    const on = seq(true);
    await checks([
      [
        '(ii) the fault twin (no sweep) shows only clear poses and goes through the ball between them',
        () => {
          expect(off[0].f).toBeCloseTo(1, 9);
          for (const r of off) expect(r.depth).toBeLessThanOrEqual(HARD_OK);
        },
      ],
      [
        '(ii) swept: the first pose stops at the last clear sample before the ball, and holds there while the ball is in the way',
        () => {
          expect(on[0].depth).toBeLessThanOrEqual(HARD_OK);
          // the stop is at or before the first deep sample of the path, at most one sweep spacing (and one sample of
          // this test's path) short of it
          expect(on[0].f).toBeLessThan(entry / N);
          expect(on[0].f).toBeGreaterThanOrEqual(entry / N - (2 * LEG_SWEEP_M) / len(D0) - 1e-9);
          for (const r of on.slice(1, 4)) {
            expect(r.depth).toBeLessThanOrEqual(HARD_OK);
            expect(r.f).toBeCloseTo(on[0].f, 9);
          }
        },
      ],
      [
        '(iii) the stopped leg keeps its limb lengths and the hip where the moving body has it',
        () => {
          for (const r of on) {
            expect(r.hip).toBeLessThan(1e-9);
            expect(r.thigh).toBeLessThan(1e-6);
            expect(r.shin).toBeLessThan(1e-6);
          }
        },
      ],
      [
        '(iv) no pose moves the ankle (body frame) beyond the departure rate, as the sweep stops, holds and resumes',
        () => {
          for (const [i, r] of on.entries()) expect(r.jump, `pose ${i}`).toBeLessThanOrEqual(r.bound);
          // it resumed: past the ball (pose 4, the body moved on) and at the request
          expect(on[7].f).toBeCloseTo(1, 9);
          expect(on.slice(4).some((r) => r.jump > 0.05), 'the resumed step moves').toBe(true);
        },
      ],
    ]);
  });
});

// ------------------------------------------------------------------ contact motion M1: upper-arm twist
// The supported pose and the arm-task arms place the elbow from a pole, so the upper arm's twist (and the drawn elbow and
// hand) was free: L3-F3-side D's raised left arm reached -178 deg (the elbow up), and a nearly straight free arm rolled
// 89 deg in one tick when plan 12's cone clamp turned it (L3-F4-twoArm R.left at 0.533 s). Under joint-range-v2 the elbow
// turns about the shoulder-to-palm line, the palm kept, into the ragdoll envelope's twist range less 2 deg, at most
// 12 rad/s from the last shown twist. The twin is the same fixture on plan 12's joint-range-v1.
describe('contact motion M1: upper-arm twist', () => {
  const J2 = JOINT_RANGE_V2;
  const E = J2.shoulder;
  const TW = J2.shoulderTwist!;
  const v1 = (d: FixtureDef): FixtureDef => ({ ...d, id: `${d.id}-v1`, jointRange: JOINT_RANGE_V1 });
  const ext = (core: Quat, upper: Quat, sx: number): number => (externalTwistRad(E, swingTwistOf(qMul(qConj(core), upper)).twistRad, sx) * 180) / Math.PI;

  it('the profile: on for exactly the L3, L4 and HC fixtures, plan 12 ranges kept, the twist measure the envelope\'s on both sides', () => {
    for (const d of allFixtures()) expect(d.jointRange, d.id).toBe(/^(L3|L4|HC)$/.test(d.milestone) ? J2 : undefined);
    expect({ ...J2, id: JOINT_RANGE_V1.id, shoulderTwist: undefined }).toEqual({ ...JOINT_RANGE_V1, shoulderTwist: undefined });
    expect(E.twistDeg).toEqual([-100, 100]);
    // anatomical reference poses (core frame, the arm's own side +sx): forearm forward on a hanging arm is neutral,
    // across the body is internal (negative); the same on both sides
    for (const sx of [1, -1]) {
      const cases: [Vec3, Vec3, number][] = [
        [v3(0, -1, 0), v3(0, 0, 1), 0],
        [v3(0, -1, 0), v3(-sx, 0, 0), -90],
        [v3(0, -1, 0), v3(sx, 0, 0), 90],
        [v3(sx, 0, 0), v3(0, 0, 1), 0],
        [v3(sx, 0, 0), v3(0, 1, 0), 90],
        [v3(0, 0, 1), v3(-sx, 0, 0), -90],
      ];
      for (const [ua, fa, want] of cases) {
        const el = scale(ua, 0.3);
        const ch = hingeChain(v3(), el, [addScaled(el, fa, 0.3)], [v3(0, 0, 1), v3(0, 1, 0)], 0.01);
        expect(ext({ x: 0, y: 0, z: 0, w: 1 }, ch.frameA, sx)).toBeCloseTo(want, 6);
        expect((armTwistRad(E, { x: 0, y: 0, z: 0, w: 1 }, v3(), el, addScaled(el, fa, 0.3), sx)! * 180) / Math.PI).toBeCloseTo(want, 6);
      }
    }
    // and on arbitrary arms in a turned core it is the envelope's swing-twist measure of the hinge frame
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 200; i++) {
      const core = qFromAxisAngle(v3(rnd(), rnd(), rnd()), 3 * rnd());
      const sh = v3(rnd(), 1 + rnd(), rnd());
      const el = addScaled(sh, norm(v3(rnd(), rnd(), rnd()), v3(0, -1, 0)), 0.36);
      const pm = addScaled(el, norm(v3(rnd(), rnd(), rnd()), v3(0, -1, 0)), 0.35);
      const ch = hingeChain(sh, el, [pm], [v3(0, 0, 1)], 0.01);
      if (ch.fallback) continue;
      for (const sx of [1, -1]) expect(Math.abs(wrapPi(((armTwistRad(E, core, sh, el, pm, sx)! * 180) / Math.PI - ext(core, ch.frameA, sx)) * D) / D)).toBeLessThan(1e-6);
    }
  });

  it('a fit turns the elbow about the shoulder-to-palm line into the window: palm and reach kept, mirrored sides alike', () => {
    const I = { x: 0, y: 0, z: 0, w: 1 };
    const win = twistWindow(E, TW, null, 0);
    expect(win.hi).toBeCloseTo(98 * D, 9);
    // a hand across the chest at shoulder height with the elbow pointing up (a pole straight up): 140 deg, past the range
    for (const sx of [1, -1]) {
      const sh = v3(0.23 * sx, 1.5, 0);
      const tgt = v3(-0.1 * sx, 1.45, 0.4);
      const r = twoBone(sh, tgt, 0.36, 0.358, v3(0, 1, 0));
      const t0 = (armTwistRad(E, I, sh, r.mid, r.end, sx)! * 180) / Math.PI;
      expect(t0).toBeCloseTo(140.5, 0);
      const f = fitElbowTwist(E, I, sh, r.mid, r.end, sx, win);
      expect(f.turned).toBe(true);
      expect((f.twistRad! * 180) / Math.PI).toBeCloseTo(98, 3);
      expect(dist(f.elbow, sh)).toBeCloseTo(0.36, 9);
      expect(dist(f.elbow, r.end)).toBeCloseTo(0.358, 9);
      // the mirrored arm's fitted elbow is the mirror image
      const m = fitElbowTwist(E, I, v3(-sh.x, sh.y, sh.z), v3(-r.mid.x, r.mid.y, r.mid.z), v3(-r.end.x, r.end.y, r.end.z), -sx, win);
      expect(dist(m.elbow, v3(-f.elbow.x, f.elbow.y, f.elbow.z))).toBeLessThan(1e-6);
    }
  });

  it('a target swept across the chest, and a nearly straight reach, keep a continuous elbow plane inside the range', () => {
    const I = { x: 0, y: 0, z: 0, w: 1 };
    const dt = 1 / 240;
    for (const sx of [1, -1]) {
      const sh = v3(0.23 * sx, 1.5, 0);
      // across the chest: out to the side, forward and on to the far shoulder, slightly below the shoulder, the elbow
      // pole up and out; straight reach: a reach past the arm's length from forward round the outside to behind, down
      // through the line of the plan 07 default pole (out, down and back), where that pole stops defining a plane
      const sweeps = [
        ['across the chest', v3(0.3 * sx, 0.9, -0.3), 0.55, 100, -90, -0.15],
        ['straight reach', v3(0.6 * sx, -0.5, -0.6), 0.9, 10, 170, -0.51],
      ] as const;
      for (const [name, pole, reach, az0, az1, y] of sweeps) {
        let prev: number | null = null;
        let rawJump = 0;
        let rawOut = 0;
        let rawPrev: number | null = null;
        let worst = 0;
        let lo = 0;
        for (let i = 0; i <= 240; i++) {
          // in one second
          const az = (az0 + (i / 240) * (az1 - az0)) * D;
          const c = Math.sqrt(1 - y * y);
          const tgt = add(sh, scale(v3(c * Math.sin(az) * sx, y, c * Math.cos(az)), reach));
          const r = twoBone(sh, tgt, 0.36, 0.358, pole);
          const raw = armTwistRad(E, I, sh, r.mid, r.end, sx);
          if (raw !== null && rawPrev !== null) rawJump = Math.max(rawJump, Math.abs(wrapPi(raw - rawPrev)));
          if (raw !== null) rawOut = Math.max(rawOut, Math.abs(raw) / D - 100);
          rawPrev = raw;
          const f = fitElbowTwist(E, I, sh, r.mid, r.end, sx, twistWindow(E, TW, prev, dt));
          if (f.twistRad === null) continue;
          if (prev !== null) worst = Math.max(worst, Math.abs(wrapPi(f.twistRad - prev)));
          lo = Math.min(lo, f.twistRad);
          prev = f.twistRad;
          expect(dist(f.elbow, r.end), name).toBeCloseTo(0.358, 9);
        }
        expect(worst / D, `${name} ${sx}`).toBeLessThanOrEqual((TW.maxRateRadPs * dt) / D + 1e-3);
        expect(lo / D, `${name} ${sx}`).toBeGreaterThanOrEqual(-98 - 1e-3);
        // the control: the pole alone takes the elbow past the range (across the chest: up and in) or turns the plane
        // of the nearly straight arm faster than the rate
        if (name === 'across the chest') expect(rawOut, `${name} ${sx}`).toBeGreaterThan(10);
        else expect(rawJump / D, `${name} ${sx}`).toBeGreaterThan((10 * TW.maxRateRadPs * dt) / D);
      }
    }
  });

  /** Per arm source: worst twist (deg) past the range, the largest change in one tick of one source, where. */
  async function twistRun(def: FixtureDef): Promise<Record<Src, { over: number; jump: number; at: string; jat: string }> & { startOutside: number }> {
    const out = { pose: { over: -999, jump: 0, at: '', jat: '' }, armTask: { over: -999, jump: 0, at: '', jat: '' }, ragdoll: { over: -999, jump: 0, at: '', jat: '' }, startOutside: 0 };
    const last = new Map<string, { src: Src; tw: number }>();
    const sim = await Simulation.create(def);
    await runSim(sim, Infinity, (s) => {
      for (const pl of s.players) {
        if (!pl.pose?.segments.leftUpperArm) continue;
        if (pl.rag) for (const e of pl.rag.envelope ?? []) if (/Shoulder/.test(e.jointId)) out.startOutside = Math.max(out.startOutside, e.startOutsideDeg);
        for (const side of SIDES) {
          const src: Src = pl.rag ? 'ragdoll' : s.arms?.obs(pl.id)?.[side]?.enabled ? 'armTask' : 'pose';
          const tw = ext(pl.pose.segments.core.rotationWorld, pl.pose.segments[`${side}UpperArm`].rotationWorld, sideSignX(pl.body, side));
          const w = out[src];
          const at = `${pl.id}.${side}@${s.t.toFixed(3)}`;
          if (Math.abs(tw) - 100 > w.over) [w.over, w.at] = [Math.abs(tw) - 100, at];
          const k = `${pl.id}.${side}`;
          const p = last.get(k);
          if (p && p.src === src) {
            const j = Math.abs(wrapPi((tw - p.tw) * D)) / D;
            if (j > w.jump) [w.jump, w.jat] = [j, at];
          }
          last.set(k, { src, tw });
        }
      }
    });
    sim.dispose();
    return out;
  }

  it('supported arms stay inside the twist range and turn at most the rate per tick; the plan 12 twins roll past both', async () => {
    const tick = ((TW.maxRateRadPs / 60) * 180) / Math.PI;
    await rows(['L3-F4-twoArm', 'L3-F3-side', 'L3-F8-recontact', 'L4-F9-contact'], (id) => id, async (id) => {
      const on = await twistRun(FIX(id));
      expect(on.pose.over, `${id} ${on.pose.at}`).toBeLessThanOrEqual(-2 + 0.5);
      // the cone applied again after the turn adds a little
      expect(on.pose.jump, `${id} ${on.pose.jat}`).toBeLessThanOrEqual(tick + 1);
      // ladder 18: the twin is the arm before the met-arm flip (`preMetArmStay`), which the met contact sends to a raised or
      // forward alternative the pole rolls past the range; under the flip a met arm keeps its natural pose, which the
      // range holds without the fit (L3-F4-twoArm's and L4-F9-contact's twins no longer roll past)
      const off = await twistRun(v1(preMetArmStay(FIX(id))));
      expect(Math.max(off.pose.over, off.pose.jump - tick - 1), `${id} twin ${off.pose.at} ${off.pose.jat}`).toBeGreaterThan(5);
    });
  }, 240000);

  it('arm-task arms stay inside the twist range and turn at most the rate per tick; ragdolls start their shoulders less far outside it than the twins', async () => {
    const tick = ((TW.maxRateRadPs / 60) * 180) / Math.PI;
    await rows(['L3-F4-twoArm', 'HC-F3-phase0', 'L3-F6-hold', 'HC-F1-low', 'L4-F5-twoClamp-on'], (id) => id, async (id) => {
      const on = await twistRun(FIX(id));
      expect(on.armTask.over, `${id} ${on.armTask.at}`).toBeLessThanOrEqual(-2 + 0.5);
      // M1 follow-up (ladder rung 3): collision-free end poses do not make a continuous path between them. The window is
      // anchored once per substep and never widened past the rate, so a wrap arm whose palm cannot be reached within it
      // stalls or retreats (reach), or a held one is released (invalidPose), instead of turning its elbow around the
      // obstacle (L3-F4-twoArm D.left turned 55.6 deg in one tick at 0.867 s). The bound is the rate over the tick's
      // substeps, each of which may land past its window edge by the fit's stopping tolerance
      const S = FIX(id).solver.substeps;
      expect(on.armTask.jump, `${id} ${on.armTask.jat}`).toBeLessThanOrEqual(tick + (S * TWIST_FIT_TOL_RAD * 180) / Math.PI);
      const off = await twistRun(v1(FIX(id)));
      expect(on.startOutside, id).toBeLessThanOrEqual(off.startOutside + 1);
    });
  }, 240000);
});
