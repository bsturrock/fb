// Full-state capture and resume (tests/state.ts): a run resumed from a capture reproduces the uninterrupted run, a capture
// written against other profiles or another state layout is refused with a clear message, and one capture resumes
// under a profile variant (the controlled twin of ladder rule 7). The rule 7 regression tests that resume from stored
// captures are in tests/l3-contracts.test.ts ("ladder tracked defects").
import { describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim/simulation';
import { create, FIX, preFlip, preHoldStill, preV3, runSim } from './helpers';
import { captureState, loadState, resumeState, STATE_FORMAT, type StateCapture } from './state';
import { ARM_G2, LEG_GUARD_V3 } from '../src/sim/profiles';

const exportOf = (s: Simulation): string => JSON.stringify({ fixture: s.exportFixture(), summary: s.summary(), events: s.events, trace: s.trace });
const copy = (c: StateCapture): StateCapture => JSON.parse(JSON.stringify(c));

describe('full-state capture and resume', () => {
  it('a run resumed from a capture reproduces the uninterrupted run to the end, byte for byte (L3-F4-oneArm, HC-F1-low)', async () => {
    // L3-F4-oneArm at 1.167 s: R a ragdoll, D supported beside it with an arm task on R, D's conversion (rejected) after
    // the capture; HC-F1-low at 0.667 s: both supported, both convert after it, the limp feet then held near each other
    for (const [id, tick] of [['L3-F4-oneArm', 70], ['HC-F1-low', 40]] as const) {
      const sim = await create(FIX(id));
      await runSim(sim, tick);
      // written as the file holds it (JSON), so the round trip is part of what is checked
      const cap = copy(captureState(sim));
      await runSim(sim);
      const whole = exportOf(sim);
      sim.dispose();
      const back = await resumeState(cap);
      expect(back.tick, id).toBe(tick);
      await runSim(back);
      const same = exportOf(back) === whole;
      back.dispose();
      expect(same, `${id} resumed at tick ${tick}`).toBe(true);
    }
  }, 120000);

  it('a fixture whose build uses a frozen profile constant outside its definition (ARM_G2, no armProfile) captures and resumes byte for byte', async () => {
    // L4-F2-forward-on at 0.5 s and L4-F4-obstructed reversed at 1.0 s: fall responses (plan 10) and no armProfile, so the
    // arm system holds ARM_G2 (frozen by the fixture registry, which reaches it through the fixtures that name it); the
    // capture writes it as the constant, by reference, and the resume reads the same object
    for (const [id, tick, opts] of [['L4-F2-forward-on', 30, {}], ['L4-F4-obstructed', 60, { reverseOrder: true }]] as const) {
      expect(FIX(id).armProfile, id).toBeUndefined();
      const sim = await create(FIX(id), opts);
      await runSim(sim, tick);
      expect((sim as any).arms.profile, id).toBe(ARM_G2);
      expect(Object.isFrozen(ARM_G2)).toBe(true);
      const cap = copy(captureState(sim));
      expect(JSON.stringify(cap.state), id).toContain('{"$const":".ARM_G2","id":"arm-g2-v1"}');
      await runSim(sim);
      const whole = exportOf(sim);
      sim.dispose();
      const back = await resumeState(cap);
      expect((back as any).arms.profile, id).toBe(ARM_G2);
      await runSim(back);
      const same = exportOf(back) === whole;
      back.dispose();
      expect(same, `${id} resumed at tick ${tick}`).toBe(true);
      // a constant whose id is not the capture's is refused, naming it
      const other = JSON.parse(JSON.stringify(cap).replace('{"$const":".ARM_G2","id":"arm-g2-v1"}', '{"$const":".ARM_G2","id":"arm-g2-other"}')) as StateCapture;
      await expect(resumeState(other)).rejects.toThrow(/stale state capture .*profile constant \.ARM_G2 \(read at sim\.arms\.profile\) is arm-g2-v1, the capture ran under arm-g2-other/);
    }
  }, 120000);

  it('fault twin: a frozen object outside the definition that src/sim/profiles does not export is still refused at capture', async () => {
    const sim = await create(FIX('L4-F2-forward-on'));
    await runSim(sim, 30);
    // the same profile's values in a frozen copy the registry of constants cannot name: the capture as before the fix
    (sim as any).arms.profile = Object.freeze({ ...ARM_G2 });
    expect(() => captureState(sim)).toThrow(/state capture: a frozen object outside the definition at sim\.arms\.profile/);
    sim.dispose();
  }, 60000);

  it('a run under physical legs (LEG_GUARD_V3: leg colliders on the proxies, round convex hulls) resumes byte for byte', async () => {
    // L3-F4-oneArm at 1.167 s under the rung 6 profile: both players' physical legs made and reshaped every substep (their
    // shapes cached on the colliders), R's removed with its proxy at its conversion; D's in the solve beside R's ragdoll
    const def = { ...FIX('L3-F4-oneArm'), legGuard: LEG_GUARD_V3 };
    const sim = await create(def);
    await runSim(sim, 70);
    expect(sim.players.find((p) => p.id === 'D')!.legs?.enabled, 'D\'s legs physical at the capture').toBe(true);
    const cap = copy(captureState(sim));
    await runSim(sim);
    const whole = exportOf(sim);
    sim.dispose();
    const back = await resumeState(cap, { def });
    await runSim(back);
    const same = exportOf(back) === whole;
    back.dispose();
    expect(same).toBe(true);
  }, 120000);

  it('a capture written against other profiles, another state layout, format or engine is refused, naming why', async () => {
    const cap = loadState('tests/data/state/L3-F4-oneArm@70.json.gz');
    // (captured before the visible flip, the ladder 10 leg-guard flip and the 14a still feet: resumed under the profiles it ran under)
    const def = preHoldStill(preV3(preFlip(FIX('L3-F4-oneArm'))));
    const refused = async (c: StateCapture, why: RegExp): Promise<void> => {
      await expect(resumeState(c, { def })).rejects.toThrow(/stale state capture \(L3-F4-oneArm at tick 70\)/);
      await expect(resumeState(c, { def })).rejects.toThrow(why);
    };
    const profile = copy(cap);
    profile.profiles['legGuard'] = 'leg-guard-other';
    await refused(profile, /profile at legGuard is leg-guard-predictive-v1, the capture ran under leg-guard-other/);
    const layout = copy(cap);
    layout.layout['sim'] = layout.layout['sim'].filter((k) => k !== 'contacts');
    await refused(layout, /Simulation at sim has fields the capture lacks \(contacts\)/);
    const format = { ...copy(cap), format: STATE_FORMAT + 1 };
    await refused(format, /format/);
    const engine = { ...copy(cap), rapier: '0.0.0' };
    await refused(engine, /Rapier 0\.0\.0/);
    // the stored capture itself resumes
    (await resumeState(cap, { def })).dispose();
  }, 60000);

  it('one capture resumes under a profile variant named by the test (the controlled twin), and only when it is named', async () => {
    const cap = loadState('tests/data/state/L3-F4-oneArm@70.json.gz');
    // (captured before the visible flip, the ladder 10 leg-guard flip and the 14a still feet: resumed under the profiles it ran under)
    const def = preHoldStill(preV3(preFlip(FIX('L3-F4-oneArm'))));
    const noGuard = { ...def, legGuard: undefined };
    await expect(resumeState(cap, { def: noGuard })).rejects.toThrow(/profile at legGuard is absent/);
    const on = await resumeState(cap, { def });
    const off = await resumeState(cap, { def: noGuard, variant: ['legGuard'] });
    const prefix = (s: Simulation) => JSON.stringify(s.trace);
    // the same state at the capture, ...
    expect(prefix(off)).toBe(prefix(on));
    await runSim(on);
    await runSim(off);
    // ... and the variant's profile is what the resumed run reads from there on
    expect(off.def.legGuard).toBeUndefined();
    expect(on.def.legGuard).toBe(def.legGuard);
    expect(JSON.stringify(off.trace.slice(cap.tick)), 'the remainders differ').not.toBe(JSON.stringify(on.trace.slice(cap.tick)));
    on.dispose();
    off.dispose();
  }, 60000);
});
