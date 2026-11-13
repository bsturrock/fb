// Contact motion M2 follow-up: influence clears only out of a regained balance (RuleProfile.balancedClear,
// `withBalancedClear`). Gate 4 section 12 clears the continuing defensive influence "after at least 0.20 s of regained
// supported balance, no retention or impeding opponent contact, and resumed unrestrained movement"; the observer read
// "supported balance" as the supported control mode. A braced carrier hit off balance keeps his feet and his line while
// he topples (lean 5 to 30 deg, rising at 1 to 2 rad/s), the 0.2 s pass, influence clears, and the fall a moment later is
// not ruled down. Under the profile a free substep also needs his lean projected ahead under the lean at which the
// recovery envelope starts to judge a loss (BalanceProfile.minLeanRad). The twins are the same frames, and the same
// captured state, without the profile.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { RAGDOLL_G4, RULES_FOOTBALL, rulesRevision2, withBalancedClear, withoutBalancedClear, type RuleProfile } from '../src/sim/profiles';
import { RuleObserver, type RuleFrame } from '../src/sim/rules';
import { v3 } from '../src/sim/vec';
import { asCaptured, evs } from './runs';
import { loadState, resumeState } from './state';

const DT = 1 / 240;
const REV2 = rulesRevision2(RULES_FOOTBALL('R', { sideline: false, progress: false }));

/** A supported, grounded proxy runner substep, running at his request out of contact. */
const frame = (i: number, balanced: boolean, contact = false): RuleFrame => ({
  t: i * DT,
  tick: Math.floor(i / 4),
  step: i,
  dt: DT,
  runnerId: 'R',
  representation: 'proxy',
  validHandoff: false,
  controlMode: 'supported',
  grounded: true,
  balanced,
  corePose: { p: v3(0, 1, 0), q: { x: 0, y: 0, z: 0, w: 1 } },
  pose: null,
  velocity: v3(4, 0, 0),
  request: v3(4, 0, 0),
  contacts: [],
  opponentContacts: contact
    ? [{ other: 'D', ownRegion: 'torso', ownClass: 'torso', otherRegion: 'torso', otherClass: 'torso', pointWorld: v3(0, 1, 0), normalFromOther: v3(1, 0, 0), impulse: 0.01 }]
    : [],
  retention: [],
  minClampNormalN: 1,
});

/** One opening contact, then `n` free substeps whose balance `at` gives; the events. */
function play(profile: RuleProfile, n: number, at: (i: number) => boolean): string[] {
  const events: string[] = [];
  const obs = new RuleObserver(profile, RAGDOLL_G4, (type) => events.push(type));
  obs.observe(frame(0, true, true));
  for (let i = 1; i <= n; i++) obs.observe(frame(i, at(i)));
  return events;
}

describe('contact motion M2 follow-up: influence clears out of a regained balance', () => {
  it('the profile: `+balancedClear` on the rule profile, and off again under the id it had', () => {
    const on = withBalancedClear(REV2);
    expect(on).toEqual({ ...REV2, id: `${REV2.id}+balancedClear`, balancedClear: true });
    expect(withBalancedClear(on)).toBe(on);
    expect(withoutBalancedClear(on)).toEqual(REV2);
    expect(withoutBalancedClear(REV2)).toBe(REV2);
    for (const d of allFixtures()) expect(d.rules?.balancedClear, d.id).toBeUndefined();
  });

  it('a runner off balance out of contact keeps influence for as long as he is off balance; balanced for 0.2 s, it clears; without the profile his balance is not read', () => {
    const on = withBalancedClear(REV2);
    // 0.5 s off balance: held under the profile, cleared after 0.2 s without it (the fault twin)
    expect(play(on, 120, () => false)).not.toContain('influenceCleared');
    expect(play(REV2, 120, () => false)).toContain('influenceCleared');
    // balanced throughout: both clear
    expect(play(on, 120, () => true)).toContain('influenceCleared');
    // 0.15 s balanced, a substep off balance, 0.15 s balanced: the 0.2 s are continuous, so neither stretch clears it
    const broken = (i: number): boolean => i !== 37;
    expect(play(on, 72, broken)).not.toContain('influenceCleared');
    expect(play(REV2, 72, broken)).toContain('influenceCleared');
  });

  it('L3-F1-falling, the carrier hit off balance at 0.48 s: from the state at 0.67 s his fall is ruled down by contact under the profile; without it influence clears at 0.75 s and the play runs on', async () => {
    // The capture (tick 40, brace on): the last defensive contact was at 0.55 s; the carrier still on his feet and his
    // line, leaning 21 deg and rising at about 1.4 rad/s; he loses support at 0.78 s and his forearm meets the ground at
    // 1.14 s.
    const cap = loadState('tests/data/state/L3-F1-falling@40.json.gz');
    const d = asCaptured(cap);
    const runTo = async (rules: RuleProfile, untilS: number) => {
      const sim = await resumeState(cap, { def: { ...d, rules }, variant: ['rules'] });
      while (!sim.done && sim.t < untilS) sim.stepTick();
      const out = { cleared: evs(sim, 'influenceCleared', 'R').map((e) => e.t), loss: evs(sim, 'lossOfSupport', 'R').map((e) => e.t), ending: sim.ending };
      sim.dispose();
      return out;
    };
    const on = await runTo(withBalancedClear(d.rules!), 1.3);
    expect(on.cleared).toEqual([]);
    expect(on.loss[0]).toBeGreaterThan(0.75);
    expect(on.ending?.kind).toBe('groundDown');
    expect(on.ending!.t).toBeLessThan(1.2);
    expect(on.ending!.ids.some((x) => x.startsWith('contact:D:'))).toBe(true);
    // the twin: the same state without the profile
    const off = await runTo(d.rules!, 1.3);
    expect(off.cleared.length).toBe(1);
    expect(off.cleared[0]).toBeLessThan(on.loss[0]);
    expect(off.loss).toEqual(on.loss);
    expect(off.ending).toBeNull();
  });
});
