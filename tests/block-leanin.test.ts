// Plan 16 (p38), the lean-in (LEAN_IN_V1, `leanInStances`, `withLeanIn`): the feet behind the hips and the body inclined
// into his man. Constructed: the stance's constraints on the BL body, the pose's rule for the rear foot on its ball
// (`ballAheadM`) agreeing with the derivation, the contest counting a foot on its ball as set, the support asking the
// stance's height whole. Then the BL scenes rebuilt on the lean-in (fixtures/blocking.ts `blockScene`): a man knocked back
// keeps his feet behind his hips, and each step he takes back lands behind them. Each has its fault twin: the athletic
// stance (ATHLETIC_V2, his feet ahead of his hips), the flat foot's rule, the contest's own set limit, the preparation drop.
import { describe, expect, it } from 'vitest';
import { ballAheadM, contestFeet, CONTEST_V1, flatAheadM, legForThigh, shinForAnkleRad } from '../src/sim/block-base';
import type { ArmSide } from '../src/sim/contracts';
import { ATHLETIC_V2, athleticStances, BLOCK_STRIKE_V1, BLOCK_V1, LEAN_IN_V1, leanInStances, withContest, withLeanIn, withStrike, type LeanInStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, legOf, type BlockMan } from '../src/sim/fixtures/blocking';
import type { FootPlan } from '../src/sim/footwork';
import { Simulation } from '../src/sim/simulation';
import { prepDropM } from '../src/sim/support-runtime';
import { dot, norm, qFromAxisAngle, v3, type Vec3 } from '../src/sim/vec';
import { FIX } from './helpers';

const deg = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
const SIDES: ArmSide[] = ['left', 'right'];
const L = legOf(FIX('L3-F6-hold'), FIX('L3-F6-hold').players.find((p) => p.id === 'D')!.body);

/** Where a stance stands its feet and how it bends his knees, for the constraints (ankles along his facing from his hips, m). */
interface Stood {
  rearM: number;
  frontM: number;
  /** Each phase's hip height over the ground (m), rear foot pitch (deg) and knee bend (deg, 0 straight). */
  phases: Record<'load' | 'set' | 'strike' | 'stood', { hipM: number; pitchDeg: number; kneeDeg: number }>;
  trunk: Record<'set' | 'stood', number>;
}

/** The lean-in's feet and phases: each phase's knee the thigh's angle off vertical plus the shin's lean (`standOver`'s foot). */
function leanStood(S: LeanInStance): Stood {
  const d = leanInStances(S, L);
  const range = deg(L.dorsiDeg);
  const knee = (k: keyof Stood['phases']) => {
    const p = deg(d.hips[k].pitchDeg);
    const shin = p > 0 ? range + p : legForThigh(L.thighM, L.shinM, d.aheadM, deg(S[k].thighDeg)).shinRad;
    return 90 - S[k].thighDeg + toDeg(shin);
  };
  const ph = (k: keyof Stood['phases']) => ({ hipM: d.hips[k].overGroundM, pitchDeg: d.hips[k].pitchDeg, kneeDeg: knee(k) });
  return { rearM: d.aheadM, frontM: d.aheadM + S.staggerM, phases: { load: ph('load'), set: ph('set'), strike: ph('strike'), stood: ph('stood') }, trunk: { set: S.set.trunkDeg, stood: S.stood.trunkDeg } };
}

/** The athletic stance read the same way (its rear foot flat over the load's shin). */
function athleticStood(): Stood {
  const d = athleticStances(ATHLETIC_V2, L);
  const ph = (s: typeof d.load, t: { thighDeg: number; shinDeg?: number }) => {
    const leg = legForThigh(L.thighM, L.shinM, d.aheadM, deg(t.thighDeg));
    return { hipM: s.heightM + L.hipUpM - L.soleM, pitchDeg: 0, kneeDeg: 90 - t.thighDeg + toDeg(leg.shinRad) };
  };
  const set = ph(d.stance, ATHLETIC_V2.set);
  return { rearM: d.aheadM, frontM: d.aheadM + ATHLETIC_V2.staggerM, phases: { load: ph(d.load, ATHLETIC_V2.load), set, strike: ph(d.strike, ATHLETIC_V2.strike), stood: set }, trunk: { set: ATHLETIC_V2.set.trunkDeg, stood: ATHLETIC_V2.set.trunkDeg } };
}

