import { beforeAll, describe, expect, it } from 'vitest';
import { buildProxyPose, CONT_FAST_MPS, CONT_L3_PLANT_MPS, CONT_L3_RADPS, footFrame, HARD_OK, plannedLeg, poseLimbShapes, type FootRequest, type PhysicalPose, type PoseClearance, type PoseMemory, type PoseShape, type ProxyPoseInput } from '../src/sim/pose';
import { initPhysics, RAPIER } from '../src/sim/physics';
import { add, addScaled, dist, len, norm, qFromUnitVectors, qFromYaw, qRot, scale, sub, v3, vc, type Pose, type Quat, type Vec3 } from '../src/sim/vec';
import { FIX } from './helpers';
import { plantAtShownFoot, STEPS_V1 } from '../src/sim/contact-steps';
import { groundOf, legHit, nearestFree, type FootQuery, type Part } from '../src/sim/free-ground';

// Ladder rung 7: the planted primary pose, knee-pole first (`LegGuardProfile.sweep`, the pose input `legSweep`). On
// constructed poses: one standing L3 body (yaw 0, its left leg at +x, the locomotion composition on, crouched so the
// knee is bent and a knee pole moves it), its left foot planted where the unobstructed plant puts it, fixed balls as the
// physical bodies. The fault twin is PoseDebug.noPlantedPole (the ordinary choice only). Bounds are the rules' own: the
// footwork plant tolerance, HARD_OK, the L3 pole rate and the continuity guard's fast step.
const def = FIX('L3-F9-convert-free');
const R = def.ragdoll!;
const I: Quat = { x: 0, y: 0, z: 0, w: 1 };
const DT = 1 / 240;
/** footwork's plant tolerance, passed on the plant request as footwork passes it */
const TOL = def.footwork!.plantTolM;
const soleUp = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
/** the primary leg's knee pole at heading 0 (LEG_ALTS[0]) and the first other one (LEG_POLES[0]: the knee turned inward) */
const PRIMARY_POLE = norm(v3(0, 0.2, 1));
const INWARD_POLE = norm(v3(-0.4, 0.2, 1));
const toRapier = (s: PoseShape): { shape: RAPIER.Shape; p: Vec3; q: Quat } => {
  if (s.kind === 'box') return { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), p: s.c, q: s.q };
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), p: s.c, q: I };
  const d = sub(s.b, s.a);
  const l = Math.max(len(d), 1e-9);
  return { shape: new RAPIER.Capsule(l / 2, s.r), p: addScaled(s.a, d, 0.5), q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) };
};
/** Fixed balls as the clearance (every query: external, legs, physical): the deepest contact per shape, its push-out. */
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
const at: Pose = { p: v3(0, 0.88, 0), q: qFromYaw(0) };
const input = (over: Partial<ProxyPoseInput>): ProxyPoseInput => ({ playerId: 'D', body: def.players[0].body, ragdoll: R, jointRange: def.jointRange, pose: at, gait: { phase: 0 }, speed: 0, ground: { y: 0, staggerM: 0, fixedGait: true }, loco: { profile: def.locomotion!, brakeB: 0, swing: 0, contactW: 0 }, ...over });
const leftLeg = (p: PhysicalPose): PoseShape[] => poseLimbShapes(R, p).filter((s) => /^left(Thigh|Shin|Shoe)$/.test(s.key));
const heelOf = (p: PhysicalPose): Vec3 => add(p.jointLandmarksWorld.leftAnkle, qRot(footFrame(p, 'left'), v3(0, -soleUp, 0)));
type Plant = FootRequest & { kind: 'plant' };

/** The left foot planted (rollF 0: the anchor is the heel point) where an unobstructed plant puts its heel. */
function standingPlant(): Plant {
  const req = (heelW: Vec3): Plant => ({ kind: 'plant', heelW, headingRad: 0, rollF: 0, toeZ: 0.12, tolM: TOL });
  const m: PoseMemory = {};
  buildProxyPose(input({ memory: m, dtS: DT }));
  let heel = heelOf(buildProxyPose(input({ memory: m, dtS: DT })));
  // (the standing leg's pitched heel is past the flat planted shoe's reach: the anchor moves to where the plant lands)
  for (let i = 0; i < 2; i++) heel = heelOf(buildProxyPose(input({ memory: {}, dtS: DT, feet: { left: req(heel) } })));
  return req(heel);
}

