// Plan 07 (L2): support recovery and contact footwork. The carry-forward repairs (bounded load-release recovery, the
// one-arm hinge contract, the loaded-player baseline), the per-foot plant / swing planner (stance, loaded contact,
// travel and stopping, drag, side travel and yaw, airborne, hip displacement, support loss, IK singularities, supplied
// running, slow fallback, reproducibility) and the enabled-vs-disabled physics invariance.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import * as L2 from '../src/sim/fixtures/footwork';
import { rhf4Load, rhf6 } from '../src/sim/fixtures/ride-height';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import type { FixtureDef } from '../src/sim/fixture';
import type { ArmSide, SimEvent } from '../src/sim/contracts';
import { DEFAULT_MOTOR, RAGDOLL_G4, SUSPENSION_L2, SUSPENSION_L2_BRAKE, SUSPENSION_RH, withBrakingLimit, type SuspensionSupport } from '../src/sim/profiles';
import { computeDrive } from '../src/sim/motors';
import { advanceBraking, advanceStance, brakingDemand, composeTarget, newSuspensionRuntime, suspensionForce, suspensionGains } from '../src/sim/support';
import { FOOTWORK_L2, initFeet, newFootPlan, observeFeet, planFeet, type FootEvent, type FootPlan, type FootPlanInput } from '../src/sim/footwork';
import { buildProxyPose, flexReach, footFrame, hingeChain, legRequestLocal, legShapes, maxFlexRad, twoBone, type FootRequest, type PhysicalPose, type PoseShape, type ProxyPoseInput } from '../src/sim/pose';
import { RunClipError, validateRunClipProfile } from '../src/sim/run-clip';
import { bodyG4 } from '../src/sim/fixtures/gate4';
import { add, dist, dot, len, qFromYaw, qRot, sub, v3, type Vec3 } from '../src/sim/vec';
import { run } from './helpers';

const G = 9.81;
const SIDES: ArmSide[] = ['left', 'right'];
const FIX = (id: string): FixtureDef => {
  const f = allFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};
const lowest = (shapes: PoseShape[]): number => {
  let y = Infinity;
  for (const s of shapes) if (s.kind === 'box') for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, s.c.y + qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z)).y);
  return y;
};
const footEvents = (sim: Simulation, id: string, side?: ArmSide): SimEvent[] =>
  sim.events.filter((e) => e.playerId === id && e.type.startsWith('foot') && (!side || e.data?.side === side));

/** Per-tick foot samples of one player (last substep of each tick) plus the plan's running extremes. */
interface FootRun {
  sim: Simulation;
  ticks: {
    t: number;
    supported: boolean;
    rag: boolean;
    p: Vec3;
    v: Vec3;
    feet: Record<ArmSide, { mode: string; source: string; drag: boolean; anchor: Vec3 | null; heel: Vec3 | null; err: number; ankle: Vec3; target: Vec3; heelLift: number }>;
    /** Lowest thigh/shin capsule point above the turf (m; negative = below). */
    legClear: number;
    supH: number;
    lenErr: number;
    kneeMin: number;
    kneeMax: number;
    pen: number;
    sep: number;
  }[];
}
async function runFeet(def: FixtureDef, id = def.players[0].id): Promise<FootRun> {
  const sim = await Simulation.create(def);
  const R = def.ragdoll ?? RAGDOLL_G4;
  const ticks: FootRun['ticks'] = [];
  const pl = (): PlayerRuntime => sim.players.find((p) => p.id === id)!;
  while (!sim.done) {
    sim.stepTick();
    const P = pl();
    if (P.rag || !P.pose || !P.feet) {
      ticks.push({ t: sim.t, supported: false, rag: !!P.rag, p: v3(NaN, NaN, NaN), v: v3(), feet: null as never, lenErr: 0, kneeMin: 0, kneeMax: 0, pen: 0, sep: 0, legClear: 0, supH: NaN });
      continue;
    }
    const lm = P.pose.jointLandmarksWorld;
    let lenErr = 0;
    let pen = 0;
    let kneeMin = Infinity;
    let kneeMax = -Infinity;
    let legClear = Infinity;
    const feet = {} as FootRun['ticks'][number]['feet'];
    for (const s of SIDES) {
      lenErr = Math.max(lenErr, Math.abs(dist(lm[`${s}Hip`], lm[`${s}Knee`]) - R.lengths.thigh), Math.abs(dist(lm[`${s}Knee`], lm[`${s}Ankle`]) - R.lengths.shin));
      kneeMin = Math.min(kneeMin, P.pose.hingeDeg[`${s}Knee`]);
      kneeMax = Math.max(kneeMax, P.pose.hingeDeg[`${s}Knee`]);
      const gy = P.sus?.probe.groundY ?? 0;
      const shapes = legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], P.pose.segments[`${s}Shin`].rotationWorld, footFrame(P.pose, s));
      pen = Math.max(pen, gy - lowest(shapes));
      for (const sh of shapes) if (sh.kind === 'capsule') legClear = Math.min(legClear, Math.min(sh.a.y, sh.b.y) - sh.r - gy);
      // heel lift: the shoe's rear sole edge (lower of its two corners) above the turf
      const shoe = shapes.find((sh) => sh.kind === 'box') as Extract<PoseShape, { kind: 'box' }>;
      let heelY = Infinity;
      for (const sx of [-1, 1]) heelY = Math.min(heelY, shoe.c.y + qRot(shoe.q, v3(sx * shoe.he.x, -shoe.he.y, -shoe.he.z)).y);
      const f = P.feet.feet[s];
      feet[s] = { mode: f.mode, source: f.source, drag: f.drag, anchor: f.anchorW ? { ...f.anchorW } : null, heel: f.heelW ? { ...f.heelW } : null, err: f.featureErrM, ankle: { ...f.ankleW }, target: { ...f.target }, heelLift: heelY - gy };
    }
    // lateral separation of the ankles in the body frame (right side positive): legs never cross
    const right = qRot(P.pose.segments.core.rotationWorld, v3(P.body.measured?.rightSignX ?? 1, 0, 0));
    const sep = dot(sub(lm.rightAnkle, lm.leftAnkle), right);
    const b = P.proxy.body;
    ticks.push({ t: sim.t, supported: P.controlMode === 'supported' && !!P.sus?.probe.valid, rag: false, p: { ...b.translation() }, v: { ...b.linvel() }, feet, lenErr, kneeMin, kneeMax, pen, sep, legClear, supH: P.sus?.probe.heightM ?? NaN });
  }
  return { sim, ticks };
}
/**
 * Confirmed plant intervals of one player from its foot events (footPlant .. footRelease, or the trial end from the
 * plan state). Sustained: survived at least one solve after its confirmation. driftM: largest contact-feature error over
 * the interval including the releasing sample; releaseErrM: the releasing sample's error.
 */
interface PlantInterval {
  side: ArmSide;
  t0: number;
  t1: number;
  open: boolean;
  solves: number;
  sustained: boolean;
  plantErrM: number;
  driftM: number;
  releaseErrM: number;
  reason: string | null;
}
function plantIntervals(sim: Simulation, id: string): PlantInterval[] {
  const out: PlantInterval[] = [];
  const open: Partial<Record<ArmSide, PlantInterval>> = {};
  for (const e of footEvents(sim, id)) {
    const s = e.data!.side as ArmSide;
    if (e.type === 'footPlant') {
      expect(open[s], `${id} ${s} plant at ${e.t} while planted`).toBeUndefined();
      open[s] = { side: s, t0: e.t, t1: NaN, open: true, solves: 0, sustained: false, plantErrM: e.data!.errM as number, driftM: e.data!.errM as number, releaseErrM: NaN, reason: null };
    } else if (e.type === 'footRelease') {
      const iv = open[s];
      expect(iv, `${id} ${s} release at ${e.t} without a confirmed plant`).toBeDefined();
      Object.assign(iv!, { t1: e.t, open: false, solves: e.data!.solves as number, sustained: (e.data!.solves as number) >= 1, driftM: e.data!.driftM as number, releaseErrM: e.data!.featureErrM as number, reason: String(e.data!.reason) });
      out.push(iv!);
      delete open[s];
    }
  }
  const pl = sim.players.find((p) => p.id === id)!;
  for (const s of SIDES) {
    const iv = open[s];
    if (!iv) continue;
    const f = pl.feet!.feet[s];
    Object.assign(iv, { t1: sim.t, solves: f.solves, sustained: f.solves >= 1, driftM: f.driftM });
    out.push(iv);
  }
  return out;
}
/** Per-foot coverage of eligible stance time by confirmed plants (0..1; NaN without eligible time). */
const coverage = (sim: Simulation, id: string, s: ArmSide): number => {
  const c = sim.players.find((p) => p.id === id)!.feet!.stats.cover[s];
  return c.eligibleS > 0 ? c.plantedS / c.eligibleS : NaN;
};
const quant = (xs: number[]): string => {
  const a = [...xs].sort((x, y) => x - y);
  const q = (f: number): string => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(3) : '-');
  return `n ${a.length} min ${q(0)} med ${q(0.5)} max ${a.length ? a[a.length - 1].toFixed(3) : '-'} s`;
};
/** Interval and proposal report of one player (durations per foot, coverage, error at the release, failed proposals). */
function plantReport(sim: Simulation, id: string): string {
  const iv = plantIntervals(sim, id);
  const st = sim.players.find((p) => p.id === id)!.feet!.stats;
  const per = SIDES.map((s) => `${s} sustained ${quant(iv.filter((x) => x.side === s && x.sustained).map((x) => x.t1 - x.t0))}, eligible stance planted ${(100 * coverage(sim, id, s)).toFixed(0)}%`);
  const rel = iv.filter((x) => !x.open).map((x) => x.releaseErrM);
  return `proposals ${st.attempts}, confirmed ${st.confirmed}, failed ${st.failed} (max measured error ${(st.failedErrM * 100).toFixed(2)} cm), sustained ${st.sustained}; ${per.join('; ')}; held error max ${(st.plantErrM * 100).toFixed(2)} cm, release-sample error max ${rel.length ? (Math.max(...rel) * 100).toFixed(2) : '-'} cm`;
}
/** Horizontal displacement of each completed planner step (touchdown anchor minus the previous anchor of that foot). */
function stepMoves(sim: Simulation, id: string, side: ArmSide, fromS = 0): Vec3[] {
  const out: Vec3[] = [];
  let last: Vec3 | null = null;
  for (const e of footEvents(sim, id, side)) {
    if (e.type !== 'footPlant') continue;
    const a = e.data!.at as number[];
    const p = v3(a[0], 0, a[2]);
    if (last && e.t >= fromS) out.push(sub(p, last));
    last = p;
  }
  return out;
}

