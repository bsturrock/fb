import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import type { SimOptions } from '../src/sim/simulation';
import { labRun } from '../src/lab/lab-params';
import {
  HIP_STOPS_L4_V1, hipStopsFor, LEG_GUARD_V1, LEG_GUARD_V3, withAdditionalPgsIterations, withHipStops, withKneeStop, withoutHipStops, withoutKneeStop,
  withoutPgsIterations,
} from '../src/sim/profiles';
import { allFixtures } from '../src/sim/fixtures';
import { create, FIX, runSim } from './helpers';

// Ladder: the lab's `order`, `legs`, `hips`, `pgs` and `knees` URL parameters (src/lab/lab-params.ts) make the run the full check's matrices make:
// reversed is SimOptions.reverseOrder (scripts/check/legmx.ts, l4mx.ts), a leg guard is the fixture with that profile in
// place of its own (the triage's V3 map).
const summaryOf = async (def: FixtureDef, opts: SimOptions): Promise<string> => {
  const s = await create(def, opts);
  await runSim(s);
  const out = JSON.stringify(s.summary());
  s.dispose();
  return out;
};

describe('lab URL parameters: order, legs, hips, pgs and knees', () => {
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

  // ladder rung 8d: hips=v1|off runs a ragdoll fixture with the 8d hard hip stops or without any (no fixture has them yet);
  // 8h: hips=on is the stops as they would flip (below)
  it('hips=v1 runs the fixture with the 8d hip stops (L4-F2-side-off), named in the label; hips=off takes them off again; without it the run differs', async () => {
    const id = 'L4-F2-side-off';
    const d = FIX(id);
    expect(d.ragdoll!.hipStops).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&hips=v1`));
    expect(on.label).toBe('hip stops v1');
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

  // ladder rung 8h: pgs=<n> and knees=off|140|145 with hips, composed in that order: the assessments' variant (8i)
  it('hips=on&pgs=4&knees=140 runs the fixture as the 8i variant (L3-F9-convert-free: the 8d box with the approach zone, PGS +4, knee stop 140), its profile to the id, named in the label; on L4 hips=on takes the backstop; without them the run differs', async () => {
    const id = 'L3-F9-convert-free';
    const d = FIX(id);
    const r = d.ragdoll!;
    const variant = withKneeStop(withAdditionalPgsIterations(withHipStops(r, hipStopsFor(r)), 4), 140);
    expect(variant.id).toBe(`${r.id}+hip-stops-v2+pgs4+knee140`);
    const lab = labRun(d, new URLSearchParams(`fixture=${id}&knees=140&hips=on&pgs=4`));
    expect(lab.label).toBe('hip stops on · pgs +4 · knee stop 140');
    expect(lab.def).toEqual({ ...d, ragdoll: variant });
    const run = await summaryOf({ ...d, ragdoll: variant }, {});
    expect(await summaryOf(lab.def, lab.opts)).toBe(run);
    // the twin: the registered run is another
    expect(await summaryOf(d, {})).not.toBe(run);
    // on L4 the stops as they would flip are the backstop outside the soft envelope; hips=v1 the 8d box alone
    const l4 = FIX('L4-F2-side-off');
    expect(labRun(l4, new URLSearchParams('hips=on')).def.ragdoll!.hipStops).toBe(HIP_STOPS_L4_V1);
    expect(labRun(l4, new URLSearchParams('hips=v1')).def).toEqual({ ...l4, ragdoll: withHipStops(l4.ragdoll!) });
    expect(labRun(l4, new URLSearchParams('hips=v1')).label).toBe('hip stops v1');
  }, 120000);

  it('knees=off, pgs=0 and hips=off undo their parameter to the profile it had, id and all; a value already registered, a fixture without a ragdoll profile and unknown values are named in the label and change nothing', () => {
    const d = FIX('L3-F9-convert-free');
    const on = labRun(d, new URLSearchParams('hips=on&pgs=4&knees=145'));
    const back = labRun(on.def, new URLSearchParams('hips=off&pgs=0&knees=off'));
    expect(back.label).toBe('hip stops off · pgs +0 · knee stop off');
    expect(back.def).toEqual(d);
    // one at a time, out of the composition order: knees off, then pgs 0, leave the others as they were
    const k = labRun(on.def, new URLSearchParams('knees=off')).def.ragdoll!;
    expect(k.id).toBe(`${d.ragdoll!.id}+hip-stops-v2+pgs4`);
    expect(labRun({ ...on.def, ragdoll: k }, new URLSearchParams('pgs=2')).def.ragdoll!.id).toBe(`${d.ragdoll!.id}+hip-stops-v2+pgs2`);
    expect(withoutKneeStop(d.ragdoll!)).toBe(d.ragdoll);
    expect(withoutPgsIterations(d.ragdoll!)).toBe(d.ragdoll);
    const reg = labRun(d, new URLSearchParams('pgs=0&knees=off'));
    expect(reg).toEqual({ def: d, opts: {}, label: 'pgs +0 (registered) · knee stop off (registered)' });
    const g = allFixtures().find((x) => !x.ragdoll)!;
    expect(labRun(g, new URLSearchParams('pgs=4&knees=140'))).toEqual({ def: g, opts: {}, label: 'pgs 4 n/a (no ragdoll profile) · knees 140 n/a (no ragdoll profile)' });
    expect(labRun(d, new URLSearchParams('pgs=-1&knees=150'))).toEqual({ def: d, opts: {}, label: 'pgs=-1 ignored · knees=150 ignored' });
    expect(labRun(d, new URLSearchParams('pgs=99'))).toEqual({ def: d, opts: {}, label: 'pgs=99 ignored' });
  });
});
