import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import type { SimOptions } from '../src/sim/simulation';
import { labRun } from '../src/lab/lab-params';
import { HOLD_STILL_V1, LATE_LANDING_ID } from '../src/sim/footwork';
import { CARRIER_BRACE_V1, CARRIER_BRACE_V2 } from '../src/sim/brace';
import { WRAP_V1, WRAP_V2, WRAP_V3, WRAP_V4, WRAP_V5, WRAP_V6, WRAP_V7, WRAP_V8, WRAP_V9 } from '../src/sim/controllers/wrap';
import {
  BORN_OVERLAP_V1, BORN_OVERLAP_V2, CONVERSION_RETRY_V1, HIP_STOPS_L4_V1, HIP_STOPS_V2, hipStopsFor, LEG_GUARD_V1, LEG_GUARD_V3, SELF_LEGS_V1, SHOULDER_TWIST_ANAT_V1, withAdditionalPgsIterations, withConversionRetry, withHipStops,
  withKneeStop, withoutConversionRetry, withoutHipStops, withoutKneeStop, withoutPgsIterations, withSelfLegs, withShoulderTwistLimit, withUpperArmClearance, withClipArmSwing, withMetArmStay, withBornOverlap, withBornSeparation, withoutBornSeparation, withBalancedClear, withoutBalancedClear, FALL_REACT_V1, FALL_REACT_V2,
} from '../src/sim/profiles';
import { allFixtures } from '../src/sim/fixtures';
import { create, FIX, flip8i, preBornOverlap, preBornSeparation, preBrace, preBraceV2, preFallReact, preFlip, preHoldStill, preMetArmStay, preOwnLegs, preV3, preWrap, runSim } from './helpers';

// Ladder: the lab's `order`, `legs`, `hips`, `pgs`, `knees`, `retry`, `selfleg`, `armtwist`, `born`, `bornsep`, `holdstill`, `upperarm`, `armswing`, `armstay` and `brace` URL parameters (src/lab/lab-params.ts) make the run the full check's matrices make:
// reversed is SimOptions.reverseOrder (scripts/check/legmx.ts, l4mx.ts), a leg guard is the fixture with that profile in
// place of its own (the triage's V3 map).
const summaryOf = async (def: FixtureDef, opts: SimOptions): Promise<string> => {
  const s = await create(def, opts);
  await runSim(s);
  const out = JSON.stringify(s.summary());
  s.dispose();
  return out;
};