// ------------------------------------------------------------------------------------------- carry-forward repairs
describe('L2 repair 1: bounded load-release recovery (support)', () => {
  it('profile identity: SUSPENSION_L2 = SUSPENSION_RH plus the recovery bound; normal tracking is bit-identical', () => {
    expect(SUSPENSION_L2.id).toBe('support-suspension-rh-v2');
    expect({ ...SUSPENSION_L2, id: SUSPENSION_RH.id, recovery: undefined }).toEqual({ ...SUSPENSION_RH, recovery: undefined });
    expect(SUSPENSION_RH.recovery).toBeUndefined();
    const m = 100;
    const { k, c } = suspensionGains(SUSPENSION_L2, m);
    const eMax = 2 * SUSPENSION_L2.recovery!.approachBrakeG * G * (c / k) ** 2;
    expect(eMax).toBeGreaterThan(0.012);
    for (const e of [-0.2, -0.01, 0, 0.005, 0.0125])
      for (const v of [-1, 0, 0.5])
        expect(suspensionForce(SUSPENSION_L2, m, -G, 0.89 - e, v, 0.89, 0.1, 0.3)).toEqual({ ...suspensionForce(SUSPENSION_RH, m, -G, 0.89 - e, v, 0.89, 0.1, 0.3) });
  });
  it('the bound: approach speed v_t + sqrt(2 a_b e) below the target; push-only and capped; stateless', () => {
    const m = 100;
    const { c } = suspensionGains(SUSPENSION_L2, m);
    for (const e of [0.05, 0.2, 0.45]) {
      const f = suspensionForce(SUSPENSION_L2, m, -G, 0.89 - e, 0, 0.89, 0, 0);
      const lim = Math.sqrt(2 * 0.5 * G * e);
      expect(f.approachLimitMps).toBeCloseTo(lim, 12);
      expect(f.commandedN).toBeCloseTo(m * G + c * lim, 9);
      expect(f.appliedN).toBeGreaterThanOrEqual(0);
      expect(f.appliedN).toBeLessThanOrEqual(SUSPENSION_L2.maxForceBW * m * G + 1e-9);
      // moving up faster than the bound: the support removes force (down to zero), it never pulls
      const fast = suspensionForce(SUSPENSION_L2, m, -G, 0.89 - e, 10, 0.89, 0, 0);
      expect(fast.appliedN).toBe(0);
      expect(fast.saturated).toBe('zero');
    }
  });
  it('L2-F13: release after compression peaks <= 0.05 m above the standing request, stays in travel, settles within 1 s', async () => {
    const report: string[] = [];
    for (const def of L2.loadReleaseFixtures().filter((d) => d.diagnostics?.forces?.length)) {
      const sim = await Simulation.create(def);
      const S = def.support!.kind === 'suspension' ? def.support : null;
      const H = S!.standingHeightM;
      const rel = def.diagnostics!.forces![0].toS;
      let peak = -Infinity;
      let invalidAfter = 0;
      let bottomed = 0;
      let saturated = 0;
      const hs: { t: number; h: number }[] = [];
      while (!sim.done) {
        sim.stepTick();
        const u = sim.players[0].sus!;
        if (sim.t <= rel + 1e-9) {
          if (u.bottomed) bottomed++;
          if (u.saturated === 'max') saturated++;
          continue;
        }
        if (!u.probe.valid) invalidAfter++;
        peak = Math.max(peak, u.probe.heightM);
        hs.push({ t: sim.t, h: u.probe.heightM });
      }
      let settle = NaN;
      for (let i = hs.length - 1; i >= 0 && Math.abs(hs[i].h - H) <= 0.01; i--) settle = hs[i].t - rel;
      report.push(`${def.id}: peak +${(peak - H).toFixed(4)} m, settle ${settle.toFixed(3)} s, out of travel ${invalidAfter} ticks, compressed: saturated ${saturated} / bottomed ${bottomed} ticks`);
      expect(peak - H, def.id).toBeLessThanOrEqual(0.05);
      expect(invalidAfter, def.id).toBe(0);
      expect(settle, def.id).toBeLessThanOrEqual(1);
      // still overloadable: the 2.6-3.4 kN loads exceed the ceiling (saturated); held for 0.5 s or longer they reach the
      // bump stop (the 0.2 s load is released mid-descent)
      expect(saturated, def.id).toBeGreaterThan(0);
      const f = def.diagnostics!.forces![0];
      if (f.toS - f.fromS >= 0.5) expect(bottomed, def.id).toBeGreaterThan(0);
      sim.dispose();
    }
    // incoming baseline (06a profile): the same request rebounds beyond travel
    const base = await run(rhf4Load());
    const H = SUSPENSION_RH.standingHeightM;
    const peak06a = Math.max(...base.trace.filter((r) => r.t > 1).map((r) => r.players.R.sup!.h ?? -Infinity));
    report.push(`RH-F4-load (06a incoming): peak +${(peak06a - H).toFixed(4)} m`);
    expect(peak06a - H).toBeGreaterThan(0.2);
    base.dispose();
    console.log(`[L2-F13]\n  ${report.join('\n  ')}`);
  });
  it('L2-F13 kicks: an imparted upward impulse may leave travel (zero authority outside it); the downward kick recovers', async () => {
    const up = await run(FIX('L2-F13-kickUp'));
    const outside = up.trace.filter((r) => r.players.R.sup && r.players.R.sup.ok === 0);
    for (const r of outside) {
      expect(r.players.R.sup!.F).toBe(0);
      expect(r.players.R.sup!.a).toBe(0);
    }
    const down = await run(FIX('L2-F13-kickDown'));
    const H = SUSPENSION_L2.standingHeightM;
    const hs = down.trace.filter((r) => r.t > 0.3).map((r) => r.players.R.sup!.h!);
    expect(Math.max(...hs) - H).toBeLessThanOrEqual(0.05);
    expect(Math.abs(hs[hs.length - 1] - H)).toBeLessThanOrEqual(0.01);
    up.dispose();
    down.dispose();
  });
});

describe('L2 repair 2: one-arm defender hinge contract (L2-F14)', () => {
  it('cause reproduced: an unbounded two-bone solve folds past the knee limit; minReach bounds it at the hinge limit', () => {
    const R = RAGDOLL_G4;
    const a = R.lengths.thigh;
    const b = R.lengths.shin;
    const hip = v3(0, 0.5, 0);
    const target = v3(0, 0.5 - 0.05, 0.02); // a deep fold (ankle 5 cm from the hip)
    const pole = v3(0, 0, 1);
    const straight = (R.validation.straightBendDeg * Math.PI) / 180;
    const flexDeg = (end: Vec3, mid: Vec3): number => (hingeChain(hip, mid, [end], [v3(0, 0, -1), v3(0, -1, 0)], straight).angleRad * 180) / Math.PI;
    const free = twoBone(hip, target, a, b, pole);
    expect(flexDeg(free.end, free.mid)).toBeGreaterThan(R.limitsDeg.knee[1]);
    const minR = flexReach(a, b, maxFlexRad(R, 'knee'));
    const bounded = twoBone(hip, target, a, b, pole, undefined, minR);
    const k = flexDeg(bounded.end, bounded.mid);
    expect(k).toBeLessThanOrEqual(R.limitsDeg.knee[1]);
    expect(k).toBeGreaterThan(R.limitsDeg.knee[1] - 1);
    expect(Math.abs(dist(hip, bounded.mid) - a)).toBeLessThan(1e-9);
    expect(Math.abs(dist(bounded.mid, bounded.end) - b)).toBeLessThan(1e-9);
  });
  it('the late defender conversion is a valid handoff (RH-F6-oneArm and L2-F14); a genuinely bad candidate stays rejected', async () => {
    for (const def of [rhf6().find((d) => d.id === 'RH-F6-oneArm')!, L2.l2f14OneArm()]) {
      const sim = await run(def);
      for (const p of sim.players) {
        expect(p.handoff?.outcome, `${def.id} ${p.id}`).toBe('accepted');
        expect(p.handoff?.report.hingeOk).toBe(true);
      }
      sim.dispose();
    }
    const bad = await run(FIX('L2-F8-noRescue'));
    expect(bad.players[0].handoff?.outcome).toBe('rejected');
    expect(bad.players[0].handoff?.report.reasons).toContain('jointAnchor');
    expect(bad.players[0].controlMode).toBe('falling');
    bad.dispose();
  });
});

describe('L2 repair 3: loaded player and outcome baseline (L2-F15)', () => {
  it('B carries A within its finite support; A never gets support from B; a separate above-capacity load overcomes B', async () => {
    const sim = await run(L2.l2f15PlayerBelow());
    const A = sim.trace.map((r) => r.players.A);
    const B = sim.trace.map((r) => r.players.B);
    // A: obstructed by B or falling, never supported by a player
    for (const r of A) if (r.sup) expect(r.sup.F, 'A support').toBe(0);
    expect(B.every((r) => r.mode === 'supported')).toBe(true);
    expect(B.some((r) => r.sup!.sat === 2)).toBe(true);
    sim.dispose();
    const over = await run(L2.l2f15Overload());
    const Bo = over.trace.map((r) => r.players.B).filter((r) => r.sup);
    expect(Bo.filter((r) => r.sup!.sat === 2).length).toBeGreaterThan(B.filter((r) => r.sup!.sat === 2).length);
    expect(Bo.some((r) => r.sup!.bot === 1)).toBe(true);
    over.dispose();
  });
});

// ------------------------------------------------------------------------------------------- foot planner
describe('L2 foot planner: stance, contact and stopping', () => {
  it('L2-F1 neutral / staggered / crouched stance: planted at the calibrated sole height, no marching, intended bend', async () => {
    for (const id of ['L2-F1-stand', 'L2-F1-stagger', 'L2-F1-crouch']) {
      const r = await runFeet(FIX(id));
      const steps = footEvents(r.sim, 'R').filter((e) => e.type === 'footSwing' && e.data!.source === 'step');
      // stance changes take at most one settle step per foot
      expect(steps.length, id).toBeLessThanOrEqual(id === 'L2-F1-stand' ? 0 : 4);
      const last = r.ticks[r.ticks.length - 1];
      for (const s of SIDES) {
        expect(last.feet[s].mode, `${id} ${s}`).toBe('planted');
        // sole on the ground: the planted heel anchor at ground height, the ankle one flat-shoe height above it
        expect(last.feet[s].heel!.y).toBeCloseTo(r.sim.players[0].sus!.probe.groundY, 6);
      }
      expect(Math.max(...r.ticks.map((t) => t.lenErr)), id).toBeLessThanOrEqual(0.001);
      expect(Math.max(...r.ticks.map((t) => t.kneeMax)), id).toBeLessThanOrEqual(150);
      expect(Math.min(...r.ticks.map((t) => t.kneeMin)), id).toBeGreaterThan(20);
      expect(Math.max(...r.ticks.map((t) => t.pen)), id).toBeLessThanOrEqual(0.01);
      // heels stay down on planted feet (crouch and the staggered back foot included); legs clear of the turf
      const lift = Math.max(...r.ticks.filter((t) => t.feet).flatMap((t) => SIDES.filter((s) => t.feet[s].mode === 'planted').map((s) => t.feet[s].heelLift)));
      expect(lift, `${id} heel lift`).toBeLessThanOrEqual(0.01);
      expect(Math.min(...r.ticks.filter((t) => t.feet).map((t) => t.legClear)), `${id} leg clearance`).toBeGreaterThanOrEqual(-0.01);
      // planted contact features stay reachable (feature error inside the plant tolerance)
      expect(Math.max(...r.ticks.filter((t) => t.feet).flatMap((t) => SIDES.filter((s) => t.feet[s].mode === 'planted').map((s) => t.feet[s].err))), id).toBeLessThanOrEqual(0.01);
      if (id === 'L2-F1-crouch') {
        // stance levels: ready 0.89, intermediate 0.80, crouch 0.72 (support height reached within 1 cm)
        const at = (a: number, b: number): number[] => r.ticks.filter((t) => t.t > a && t.t <= b).map((t) => t.supH);
        expect(Math.abs(Math.max(...at(1.3, 1.5)) - 0.8)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(Math.min(...at(2.5, 3.0)) - 0.72)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(at(2.5, 3.0)[at(2.5, 3.0).length - 1] - 0.72)).toBeLessThanOrEqual(0.01);
      }
      r.sim.dispose();
    }
  });
  it('L2-F1 crouch handoff: a labelled conversion in the held 0.72 m crouch is accepted by the unchanged audit', async () => {
    const r = await runFeet(FIX('L2-F1-crouchHandoff'));
    const ev = r.sim.events.filter((e) => e.playerId === 'R');
    expect(ev.some((e) => e.type === 'handoffRejected')).toBe(false);
    const rep = ev.find((e) => e.type === 'representation');
    expect(rep?.t).toBeCloseTo(1.5, 6);
    expect((rep!.data as { audit: { ok: boolean } }).audit.ok).toBe(true);
    const before = r.ticks.filter((t) => t.t <= 1.5 && t.t > 1.3);
    expect(Math.abs(before[before.length - 1].supH - 0.72)).toBeLessThanOrEqual(0.01);
    expect(Math.max(...r.ticks.map((t) => t.kneeMax))).toBeLessThanOrEqual(150);
    r.sim.dispose();
  });
  it('L2-F2 stationary loaded contact for 3 s: no steps, valid plants throughout', async () => {
    const r = await runFeet(FIX('L2-F2-loaded'));
    expect(footEvents(r.sim, 'R').filter((e) => e.type !== 'footPlant')).toEqual([]);
    for (const t of r.ticks) for (const s of SIDES) expect(t.feet[s].mode).toBe('planted');
    expect(r.sim.players[0].feet!.stats.plantErrM).toBeLessThanOrEqual(0.01);
    // a controlled reachable stance: both initial proposals confirmed, sustained, the whole eligible stance time planted
    const st = r.sim.players[0].feet!.stats;
    expect([st.attempts, st.confirmed, st.failed, st.sustained]).toEqual([2, 2, 0, 2]);
    for (const s of SIDES) expect(coverage(r.sim, 'R', s), s).toBe(1);
    r.sim.dispose();
  });
  it('L2-F3 slow travel and supplied run, then stop: steps follow actual braking travel, then settle (no endless marching)', async () => {
    for (const [id, dir] of [['L2-F3-walkStop', v3(0, 0, 1)], ['L2-F3-runStop', v3(1, 0, 0)]] as const) {
      const r = await runFeet(FIX(id));
      for (const s of SIDES) for (const m of stepMoves(r.sim, 'R', s)) expect(dot(m, dir), `${id} ${s} step direction`).toBeGreaterThan(-0.02);
      // settled: the body stopped and both feet planted for the last 0.7 s, no further swings
      const tEnd = r.ticks[r.ticks.length - 1].t;
      const tail = r.ticks.filter((t) => t.t >= tEnd - 0.7);
      for (const t of tail) {
        expect(Math.hypot(t.v.x, t.v.z), id).toBeLessThan(0.15);
        for (const s of SIDES) expect(t.feet[s].mode, `${id} ${s}`).toBe('planted');
      }
      // the planted anchors persisted while valid (drift <= 0.01 m)
      expect(r.sim.players[0].feet!.stats.plantErrM, id).toBeLessThanOrEqual(0.01);
      r.sim.dispose();
    }
  });
  it('L2-F3 run-to-stop: valid clip stance plants during the run and plants persist through the clip fade', async () => {
    const r = await runFeet(FIX('L2-F3-runStop'));
    const ev = footEvents(r.sim, 'R');
    // sustained clip stance intervals while running (not raw touchdown events)
    const clipPlants = plantIntervals(r.sim, 'R').filter((x) => x.sustained && x.t0 > 1.0 && x.t0 < 2.6);
    expect(clipPlants.length).toBeGreaterThanOrEqual(4);
    // releases carry a reason; no clamped target is reported as planted; none in its confirmation substep
    for (const e of ev.filter((x) => x.type === 'footRelease')) {
      expect(['liftoff', 'reach', 'step', 'settle', 'yaw', 'clearance', 'separation', 'slide']).toContain(e.data!.reason);
      expect(e.data!.plantedS as number).toBeGreaterThan(0);
    }
    for (const s of SIDES) expect(coverage(r.sim, 'R', s), s).toBeGreaterThan(0);
    console.log(`[L2-F3-runStop] ${plantReport(r.sim, 'R')}`);
    r.sim.dispose();
  });
});