/** Footwork's plant test (observeFoot): the contact feature on the anchor across the ground and the shoe's lowest corner on it. */
function featureErr(p: PhysicalPose, f: Plant): number {
  const info = p.legInfo!.left!;
  const rf = info.rollF ?? f.rollF;
  const ex = info.edgeX ?? 0;
  const feat = add(p.jointLandmarksWorld.leftAnkle, qRot(footFrame(p, 'left'), v3(ex, -soleUp, f.toeZ * rf)));
  const anchor = addScaled(addScaled(f.heelW, v3(Math.sin(f.headingRad), 0, Math.cos(f.headingRad)), f.toeZ * rf), v3(Math.cos(f.headingRad), 0, -Math.sin(f.headingRad)), ex);
  const shoe = leftLeg(p).find((s) => s.key === 'leftShoe') as Extract<PoseShape, { kind: 'box' }>;
  let low = Infinity;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) low = Math.min(low, shoe.c.y + qRot(shoe.q, v3(a * shoe.he.x, b * shoe.he.y, c * shoe.he.z)).y);
  return Math.hypot(Math.hypot(feat.x - anchor.x, feat.z - anchor.z), low - f.heelW.y);
}

interface Step {
  /** the plant's legInfo variant (footwork releases a plant over its tolerance on a variant other than 0) */
  variant: number;
  /** the chosen placement (pose memory): 0 the primary, alts.length + j (10 + j) the primary at knee pole LEG_POLES[j] */
  index: number;
  err: number;
  /** the shown leg's depth in the balls */
  depth: number;
  /** the shown knee pole (body frame, unit) */
  pole: Vec3;
}

/** Poses at DT with the plant: `free` unobstructed, then `n` with the balls, then `after` unobstructed again. */
function run(plant: Plant, balls: { c: Vec3; r: number }[], o: { fault?: boolean; free?: number; n?: number; after?: number } = {}): Step[] {
  const m: PoseMemory = {};
  const out: Step[] = [];
  const cl0 = ballsClearance([]);
  const cl = ballsClearance(balls);
  const free = o.free ?? 4;
  const n = o.n ?? 40;
  for (let i = 0; i < free + n + (o.after ?? 0); i++) {
    const c = i < free || i >= free + n ? cl0 : cl;
    const p = buildProxyPose(input({ memory: m, dtS: DT, clearance: c, legSweep: true, feet: { left: plant }, ...(o.fault ? { debug: { noPlantedPole: true } } : {}) }));
    out.push({ variant: p.legInfo!.left!.variant, index: m.leftLeg, err: featureErr(p, plant), depth: cl.external(leftLeg(p)), pole: norm(v3(m['leftLeg:p:x'], m['leftLeg:p:y'], m['leftLeg:p:z'])) });
  }
  return out;
}