describe('lab URL parameters: order, legs, hips, pgs, knees, retry, selfleg, armtwist, born, bornsep, holdstill, upperarm, armswing, armstay and brace', () => {
  it('order=rev&legs=v1 runs the matrices\' reversed V1 row of the fixture (L3-F1-phase6, the guard before the ladder 10 flip), named in the label; without them the run differs', async () => {
    const id = 'L3-F1-phase6';
    const lab = labRun(FIX(id), new URLSearchParams('fixture=L3-F1-phase6&order=rev&legs=v1'));
    expect(lab.label).toBe('order rev · legs V1');
    expect(lab.def.legGuard).toBe(LEG_GUARD_V1);
    expect(lab.opts).toEqual({ reverseOrder: true });
    // nothing else of the fixture changes: it is the definition before the flip
    expect({ ...lab.def, legGuard: FIX(id).legGuard }).toEqual(FIX(id));
    expect(lab.def).toEqual(preV3(FIX(id)));
    const matrix = await summaryOf({ ...FIX(id), legGuard: LEG_GUARD_V1 }, { reverseOrder: true });
    expect(await summaryOf(lab.def, lab.opts)).toBe(matrix);
    // the twin: the page without the parameters runs the registered fixture forward, another run
    const plain = labRun(FIX(id), new URLSearchParams('fixture=L3-F1-phase6'));
    expect(plain).toEqual({ def: FIX(id), opts: {}, label: '' });
    expect(await summaryOf(plain.def, plain.opts)).not.toBe(matrix);
  }, 120000);

  it('a registered guard, a fixture without one and unknown values are named in the label and change nothing', () => {
    const l3 = FIX('L3-F1-phase6');
    expect(l3.legGuard).toEqual(LEG_GUARD_V3);
    const reg = labRun(l3, new URLSearchParams('legs=v3&order=fwd'));
    expect(reg.def).toBe(l3);
    expect(reg.label).toBe('legs V3 (registered)');
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
    // (the profile before the visible flip, which registers the stops)
    const d = preFlip(FIX(id));
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
  it('hips=on&pgs=4&knees=140 runs the fixture as the 8i variant (L3-F9-convert-free: the 8d box with the approach zone, PGS +4, knee stop 140), its profile to the id, named in the label; on L4 hips=on takes the same box (rung 8k), hips=l4 the 8i backstop; without them the run differs', async () => {
    const id = 'L3-F9-convert-free';
    // (the profile before the visible flip, which registers this variant with the deferred conversion; and before the
    // contact motion M4 fall flip, whose response needs the hip stops)
    const d = preFlip(preFallReact(FIX(id)));
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
    // on L4 the stops as they would flip are the same box (rung 8k); hips=l4 the 8g backstop outside the soft envelope
    // (the 8i assessment's L4 stops); hips=v1 the 8d box alone
    const l4 = preFlip(FIX('L4-F2-side-off'));
    expect(labRun(l4, new URLSearchParams('hips=on')).def.ragdoll!.hipStops).toBe(HIP_STOPS_V2);
    expect(labRun(l4, new URLSearchParams('hips=l4')).def).toEqual({ ...l4, ragdoll: withHipStops(l4.ragdoll!, HIP_STOPS_L4_V1) });
    expect(labRun(l4, new URLSearchParams('hips=l4')).label).toBe('hip stops l4');
    expect(labRun(l4, new URLSearchParams('hips=v1')).def).toEqual({ ...l4, ragdoll: withHipStops(l4.ragdoll!) });
    expect(labRun(l4, new URLSearchParams('hips=v1')).label).toBe('hip stops v1');
  }, 120000);

  it('knees=off, pgs=0 and hips=off undo their parameter to the profile it had, id and all; a value already registered, a fixture without a ragdoll profile and unknown values are named in the label and change nothing', () => {
    // (the profile before the visible flip, and before the fall flip, whose response needs the hip stops)
    const d = preFlip(preFallReact(FIX('L3-F9-convert-free')));
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

  // ladder rung 8j: retry=on|off, composed after the others
  it('hips=on&pgs=4&knees=140&retry=on runs the 8i variant with the deferred conversion (HC-F3-falling reversed: D converts where the variant alone leaves it a falling proxy), named in the label; retry=off takes it off again; unknown values change nothing', async () => {
    const id = 'HC-F3-falling';
    // (the profile before the visible flip, which registers this variant; a natural sample, with the leg guard before
    // the ladder 10 flip: under V3 the variant alone converts D, its posed legs held out of R; and before the ladder 17b
    // flip, under which the variant alone converts D too, its thigh in R's palm held out of the solve; and before the
    // 18e met-arm flip, under which the variant alone converts D as well; and before the contact motion M2 brace flip;
    // and before the M3 wrap flip, under which the variant alone converts D too; and before the M4 fall flip, under which
    // the variant alone converts D as well, the carrier's reaction moving the fall)
    const d = preV3(preFlip(preBornOverlap(preMetArmStay(preBrace(preWrap(preFallReact(FIX(id))))))));
    const lab = labRun(d, new URLSearchParams(`fixture=${id}&order=rev&hips=on&pgs=4&knees=140&retry=on`));
    expect(lab.label).toBe('order rev · hip stops on · pgs +4 · knee stop 140 · conversion retry on');
    const want = withConversionRetry(flip8i(d).ragdoll!);
    expect(want.id).toBe(`${d.ragdoll!.id}+hip-stops-v2+pgs4+knee140+${CONVERSION_RETRY_V1.id}`);
    expect(lab.def).toEqual({ ...d, ragdoll: want });
    const outcomeOf = async (def: typeof d): Promise<string | undefined> => {
      const s = await create(def, { reverseOrder: true });
      await runSim(s);
      const h = s.players.find((p) => p.id === 'D')!.handoff?.outcome;
      s.dispose();
      return h;
    };
    expect(await outcomeOf(lab.def)).toBe('accepted');
    // the twin: the variant without it
    const off = labRun(lab.def, new URLSearchParams('retry=off'));
    expect(off.label).toBe('conversion retry off');
    expect(off.def).toEqual(flip8i(d));
    expect(await outcomeOf(off.def)).toBe('rejected');
    expect(withoutConversionRetry(d.ragdoll!)).toBe(d.ragdoll);
    expect(labRun(d, new URLSearchParams('retry=off'))).toEqual({ def: d, opts: {}, label: 'conversion retry off (registered)' });
    expect(labRun(d, new URLSearchParams('retry=maybe'))).toEqual({ def: d, opts: {}, label: 'retry=maybe ignored' });
  }, 120000);

  // ladder 8m: the visible flip registered on L3, L4 and HC; the owner compares the two views in the lab. Since the
  // own-leg flip (9d) with selfleg=off, and since the leg-guard flip (10d) with legs=v1: the view before all three
  it('on a fixture registered with the visible, own-leg and leg-guard flips, legs=v1&hips=off&pgs=0&knees=off&retry=off&selfleg=off is the view before them: the definition before the flips, ids and all, and its run (an L3, L4 and HC fixture the flips change); without legs=v1 the view keeps the registered leg guard and is another run; the flips\' own values are the registered run', async () => {
    for (const id of ['L3-F1-phase2', 'L4-F12-base', 'HC-F5-strictTransfer']) {
      const d = FIX(id);
      // (contact motion M4: on L3 and HC the view before them is also before the fall flip, whose response needs the hip
      // stops: limp, named last)
      const fall = id.startsWith('L4') ? '' : ' · fall off (no hip stops)';
      const limp = id.startsWith('L4') ? (x: FixtureDef): FixtureDef => x : preFallReact;
      const before = labRun(d, new URLSearchParams(`fixture=${id}&legs=v1&hips=off&pgs=0&knees=off&retry=off&selfleg=off`));
      expect(before.label, id).toBe(`legs V1 · hip stops off · pgs +0 · knee stop off · conversion retry off · own-leg contact off${fall}`);
      expect(before.def, id).toEqual(limp(preV3(preFlip(d))));
      expect(before.def.legGuard, id).toBe(LEG_GUARD_V1);
      expect(before.def.ragdoll!.id, id).toBe(preFlip(d).ragdoll!.id);
      const run = await summaryOf(before.def, before.opts);
      expect(run, id).toBe(await summaryOf(limp(preV3(preFlip(d))), {}));
      // the twin: the registered run, which the flips change
      expect(await summaryOf(d, {}), id).not.toBe(run);
      // without legs=v1 (the 9d before-view) the leg guard stays the registered V3: not the view before the flips
      const noLegs = labRun(d, new URLSearchParams(`fixture=${id}&hips=off&pgs=0&knees=off&retry=off&selfleg=off`));
      expect(noLegs.def.legGuard, id).toBe(LEG_GUARD_V3);
      expect(noLegs.def, id).toEqual(limp(preFlip(d)));
      const after = labRun(d, new URLSearchParams(`fixture=${id}&legs=v3&hips=on&pgs=4&knees=140&retry=on&selfleg=on`));
      expect(after.def, id).toBe(d);
      expect(after.label, id).toBe('legs V3 (registered) · hip stops on (registered) · pgs +4 (registered) · knee stop 140 (registered) · conversion retry on (registered) · own-leg contact on (registered)');
    }
    // the leg guard alone moves the before-view's run (HC-F5-strictTransfer: D's thigh met by R's under V3)
    const hc = preFallReact(FIX('HC-F5-strictTransfer'));
    expect(await summaryOf(preFlip(hc), {})).not.toBe(await summaryOf(preV3(preFlip(hc)), {}));
  }, 120000);

  // ladder rung 9a: selfleg=on|off, composed after the others; registered on every L3/L4/HC ragdoll since the own-leg flip
  it('on a fixture registered with own-leg contact (HC-F1-at0.9: every ragdoll gets its own-leg shapes), selfleg=off is the view before it, id and all, and its run differs; selfleg=on is the registered run and puts it back; with the view before both flips it is named last; unknown values change nothing', async () => {
    const id = 'HC-F1-at0.9';
    // (before the ladder 17b flip, registered after own-leg contact on the same profile)
    const d = preBornOverlap(FIX(id));
    expect(d.ragdoll!.selfLegs).toBe(SELF_LEGS_V1);
    expect(d.ragdoll!.id).toBe(`${preOwnLegs(d).ragdoll!.id}+${SELF_LEGS_V1.id}`);
    const s = await create(d, {});
    await runSim(s);
    const rags = s.players.filter((p) => p.rag);
    expect(rags.length).toBeGreaterThan(0);
    for (const p of rags) expect(p.rag!.selfLegs?.legs.length, p.id).toBe(6);
    const run = JSON.stringify(s.summary());
    s.dispose();
    const off = labRun(d, new URLSearchParams(`fixture=${id}&selfleg=off`));
    expect(off.label).toBe('own-leg contact off');
    expect(off.def).toEqual(preOwnLegs(d));
    // the twin: the view before it is another run
    expect(await summaryOf(off.def, off.opts)).not.toBe(run);
    // on puts it back, id and all; a value already registered is named so
    const back = labRun(off.def, new URLSearchParams('selfleg=ON'));
    expect(back.label).toBe('own-leg contact on');
    expect(back.def).toEqual(d);
    expect(await summaryOf(back.def, back.opts)).toBe(run);
    expect(labRun(d, new URLSearchParams('selfleg=on'))).toEqual({ def: d, opts: {}, label: 'own-leg contact on (registered)' });
    // composed after the others: on the view before both flips (and before the contact motion M4 fall flip, whose
    // response needs the hip stops), its id is named last
    const p0 = preFlip(preFallReact(d));
    const pre = labRun(p0, new URLSearchParams('selfleg=on&hips=off&pgs=0&knees=off&retry=off'));
    expect(pre.label).toBe('hip stops off (registered) · pgs +0 (registered) · knee stop off (registered) · conversion retry off (registered) · own-leg contact on');
    expect(pre.def).toEqual({ ...p0, ragdoll: withSelfLegs(p0.ragdoll!) });
    // a fixture without a ragdoll profile and an unknown value change nothing
    const g = allFixtures().find((x) => !x.ragdoll)!;
    expect(labRun(g, new URLSearchParams('selfleg=on'))).toEqual({ def: g, opts: {}, label: 'selfleg on n/a (no ragdoll profile)' });
    expect(labRun(d, new URLSearchParams('selfleg=maybe'))).toEqual({ def: d, opts: {}, label: 'selfleg=maybe ignored' });
  }, 120000);

  // ladder rung 13a: armtwist=on|off, composed last; no fixture registers the anatomical shoulder twist limit yet
  it('armtwist=on runs the fixture with the anatomical shoulder twist limit on its ragdoll, id and all, named last (HC-F5-strictTransfer: another run, R\'s raised arm); armtwist=off takes it off again and on the registered fixture is the registered run; unknown values change nothing', async () => {
    const id = 'HC-F5-strictTransfer';
    const d = FIX(id);
    expect(d.ragdoll!.shoulderTwistLimit).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&armtwist=on`));
    expect(on.label).toBe('shoulder twist limit anatomical');
    expect(on.def).toEqual({ ...d, ragdoll: withShoulderTwistLimit(d.ragdoll!) });
    expect(on.def.ragdoll!.shoulderTwistLimit).toBe(SHOULDER_TWIST_ANAT_V1);
    expect(on.def.ragdoll!.id).toBe(`${d.ragdoll!.id}+${SHOULDER_TWIST_ANAT_V1.id}`);
    const run = await summaryOf(d, {});
    // the twin: the limit changes the run
    expect(await summaryOf(on.def, on.opts)).not.toBe(run);
    // off puts it back, id and all; on the registered fixture it is the registered run
    const back = labRun(on.def, new URLSearchParams('armtwist=OFF'));
    expect(back.label).toBe('shoulder twist limit plan 09');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('armtwist=off'))).toEqual({ def: d, opts: {}, label: 'shoulder twist limit plan 09 (registered)' });
    expect(labRun(on.def, new URLSearchParams('armtwist=on'))).toEqual({ def: on.def, opts: {}, label: 'shoulder twist limit anatomical (registered)' });
    // composed after the others: with own-leg contact off, its id is named last
    const both = labRun(d, new URLSearchParams('armtwist=on&selfleg=off'));
    expect(both.label).toBe('own-leg contact off · shoulder twist limit anatomical');
    expect(both.def).toEqual({ ...d, ragdoll: withShoulderTwistLimit(preOwnLegs(d).ragdoll!) });
    const g = allFixtures().find((x) => !x.ragdoll)!;
    expect(labRun(g, new URLSearchParams('armtwist=on'))).toEqual({ def: g, opts: {}, label: 'armtwist on n/a (no ragdoll profile)' });
    expect(labRun(d, new URLSearchParams('armtwist=maybe'))).toEqual({ def: d, opts: {}, label: 'armtwist=maybe ignored' });
  }, 120000);

  // ladder rung 13b: holdstill=on|off on the fixture's footwork; registered on every L3/L4/HC footwork since rung 14a
  it('on a fixture registered with the stationary hold keeping its feet (HOLD_STILL_V1 on its footwork, id and all: L3-F6-hold), holdstill=off is the view before it, id and all, and another run; holdstill=on is the registered run and puts it back; a fixture without footwork and unknown values change nothing', async () => {
    const id = 'L3-F6-hold';
    const d = FIX(id);
    expect(d.footwork!.holdStill).toBe(HOLD_STILL_V1);
    expect(d.footwork!.id).toBe(`${preHoldStill(d).footwork!.id}+${HOLD_STILL_V1.id}`);
    const off = labRun(d, new URLSearchParams(`fixture=${id}&holdstill=off`));
    expect(off.label).toBe('hold still off');
    expect(off.def).toEqual(preHoldStill(d));
    expect(off.def.footwork!.holdStill).toBeUndefined();
    // the twin: the still feet change the run
    expect(await summaryOf(off.def, off.opts)).not.toBe(await summaryOf(d, {}));
    const back = labRun(off.def, new URLSearchParams('holdstill=ON'));
    expect(back.label).toBe('hold still on');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('holdstill=on'))).toEqual({ def: d, opts: {}, label: 'hold still on (registered)' });
    expect(labRun(off.def, new URLSearchParams('holdstill=off'))).toEqual({ def: off.def, opts: {}, label: 'hold still off (registered)' });
    const g = allFixtures().find((x) => !x.footwork)!;
    expect(labRun(g, new URLSearchParams('holdstill=on'))).toEqual({ def: g, opts: {}, label: 'holdstill n/a (no footwork)' });
    expect(labRun(d, new URLSearchParams('holdstill=maybe'))).toEqual({ def: d, opts: {}, label: 'holdstill=maybe ignored' });
  }, 120000);

  // contact motion polish 2: latestep=on|off on the fixture's composed footwork; no fixture registers it yet
  it('latestep=on runs the fixture with the late-landing rules on its footwork (`compose.lateLanding`, id and all: L3-F7-loadRelease, another run); latestep=off takes them off again and on the registered fixture is the registered run; a fixture without composed footwork and unknown values change nothing', async () => {
    const id = 'L3-F7-loadRelease';
    const d = FIX(id);
    expect(d.footwork!.compose!.lateLanding).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&latestep=on`));
    expect(on.label).toBe('late step on');
    expect(on.def.footwork!.compose!.lateLanding).toBe(true);
    expect(on.def.footwork!.id).toBe(`${d.footwork!.id}+${LATE_LANDING_ID}`);
    // the twin: the rules change the run
    expect(await summaryOf(on.def, on.opts)).not.toBe(await summaryOf(d, {}));
    const back = labRun(on.def, new URLSearchParams('latestep=OFF'));
    expect(back.label).toBe('late step off');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('latestep=off'))).toEqual({ def: d, opts: {}, label: 'late step off (registered)' });
    expect(labRun(on.def, new URLSearchParams('latestep=on'))).toEqual({ def: on.def, opts: {}, label: 'late step on (registered)' });
    const g = allFixtures().find((x) => !x.footwork?.compose)!;
    expect(labRun(g, new URLSearchParams('latestep=on'))).toEqual({ def: g, opts: {}, label: 'latestep n/a (no composed footwork)' });
    expect(labRun(d, new URLSearchParams('latestep=maybe'))).toEqual({ def: d, opts: {}, label: 'latestep=maybe ignored' });
  }, 120000);

  // ladder rung 13c: upperarm=on|off on the fixture's self-clearance profile; no fixture registers the upper arm in it yet
  it('upperarm=on runs the fixture with the upper arm in the arms\' self-clearance (`upperArm` on its profile, id and all: L3-F16-contactStop, another run); upperarm=off takes it off again and on the registered fixture is the registered run; a fixture without self-clearance and unknown values change nothing', async () => {
    const id = 'L3-F16-contactStop';
    const d = FIX(id);
    expect(d.selfClearance!.upperArm).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&upperarm=on`));
    expect(on.label).toBe('upper arm self-clearance on');
    expect(on.def).toEqual({ ...d, selfClearance: withUpperArmClearance(d.selfClearance!) });
    expect(on.def.selfClearance!.upperArm).toBe(true);
    expect(on.def.selfClearance!.id).toBe(`${d.selfClearance!.id}+upper-arm-v1`);
    // the twin: the upper arm's clearance changes the run (the runner's right elbow at 0.8 s, inside its chest as registered)
    const elbowAt = async (def: FixtureDef): Promise<string> => {
      const s = await create(def, {});
      while (!s.done && s.t < 0.8) s.stepTick();
      const out = JSON.stringify(s.players.find((p) => p.id === 'R')!.pose!.jointLandmarksWorld.rightElbow);
      s.dispose();
      return out;
    };
    expect(await elbowAt(on.def)).not.toBe(await elbowAt(d));
    const back = labRun(on.def, new URLSearchParams('upperarm=OFF'));
    expect(back.label).toBe('upper arm self-clearance off');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('upperarm=off'))).toEqual({ def: d, opts: {}, label: 'upper arm self-clearance off (registered)' });
    expect(labRun(on.def, new URLSearchParams('upperarm=on'))).toEqual({ def: on.def, opts: {}, label: 'upper arm self-clearance on (registered)' });
    const g = allFixtures().find((x) => !x.selfClearance)!;
    expect(labRun(g, new URLSearchParams('upperarm=on'))).toEqual({ def: g, opts: {}, label: 'upperarm n/a (no self-clearance)' });
    expect(labRun(d, new URLSearchParams('upperarm=maybe'))).toEqual({ def: d, opts: {}, label: 'upperarm=maybe ignored' });
  }, 120000);

  // ladder rung 14b: armswing=on|off on the fixture's self-clearance profile; registered on L3, L4 and HC with metArmStay (18e)
  it('armswing=on runs the fixture with its met clip arms keeping their swing (`clipArmSwing` on its profile, id and all: L3-F16-contactStop as before 18e, another run); armswing=off takes it off again and on a fixture without it is that run; it composes after upperarm; a fixture without self-clearance and unknown values change nothing', async () => {
    const id = 'L3-F16-contactStop';
    const d = preMetArmStay(FIX(id));
    expect(d.selfClearance!.clipArmSwing).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&armswing=on`));
    expect(on.label).toBe('clip arm swing on');
    expect(on.def).toEqual({ ...d, selfClearance: withClipArmSwing(d.selfClearance!) });
    expect(on.def.selfClearance!.clipArmSwing).toBe(true);
    expect(on.def.selfClearance!.id).toBe(`${d.selfClearance!.id}+clip-swing-v1`);
    // the twin: the swing changes the run (the defender's left elbow at 0.55 s, the user's screenshot)
    const elbowAt = async (def: FixtureDef): Promise<string> => {
      const s = await create(def, {});
      while (!s.done && s.t < 0.55) s.stepTick();
      const out = JSON.stringify(s.players.find((p) => p.id === 'D')!.pose!.jointLandmarksWorld.leftElbow);
      s.dispose();
      return out;
    };
    expect(await elbowAt(on.def)).not.toBe(await elbowAt(d));
    const back = labRun(on.def, new URLSearchParams('armswing=OFF'));
    expect(back.label).toBe('clip arm swing off');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('armswing=off'))).toEqual({ def: d, opts: {}, label: 'clip arm swing off (registered)' });
    expect(labRun(on.def, new URLSearchParams('armswing=on'))).toEqual({ def: on.def, opts: {}, label: 'clip arm swing on (registered)' });
    const both = labRun(d, new URLSearchParams('upperarm=on&armswing=on'));
    expect(both.def.selfClearance!.id).toBe(`${d.selfClearance!.id}+upper-arm-v1+clip-swing-v1`);
    expect(both.label).toBe('upper arm self-clearance on · clip arm swing on');
    const g = allFixtures().find((x) => !x.selfClearance)!;
    expect(labRun(g, new URLSearchParams('armswing=on'))).toEqual({ def: g, opts: {}, label: 'armswing n/a (no self-clearance)' });
    expect(labRun(d, new URLSearchParams('armswing=maybe'))).toEqual({ def: d, opts: {}, label: 'armswing=maybe ignored' });
  }, 120000);

  // ladder rung 16b: armstay=on|off on the fixture's self-clearance profile; registered on L3, L4 and HC with clipArmSwing (18e)
  it('armstay=on runs the fixture with its met arms keeping their natural pose (`metArmStay` on its profile, id and all: L3-F5-drag as before 18e, another run); armstay=off takes it off again and on a fixture without it is that run; it composes after armswing, and armswing=on&armstay=on on the fixture before 18e is the registered fixture (armstay=off&armswing=off the view before it); a fixture without self-clearance and unknown values change nothing', async () => {
    const id = 'L3-F5-drag';
    const d = preMetArmStay(FIX(id));
    expect(d.selfClearance!.metArmStay).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&armstay=on`));
    expect(on.label).toBe('met arm stay on');
    expect(on.def).toEqual({ ...d, selfClearance: withMetArmStay(d.selfClearance!) });
    expect(on.def.selfClearance!.metArmStay).toBe(true);
    expect(on.def.selfClearance!.id).toBe(`${d.selfClearance!.id}+met-arm-stay-v1`);
    // the twin: the stay changes the run (the carrier's left palm at 1.0 s, as registered at its facemask)
    const palmAt = async (def: FixtureDef): Promise<string> => {
      const s = await create(def, {});
      while (!s.done && s.t < 1.0) s.stepTick();
      const out = JSON.stringify(s.players.find((p) => p.id === 'R')!.pose!.jointLandmarksWorld.leftPalm);
      s.dispose();
      return out;
    };
    expect(await palmAt(on.def)).not.toBe(await palmAt(d));
    const back = labRun(on.def, new URLSearchParams('armstay=OFF'));
    expect(back.label).toBe('met arm stay off');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('armstay=off'))).toEqual({ def: d, opts: {}, label: 'met arm stay off (registered)' });
    expect(labRun(on.def, new URLSearchParams('armstay=on'))).toEqual({ def: on.def, opts: {}, label: 'met arm stay on (registered)' });
    const both = labRun(d, new URLSearchParams('armswing=on&armstay=on'));
    expect(both.def.selfClearance!.id).toBe(`${d.selfClearance!.id}+clip-swing-v1+met-arm-stay-v1`);
    expect(both.label).toBe('clip arm swing on · met arm stay on');
    expect(both.def).toEqual(FIX(id));
    expect(labRun(FIX(id), new URLSearchParams('armstay=off&armswing=off')).def).toEqual(d);
    const g = allFixtures().find((x) => !x.selfClearance)!;
    expect(labRun(g, new URLSearchParams('armstay=on'))).toEqual({ def: g, opts: {}, label: 'armstay n/a (no self-clearance)' });
    expect(labRun(d, new URLSearchParams('armstay=maybe'))).toEqual({ def: d, opts: {}, label: 'armstay=maybe ignored' });
  }, 120000);

  // ladder 17: born=on|off on the fixture's ragdoll profile, composed after armtwist; registered on L3, L4 and HC (17b,
  // V2 since 18c), so the row starts from the definition before those flips; and before the met-arm flip (18e), under
  // which D asks for the conversion later (1.200 s, from 1.129 s: the natural sample is the run before it), and before
  // the contact motion M2 brace flip and the M3 wrap flip (under which the run before the born overlap does not defer D)
  it('born=on runs the fixture with the born-overlap conversion on its ragdoll, id and all (L3-F1-falling before the 17b and 18e flips: D converts at his first try, where that run defers him), which is the registered fixture before the born separation; born=off takes it off again and on a fixture without it is that run; on the registered fixture it keeps V2; a fixture without a ragdoll and unknown values change nothing', async () => {
    const id = 'L3-F1-falling';
    // (contact motion M4: and before the fall flip, under which the run before the born overlap does not defer D either)
    const reg = preMetArmStay(preBrace(preWrap(preFallReact(FIX(id)))));
    expect(reg.ragdoll!.bornOverlap).toBe(BORN_OVERLAP_V2);
    const d = preBornOverlap(reg);
    expect(d.ragdoll!.bornOverlap).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&born=on`));
    expect(on.label).toBe('born overlap on');
    expect(on.def).toEqual({ ...d, ragdoll: withBornOverlap(d.ragdoll!) });
    expect(on.def).toEqual(preBornSeparation(reg));
    expect(on.def.ragdoll!.bornOverlap).toBe(BORN_OVERLAP_V1);
    expect(on.def.ragdoll!.id).toBe(`${d.ragdoll!.id}+born-overlap-v1`);
    // the twin: the run before the flip defers D's conversion (his palm in R's arm), the profile converts him at once
    const dAt = async (def: FixtureDef): Promise<{ t: number; deferred: boolean }> => {
      const s = await create(def, {});
      while (!s.done && s.t < 1.2) s.stepTick();
      const h = s.players.find((p) => p.id === 'D')!.handoff!;
      s.dispose();
      return { t: h.t, deferred: !!h.deferred };
    };
    const [a, b] = [await dAt(d), await dAt(on.def)];
    expect(a.deferred).toBe(true);
    expect(b.deferred).toBe(false);
    expect(b.t).toBeLessThan(a.t);
    const back = labRun(on.def, new URLSearchParams('born=OFF'));
    expect(back.label).toBe('born overlap off');
    expect(back.def).toEqual(d);
    expect(labRun(d, new URLSearchParams('born=off'))).toEqual({ def: d, opts: {}, label: 'born overlap off (registered)' });
    expect(labRun(reg, new URLSearchParams('born=on'))).toEqual({ def: reg, opts: {}, label: 'born overlap on (registered)' });
    const g = allFixtures().find((x) => !x.ragdoll)!;
    expect(labRun(g, new URLSearchParams('born=on'))).toEqual({ def: g, opts: {}, label: 'born on n/a (no ragdoll profile)' });
    expect(labRun(d, new URLSearchParams('born=maybe'))).toEqual({ def: d, opts: {}, label: 'born=maybe ignored' });
  }, 120000);

  // ladder 18: bornsep=on|off on the fixture's born overlap (V1 to V2 and back), composed after born; registered on L3, L4
  // and HC (18c), so the row starts from the definition before that flip, and before the met-arm flip (18e: D converts
  // later, with no born pair released by 1.3 s; the natural sample is the run before it), and before the contact motion
  // M2 brace flip and the M3 wrap flip (under which no born pair of D's is released by 1.3 s)
  it('bornsep=on runs the fixture with its born pairs pushed apart (BORN_OVERLAP_V2 in V1\'s place, its id renamed in place: L3-F1-falling before the 18c and 18e flips, where D\'s palm pair is released with the separation\'s work, which V1\'s release has no part of), which is the registered fixture before the met-arm flip; bornsep=off takes it back; born=on keeps V2; with born=off, or a fixture without a born overlap, it is n/a; unknown values change nothing', async () => {
    const id = 'L3-F1-falling';
    // (contact motion M4: and before the fall flip, under which no born pair of D's is released by 1.3 s either)
    const registered = preMetArmStay(preBrace(preWrap(preFallReact(FIX(id)))));
    expect(registered.ragdoll!.bornOverlap).toBe(BORN_OVERLAP_V2);
    const reg = preBornSeparation(registered);
    expect(reg.ragdoll!.bornOverlap).toBe(BORN_OVERLAP_V1);
    const on = labRun(reg, new URLSearchParams(`fixture=${id}&bornsep=on`));
    expect(on.def).toEqual(registered);
    expect(on.label).toBe('born separation on');
    expect(on.def).toEqual({ ...reg, ragdoll: withBornSeparation(reg.ragdoll!) });
    expect(on.def.ragdoll!.bornOverlap).toBe(BORN_OVERLAP_V2);
    expect(on.def.ragdoll!.id).toBe(reg.ragdoll!.id.replace('+born-overlap-v1', '+born-overlap-v2'));
    expect(withoutBornSeparation(on.def.ragdoll!)).toEqual(reg.ragdoll);
    // the twin: the same release of D's palm pair, with the separation's work counted under V2 only
    const rel = async (def: FixtureDef): Promise<Record<string, unknown>[]> => {
      const s = await create(def, {});
      while (!s.done && s.t < 1.3) s.stepTick();
      const r = s.events.filter((e) => e.type === 'bornOverlapReleased' && e.playerId === 'D').map((e) => e.data as Record<string, unknown>);
      s.dispose();
      return r;
    };
    const [a, b] = [await rel(reg), await rel(on.def)];
    expect(a.length).toBeGreaterThan(0);
    expect(b.map((x) => x.own)).toEqual(a.map((x) => x.own));
    expect(a.every((x) => !('workJ' in x))).toBe(true);
    expect(b.every((x) => typeof x.workJ === 'number')).toBe(true);
    const back = labRun(on.def, new URLSearchParams('bornsep=OFF'));
    expect(back.label).toBe('born separation off');
    expect(back.def).toEqual(reg);
    expect(labRun(reg, new URLSearchParams('bornsep=off'))).toEqual({ def: reg, opts: {}, label: 'born separation off (registered)' });
    expect(labRun(on.def, new URLSearchParams('bornsep=on'))).toEqual({ def: on.def, opts: {}, label: 'born separation on (registered)' });
    expect(labRun(on.def, new URLSearchParams('born=on'))).toEqual({ def: on.def, opts: {}, label: 'born overlap on (registered)' });
    expect(labRun(reg, new URLSearchParams('born=off&bornsep=on')).label).toBe('born overlap off · bornsep n/a (no born overlap)');
    const g = allFixtures().find((x) => !x.ragdoll)!;
    expect(labRun(g, new URLSearchParams('bornsep=on'))).toEqual({ def: g, opts: {}, label: 'bornsep n/a (no born overlap)' });
    expect(labRun(reg, new URLSearchParams('bornsep=maybe'))).toEqual({ def: reg, opts: {}, label: 'bornsep=maybe ignored' });
  }, 120000);

  // contact motion M2: brace=on|off sets the fixture's carrier brace profile (registered on the L3, L4 and HC carriers:
  // brace=off is the view before the flip)
  it('brace=on runs the fixture with the carrier\'s brace (CARRIER_BRACE_V2: L3-F3-collision, another run, the registered one), brace=v1 with V1\'s slow lean; brace=off takes it off again (the view before the flip) and on a fixture without it is that run; a fixture without a composed ball carrier and unknown values change nothing', async () => {
    const id = 'L3-F3-collision';
    const d = preBrace(FIX(id));
    expect(d.brace).toBeUndefined();
    const on = labRun(d, new URLSearchParams(`fixture=${id}&brace=on`));
    expect(on).toEqual({ def: { ...d, brace: CARRIER_BRACE_V2 }, opts: {}, label: 'carrier brace on' });
    expect(on.def).toEqual(FIX(id));
    // the view before the M2 follow-up's lean flip (tests/brace.test.ts has the twin that the lean differs)
    expect(labRun(FIX(id), new URLSearchParams('brace=v1'))).toEqual({ def: { ...d, brace: CARRIER_BRACE_V1 }, opts: {}, label: 'carrier brace v1' });
    expect(labRun(FIX(id), new URLSearchParams('brace=v1')).def).toEqual(preBraceV2(FIX(id)));
    expect(labRun(FIX(id), new URLSearchParams('brace=off'))).toEqual({ def: d, opts: {}, label: 'carrier brace off' });
    // the twin: the brace changes the run (the carrier's right palm, the ball's, at 0.45 s: braced, before contact)
    const palmAt = async (def: FixtureDef): Promise<string> => {
      const s = await create(def, {});
      while (!s.done && s.t < 0.45) s.stepTick();
      const out = JSON.stringify(s.players.find((p) => p.setup.role === 'runner')!.pose!.jointLandmarksWorld.rightPalm);
      s.dispose();
      return out;
    };
    expect(await palmAt(on.def)).not.toBe(await palmAt(d));
    const back = labRun(on.def, new URLSearchParams('brace=OFF'));
    expect(back).toEqual({ def: d, opts: {}, label: 'carrier brace off' });
    expect('brace' in back.def).toBe(false);
    expect(labRun(d, new URLSearchParams('brace=off'))).toEqual({ def: d, opts: {}, label: 'carrier brace off (registered)' });
    expect(labRun(on.def, new URLSearchParams('brace=on'))).toEqual({ def: on.def, opts: {}, label: 'carrier brace on (registered)' });
    const g = allFixtures().find((x) => !x.locomotion)!;
    expect(labRun(g, new URLSearchParams('brace=on'))).toEqual({ def: g, opts: {}, label: 'brace n/a (no composed ball carrier)' });
    expect(labRun(d, new URLSearchParams('brace=maybe'))).toEqual({ def: d, opts: {}, label: 'brace=maybe ignored' });
  }, 120000);

  // contact motion M2 follow-up: balclear=on|off sets the rule profile's `balancedClear` (tests/rules-balance.test.ts
  // has the twin that it changes the run)
  it('balclear=on referees the fixture with influence cleared out of a regained balance; balclear=off as before; a fixture without football rules and unknown values change nothing', () => {
    const d = FIX('L3-F1-falling');
    const off = { ...d, rules: withoutBalancedClear(d.rules!) };
    const on = { ...d, rules: withBalancedClear(d.rules!) };
    expect(labRun(off, new URLSearchParams('balclear=on'))).toEqual({ def: on, opts: {}, label: 'balanced clear on' });
    expect(labRun(on, new URLSearchParams('balclear=OFF'))).toEqual({ def: off, opts: {}, label: 'balanced clear off' });
    expect(labRun(on, new URLSearchParams('balclear=on'))).toEqual({ def: on, opts: {}, label: 'balanced clear on (registered)' });
    expect(labRun(off, new URLSearchParams('balclear=off'))).toEqual({ def: off, opts: {}, label: 'balanced clear off (registered)' });
    const g = allFixtures().find((x) => !x.rules)!;
    expect(labRun(g, new URLSearchParams('balclear=on'))).toEqual({ def: g, opts: {}, label: 'balclear n/a (no football rules)' });
    expect(labRun(d, new URLSearchParams('balclear=maybe'))).toEqual({ def: d, opts: {}, label: 'balclear=maybe ignored' });
  });

  // contact motion M3: wrap=on|v3|v2|v1|off sets the fixture's wrap profile (tests/wrap-open.test.ts,
  // tests/wrap-takedown.test.ts, tests/wrap-hold.test.ts and tests/wrap-strike.test.ts have the twins that it changes the run)
  it('wrap=on runs the wrapping defender with WRAP_V9 (the fall link on WRAP_V8), wrap=v8 with WRAP_V8 (the bound-legs fall on WRAP_V7), wrap=v7 with WRAP_V7 (the ride-down on WRAP_V5), wrap=v5 with WRAP_V5 (the drive on WRAP_V4), wrap=v4 with WRAP_V4 (the strike on WRAP_V3), wrap=v3 with WRAP_V3 (the cradle, the close on touch, the committed finish and the hold carried through it), wrap=v2 with WRAP_V2 (the finish, his arms let go at it), wrap=v1 with WRAP_V1 (the cradle only); wrap=off without any; a fixture without a wrapping defender and unknown values change nothing', () => {
    const { wrap, ...off } = FIX('L3-F4-twoArm');
    void wrap;
    const v1: FixtureDef = { ...off, wrap: WRAP_V1 };
    const v2: FixtureDef = { ...off, wrap: WRAP_V2 };
    const v3: FixtureDef = { ...off, wrap: WRAP_V3 };
    const v4: FixtureDef = { ...off, wrap: WRAP_V4 };
    const v5: FixtureDef = { ...off, wrap: WRAP_V5 };
    const v7: FixtureDef = { ...off, wrap: WRAP_V7 };
    const v8: FixtureDef = { ...off, wrap: WRAP_V8 };
    const on: FixtureDef = { ...off, wrap: WRAP_V9 };
    expect(FIX('L3-F4-twoArm').wrap).toBe(WRAP_V9);
    expect(labRun(on, new URLSearchParams('wrap=v8'))).toEqual({ def: v8, opts: {}, label: 'wrap v8' });
    expect(labRun(v8, new URLSearchParams('wrap=V8'))).toEqual({ def: v8, opts: {}, label: 'wrap v8 (registered)' });
    expect(labRun(v8, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(v8, new URLSearchParams('wrap=v9'))).toEqual({ def: on, opts: {}, label: 'wrap v9' });
    expect(labRun(on, new URLSearchParams('wrap=v9'))).toEqual({ def: on, opts: {}, label: 'wrap v9 (registered)' });
    expect(labRun(on, new URLSearchParams('wrap=v7'))).toEqual({ def: v7, opts: {}, label: 'wrap v7' });
    expect(labRun(v7, new URLSearchParams('wrap=V7'))).toEqual({ def: v7, opts: {}, label: 'wrap v7 (registered)' });
    expect(labRun(v7, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(on, new URLSearchParams('wrap=v5'))).toEqual({ def: v5, opts: {}, label: 'wrap v5' });
    expect(labRun(v5, new URLSearchParams('wrap=V5'))).toEqual({ def: v5, opts: {}, label: 'wrap v5 (registered)' });
    expect(labRun(v5, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(on, new URLSearchParams('wrap=v4'))).toEqual({ def: v4, opts: {}, label: 'wrap v4' });
    expect(labRun(v4, new URLSearchParams('wrap=v4'))).toEqual({ def: v4, opts: {}, label: 'wrap v4 (registered)' });
    expect(labRun(v4, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(on, new URLSearchParams('wrap=v3'))).toEqual({ def: v3, opts: {}, label: 'wrap v3' });
    expect(labRun(v3, new URLSearchParams('wrap=v3'))).toEqual({ def: v3, opts: {}, label: 'wrap v3 (registered)' });
    expect(labRun(v3, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(on, new URLSearchParams('wrap=v2'))).toEqual({ def: v2, opts: {}, label: 'wrap v2' });
    expect(labRun(v2, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(v2, new URLSearchParams('wrap=v2'))).toEqual({ def: v2, opts: {}, label: 'wrap v2 (registered)' });
    expect(labRun(off, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(off, new URLSearchParams('wrap=v1'))).toEqual({ def: v1, opts: {}, label: 'wrap v1' });
    expect(labRun(on, new URLSearchParams('wrap=v1'))).toEqual({ def: v1, opts: {}, label: 'wrap v1' });
    expect(labRun(v1, new URLSearchParams('wrap=v1'))).toEqual({ def: v1, opts: {}, label: 'wrap v1 (registered)' });
    const back = labRun(on, new URLSearchParams('wrap=OFF'));
    expect(back).toEqual({ def: off, opts: {}, label: 'wrap off' });
    expect('wrap' in back.def).toBe(false);
    expect(labRun(on, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on (registered)' });
    expect(labRun(off, new URLSearchParams('wrap=off'))).toEqual({ def: off, opts: {}, label: 'wrap off (registered)' });
    const g = FIX('L3-F3-collision');
    expect(g.players.some((p) => p.controller.kind === 'wrapAttempt')).toBe(false);
    expect(labRun(g, new URLSearchParams('wrap=on'))).toEqual({ def: g, opts: {}, label: 'wrap n/a (no wrapping defender)' });
    expect(labRun(off, new URLSearchParams('wrap=maybe'))).toEqual({ def: off, opts: {}, label: 'wrap=maybe ignored' });
  });

  // contact motion polish 1.4: wrap=v6 runs the low strike (no fixture registers it; tests/wrap-low.test.ts has the twins
  // that it changes the run)
  it('wrap=v6 runs the wrapping defender with WRAP_V6 (the low strike, on WRAP_V8 since the bound-legs fall), which no fixture registers; wrap=on takes it back to WRAP_V9; a fixture without a wrapping defender changes nothing', () => {
    const on = FIX('L3-F19-front');
    expect(on.wrap).toBe(WRAP_V9);
    const v6: FixtureDef = { ...on, wrap: WRAP_V6 };
    expect(labRun(on, new URLSearchParams('wrap=v6'))).toEqual({ def: v6, opts: {}, label: 'wrap v6' });
    expect(labRun(v6, new URLSearchParams('wrap=V6'))).toEqual({ def: v6, opts: {}, label: 'wrap v6 (registered)' });
    expect(labRun(v6, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    const g = FIX('L3-F3-collision');
    expect(labRun(g, new URLSearchParams('wrap=v6'))).toEqual({ def: g, opts: {}, label: 'wrap n/a (no wrapping defender)' });
  });

  // contact motion polish 1.2, the ride-down flip: every fixture the drive flip gave WRAP_V5 registers WRAP_V7 (the
  // ride-down); wrap=v5 is the view before it (tests/wrap-ride.test.ts has the twins that it changes the run)
  it('the ride-down flip: an L3, L4 or HC wrap fixture registers the ride-down (WRAP_V9 since the hold flip, on WRAP_V8 and WRAP_V7), wrap=v5 runs it with WRAP_V5 (the drive, before the flip); WRAP_V6 stays unregistered; G, L1, L2 and RH register no wrap; a fixture without a wrapping defender changes nothing', () => {
    const on = FIX('L3-F19-front');
    expect(on.wrap).toBe(WRAP_V9);
    expect(on.wrap!.ride).toBe(WRAP_V7.ride);
    const v5: FixtureDef = { ...on, wrap: WRAP_V5 };
    expect(labRun(on, new URLSearchParams('wrap=v5'))).toEqual({ def: v5, opts: {}, label: 'wrap v5' });
    expect(labRun(v5, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    const all = allFixtures();
    expect(all.filter((d) => d.wrap?.id === WRAP_V5.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.id === WRAP_V7.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.id === WRAP_V8.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.id === WRAP_V6.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap && !/^(L3|L4|HC)-/.test(d.id)).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.id === WRAP_V9.id).length).toBeGreaterThan(0);
    const g = FIX('L3-F3-collision');
    expect(labRun(g, new URLSearchParams('wrap=v5'))).toEqual({ def: g, opts: {}, label: 'wrap n/a (no wrapping defender)' });
  });

  // contact motion M4: fall=on|v1|off registers FALL_REACT_V2 (since the palm-load flip) or FALL_REACT_V1 on an L3 or HC
  // fixture, or removes it (tests/fall-react.test.ts has the twins that it changes the run)
  it('fall=on runs an L3 or HC fixture with FALL_REACT_V2 (every falling player reacts, a landed palm bears load), fall=v1 with FALL_REACT_V1 (before the palm-load flip), fall=off without either (limp); without the hip stops (hips=off) it is off; an L4 fixture, a fixture without a ragdoll and unknown values change nothing', () => {
    const { fallResponse, ...off } = FIX('L3-F19-front');
    void fallResponse;
    const on: FixtureDef = { ...off, fallResponse: FALL_REACT_V2 };
    const v1: FixtureDef = { ...off, fallResponse: FALL_REACT_V1 };
    expect(FIX('L3-F19-front').fallResponse).toBe(FALL_REACT_V2);
    expect(labRun(off, new URLSearchParams('fall=on'))).toEqual({ def: on, opts: {}, label: 'fall on' });
    expect(labRun(on, new URLSearchParams('fall=on'))).toEqual({ def: on, opts: {}, label: 'fall on (registered)' });
    const back = labRun(on, new URLSearchParams('fall=OFF'));
    expect(back).toEqual({ def: off, opts: {}, label: 'fall off' });
    expect('fallResponse' in back.def).toBe(false);
    expect(labRun(off, new URLSearchParams('fall=off'))).toEqual({ def: off, opts: {}, label: 'fall off (registered)' });
    expect(labRun(on, new URLSearchParams('fall=v1'))).toEqual({ def: v1, opts: {}, label: 'fall v1' });
    expect(labRun(off, new URLSearchParams('fall=V1'))).toEqual({ def: v1, opts: {}, label: 'fall v1' });
    expect(labRun(v1, new URLSearchParams('fall=v1'))).toEqual({ def: v1, opts: {}, label: 'fall v1 (registered)' });
    const hc = FIX('HC-F3-lowRunner');
    expect(hc.fallResponse).toBe(FALL_REACT_V2);
    expect(labRun(hc, new URLSearchParams('fall=v1')).def.fallResponse).toBe(FALL_REACT_V1);
    for (const id of ['L4-F2-back-on', 'L4-F2-back-off']) {
      const l4 = FIX(id);
      expect(labRun(l4, new URLSearchParams('fall=on'))).toEqual({ def: l4, opts: {}, label: 'fall n/a (not an L3 or HC fixture)' });
    }
    const bare = { ...off, ragdoll: undefined };
    expect(labRun(bare, new URLSearchParams('fall=on'))).toEqual({ def: bare, opts: {}, label: 'fall n/a (no ragdoll profile)' });
    const g = allFixtures().find((d) => d.id.startsWith('G'))!;
    expect(labRun(g, new URLSearchParams('fall=on'))).toEqual({ def: g, opts: {}, label: 'fall n/a (not an L3 or HC fixture)' });
    expect(labRun(off, new URLSearchParams('fall=maybe'))).toEqual({ def: off, opts: {}, label: 'fall=maybe ignored' });
    expect(labRun(off, new URLSearchParams('fall=v2'))).toEqual({ def: off, opts: {}, label: 'fall=v2 ignored' });
    // the response bounds an L3 or HC hip by its hard stops: a view without them is limp, named last
    const noStops = labRun(on, new URLSearchParams('hips=off&fall=on'));
    expect(noStops.label).toBe('hip stops off · fall on (registered) · fall off (no hip stops)');
    expect('fallResponse' in noStops.def).toBe(false);
    expect(noStops.def.ragdoll!.hipStops).toBeUndefined();
    const noStopsV1 = labRun(on, new URLSearchParams('hips=off&fall=v1'));
    expect(noStopsV1.label).toBe('hip stops off · fall v1 · fall off (no hip stops)');
    expect('fallResponse' in noStopsV1.def).toBe(false);
  });
});
