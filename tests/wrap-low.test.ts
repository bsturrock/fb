// Contact motion polish 1.4: the low strike of the deep crouch tackle (WRAP_V6, `WrapStrike` deeper and earlier,
// `WrapProfile.low`, src/sim/controllers/wrap.ts). No fixture uses it: the cases are the front and rear wraps run with
// the profile, the front one constructed with a longer approach (the registered one meets the carrier 0.43 s in, inside
// the 0.85 s the hinge's rate bounds need to fold 75 deg). Each case has its twin: WRAP_V5 (or V6 with V5's onset, or V6
// without the walk) fails it for the reason it checks. The cases measure the low strike as it was built, on WRAP_V5
// (`WRAP_V6_PRE`): WRAP_V6 now rides on WRAP_V8, whose bound-legs fall takes the rear-wrap carrier down before the near
// palm gets round him (tests/wrap-bind.test.ts).
import { describe, expect, it } from 'vitest';
import { WRAP_V5, WRAP_V6, shapeAt, walkAzDeg, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { Simulation } from '../src/sim/simulation';
import { cross, deg, dot, horiz, len, norm, sub, vc, UP, type Vec3 } from '../src/sim/vec';
import { sideSignX } from '../src/sim/profiles';
import { FIX } from './helpers';

/**
 * WRAP_V6 as built (commit f14f7f7 to 0e6c637): the low strike and the low arms on WRAP_V5, its hinge bounded at 75 deg. The
 * same values as WRAP_V6's own strike and low arms, without the ride-down and the bound-legs fall it now has.
 */
const WRAP_V6_PRE: WrapProfile = {
  ...WRAP_V5,
  id: 'wrap-low-v6',
  strike: { ...WRAP_V6.strike!, hinge: { ...WRAP_V6.strike!.hinge, maxDeg: 75 } },
  low: WRAP_V6.low!,
};

const SIDES = ['left', 'right'] as const;

/** `id` run with `wrap`; `backM`: the wrapping defender starts that much further back along his line. */
function low(id: string, wrap: WrapProfile, backM = 0): FixtureDef {
  const d = FIX(id);
  const players = d.players.map((p) => {
    if (p.controller.kind !== 'wrapAttempt' || !backM) return p;
    const v = p.initial.velocity!;
    const n = Math.hypot(v.x, v.z);
    return { ...p, initial: { ...p.initial, x: p.initial.x - (v.x / n) * backM, z: p.initial.z - (v.z / n) * backM } };
  });
  return { ...d, wrap, players, area: { ...d.area, halfX: d.area.halfX + backM, halfZ: d.area.halfZ + backM } };
}

interface LowRun {
  /** At the first substep the bodies touch: the commanded hinge (deg), the stance target (m), the shoulders' mean height (m). */
  contact: { t: number; hingeDeg: number; targetM: number; shoulderY: number } | null;
  /** The stance floor (m). */
  floorM: number;
  /** The arm targets' height above the carrier's root while opening, and their distance from his axis while holding (m). */
  openY: number[];
  closeR: number[];
  /**
   * While closing (phase close or sustain, both bodies on their feet): each arm's target and palm in the carrier's frame at
   * the band (azimuth from his near face on the arm's own side, deg; distance from his axis, m), and the least distance
   * from his axis of the straight segment from the palm to the target (m).
   */
  closing: { palmAz: number; targetAz: number; palmR: number; targetR: number; segMinR: number }[];
}

/** The least distance from the origin of the segment a-b (horizontal). */
function segMin(a: Vec3, b: Vec3): number {
  const d = sub(b, a);
  const t = Math.max(0, Math.min(1, -dot(a, d) / Math.max(1e-12, dot(d, d))));
  return len(horiz({ x: a.x + d.x * t, y: 0, z: a.z + d.z * t }));
}

async function lowRun(def: FixtureDef, untilS: number): Promise<LowRun> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.() });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out: LowRun = { contact: null, floorM: sim.suspension!.targetRangeM[0], openY: [], closeR: [], closing: [] };
  probe = () => {
    if (D.controlMode !== 'supported' || R.controlMode !== 'supported' || D.rag || R.rag) return;
    const touching = (sim.contactObs.D ?? []).some((c) => c.other === 'R');
    if (touching && out.contact === null) {
      const ob = sim.arms!.obs('D')!;
      out.contact = { t: sim.t, hingeDeg: deg(D.hinge?.rad ?? 0), targetM: D.sus!.targetM, shoulderY: (ob.left!.shoulderWorld.y + ob.right!.shoulderWorld.y) / 2 };
    }
    const arms = (D.intent.debug as { arms?: Record<string, { phase: string; target?: Vec3 }> } | undefined)?.arms ?? {};
    const Rp = vc(R.proxy.body.translation());
    for (const s of SIDES) {
      const a = arms[s];
      if (!a?.target) continue;
      // (the target is decided at the tick's start: the carrier has moved on by up to a tick since)
      if (a.phase === 'open') out.openY.push(a.target.y - Rp.y);
      // (holding: the phase shown is the one after the substep's transition, so a 'close' can carry the cradle's target)
      if (a.phase === 'sustain') out.closeR.push(len(horiz(sub(a.target, Rp))));
      if (a.phase === 'sustain' || a.phase === 'close') {
        const ob = sim.arms!.obs('D')![s]!;
        const near = norm(horiz(sub(vc(D.proxy.body.translation()), Rp)));
        const sgn = sideSignX(D.body, s);
        const side = cross(near, UP);
        const p = horiz(sub(ob.palmContactWorld, Rp));
        const q = horiz(sub(a.target, Rp));
        const az = (v: Vec3): number => deg(Math.atan2(sgn * dot(v, side), dot(v, near)));
        out.closing.push({ palmAz: az(p), targetAz: az(q), palmR: len(p), targetR: len(q), segMinR: segMin(p, q) });
      }
    }
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  sim.dispose();
  return out;
}