describe('rung 7: the planted primary pose, knee-pole first (constructed poses, rung 7 on and its fault twin)', () => {
  const FREE = 4;
  let plant: Plant;
  let knee: Vec3;
  beforeAll(async () => {
    await initPhysics();
    plant = standingPlant();
    const m: PoseMemory = {};
    buildProxyPose(input({ memory: m, dtS: DT, legSweep: true, feet: { left: plant } }));
    knee = buildProxyPose(input({ memory: m, dtS: DT, legSweep: true, feet: { left: plant } })).jointLandmarksWorld.leftKnee;
  });
  // a ball (6 cm) against the outside of the planted leg's knee: the primary leg in it past HARD_OK, the knee turned
  // inward (LEG_POLES[0]) about the planted foot clear of it
  const kneeBall = () => [{ c: add(knee, v3(0.12, 0, 0)), r: 0.06 }];

  it('(i) an obstructed planted leg keeps its anchor at another knee pole; the twin takes an offset and the plant is released', () => {
    const on = run(plant, kneeBall());
    const off = run(plant, kneeBall(), { fault: true });
    // unobstructed, the plant is kept on the primary; obstructed where it stands, the primary leg is past HARD_OK
    for (const x of on.slice(0, FREE)) expect([x.variant, x.index, x.err <= TOL]).toEqual([0, 0, true]);
    expect(on[FREE - 1].depth).toBeGreaterThan(HARD_OK);
    // rung 7: the primary at the inward knee pole from the first obstructed pose on, kept (the primary is not clear at
    // its own knee); the foot on its anchor within the plant tolerance; the shown leg within the step rule (no deeper
    // than HARD_OK or where it started), clear at the end
    for (const [i, x] of on.slice(FREE).entries()) {
      expect([x.variant, x.index, x.err <= TOL], `pose ${i}`).toEqual([0, 10, true]);
      expect(x.depth, `pose ${i}`).toBeLessThanOrEqual(Math.max(HARD_OK, on[FREE - 1].depth) + 1e-9);
    }
    expect(on[on.length - 1].depth).toBeLessThanOrEqual(1e-4);
    expect(dist(on[on.length - 1].pole, INWARD_POLE)).toBeLessThan(1e-6);
    // the twin: an offset (a clearance variant) from the first obstructed pose on, the feature off the anchor past the
    // tolerance at once and further on: footwork releases the plant
    for (const [i, x] of off.slice(FREE).entries()) expect(x.variant, `pose ${i}`).not.toBe(0);
    expect(off[FREE].err).toBeGreaterThan(TOL);
    expect(off[off.length - 1].err).toBeGreaterThan(5 * TOL);
  });

  it('(ii) no valid planted pose (the anchored shoe in the body): the plant is released, rung 7 or not', () => {
    // a ball (4 cm) on the planted shoe's toe: the shoe is where the anchor puts it at every knee pole
    const shoeBall = [{ c: add(plant.heelW, v3(0, 0.03, 0.14)), r: 0.04 }];
    const on = run(plant, shoeBall);
    const off = run(plant, shoeBall, { fault: true });
    expect(on[FREE - 1].depth).toBeGreaterThan(HARD_OK);
    for (const [i, x] of on.slice(FREE).entries()) expect(x.variant, `pose ${i}`).not.toBe(0);
    expect(Math.max(...on.slice(FREE).map((x) => x.err))).toBeGreaterThan(TOL);
    // the ordinary choice, as without rung 7
    expect(on).toEqual(off);
  });

  it('(iii) continuity across the pole change: the knee turns at the L3 pole rate (one guard fast step first), the plant kept; back on the primary once it is clear', () => {
    const rate = CONT_L3_RADPS * DT + 1e-9;
    // the continuity guard (plan 07a): when the rate step is not valid, the smallest valid step up to the fast bound
    const fast = (CONT_FAST_MPS / CONT_L3_PLANT_MPS) * CONT_L3_RADPS * DT + 1e-9;
    const N = 40;
    const AFTER = 40;
    const on = run(plant, kneeBall(), { n: N, after: AFTER });
    const chord = on.map((x, i) => (i ? dist(x.pole, on[i - 1].pole) : 0));
    for (const [i, x] of on.entries()) expect(x.err, `pose ${i}`).toBeLessThanOrEqual(TOL);
    // to the knee pole: the first obstructed pose's step within the fast bound, every later one within the rate
    expect(chord[FREE]).toBeLessThanOrEqual(fast);
    for (let i = FREE + 1; i < on.length; i++) expect(chord[i], `pose ${i}`).toBeLessThanOrEqual(rate);
    expect(dist(on[FREE + N - 1].pole, INWARD_POLE)).toBeLessThan(1e-6);
    // with the ball gone the primary is clear at its own knee and wins back: the knee turns back to the primary's pole
    for (const [i, x] of on.slice(FREE + N).entries()) expect([x.variant, x.index], `pose ${i}`).toEqual([0, 0]);
    expect(dist(on[on.length - 1].pole, PRIMARY_POLE)).toBeLessThan(1e-6);
  });
});

