// Plan 16 (p38), the lean-in (LEAN_IN_V1, `leanInStances`, `withLeanIn`): the feet behind the hips and the body inclined
// into his man. Constructed: the stance's constraints on the BL body, the pose's rule for the rear foot on its ball
// (`ballAheadM`) agreeing with the derivation, the contest counting a foot on its ball as set, the support asking the
// stance's height whole. Then the BL scenes rebuilt on the lean-in (fixtures/blocking.ts `blockScene`): a man knocked back
// keeps his feet behind his hips, and each step he takes back lands behind them. Each has its fault twin: the athletic
// stance (ATHLETIC_V2, his feet ahead of his hips), the flat foot's rule, the contest's own set limit, the preparation drop.
import { describe, expect, it } from 'vitest';
import { ballAheadM, contestFeet, CONTEST_V1, flatAheadM, legForThigh, shinForAnkleRad } from '../src/sim/block-base';
import type { ArmSide } from '../src/sim/contracts';
import { ATHLETIC_V2, athleticStances, BLOCK_STRIKE_V1, BLOCK_V1, LEAN_IN_V1, LEAN_IN_V2, leanInStances, withContest, withLeanIn, withStrike, type LeanInStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import type { SuspensionSupport } from '../src/sim/profiles';
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
  const range = deg(S.ankleDeg ?? L.dorsiDeg);
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

/**
 * The lean-in's constraints, each as a viewer reads it (the ball's limit `stepDeg`, the knees' power range 40-70 deg; the
 * feet's mid-point at least `feet.midM` behind the hips, the front foot no more than `feet.frontM` ahead of them). The low
 * lean-in (p39) bends the knees to 95 at the load and stands the feet less far behind (`LOW`).
 */
const TALL = { kneeDeg: [40, 70], feet: { midM: -0.03, frontM: 0.01 } };
const LOW = { kneeDeg: [40, 95], feet: { midM: -0.01, frontM: 0.03 } };
function meets(st: Stood, stepDeg: number, C = TALL): string[] {
  const bad: string[] = [];
  const mid = (st.rearM + st.frontM) / 2;
  if (!(mid < C.feet.midM && st.frontM < C.feet.frontM)) bad.push('his hips are not ahead of his feet');
  const P = st.phases;
  if (Object.values(P).some((p) => p.pitchDeg > stepDeg + 1e-9)) bad.push('a foot past the ball (on its toes)');
  if (L.shoeM * Math.sin(deg(Math.max(...Object.values(P).map((p) => p.pitchDeg)))) > 0.075) bad.push('a heel higher than the limit');
  if (Object.values(P).some((p) => p.kneeDeg < C.kneeDeg[0] || p.kneeDeg > C.kneeDeg[1])) bad.push('a knee out of its power range');
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

  it('LEAN_IN_V2 (p39), the low lean-in on the ankle\'s 38 deg: its constraints (the feet behind the hips, the rear foot on its ball within the limit, the knees 40-95), the set stance\'s hips under 0.82 m, the load sinking 6 cm from it and the strike rising 12 cm over the load, the load\'s root inside the suspension\'s lowest (0.72); fault twin: the same thighs on the profile\'s 25 deg stand his feet ahead of his hips', () => {
    const st = leanStood(LEAN_IN_V2);
    expect(meets(st, LEAN_IN_V2.ball.stepDeg, LOW)).toEqual([]);
    expect(st.rearM).toBeLessThan(-0.04);
    const P = st.phases;
    expect(P.set.hipM).toBeLessThan(0.82);
    expect(P.set.hipM - P.load.hipM).toBeGreaterThan(0.06);
    expect(P.strike.hipM - P.load.hipM).toBeGreaterThan(0.12);
    expect(leanInStances(LEAN_IN_V2, L).load.heightM).toBeGreaterThanOrEqual((FIX('BL-F1-even').support as SuspensionSupport).targetRangeM[0]);
    expect(P.load.kneeDeg).toBeGreaterThan(85);
    expect(leanInStances(LEAN_IN_V2, L).flat.dorsiDeg).toBe(38);
    const { ankleDeg: _a, ...at25 } = LEAN_IN_V2;
    expect(meets(leanStood(at25), LEAN_IN_V2.ball.stepDeg, LOW)).toContain('his hips are not ahead of his feet');
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

// ------------------------------------------------------------------ the low lean-in (p39): load low, explode up
interface Rise {
  /** Per man: hips over the ground (the drawn hip joints' mid-point, m) as the load began, the least through the load, at his first palm's landing, the most in the 0.3 s after it. */
  m: Record<string, { setM: number; loadM: number; contactM: number; peakM: number }>;
  /** Both men's most dorsiflexed planted ankle (deg). */
  dorsiDeg: number;
  fell: boolean;
}

async function rise(def: FixtureDef): Promise<Rise> {
  const r: Rise = { m: {}, dorsiDeg: 0, fell: false };
  const st: Record<string, { set?: number; load: number; strikeT?: number; contactT?: number; contact?: number; peak: number }> = {};
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      for (const p of sim.players) {
        if (p.rag || p.controlMode !== 'supported') {
          r.fell = true;
          continue;
        }
        if (!p.pose) continue;
        const J = p.pose.jointLandmarksWorld;
        const hipM = (J.leftHip.y + J.rightHip.y) / 2;
        const s = (st[p.id] ??= { load: Infinity, peak: -Infinity });
        const ph = p.block?.punch?.phase;
        if (ph === 'load' && s.set === undefined) s.set = hipM;
        if (ph === 'load' && s.strikeT === undefined) s.load = Math.min(s.load, hipM);
        if (ph === 'strike' && s.strikeT === undefined) s.strikeT = sim.t;
        const on = SIDES.some((side) => !!sim.arms!.pushOf(p.id, side));
        if (on && s.contactT === undefined && s.strikeT !== undefined) ((s.contactT = sim.t), (s.contact = hipM));
        if (s.contactT !== undefined && sim.t <= s.contactT + 0.3 + 1e-9) s.peak = Math.max(s.peak, hipM);
        for (const side of SIDES) if (p.feet?.feet[side].mode === 'planted') r.dorsiDeg = Math.max(r.dorsiDeg, -(p.pose.anklePitchDeg?.[side] ?? 0));
      }
    },
  });
  sim.runToEnd();
  sim.dispose();
  for (const [id, s] of Object.entries(st)) r.m[id] = { setM: s.set ?? NaN, loadM: s.load, contactM: s.contact ?? NaN, peakM: s.peak };
  return r;
}

const onStance = (id: string, S: LeanInStance, durationS: number): FixtureDef => {
  const o = BL_SCENES.find((x) => x.id === id)!;
  return blockScene({ ...o, A: { ...o.A, athletic: undefined, leanIn: S }, B: { ...o.B, athletic: undefined, leanIn: S }, durationS }, FIX('L3-F6-hold'));
};

describe('plan 16 (p39), the low lean-in: load low, explode up', () => {
  it('BL-F1-even on LEAN_IN_V2 (1.5 s): each man stands with his hips under 0.83 m, sinks at least 4 cm in the load and rises at least 5 cm from it in the 0.3 s after his palms land, his planted ankles bending past 25 and never past 38, and stays up; fault twin: LEAN_IN_V1, hips about 0.90, a sink and a rise of 1-2 cm', async () => {
    const on = await rise(onStance('BL-F1-even', LEAN_IN_V2, 1.5));
    expect(on.fell).toBe(false);
    for (const id of ['A', 'B']) {
      const m = on.m[id];
      const say = `${id}: set ${m.setM.toFixed(3)} load ${m.loadM.toFixed(3)} contact ${m.contactM.toFixed(3)} peak ${m.peakM.toFixed(3)}`;
      expect(m.setM, say).toBeLessThan(0.83);
      expect(m.setM - m.loadM, say).toBeGreaterThan(0.04);
      expect(m.peakM - m.loadM, say).toBeGreaterThan(0.05);
    }
    expect(on.dorsiDeg).toBeGreaterThan(30);
    expect(on.dorsiDeg).toBeLessThanOrEqual(38 + 1e-6);
    const off = await rise(onStance('BL-F1-even', LEAN_IN_V1, 1.5));
    for (const id of ['A', 'B']) {
      const m = off.m[id];
      expect(m.setM).toBeGreaterThan(0.88);
      expect(m.setM - m.loadM).toBeLessThan(0.02);
      expect(m.peakM - m.loadM).toBeLessThan(0.04);
    }
    expect(off.dorsiDeg).toBeLessThanOrEqual(25 + 1e-6);
  }, 120_000);
});
