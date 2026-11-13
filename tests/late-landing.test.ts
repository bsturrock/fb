import { describe, expect, it } from 'vitest';
import type { ArmSide } from '../src/sim/contracts';
import type { FootDebug } from '../src/sim/debug';
import { FOOTWORK_L3, initFeet, newFootPlan, observeFeet, planFeet, withLateLanding, type FootEvent, type FootPlanInput } from '../src/sim/footwork';
import type { FootRequest, PhysicalPose } from '../src/sim/pose';
import type { Simulation } from '../src/sim/simulation';
import { stepAccelMax } from '../src/sim/step-path';
import { add, qFromAxisAngle, v3, type Vec3 } from '../src/sim/vec';
import { asCaptured, FIX } from './runs';
import { loadState, resumeState } from './state';

// Contact motion polish 2, the leg gallop (FootComposeProfile.lateLanding, no fixture uses it): a new step keeps the
// time its acceleration limit needs for its distance, and a step out of time lands at a destination fixed on the turf.
// Before, a step squeezed to its stance foot's window (L3-F7-loadRelease R's right step at 0.446 s: 1.15 m in 0.05 s)
// ran out of time at once and skimmed the turf for 0.45 s while the other foot took two stances in a row.

/** A minimum-jerk path's peak acceleration over its distance / its time^2 (10 / sqrt 3): its floor is sqrt(k D / aMax). */
const MJ_PEAK_ACCEL = 10 / Math.sqrt(3);

// ------------------------------------------------------------------ L3-F7-loadRelease from a state capture (tick 26, 0.433 s)
// The carrier R at 5.8 m/s, his left foot planted (0.338 s), his right about to lift off at the clip's liftoff (0.446 s)
// with little reach left on the left: the step the old fit squeezed.
const CAP = 'L3-F7-loadRelease@26';
async function resume(late: boolean, foot?: FootDebug): Promise<Simulation> {
  const cap = loadState(`tests/data/state/${CAP}.json.gz`);
  const def = asCaptured(cap);
  expect(def.footwork?.compose?.lateLanding, 'the capture runs without the rules').toBeUndefined();
  return resumeState(cap, late ? { def: { ...def, footwork: withLateLanding(def.footwork!) }, variant: ['footwork'], ...(foot ? { faults: { foot } } : {}) } : { def });
}
interface Run {
  /** R's plants from 0.3 s to 1.0 s (side, time), with the plant before the capture. */
  plants: { side: string; t: number }[];
  /** The longest time one of R's feet stayed a planner step in the air (s, sampled per tick). */
  longestStepS: number;
  /** R's first planner step that starts after the capture: its duration and length, the travel speed and its acceleration floor (s). */
  first: { durS: number; stepM: number; floorS: number } | null;
}
async function run(late: boolean, foot?: FootDebug): Promise<Run> {
  const sim = await resume(late, foot);
  const R = sim.players.find((p) => p.id === 'R')!;
  const t0 = sim.t;
  const C = sim.def.footwork!.compose!;
  const run: Record<ArmSide, number> = { left: 0, right: 0 };
  let longestStepS = 0;
  let first: Run['first'] = null;
  let seen = sim.events.length;
  while (!sim.done && sim.t < 1.0 - 1e-9) {
    sim.stepTick();
    for (const s of ['left', 'right'] as const) {
      const f = R.feet!.feet[s];
      run[s] = f.mode === 'swing' && f.source === 'step' ? run[s] + sim.def.solver.outerTickS : 0;
      longestStepS = Math.max(longestStepS, run[s]);
    }
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen];
      const d = e.data as { source?: string; durS?: number; stepM?: number };
      if (first || e.playerId !== 'R' || e.type !== 'footSwing' || d.source !== 'step' || e.t <= t0) continue;
      const v = R.proxy.body.linvel();
      first = { durS: d.durS!, stepM: d.stepM!, floorS: Math.sqrt((MJ_PEAK_ACCEL * d.stepM!) / stepAccelMax(C, v3(v.x, 0, v.z))) };
    }
  }
  const plants = sim.events.filter((e) => e.playerId === 'R' && e.type === 'footPlant' && e.t >= 0.3 && e.t <= 1.0).map((e) => ({ side: String((e.data as { side: string }).side), t: e.t }));
  sim.dispose();
  return { plants, longestStepS, first };
}
const alternates = (p: { side: string }[]): boolean => p.every((q, i) => i === 0 || q.side !== p[i - 1].side);

