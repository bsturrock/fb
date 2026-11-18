// Plan 16 (p35): the base read from the soles and the centre of mass (BASE_V3, `copBounds`, `comBase`, a heel within the
// viewer's limit bearing) and the athletic stance (`athleticStances`, `withAthletic`), on constructed poses and the BL
// body. No registered fixture uses either yet. Each case has its fault twin: the reading from the support's ground point
// (BASE_V2), a heel read by its corners (1 cm), a heel past the limit, feet together, today's stance placed flat (the
// chair: the feet ahead of the centre of mass).
import { describe, expect, it } from 'vitest';
import { BASE_V2, BASE_V3, baseMoments, comBase, copBounds, flatAheadM, legForShin, legForThigh, legShape, limitToBase, soleContacts, SOLE_TOUCH_M, FLAT_V1 } from '../src/sim/block-base';
import type { ArmSide } from '../src/sim/contracts';
import { ATHLETIC_V1, athleticStances, BLOCK_STRIKE_V1, BLOCK_V1, chestShiftM, withAthletic, withFlat, withStrike, type AthleticStance, type BlockStance, type StanceGeometry } from '../src/sim/controllers/block';
import type { FlatStance } from '../src/sim/contracts';
import { based, legOf } from '../src/sim/fixtures/blocking';
import type { FootPlan } from '../src/sim/footwork';
import { cross, dot, norm, qFromAxisAngle, v3, UP, type Vec3 } from '../src/sim/vec';
import { FIX } from './helpers';

const W = 867;
const SHOE = { he: v3(0.09, 0.09, 0.15), centerFoot: v3(0, -0.03, 0.06) };
/** The ankle over a flat sole (m): the sole's bottom is centerFoot.y - he.y below it. */
const ANKLE_Y = 0.12;
const deg = (d: number) => (d * Math.PI) / 180;

/** A constructed foot plan (as block-base.test.ts): each foot planted, its ankle and its pitch (deg, heel up positive) about its own ankle. */
function plan(feet: Record<ArmSide, { ankle: Vec3; heelUpDeg?: number }>): FootPlan {
  const foot = (f: { ankle: Vec3; heelUpDeg?: number }) => {
    const q = qFromAxisAngle(v3(1, 0, 0), deg(f.heelUpDeg ?? 0));
    return { mode: 'planted', ankleW: f.ankle, footQ: q };
  };
  return { shoe: SHOE, feet: { left: foot(feet.left), right: foot(feet.right) } } as unknown as FootPlan;
}

