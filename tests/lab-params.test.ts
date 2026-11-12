import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import type { SimOptions } from '../src/sim/simulation';
import { labRun } from '../src/lab/lab-params';
import { HOLD_STILL_V1 } from '../src/sim/footwork';
import {
  CONVERSION_RETRY_V1, HIP_STOPS_L4_V1, HIP_STOPS_V2, hipStopsFor, LEG_GUARD_V1, LEG_GUARD_V3, SELF_LEGS_V1, SHOULDER_TWIST_ANAT_V1, withAdditionalPgsIterations, withConversionRetry, withHipStops,
  withKneeStop, withoutConversionRetry, withoutHipStops, withoutKneeStop, withoutPgsIterations, withSelfLegs, withShoulderTwistLimit, withUpperArmClearance, withClipArmSwing, withMetArmStay,
} from '../src/sim/profiles';
import { allFixtures } from '../src/sim/fixtures';
import { create, FIX, flip8i, preFlip, preHoldStill, preOwnLegs, preV3, runSim } from './helpers';

// Ladder: the lab's `order`, `legs`, `hips`, `pgs`, `knees`, `retry`, `selfleg`, `armtwist`, `holdstill`, `upperarm`, `armswing` and `armstay` URL parameters (src/lab/lab-params.ts) make the run the full check's matrices make:
// reversed is SimOptions.reverseOrder (scripts/check/legmx.ts, l4mx.ts), a leg guard is the fixture with that profile in
// place of its own (the triage's V3 map).
const summaryOf = async (def: FixtureDef, opts: SimOptions): Promise<string> => {
  const s = await create(def, opts);
  await runSim(s);
  const out = JSON.stringify(s.summary());
  s.dispose();
  return out;
};

describe('lab URL parameters: order, legs, hips, pgs, knees, retry, selfleg, armtwist, holdstill, upperarm, armswing and armstay', () => {
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
    // (the profile before the visible flip, which registers this variant with the deferred conversion)
    const d = preFlip(FIX(id));
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
    // (the profile before the visible flip)
    const d = preFlip(FIX('L3-F9-convert-free'));
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
    // the ladder 10 flip: under V3 the variant alone converts D, its posed legs held out of R)
    const d = preV3(preFlip(FIX(id)));
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
      const before = labRun(d, new URLSearchParams(`fixture=${id}&legs=v1&hips=off&pgs=0&knees=off&retry=off&selfleg=off`));
      expect(before.label, id).toBe('legs V1 · hip stops off · pgs +0 · knee stop off · conversion retry off · own-leg contact off');
      expect(before.def, id).toEqual(preV3(preFlip(d)));
      expect(before.def.legGuard, id).toBe(LEG_GUARD_V1);
      expect(before.def.ragdoll!.id, id).toBe(preFlip(d).ragdoll!.id);
      const run = await summaryOf(before.def, before.opts);
      expect(run, id).toBe(await summaryOf(preV3(preFlip(d)), {}));
      // the twin: the registered run, which the flips change
      expect(await summaryOf(d, {}), id).not.toBe(run);
      // without legs=v1 (the 9d before-view) the leg guard stays the registered V3: not the view before the flips
      const noLegs = labRun(d, new URLSearchParams(`fixture=${id}&hips=off&pgs=0&knees=off&retry=off&selfleg=off`));
      expect(noLegs.def.legGuard, id).toBe(LEG_GUARD_V3);
      expect(noLegs.def, id).toEqual(preFlip(d));
      const after = labRun(d, new URLSearchParams(`fixture=${id}&legs=v3&hips=on&pgs=4&knees=140&retry=on&selfleg=on`));
      expect(after.def, id).toBe(d);
      expect(after.label, id).toBe('legs V3 (registered) · hip stops on (registered) · pgs +4 (registered) · knee stop 140 (registered) · conversion retry on (registered) · own-leg contact on (registered)');
    }
    // the leg guard alone moves the before-view's run (HC-F5-strictTransfer: D's thigh met by R's under V3)
    const hc = FIX('HC-F5-strictTransfer');
    expect(await summaryOf(preFlip(hc), {})).not.toBe(await summaryOf(preV3(preFlip(hc)), {}));
  }, 120000);

  // ladder rung 9a: selfleg=on|off, composed after the others; registered on every L3/L4/HC ragdoll since the own-leg flip
  it('on a fixture registered with own-leg contact (HC-F1-at0.9: every ragdoll gets its own-leg shapes), selfleg=off is the view before it, id and all, and its run differs; selfleg=on is the registered run and puts it back; with the view before both flips it is named last; unknown values change nothing', async () => {
    const id = 'HC-F1-at0.9';
    const d = FIX(id);
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
    // composed after the others: on the view before both flips, its id is named last
    const pre = labRun(preFlip(d), new URLSearchParams('selfleg=on&hips=off&pgs=0&knees=off&retry=off'));
    expect(pre.label).toBe('hip stops off (registered) · pgs +0 (registered) · knee stop off (registered) · conversion retry off (registered) · own-leg contact on');
    expect(pre.def).toEqual({ ...preFlip(d), ragdoll: withSelfLegs(preFlip(d).ragdoll!) });
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

  // ladder rung 14b: armswing=on|off on the fixture's self-clearance profile; no fixture registers it yet
  it('armswing=on runs the fixture with its met clip arms keeping their swing (`clipArmSwing` on its profile, id and all: L3-F16-contactStop, another run); armswing=off takes it off again and on the registered fixture is the registered run; it composes after upperarm; a fixture without self-clearance and unknown values change nothing', async () => {
    const id = 'L3-F16-contactStop';
    const d = FIX(id);
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

  // ladder rung 16b: armstay=on|off on the fixture's self-clearance profile; no fixture registers it yet
  it('armstay=on runs the fixture with its met arms keeping their natural pose (`metArmStay` on its profile, id and all: L3-F5-drag, another run); armstay=off takes it off again and on the registered fixture is the registered run; it composes after armswing; a fixture without self-clearance and unknown values change nothing', async () => {
    const id = 'L3-F5-drag';
    const d = FIX(id);
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
    const g = allFixtures().find((x) => !x.selfClearance)!;
    expect(labRun(g, new URLSearchParams('armstay=on'))).toEqual({ def: g, opts: {}, label: 'armstay n/a (no self-clearance)' });
    expect(labRun(d, new URLSearchParams('armstay=maybe'))).toEqual({ def: d, opts: {}, label: 'armstay=maybe ignored' });
  }, 120000);
});