describe('L2 braking limit (user, 2026-11-05): locomotion fixtures brake at most 5.5 m/s^2', () => {
  const M = { ...DEFAULT_MOTOR };
  const intent = (vx: number, effort = 1) => ({ desiredVelocityWorld: v3(vx, 0, 0), desiredFacingWorld: v3(1, 0, 0), effort });
  it('computeDrive caps only the component against the actual travel; absent the limit the drive is unchanged', () => {
    const B = withBrakingLimit(M, 5.5);
    expect(B.id).toBe('motor-g1-default+brake-5.5');
    // braking from 6 m/s to rest: full drive would be min(100 kg x 6 / 0.25, 1400) = 1400 N; the limit is 550 N
    const d = computeDrive(intent(0), v3(6, 0, 0), 100, B, true);
    expect(d.force.x).toBeCloseTo(-550, 6);
    expect(d.saturated).toBe(true);
    expect(computeDrive(intent(0), v3(6, 0, 0), 100, M, true).force.x).toBeCloseTo(-1400, 6);
    // accelerating along the travel: untouched by the limit
    const a = computeDrive(intent(6), v3(2, 0, 0), 100, B, true);
    expect(a.force).toEqual(computeDrive(intent(6), v3(2, 0, 0), 100, M, true).force);
    // turning at speed: the lateral component is kept, only the opposing part is capped
    const t = computeDrive(intent(0), v3(6, 0, 0), 100, B, true);
    const turn = computeDrive({ desiredVelocityWorld: v3(0, 0, 6), desiredFacingWorld: v3(0, 0, 1), effort: 1 }, v3(6, 0, 0), 100, B, true);
    expect(turn.force.x).toBeGreaterThanOrEqual(-550 - 1e-9);
    expect(turn.force.z).toBeGreaterThan(0);
    expect(t.force.z).toBe(0);
  });
  it('opt-in: L2 locomotion fixtures use the braking motor; RH, tackle copies and support repairs keep theirs', () => {
    for (const d of allFixtures()) {
      // L2-F3-runStopHard: the same run stopped by the original motor (plan 07 item 3 regression), deliberately unbraked
      const loco = /^L2-F(1|2|3|4|5|6|7|11|12)-/.test(d.id) && d.id !== 'L2-F3-runStopHard';
      const ms = [d.motor, ...d.players.map((p) => p.motor).filter((m) => m !== undefined)];
      for (const m of ms) expect(!!m!.braking, `${d.id} ${m!.id}`).toBe(loco);
    }
  });
  it('L2-F3-runStop: a 6 m/s run takes over 1.2 s and over 2.5 m to stop, peak deceleration within the limit, several braking steps', async () => {
    const r = await runFeet(FIX('L2-F3-runStop'));
    const i0 = r.ticks.findIndex((t) => t.t >= 2.6);
    const i1 = r.ticks.findIndex((t, i) => i > i0 && Math.hypot(t.v.x, t.v.z) < 0.05);
    expect(i1).toBeGreaterThan(i0);
    const w = Math.round(0.1 / r.sim.tickS);
    let peak = 0;
    for (let i = i0; i + w < i1; i++) peak = Math.max(peak, (Math.hypot(r.ticks[i].v.x, r.ticks[i].v.z) - Math.hypot(r.ticks[i + w].v.x, r.ticks[i + w].v.z)) / (w * r.sim.tickS));
    expect(peak).toBeLessThanOrEqual(5.5 + 0.3);
    expect(r.ticks[i1].t - r.ticks[i0].t).toBeGreaterThan(1.2);
    expect(r.ticks[i1].p.x - r.ticks[i0].p.x).toBeGreaterThan(2.5);
    // sustained plant intervals that start while braking (not raw touchdown events)
    const plants = plantIntervals(r.sim, 'R').filter((x) => x.sustained && x.t0 >= r.ticks[i0].t && x.t0 <= r.ticks[i1].t + 0.3);
    expect(plants.length).toBeGreaterThanOrEqual(4);
    r.sim.dispose();
  });
});

describe('L2 foot planner: drag, side travel, yaw, airborne, displacement, support loss', () => {
  it('L2-F4 backward drag while requesting forward: steps go backward (no forward treadmill)', async () => {
    const r = await runFeet(FIX('L2-F4-drag'));
    expect(r.ticks[r.ticks.length - 1].p.z).toBeLessThan(-0.5);
    // the body moves backward from about 0.6 s (it was drifting forward at the requested 0.3 m/s before the pull)
    const tBack = r.ticks.find((t) => t.t > 0.5 && t.v.z < -0.1)!.t;
    let n = 0;
    for (const s of SIDES)
      for (const m of stepMoves(r.sim, 'R', s, tBack + FOOTWORK_L2.swing.maxS)) {
        n++;
        expect(m.z, `${s} step`).toBeLessThan(0.02);
      }
    expect(n).toBeGreaterThanOrEqual(4);
    r.sim.dispose();
  });
  it('L2-F5 side travel and yaw are mirrored; no crossed legs, no knee flip, no indefinite swivel', async () => {
    const pos = await runFeet(FIX('L2-F5-sidePosX'));
    const neg = await runFeet(FIX('L2-F5-sideNegX'));
    // the same sequence of plants with the sides swapped, at matching times (within 20 ms: float rounding of the mirrored
    // solve can move a reach trigger by a substep or two)
    const seq = (sim: Simulation, mirror: boolean): { t: number; s: string }[] =>
      footEvents(sim, 'R')
        .filter((e) => e.type === 'footPlant')
        .map((e) => ({ t: e.t, s: mirror ? (e.data!.side === 'left' ? 'right' : 'left') : String(e.data!.side) }))
        .sort((a, b) => a.t - b.t || a.s.localeCompare(b.s));
    const sp = seq(pos.sim, false);
    const sn = seq(neg.sim, true);
    expect(sn.map((x) => x.s)).toEqual(sp.map((x) => x.s));
    for (let i = 0; i < sp.length; i++) expect(Math.abs(sn[i].t - sp[i].t)).toBeLessThanOrEqual(0.02);
    expect(sp.length).toBeGreaterThanOrEqual(8);
    for (const r of [pos, neg]) {
      expect(Math.min(...r.ticks.map((t) => t.sep))).toBeGreaterThan(FOOTWORK_L2.minSeparationM - 0.02);
      expect(Math.min(...r.ticks.map((t) => t.kneeMin))).toBeGreaterThan(20);
      r.sim.dispose();
    }
    for (const id of ['L2-F5-yawPosX', 'L2-F5-yawNegX']) {
      const r = await runFeet(FIX(id));
      const steps = footEvents(r.sim, 'R').filter((e) => e.type === 'footSwing' && e.data!.source === 'step');
      expect(steps.length, id).toBeGreaterThanOrEqual(2);
      expect(steps.length, id).toBeLessThanOrEqual(4);
      expect(steps.every((e) => e.t < 1.5), id).toBe(true);
      const last = r.sim.players[0].feet!.feet;
      const yaw = Math.atan2(qRot(r.sim.players[0].pose!.segments.core.rotationWorld, v3(0, 0, 1)).x, qRot(r.sim.players[0].pose!.segments.core.rotationWorld, v3(0, 0, 1)).z);
      for (const s of SIDES) expect(Math.abs(Math.atan2(Math.sin(last[s].headingRad - yaw), Math.cos(last[s].headingRad - yaw)))).toBeLessThan((FOOTWORK_L2.yawTriggerDeg * Math.PI) / 180);
      r.sim.dispose();
    }
  });
  it('sideways travel leads with the travel-side foot, alternates lead and trail, and never lifts both feet at once', async () => {
    for (const id of ['L2-F5-sidePosX', 'L2-F5-sideNegX', 'L2-F12-slowSide', 'L2-F7-shove']) {
      const r = await runFeet(FIX(id));
      const steps = footEvents(r.sim, 'R').filter((e) => e.type === 'footSwing' && e.data!.source === 'step');
      expect(steps.length, id).toBeGreaterThanOrEqual(3);
      // the travel-side foot: the one whose initial anchor lies toward the travel (world x here)
      const x0 = r.ticks[0].feet;
      const dir = Math.sign(r.ticks[r.ticks.length - 1].p.x - r.ticks[0].p.x);
      const lead = Math.sign(x0.left.anchor!.x) === dir ? 'left' : 'right';
      expect(steps[0].data!.side, `${id} first step`).toBe(lead);
      for (let i = 1; i < steps.length; i++) expect(steps[i].data!.side, `${id} step ${i} at ${steps[i].t}`).not.toBe(steps[i - 1].data!.side);
      // a foot forced off its anchor while the other is in the air drags on the turf: no tick with both feet lifted
      const both = r.ticks.filter((t) => t.feet && SIDES.every((s) => t.feet[s].mode === 'swing' && !t.feet[s].drag));
      expect(both.length, `${id} both feet lifted`).toBe(0);
      r.sim.dispose();
    }
  });
  it('L2-F6 one planted / one swinging, then both airborne: anchors released, no plant while unsupported, no instant reset', async () => {
    const r = await runFeet(FIX('L2-F6-hop'));
    const unsup = r.ticks.filter((t) => !t.supported);
    expect(unsup.length).toBeGreaterThan(5);
    for (const t of unsup) for (const s of SIDES) expect(t.feet[s].mode).toBe('airborne');
    const ev = footEvents(r.sim, 'R');
    const tLost = unsup[0].t;
    const tBack = r.ticks.find((t) => t.t > tLost && t.supported)!.t;
    expect(ev.some((e) => e.type === 'footPlant' && e.t > tLost - 1e-9 && e.t < tBack - 1e-9)).toBe(false);
    // support regained: the feet swing to a plant (bounded), they are not snapped to the ground at once
    const firstPlant = ev.find((e) => e.type === 'footPlant' && e.t >= tBack)!;
    expect(firstPlant.t - tBack).toBeGreaterThanOrEqual(FOOTWORK_L2.swing.minS - 0.02);
    r.sim.dispose();
  });
  it('L2-F7 sudden hip displacement: the anchor is released with an explicit reason; the pose stays finite and valid', async () => {
    const r = await runFeet(FIX('L2-F7-shove'));
    const rel = footEvents(r.sim, 'R').filter((e) => e.type === 'footRelease' && e.t > 1.0 && e.t < 1.3);
    expect(rel.length).toBeGreaterThanOrEqual(1);
    for (const e of rel) expect(['reach', 'step', 'yaw', 'clearance', 'separation', 'slide']).toContain(e.data!.reason);
    expect(r.ticks.every((t) => Number.isFinite(t.lenErr) && t.lenErr <= 0.001)).toBe(true);
    r.sim.dispose();
  });
  it('L2-F8 support loss and falling: no plants without support; ragdoll releases every anchor', async () => {
    for (const id of ['L2-F8-noRescue', 'L2-F8-sideLoss', 'L2-F8-outOfRange']) {
      const sim = await run(FIX(id));
      for (const pl of sim.players) {
        if (!pl.feet) continue;
        const ev = footEvents(sim, pl.id);
        const rows = sim.trace.map((t) => ({ t: t.t, r: t.players[pl.id] }));
        // every plant happens while the player is supported with a valid probe
        for (const e of ev.filter((x) => x.type === 'footPlant')) {
          const row = rows.find((x) => x.t >= e.t - 1e-9)!;
          expect(row.r.mode, `${id} ${pl.id} plant at ${e.t}`).toBe('supported');
        }
        if (pl.rag) for (const s of SIDES) expect(pl.feet.feet[s].mode).toBe('airborne');
        if (pl.controlMode === 'falling') expect(ev.some((e) => e.type === 'footSwing' && e.data!.mode === 'airborne')).toBe(true);
      }
      sim.dispose();
    }
  });
});