// Plan 15 (contact footwork): free ground judges a place by the whole leg standing on it (pose.ts plannedLeg, the leg
// this solve gives a plant request), so a step the model picks beside another player is one the leg guard keeps. On
// the same constructed pose as rung 7, the other player's knee and thigh as fixed balls, judged by free ground and by the
// guard alike. The fault twin is free ground by the footprints only (step 2's free ground).
describe('plan 15: a plant the model picks beside another player is kept by the leg guard (constructed pose)', () => {
  beforeAll(initPhysics);
  it('his knee reaching in front of the leg at the height of the shin top: the plant on free ground stands, primary and on its anchor; the twin (footprints only) is moved by the guard', () => {
    const M = STEPS_V1;
    const balls = [{ c: v3(0.16, 0.5, 0.36), r: 0.07 }, { c: v3(0.16, 0.6, 0.46), r: 0.08 }];
    const ground = groundOf(balls.map((b): Part => ({ shape: { kind: 'ball', c: b.c, r: b.r }, v: v3(), key: 'B:knee' })), soleUp + R.lengths.shin);
    const hip = buildProxyPose(input({ memory: {}, dtS: DT })).jointLandmarksWorld.leftHip;
    // the model's ask (contact-steps.ts aimOf, standing still, heading 0): at the shoe centre, its want 0.3 m ahead of the hip
    const c = v3(0, 0, R.shoe.forwardM);
    const want = v3(hip.x, soleUp, hip.z + 0.3);
    const leg = { at: (p: Vec3) => plannedLeg(R, 'left', hip, v3(p.x - c.x, soleUp, p.z - c.z), 0), skinM: M.legSkinM };
    const pick = (q: FootQuery): Plant => {
      const f = nearestFree(ground, add(want, c), add(hip, c), M.maxStepM, 0, q)!;
      return { kind: 'plant', heelW: v3(f.x - c.x, 0, f.z - c.z), headingRad: 0, rollF: 0, toeZ: 0.12, tolM: TOL };
    };
    // the guard moved it: another variant, another placement than the primary, or the foot off its anchor past the tolerance
    const moved = (plant: Plant): number => {
      const m: PoseMemory = {};
      const cl = ballsClearance(balls);
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const p = buildProxyPose(input({ memory: m, dtS: DT, clearance: cl, legSweep: true, feet: { left: plant } }));
        if (p.legInfo!.left!.variant !== 0 || m.leftLeg !== 0 || featureErr(p, plant) > TOL) n++;
      }
      return n;
    };
    expect(moved(pick({ clearM: M.footR, leg }))).toBe(0);
    // fault twin: footprints only: only the bottom of his knee comes below the shin top, so the foot is put where its
    // footprint clears him, the leg standing there through his knee
    const blind = pick({ clearM: M.footR });
    expect(legHit(ground, leg.at(add(v3(blind.heelW.x, soleUp, blind.heelW.z), c)), 0, 0)!.gap).toBeLessThan(-0.02);
    expect(moved(blind)).toBeGreaterThan(20);
  });
});

