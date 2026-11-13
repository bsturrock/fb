// Contact motion polish 1.1: the tackler's strike (WRAP_V4, `WrapProfile.strike`, src/sim/controllers/wrap.ts) on the
// hip hinge (src/sim/hinge.ts). Measured on the front wrap and the wrap that misses, run with the profile; each case has
// its fault twin: the same run with the rule it checks broken (`SimDebug.wrap`) fails for that reason.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../src/sim/contracts';
import { WRAP_V4, type WrapDebug } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { hingePivot, legRotation, type HingeState } from '../src/sim/hinge';
import { Simulation } from '../src/sim/simulation';
import { add, cross, deg, dot, horiz, len, norm, qFromAxisAngle, qRot, sub, upOf, v3, vc, UP } from '../src/sim/vec';
import { FIX } from './helpers';

const strike = (id: string): FixtureDef => ({ ...FIX(id), wrap: WRAP_V4 });
const SIDES = ['left', 'right'] as const;

interface StrikeRun {
  /** First substep the defender's body touches the carrier's (s). */
  contactS: number | null;
  /** The defender's trunk pitch (deg from vertical) there. */
  pitchAtContactDeg: number | null;
  /** First substep the defender is off his support (s). */
  defenderLossS: number | null;
  /** Each upper arm's angle from the trunk's down axis (deg) at the first substep the gap is 0.3 m or less. */
  abductionAtGapDeg: Record<(typeof SIDES)[number], number> | null;
  /**
   * How far the defender's facing is turned away from the carrier's motion across the approach (the sine of the turn;
   * positive: his head and far shoulder behind the carrier, the near shoulder leading), at the first 0.5 m gap.
   */
  turnBehindAtGap: number | null;
  /** The defender's trunk pitch at the end, and his largest legs' lean (deg). */
  endPitchDeg: number;
  maxLegsDeg: number;
}

async function strikeRun(def: FixtureDef, untilS: number, fault?: WrapDebug): Promise<StrikeRun> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.(), ...(fault ? { debug: { wrap: fault } } : {}) });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out: StrikeRun = { contactS: null, pitchAtContactDeg: null, defenderLossS: null, abductionAtGapDeg: null, turnBehindAtGap: null, endPitchDeg: NaN, maxLegsDeg: 0 };
  probe = () => {
    if (D.controlMode !== 'supported' && out.defenderLossS === null) out.defenderLossS = sim.t;
    if (D.controlMode !== 'supported' || D.rag || R.rag) return;
    const q = D.proxy.body.rotation();
    const up = upOf(q);
    const pitch = deg(Math.acos(Math.min(1, up.y)));
    out.endPitchDeg = pitch;
    out.maxLegsDeg = Math.max(out.maxLegsDeg, deg(D.balance.theta));
    const gap = sim.pairGap[pairKey('D', 'R')] ?? Infinity;
    const touching = (sim.contactObs.D ?? []).some((c) => c.other === 'R');
    if (touching && out.contactS === null) {
      out.contactS = sim.t;
      out.pitchAtContactDeg = pitch;
    }
    if (out.abductionAtGapDeg === null && out.contactS === null && gap <= 0.3) {
      const ob = sim.arms!.obs('D')!;
      const down = v3(-up.x, -up.y, -up.z);
      const abd = (s: (typeof SIDES)[number]): number => deg(Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(ob[s]!.elbowWorld, ob[s]!.shoulderWorld)), down)))));
      out.abductionAtGapDeg = { left: abd('left'), right: abd('right') };
    }
    if (out.turnBehindAtGap === null && gap <= 0.5) {
      const Rc = vc(R.proxy.body.worldCom());
      const side = norm(cross(norm(horiz(sub(vc(D.proxy.body.translation()), Rc))), UP));
      const vl = dot(sub(horiz(vc(R.proxy.body.linvel())), horiz(vc(D.proxy.body.linvel()))), side);
      out.turnBehindAtGap = -dot(norm(horiz(qRot(q, v3(0, 0, 1)))), side) * Math.sign(vl);
    }
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  return out;
}