describe('plan 16 (p35), the base read from the soles and the centre of mass (BASE_V3)', () => {
  // facing +z, the man he pushes ahead; his hips at z = 0, his centre of mass 0.10 ahead of them
  const u = v3(0, 0, 1);
  const com = v3(0, 1.0, 0.1);
  // a flat rear foot, its heel 0.03 behind the hips (the ankle 0.06 ahead), the front foot 0.2 further on
  const flat = plan({ left: { ankle: v3(-0.18, ANKLE_Y, 0.26) }, right: { ankle: v3(0.18, ANKLE_Y, 0.06) } });
  const heelZ = 0.06 + SHOE.centerFoot.z - SHOE.he.z;

  it('a flat rear foot behind the centre of mass gives back reach: W times the distance from it to the heel; fault twin, read from the support point (BASE_V2) behind the heel, it gives none', () => {
    const pts = soleContacts(flat, SOLE_TOUCH_M, BASE_V3.soles);
    expect(comBase(pts, com, u, W).back).toBeCloseTo(W * (com.z - heelZ), 6);
    // the hinge's support point lies some 1 m sin(lean) behind the centre of mass: at the posture's 12 deg of lean, 0.21 m
    const pivot = v3(0, 0, com.z - 0.21);
    expect(pivot.z).toBeLessThan(heelZ);
    expect(baseMoments(soleContacts(flat, SOLE_TOUCH_M), pivot, u, W).back).toBe(0);
  });

  it('the identity: the pressure (the support point plus up x tau / W) is only ever brought toward his centre of mass; asked at the support point behind the heel it is held at the heel, asked between the soles it is left alone; fault twin, BASE_V2 leaves it at the support point, behind every sole', () => {
    const pts = soleContacts(flat, SOLE_TOUCH_M, BASE_V3.soles);
    const pivot = v3(0, 0, com.z - 0.21);
    const a = cross(UP, u);
    // up x (a p) = -u p for a level push line: the pressure lies p / W behind the support point
    const tauFor = (copZ: number) => v3(a.x * W * (pivot.z - copZ), 0, a.z * W * (pivot.z - copZ));
    const copOf = (m: ReturnType<typeof copBounds>, copZ: number) => pivot.z - dot(limitToBase(tauFor(copZ), m, u).torque, a) / W;
    const m3 = copBounds(pts, pivot, com, u, W);
    expect(copOf(m3, pivot.z)).toBeCloseTo(heelZ, 6);
    expect(copOf(m3, 0.15)).toBeCloseTo(0.15, 6);
    expect(copOf(m3, heelZ + 0.01)).toBeCloseTo(heelZ + 0.01, 6);
    const m2 = baseMoments(soleContacts(flat, SOLE_TOUCH_M), pivot, u, W);
    expect(copOf(m2, pivot.z)).toBeCloseTo(pivot.z, 6);
  });

  it('a heel up within the limit (3 cm, 10 deg) bears, the whole sole with it; fault twins: read by its corners (1 cm) only the toes bear, and a heel past the limit bears nothing behind the toes', () => {
    // the rear foot on its ball: 5 deg heel up about its ankle (the heel's middle some 2.6 cm above the toes)
    const ball = (d: number) => plan({ left: { ankle: v3(-0.18, ANKLE_Y, 0.26) }, right: { ankle: v3(0.18, ANKLE_Y, 0.06), heelUpDeg: d } });
    const heelOf = (p: FootPlan) => Math.max(...soleContacts(p, 1, undefined).filter((c) => c.x > 0).map((c) => c.y)) - Math.min(...soleContacts(p, 1, undefined).filter((c) => c.x > 0).map((c) => c.y));
    expect(heelOf(ball(5))).toBeGreaterThan(0.02);
    expect(heelOf(ball(5))).toBeLessThan(0.03);
    const back = (p: FootPlan, load?: typeof BASE_V3.soles) => comBase(soleContacts(p, SOLE_TOUCH_M, load), com, u, W).back;
    expect(back(ball(5), BASE_V3.soles)).toBeGreaterThan(0.08 * W);
    expect(back(ball(5))).toBe(0);
    expect(heelOf(ball(8))).toBeGreaterThan(0.03);
    expect(back(ball(8), BASE_V3.soles)).toBe(0);
  });

  it('BASE_V3 is BASE_V2 with the soles read (the brace, the ceiling and the reading as before otherwise)', () => {
    const { soles, id, ...rest } = BASE_V3;
    const { id: _id, ...v2 } = BASE_V2;
    expect(soles).toEqual({ loadHeelM: 0.03, loadPitchDeg: 10 });
    expect(rest).toEqual(v2);
    expect(id).not.toBe(BASE_V2.id);
  });
});

/** The BL body's stance geometry and the height of his centre of mass above his hips (m; the proxy's, about 0.19). */
const G: StanceGeometry = legOf(FIX('L3-F6-hold'), FIX('L3-F6-hold').players.find((p) => p.id === 'D')!.body);
const COM_ABOVE_HIPS_M = 0.19;
const HEEL_M = SHOE.he.z - SHOE.centerFoot.z;
const TOE_M = SHOE.he.z + SHOE.centerFoot.z;

/**
 * Where a block stance stands its feet, flat (the flat stance's rule: the rear shin over its flat foot at the ankle's
 * range less the margin at the stance's lowest root), and where his centre of mass is (along his facing, from his hips).
 */