describe('L2-F9 IK singularities and the foot request path', () => {
  const R = RAGDOLL_G4;
  const a = R.lengths.thigh;
  const b = R.lengths.shin;
  const hip = v3(0.1, 0.9, 0);
  const minR = flexReach(a, b, maxFlexRad(R, 'knee'));
  const finite = (p: Vec3): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  it('zero distance, full extension, an extreme target and a pole along the limb give finite fixed-length solves', () => {
    for (const [target, pole] of [
      [hip, v3(0, 0, 1)],
      [v3(0.1, 0.9 - (a + b), 0), v3(0, 0, 1)],
      [v3(40, -30, 25), v3(0, 0, 1)],
      [v3(0.1, 0.2, 0), v3(0, -1, 0)],
    ] as [Vec3, Vec3][]) {
      const r = twoBone(hip, target, a, b, pole, undefined, minR);
      expect(finite(r.mid) && finite(r.end)).toBe(true);
      expect(Math.abs(dist(hip, r.mid) - a)).toBeLessThan(1e-9);
      expect(Math.abs(dist(r.mid, r.end) - b)).toBeLessThan(1e-9);
      const d = dist(hip, r.end);
      expect(d).toBeGreaterThanOrEqual(minR - 1e-9);
      expect(d).toBeLessThanOrEqual(a + b);
    }
  });
  it('plant requests far outside reach and turned 180 deg: finite pose, knee within limits, residual recorded', () => {
    const body = FIX('L2-F1-stand').players[0].body;
    const core = { p: v3(0, 0.89, 0), q: qFromYaw(0) };
    const base: ProxyPoseInput = {
      playerId: 'R',
      body,
      ragdoll: R,
      pose: core,
      gait: { phase: 0 },
      speed: 0,
      ground: { y: 0, staggerM: 0, fixedGait: true },
    };
    for (const [heel, heading] of [
      [v3(1.5, 0, 0), 0],
      [v3(0.1, 0, 0.05), Math.PI],
      [v3(0.1, 0, -0.9), Math.PI / 2],
    ] as [Vec3, number][]) {
      const pose = buildProxyPose({ ...base, feet: { left: { kind: 'plant', heelW: heel, headingRad: heading, rollF: 0, toeZ: 0.12 }, right: { kind: 'offset', offsetW: v3() } } });
      for (const k of Object.values(pose.jointLandmarksWorld)) expect(finite(k)).toBe(true);
      expect(pose.hingeDeg.leftKnee).toBeGreaterThanOrEqual(0);
      expect(pose.hingeDeg.leftKnee).toBeLessThanOrEqual(150);
      expect(pose.targetResidualM!.leftLeg).toBeGreaterThanOrEqual(0);
      expect(pose.legInfo!.left).toBeDefined();
    }
  });
  it('procedural fallback steps along actual travel (moonwalk fix) and stands on the calibrated sole', () => {
    const body = bodyG4();
    const core = { p: v3(0, 0.89, 0), q: qFromYaw(0) };
    const at = (phase: number, fixedGait: boolean): Vec3 =>
      legRequestLocal({ playerId: 'R', body, ragdoll: R, pose: core, gait: { phase }, speed: 1.5, localVelDir: v3(0, 0, 1), ground: { y: 0, staggerM: 0, fixedGait } }, 'left');
    // the left foot swings while sin(phase) > 0: with the fixed gait it moves from behind the hip to ahead of it
    const fixedA = at(0.1, true);
    const fixedB = at(Math.PI - 0.1, true);
    expect(fixedB.z).toBeGreaterThan(fixedA.z);
    const legacyA = at(0.1, false);
    const legacyB = at(Math.PI - 0.1, false);
    expect(legacyB.z).toBeLessThan(legacyA.z);
    // standing (zero speed): the ankle target sits one flat-shoe height above the ground
    const stand = legRequestLocal({ playerId: 'R', body, ragdoll: R, pose: core, gait: { phase: 0 }, speed: 0, ground: { y: 0, staggerM: 0, fixedGait: true } }, 'left');
    expect(core.p.y + stand.y).toBeCloseTo(R.shoe.belowAnkleM + R.shoe.halfExtents.y, 9);
  });
});

describe('L2-F10 reproducibility and L2-F11/F12 running and slow fallback', () => {
  it('render rates, pause and reset give the same planner trace and events; no duplicate touchdown or liftoff', async () => {
    for (const def of [FIX('L2-F3-walkStop'), FIX('L2-F11-fastRun')]) {
      const byRate = async (hz: number, pauseEvery = 0) => {
        const s = await Simulation.create(def);
        const drv = new FixedStepDriver(def.solver.outerTickS, 8);
        let f = 0;
        while (!s.done) {
          f++;
          drv.paused = pauseEvery > 0 && f % pauseEvery < 3;
          for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
        }
        return s;
      };
      const a = await byRate(30);
      const b = await byRate(144);
      const p = await byRate(60, 7);
      const ref = JSON.stringify([a.trace, a.events]);
      expect(a.trace.some((r) => r.players.R.ft)).toBe(true);
      expect(JSON.stringify([b.trace, b.events])).toBe(ref);
      expect(JSON.stringify([p.trace, p.events])).toBe(ref);
      const c = await Simulation.create(def);
      while (c.t < 0.9 - 1e-9 && !c.done) c.stepTick();
      c.reset();
      c.runToEnd();
      expect(JSON.stringify([c.trace, c.events])).toBe(ref);
      // a confirmed plant is never released in its confirmation substep; failed proposals are not plants
      for (const e of a.events.filter((x) => x.type === 'footRelease')) expect(e.data!.plantedS as number, `${def.id} release at ${e.t}`).toBeGreaterThan(0);
      // per foot: a plant is always followed by its release before the next plant (no duplicate touchdown/liftoff)
      for (const s of SIDES) {
        let planted = a.events.some((e) => e.type === 'footPlant' && e.data!.side === s && e.tick === 0);
        for (const e of footEvents(a, 'R', s).filter((x) => x.tick > 0)) {
          if (e.type === 'footPlant') {
            expect(planted, `${def.id} ${s} plant at ${e.t}`).toBe(false);
            planted = true;
          } else if (e.type === 'footRelease') {
            expect(planted, `${def.id} ${s} release at ${e.t}`).toBe(true);
            planted = false;
          }
        }
      }
      for (const s of [a, b, p, c]) s.dispose();
    }
  });
  it('L2-F11 Fast Run / Sprint: clip stance plants persist only while feasible; releases explicit; residuals recorded', async () => {
    const report: string[] = [];
    for (const id of ['L2-F11-fastRun', 'L2-F11-sprint']) {
      const r = await runFeet(FIX(id));
      const ev = footEvents(r.sim, 'R');
      const iv = plantIntervals(r.sim, 'R');
      const plants = iv.filter((x) => x.sustained).length;
      const why: Record<string, number> = {};
      for (const e of ev.filter((x) => x.type === 'footRelease')) why[String(e.data!.reason)] = (why[String(e.data!.reason)] ?? 0) + 1;
      // sustained intervals (confirmed and surviving a later solve), not touchdown events
      expect(plants, id).toBeGreaterThanOrEqual(6);
      for (const x of iv) {
        // confirmed from the achieved solve; no confirmed plant released in its confirmation substep
        expect(x.plantErrM, `${id} ${x.side} ${x.t0}`).toBeLessThanOrEqual(0.01);
        if (!x.open) expect(x.t1 - x.t0, `${id} ${x.side} ${x.t0}`).toBeGreaterThan(0);
      }
      // the error of every sample that kept a plant is within the contract; the releasing sample is reported
      expect(r.sim.players[0].feet!.stats.plantErrM, id).toBeLessThanOrEqual(0.01);
      for (const s of SIDES) expect(coverage(r.sim, 'R', s), `${id} ${s}`).toBeGreaterThan(0);
      expect(Math.max(...r.ticks.map((t) => t.pen)), id).toBeLessThanOrEqual(0.01);
      expect(Math.max(...r.ticks.map((t) => t.lenErr)), id).toBeLessThanOrEqual(0.001);
      const st = r.sim.players[0].feet!.stats;
      expect(st.offsetDecayMps, id).toBeLessThanOrEqual(FOOTWORK_L2.rejoinMps + 1e-9);
      report.push(`${id}: ${plantReport(r.sim, 'R')}; releases ${JSON.stringify(why)}, max residual ${Math.max(...r.sim.trace.map((t) => Math.max(...Object.values(t.players.R.run?.res ?? { x: 0 })))).toFixed(4)} m`);
      r.sim.dispose();
    }
    console.log(`[L2-F11]\n  ${report.join('\n  ')}`);
  });
  it('L2-F12 slow forward / side / backward fallback: steps along the actual travel, swing and lift rates inside their caps', async () => {
    for (const [id, dir] of [['L2-F12-slowForward', v3(0, 0, 1)], ['L2-F12-slowSide', v3(1, 0, 0)], ['L2-F12-slowBack', v3(0, 0, -1)]] as const) {
      const r = await runFeet(FIX(id));
      let n = 0;
      for (const s of SIDES)
        for (const m of stepMoves(r.sim, 'R', s)) {
          n++;
          expect(dot(m, dir), `${id} ${s}`).toBeGreaterThan(0);
          expect(len(sub(m, v3(dir.x * dot(m, dir), 0, dir.z * dot(m, dir)))), `${id} ${s} sideways drift`).toBeLessThan(0.12);
        }
      expect(n, id).toBeGreaterThanOrEqual(6);
      const st = r.sim.players[0].feet!.stats;
      expect(st.stepCapMarginMps, id).toBeGreaterThanOrEqual(-1e-9);
      expect(st.liftRateMps, id).toBeLessThanOrEqual(FOOTWORK_L2.swing.maxLiftRateMps + 1e-9);
      expect(Math.max(...r.ticks.map((t) => t.pen)), id).toBeLessThanOrEqual(0.01);
      r.sim.dispose();
    }
  });
});

describe('L2 limb continuity (ground-relative poses): no limb snapping in contact', () => {
  /** Largest one-tick second difference (m) of a knee/ankle/elbow/wrist landmark in the body frame, proxies only. */
  async function worstSnap(id: string): Promise<{ worst: number; at: string }> {
    const sim = await Simulation.create(FIX(id));
    const J = ['leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle', 'leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'];
    const hist: Record<string, Record<string, Vec3>[]> = {};
    let worst = 0;
    let at = '';
    while (!sim.done) {
      sim.stepTick();
      for (const pl of sim.players) {
        if (pl.rag || !pl.pose) continue;
        const b = pl.proxy.body;
        const q = b.rotation();
        const qi = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
        const o = b.translation();
        const cur: Record<string, Vec3> = {};
        for (const n of J) cur[n] = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
        const h = (hist[pl.id] ??= []);
        h.push(cur);
        if (h.length < 3) continue;
        const [a, m] = [h[h.length - 3], h[h.length - 2]];
        for (const n of J) {
          const d2 = len(v3(cur[n].x - 2 * m[n].x + a[n].x, cur[n].y - 2 * m[n].y + a[n].y, cur[n].z - 2 * m[n].z + a[n].z));
          if (d2 > worst) [worst, at] = [d2, `${pl.id} ${n} ${sim.t.toFixed(3)}`];
        }
      }
    }
    sim.dispose();
    return { worst, at };
  }
  it('contact fixtures: no limb landmark jumps over 0.3 m in one tick (was up to 1.1 m: alternative switches, folded falling legs)', async () => {
    for (const id of ['L2-F14-oneArm', 'L2-F14-oneArmFeet', 'RH-F6-oneArm', 'RH-F6-twoArm', 'RH-F6-simultaneous', 'RH-F6-failed']) {
      const r = await worstSnap(id);
      expect(r.worst, `${id} ${r.at}`).toBeLessThanOrEqual(0.3);
    }
  });
  it('legacy body-relative poses (no support profile) keep no continuity state', async () => {
    const sim = await Simulation.create(FIX('G4-F3-oneArm'));
    while (!sim.done) sim.stepTick();
    for (const pl of sim.players) expect(Object.keys(pl.poseMemory).filter((k) => k.includes(':')), pl.id).toEqual([]);
    sim.dispose();
  });
});

