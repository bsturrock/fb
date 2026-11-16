import { describe, expect, it } from 'vitest';
import { standsNowhere, STEPS_V2, withSteps, withoutSteps } from '../src/sim/contact-steps';
import type { FixtureDef } from '../src/sim/fixture';
import type { Simulation } from '../src/sim/simulation';
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

/** `d` with the come-down's read on the model (STEPS_V2, `underHips`). */
const underHips = (d: FixtureDef): FixtureDef => ({ ...d, footwork: withSteps(withoutSteps(d.footwork!), STEPS_V2) });
const LEG = ['thigh', 'shin', 'shoe'];

/**
 * Resumes the capture to the end as captured (STEPS_V1) or with STEPS_V2: when the carrier R is down (off his support,
 * his core within the ride's carrierDownM, or the play ended), the tackler D's conversion, and what held him up under
 * STEPS_V1's read at his last supported substep (a foot not bound, his legs' contacts with R, a clamp on R).
 */
async function comeDown(file: string, v2: boolean) {
  const cap = loadState(`tests/data/state/${file}.json.gz`);
  const def = v2 ? underHips(asCaptured(cap)) : asCaptured(cap);
  let downT = null as number | null;
  let last = null as { stands: boolean; legs: number; body: number; hold: boolean; mps: number } | null;
  const onSubstep = (sim: Simulation): void => {
    const s = sim as unknown as { contactObs: Record<string, { other: string; ownRegion: string }[]>; arms: { clampOf(id: string, side: string): { targetId: string } | null }; ending: unknown };
    const [R, D] = ['R', 'D'].map((id) => sim.players.find((p) => p.id === id)!);
    if (downT === null && R.controlMode !== 'supported' && (sim.coreBody(R).translation().y <= def.wrap!.ride!.carrierDownM || s.ending)) downT = sim.t;
    if (D.controlMode !== 'supported') return;
    const obs = (s.contactObs.D ?? []).filter((c) => c.other === 'R');
    const v = sim.coreBody(D).linvel();
    last = { stands: !standsNowhere(D.feet!), legs: obs.filter((c) => LEG.includes(c.ownRegion)).length, body: obs.filter((c) => !LEG.includes(c.ownRegion)).length, hold: ['left', 'right'].some((sd) => s.arms.clampOf('D', sd)?.targetId === 'R'), mps: Math.hypot(v.x, v.z) };
  };
  const sim = await resumeState(cap, { def, variant: ['footwork'], opts: { onSubstep } });
  while (!sim.done) sim.stepTick();
  const D = sim.players.find((p) => p.id === 'D')!;
  const out = { downT, outcome: D.handoff?.outcome, reason: D.handoff?.reason, t: D.handoff?.t ?? NaN, representation: D.representation, last, graceS: def.wrap!.commit!.graceS };
  sim.dispose();
  return out;
}

describe('plan 15, the come-down\'s read on the model (STEPS_V2 underHips)', () => {
  it.each([
    ['L3-F1-rising@50', 'the carrier\'s core within carrierDownM at 0.850 s'],
    ['L3-F1-phase6@47', 'the play ended at 0.804 s'],
  ])('his man down under him (%s, %s), driven on over him at over 3.5 m/s with his clamp on him and his legs against his, the tackler goes down with him: a takedown as a ragdoll one grace later; fault twin, STEPS_V1\'s read (a foot not bound, any contact, any hold) keeps him up over him', async (file) => {
    const r = await comeDown(file, true);
    const said = JSON.stringify(r);
    expect(r.downT, said).not.toBeNull();
    expect([r.outcome, r.reason, r.representation], said).toEqual(['accepted', 'takedown', 'ragdoll']);
    expect(r.t - r.downT!, said).toBeGreaterThanOrEqual(r.graceS - 1e-6);
    expect(r.t - r.downT!, said).toBeLessThanOrEqual(r.graceS + 1 / 240 + 1e-6);
    // what STEPS_V1's read stood on at that moment: a foot not bound, his legs on the carrier, his clamp on him; his body
    // off him and his hips moving faster than a short step catches
    expect(r.last, said).toMatchObject({ stands: true, body: 0, hold: true });
    expect(r.last!.legs, said).toBeGreaterThan(0);
    expect(r.last!.mps, said).toBeGreaterThan(3.5);
    // fault twin: under STEPS_V1's read he stays up over his man (measured 0.096 s and 0.371 s after he was down)
    const w = await comeDown(file, false);
    expect(w.t - w.downT!, JSON.stringify(w)).toBeGreaterThan(0.09);
  }, 120000);
});