function standing(s: BlockStance, flat: FlatStance) {
  const hipOverGround = (root: number, trunk: number) => root + G.hipUpM * Math.cos(deg(trunk)) - G.soleM;
  const rear = flatAheadM(G.thighM, G.shinM, hipOverGround(Math.min(s.heightM, flat.lowRootM ?? s.heightM), s.leanDeg + s.hingeDeg), deg(G.dorsiDeg - flat.marginDeg));
  return { rearHeel: rear - HEEL_M, frontToe: rear + s.staggerM + TOE_M, com: COM_ABOVE_HIPS_M * Math.sin(deg(s.leanDeg + s.hingeDeg)) };
}

/** The athletic stance's constraints, each as a viewer reads it. */
function meets(set: BlockStance, load: BlockStance, strike: BlockStance, flat: FlatStance): string[] {
  const bad: string[] = [];
  const st = standing(load, flat);
  if (flat.marginDeg < 0) bad.push('the load leans the shin past the ankle');
  if (!(st.com > st.rearHeel + 0.05 && st.com < st.frontToe)) bad.push('his weight is not over his feet (behind the heels: the chair)');
  if (!(load.heightM < set.heightM && set.heightM < strike.heightM)) bad.push('the load does not sink, or the strike does not rise');
  if (load.heightM < 0.79) bad.push('the hips no higher than today');
  if (set.leanDeg + set.hingeDeg < 28) bad.push('the trunk is not hinged');
  return bad;
}