describe('L2 run-clip stance width (look tuning, opt-in)', () => {
  it('stanceWidthAddM widens the planted clip stance by about twice the value; absent it is bit-identical', async () => {
    const def = FIX('L2-F11-sprint');
    const plantsLat = async (d: FixtureDef) => {
      const sim = await Simulation.create(d);
      while (!sim.done) sim.stepTick();
      const z = sim.events.filter((e) => e.type === 'footPlant' && e.t > 1).map((e) => ({ s: e.data!.side as string, z: (e.data!.at as number[])[2] }));
      const tr = JSON.stringify(sim.trace);
      sim.dispose();
      const m = (s: string) => z.filter((p) => p.s === s).reduce((a, p) => a + p.z, 0) / Math.max(1, z.filter((p) => p.s === s).length);
      return { sep: Math.abs(m('left') - m('right')), n: z.length, tr };
    };
    const a = await plantsLat(def);
    const b = await plantsLat({ ...def, runClips: { ...def.runClips!, id: `${def.runClips!.id}+w`, stanceWidthAddM: { 'fast-run': 0, sprint: 0.04 } } });
    const c = await plantsLat({ ...def, runClips: { ...def.runClips! } });
    expect(a.n).toBeGreaterThan(2);
    expect(b.sep - a.sep).toBeGreaterThan(0.06);
    expect(b.sep - a.sep).toBeLessThan(0.1);
    expect(c.tr).toBe(a.tr);
  });
});

describe('L2 footwork never changes physics', () => {
  it('enabled vs disabled: identical root motion, forces and decisions until the first conversion; differences reported', async () => {
    const report: string[] = [];
    for (const id of ['L2-F1-stagger', 'L2-F3-runStop', 'L2-F4-drag', 'L2-F6-hop', 'L2-F14-oneArmFeet']) {
      const def = FIX(id);
      const go = async (d: FixtureDef) => {
        const sim = await Simulation.create(d);
        const rows: string[] = [];
        let conv = -1;
        while (!sim.done) {
          sim.stepTick();
          if (conv < 0 && sim.players.some((p) => p.rag || p.handoff)) conv = sim.tick;
          rows.push(
            sim.players
              .map((p) => {
                if (p.rag) return 'rag';
                const b = p.proxy.body;
                return JSON.stringify([b.translation(), b.rotation(), b.linvel(), b.angvel(), p.sus?.appliedN, p.controlMode, p.grounded, p.applied]);
              })
              .join('|'),
          );
        }
        return { sim, rows, conv };
      };
      const on = await go(def);
      const off = await go({ ...def, footwork: undefined });
      expect(on.conv, id).toBe(off.conv);
      const until = on.conv >= 0 ? on.conv - 1 : on.rows.length;
      expect(on.rows.slice(0, until), id).toEqual(off.rows.slice(0, until));
      const outcome = (s: Simulation) => `${s.result}; ${s.players.map((p) => `${p.id} ${p.handoff ? `${p.handoff.outcome}@${p.handoff.t.toFixed(3)}${p.handoff.report.reasons.length ? `(${p.handoff.report.reasons.join(',')})` : ''}` : 'no handoff'}`).join(', ')}`;
      report.push(`${id}: identical for ${until} ticks${on.conv >= 0 ? ` (to the conversion at tick ${on.conv})` : ''}; on: ${outcome(on.sim)}; off: ${outcome(off.sim)}`);
      on.sim.dispose();
      off.sim.dispose();
    }
    console.log(`[L2 invariance]\n  ${report.join('\n  ')}`);
  });
  it('every footwork fixture: fixed limb lengths, knee limits, shoe penetration <= 0.01 m and swing caps', async () => {
    for (const def of L2.footworkFixtures().filter((d) => d.footwork && !d.obstacles?.length)) {
      for (const pl of def.players) {
        const r = await runFeet(def, pl.id);
        const live = r.ticks.filter((t) => !t.rag && t.feet);
        expect(Math.max(...live.map((t) => t.lenErr)), `${def.id} ${pl.id}`).toBeLessThanOrEqual(0.001);
        expect(Math.max(...live.map((t) => t.kneeMax)), `${def.id} ${pl.id}`).toBeLessThanOrEqual(150);
        expect(Math.min(...live.map((t) => t.kneeMin)), `${def.id} ${pl.id}`).toBeGreaterThanOrEqual(0);
        expect(Math.max(...live.filter((t) => t.supported).map((t) => t.pen)), `${def.id} ${pl.id}`).toBeLessThanOrEqual(0.01);
        const st = r.sim.players.find((p) => p.id === pl.id)!.feet!.stats;
        expect(st.stepCapMarginMps, `${def.id} ${pl.id}`).toBeGreaterThanOrEqual(-1e-9);
        expect(st.liftRateMps, `${def.id} ${pl.id}`).toBeLessThanOrEqual(FOOTWORK_L2.swing.maxLiftRateMps + 1e-9);
        expect(st.offsetDecayMps, `${def.id} ${pl.id}`).toBeLessThanOrEqual(FOOTWORK_L2.rejoinMps + 1e-9);
        expect(st.plantErrM, `${def.id} ${pl.id}`).toBeLessThanOrEqual(0.01);
        // plants are confirmed from the achieved solve: none is released in its confirmation substep, every confirmed
        // plant's error is within the contract, failed proposals never emit a plant or release
        const ev = footEvents(r.sim, pl.id);
        for (const e of ev.filter((x) => x.type === 'footRelease')) expect(e.data!.plantedS as number, `${def.id} ${pl.id} release at ${e.t}`).toBeGreaterThan(0);
        for (const e of ev.filter((x) => x.type === 'footPlant')) expect(e.data!.errM as number, `${def.id} ${pl.id} plant at ${e.t}`).toBeLessThanOrEqual(0.01);
        expect(ev.filter((x) => x.type === 'footPlant').length, `${def.id} ${pl.id}`).toBe(st.confirmed);
        expect(ev.filter((x) => x.type === 'footPlantFailed').length, `${def.id} ${pl.id}`).toBe(st.failed);
        expect(st.confirmed + st.failed, `${def.id} ${pl.id}`).toBeLessThanOrEqual(st.attempts);
        plantIntervals(r.sim, pl.id);
        r.sim.dispose();
      }
    }
  });
});

// ------------------------------------------------------------------------------------------- review closeout
// ------------------------------------------------------------------ synthetic planner substeps (no physics)
const R = RAGDOLL_G4;
const SOLE = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
const TOE = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
const DT = 1 / 240;
const I = { x: 0, y: 0, z: 0, w: 1 };
const HOME = { left: v3(-0.12, SOLE, 0), right: v3(0.12, SOLE, 0) };
/** Synthetic planner input: still body, hips above the homes (hipY above the ankle), optional per-side home shift. */
const input = (t: number, o: { hipY?: number; supported?: boolean; clip?: FootPlanInput['clip']; dz?: Partial<Record<ArmSide, number>> } = {}): FootPlanInput => {
  const hipUp = o.hipY ?? 0.7;
  const home = {} as Record<ArmSide, Vec3>;
  const hips = {} as Record<ArmSide, Vec3>;
  for (const s of SIDES) {
    home[s] = add(HOME[s], v3(0, 0, o.dz?.[s] ?? 0));
    hips[s] = add(home[s], v3(0, hipUp, 0));
  }
  return {
    t,
    dt: DT,
    core: { p: v3(0, SOLE + hipUp + 0.1, 0), q: I },
    vel: v3(),
    yawRate: 0,
    supported: o.supported ?? true,
    falling: false,
    ragdoll: false,
    groundY: 0,
    hips,
    home,
    request: { left: { ...home.left }, right: { ...home.right } },
    clip: o.clip ?? null,
    soleM: SOLE,
    toeM: TOE,
    rightW: v3(1, 0, 0),
    sideSign: { left: -1, right: 1 },
  };
};
/** Synthetic achieved pose: flat shoes (shin frame = identity) at the given ankles, with the leg solve's info. */
const pose = (ankles: Record<ArmSide, Vec3>, info: Partial<Record<ArmSide, { variant?: number; softM?: number }>> = {}): PhysicalPose => {
  const seg = (id: string) => ({ segmentId: id, originWorld: v3(), rotationWorld: I });
  const li = (s: ArmSide) => ({ variant: info[s]?.variant ?? 0, request: ankles[s], liftM: 0, softM: info[s]?.softM ?? 0 });
  return {
    playerId: 'T',
    segments: { leftShin: seg('leftShin'), rightShin: seg('rightShin') } as unknown as PhysicalPose['segments'],
    jointLandmarksWorld: { leftAnkle: { ...ankles.left }, rightAnkle: { ...ankles.right } },
    hingeDeg: {},
    straightFallback: [],
    limbClearance: {},
    legInfo: { left: li('left'), right: li('right') },
  };
};
/** The ankle an exact solve of each request reaches (flat shoe, heading 0). */
const exact = (out: Record<ArmSide, FootRequest>, inp: FootPlanInput): Record<ArmSide, Vec3> => {
  const a = {} as Record<ArmSide, Vec3>;
  for (const s of SIDES) {
    const r = out[s];
    a[s] = r.kind === 'plant' ? add(r.heelW, v3(0, SOLE, 0)) : r.kind === 'target' ? { ...r.ankleW } : add(inp.request[s], r.offsetW);
  }
  return a;
};
/** One substep: plan, solve (exact unless `solve` overrides), observe. Returns the requests and this substep's events. */
const step = (plan: FootPlan, inp: FootPlanInput, solve?: (a: Record<ArmSide, Vec3>) => PhysicalPose) => {
  const ev: FootEvent[] = [];
  const out = planFeet(plan, inp, ev);
  const mid = { left: { ...plan.feet.left }, right: { ...plan.feet.right } };
  const a = exact(out, inp);
  observeFeet(plan, solve ? solve(a) : pose(a), SOLE, 0, ev, inp.t);
  return { out, ev, mid };
};
const types = (ev: FootEvent[], side: ArmSide): string[] => ev.filter((e) => e.side === side && e.type !== 'footSwing').map((e) => e.type);

