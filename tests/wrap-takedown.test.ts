// Contact motion M3 step 3: the committed finish (WRAP_V2's `commit`, src/sim/controllers/wrap.ts; the simulation's
// 'takedown' conversion). Measured on the front and rear wraps (L3-F19), whose defender takes a secure two-arm hold, and
// on constructed variants of them; each case has its fault twin: the same run with the rule it checks broken (or
// without the commit) fails for that reason.
import { describe, expect, it } from 'vitest';
import { WRAP_V1, WRAP_V2, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { Simulation } from '../src/sim/simulation';
import { FIX } from './helpers';

const C = WRAP_V2.commit!;
const SUB = 1 / 240;

const withWrap = (d: FixtureDef, w: WrapProfile, o: Partial<FixtureDef> = {}): FixtureDef => ({ ...d, wrap: w, ...o });
const commitWith = (c: Partial<typeof C>): WrapProfile => ({ ...WRAP_V2, commit: { ...C, ...c } });
/** `d` with the defender's arms off from `s` (released: the hold he had breaks). */
const armsOffAt = (d: FixtureDef, s: number): FixtureDef => ({
  ...d,
  players: d.players.map((p) => (p.id === 'D' && p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, armsOffAfterS: s } } : p)),
});

interface Run {
  /**
   * Times are the simulation's after each substep. First substep the defender's hold is secure (both arms retaining, a
   * clamp or grip, and touching the carrier), as his controller sees it on the next.
   */
  secureS: number | null;
  /** First substep the defender asks to leave support, and the substep he is lowered (stance request under the standing height). */
  askS: number | null;
  lowerS: number | null;
  /** First substep after the lowering that his stance request is no longer lowered. */
  liftS: number | null;
  /** Support loss of each player (the control-mode event, its time as events carry it: to 1e-5 s) and its reason. */
  loss: Record<'D' | 'R', { t: number; why: string } | null>;
  handoff: Simulation['players'][number]['handoff'];
}

async function run(def: FixtureDef, untilS: number): Promise<Run> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.() });
  const D = sim.players.find((p) => p.id === 'D')!;
  const out: Run = { secureS: null, askS: null, lowerS: null, liftS: null, loss: { D: null, R: null }, handoff: null };
  probe = () => {
    const a = sim.arms!.obs('D') ?? {};
    const held = (s: 'left' | 'right'): boolean => !!(a[s]?.clampContactId || a[s]?.gripId) && a[s]?.touchingTarget === 'R';
    if (out.secureS === null && D.controlMode === 'supported' && !D.rag && held('left') && held('right')) out.secureS = sim.t;
    if (out.askS === null && D.intent.leaveSupport === 'takedown') out.askS = sim.t;
    const lowered = (D.intent.locomotion.stance?.heightM ?? Infinity) <= C.heightM;
    if (out.lowerS === null && lowered) out.lowerS = sim.t;
    if (out.lowerS !== null && out.liftS === null && !lowered && D.controlMode === 'supported') out.liftS = sim.t;
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  for (const id of ['D', 'R'] as const) {
    const e = sim.events.find((x) => x.type === 'controlMode' && x.playerId === id);
    out.loss[id] = e ? { t: e.t, why: String((e.data as { reason?: string }).reason) } : null;
  }
  out.handoff = D.handoff;
  sim.dispose();
  return out;
}