/** The lean-in's constraints, each as a viewer reads it (the ball's limit `stepDeg`, the knees' power range 40-70 deg). */
function meets(st: Stood, stepDeg: number): string[] {
  const bad: string[] = [];
  const mid = (st.rearM + st.frontM) / 2;
  if (!(mid < -0.03 && st.frontM < 0.01)) bad.push('his hips are not ahead of his feet');
  const P = st.phases;
  if (Object.values(P).some((p) => p.pitchDeg > stepDeg + 1e-9)) bad.push('a foot past the ball (on its toes)');
  if (L.shoeM * Math.sin(deg(Math.max(...Object.values(P).map((p) => p.pitchDeg)))) > 0.075) bad.push('a heel higher than the limit');
  if (Object.values(P).some((p) => p.kneeDeg < 40 || p.kneeDeg > 70)) bad.push('a knee out of its power range');
  if (!(P.load.hipM < P.set.hipM && P.set.hipM < P.strike.hipM && P.strike.hipM <= P.stood.hipM)) bad.push('the load does not sink, or the strike does not rise');
  if (!(st.trunk.stood < st.trunk.set)) bad.push('the stood-up stance does not stand his trunk up');
  return bad;
}

describe('plan 16 (p38), the lean-in stance (LEAN_IN_V1 on the BL body)', () => {
  it("meets its constraints: the feet behind the hips, the rear foot on its ball within 14 deg and 7.5 cm, the knees bent 40-70, the load sinking and the strike rising, the stood-up stance standing him up; fault twin: the athletic stance's feet stand ahead of his hips", () => {
    const st = leanStood(LEAN_IN_V1);
    expect(meets(st, LEAN_IN_V1.ball.stepDeg)).toEqual([]);
    expect(st.rearM).toBeLessThan(-0.08);
    expect(st.phases.load.pitchDeg).toBe(LEAN_IN_V1.ball.pitchDeg);
    expect(meets(athleticStood(), LEAN_IN_V1.ball.stepDeg)).toContain('his hips are not ahead of his feet');
    // a deeper ball (a fault twin of the limit): the feet further behind, the foot on its toes
    const toes = leanStood({ ...LEAN_IN_V1, ball: { ...LEAN_IN_V1.ball, pitchDeg: 20 } });
    expect(meets(toes, LEAN_IN_V1.ball.stepDeg)).toContain('a foot past the ball (on its toes)');
  });

  it("the pose's rule for a foot on its ball (`ballAheadM`, the flat footprint's ankle) places the rear foot where the derivation does, and the stepping's shin lean of that foot is the range plus its pitch; fault twin: the flat foot's rule (`flatAheadM`) stands it under the hips", () => {
    const d = leanInStances(LEAN_IN_V1, L);
    const range = deg(L.dorsiDeg);
    const p = deg(LEAN_IN_V1.ball.pitchDeg);
    const hipG = d.hips.load.overGroundM;
    const ahead = ballAheadM(L.thighM, L.shinM, hipG, range, p, L.soleM, L.toeM);
    expect(ahead).toBeCloseTo(d.aheadM, 6);
    const flat = flatAheadM(L.thighM, L.shinM, hipG - L.soleM, range);
    expect(flat - ahead).toBeGreaterThan(0.08);
    expect(flat).toBeGreaterThan(-0.01);
    // the shin over the flat footprint at the ball's place leans past the range (so the plan pitches the foot), less than range + pitch
    const lean = shinForAnkleRad(L.thighM, L.shinM, ahead, hipG - L.soleM);
    expect(lean).toBeGreaterThan(range);
    expect(lean).toBeLessThan(range + p);
    expect(shinForAnkleRad(L.thighM, L.shinM, flat, hipG - L.soleM)).toBeCloseTo(range, 6);
  });

  it('withLeanIn: the profile on the derived stances, the stood-up level raising the hips and the trunk to the stood-up stance, a foot on its ball within the limit counting as set; fault twin: the contest\'s own limit (3 cm, 10 deg) counts the same foot as not set', () => {
    const p0 = withContest(withStrike(BLOCK_V1, BLOCK_STRIKE_V1), CONTEST_V1);
    const p = withLeanIn(p0, LEAN_IN_V1, L);
    const d = leanInStances(LEAN_IN_V1, L);
    expect(p.id).toBe(`${p0.id}+lean-in-v1`);
    expect(p.stance.heightM).toBe(d.stance.heightM);
    expect(p.strike!.load.stance.heightM).toBe(d.load.heightM);
    expect(p.flat!.ball).toEqual(LEAN_IN_V1.ball);
    expect(p.contest!.stood.riseM).toBeCloseTo(d.stood.heightM - d.stance.heightM, 9);
    expect(p.contest!.stood.trunkDeg).toBeCloseTo(d.stance.hingeDeg - d.stood.hingeDeg, 9);
    // a planted rear foot on its ball at 12 deg, the front flat
    const SHOE = { he: v3(0.09, 0.09, 0.152), centerFoot: v3(0, -0.03, 0.06) };
    const plan = (rearDeg: number) => {
      const foot = (d: number, z: number) => ({ mode: 'planted', ankleW: v3(0, 0.12, z), footQ: qFromAxisAngle(v3(1, 0, 0), deg(d)) });
      return { shoe: SHOE, feet: { left: foot(0, 0.1), right: foot(rearDeg, 0) } } as unknown as FootPlan;
    };
    expect(contestFeet(plan(12), p.contest!).setFeet).toBe(2);
    expect(contestFeet(plan(12), CONTEST_V1).setFeet).toBe(1);
    expect(contestFeet(plan(17), p.contest!).setFeet).toBe(1);
  });

  it('the support asks the lean-in\'s height whole (no contact preparation drop under it); fault twin: the same stance without it drops the hips by the preparation drop', () => {
    const host = { def: { locomotion: { contact: { prepDropM: 0.05 } } } } as unknown as Parameters<typeof prepDropM>[0];
    const pl = (heightWhole: boolean) => ({ intent: { locomotion: { stance: { heightM: 0.87, heightWhole } } }, loco: { prepW: 1 } }) as unknown as Parameters<typeof prepDropM>[1];
    expect(prepDropM(host, pl(true))).toBe(0);
    expect(prepDropM(host, pl(false))).toBeCloseTo(0.05, 9);
  });
});

