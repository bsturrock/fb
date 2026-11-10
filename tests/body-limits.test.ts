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
import { armSelfShapes, hingeChain, twoBone, type PoseShape } from '../src/sim/pose';
import { RAPIER, trunkShapes } from '../src/sim/physics';
import { armTwistRad, behindDeg, fitElbowTwist, swingExcess, swingExtentDeg, twistWindow } from '../src/sim/joint-cone';
import { FOOTWORK_L3 } from '../src/sim/footwork';
import { ENVELOPE_L4, JOINT_RANGE_V1, JOINT_RANGE_V2, SELF_CLEARANCE_V1, sideSignX } from '../src/sim/profiles';
import { externalTwistRad, SEGMENTS, swingTwistOf } from '../src/sim/ragdoll';
import { Simulation, type PlayerRuntime, type SimOptions } from '../src/sim/simulation';
import { add, addScaled, dist, len, norm, qConj, qFromAxisAngle, qFromUnitVectors, qMul, qRot, scale, sub, v3, wrapPi, type Quat, type Vec3 } from '../src/sim/vec';
import { FIX, rows, runSim } from './helpers';

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

/** Deepest penetration (m) of either arm's self shapes, at their full radii, in the player's own measured trunk. */
function selfDepth(def: FixtureDef, pl: PlayerRuntime, side: 'left' | 'right'): number {
  const T = trunkShapes(pl.body);
  if (!T || !pl.pose) return 0;
  const lm = pl.pose.jointLandmarksWorld;
  const core = pl.pose.segments.core;
  let d = 0;
  for (const s of armSelfShapes(def.ragdoll!.radii, pl.body.measured!.handTipM!, side, lm[`${side}Elbow`], lm[`${side}Wrist`], lm[`${side}Palm`])) {
    const q = rapierShape(s);
    for (const t of T) {
      const r = t.contactShape(core.originWorld, core.rotationWorld, q.shape, q.p, q.q, 0.02);
      if (r) d = Math.max(d, -r.distance);
    }
  }
  return d;
}

/** The worst own-trunk depth per arm source, every tick of a run. */
function depthObserver(def: FixtureDef): { out: Record<Src, { d: number; at: string }>; tick: (s: Simulation) => void } {
  const out: Record<Src, { d: number; at: string }> = { pose: { d: 0, at: '' }, armTask: { d: 0, at: '' }, ragdoll: { d: 0, at: '' } };
  return {
    out,
    tick: (s) => {
      for (const pl of s.players)
        for (const side of ['left', 'right'] as const) {
          const src: Src = pl.rag ? 'ragdoll' : s.arms?.obs(pl.id)?.[side]?.enabled ? 'armTask' : 'pose';
          const d = selfDepth(def, pl, side);
          if (d > out[src].d) out[src] = { d, at: `${pl.id}.${side}@${s.t.toFixed(3)}` };
        }
    },
  };
}

const without = (def: FixtureDef): FixtureDef => ({ ...def, id: `${def.id}-noSelf`, selfClearance: undefined });

// ------------------------------------------------------------------ plan 12: the joint-range probe
/** Plan 09's persistence limit (s), which the ragdoll envelope under the profile keeps. */
const FALLS_PERSIST_S = ENVELOPE_L4.persistS;

const J = JOINT_RANGE_V1;
const D = Math.PI / 180;
const twin = (d: FixtureDef): FixtureDef => ({ ...d, id: `${d.id}-noRange`, jointRange: undefined });
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
  /** Longest run (s) of a ragdoll arm more than the envelope's 5 deg tolerance past the cone. */
  ragOverRunS: number;
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
  const out: Probe = { worst, ragOverRunS: 0, ankleMin: 999, feet: new Map(), planted: { n: 0, past: 0, gapM: 0, hzM: 0 } };
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

// ------------------------------------------------------------------ one run per fixture
// Plan 13b: the self-clearance and joint-range checks read the same run (`Simulation.create(def)`, to its end), so each
// fixture is simulated once, with the joint-range probe (cheap) on every run and the own-trunk depth (shape queries every
// tick) on the runs whose fixtures a self-clearance test lists with `measureDepth` while the file is collected, before any
// test runs. Both observers only read.
const DEPTH = new Set<string>();
const measureDepth = (defs: FixtureDef[]): void => defs.forEach((d) => DEPTH.add(d.id));

