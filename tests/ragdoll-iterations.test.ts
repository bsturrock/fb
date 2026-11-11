import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { LEG_GUARD_V3, withAdditionalPgsIterations } from '../src/sim/profiles';
import { SEGMENTS } from '../src/sim/ragdoll';
import { create, FIX, stepWhile } from './helpers';
import { INJECTION_J, passiveEnergyMeter, type SolveEnergy } from './passive-energy';
import { loadState, resumeState } from './state';

// Ladder rung 8a: `RagdollProfile.additionalPgsIterations` (no fixture uses it yet). Every segment body of a ragdoll
// built under it asks Rapier for that many more internal PGS iterations per solver substep for its island (the island
// runs the largest request). Measured by the passive-energy meter (tests/passive-energy.ts) on two captures, with R's
// segments set from the capture (what the field asks at the build):
// - the self-trunk pinch: L4-F9-contact reversed under LEG_GUARD_V3, captured at the end of tick 63 (1.050 s). R lands
//   face down on its right forearm, which the floor presses into its own chest; solve 270 (1.125 s) gains 7.7 J with no
//   other player touching (kinetic +4.6, potential +3.2, applied work +0.1). With 3 more PGS iterations it loses energy.
// - the brace rebound (tracked defect, not fixed here): L4-F9-contact as registered, captured at the end of tick 61
//   (1.017 s). R's left palm lands on the floor; the impact's two solves take 135 and 244 J out (249, 250) and the next
//   (251, 1.046 s) gives 73 J back with only that palm on the floor. One more PGS iteration and the same solve loses.
const ID = 'L4-F9-contact';

async function solve(capture: string, def: FixtureDef, at: number, iterations: number): Promise<SolveEnergy[]> {
  const sim = await resumeState(loadState(capture), { def });
  const R = sim.players.find((p) => p.id === 'R')!;
  for (const s of SEGMENTS) R.rag!.bodies[s].setAdditionalPgsIterations(iterations);
  const got: SolveEnergy[] = [];
  const meter = passiveEnergyMeter(sim, (e) => {
    if (e.pid === 'R' && e.step >= at - 2 && e.step <= at) got.push(e);
  });
  await stepWhile(sim, () => sim.steps < at);
  meter.restore();
  sim.dispose();
  expect(got.map((e) => e.step)).toEqual([at - 2, at - 1, at]);
  return got;
}
const pinch = (n: number) => solve('tests/data/state/L4-F9-contact~v3-rev@63.json.gz', { ...FIX(ID), legGuard: LEG_GUARD_V3 }, 270, n);
const brace = (n: number) => solve('tests/data/state/L4-F9-contact@61.json.gz', FIX(ID), 251, n);

describe('ladder rung 8a: additional PGS iterations on ragdoll segments', () => {
  it('a ragdoll built under the field asks them on every segment, and none without it', async () => {
    const segments = async (d: FixtureDef): Promise<number[]> => {
      const sim = await create(d);
      await stepWhile(sim, () => !sim.players[0].rag?.enabled);
      const got = SEGMENTS.map((s) => sim.players[0].rag!.bodies[s].additionalPgsIterations());
      sim.dispose();
      return got;
    };
    const d = FIX('L4-F2-side-off');
    expect(await segments({ ...d, ragdoll: withAdditionalPgsIterations(d.ragdoll!, 3) })).toEqual(SEGMENTS.map(() => 3));
    expect(await segments(d)).toEqual(SEGMENTS.map(() => 0));
  }, 60000);

  it('the self-trunk pinch (L4-F9-contact reversed, V3, solve 270): with 3 the solve loses energy; with none it injects 7.7 J', async () => {
    const [, , three] = await pinch(3);
    expect(three.touched).toBe(false);
    expect(three.passiveJ).toBeLessThan(0);
    const [, , none] = await pinch(0);
    expect(none.touched).toBe(false);
    expect(none.pinch).toContain('rightForearm');
    expect(none.passiveJ).toBeGreaterThan(7);
    expect(none.passiveJ).toBeGreaterThan(INJECTION_J);
  }, 60000);

  it('tracked defect, the brace rebound (L4-F9-contact, solve 251): after the palm impact the solve gives 73 J back; with 1 more it loses', async () => {
    const none = await brace(0);
    const [a, b, c] = none;
    for (const e of none) expect(e.touched).toBe(false);
    expect(a.passiveJ).toBeLessThan(-100);
    expect(b.passiveJ).toBeLessThan(-200);
    expect(c.contact).toBe(true);
    expect(c.pinch).toEqual([]);
    expect(c.passiveJ).toBeGreaterThan(70);
    expect(-b.passiveJ).toBeGreaterThan(c.passiveJ);
    const [, , one] = await brace(1);
    expect(one.touched).toBe(false);
    expect(one.passiveJ).toBeLessThan(0);
  }, 60000);
});