describe('contact motion polish 1.1: the hip hinge', () => {
  // a body pitched 30 deg forward about its own lateral axis, its legs' desired up vertical, the hinge holding all of it
  const q = qFromAxisAngle(v3(1, 0, 0), (30 * Math.PI) / 180);
  const h: HingeState = { rad: (30 * Math.PI) / 180, capRad: (30 * Math.PI) / 180, rateRadPerS: 0, dropM: 0 };
  const origin = v3(0, 0.83, 0);
  const com = add(origin, qRot(q, v3(0, 0.221, 0.008)));
  const local = v3(0, -0.79, 0);
  it('puts the support pivot below the centre of mass in the legs frame (fault twin: the body frame, 0.5 m off)', () => {
    const p = hingePivot(h, q, origin, com, local, UP);
    expect(len(horiz(sub(p, com)))).toBeLessThan(0.01);
    const body = add(origin, qRot(q, local));
    expect(len(horiz(sub(body, com)))).toBeGreaterThan(0.5);
  });
  it('reads the legs upright under a pitch the hinge holds, and the excess beyond it as lean (fault twin: no hinge share)', () => {
    expect(deg(Math.acos(upOf(legRotation(h, q, UP)).y))).toBeLessThan(0.01);
    const over = qFromAxisAngle(v3(1, 0, 0), (40 * Math.PI) / 180);
    expect(deg(Math.acos(upOf(legRotation(h, over, UP)).y))).toBeCloseTo(10, 3);
    expect(deg(Math.acos(upOf(legRotation({ ...h, capRad: 0 }, q, UP)).y))).toBeCloseTo(30, 3);
  });
});

describe('contact motion polish 1.1: the strike', () => {
  it('meets the carrier with the trunk pitched well forward and still on his feet (fault twin: the balance reads the pitched trunk, he falls first)', async () => {
    const on = await strikeRun(strike('L3-F19-front'), 0.7);
    expect(on.contactS).not.toBeNull();
    expect(on.pitchAtContactDeg!).toBeGreaterThan(30);
    expect(on.defenderLossS === null || on.defenderLossS > on.contactS!).toBe(true);
    const fault = await strikeRun(strike('L3-F19-front'), 0.7, { trunkBalance: true });
    expect(fault.defenderLossS).not.toBeNull();
    expect(fault.contactS === null || fault.defenderLossS! < fault.contactS).toBe(true);
  }, 60_000);

  it('throws the arms wide from the shoulders before the hit (fault twin: no elbow pole, the elbows hang)', async () => {
    const on = await strikeRun(strike('L3-F19-front'), 0.5);
    expect(Math.min(on.abductionAtGapDeg!.left, on.abductionAtGapDeg!.right)).toBeGreaterThan(80);
    const fault = await strikeRun(strike('L3-F19-front'), 0.5, { noPole: true });
    expect(Math.max(fault.abductionAtGapDeg!.left, fault.abductionAtGapDeg!.right)).toBeLessThan(60);
  }, 60_000);

  it('turns the head behind a carrier crossing the approach, never across his front (fault twin: the side rule reversed)', async () => {
    const on = await strikeRun(strike('L3-F19-miss'), 0.7);
    expect(on.turnBehindAtGap!).toBeGreaterThan(0.25);
    const fault = await strikeRun(strike('L3-F19-miss'), 0.7, { headAcross: true });
    expect(fault.turnBehindAtGap!).toBeLessThan(0.1);
  }, 60_000);

  it('straightens up and runs on after a miss, on his feet (fault twin: the strike held, he stays pitched)', async () => {
    const on = await strikeRun(strike('L3-F19-miss'), 1.25);
    expect(on.defenderLossS).toBeNull();
    expect(on.endPitchDeg).toBeLessThan(15);
    expect(on.maxLegsDeg).toBeLessThan(20);
    const fault = await strikeRun(strike('L3-F19-miss'), 1.25, { strikeHeld: true });
    expect(fault.defenderLossS !== null || fault.endPitchDeg > 30).toBe(true);
  }, 60_000);
});