describe('L2 plant confirmation (review closeout): a touchdown is a plant only once the achieved solve holds it', () => {
  it('clip touchdown: an out-of-reach solve fails the proposal (no plant, no anchor); a stale solve or an unreachable anchor proposes nothing; a reachable one is confirmed once', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    const clip = (on: boolean): FootPlanInput['clip'] => ({ weight: 1, headingRad: 0, stance: { left: on, right: false }, contact: { left: on ? { weight: 1, rollF: 0, toeZ: 0.15 } : null, right: null } });
    let t = 0;
    const ev0: FootEvent[] = [];
    const i0 = input(t, { clip: clip(false) });
    initFeet(plan, pose(i0.request), i0, ev0);
    expect(ev0).toEqual([]);
    expect(plan.stats.attempts).toBe(0);
    const L = plan.feet.left;
    // (1) eligible from the last solve, but this solve takes a clearance alternative: failed, not a plant; the next
    // substep sees the failed solve's (stale) ankle and gap and proposes nothing
    let r = step(plan, input((t += DT), { clip: clip(true) }), (a) => pose(a, { left: { variant: 1 } }));
    expect(r.out.left.kind).toBe('plant');
    expect(r.mid.left.tentative).toBe(true);
    expect(types(r.ev, 'left')).toEqual(['footPlantFailed']);
    expect(r.ev.find((e) => e.type === 'footPlantFailed')!.data.reason).toBe('clearance');
    expect([L.mode, L.heelW, L.anchorW, L.stale]).toEqual(['swing', null, null, true]);
    r = step(plan, input((t += DT), { clip: clip(true) }));
    expect(r.out.left.kind).toBe('offset');
    expect(plan.stats.attempts).toBe(1);
    expect(L.stale).toBe(false);
    // (2) a fresh solve, but the anchor is out of reach of the current hip: nothing proposed
    r = step(plan, input((t += DT), { clip: clip(true), hipY: plan.reachM + 0.01 }));
    expect(r.out.left.kind).toBe('offset');
    expect(plan.stats.attempts).toBe(1);
    // (3) reachable from the hip, but the achieved solve is reach-clamped 3 cm off the anchor: failed, no plant retained
    r = step(plan, input((t += DT), { clip: clip(true) }), (a) => pose({ ...a, left: add(a.left, v3(0, 0, 0.03)) }, { left: { softM: 0.03 } }));
    expect(r.mid.left.tentative).toBe(true);
    expect(types(r.ev, 'left')).toEqual(['footPlantFailed']);
    const fe = r.ev.find((e) => e.type === 'footPlantFailed')!.data;
    expect(fe.reason).toBe('reach');
    expect(fe.errM as number).toBeCloseTo(0.03, 6);
    expect([L.mode, L.anchorW, L.rejoin]).toEqual(['swing', null, true]);
    // the foot continues from the achieved ankle (offset decays at the bounded rate), then a valid plant is confirmed once
    // (footPlant with its achieved error) and becomes sustained after the next solve
    const all: FootEvent[] = [];
    for (let i = 0; i < 40 && plan.stats.sustained === 0; i++) {
      r = step(plan, input((t += DT), { clip: clip(true) }));
      all.push(...r.ev);
      if (r.out.left.kind === 'offset') expect(len(r.out.left.offsetW)).toBeLessThanOrEqual(0.03 + 1e-9);
    }
    expect(all.filter((e) => e.side === 'left' && e.type === 'footPlant').length).toBe(1);
    expect(all.some((e) => e.type === 'footRelease' || e.type === 'footPlantFailed')).toBe(false);
    expect(all.find((e) => e.type === 'footPlant')!.data.errM).toBe(0);
    expect([L.mode, L.tentative, L.solves]).toEqual(['planted', false, 1]);
    const st = plan.stats;
    expect([st.attempts, st.confirmed, st.failed, st.sustained]).toEqual([3, 1, 2, 1]);
    expect(st.failedErrM).toBeCloseTo(0.03, 6);
    expect(st.cover.left.plantedS).toBeCloseTo(2 * DT, 12);
    expect(st.cover.left.eligibleS).toBeGreaterThan(st.cover.left.plantedS);
    expect(st.cover.right.eligibleS).toBe(0);
  });

  it('reactive step touchdown: an out-of-reach solve fails the proposal; the foot steps again from the achieved ankle and the next touchdown is confirmed', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    let t = 0;
    const i0 = input(t);
    const ev0: FootEvent[] = [];
    initFeet(plan, pose(i0.request), i0, ev0);
    // initialization proposes; the first solve confirms
    expect(ev0).toEqual([]);
    expect([plan.feet.left.tentative, plan.feet.right.tentative]).toEqual([true, true]);
    let r = step(plan, input((t += DT)));
    expect(r.ev.filter((e) => e.type === 'footPlant').length).toBe(2);
    step(plan, input((t += DT)));
    expect(plan.stats.sustained).toBe(2);
    // the left home moves 0.2 m forward: the left foot steps; its touchdown proposal gets a reach-clamped solve
    const L = plan.feet.left;
    let failedAt = -1;
    for (let i = 0; i < 200 && failedAt < 0; i++) {
      const inp = input((t += DT), { dz: { left: 0.2 } });
      r = step(plan, inp, (a) => (plan.feet.left.mode === 'planted' && plan.feet.left.tentative ? pose({ ...a, left: add(a.left, v3(0, 0, -0.03)) }, { left: { softM: 0.03 } }) : pose(a)));
      if (r.ev.some((e) => e.type === 'footPlantFailed')) failedAt = i;
    }
    expect(failedAt).toBeGreaterThan(0);
    expect(types(r.ev, 'left')).toEqual(['footPlantFailed']);
    expect(r.ev.find((e) => e.type === 'footPlantFailed')!.data.reason).toBe('reach');
    expect([L.mode, L.anchorW]).toEqual(['swing', null]);
    const achieved = { ...L.ankleW };
    // the next substep starts a new step from the achieved ankle (bounded target speed, no jump to the destination)
    r = step(plan, input((t += DT), { dz: { left: 0.2 } }));
    expect(r.ev.some((e) => e.type === 'footSwing' && e.side === 'left' && e.data.source === 'step')).toBe(true);
    expect(Math.hypot(L.target.x - achieved.x, L.target.z - achieved.z)).toBeLessThanOrEqual(FOOTWORK_L2.swing.maxSpeedMps * DT + 1e-9);
    const all: FootEvent[] = [];
    for (let i = 0; i < 200 && !(L.mode === 'planted' && L.solves > 0); i++) all.push(...step(plan, input((t += DT), { dz: { left: 0.2 } })).ev);
    expect(all.filter((e) => e.side === 'left' && e.type === 'footPlant').length).toBe(1);
    expect(all.some((e) => e.type === 'footRelease' || e.type === 'footPlantFailed')).toBe(false);
    const st = plan.stats;
    expect([st.confirmed, st.failed, st.sustained]).toEqual([3, 1, 3]);
    // the stepping foot's swing time is not eligible stance; its planted time is
    expect(st.cover.right.plantedS).toBeCloseTo(st.cover.right.eligibleS, 12);
    expect(st.cover.left.plantedS).toBeCloseTo(st.cover.left.eligibleS - DT, 12);
  });

  it('support loss: an unconfirmed proposal fails (no plant or release); a confirmed plant is released with the reason', () => {
    const a = newFootPlan(FOOTWORK_L2, R);
    const i0 = input(0);
    initFeet(a, pose(i0.request), i0, []);
    let r = step(a, input(DT, { supported: false }));
    expect(r.ev.filter((e) => e.type !== 'footSwing').map((e) => [e.type, e.data.reason])).toEqual([
      ['footPlantFailed', 'supportLost'],
      ['footPlantFailed', 'supportLost'],
    ]);
    expect([a.feet.left.mode, a.feet.right.mode, a.stats.confirmed]).toEqual(['airborne', 'airborne', 0]);
    const b = newFootPlan(FOOTWORK_L2, R);
    initFeet(b, pose(i0.request), i0, []);
    step(b, input(DT));
    step(b, input(2 * DT));
    r = step(b, input(3 * DT, { supported: false }));
    const rel = r.ev.filter((e) => e.type === 'footRelease');
    expect(rel.map((e) => e.data.reason)).toEqual(['supportLost', 'supportLost']);
    for (const e of rel) expect([e.data.solves, e.data.plantedS]).toEqual([1, 0.00833]);
    expect(r.ev.some((e) => e.type === 'footPlant' || e.type === 'footPlantFailed')).toBe(false);
    // no new plant while unsupported
    for (let i = 4; i < 30; i++) expect(step(b, input(i * DT, { supported: false })).ev.some((e) => e.type === 'footPlant')).toBe(false);
    expect(b.stats.attempts).toBe(2);
  });

  it('initialization: a supported foot on the ground whose first solve does not hold the plant is a failed proposal', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    const i0 = input(0);
    initFeet(plan, pose(i0.request), i0, []);
    const r = step(plan, input(DT), (x) => pose({ ...x, right: add(x.right, v3(0.02, 0, 0)) }));
    expect(types(r.ev, 'left')).toEqual(['footPlant']);
    expect(types(r.ev, 'right')).toEqual(['footPlantFailed']);
    expect(r.ev.find((e) => e.type === 'footPlantFailed')!.data.reason).toBe('slide');
    expect([plan.feet.right.mode, plan.feet.right.anchorW]).toEqual(['swing', null]);
    // an unreachable achieved ankle at initialization proposes nothing
    const far = newFootPlan(FOOTWORK_L2, R);
    const i1 = input(0, { hipY: far.reachM });
    initFeet(far, pose(i1.request), i1, []);
    expect([far.stats.attempts, far.feet.left.mode]).toEqual([0, 'swing']);
  });
});

describe('L2 profile validation (review closeout): braking limits and stance widths are checked before physics', () => {
  it('braking: a negative, zero or non-finite limit is rejected where it is authored and where a motor is consumed', async () => {
    for (const bad of [-5.5, 0, NaN, Infinity, -Infinity]) expect(() => withBrakingLimit(DEFAULT_MOTOR, bad), String(bad)).toThrow(/braking\.maxDecelMps2 must be a finite number > 0/);
    expect(withBrakingLimit(DEFAULT_MOTOR, 5.5).braking).toEqual({ maxDecelMps2: 5.5 });
    const def = FIX('L2-F3-runStop');
    const neg = { ...DEFAULT_MOTOR, id: 'motor-neg', braking: { maxDecelMps2: -5.5 } };
    await expect(Simulation.create({ ...def, motor: neg })).rejects.toThrow(/fixture L2-F3-runStop motor: motor profile motor-neg: braking\.maxDecelMps2/);
    await expect(Simulation.create({ ...def, players: def.players.map((p) => ({ ...p, motor: { ...DEFAULT_MOTOR, id: 'motor-nan', braking: { maxDecelMps2: NaN } } })) })).rejects.toThrow(
      /fixture L2-F3-runStop player R motor: motor profile motor-nan: braking\.maxDecelMps2 must be a finite number > 0 \(got NaN\)/,
    );
    // valid limit and absent field construct (and the absent field keeps the historical drive)
    for (const m of [withBrakingLimit(DEFAULT_MOTOR, 5.5), DEFAULT_MOTOR]) {
      const s = await Simulation.create({ ...def, motor: m });
      s.stepTick();
      expect(s.result).toBe('running');
      s.dispose();
    }
  });
  it('stance width: non-finite entries are rejected naming the profile and field; finite signed and zero widths and absence stay valid', async () => {
    const def = FIX('L2-F11-sprint');
    const P = def.runClips!;
    for (const bad of [Infinity, -Infinity, NaN]) {
      const p = { ...P, stanceWidthAddM: { sprint: bad } };
      expect(() => validateRunClipProfile(p, def.ragdoll ?? RAGDOLL_G4)).toThrow(RunClipError);
      await expect(Simulation.create({ ...def, runClips: p })).rejects.toThrow(`run clip ${P.id}: stanceWidthAddM.sprint must be a finite number (got ${String(bad)})`);
    }
    for (const w of [undefined, { sprint: 0 }, { 'fast-run': -0.02, sprint: 0.03 }] as (Record<string, number> | undefined)[]) {
      const s = await Simulation.create({ ...def, runClips: { ...P, ...(w ? { stanceWidthAddM: w } : {}) } });
      for (let i = 0; i < 30; i++) s.stepTick();
      expect(s.result, JSON.stringify(w)).toBe('running');
      const lm = s.players[0].pose!.jointLandmarksWorld;
      for (const k of ['leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle']) for (const c of ['x', 'y', 'z'] as const) expect(Number.isFinite(lm[k][c]), `${k} ${JSON.stringify(w)}`).toBe(true);
      s.dispose();
    }
  });
});