// Plan 15 round 3: the contact stepping model's feet are shown where the model asks (FootBlend.exact): it stands a plant
// only where the leg can stand and answers a body coming into it by stepping, so the leg guard never moves a model
// foot. On the same constructed pose as rung 7, a ball (a knee or a shin of another player) coming into the planted
// leg, and one standing in a swing's path. The fault twin is the same request without `exact` (the guard on).
describe('plan 15: a model foot is shown where the model asks: the guard never moves it (constructed pose)', () => {
  beforeAll(initPhysics);
  it('a body coming into a planted leg never moves the shown foot off its anchor; the twin (the guard on) takes the foot off it', () => {
    const plant = { ...standingPlant(), exact: true };
    const m0: PoseMemory = {};
    buildProxyPose(input({ memory: m0, dtS: DT, legSweep: true, feet: { left: plant } }));
    const p0 = buildProxyPose(input({ memory: m0, dtS: DT, legSweep: true, feet: { left: plant } }));
    const shinMid = scale(add(p0.jointLandmarksWorld.leftKnee, p0.jointLandmarksWorld.leftAnkle), 0.5);
    // the ball comes in from 0.3 m in front of the shin to 2 cm in front of its axis over 60 substeps (1.1 m/s), then stays
    const ballAt = (i: number) => [{ c: add(shinMid, v3(0, 0, 0.3 - 0.28 * Math.min(1, i / 60))), r: 0.07 }];
    const errs = (f: Plant): { err: number; depth: number }[] => {
      const m: PoseMemory = {};
      const out: { err: number; depth: number }[] = [];
      for (let i = 0; i < 100; i++) {
        const cl = ballsClearance(ballAt(i));
        const p = buildProxyPose(input({ memory: m, dtS: DT, clearance: cl, legSweep: true, feet: { left: f } }));
        out.push({ err: featureErr(p, f), depth: cl.external(leftLeg(p)) });
      }
      return out;
    };
    const on = errs(plant);
    // (the premise: the ball ends in the leg past HARD_OK)
    expect(on[on.length - 1].depth).toBeGreaterThan(HARD_OK);
    for (const [i, x] of on.entries()) expect(x.err, `pose ${i}`).toBeLessThanOrEqual(TOL);
    // fault twin: the guard on (no `exact`): it moves the foot off its anchor past the plant tolerance
    const { exact: _, ...guarded } = plant;
    expect(Math.max(...errs(guarded).map((x) => x.err))).toBeGreaterThan(TOL);
  });

  it('a swing passing a body follows its path: the shown ankle is the asked one; the twin (the guard on) holds it off', () => {
    // the left foot swung forward 0.5 m in 0.25 s, 6 cm up, past a ball standing in its path at ankle height
    const plant = standingPlant();
    const start = add(plant.heelW, v3(0, soleUp, -0.25));
    const path = (i: number): Vec3 => add(start, v3(0, 0.06 * Math.sin((Math.PI * i) / 60), (0.5 * i) / 60));
    const balls = [{ c: add(start, v3(0, 0.02, 0.25)), r: 0.06 }];
    // how far the shown ankle is from the asked one across the ground (m), the largest over the swing
    const off = (exact: boolean): number => {
      const m: PoseMemory = {};
      const cl = ballsClearance(balls);
      let worst = 0;
      for (let i = 0; i <= 60; i++) {
        const want = path(i);
        const p = buildProxyPose(input({ memory: m, dtS: DT, clearance: cl, legSweep: true, feet: { left: { kind: 'target', ankleW: want, headingRad: 0, ...(exact ? { exact } : {}) } } }));
        const a = p.jointLandmarksWorld.leftAnkle;
        worst = Math.max(worst, Math.hypot(a.x - want.x, a.z - want.z));
      }
      return worst;
    };
    // (across the ground: the floor lift is not the guard, and the leg's soft reach at the end of the swing is millimetres)
    expect(off(true)).toBeLessThanOrEqual(0.005);
    expect(off(false)).toBeGreaterThan(0.03);
  });

  it('a step\'s plant is taken at the foot as shown: the shoe does not move when the plant begins; the twin (flat under the ankle) settles', () => {
    // the left foot swung 0.2 m forward and 0.15 m out over 50 substeps, down onto the ground (the leg out to the side, so
    // the shoe touches down rolled on its edge), then planted
    const plant0 = standingPlant();
    const start = add(plant0.heelW, v3(0, soleUp, 0));
    const toeZ = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
    const shoeCorners = (p: PhysicalPose): Vec3[] => {
      const b = leftLeg(p).find((x) => x.key === 'leftShoe') as Extract<PoseShape, { kind: 'box' }>;
      return [-1, 1].flatMap((a) => [-1, 1].flatMap((c) => [-1, 1].map((d) => add(b.c, qRot(b.q, v3(a * b.he.x, c * b.he.y, d * b.he.z))))));
    };
    // how far any shoe corner moves from the touchdown over the 30 substeps after it (m)
    const moved = (flat: boolean): number => {
      const m: PoseMemory = {};
      let p: PhysicalPose | null = null;
      for (let i = 1; i <= 50; i++) {
        // (a minimum-jerk path, at rest at touchdown, as the model's)
        const u = i / 50;
        const k = u * u * u * (10 - 15 * u + 6 * u * u);
        const want = add(start, v3(0.15 * k, 0.07 * Math.sin(Math.PI * k) ** 2, 0.2 * k));
        p = buildProxyPose(input({ memory: m, dtS: DT, legSweep: true, feet: { left: { kind: 'target', ankleW: want, headingRad: 0, exact: true } } }));
      }
      const ankle = p!.jointLandmarksWorld.leftAnkle;
      const at = plantAtShownFoot(ankle, footFrame(p!, 'left'), 0, 0, soleUp, toeZ, { he: R.shoe.halfExtents, centerFoot: v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM) });
      const pl: Plant = flat ? { kind: 'plant', heelW: v3(ankle.x, 0, ankle.z), headingRad: 0, rollF: 0, toeZ, tolM: TOL, exact: true } : { kind: 'plant', heelW: at.heelW, headingRad: 0, rollF: at.rollF, toeZ, edgeX: at.edgeX, tolM: TOL, exact: true };
      const c0 = shoeCorners(p!);
      let worst = 0;
      for (let i = 0; i < 30; i++) {
        const q = buildProxyPose(input({ memory: m, dtS: DT, legSweep: true, feet: { left: pl } }));
        worst = Math.max(worst, ...shoeCorners(q).map((c, j) => dist(c, c0[j])));
      }
      return worst;
    };
    // (within the plant tolerance: the leg solve's own plant, its contact point on the anchor within it)
    expect(moved(false)).toBeLessThanOrEqual(TOL);
    expect(moved(true)).toBeGreaterThan(0.03);
  });
});
