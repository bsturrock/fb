import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import type { SimOptions } from '../src/sim/simulation';
import { labRun } from '../src/lab/lab-params';
import { LEG_GUARD_V1, LEG_GUARD_V3, withHipStops, withoutHipStops } from '../src/sim/profiles';
import { allFixtures } from '../src/sim/fixtures';
import { create, FIX, runSim } from './helpers';

// Ladder: the lab's `order`, `legs` and `hips` URL parameters (src/lab/lab-params.ts) make the run the full check's matrices make:
// reversed is SimOptions.reverseOrder (scripts/check/legmx.ts, l4mx.ts), a leg guard is the fixture with that profile in
// place of its own (the triage's V3 map).
const summaryOf = async (def: FixtureDef, opts: SimOptions): Promise<string> => {
  const s = await create(def, opts);
  await runSim(s);
  const out = JSON.stringify(s.summary());
  s.dispose();
  return out;
};

describe('lab URL parameters: order, legs and hips', () => {
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

  // ladder rung 8d: hips=on|off runs a ragdoll fixture with the hard hip stops or without any (no fixture has them yet)
  it('hips=on runs the fixture with the hip stops (L4-F2-side-off), named in the label; hips=off takes them off again; without it the run differs', async () => {
    const id = 'L4-F2-side-off';
    const d = FIX(id);
    expect(d.ragdoll!.hipStops).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&hips=on`));
    expect(on.label).toBe('hip stops on');
    expect(on.def).toEqual({ ...d, ragdoll: withHipStops(d.ragdoll!) });
    const stops = await summaryOf({ ...d, ragdoll: withHipStops(d.ragdoll!) }, {});
    expect(await summaryOf(on.def, on.opts)).toBe(stops);
    // the twin: the registered fixture (and hips=off on it) is the run without them, another run
    const off = labRun(d, new URLSearchParams('hips=off'));
    expect(off).toEqual({ def: d, opts: {}, label: 'hip stops off (registered)' });
    expect(await summaryOf(off.def, off.opts)).not.toBe(stops);
    // off undoes on: the profile it had, id and all
    const back = labRun(on.def, new URLSearchParams('hips=off'));
    expect(back.label).toBe('hip stops off');
    expect(back.def.ragdoll).toEqual(d.ragdoll);
    expect(withoutHipStops(d.ragdoll!)).toBe(d.ragdoll);
    // a fixture without a ragdoll profile and an unknown value change nothing
    const g = allFixtures().find((x) => !x.ragdoll)!;
    expect(labRun(g, new URLSearchParams('hips=on'))).toEqual({ def: g, opts: {}, label: 'hips on n/a (no ragdoll profile)' });
    expect(labRun(d, new URLSearchParams('hips=maybe'))).toEqual({ def: d, opts: {}, label: 'hips=maybe ignored' });
  }, 120000);
});