// ------------------------------------------------------------------ the BL scenes on the lean-in
const sceneOn = (id: string, stance: 'lean' | 'athletic', durationS: number): FixtureDef => {
  const o = BL_SCENES.find((x) => x.id === id)!;
  const on = (m: BlockMan): BlockMan => (stance === 'lean' ? { ...m, athletic: undefined, leanIn: LEAN_IN_V1 } : { ...m, leanIn: undefined, athletic: ATHLETIC_V2 });
  return blockScene({ ...o, A: on(o.A), B: on(o.B), durationS }, FIX('L3-F6-hold'));
};

interface KnockedBack {
  /** Substeps from `fromS` with both feet planted, and those with his hips ahead of his feet's mid-point (toward his man). */
  ticks: number;
  ahead: number;
  /** Each step's landing (an ankle newly planted): how far ahead of his hips it lands toward his man (m; negative behind). */
  landings: number[];
  /** Substeps with both feet in the air. */
  bothUp: number;
  fell: boolean;
}

async function knockedBack(def: FixtureDef, id: string, fromS: number): Promise<KnockedBack> {
  const r: KnockedBack = { ticks: 0, ahead: 0, landings: [], bothUp: 0, fell: false };
  const was: Partial<Record<ArmSide, boolean>> = {};
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      if (sim.t < fromS) return;
      const p = sim.players.find((x) => x.id === id)!;
      const him = sim.players.find((x) => x.id !== id)!;
      if (p.rag || p.controlMode !== 'supported' || !p.feet || !p.pose || him.rag) {
        r.fell ||= p.rag !== null || p.controlMode !== 'supported';
        return;
      }
      const J = p.pose.jointLandmarksWorld;
      const hip = v3((J.leftHip.x + J.rightHip.x) / 2, 0, (J.leftHip.z + J.rightHip.z) / 2);
      const me = p.proxy.body.translation();
      const to = him.proxy.body.translation();
      const u = norm(v3(to.x - me.x, 0, to.z - me.z));
      const al = (a: Vec3) => dot(v3(a.x - hip.x, 0, a.z - hip.z), u);
      const planted = (s: ArmSide) => p.feet!.feet[s].mode === 'planted';
      if (planted('left') && planted('right')) {
        r.ticks++;
        if ((al(J.leftAnkle) + al(J.rightAnkle)) / 2 < 0) r.ahead++;
      }
      if (!planted('left') && !planted('right')) r.bothUp++;
      for (const s of SIDES) {
        if (planted(s) && was[s] === false) r.landings.push(al(s === 'left' ? J.leftAnkle : J.rightAnkle));
        was[s] = planted(s);
      }
    },
  });
  sim.runToEnd();
  return r;
}

describe('plan 16 (p38), a man knocked back on the lean-in keeps his feet behind his hips', () => {
  it('BL-F3-blockerDrives B, from the strike through the knock-back and the re-anchor (0.6-2.5 s): his hips ahead of his feet nearly throughout, each step back landing behind his hips, one foot at a time; fault twin: the athletic stance, his feet ahead of his hips and his steps landing ahead of them', async () => {
    const on = await knockedBack(sceneOn('BL-F3-blockerDrives', 'lean', 2.5), 'B', 0.6);
    expect(on.fell).toBe(false);
    expect(on.ticks).toBeGreaterThan(300);
    expect(on.ahead / on.ticks).toBeGreaterThan(0.9);
    expect(on.landings.length).toBeGreaterThanOrEqual(2);
    for (const a of on.landings) expect(a, `landing ${(a * 100).toFixed(1)} cm ahead of his hips`).toBeLessThan(0);
    expect(on.bothUp).toBe(0);
    const off = await knockedBack(sceneOn('BL-F3-blockerDrives', 'athletic', 2.5), 'B', 0.6);
    expect(off.ahead / off.ticks).toBeLessThan(0.2);
    expect(off.landings.filter((a) => a > 0).length).toBeGreaterThan(off.landings.length / 2);
  }, 120_000);
});