describe('contact motion M3: a secure hold lowers the defender and takes him down with the carrier (WRAP_V2 commit)', () => {
  it('a secure two-arm hold lowers him and takes him down: in the front and rear wraps he is lowered and leaning 50 ms after the hold is first secure and asks to leave support 0.25 s after it (to the substep), never before; he leaves at the next substep with reason takedown. The fault twin: WRAP_V1 (no commit) leaves him on his feet a second after the hold', async () => {
    for (const id of ['L3-F19-front', 'L3-F19-rear']) {
      const r = await run(withWrap(FIX(id), WRAP_V2), 1.5);
      expect(r.secureS, id).not.toBeNull();
      // (an intent is seen after the substep that decided it: one substep after the hold's clock)
      expect(r.lowerS! - r.secureS!, id).toBeGreaterThanOrEqual(C.secureS - 1e-6);
      expect(r.lowerS! - r.secureS!, id).toBeLessThanOrEqual(C.secureS + 2 * SUB + 1e-6);
      expect(r.askS! - r.secureS!, id).toBeGreaterThanOrEqual(C.secureS + C.lowerS - 1e-6);
      expect(r.askS! - r.secureS!, id).toBeLessThanOrEqual(C.secureS + C.lowerS + 2 * SUB + 1e-6);
      expect(r.loss.D?.why, id).toBe('takedown');
      expect(r.loss.D!.t, id).toBeCloseTo(r.askS!, 4);
      const twin = await run(withWrap(FIX(id), WRAP_V1), r.secureS! + 1);
      expect(twin.secureS, id).toBeCloseTo(r.secureS!, 9);
      expect(twin.askS, id).toBeNull();
      expect(twin.loss.D, id).toBeNull();
    }
  }, 60000);

  it('if the carrier he holds securely is off his support first, he follows at once (constructed: the front wrap with a 1 s lowering, the carrier converted, labelled, 0.1 s into the hold): he asks on the substep he sees the carrier down and leaves at the next. The fault twin: under WRAP_V1 he stays up for over half a second', async () => {
    const at = 0.6;
    const def = (w: WrapProfile): FixtureDef => withWrap(FIX('L3-F19-front'), w, { diagnostics: { conversions: [{ playerId: 'R', atS: at }] } });
    const r = await run(def(commitWith({ lowerS: 1 })), 1.5);
    expect(r.secureS!).toBeLessThan(at - 0.05);
    expect(r.loss.R?.why).toBe('diagnostic');
    expect(r.loss.R!.t).toBeCloseTo(at, 2);
    expect(r.askS! - r.loss.R!.t).toBeLessThanOrEqual(SUB + 1e-4);
    expect(r.loss.D!.why).toBe('takedown');
    expect(r.loss.D!.t - r.loss.R!.t).toBeLessThanOrEqual(SUB + 1e-4);
    const twin = await run(def(WRAP_V1), 1.5);
    expect(twin.loss.R!.why).toBe('diagnostic');
    expect(twin.loss.D === null || twin.loss.D.t - twin.loss.R!.t > 0.5).toBe(true);
  }, 60000);

  it('a broken hold or a miss does not commit: the front wrap\'s arms let go 0.1 s into the hold, during the lowering, and he stands up again without leaving support or converting the carrier; the miss (L3-F19-miss) never holds and never asks; a one-arm hold (L3-F4-oneArm) never asks. The fault twin: a hold that never starts over (graceS without end) takes him down 0.25 s after the hold he no longer has', async () => {
    const base = await run(withWrap(FIX('L3-F19-front'), WRAP_V2), 1);
    const off = base.secureS! + 0.1;
    const broken = await run(armsOffAt(withWrap(FIX('L3-F19-front'), WRAP_V2), off), 1.5);
    expect(broken.lowerS).not.toBeNull();
    expect(broken.liftS! - off).toBeLessThanOrEqual(C.graceS + 2 * SUB + 1e-6);
    expect(broken.askS).toBeNull();
    expect(broken.loss.D).toBeNull();
    expect(broken.loss.R).toBeNull();
    const miss = await run(withWrap(FIX('L3-F19-miss'), WRAP_V2), 1.25);
    expect(miss.secureS).toBeNull();
    expect(miss.askS).toBeNull();
    expect(miss.loss.D).toBeNull();
    const one = await run(withWrap(FIX('L3-F4-oneArm'), WRAP_V2), 1.6);
    expect(one.askS).toBeNull();
    expect(one.loss.D?.why).not.toBe('takedown');
    const twin = await run(armsOffAt(withWrap(FIX('L3-F19-front'), commitWith({ graceS: Infinity })), off), 1.5);
    expect(twin.askS! - twin.secureS!).toBeCloseTo(C.secureS + C.lowerS, 2);
    expect(twin.loss.D!.why).toBe('takedown');
  }, 60000);

  it('the takedown goes through the validated, audited conversion: momentum carried over (linear and angular relative error under 1e-6), no energy gained past the profile\'s allowance, accepted (front and rear wraps). The fault twin: the same takedown under a validation profile allowing 1 % (L4-F9-transferFailed) is flagged for its energy gain and not completed', async () => {
    for (const id of ['L3-F19-front', 'L3-F19-rear']) {
      const h = (await run(withWrap(FIX(id), WRAP_V2), 1.5)).handoff!;
      expect(h.reason, id).toBe('takedown');
      expect(h.outcome, id).toBe('accepted');
      expect(h.audit!.ok, id).toBe(true);
      expect(h.audit!.linearRelErr, id).toBeLessThan(1e-6);
      expect(h.audit!.angularRelErr, id).toBeLessThan(1e-6);
      expect(h.audit!.energyDeltaJ, id).toBeLessThanOrEqual(h.audit!.energyGainLimitJ);
    }
    const h = (await run(withWrap(FIX('L4-F9-transferFailed'), WRAP_V2), 1.5)).handoff!;
    expect(h.reason).toBe('takedown');
    expect(h.audit!.reasons).toEqual(['energyGain']);
    expect(h.outcome).toBe('transferFailed');
  }, 60000);
});
