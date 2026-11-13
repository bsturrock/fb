// Contact motion M4, tracked defects (rule 5) the fall-reaction flip reached: mechanisms the flip's moved trajectories
// run into, each on a full-state capture a little before it (tests/data/state; how to capture: tests/README.md). Each test
// pins the defect present in its captured state and fails once the defect is gone from it (it then becomes the fix's
// test, with its fault twin). The twin resumes the same state with the response's every effort off (knees, hips, arms):
// where the defect is there too, the reaction reaches it and does not make it. The defects and their dispositions:
// docs/handoff/contact-motion-m4.md, "Known issues".
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE_PROFILE, FALL_REACT_V1 } from '../src/sim/profiles';
import { passiveEnergyMeter, type SolveEnergy } from './passive-energy';
import { asCaptured } from './runs';
import { loadState, resumeState } from './state';
import { depth, drawnShapes } from './visible';

// LANDING_REBOUND: L3-F1-phase4, the carrier R (a ragdoll from 0.813 s) lands on his right side, the carry arm tucked
// under him: the solve ending at 1.1833 s, its floor contacts on his right upper arm and forearm only, not pinched, no
// other player touching, raises his kinetic energy by over 100 J (the trunk is thrown up off the arm). Under the reaction
// 146 J; the twin, every effort off from 1.133 s, 113 J, its applied work 0: the solver's rebound off a limb under the
// body, reached by the reaction's moved landing (the tucked arm). Before the flip this run gained nothing; the mechanism
// is older (M2's CARRY_PINCH, the carry forearm pinched under the landing body, up to 166 J; L3 and HC runs before the
// flip up to 48 and 60 J).
describe('tracked defect LANDING_REBOUND (L3-F1-phase4, from 1.133 s)', () => {
  const CAP = 'tests/data/state/L3-F1-phase4@68.json.gz';

  it('R gains over 100 J in the solve ending at 1.1833 s, on his right upper arm and forearm, under the reaction and with its every effort off from there; the efforts do not make it', async () => {
    const cap = loadState(CAP);
    const def = asCaptured(cap);
    expect(def.fallResponse).toBe(FALL_REACT_V1);
    const zero = { ...FALL_REACT_V1, id: `${FALL_REACT_V1.id}-zero`, enable: { knee: false, hip: false, arms: false } };
    const look = async (effort: boolean) => {
      const sim = await resumeState(cap, effort ? { def } : { def: { ...def, fallResponse: zero }, variant: ['fallResponse'] });
      const gains: SolveEnergy[] = [];
      const meter = passiveEnergyMeter(sim, (e) => void (e.pid === 'R' && !e.touched && e.passiveJ > 40 && gains.push(e)));
      while (!sim.done && sim.t < 1.4 - 1e-9) sim.stepTick();
      meter.restore();
      sim.dispose();
      return gains.map((e) => ({ t: e.t.toFixed(4), kineticJ: e.dKineticJ, appliedJ: e.appliedJ, pinch: e.pinch }));
    };
    const on = await look(true);
    const off = await look(false);
    for (const [r, w] of [[on, 'reaction'], [off, 'zero-effort twin']] as const) {
      expect(r.map((e) => e.t), w).toEqual(['1.1833']);
      expect(r[0].kineticJ, w).toBeGreaterThan(100);
      expect(r[0].pinch, w).toEqual([]);
    }
    // the efforts' own work in that solve is small against the gain: the floor, not the arms or legs, throws him
    expect(Math.abs(on[0].appliedJ)).toBeLessThan(5);
    expect(off[0].appliedJ).toBe(0);
  }, 60000);
});

// UPPER_ARM_IN_TRUNK (M2's tracked defect: the upper arm has no own-trunk shape, ladder 13c `upperArm` parked), reached by
// the brace: FALL_L4's brace target and its held pose at contact ignore the own trunk (registered on L4 since plan 09:
// L4-F9-defenderFalling's carrier, 0.48 s over 10 cm in his brace's contact). L3-F1-phase5 reversed, the carrier R (a
// ragdoll from 0.717 s) reaches his free left arm across his chest for the floor: its drawn upper arm passes 10 cm into
// his drawn trunk at 0.933 s, and from the palm's floor contact (1.033 s) the contact phase holds it there, 10 to 12 cm,
// to 1.5 s. Twin, every arm effort off from 0.800 s: the limp arm falls in under him too, to 9.6 cm, and is out by
// 1.233 s. Across L3 and HC both orders, arm in own trunk over 10 cm: 46.9 player-s before the flip (all limp arms),
// 55.1 after (33.3 limp, 20.8 bracing, 1.0 protecting).
describe('tracked defect UPPER_ARM_IN_TRUNK under the reaction (L3-F1-phase5 reversed, from 0.800 s)', () => {
  const CAP = 'tests/data/state/L3-F1-phase5~rev@48.json.gz';

  it('R\'s bracing left upper arm is over 10 cm inside his own drawn trunk for at least 20 ticks, held there after its palm lands; with every arm effort off from the same state it goes in under 10 cm and is out by 1.25 s', async () => {
    const cap = loadState(CAP);
    const def = asCaptured(cap);
    expect(def.fallResponse).toBe(FALL_REACT_V1);
    const noArms = { ...FALL_REACT_V1, id: `${FALL_REACT_V1.id}-no-arms`, enable: { ...FALL_REACT_V1.enable, arms: false } };
    const look = async (arms: boolean) => {
      const sim = await resumeState(cap, arms ? { def } : { def: { ...def, fallResponse: noArms }, variant: ['fallResponse'] });
      const R = sim.byId.get('R')!;
      const prof = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
      const ticks: { t: number; m: number }[] = [];
      while (!sim.done && sim.t < 1.5 - 1e-9) {
        sim.stepTick();
        const sh = drawnShapes(R.pose!, R.body, prof);
        const trunk = sh.filter((s) => s.cls === 'trunk');
        const m = Math.max(0, ...sh.filter((s) => s.key.startsWith('leftUpperArmD')).flatMap((a) => trunk.map((t) => depth(a, t))));
        ticks.push({ t: sim.t, m });
      }
      const contact = sim.events.find((e) => e.type === 'braceContact' && e.playerId === 'R' && (e.data as { arm: string }).arm === 'left');
      sim.dispose();
      return { ticks, contactS: contact?.t ?? null };
    };
    const on = await look(true);
    const deep = on.ticks.filter((x) => x.m > 0.1);
    expect(deep.length).toBeGreaterThanOrEqual(20);
    expect(on.contactS).not.toBeNull();
    expect(deep.filter((x) => x.t > on.contactS!).length).toBeGreaterThanOrEqual(15);
    const off = await look(false);
    const peak = Math.max(...off.ticks.map((x) => x.m));
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(0.1);
    expect(off.ticks.filter((x) => x.t >= 1.25 - 1e-9).every((x) => x.m < 0.01)).toBe(true);
  }, 60000);
});