const runs = new Map<string, Promise<{ depth?: Record<Src, { d: number; at: string }>; range: Probe }>>();
const watched = (def: FixtureDef): Promise<{ depth?: Record<Src, { d: number; at: string }>; range: Probe }> => {
  if (!runs.has(def.id)) runs.set(def.id, runWatched(def));
  return runs.get(def.id)!;
};
async function runWatched(def: FixtureDef): Promise<{ depth?: Record<Src, { d: number; at: string }>; range: Probe }> {
  const sim = await Simulation.create(def);
  const depth = DEPTH.has(def.id) ? depthObserver(def) : null;
  const range = rangeObserver();
  await runSim(sim, Infinity, (s) => {
    depth?.tick(s);
    range.tick(s);
  });
  sim.dispose();
  return { depth: depth?.out, range: range.out };
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

  it('pose arms and arm-task arms stay within the skin tolerance of the own trunk, on every free-running and tackle fixture listed', async () => {
    await checks([
      ...POSE.map(
        (id): Check => [
          `${id}: pose arms within the skin tolerance`,
          async () => {
            const w = await worstBySource(FIX(id));
            expect(w.pose.d, w.pose.at).toBeLessThanOrEqual(TOL + 0.012);
          },
        ],
      ),
      ...ARM_TASK.map(
        (id): Check => [
          `${id}: arm-task arms within the skin tolerance`,
          async () => {
            const w = await worstBySource(FIX(id));
            expect(w.armTask.d, w.armTask.at).toBeLessThanOrEqual(TOL + 0.005);
          },
        ],
      ),
    ]);
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
  measureDepth(RAGDOLL.flatMap((id) => [FIX(id), withoutV1(FIX(id))]));

  it('ragdoll forearms stay out of the trunk; without the profile they pass through, on every ragdoll fixture listed', async () => {
    await rows(RAGDOLL, (id) => id, async (id) => {
      const w = await worstBySource(FIX(id));
      expect(w.ragdoll.d, w.ragdoll.at).toBeLessThanOrEqual(0.025);
      const off = await worstBySource(withoutV1(FIX(id)));
      expect(off.ragdoll.d, off.ragdoll.at).toBeGreaterThan(0.05);
    });
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

  it('ragdoll shoulders: the runner cases stay within the 5 deg tolerance past the cone, but for brief loads; the twins go far behind', async () => {
    // plan 13d: HC-F3-phase0 (margin 14.6 deg) and L3-F1-phase0 (twin 25.8 behind) no longer load the runner's arm behind
    // with Fast Run's contact timing; HC-F3-falling and HC-F3-mirror do (margins 32.9 and 32.0 deg). Plan 13e: on the L3
    // planner with the idle and walk clips HC-F3-falling's twin is 28.3 deg behind (the profile's 46.6, inside the cone by
    // 0.7 deg past it); HC-F3-phase50 loads it (twin 82.4, profile 50.4). Plan 13f: the twin keeps the leg guard, under
    // which HC-F3-phase50's twin is 63.2 deg behind (profile 50.7: margin 12.5); HC-F3-phase0 loads it again (twin 62.7,
    // profile 37.8)
    for (const id of ['HC-F3-phase0', 'HC-F3-lowRunner', 'HC-F3-mirror', 'L3-F1-low']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      expect(off.worst.ragdoll.behind, id).toBeGreaterThan(45);
      // plan 14: margin 15 (was 20): the profile's supported back swing now eases to 42 deg behind (the clip arm in the
      // ground frame), and L3-F1-low's runner ragdoll arm is 47.3 deg behind against its twin's 63.1
      expect(on.worst.ragdoll.behind, id).toBeLessThan(off.worst.ragdoll.behind - 15);
      // past the tolerance only for a run shorter than the envelope's persistence limit
      expect(on.ragOverRunS, `${id} ${on.worst.ragdoll.at}`).toBeLessThan(FALLS_PERSIST_S);
      expect(on.worst.ragdoll.ex, `${id} ${on.worst.ragdoll.at}`).toBeLessThan(15);
    }
    // a standing pile: the twin's ragdoll arm goes past the cone, with the profile it is inside. Plan 13f: was HC-F1-low
    // (twin 13 deg past); under the leg guard, which the twin keeps, its twin stays 22.5 deg inside. L3-F10-bothMirror:
    // the twin's R right arm 9.9 deg past, the profile's 24.6 deg inside
    const on = await probe(FIX('L3-F10-bothMirror'));
    const off = await probe(twin(FIX('L3-F10-bothMirror')));
    expect(off.worst.ragdoll.ex).toBeGreaterThan(5);
    expect(on.worst.ragdoll.ex).toBeLessThanOrEqual(5);
  }, 240000);
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

  it('ragdoll feet: in range at conversion, relaxed to 15 deg within 1 deg 0.35 s later unless the limp shoe is held near another player', async () => {
    // the held cases (Simulation.shoeDeeper, listed in docs/handoff/plan12.md): the shoe would turn within 8 cm of another player
    const heldCases = new Set<string>();
    for (const id of ['L4-F3-forward-on', 'L4-F8-passive', 'HC-F1-low', 'HC-F1-lowMirror']) {
      const on = await probe(FIX(id));
      expect(on.feet.size, id).toBeGreaterThan(0);
      for (const [pid, c] of on.feet) {
        expect(c.late, `${id} ${pid}`).toBeTruthy();
        for (const side of SIDES) {
          const p = c.conv[side]!;
          expect(p, `${id} ${pid} ${side}`).toBeGreaterThanOrEqual(-J.ankle.dorsiDeg);
          expect(p, `${id} ${pid} ${side}`).toBeLessThanOrEqual(J.ankle.plantarDeg);
          if (c.held![side] > 0) heldCases.add(`${id} ${pid}.${side}`);
          else expect(Math.abs(c.late![side]! - J.limpFoot.pitchDeg), `${id} ${pid} ${side}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // (plan 13e: HC-F1-low D's right shoe is no longer held, on the L3 planner with the idle and walk clips: it relaxes
    // within 1 deg like the others. Plan 13f: under the leg guard D's left shoe is held, within 8 cm of R)
    // (contact motion M1: with the arms' twist in range HC-F1-low's shoes are no longer held, D's and R's left; its mirror's
    // runner holds its right shoe, within 8 cm of D)
    expect([...heldCases].sort()).toEqual(['HC-F1-lowMirror R.right']);
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
    // clip has them, so it no longer tells the guard from the fault)
    const CASES: [string, boolean, number][] = [['L3-F9-noProbe-contact', true, 0.01736]];
    await rows(
      CASES,
      ([id, rev]) => `${id}${rev ? ' reversed' : ''}`,
      async ([id, rev, beforeM]) => {
        const o = rev ? { reverseOrder: true } : {};
        const on = await handoffOf(FIX(id), o);
        expect(on.outcome, id).toBe('accepted');
        expect(on.newM, id).toBeLessThan(0.012);
        // the fault put back: the guard measuring other bodies where they are now only, and the twin without the profile.
        // Both also without the plan 10c deep push that contact motion M1 adds to L3 (it clears this case on its own)
        const noDeep = (d: FixtureDef): FixtureDef => ({ ...d, ragdoll: { ...d.ragdoll!, poseGuard: undefined } });
        for (const off of [await handoffOf(noDeep(FIX(id)), { ...o, debug: { pose: { noLegAhead: true } } }), await handoffOf(noDeep({ ...FIX(id), id: `${id}-noGuard`, legGuard: undefined }), o)]) {
          expect(off.outcome, id).toBe('rejected');
          expect(off.reasons, id).toContain('externalPenetration');
          expect(off.newM, id).toBeCloseTo(beforeM, 4);
        }
      },
    );
  }, 120000);
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
      const off = await twistRun(v1(FIX(id)));
      expect(Math.max(off.pose.over, off.pose.jump - tick - 1), `${id} twin ${off.pose.at} ${off.pose.jat}`).toBeGreaterThan(5);
    });
  }, 240000);

  it('arm-task arms stay inside the twist range; ragdolls start their shoulders less far outside it than the twins', async () => {
    await rows(['L3-F4-twoArm', 'HC-F3-phase0', 'L3-F6-hold', 'HC-F1-low', 'L4-F5-twoClamp-on'], (id) => id, async (id) => {
      const on = await twistRun(FIX(id));
      expect(on.armTask.over, `${id} ${on.armTask.at}`).toBeLessThanOrEqual(-2 + 0.5);
      const off = await twistRun(v1(FIX(id)));
      expect(on.startOutside, id).toBeLessThanOrEqual(off.startOutside + 1);
    });
  }, 240000);
});