describe('plan 16 (p35), the athletic stance (ATHLETIC_V1 on the BL body)', () => {
  const d = athleticStances(ATHLETIC_V1, G);

  it('is derived from its angles: the load places the rear ankle, the set stance and the strike stand over the same ankle, each height the hip over it (no per-scene number)', () => {
    const r = (x: number) => (x * 180) / Math.PI;
    const low = legShape(G.thighM, G.shinM, deg(ATHLETIC_V1.load.thighDeg), deg(ATHLETIC_V1.load.shinDeg));
    expect(d.aheadM).toBeCloseTo(low.aheadM, 9);
    expect(r(legForShin(G.thighM, G.shinM, d.aheadM, deg(ATHLETIC_V1.load.shinDeg)).thighRad)).toBeCloseTo(ATHLETIC_V1.load.thighDeg, 6);
    for (const [st, ph] of [[d.stance, ATHLETIC_V1.set], [d.strike, ATHLETIC_V1.strike]] as const) {
      const leg = legForThigh(G.thighM, G.shinM, d.aheadM, deg(ph.thighDeg));
      expect(legShape(G.thighM, G.shinM, deg(ph.thighDeg), leg.shinRad).aheadM).toBeCloseTo(d.aheadM, 9);
      expect(st.heightM).toBeCloseTo(leg.upM + G.soleM - G.hipUpM * Math.cos(deg(ph.trunkDeg)), 9);
      expect(r(leg.shinRad)).toBeLessThan(ATHLETIC_V1.load.shinDeg);
      expect(st.leanDeg + st.hingeDeg).toBeCloseTo(ph.trunkDeg, 9);
    }
    // the flat stance places the feet where the load stands them
    const st = standing(d.load, d.flat);
    expect(st.rearHeel + HEEL_M).toBeCloseTo(d.aheadM, 3);
  });

  it('meets its constraints: shins inside the range, weight over the feet, the load sinking and the strike rising, hips above today\'s, the trunk hinged; fault twin: today\'s stance placed flat (the chair) has his weight behind his heels', () => {
    expect(meets(d.stance, d.load, d.strike, d.flat)).toEqual([]);
    const chair = withFlat(withStrike(based(BLOCK_V1), BLOCK_STRIKE_V1), FLAT_V1, 0.1);
    const bad = meets(chair.stance, chair.strike!.load.stance, chair.strike!.strike.stance, chair.flat!);
    expect(bad).toContain('his weight is not over his feet (behind the heels: the chair)');
    expect(bad).toContain('the hips no higher than today');
    // a load past the ankle's range (fault twin of the margin)
    const past: AthleticStance = { ...ATHLETIC_V1, load: { ...ATHLETIC_V1.load, shinDeg: G.dorsiDeg + 3 } };
    const p = athleticStances(past, G);
    expect(meets(p.stance, p.load, p.strike, p.flat)).toContain('the load leans the shin past the ankle');
  });

  it('a flat-footed man in the stance holds a push 45 deg off his facing that tips the same man with his feet together; fault twin: feet together', () => {
    const st = standing(d.load, d.flat);
    const hipZ = 0;
    const com = v3(0, 1.0, hipZ + st.com);
    const halfW = 0.185;
    const rear = st.rearHeel + HEEL_M;
    const stance = plan({ left: { ankle: v3(-halfW, ANKLE_Y, rear + d.load.staggerM) }, right: { ankle: v3(halfW, ANKLE_Y, rear) } });
    const together = plan({ left: { ankle: v3(-0.1, ANKLE_Y, rear) }, right: { ankle: v3(0.1, ANKLE_Y, rear) } });
    // pushed back along his right-front diagonal at 1.1 m: the moment his feet must give, behind his centre of mass on that line
    const u = norm(v3(-Math.SQRT1_2, 0, Math.SQRT1_2));
    const back = (p: FootPlan) => comBase(soleContacts(p, SOLE_TOUCH_M, BASE_V3.soles), com, u, W).back;
    // 145 N at 1.1 m: the stance gives about 200 N m behind his centre of mass on that line, feet together (shoes touching) 150
    const pushNm = 145 * 1.1;
    expect(back(stance)).toBeGreaterThan(pushNm);
    expect(back(together)).toBeLessThan(pushNm);
  });

  it('withAthletic: the profile on the derived stances, the hinge at its rates bounded by the deepest hinge asked, every chest gap wider by what the deeper pitch brings the chests nearer', () => {
    const p0 = withStrike(based(BLOCK_V1), BLOCK_STRIKE_V1);
    const p = withAthletic(p0, ATHLETIC_V1, G);
    expect(p.id).toBe(`${p0.id}+athletic-v1`);
    expect({ ...p.stance, widthAddM: undefined }).toEqual({ ...d.stance, widthAddM: undefined });
    expect(p.stance.widthAddM).toBe(p0.stance.widthAddM);
    expect(p.strike!.load.stance.heightM).toBe(d.load.heightM);
    expect(p.strike!.strike.stance.heightM).toBe(d.strike.heightM);
    expect(p.flat).toEqual(d.flat);
    expect(p.hinge.maxDeg).toBe(Math.max(p0.hinge.maxDeg, d.stance.hingeDeg, d.load.hingeDeg, d.strike.hingeDeg));
    expect(p.hinge.rateDegPerS).toBe(ATHLETIC_V1.hinge.rateDegPerS);
    const wider = 2 * (chestShiftM(G, ATHLETIC_V1.set.trunkDeg) - chestShiftM(G, p0.stance.leanDeg + p0.stance.hingeDeg));
    expect(wider).toBeGreaterThan(0.05);
    expect(p.approach.holdGapM - p0.approach.holdGapM).toBeCloseTo(wider, 9);
    expect(p.punchGapM - p0.punchGapM).toBeCloseTo(wider, 9);
    expect(p.strike!.loadGapM - p0.strike!.loadGapM).toBeCloseTo(wider, 9);
    expect(p.strike!.load.closeGapM - p0.strike!.load.closeGapM).toBeCloseTo(wider, 9);
    // the strike's own reach (shoulder to chest) and timing untouched
    expect(p.strike!.strike).toEqual({ ...p0.strike!.strike, stance: p.strike!.strike.stance });
  });
});
