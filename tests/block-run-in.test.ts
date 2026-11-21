// Plan 16 (p47): the run-in (`BlockProfile.runIn`, RUN_IN_V1). A constructed scene: A stands 8 m from B (origin to origin)
// and starts blocking at 1.5 s, B is set in the two-point from the reset and steps up into him at the snap (3.3 s, his
// fire-out at 0.7 m/s); the full F9/F10 set. A state captured at 1.4 s is resumed with A running in and, as the twin,
// with his ordinary approach. With its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { blockScene, contested, type BlockMan } from '../src/sim/fixtures/blocking';
import { BLOCK_STRIKE_V5, BLOCK_V1, GAZE_V1, LEAN_IN_V6, RUN_IN_V1, withGaze, withRunIn } from '../src/sim/controllers/block';
import { CONTEST_V2 } from '../src/sim/block-base';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, v3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p47), the run-in', () => {
  const CAPTURE_S = 1.4;
  const END_S = 7;
  function scene(run: boolean): FixtureDef {
    const step = { ...BLOCK_STRIKE_V5, id: 'strike-v5-step-test', fire: { ...BLOCK_STRIKE_V5.fire!, mps: 0.7 } };
    const A: BlockMan = { effort: 0.5, intent: 'drive', hands: 'under', profile: withGaze(contested(run ? withRunIn(BLOCK_V1, RUN_IN_V1) : BLOCK_V1, BLOCK_STRIKE_V5, CONTEST_V2), GAZE_V1), leanIn: LEAN_IN_V6, fromS: 1.5 };
    const B: BlockMan = { effort: 0.5, intent: 'hold', hands: 'over', profile: withGaze(contested(BLOCK_V1, step, CONTEST_V2), GAZE_V1), leanIn: LEAN_IN_V6, stance: { kind: 'two-point', side: 'defense' }, fromS: 3.3 };
    return blockScene({ id: 'BL-T-run-in', title: 'run-in', A, B, sepM: 8, durationS: END_S + 0.1, seat: true, aimThrough: true, stanceCone: true, followThrough: true, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: true, armsGive: true, laneTie: true, burstTaper: true, lowUnheld: true, palmSlide: true, upperArm: true }, FIX('L3-F6-hold'));
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(false));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  /** A's speed toward B as the block goes engaged (m/s), his least over the 0.3 s before it, and when (s). */
  async function run(on: boolean): Promise<{ atContact: number; least: number; t: number }> {
    const sim = await resumeState(await captured(), { def: scene(on), ...(on ? { variant: ['players.0.controller.profile'] } : {}) });
    const [a, b] = sim.players;
    const sp: { t: number; v: number }[] = [];
    let out = { atContact: NaN, least: NaN, t: NaN };
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const ta = a.proxy.body.translation();
      const tb = b.proxy.body.translation();
      const u = norm(v3(tb.x - ta.x, 0, tb.z - ta.z));
      const va = a.proxy.body.linvel();
      sp.push({ t: sim.t, v: dot(v3(va.x, 0, va.z), u) });
      if (a.block?.phase === 'engaged') {
        const before = sp.filter((x) => x.t >= sim.t - 0.3 - 1e-9);
        out = { atContact: sp[sp.length - 1].v, least: Math.min(...before.map((x) => x.v)), t: sim.t };
        break;
      }
    }
    sim.dispose();
    return out;
  }

  it('A runs in: he meets B still at 2.4 m/s or more, not under 2.2 in the 0.3 s before (loading and striking at his own speed); fault twin: his approach brakes him to 1.8 m/s or less', async () => {
    const on = await run(true);
    expect(on.t, 'on: engaged').toBeGreaterThan(3.3);
    expect(on.atContact, "on: A's speed at the contact (m/s)").toBeGreaterThanOrEqual(2.4);
    expect(on.least, "on: A's least speed in the 0.3 s before (m/s)").toBeGreaterThanOrEqual(2.2);
    const off = await run(false);
    expect(off.t, 'twin: engaged').toBeGreaterThan(3.3);
    expect(off.atContact, "fault: A's speed at the contact (m/s)").toBeLessThanOrEqual(1.8);
  }, 180_000);
});