describe('polish 2: a late step lands and a new step keeps its acceleration time (FootComposeProfile.lateLanding)', () => {
  const P = withLateLanding(FOOTWORK_L3);
  const limitS = P.swing.maxS + P.compose!.arriveS;

  it('L3-F7-loadRelease R (capture at 0.433 s, 5.8 m/s): no step stays in the air longer than its longest time and one arrival stretch, and the feet alternate; the twin without the rules strands the right step and plants the left twice', async () => {
    const on = await run(true);
    expect(on.longestStepS, JSON.stringify(on)).toBeLessThanOrEqual(limitS);
    expect(on.plants.length, JSON.stringify(on.plants)).toBeGreaterThanOrEqual(3);
    expect(alternates(on.plants), JSON.stringify(on.plants)).toBe(true);
    const off = await run(false);
    expect(off.longestStepS, JSON.stringify(off)).toBeGreaterThan(limitS);
    expect(alternates(off.plants), JSON.stringify(off.plants)).toBe(false);
  });

  it("L3-F7-loadRelease R: the new step's duration is at least the time its acceleration limit needs for its length; the twin fitted before its destination is set (squeezeStart, the old order) is squeezed below it", async () => {
    const on = await run(true);
    expect(on.first, 'a step starts').not.toBeNull();
    expect(on.first!.durS, JSON.stringify(on.first)).toBeGreaterThanOrEqual(on.first!.floorS);
    const squeezed = await run(true, { squeezeStart: true });
    expect(squeezed.first!.durS, JSON.stringify(squeezed.first)).toBeLessThan(squeezed.first!.floorS);
  });

  // ----------------------------------------------------------------- constructed: a late step's destination (no physics)
  // The L3 planner on an L3 fixture's ragdoll and shoe; the solve is synthetic (flat shoes at the requested ankles, the
  // right one held 3 cm above its request so it cannot land). The body runs at 4 m/s along +z; the left foot is planted,
  // the right is a planner step already out of time behind the hip.
  const R = FIX('L3-F7-loadRelease').ragdoll!;
  const SOLE = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
  const TOE = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
  const DT = 1 / 240;
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
  const input = (t: number, z: number, vz: number, debug?: FootDebug): FootPlanInput => {
    const home = { left: v3(-0.12, SOLE, z), right: v3(0.12, SOLE, z) };
    return {
      t,
      dt: DT,
      core: { p: v3(0, SOLE + 0.85, z), q: qFromAxisAngle(v3(0, 1, 0), 0) },
      vel: v3(0, 0, vz),
      yawRate: 0,
      supported: true,
      falling: false,
      ragdoll: false,
      groundY: 0,
      hips: { left: add(home.left, v3(0, 0.72, 0)), right: add(home.right, v3(0, 0.72, 0)) },
      home,
      request: { left: { ...home.left }, right: { ...home.right } },
      clip: null,
      soleM: SOLE,
      toeM: TOE,
      rightW: v3(1, 0, 0),
      sideSign: { left: -1, right: 1 },
      heelLift: true,
      ...(debug ? { debug } : {}),
    };
  };
  const shown = (out: Record<ArmSide, FootRequest>, inp: FootPlanInput): Record<ArmSide, Vec3> => {
    const a = {} as Record<ArmSide, Vec3>;
    for (const s of ['left', 'right'] as const) {
      const r = out[s];
      a[s] = r.kind === 'plant' ? add(r.heelW, v3(0, SOLE, 0)) : r.kind === 'target' ? { ...r.ankleW } : add(inp.request[s], r.offsetW);
    }
    a.right = add(a.right, v3(0, 0.03, 0));
    return a;
  };
  /** The right step's destination each substep over `n` substeps; the travel reverses at substep `reverseAt`. */
  function dests(debug: FootDebug | undefined, n: number, reverseAt = Infinity): Vec3[] {
    const plan = newFootPlan(P, R);
    initFeet(plan, pose({ left: v3(-0.12, SOLE, 0), right: v3(0.12, SOLE, 0) }), input(0, 0, 4, debug), []);
    const f = plan.feet.right;
    Object.assign(f, { mode: 'swing', tentative: false, source: 'step', why: 'step', elapsedS: 0.25, durS: 0.2, lateS: 0, short: false, drag: false, wait: false, heelW: null, anchorW: null, liftO: 0, liftV: 0 });
    f.target = v3(0.12, SOLE, -0.2);
    f.dest = v3(0.12, SOLE, 0.3);
    f.stepH = { v: v3(0, 0, 6), a: v3() };
    f.stepY = { v: 0, a: 0 };
    const out: Vec3[] = [];
    let z = 0;
    let vz = 4;
    for (let k = 1; k <= n; k++) {
      if (k === reverseAt) vz = -4;
      z += vz * DT;
      const inp = input(k * DT, z, vz, debug);
      const ev: FootEvent[] = [];
      const req = planFeet(plan, inp, ev);
      observeFeet(plan, pose(shown(req, inp)), SOLE, 0, ev, k * DT);
      expect(plan.feet.right.mode, `substep ${k}`).toBe('swing');
      out.push({ ...plan.feet.right.dest! });
    }
    return out;
  }
  const distinct = (d: Vec3[]): number => new Set(d.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`)).size;

  it("constructed: a late step's destination stays fixed on the turf while it is inside the reach budget (the twin re-picking against the moving hip, lateRepick, moves it every arrival stretch) and is re-picked once the travel reverses and takes it outside", () => {
    // 0.1 s at 4 m/s: the hip moves 0.4 m; the destination does not
    const fixed = dests(undefined, 24);
    expect(distinct(fixed)).toBe(1);
    const repicked = dests({ lateRepick: true }, 24);
    expect(distinct(repicked)).toBeGreaterThan(1);
    expect(repicked[repicked.length - 1].z - repicked[0].z).toBeGreaterThan(0.1);
    // the travel reverses at substep 6: the destination ahead leaves the budget about the predicted hip and is picked again, behind
    const rev = dests(undefined, 12, 6);
    expect(distinct(rev.slice(0, 5))).toBe(1);
    expect(rev[5].z).toBeLessThan(rev[4].z - 0.1);
  });
});