// ------------------------------------------------------------------ closeout item 3: clip-to-procedural crossing
describe('L2 clip-to-procedural crossing (closeout item 3): stopping feet transfer one step at a time, no two-foot hop', () => {
  const NO_CLIP: FootPlanInput['clip'] = null;
  /**
   * Clip-regime input with both feet in clip swing (no stance contacts) at the given clip swing progress, each clip foot
   * request raised (lift, m) and moved along z (back, m); `stanceRight` puts the right foot in clip stance instead.
   */
  const clipIn = (t: number, o: { swingP: Record<ArmSide, number | null>; lift?: Partial<Record<ArmSide, number>>; back?: Partial<Record<ArmSide, number>>; stanceRight?: boolean }): FootPlanInput => {
    const inp = input(t, {
      clip: {
        weight: 1,
        headingRad: 0,
        stance: { left: false, right: !!o.stanceRight },
        contact: { left: null, right: o.stanceRight ? { weight: 1, rollF: 0, toeZ: 0.15 } : null },
        swingP: o.swingP,
      },
    });
    for (const s of SIDES) inp.request[s] = add(inp.request[s], v3(0, o.lift?.[s] ?? 0, o.back?.[s] ?? 0));
    return inp;
  };
  /** Initialize and run the clip regime until the follow offsets have decayed (targets on the clip requests). */
  const toCrossing = (plan: FootPlan, clip: Parameters<typeof clipIn>[1], n = 120): number => {
    const i0 = clipIn(0, clip);
    initFeet(plan, pose(i0.request), i0, []);
    let t = 0;
    for (let i = 0; i < n; i++) step(plan, clipIn((t += DT), clip));
    return t;
  };
  const lifted = (plan: FootPlan, s: ArmSide): boolean => plan.feet[s].mode === 'swing' && plan.feet[s].source === 'step' && !plan.feet[s].drag;
  const swings = (ev: FootEvent[]): FootEvent[] => ev.filter((e) => e.type === 'footSwing' && e.data.source === 'step');

  it('an airborne foot finishes its own clip swing (continued, not restarted) while the grounded reachable foot plants where it is', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    let t = toCrossing(plan, { swingP: { left: 0.3, right: 0.95 }, lift: { left: 0.06 } });
    const L = plan.feet.left;
    const before = { ...L.target };
    const rightAt = { ...plan.feet.right.ankleW };
    const r = step(plan, input((t += DT), { clip: NO_CLIP }));
    const sw = swings(r.ev);
    expect(sw.map((e) => [e.side, e.data.reason, e.data.p0])).toEqual([['left', 'continue', 0.3]]);
    // the grounded foot is a proposal where it is, confirmed by this solve (an honest touchdown, no displacement)
    expect(types(r.ev, 'right')).toEqual(['footPlant']);
    const at = r.ev.find((e) => e.type === 'footPlant')!.data.at as number[];
    expect(Math.hypot(at[0] - rightAt.x, at[2] - rightAt.z)).toBeLessThanOrEqual(1e-9);
    // no target jump: the continued swing starts from the inherited target within the speed and lift caps
    expect(Math.hypot(L.target.x - before.x, L.target.z - before.z)).toBeLessThanOrEqual(FOOTWORK_L2.swing.maxSpeedMps * DT + 1e-9);
    expect(Math.abs(L.target.y - before.y)).toBeLessThanOrEqual(FOOTWORK_L2.swing.maxLiftRateMps * DT + 1e-9);
    // until its honest touchdown: the stance foot stays planted, no new step starts, progress never restarts
    const all: FootEvent[] = [];
    let p = L.elapsedS / L.durS;
    for (let i = 0; i < 200 && !(L.mode === 'planted' && !L.tentative); i++) {
      all.push(...step(plan, input((t += DT), { clip: NO_CLIP })).ev);
      if (L.mode === 'swing') {
        expect(L.elapsedS / L.durS).toBeGreaterThanOrEqual(p);
        p = L.elapsedS / L.durS;
      }
      expect(plan.feet.right.mode).toBe('planted');
    }
    expect([L.mode, L.tentative]).toEqual(['planted', false]);
    expect(swings(all)).toEqual([]);
    expect(all.filter((e) => e.type === 'footPlant').map((e) => e.side)).toEqual(['left']);
  });

  it('both inherited feet airborne: each continues its own swing (distinct phases and touchdowns), no new clearance arcs, neither pretends to be planted', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    let t = toCrossing(plan, { swingP: { left: 0.2, right: 0.7 }, lift: { left: 0.05, right: 0.09 } });
    const r = step(plan, input((t += DT), { clip: NO_CLIP }));
    expect(swings(r.ev).map((e) => [e.side, e.data.reason, e.data.p0])).toEqual([
      ['left', 'continue', 0.2],
      ['right', 'continue', 0.7],
    ]);
    expect(r.ev.some((e) => e.type === 'footPlant' || e.type === 'footPlantFailed')).toBe(false);
    const all: FootEvent[] = [];
    const down: Partial<Record<ArmSide, number>> = {};
    for (let i = 0; i < 200 && !(down.left && down.right); i++) {
      const e = step(plan, input((t += DT), { clip: NO_CLIP })).ev;
      all.push(...e);
      for (const x of e) if (x.type === 'footPlant') down[x.side] = t;
      // an unplanted foot is never a plant request
      for (const s of SIDES) if (plan.feet[s].mode !== 'planted') expect(plan.feet[s].heelW).toBe(null);
    }
    expect(swings(all)).toEqual([]);
    expect(down.left).toBeDefined();
    expect(down.right).toBeDefined();
    expect(down.left).not.toBe(down.right);
  });

  it('a grounded foot that cannot plant waits (target held, no plant, no drag) until the airborne foot has landed, then takes the next ordinary step', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    // the right clip foot is on the ground 0.5 m behind its hip: beyond the plant reach
    let t = toCrossing(plan, { swingP: { left: 0.3, right: 0.9 }, lift: { left: 0.06 }, back: { right: -0.5 } });
    const Rf = plan.feet.right;
    const held = { ...Rf.target };
    let r = step(plan, input((t += DT), { clip: NO_CLIP }));
    expect(swings(r.ev).map((e) => [e.side, e.data.reason])).toEqual([['left', 'continue']]);
    expect([Rf.mode, Rf.source, Rf.wait, Rf.heelW]).toEqual(['swing', 'follow', true, null]);
    const all: FootEvent[] = [...r.ev];
    const L = plan.feet.left;
    for (let i = 0; i < 200 && !(L.mode === 'planted' && !L.tentative); i++) {
      expect(r.out.right).toEqual({ kind: 'target', ankleW: held, headingRad: Rf.headingRad });
      r = step(plan, input((t += DT), { clip: NO_CLIP }));
      all.push(...r.ev);
      expect(lifted(plan, 'left') && lifted(plan, 'right')).toBe(false);
    }
    expect(all.some((e) => e.side === 'right' && e.type !== 'footSwing')).toBe(false);
    // the left foot is held now: the right foot steps (an ordinary lifted step, not a drag)
    r = step(plan, input((t += DT), { clip: NO_CLIP }));
    expect(swings(r.ev).map((e) => [e.side, e.data.reason, !!e.data.drag])).toEqual([['right', 'step', false]]);
    expect(Math.hypot(Rf.target.x - held.x, Rf.target.z - held.z)).toBeLessThanOrEqual((FOOTWORK_L2.swing.maxSpeedMps + 1e-9) * DT);
    expect(all.concat(r.ev).some((e) => e.type === 'footSwing' && e.data.drag)).toBe(false);
  });

  it('a carried-over plant stays while its solve holds it; a genuine release with the other foot in the air drags, and lifts once that foot lands', () => {
    const plan = newFootPlan(FOOTWORK_L2, R);
    let t = toCrossing(plan, { swingP: { left: 0.3, right: null }, lift: { left: 0.06 }, stanceRight: true });
    const Rf = plan.feet.right;
    expect([Rf.mode, Rf.tentative]).toEqual(['planted', false]);
    let r = step(plan, input((t += DT), { clip: NO_CLIP }));
    expect(swings(r.ev).map((e) => [e.side, e.data.reason])).toEqual([['left', 'continue']]);
    expect([Rf.mode, Rf.inherited]).toEqual(['planted', true]);
    // the right solve slides 2 cm off its anchor: released with the reason (its actual validity), then a drag step
    r = step(plan, input((t += DT), { clip: NO_CLIP }), (a) => pose({ ...a, right: add(a.right, v3(0, 0, 0.02)) }));
    expect(r.ev.filter((e) => e.side === 'right' && e.type === 'footRelease').map((e) => e.data.reason)).toEqual(['slide']);
    r = step(plan, input((t += DT), { clip: NO_CLIP }));
    expect(swings(r.ev).map((e) => [e.side, !!e.data.drag])).toEqual([['right', true]]);
    const L = plan.feet.left;
    for (let i = 0; i < 200 && !(L.mode === 'planted' && !L.tentative); i++) step(plan, input((t += DT), { clip: NO_CLIP }));
    expect([L.mode, L.tentative]).toEqual(['planted', false]);
    step(plan, input((t += DT), { clip: NO_CLIP }));
    if (Rf.mode === 'swing') expect([Rf.source, Rf.drag]).toEqual(['step', false]);
  });

  // run stops crossing from the clip at other run phases (zero request at brakeS) and with the original motor
  const variants: [string, FixtureDef][] = [
    ['L2-F3-runStop', FIX('L2-F3-runStop')],
    ['L2-F3-runStopHard', FIX('L2-F3-runStopHard')],
    ...[2.3, 2.45, 2.55, 2.65].map((b): [string, FixtureDef] => [`controlled ${b}`, L2.runStop(`L2-test-${b}`, b, true)]),
    ...[2.3, 2.45].map((b): [string, FixtureDef] => [`original ${b}`, L2.runStop(`L2-test-o${b}`, b, false)]),
  ];
  it.each(variants)('%s: from the crossing, steps are staggered (no two lifted step arcs, no achieved two-foot flight), drags only from genuine releases, then settle', async (_name, def) => {
    const sim = await Simulation.create(def);
    const P = (): PlayerRuntime => sim.players[0];
    let cross = -1;
    let hadClip = false;
    let both = 0;
    let flight = 0;
    let flightMax = 0;
    let errMax = 0;
    while (!sim.done) {
      const p = P();
      const inClip = !!(p.run && p.run.w > 0);
      sim.stepTick();
      const f = P().feet!;
      if (inClip) hadClip = true;
      if (hadClip && cross < 0 && !(P().run && P().run!.w > 0) && P().controlMode === 'supported') cross = sim.t;
      if (cross < 0 || P().rag) continue;
      if (lifted(f, 'left') && lifted(f, 'right')) both += sim.tickS;
      // achieved shoes: both more than 2 cm off the ground at once (a two-foot flight)
      flight = f.feet.left.gapM > 0.02 && f.feet.right.gapM > 0.02 ? flight + sim.tickS : 0;
      flightMax = Math.max(flightMax, flight);
      for (const s of SIDES) if (f.feet[s].mode === 'planted' && !f.feet[s].tentative) errMax = Math.max(errMax, f.feet[s].featureErrM);
    }
    expect(cross).toBeGreaterThan(0);
    expect(both).toBe(0);
    expect(flightMax).toBeLessThan(FOOTWORK_L2.swing.minS / 2);
    expect(errMax).toBeLessThanOrEqual(FOOTWORK_L2.plantTolM);
    const ev = footEvents(sim, 'R').filter((e) => e.t >= cross - 1e-9);
    const inStep: Record<string, boolean> = { left: false, right: false };
    for (const e of footEvents(sim, 'R')) {
      const s = e.data!.side as ArmSide;
      if (e.type === 'footSwing' && e.data!.source === 'step') {
        // a new ordinary step never starts while the other foot is in a lifted step
        if (e.t >= cross - 1e-9 && e.data!.reason !== 'continue' && !e.data!.drag) expect(inStep[s === 'left' ? 'right' : 'left'], `${e.t} ${s}`).toBe(false);
        inStep[s] = !e.data!.drag;
      } else if (e.type === 'footSwing' || e.type === 'footPlant' || e.type === 'footPlantFailed') inStep[s] = false;
    }
    // a drag only follows a genuine release of that foot's held plant (its reach / yaw or its solve), never a clip fade
    for (const d of ev.filter((e) => e.type === 'footSwing' && e.data!.drag)) {
      const sub = sim.tickS / def.solver.substeps;
      const rel = ev.filter((e) => e.type === 'footRelease' && e.data!.side === d.data!.side && e.t <= d.t + 1e-9 && e.t >= d.t - sub - 1e-9);
      expect(rel.length, `drag at ${d.t}`).toBeGreaterThan(0);
    }
    if (def.id === 'L2-F3-runStop') expect(ev.some((e) => e.type === 'footSwing' && e.data!.drag)).toBe(false);
    // settled: both planted, no step in the last 0.5 s
    for (const s of SIDES) expect(P().feet!.feet[s].mode, s).toBe('planted');
    const steps = ev.filter((e) => e.type === 'footSwing' && e.data!.source === 'step');
    expect(steps[steps.length - 1].t).toBeLessThan(sim.t - 0.5);
    sim.dispose();
  });
});

