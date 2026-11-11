import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import type { SimOptions } from '../src/sim/simulation';
import { labRun } from '../src/lab/lab-params';
import { LEG_GUARD_V1, LEG_GUARD_V3 } from '../src/sim/profiles';
import { allFixtures } from '../src/sim/fixtures';
import { create, FIX, runSim } from './helpers';

// Ladder: the lab's `order` and `legs` URL parameters (src/lab/lab-params.ts) make the run the full check's matrices make:
// reversed is SimOptions.reverseOrder (scripts/check/legmx.ts, l4mx.ts), a leg guard is the fixture with that profile in
// place of its own (the triage's V3 map).
const summaryOf = async (def: FixtureDef, opts: SimOptions): Promise<string> => {
  const s = await create(def, opts);
  await runSim(s);
  const out = JSON.stringify(s.summary());
  s.dispose();
  return out;
};

describe('lab URL parameters: order and legs', () => {
  it('order=rev&legs=v3 runs the matrices\' reversed V3 row of the fixture (L3-F1-phase6), named in the label; without them the run differs', async () => {
    const id = 'L3-F1-phase6';
    const lab = labRun(FIX(id), new URLSearchParams('fixture=L3-F1-phase6&order=rev&legs=v3'));
    expect(lab.label).toBe('order rev · legs V3');
    expect(lab.def.legGuard).toBe(LEG_GUARD_V3);
    expect(lab.opts).toEqual({ reverseOrder: true });
    // nothing else of the fixture changes
    expect({ ...lab.def, legGuard: FIX(id).legGuard }).toEqual(FIX(id));
    const matrix = await summaryOf({ ...FIX(id), legGuard: LEG_GUARD_V3 }, { reverseOrder: true });
    expect(await summaryOf(lab.def, lab.opts)).toBe(matrix);
    // the twin: the page without the parameters runs the registered fixture forward, another run
    const plain = labRun(FIX(id), new URLSearchParams('fixture=L3-F1-phase6'));
    expect(plain).toEqual({ def: FIX(id), opts: {}, label: '' });
    expect(await summaryOf(plain.def, plain.opts)).not.toBe(matrix);
  }, 120000);

  it('a registered guard, a fixture without one and unknown values are named in the label and change nothing', () => {
    const l3 = FIX('L3-F1-phase6');
    expect(l3.legGuard).toEqual(LEG_GUARD_V1);
    const reg = labRun(l3, new URLSearchParams('legs=v1&order=fwd'));
    expect(reg.def).toBe(l3);
    expect(reg.label).toBe('legs V1 (registered)');
    const g = allFixtures().find((d) => !d.legGuard)!;
    const none = labRun(g, new URLSearchParams('legs=V3'));
    expect(none.def).toBe(g);
    expect(none.label).toBe('legs V3 n/a (no leg guard)');
    const bad = labRun(l3, new URLSearchParams('legs=v9&order=back'));
    expect(bad).toEqual({ def: l3, opts: {}, label: 'order=back ignored · legs=v9 ignored' });
  });
});
