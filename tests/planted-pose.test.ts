import { beforeAll, describe, expect, it } from 'vitest';
import { buildProxyPose, CONT_FAST_MPS, CONT_L3_PLANT_MPS, CONT_L3_RADPS, footFrame, HARD_OK, poseLimbShapes, type FootRequest, type PhysicalPose, type PoseClearance, type PoseMemory, type PoseShape, type ProxyPoseInput } from '../src/sim/pose';
import { initPhysics, RAPIER } from '../src/sim/physics';
import { add, addScaled, dist, len, norm, qFromUnitVectors, qFromYaw, qRot, scale, sub, v3, vc, type Pose, type Quat, type Vec3 } from '../src/sim/vec';
import { FIX } from './helpers';

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