// ------------------------------------------------------------------ closeout item 4: braking stance
describe('L2 braking stance (closeout item 4): the root physically lowers while braking, through the support composition', () => {
  const S = SUSPENSION_L2_BRAKE;
  const B = S.brakingStance!;
  const DT = 1 / 240;
  const smoothstep = (x: number): number => {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  };
  /** Per tick of one player: probe height, target and its rate / feedforward, applied force, blend, clip weight, speed. */
  type Row = { t: number; h: number; ht: number; vt: number; at: number; F: number; b: number; w: number; v: number; sup: boolean; rag: boolean; req: number };
  const trace = async (def: FixtureDef): Promise<{ rows: Row[]; sim: Simulation }> => {
    const sim = await Simulation.create(def);
    const rows: Row[] = [];
    while (!sim.done) {
      sim.stepTick();
      const p = sim.players[0];
      const u = p.sus!;
      const lv = p.rag ? v3() : p.proxy.body.linvel();
      const d = p.intent.locomotion.desiredVelocityWorld;
      rows.push({ t: sim.t, h: u.probe.heightM, ht: u.targetM, vt: u.targetVMps, at: u.targetAMps2, F: u.appliedN, b: u.brakeB, w: p.run?.w ?? 0, v: Math.hypot(lv.x, lv.z), sup: p.controlMode === 'supported' && p.grounded, rag: !!p.rag, req: Math.hypot(d.x, d.z) });
    }
    return { rows, sim };
  };

  it('profile identity: SUSPENSION_L2_BRAKE = SUSPENSION_L2 plus the braking stance; only controlled-braking L2 fixtures use it', () => {
    const { id, brakingStance, ...rest } = SUSPENSION_L2_BRAKE;
    const { id: id0, ...rest0 } = SUSPENSION_L2;
    expect(rest).toEqual(rest0);
    expect([id, id0]).toEqual(['support-suspension-rh-v3', 'support-suspension-rh-v2']);
    expect(brakingStance).toEqual({ heightM: 0.8, fullSpeedMps: 3.0, frequencyHz: 2.5, maxRatePerS: 4, maxAccelPerS2: 32 });
    expect(SUSPENSION_L2.brakingStance).toBeUndefined();
    expect(SUSPENSION_RH.brakingStance).toBeUndefined();
    const users = allFixtures().filter((d) => d.support === SUSPENSION_L2_BRAKE);
    expect(users.length).toBeGreaterThan(0);
    for (const d of users) {
      expect(d.id.startsWith('L2-'), d.id).toBe(true);
      expect(d.motor.braking, d.id).toBeDefined();
    }
    // historical, RH, tackle/repair copies and the original-motor hard stop keep their profiles
    for (const d of allFixtures()) if (!d.id.startsWith('L2-')) expect((d.support as SuspensionSupport | undefined)?.brakingStance, d.id).toBeUndefined();
    expect(FIX('L2-F3-runStopHard').support).toBe(SUSPENSION_L2);
  });

  it('braking demand: the drive velocity law against the actual travel over the braking limit, speed-scaled; none without a limit', () => {
    const tau = DEFAULT_MOTOR.velocityResponseTimeS;
    const lim = 5.5;
    expect(brakingDemand(B, v3(), v3(6, 0, 0), 1, tau, lim)).toBe(1);
    // the request keeps up (running at speed, accelerating): no braking
    expect(brakingDemand(B, v3(6, 0, 0), v3(5.9, 0, 0), 1, tau, lim)).toBe(0);
    expect(brakingDemand(B, v3(6, 0, 0), v3(2, 0, 0), 1, tau, lim)).toBe(0);
    // no braking limit (original motor), at rest, zero effort
    expect(brakingDemand(B, v3(), v3(6, 0, 0), 1, tau, undefined)).toBe(0);
    expect(brakingDemand(B, v3(), v3(), 1, tau, lim)).toBe(0);
    expect(brakingDemand(B, v3(), v3(6, 0, 0), 0, tau, lim)).toBe(0);
    // slow travel: the deceleration share times smoothstep(speed / fullSpeedMps)
    expect(brakingDemand(B, v3(), v3(1, 0, 0), 1, tau, lim)).toBeCloseTo((1 / tau / lim) * smoothstep(1 / B.fullSpeedMps), 12);
    // a request across the travel (a cut) brakes the travel component; a backward drag against a forward request too
    expect(brakingDemand(B, v3(0, 0, 6), v3(6, 0, 0), 1, tau, lim)).toBe(1);
    expect(brakingDemand(B, v3(0, 0, 0.3), v3(0, 0, -0.4), 1, tau, lim)).toBeCloseTo(((0.7 / tau) / lim) * smoothstep(0.4 / B.fullSpeedMps), 12);
  });

  it('blend filter: continuous, rate and acceleration bounded, inside [0, 1], held while unsupported', () => {
    const st = newSuspensionRuntime(0.89);
    let prevV = 0;
    const steps = (want: number | null, n: number): void => {
      for (let i = 0; i < n; i++) {
        const b0 = st.brakeB;
        advanceBraking(st, B, want, DT);
        expect(st.brakeB).toBeGreaterThanOrEqual(0);
        expect(st.brakeB).toBeLessThanOrEqual(1);
        expect(Math.abs(st.brakeV)).toBeLessThanOrEqual(B.maxRatePerS + 1e-9);
        if (want !== null) expect(Math.abs(st.brakeV - prevV) / DT).toBeLessThanOrEqual(B.maxAccelPerS2 + 1e-6);
        if (want === null) expect(st.brakeB).toBe(b0);
        prevV = st.brakeV;
      }
    };
    steps(1, 120);
    expect(st.brakeB).toBeGreaterThan(0.95);
    const held = st.brakeB;
    steps(null, 60);
    expect(st.brakeB).toBe(held);
    expect(st.brakeV).toBe(0);
    prevV = 0;
    steps(0, 240);
    expect(st.brakeB).toBeLessThan(1e-3);
  });

  it('composition: b = 0 is the unchanged expression; b blends stance and running height/bob toward the braking height at any clip weight', () => {
    const a = newSuspensionRuntime(0.89);
    const c = newSuspensionRuntime(0.89);
    const run = (t: number) => ({ heightM: 0.92 + 0.03 * Math.sin(12 * t), velMps: 0.36 * Math.cos(12 * t), accelMps2: -4.32 * Math.sin(12 * t) });
    for (let i = 0; i < 480; i++) {
      const t = i * DT;
      const w = Math.min(1, t);
      for (const [st, P] of [[a, SUSPENSION_L2], [c, S]] as const) {
        advanceStance(st, P, 0.89, DT);
        composeTarget(st, P, run(t), w, DT);
      }
      expect([c.targetM, c.targetVMps, c.targetAMps2]).toEqual([a.targetM, a.targetVMps, a.targetAMps2]);
    }
    // full blend at full clip weight: the target settles on the braking height, the bob is gone
    for (let i = 0; i < 480; i++) {
      advanceBraking(c, B, 1, DT);
      advanceStance(c, S, 0.89, DT);
      composeTarget(c, S, run(i * DT), 1, DT);
      expect(Math.abs(c.targetVMps)).toBeLessThanOrEqual(S.targetSlewMps + 1e-9);
    }
    expect(c.brakeB).toBeCloseTo(1, 6);
    expect(c.targetM).toBeCloseTo(B.heightM, 6);
    // a lower stance request wins (a crouch is never raised to the braking height)
    for (let i = 0; i < 960; i++) {
      advanceStance(c, S, 0.72, DT);
      composeTarget(c, S, run(i * DT), 1, DT);
    }
    expect(c.targetM).toBeCloseTo(0.72, 6);
  });

  it('L2-F3-runStop: the achieved root lowers while the clip still plays and fades, holds through the crossing, returns to ready without rebound', async () => {
    const def = FIX('L2-F3-runStop');
    expect(def.support).toBe(S);
    const { rows, sim } = await trace(def);
    const brake = rows.find((r) => r.req < 1e-9 && r.t > 1)!.t;
    const g = 9.81;
    const mass = sim.players[0].proxy.body.mass();
    // nothing before the brake
    for (const r of rows.filter((x) => x.t < brake)) expect(r.b, `${r.t}`).toBe(0);
    // effective during the clip: lower than the high-stance minimum (0.863 m) while the clip still has weight
    const clipLow = Math.min(...rows.filter((r) => r.t >= brake && r.w >= 0.5).map((r) => r.h));
    expect(clipLow).toBeLessThan(0.83);
    const cross = rows.find((r) => r.t > brake && r.w === 0)!;
    expect(cross.h).toBeLessThan(0.81);
    const braking = rows.filter((r) => r.t >= brake && r.v > 0.1);
    expect(Math.min(...braking.map((r) => r.h))).toBeGreaterThan(B.heightM - 0.01);
    for (const r of braking) {
      expect(r.sup, `${r.t}`).toBe(true);
      expect(Math.abs(r.vt)).toBeLessThanOrEqual(S.targetSlewMps + 1e-9);
      expect(Math.abs(r.at)).toBeLessThanOrEqual(g);
      expect(r.F).toBeGreaterThan(0);
      expect(r.F).toBeLessThanOrEqual(S.maxForceBW * mass * g + 1e-6);
    }
    // the return: after the body has stopped the root never rises above the ready height (no rebound) and settles on it
    const rest = rows.findIndex((r) => r.t > brake && r.v < 0.05);
    for (const r of rows.slice(rest)) expect(r.h, `${r.t}`).toBeLessThan(S.standingHeightM + 0.003);
    expect(Math.abs(rows[rows.length - 1].h - S.standingHeightM)).toBeLessThan(0.002);
    expect(rows[rows.length - 1].b).toBeLessThan(1e-3);
    sim.dispose();
  });

  it('other run phases and speeds, the slow stop and the hard stop: lower at the crossing where controlled braking runs, unchanged stop time and distance', async () => {
    const stop = (rows: Row[]) => {
      const brake = rows.find((r) => r.req < 1e-9 && r.t > 1)!.t;
      const end = rows.find((r) => r.t > brake && r.v <= 0.1)!.t;
      return end - brake;
    };
    for (const b of [1.2, 1.6, 2.3, 2.45, 2.55, 2.65]) {
      const def = L2.runStop(`L2-test-low-${b}`, b, true);
      const low = await trace(def);
      const high = await trace({ ...def, support: SUSPENSION_L2 });
      const cross = low.rows.find((r) => r.t > b && r.w === 0 && r.sup)!;
      expect(cross.h, `${b}`).toBeLessThan(0.81);
      const crossHigh = high.rows.find((r) => r.t > b && r.w === 0 && r.sup)!;
      expect(crossHigh.h, `${b}`).toBeGreaterThan(0.88);
      expect(Math.abs(stop(low.rows) - stop(high.rows)), `${b}`).toBeLessThan(0.05);
      expect(Math.abs(low.rows[low.rows.length - 1].h - S.standingHeightM)).toBeLessThan(0.002);
      low.sim.dispose();
      high.sim.dispose();
    }
    // slow stop: speed-scaled, only a slight lowering, back to ready
    const walk = await trace(FIX('L2-F3-walkStop'));
    expect(Math.min(...walk.rows.map((r) => r.h))).toBeGreaterThan(S.standingHeightM - 0.02);
    expect(Math.abs(walk.rows[walk.rows.length - 1].h - S.standingHeightM)).toBeLessThan(0.002);
    walk.sim.dispose();
    // the original-motor hard stop has no braking stance
    const hard = await trace(FIX('L2-F3-runStopHard'));
    for (const r of hard.rows) expect(r.b).toBe(0);
    hard.sim.dispose();
  });

  it('interrupted braking: the stance rises toward the running height as the body accelerates again, then lowers again on the second brake', async () => {
    const { rows, sim } = await trace(FIX('L2-F3-runStopReaccel'));
    const at = (t: number) => rows.find((r) => r.t >= t - 1e-9)!;
    expect(Math.max(...rows.filter((r) => r.t < 2.0).map((r) => r.b))).toBeGreaterThan(0.9);
    // reaccelerating from 2.0 s: the blend is back near zero before the second brake (2.8 s)
    expect(at(2.75).b).toBeLessThan(0.02);
    expect(at(2.75).h).toBeGreaterThan(0.85);
    expect(Math.max(...rows.filter((r) => r.t > 2.8).map((r) => r.b))).toBeGreaterThan(0.9);
    expect(Math.min(...rows.filter((r) => r.t > 2.8 && r.w === 0 && r.sup && r.v > 1).map((r) => r.h))).toBeLessThan(0.81);
    expect(Math.abs(rows[rows.length - 1].h - S.standingHeightM)).toBeLessThan(0.002);
    sim.dispose();
  });

  it('airborne and falling: the blend holds while unsupported (zero support authority) and a landing meets it; an audited conversion in the lowered stance is accepted', async () => {
    const kick = await trace(FIX('L2-F3-runStopKick'));
    const air = kick.rows.filter((r) => r.t > 2.6 && !r.sup);
    expect(air.length).toBeGreaterThan(5);
    for (const r of air) {
      expect(r.F).toBe(0);
      expect(r.b).toBe(air[0].b);
    }
    expect(air[0].b).toBeGreaterThan(0.9);
    const land = kick.rows.find((r) => r.t > air[air.length - 1].t && r.sup)!;
    expect(land.ht).toBeLessThan(0.82);
    for (const r of kick.rows) expect(Number.isFinite(r.ht) && Number.isFinite(r.b)).toBe(true);
    kick.sim.dispose();
    // conversion at 2.6 s, root lowered: the unchanged audit accepts the achieved pose
    const sim = await Simulation.create(FIX('L2-F3-runStopHandoff'));
    let hAt = NaN;
    while (!sim.done) {
      const p = sim.players[0];
      if (!p.rag) hAt = p.sus!.probe.heightM;
      sim.stepTick();
    }
    const p = sim.players[0];
    expect(p.handoff?.outcome).toBe('accepted');
    expect(p.handoff!.t).toBeCloseTo(2.6, 6);
    expect(hAt).toBeLessThan(0.81);
    expect(p.controlMode).toBe('falling');
    sim.dispose();
  });

  it('planner on/off: identical support state and physics with the braking stance until conversion (pose only)', async () => {
    for (const id of ['L2-F3-runStopReaccel', 'L2-F3-runStopKick', 'L2-F7-shove']) {
      const go = async (d: FixtureDef) => {
        const sim = await Simulation.create(d);
        const out: string[] = [];
        while (!sim.done) {
          sim.stepTick();
          const p = sim.players[0];
          if (p.rag) break;
          const b = p.proxy.body;
          out.push(JSON.stringify([b.translation(), b.linvel(), p.sus!.targetM, p.sus!.brakeB, p.sus!.appliedN, p.controlMode]));
        }
        sim.dispose();
        return out;
      };
      const def = FIX(id);
      expect(await go(def), id).toEqual(await go({ ...def, footwork: undefined }));
    }
  });
});
