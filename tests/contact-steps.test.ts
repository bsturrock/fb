import { beforeAll, describe, expect, it } from 'vitest';
import type { ArmSide } from '../src/sim/contracts';
import { legsBound, standsNowhere, STEPS_V1, withSteps, type StepModelProfile } from '../src/sim/contact-steps';
import type { FootDebug } from '../src/sim/debug';
import { initPhysics } from '../src/sim/physics';
import { FOOTWORK_L3, initFeet, newFootPlan, observeFeet, planFeet, type FootEvent, type FootPlanInput } from '../src/sim/footwork';
import { groundOf, isFree, legHit, type FreeGround, type Part } from '../src/sim/free-ground';
import { swingExcess } from '../src/sim/joint-cone';
import { plannedChain, plannedLeg, plantReachM, type FootRequest, type PhysicalPose } from '../src/sim/pose';
import { JOINT_RANGE_V3 } from '../src/sim/profiles';
import { add, dist, norm, qFromAxisAngle, qInvRot, sub, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { POP_M, SLIDE_M } from './l3-pass';
import { FIX } from './runs';

// Plan 15 step 2: the contact stepping model (src/sim/contact-steps.ts) on constructed input, no physics: a body moved
// along a given velocity, its hips and homes with it, the other players as footprints, the leg solve exact (the shown
// ankle is the requested one). Each check states a viewer rule and has its fault twin: the same scene under a fault
// (no step ceiling, no free ground, the footprints without the leg, a plant past its reach waiting for the other foot,
// a step to the aim rather than for a gain, no turns, an aim followed at once, the fall triggers' old reads), which must
// fail it.

const R = FIX('L3-F6-hold').ragdoll!;
const SOLE = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
const TOE = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
const CEIL = SOLE + R.lengths.shin;
const DT = 1 / 240;
const SIDES: ArmSide[] = ['left', 'right'];
const M = STEPS_V1;
const ON = withSteps(FOOTWORK_L3);
const REACH = plantReachM(R, ON.plantTolM);

interface Scene {
  /** The body's horizontal velocity at time t (m/s). */
  vel: (t: number) => Vec3;
  /** Free ground judges the whole leg (default) or the footprints only (a fault). */
  footprintsOnly?: boolean;
  /** The other players' parts at time t, given the body centre (world). */
  others?: (t: number, c: Vec3) => Part[];
  /** Ankles to start from (world; default: on the ground under the hips). */
  start?: Record<ArmSide, Vec3>;
  /** The trunk leaning back by this (rad; default upright), and the hip's range (default: JOINT_RANGE_V3's; false: the knee's alone, a fault). */
  leanBackRad?: number;
  hipRange?: boolean;
  /** The hips' height above the sole (m; default 0.75). */
  hipM?: number;
  durS: number;
}
interface Run {
  ev: (FootEvent & { t: number; hip: Vec3 })[];
  /**
   * Per substep: time, planted feet, requested ankles, hips, the aims of the feet in the air, the fall triggers' reads
   * (legsBound, standsNowhere; and the old planner's: a foot in the air past its time), the other players' free ground.
   */
  frames: { t: number; planted: Record<ArmSide, boolean>; ankle: Record<ArmSide, Vec3>; hips: Record<ArmSide, Vec3>; aims: Vec3[]; bound: boolean; nowhere: boolean; late: boolean; ground: FreeGround; core: Quat }[];
}

const I = { x: 0, y: 0, z: 0, w: 1 };
const pose = (ankles: Record<ArmSide, Vec3>): PhysicalPose => {
  const seg = (id: string) => ({ segmentId: id, originWorld: v3(), rotationWorld: I });
  const li = (s: ArmSide) => ({ variant: 0, request: ankles[s], liftM: 0, softM: 0 });
  return {
    playerId: 'T',
    segments: { leftShin: seg('leftShin'), rightShin: seg('rightShin') } as unknown as PhysicalPose['segments'],
    jointLandmarksWorld: { leftAnkle: { ...ankles.left }, rightAnkle: { ...ankles.right } } as unknown as PhysicalPose['jointLandmarksWorld'],
    hingeDeg: {},
    straightFallback: [],
    limbClearance: {},
    legInfo: { left: li('left'), right: li('right') },
  } as unknown as PhysicalPose;
};
const ankleOf = (r: FootRequest, inp: FootPlanInput, s: ArmSide): Vec3 => (r.kind === 'plant' ? add(r.heelW, v3(0, SOLE, 0)) : r.kind === 'target' ? { ...r.ankleW } : add(inp.request[s], r.offsetW));

/** The model over a scene (facing +z, right +x), the given profile and fault switches. */
function run(sc: Scene, steps: StepModelProfile = M, debug?: FootDebug): Run {
  const P = { ...ON, steps };
  const plan = newFootPlan(P, R);
  let c = v3();
  const input = (t: number): FootPlanInput => {
    const v = sc.vel(t);
    const home = { left: v3(c.x - 0.12, SOLE, c.z), right: v3(c.x + 0.12, SOLE, c.z) };
    return {
      t,
      dt: DT,
      core: { p: v3(c.x, SOLE + 0.85, c.z), q: sc.leanBackRad ? qFromAxisAngle(v3(1, 0, 0), -sc.leanBackRad) : I },
      vel: v,
      yawRate: 0,
      supported: true,
      falling: false,
      ragdoll: false,
      groundY: 0,
      hips: { left: add(home.left, v3(0, sc.hipM ?? 0.75, 0)), right: add(home.right, v3(0, sc.hipM ?? 0.75, 0)) },
      home,
      request: home,
      clip: null,
      soleM: SOLE,
      toeM: TOE,
      rightW: v3(1, 0, 0),
      sideSign: { left: -1, right: 1 },
      contactHold: true,
      ground: groundOf(sc.others?.(t, c) ?? [], CEIL),
      ...(sc.footprintsOnly ? {} : { legs: R }),
      ...(sc.hipRange === false ? {} : { range: { profile: JOINT_RANGE_V3, sideX: { left: -1, right: 1 } } }),
      ...(debug ? { debug } : {}),
    };
  };
  const out: Run = { ev: [], frames: [] };
  const first = input(0);
  initFeet(plan, pose(sc.start ?? { left: first.home.left, right: first.home.right }), first, []);
  for (let k = 1; k * DT <= sc.durS + 1e-9; k++) {
    const t = k * DT;
    c = add(c, v3(sc.vel(t).x * DT, 0, sc.vel(t).z * DT));
    const inp = input(t);
    const ev: FootEvent[] = [];
    const req = planFeet(plan, inp, ev);
    const ankle = { left: ankleOf(req.left, inp, 'left'), right: ankleOf(req.right, inp, 'right') };
    observeFeet(plan, pose(ankle), SOLE, 0, ev, t);
    for (const e of ev) out.ev.push({ ...e, t, hip: inp.hips[e.side] });
    const aims = SIDES.filter((s) => plan.feet[s].mode !== 'planted').map((s) => plan.feet[s].contact!.aim);
    out.frames.push({ t, planted: { left: plan.feet.left.mode === 'planted', right: plan.feet.right.mode === 'planted' }, ankle, hips: inp.hips, aims, bound: legsBound(plan), nowhere: standsNowhere(plan), late: SIDES.some((s) => plan.feet[s].mode === 'swing' && plan.feet[s].elapsedS > plan.feet[s].durS), ground: inp.ground!, core: inp.core.q });
  }
  return out;
}

const plants = (r: Run) => r.ev.filter((e) => e.type === 'footPlant');
const at = (e: FootEvent): Vec3 => {
  const a = e.data.at as number[];
  return v3(a[0], a[1], a[2]);
};
/** Each step: its side, start, landing time and length in time (s: substeps from its first update to its landing). */
function steps(r: Run): { side: ArmSide; t0: number; t1: number; s: number }[] {
  const out: { side: ArmSide; t0: number; t1: number; s: number }[] = [];
  const open: Partial<Record<ArmSide, number>> = {};
  for (const e of r.ev) {
    if (e.type === 'footSwing' && e.data.source === 'step') open[e.side] = e.t;
    if (e.type === 'footPlant' && open[e.side] !== undefined) {
      out.push({ side: e.side, t0: open[e.side]!, t1: e.t, s: e.t - open[e.side]! + DT });
      delete open[e.side];
    }
  }
  return out;
}
/** Longest stretch (s) over which `read` holds, from `from`. */
const held = (r: Run, read: (f: Run['frames'][number]) => boolean, from = 0): number => {
  let n = 0;
  let worst = 0;
  for (const f of r.frames) {
    if (f.t < from) continue;
    n = read(f) ? n + 1 : 0;
    worst = Math.max(worst, n * DT);
  }
  return worst;
};
/** Longest stretch with no planted foot (s). */
const unplanted = (r: Run, from = 0): number => held(r, (f) => !f.planted.left && !f.planted.right, from);
/** Gallops: a foot landing twice in a row while the other stayed planted all the while. */
function gallops(r: Run): string[] {
  const out: string[] = [];
  let lastSide: ArmSide | null = null;
  let otherLifted = false;
  for (const e of r.ev) {
    if (e.type === 'footRelease' && e.side !== lastSide) otherLifted = true;
    if (e.type !== 'footPlant') continue;
    if (e.side === lastSide && !otherLifted) out.push(`${e.side} ${e.t.toFixed(3)}`);
    lastSide = e.side;
    otherLifted = false;
  }
  return out;
}
/**
 * A planted foot that moves on the ground (m): per plant, how far its requested ankle goes from where it landed while it
 * stands, plus how far past the plant reach its hip goes from it (a leg that cannot reach its plant drags it along).
 */
const skates = (r: Run): number => {
  let worst = 0;
  for (const s of SIDES) {
    let at0: Vec3 | null = null;
    for (const f of r.frames) {
      if (!f.planted[s]) {
        at0 = null;
        continue;
      }
      at0 ??= f.ankle[s];
      worst = Math.max(worst, dist(f.ankle[s], at0) + Math.max(0, dist(f.ankle[s], f.hips[s]) - REACH));
    }
  }
  return worst;
};
/**
 * How far a planted leg's thigh goes past the hip's swing range (deg; negative inside): per frame, the planned leg at
 * each plant from its hip, in the core frame, against JOINT_RANGE_V3's hip cone; the largest.
 */
const hipPast = (r: Run): number => {
  let worst = -Infinity;
  for (const f of r.frames)
    for (const s of SIDES) {
      if (!f.planted[s]) continue;
      const { mid } = plannedChain(R, f.hips[s], f.ankle[s], 0);
      worst = Math.max(worst, (swingExcess(JOINT_RANGE_V3.hipTwist!.envelope, qInvRot(f.core, norm(sub(mid, f.hips[s]))), s === 'right' ? 1 : -1).rad * 180) / Math.PI);
    }
  return worst;
};
/** Largest move of a requested ankle in one substep (m). */
const pops = (r: Run): number => {
  let worst = 0;
  for (let i = 1; i < r.frames.length; i++) for (const s of SIDES) worst = Math.max(worst, dist(r.frames[i].ankle[s], r.frames[i - 1].ankle[s]));
  return worst;
};

const push = (dir: Vec3, mps: number, at0 = 0.2) => (t: number): Vec3 => {
  const k = Math.min(1, Math.max(0, (t - at0) / 0.05));
  return v3(dir.x * mps * k, 0, dir.z * mps * k);
};
/**
 * A man facing the stepping player (toward -z) with his hips at `c` (world, ground level), crouched: his support capsule,
 * thighs from his hips (0.93 m) down to knees `kneeY` high and `kneeZ` in front of them, shins down to his ankles.
 */
const manAt = (c: Vec3, kneeY = 0.5, kneeZ = 0.15, v: Vec3 = v3()): Part[] =>
  [-1, 1].flatMap((x) => {
    const hip = v3(c.x + 0.12 * x, 0.93, c.z);
    const knee = v3(c.x + 0.12 * x, kneeY, c.z - kneeZ);
    return [
      { shape: { kind: 'capsule', a: hip, b: knee, r: R.radii.thigh }, v, key: `B:${x}Thigh` },
      { shape: { kind: 'capsule', a: knee, b: v3(knee.x, 0.1, c.z), r: R.radii.shin }, v, key: `B:${x}Shin` },
    ] as Part[];
  });
/** The landings whose planned leg (at its plant, from the hip then) is inside another player's part. */
const legsIn = (r: Run): string[] =>
  plants(r)
    .filter((e) => {
      const f = r.frames.find((x) => x.t === e.t)!;
      const p = at(e);
      return !!legHit(f.ground, plannedLeg(R, e.side, e.hip, v3(p.x, SOLE, p.z), 0), 0, 0);
    })
    .map((e) => `${e.side} ${e.t.toFixed(3)}`);
/** A standing player's lower body at `c` (world): his support capsule and two shins. */
const legsAt = (c: Vec3, v: Vec3 = v3(), key = 'B'): Part[] => [
  { shape: { kind: 'capsule', a: v3(c.x, 0.16, c.z), b: v3(c.x, 1.4, c.z), r: 0.16 }, v, key: `${key}:proxy` },
  { shape: { kind: 'capsule', a: v3(c.x - 0.12, 0.07, c.z), b: v3(c.x - 0.12, 0.5, c.z), r: R.radii.shin }, v, key: `${key}:leftShin` },
  { shape: { kind: 'capsule', a: v3(c.x + 0.12, 0.07, c.z), b: v3(c.x + 0.12, 0.5, c.z), r: R.radii.shin }, v, key: `${key}:rightShin` },
];

describe('contact stepping model (plan 15)', () => {
  beforeAll(initPhysics);
  // the feet in the air when the model takes over (mid stride at a hit), the body pushed from each side at 2 m/s
  const AIR = { left: v3(-0.12, SOLE + 0.25, -0.3), right: v3(0.12, SOLE + 0.08, 0.25) };
  const DIRS: [string, Vec3][] = [['ahead', v3(0, 0, 1)], ['behind', v3(0, 0, -1)], ['from the left', v3(1, 0, 0)], ['from the right', v3(-1, 0, 0)]];

  it.each(DIRS)('pushed %s with both feet in the air, a foot is down within the step ceiling, and every step keeps its time', (_, dir) => {
    const sc: Scene = { vel: push(dir, 2, 0), start: AIR, durS: 1.5 };
    const r = run(sc);
    expect(plants(r).length).toBeGreaterThan(3);
    expect(plants(r)[0].t).toBeLessThanOrEqual(M.maxS + DT);
    expect(unplanted(r)).toBeLessThanOrEqual(M.maxS + DT);
    for (const s of steps(r)) {
      expect(s.s).toBeGreaterThanOrEqual(M.minS - 1e-9);
      expect(s.s).toBeLessThanOrEqual(M.maxS + DT);
    }
    // fault twin: a step's time from its length with no ceiling (a slow foot): the first foot down comes late
    const slow = run(sc, { ...M, stepMps: 0.2, travelK: 0, maxS: 2 });
    expect(plants(slow)[0]?.t ?? Infinity).toBeGreaterThan(M.maxS + DT);
  });

  it('a body in the path: the foot lands beside his legs, never on them, and never aims into them', () => {
    // pushed at 1.5 m/s toward a man standing 0.85 m ahead, slowing to a stop 0.44 m short of him (centre to centre)
    const man = legsAt(v3(0.05, 0, 0.85));
    const g = groundOf(man, CEIL);
    const vel = (t: number): Vec3 => v3(0, 0, t < 0.2 ? 0 : t < 0.35 ? 1.5 : Math.max(0, 1.5 - (t - 0.35) * 6));
    const sc: Scene = { vel, others: () => man, durS: 1.2 };
    // (a foot is on him when its shoe, the disc the model asks with, overlaps his footprint)
    const on = (p: Vec3): boolean => !isFree(g, add(p, v3(0, 0, R.shoe.forwardM)), 0, { clearM: M.footR - 1e-6 });
    const onHim = (rr: Run): string[] => plants(rr).filter((e) => on(at(e))).map((e) => `${e.side} ${e.t.toFixed(3)}`);
    const aimsOnHim = (rr: Run): number => rr.frames.filter((f) => f.aims.some(on)).length;
    const r = run(sc);
    expect(plants(r).length).toBeGreaterThan(1);
    expect(onHim(r)).toEqual([]);
    expect(aimsOnHim(r)).toBe(0);
    // fault twin: the free ground left out (the other man not seen): a foot aims at him and lands on his
    const blind = run({ ...sc, others: undefined });
    expect(onHim(blind)).not.toEqual([]);
    expect(aimsOnHim(blind)).toBeGreaterThan(0);
  });

  it('a steady drive into a man: the feet alternate, every step short from the hip and within its time', () => {
    // driving at 1 m/s, the man ahead (0.5 m, centre to centre) driven back at the same speed
    const sc: Scene = { vel: push(v3(0, 0, 1), 1), others: (_, c) => legsAt(v3(c.x, 0, c.z + 0.5), v3(0, 0, 1)), durS: 2.5 };
    const r = run(sc);
    expect(steps(r).length).toBeGreaterThan(6);
    expect(gallops(r)).toEqual([]);
    for (const e of plants(r)) expect(Math.hypot(at(e).x - e.hip.x, at(e).z - e.hip.z), `${e.side} ${e.t.toFixed(3)}`).toBeLessThanOrEqual(M.maxStepM + 0.01);
    for (const s of steps(r)) {
      expect(s.s).toBeGreaterThanOrEqual(M.minS - 1e-9);
      expect(s.s).toBeLessThanOrEqual(M.maxS + DT);
    }
  });

  it('no plant ever moves on the ground: a plant that cannot stand lifts, also with the other foot in the air', () => {
    // a hit at speed: the body driven from still to 5 m/s, where a plant runs out of reach within a step
    const sc: Scene = { vel: push(v3(0, 0, 1), 5), durS: 1.5 };
    const r = run(sc);
    expect(plants(r).length).toBeGreaterThan(6);
    expect(skates(r)).toBeLessThanOrEqual(1e-9);
    // (and at a steady drive into a man)
    expect(skates(run({ vel: push(v3(0, 0, 1), 1), others: (_, c) => legsAt(v3(c.x, 0, c.z + 0.5), v3(0, 0, 1)), durS: 2.5 }))).toBeLessThanOrEqual(1e-9);
    // fault twin (FootDebug.stepsStanceWaits): a plant past its reach waits for the other foot to land: its leg would drag it
    expect(skates(run(sc, M, { stepsStanceWaits: true }))).toBeGreaterThan(SLIDE_M);
  });

  it('a trailing plant lifts before its hip passes its range: driven at speed, crouched, the trunk leaning back', () => {
    // driven to 4 m/s, the hips 0.6 m above the soles and the trunk leaning back 20 degrees (a hit that stands him up):
    // a plant left behind the hips passes the hip's extension range before its knee's reach
    const sc: Scene = { vel: push(v3(0, 0, 1), 4), leanBackRad: (20 * Math.PI) / 180, hipM: 0.6, durS: 1.5 };
    const r = run(sc);
    expect(steps(r).length).toBeGreaterThan(4);
    expect(hipPast(r)).toBeLessThanOrEqual(0);
    // fault twin: the knee's range alone (no hip range): the plant stands until its knee's reach, the hip past its range
    expect(hipPast(run({ ...sc, hipRange: false }))).toBeGreaterThan(3);
  });

  it('at speed, both feet are in the air only briefly: never longer than one step time', () => {
    const sc: Scene = { vel: push(v3(0, 0, 1), 5), durS: 1.5 };
    const r = run(sc);
    // (there are flights: a plant runs out of reach while the other foot is still in the air)
    expect(unplanted(r, 0.3)).toBeGreaterThan(DT);
    expect(unplanted(r)).toBeLessThanOrEqual(M.maxS + DT);
    // fault twin: a step's time with no ceiling (a slow foot): the flight lasts as long as the slow step
    expect(unplanted(run(sc, { ...M, stepMps: 0.4, travelK: 0, maxS: 1 }))).toBeGreaterThan(M.maxS + DT);
  });

  it('chest to chest, standing still: no step, though his foot stands where a foot would want to be and shuffles', () => {
    // a man 0.8 m ahead (hip to hip), his left foot reaching in across under the stepping player's right hip, shuffling
    // 3 cm to and fro: the right foot, planted behind it, has its nearest free place now behind it, now in front of it
    const toe = (t: number): Part => {
      const z = R.shoe.forwardM + 0.03 * Math.sign(Math.sin(t * 5));
      return { shape: { kind: 'capsule', a: v3(0.05, 0.05, z), b: v3(0.3, 0.05, z), r: 0.04 }, v: v3(), key: 'B:leftShoe' };
    };
    const man = (t: number): Part[] => [...manAt(v3(0, 0, 0.8), 0.55, 0.1), toe(t)];
    const start = { left: v3(-0.12, SOLE, 0), right: v3(0.12, SOLE, -0.28) };
    // (the premise: both legs stand clear where they are)
    for (const t of [0.1, 0.8]) for (const s of SIDES) expect(legHit(groundOf(man(t), CEIL), plannedLeg(R, s, v3(s === 'left' ? -0.12 : 0.12, SOLE + 0.75, 0), start[s], 0), 0, 0)).toBeNull();
    const sc: Scene = { vel: () => v3(), others: (t) => man(t), start, durS: 2 };
    expect(steps(run(sc))).toEqual([]);
    // fault twin (FootDebug.stepsToAim): a plant farther than coverM from its aim steps: the foot steps over his for nothing
    // (and with no turns either, as in the step 2 model, to and fro)
    expect(steps(run(sc, M, { stepsToAim: true })).length).toBeGreaterThan(0);
    expect(steps(run(sc, M, { stepsToAim: true, stepsNoTurns: true })).length).toBeGreaterThan(1);
  });

  it('a foot never lands where its leg would be in another player: his knees at the height of the thighs', () => {
    // a steady drive at 1 m/s into a man crouched 0.75 m ahead (hip to hip), driven back as fast, his knees forward at
    // thigh height (above the ground he blocks)
    const sc: Scene = { vel: push(v3(0, 0, 1), 1), others: (_, c) => manAt(v3(c.x, 0, c.z + 0.75), 0.75, 0.3, v3(0, 0, 1)), durS: 2 };
    const r = run(sc);
    expect(plants(r).length).toBeGreaterThan(6);
    expect(legsIn(r)).toEqual([]);
    // fault twin: free ground of the footprints only (the leg not judged): a foot lands with its knee in his
    expect(legsIn(run({ ...sc, footprintsOnly: true }))).not.toEqual([]);
  });

  it('weaving, the feet take turns: never the same foot twice while the other is planted', () => {
    // walked forward at 0.5 m/s, weaving 1.2 m/s from side to side
    const sc: Scene = { vel: (t) => v3(Math.sin(t * 4) * 1.2, 0, 0.5), durS: 2.5 };
    const r = run(sc);
    expect(steps(r).length).toBeGreaterThan(10);
    expect(gallops(r)).toEqual([]);
    // fault twin (FootDebug.stepsNoTurns): the foot that gains more steps, also when it stepped last
    expect(gallops(run(sc, M, { stepsNoTurns: true }))).not.toEqual([]);
  });

  it('an aim that moves late is followed at a bounded rate: no jump of the foot', () => {
    // a man's shin stamping in and out of the right foot's way every 25 ms, from 0.5 s (its aim jumps at any point of a step)
    const sc: Scene = {
      vel: push(v3(0, 0, 1), 1),
      others: (t, c) => {
        const x = c.x + 0.12 + (Math.floor(t / 0.025) % 2 ? 0.3 : 0);
        return t > 0.5 ? [{ shape: { kind: 'capsule', a: v3(x, 0.07, c.z + 0.38), b: v3(x, 0.5, c.z + 0.38), r: R.radii.shin }, v: v3(0, 0, 1), key: 'B:leftShin' }] : [];
      },
      durS: 2,
    };
    expect(pops(run(sc))).toBeLessThanOrEqual(POP_M);
    // fault twin: the aim followed at once
    expect(pops(run(sc, { ...M, followMps: 1e9 }))).toBeGreaterThan(POP_M);
  });

  // the fall triggers' reads (simulation.ts: the bound-legs fall's clause (b) and the ride-down's come-down; the drive's
  // grace 0.05 s, the bound-legs confirm 0.2 s)
  const GRACE_S = 0.05;
  const CONFIRM_S = 0.2;

  it('legs bound: driven on over a man down in front, the feet cannot follow the hips, for longer than a fall\'s confirm time', () => {
    // a man lying across the path from 0.35 m ahead (all of him below the shin top: no place on him), the body driven on
    // over him at 1 m/s (a rider whose carrier went down in front of him)
    const down: Part[] = [{ shape: { kind: 'box', c: v3(0, 0.12, 1.1), he: v3(0.7, 0.12, 0.75), q: I }, v: v3(), key: 'B:down' }];
    const r = run({ vel: push(v3(0, 0, 1), 1), others: () => down, durS: 1.6 });
    // on open ground (before he is within a step) the legs are free
    expect(r.frames.filter((f) => f.t < 0.4 && (f.bound || f.nowhere)).length).toBe(0);
    // over him the legs are bound and he stands nowhere, past the confirm time
    expect(held(r, (f) => f.bound)).toBeGreaterThan(CONFIRM_S + 0.05);
    expect(held(r, (f) => f.nowhere)).toBeGreaterThan(CONFIRM_S + 0.05);
    // fault twin: the old planner's read on the same run (a foot in the air past its time) never holds: every step lands
    // on time
    expect(held(r, (f) => f.late)).toBe(0);
  });

  it('a man down in front with space beside him: the feet step to his sides, not bound', () => {
    // driven on at 1 m/s, crouched (the hips 0.6 m above the soles), over a man lying flat across the path from 0.35 m
    // ahead (0.8 m wide, 12 cm high): no place within a short step, the places beside him within the leg's reach
    const down: Part[] = [{ shape: { kind: 'box', c: v3(0, 0.06, 1.1), he: v3(0.4, 0.06, 0.75), q: I }, v: v3(), key: 'B:down' }];
    const sc: Scene = { vel: push(v3(0, 0, 1), 1), others: () => down, hipM: 0.6, durS: 1.6 };
    const beside = (r: Run): number => plants(r).filter((e) => at(e).z > 0.3 && Math.abs(at(e).x) > 0.4 + M.footR - 0.01).length;
    const r = run(sc);
    expect(beside(r)).toBeGreaterThan(2);
    expect(plants(r).filter((e) => at(e).z > 0.3 && Math.abs(at(e).x) < 0.4)).toEqual([]);
    expect(held(r, (f) => f.bound)).toBeLessThan(CONFIRM_S);
    // fault twin (FootDebug.stepsShortOnly): the short step alone: the feet are bound past a fall's confirm time
    const short = run(sc, M, { stepsShortOnly: true });
    expect(beside(short)).toBe(0);
    expect(held(short, (f) => f.bound)).toBeGreaterThan(CONFIRM_S + 0.05);
  });

  it('a bound foot steps under the hips: driven on over a man down, every step lands under its hip', () => {
    const down: Part[] = [{ shape: { kind: 'box', c: v3(0, 0.12, 1.1), he: v3(0.7, 0.12, 0.75), q: I }, v: v3(), key: 'B:down' }];
    const sc: Scene = { vel: push(v3(0, 0, 1), 1), others: () => down, durS: 1.6 };
    // how far a landing is from its hip (horizontal), over the landings while the legs are bound
    const fromHip = (r: Run): number[] => plants(r).filter((e) => r.frames.find((f) => f.t === e.t)!.bound).map((e) => Math.hypot(at(e).x - e.hip.x, at(e).z - e.hip.z));
    const r = run(sc);
    expect(fromHip(r).length).toBeGreaterThan(1);
    expect(Math.max(...fromHip(r))).toBeLessThanOrEqual(0.05);
    // fault twin (FootDebug.stepsBoundWant): a bound foot aims at its want, a short step ahead, into him
    expect(Math.max(...fromHip(run(sc, M, { stepsBoundWant: true })))).toBeGreaterThan(0.25);
  });

  it('a stride\'s flight is not a fall: at speed on open ground the legs are never bound, though both feet are up for longer than the grace', () => {
    const r = run({ vel: push(v3(0, 0, 1), 5), durS: 1.5 });
    expect(r.frames.filter((f) => f.bound || f.nowhere).length).toBe(0);
    // fault twin: the old read (no planted foot) holds through a flight past the drive's grace: a rider would go down in his stride
    expect(unplanted(r, 0.3)).toBeGreaterThan(GRACE_S);
  });
});