describe('contact motion polish 1.4: the low strike (WRAP_V6_PRE)', () => {
  it('arrives folded at his lowest stance: on a front wrap with time to fold (constructed: the defender 4 m further back), at the first touch the hinge asks over 70 deg and the stance target is at its floor, the shoulders under 0.95 m (the carrier\'s hip). The twins: WRAP_V5 asks its 40 deg cap and stands higher; V6 with V5\'s onset (0.6 s, 0.8 m) is still folding at the touch', async () => {
    const on = await lowRun(low('L3-F19-front', WRAP_V6_PRE, 4), 1.3);
    expect(on.contact, JSON.stringify(on.contact)).not.toBeNull();
    expect(on.contact!.hingeDeg, JSON.stringify(on.contact)).toBeGreaterThan(70);
    expect(on.contact!.targetM, JSON.stringify(on.contact)).toBeLessThanOrEqual(on.floorM + 0.005);
    expect(on.contact!.shoulderY, JSON.stringify(on.contact)).toBeLessThan(0.95);
    const v5 = await lowRun(low('L3-F19-front', WRAP_V5, 4), 1.3);
    expect(v5.contact!.hingeDeg, JSON.stringify(v5.contact)).toBeLessThanOrEqual(40 + 1e-6);
    expect(v5.contact!.targetM, JSON.stringify(v5.contact)).toBeGreaterThan(v5.floorM + 0.02);
    expect(v5.contact!.shoulderY, JSON.stringify(v5.contact)).toBeGreaterThan(1.1);
    const late = await lowRun(low('L3-F19-front', { ...WRAP_V6_PRE, strike: { ...WRAP_V6_PRE.strike!, leadS: WRAP_V5.strike!.leadS, gapM: WRAP_V5.strike!.gapM } }, 4), 1.3);
    expect(late.contact!.hingeDeg, JSON.stringify(late.contact)).toBeLessThan(65);
  }, 60_000);

  it('aims the arms round the carrier under his pelvis box: opening at 5 cm below his root, closing on the support capsule (the walk\'s targets just outside its radius). The twin: WRAP_V5 opens at the band 22 cm above his root and closes inside his torso box', async () => {
    const tBody = FIX('L3-F19-rear').players.find((p) => p.id === 'R')!.body;
    const C = tBody.compound;
    // the shape at the band: below the pelvis box, the capsule alone; at V5's band, the torso box
    expect(WRAP_V6_PRE.low!.bandYLocal).toBeLessThan(C.pelvis.center.y - C.pelvis.halfExtents.y);
    const q = { x: 0, y: 0, z: 0, w: 1 };
    expect(shapeAt(tBody, q, { x: 1, y: 0, z: 0 }, WRAP_V6_PRE.low!.bandYLocal)).toBeCloseTo(C.support.radius, 9);
    expect(shapeAt(tBody, q, { x: 1, y: 0, z: 0 }, 0.22)).toBeCloseTo(C.torso.halfExtents.x, 9);
    const want = C.support.radius + WRAP_V6_PRE.low!.walk!.extraM;
    const on = await lowRun(low('L3-F19-rear', WRAP_V6_PRE), 0.8);
    expect(on.openY.length).toBeGreaterThan(0);
    expect(Math.max(...on.openY.map((y) => Math.abs(y - WRAP_V6_PRE.low!.bandYLocal)))).toBeLessThan(0.01);
    expect(on.closeR.length).toBeGreaterThan(0);
    expect(Math.max(...on.closeR.map((r) => Math.abs(r - want))), JSON.stringify(on.closeR.slice(0, 4))).toBeLessThan(0.02);
    const v5 = await lowRun(low('L3-F19-rear', WRAP_V5), 0.8);
    expect(Math.min(...v5.openY)).toBeGreaterThan(0.2);
    expect(Math.max(...v5.closeR.map((r) => Math.abs(r - want)))).toBeGreaterThan(0.03);
  }, 60_000);

  it('walks the closing palm round the carrier\'s shape (constructed: palms round from his near corner, on and off the support capsule at the band): the target leads the palm by up to 30 deg toward his back and is reached on a straight line that stays outside the capsule. The twin: the old target (150 deg, 5 cm inside) is behind the surface from the palm', () => {
    const W = WRAP_V6_PRE.low!.walk!;
    const rc = FIX('L3-F19-rear').players.find((p) => p.id === 'R')!.body.compound.support.radius;
    const at = (azDeg: number, r: number): Vec3 => ({ x: r * Math.sin((azDeg * Math.PI) / 180), y: 0, z: r * Math.cos((azDeg * Math.PI) / 180) });
    const corner = 45;
    let oldBehind = 0;
    for (const r of [rc + 0.01, rc + 0.03, rc + 0.06, rc + 0.15])
      for (let a = corner; a <= 170; a += 5) {
        const p = at(a, r);
        const t = walkAzDeg(W, a, corner);
        expect(t, `palm ${a}`).toBeGreaterThan(Math.min(Math.max(a, corner), W.endDeg - 1e-9) - 1e-9);
        expect(t - Math.max(a, corner)).toBeLessThanOrEqual(W.leadDeg + 1e-9);
        expect(t).toBeLessThanOrEqual(W.endDeg);
        expect(segMin(p, at(t, rc + W.extraM)), `palm ${a} r ${r}`).toBeGreaterThanOrEqual(rc);
        if (a >= 100 && a <= 125 && segMin(p, at(WRAP_V6_PRE.close!.azDeg, rc - WRAP_V6_PRE.close!.depthM)) < rc) oldBehind++;
      }
    // the twin: from the palm where it stopped (110-125 deg), the old target is reached only through the capsule
    expect(oldBehind).toBe(4 * 6);
  });

  it('on a rear wrap with time to fold (constructed: the defender 2 m further back) every closing target leads its palm round the capsule and is reached on a straight line outside it, and the near palm gets further round him than the old target let it. The twin: V6 without the walk aims behind the surface and its near palm stops short', async () => {
    const on = await lowRun(low('L3-F19-rear', WRAP_V6_PRE, 2), 2.4);
    const rc = FIX('L3-F19-rear').players.find((p) => p.id === 'R')!.body.compound.support.radius;
    // (on the capsule: the palm round from his near face's corner; the target decided at the tick's start)
    const round = on.closing.filter((c) => c.palmAz > 60 && c.palmR < rc + 0.08);
    expect(round.length).toBeGreaterThan(100);
    for (const c of round) {
      expect(c.targetAz - c.palmAz, JSON.stringify(c)).toBeGreaterThan(-3);
      expect(c.segMinR, JSON.stringify(c)).toBeGreaterThan(rc - 0.01);
    }
    const old = await lowRun(low('L3-F19-rear', { ...WRAP_V6_PRE, low: { bandYLocal: WRAP_V6_PRE.low!.bandYLocal } }, 2), 2.4);
    const oldRound = old.closing.filter((c) => c.palmAz > 60 && c.palmR < rc + 0.08);
    expect(oldRound.filter((c) => c.segMinR < rc - 0.03).length).toBeGreaterThan(oldRound.length / 2);
    expect(Math.max(...on.closing.map((c) => c.palmAz))).toBeGreaterThan(Math.max(...old.closing.map((c) => c.palmAz)) + 5);
  }, 60_000);
});
