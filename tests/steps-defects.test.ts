import { describe, expect, it } from 'vitest';
import { asCaptured, preSteps } from './runs';
import { loadState, resumeState } from './state';

// Plan 15 step 4, defects reached by the stepping flip's moved trajectories, each on a capture taken under the flip's
// registration a little before the defect. With the model the tackler goes down later (a tracked limit,
// docs/open/15_Contact_Footwork.md item 1), and two of his conversions there go wrong. The twin with the reactive
// planner from the same state (`preSteps`) shows the same defect: reached, not made by the model's feet. Each test
// fails once its defect is gone from that state; it is then turned into the fix's test, with the fault twin.

const len = (v: number[]): number => Math.hypot(...v);

/** Resumes the capture to the end as registered (the model on) or with the reactive planner from there: player `pid`'s conversion. */
async function conversion(file: string, model: boolean, pid: string) {
  const cap = loadState(`tests/data/state/${file}.json.gz`);
  const def = asCaptured(cap);
  const sim = await resumeState(cap, model ? { def } : { def: preSteps(def), variant: ['footwork'] });
  while (!sim.done) sim.stepTick();
  const pl = sim.players.find((p) => p.id === pid)!;
  const h = pl.handoff;
  const a = h?.audit;
  const rejected = sim.events.find((e) => e.type === 'handoffRejected' && e.playerId === pid);
  const out = {
    outcome: h?.outcome,
    reason: h?.reason,
    t: h?.t,
    representation: pl.representation,
    audit: a?.reasons ?? [],
    gain: a ? (a.after.keJ - a.before.keJ) / a.before.keJ : NaN,
    spin: a ? [len(a.before.w), len(a.after.omega)] : [],
    rejected: rejected ? { reasons: rejected.data!.reasons, rightElbowDeg: (rejected.data!.hingeDeg as Record<string, number>).rightElbow } : null,
    elbowLimitDeg: def.ragdoll!.limitsDeg.elbow[1],
  };
  sim.dispose();
  return out;
}

describe('plan 15 step 4: defects reached by the stepping flip (the tackler going down late)', () => {
  it('TAKEDOWN_ENERGY_GAIN (L3-F1-phase2 reversed, from 1.067 s): the late tackler\'s takedown at 1.133 s gains over half his kinetic energy at the transfer (energyGain: transferFailed), his folded pose\'s centre of mass 15 cm off the proxy\'s, the ragdoll spun up over three times faster than the proxy turned; the reactive planner from the same state the same', async () => {
    for (const model of [true, false]) {
      const r = await conversion('L3-F1-phase2~rev@64', model, 'D');
      const said = `${model ? 'model' : 'reactive'} ${JSON.stringify(r)}`;
      expect(r.outcome, said).toBe('transferFailed');
      expect(r.reason, said).toBe('takedown');
      expect(r.t!, said).toBeCloseTo(1.133, 2);
      expect(r.audit, said).toEqual(['energyGain']);
      expect(r.gain, said).toBeGreaterThan(0.5);
      expect(r.spin[1], said).toBeGreaterThan(3 * r.spin[0]);
    }
  }, 120000);

  it('ELBOW_PAST_RAGDOLL_RANGE (L4-F10-wrap-off, from 1.200 s): the late tackler\'s takedown at 1.242 s is refused, his supported right elbow folded past the ragdoll\'s 145 deg (hingeLimit), and he falls as the rigid proxy; the reactive planner from the same state the same', async () => {
    for (const model of [true, false]) {
      const r = await conversion('L4-F10-wrap-off@72', model, 'D');
      const said = `${model ? 'model' : 'reactive'} ${JSON.stringify(r)}`;
      expect(r.outcome, said).toBe('rejected');
      expect(r.reason, said).toBe('takedown');
      expect(r.t!, said).toBeCloseTo(1.242, 2);
      expect(r.rejected, said).toMatchObject({ reasons: 'hingeLimit' });
      expect(r.rejected!.rightElbowDeg, said).toBeGreaterThan(r.elbowLimitDeg);
      expect(r.representation, said).toBe('proxy');
    }
  }, 120000);
});
