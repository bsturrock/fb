// Plan 10a: the test gate and evidence integrity. The fixture runner cannot damage committed evidence, exports identify
// their profiles by id and by value, reset leaves nothing behind, events are stamped with their trace row, stops keep
// their cause, numerical failures stop at once, and the engine lifecycle is safe to repeat.
// Plan 10f (F2): debug switches belong to one simulation. Two simulations stepped side by side in one process, one with a
// switch on, each reproduce their own solo run; the export records every switch that is on and nothing otherwise; the
// read-only pose diagnostics change nothing and are not exported.
// Plan 13b: every plan's opt-in check (its profile on for exactly its fixtures) and export check (the export names its
// profiles by id and by value), one table each.
// Lab render contract (plan 06 pass 3; plan 13a look-ahead playback). The lab draws per-tick snapshots, interpolated
// between the two frames around the shown time; the follow camera tracks what is drawn. The simulation runs ahead of
// the shown time within a wall-time budget per display frame, so a slow tick costs buffer lead, not frames.
// Plan 13c: the lab's review set is a short list of registered model-body fixtures; the full list and the filter reach
// every other fixture.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { FixedStepDriver } from '../src/sim/driver';
import { cullGeom, geomNear, initPhysics, PhysicsWorld, RAPIER, shapeRadius } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { poseProbe, type SimDebug } from '../src/sim/debug';
import { followCenter } from '../src/lab/follow';
import { Playback, type PlaybackSource } from '../src/lab/playback';
import { FrameCapture, type LabFrame } from '../src/lab/snapshot';
import { REVIEW_SET } from '../src/lab/review-set';
import { filterList, fixtureList, inReviewSet } from '../src/lab/fixture-list';
import { MODEL_CALIBRATION_ID } from '../src/sim/model/profiles';
import * as L1 from '../src/sim/fixtures/locomotion';
import { len, v3, type Vec3 } from '../src/sim/vec';
import { assertUniqueIds, runFixtures } from '../scripts/fixture-runner';
import { SHAPE_QUERY_BUDGET } from '../scripts/check/lib';
import { g1f4, g1f8Cases, g1f9Fit } from '../src/sim/fixtures/gate1';
import { asL3 } from '../src/sim/fixtures/transitions';
import { FOOTWORK_L2, FOOTWORK_L3, HOLD_STILL_V1, withHoldStill } from '../src/sim/footwork';
import { LOCOMOTION_L3, LOCOMOTION_L3_IDLE } from '../src/sim/locomotion';
import { onModel } from '../src/sim/fixtures/with-locomotion';
import { suppliedRunClips } from '../src/sim/model/run-clips';
import { FALL_L4, JOINT_RANGE_V2, LEG_GUARD_V1, LEG_GUARD_V2, LEG_GUARD_V3, RULES_FOOTBALL, rulesRevision2, SELF_CLEARANCE_V1, SOLVER_G1, withClipArmSwing, withMetArmStay } from '../src/sim/profiles';
import { ruleProfileExport } from '../src/sim/rules';
import { asCaptured, breathe, create, FIX, pace, rows, run, runSim, shapeQueryCounter, traceRowsDiff } from './helpers';
import { loadState, resumeState } from './state';

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
/** Key-order independent serialization (deep equality of plain profile data). */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * L4-F10-wrap-on stepped directly, once for the file: the core position after every tick (the lab's real-fixture frames
 * are compared with it) and the most Rapier shape queries in one tick (plan 13a). Counting never changes a result.
 */
let wrapOnRun: Promise<{ ref: { t: number; core: Vec3 }[]; worst: { n: number; t: number } }> | null = null;
function wrapOnDirect(): NonNullable<typeof wrapOnRun> {
  return (wrapOnRun ??= (async () => {
    await initPhysics();
    const q = shapeQueryCounter();
    try {
      const direct = await create(FIX('L4-F10-wrap-on'));
      q.take();
      let worst = { n: 0, t: 0 };
      const ref: { t: number; core: Vec3 }[] = [];
      const corePos = (s: Simulation): Vec3 => ({ ...s.poseOf(s.players[0]).p });
      ref.push({ t: direct.t, core: corePos(direct) });
      while (!direct.done) {
        direct.stepTick();
        const n = q.take();
        if (n > worst.n) worst = { n, t: direct.t };
        ref.push({ t: direct.t, core: corePos(direct) });
        await pace();
      }
      direct.dispose();
      return { ref, worst };
    } finally {
      q.restore();
    }
  })());
}

describe('10a A2: the fixture runner', () => {
  const CHECKS: [string, () => Promise<void>][] = [
    [
      'a filtered run writes summary.filtered.json and leaves summary.json byte-identical',
      async () => {
        const committed = sha('evidence/summary.json');
        const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
        try {
          const sentinel = join(dir, 'summary.json');
          writeFileSync(sentinel, '[{"sentinel":true}]');
          const before = sha(sentinel);
          const r = await runFixtures({ filter: /^G1-F1$/, evidenceDir: dir, log: () => {} });
          expect(r.failed).toEqual([]);
          expect(r.summaries.map((s) => s.fixtureId)).toEqual(['G1-F1']);
          expect(r.summaryPath).toBe(join(dir, 'summary.filtered.json'));
          expect(JSON.parse(readFileSync(r.summaryPath!, 'utf8'))).toHaveLength(1);
          expect(sha(sentinel)).toBe(before);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        expect(sha('evidence/summary.json')).toBe(committed);
      },
    ],
    [
      'duplicate ids are refused; a fixture that throws fails the run, writes no summary and still disposes',
      async () => {
        const g = FIX('G1-F1');
        expect(() => assertUniqueIds([g, { ...g }])).toThrow(/duplicate fixture id G1-F1/);
        const bad: FixtureDef = { ...g, id: 'G1-F1-badMotor', motor: { ...g.motor, braking: { maxDecelMps2: -1 } } };
        const dir = mkdtempSync(join(tmpdir(), 'fixtures-'));
        try {
          const r = await runFixtures({ defs: [g, bad], evidenceDir: dir, log: () => {} });
          expect(r.failed.map((f) => f.id)).toEqual(['G1-F1-badMotor']);
          expect(r.summaryPath).toBeNull();
          expect(() => readFileSync(join(dir, 'summary.json'))).toThrow();
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    ],
  ];

  it('a filtered run leaves summary.json byte-identical; duplicate ids are refused; a fixture that throws fails the run, writes no summary and still disposes', async () => {
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Plan 13b: the profile opt-in checks and the export checks of every plan, one table each (each row is the plan's own
// test, its assertions as they were)

type Row = [string, () => void | Promise<void>];

const OPT_IN: Row[] = [
  [
    'G4 does not alter prior gate profiles: every G1-G3 fixture keeps SOLVER_G1 and declares no ragdoll or rule profile',
    () => {
      for (const d of allFixtures().filter((f) => f.gate < 4)) {
        expect(d.solver).toEqual(SOLVER_G1);
        expect(d.ragdoll).toBeUndefined();
        expect(d.rules).toBeUndefined();
      }
    },
  ],
  [
    'L2 braking limit: L2 locomotion fixtures use the braking motor; RH, tackle copies and support repairs keep theirs',
    () => {
      for (const d of allFixtures()) {
        if (d.id.startsWith('L3-')) continue; // plan 08 copies keep the motor of the fixture each was built from
        // L2-F3-runStopHard: the same run stopped by the original motor (plan 07 item 3 regression), deliberately unbraked
        const loco = /^L2-F(1|2|3|4|5|6|7|11|12)-/.test(d.id) && d.id !== 'L2-F3-runStopHard';
        const ms = [d.motor, ...d.players.map((p) => p.motor).filter((m) => m !== undefined)];
        for (const m of ms) expect(!!m!.braking, `${d.id} ${m!.id}`).toBe(loco);
      }
    },
  ],
  [
    'plan 08: only L3 (and, plan 13e, HC) fixtures take the composed planner and the locomotion profile; earlier ids keep their paths',
    () => {
      expect(FOOTWORK_L2.compose).toBeUndefined();
      expect(FOOTWORK_L3.id).toBe('footwork-l3-v4');
      expect(LOCOMOTION_L3.id).toBe('locomotion-l3-v3');
      expect(LOCOMOTION_L3_IDLE.id).toBe('locomotion-l3-v4');
      for (const d of allFixtures()) {
        if (d.id.startsWith('L4-')) continue; // later than L3: its falls start from L3 fixtures, with their profiles
        if (d.id.startsWith('L3-') || d.id.startsWith('HC-')) {
          // the player model plays the idle cycle; the authored body keeps the static fitted idle (the planner with the
          // stationary hold's still feet since rung 14a: the row below)
          expect(d.footwork, d.id).toEqual(withHoldStill(FOOTWORK_L3));
          expect(d.locomotion, d.id).toBe(onModel(d) ? LOCOMOTION_L3_IDLE : LOCOMOTION_L3);
        } else {
          expect(d.locomotion, d.id).toBeUndefined();
          expect((d.footwork as typeof FOOTWORK_L3 | undefined)?.compose, d.id).toBeUndefined();
        }
      }
    },
  ],
  [
    'L4: only L4 fixtures carry a response or an envelope',
    () => {
      for (const d of allFixtures().filter((x) => x.milestone !== 'L4')) {
        expect(d.fallResponse, d.id).toBeUndefined();
        expect(d.ragdoll?.envelope, d.id).toBeUndefined();
      }
    },
  ],
  [
    'plan 10b: the coached entry aims with the phase it has just observed in L3 and later; the gate 1 fixtures do not',
    () => {
      const l3 = asL3(g1f9Fit(), 'L3-x');
      expect(l3.players.find((p) => p.id === 'D')!.controller).toMatchObject({ kind: 'coachedEntry', phaseFirst: true });
      for (const d of [g1f9Fit(), ...g1f8Cases()]) for (const p of d.players) expect((p.controller as { phaseFirst?: boolean }).phaseFirst, d.id).toBeUndefined();
    },
  ],
  [
    'plan 10e: L3 and L4 referee on revision 2; every historical fixture keeps its profile, with no revision in its export',
    () => {
      const REV2 = rulesRevision2(RULES_FOOTBALL('R', { sideline: false }));
      const all = allFixtures().filter((d) => d.rules);
      const recent = all.filter((d) => /^L[34]$/.test(d.milestone));
      const hist = all.filter((d) => !/^L[34]$/.test(d.milestone));
      expect(recent.length).toBeGreaterThan(30);
      expect(hist.length).toBeGreaterThan(20);
      for (const d of recent) {
        expect(d.rules!.revision, d.id).toBe(2);
        expect(d.rules!.id, d.id).toMatch(/\+revision=2$/);
      }
      for (const d of hist) {
        expect(d.rules!.revision, d.id).toBeUndefined();
        expect(d.rules!.id, d.id).not.toContain('revision');
        expect(Object.keys(ruleProfileExport(d.rules!)), d.id).not.toContain('revision');
      }
      // idempotent: an L3 fixture's rules are not wrapped again by L4
      expect(rulesRevision2(REV2)).toBe(REV2);
    },
  ],
  [
    'plan 12: joint range is on for exactly the L3, L4 and HC fixtures, and the export records it',
    async () => {
      // contact motion M1: joint-range-v2 (plan 12's ranges, with the upper-arm twist kept in range)
      const J = JOINT_RANGE_V2;
      for (const d of allFixtures()) expect(d.jointRange, d.id).toBe(/^(L3|L4|HC)$/.test(d.milestone) ? J : undefined);
      for (const d of [FIX('L3-F16-sprint'), FIX('L2-F14-oneArmFeet')]) {
        const sim = await Simulation.create(d);
        const e = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
        expect(e.profileIds.jointRange, d.id).toBe(d.jointRange?.id);
        expect(e.profiles.jointRange, d.id).toEqual(d.jointRange);
        sim.dispose();
      }
    },
  ],
  [
    'plan 13f, ladder 10: the leg guard is on for exactly the L3, L4 and HC fixtures, as V3 since the flip, and the export records it; V1 and the swept V2 are on for none',
    async () => {
      for (const d of allFixtures()) expect(d.legGuard, d.id).toBe(/^(L3|L4|HC)$/.test(d.milestone) ? LEG_GUARD_V3 : undefined);
      expect(LEG_GUARD_V1).toEqual({ id: 'leg-guard-predictive-v1', aheadS: 1 / 240 });
      // rung 5: the swept step is a separate profile; rung 6 adds the physical legs (V3, the one registered: the line above)
      expect(LEG_GUARD_V2).toEqual({ id: 'leg-guard-sweep-v2', aheadS: 1 / 240, sweep: true });
      expect(LEG_GUARD_V3).toEqual({ ...LEG_GUARD_V2, id: 'leg-guard-physical-v3', physicalLegs: true });
      for (const d of [FIX('L3-F16-sprint'), FIX('L2-F14-oneArmFeet')]) {
        const sim = await Simulation.create(d);
        const e = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
        expect(e.profileIds.legGuard, d.id).toBe(d.legGuard?.id);
        expect(e.profiles.legGuard, d.id).toEqual(d.legGuard);
        sim.dispose();
      }
    },
  ],
  [
    'ladder 14a: the stationary hold keeps its feet (HOLD_STILL_V1) on exactly the L3, L4 and HC foot planners, and the export records it; L2\'s planner has none',
    async () => {
      const planned = allFixtures().filter((d) => d.footwork);
      expect(planned.some((d) => !/^(L3|L4|HC)-/.test(d.id))).toBe(true);
      for (const d of planned) expect(d.footwork!.holdStill, d.id).toBe(/^(L3|L4|HC)-/.test(d.id) ? HOLD_STILL_V1 : undefined);
      for (const d of [FIX('L3-F16-sprint'), FIX('L2-F14-oneArmFeet')]) {
        const sim = await Simulation.create(d);
        const e = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
        expect(e.profileIds.footwork, d.id).toBe(d.footwork!.id);
        expect(e.profiles.footwork, d.id).toEqual(d.footwork);
        sim.dispose();
      }
    },
  ],
];

const EXPORTS: Row[] = [
  [
    'G1-C: exported fixture JSON carries schema, profiles, solver settings, tick-indexed inputs and measured mass',
    async () => {
      const sim = await run(g1f4({ kind: 'compound' }));
      const ex = sim.exportFixture() as any;
      expect(ex.schemaVersion).toBe('tackling-v1.1');
      expect(ex.profileIds.solver).toBe('solver-g1-1x60');
      expect(ex.profileIds.stance).toBe('stance-g1-pitchRollLocked');
      expect(ex.players[0].controller.segments[0].fromTick).toBe(0);
      expect(ex.players[0].measuredMass.massKg).toBeCloseTo(100, 3);
      expect(ex.profiles.solver.passiveFriction).toBe(0.7);
      expect(ex.randomSeed).toBeNull();
      expect(JSON.parse(JSON.stringify(ex))).toEqual(ex);
    },
  ],
  [
    'L1: export and trace carry the clip profile identity and per-player playback',
    async () => {
      const def = L1.l1f4();
      const sim = await Simulation.create(def);
      sim.stepTick();
      await pace();
      const ex = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
      expect(ex.profileIds.runClips).toBe(def.runClips!.id);
      expect(def.runClips!.id).toBe(`run-clips:${suppliedRunClips().map((c) => c.identity).join('+')}+jog-v1`);
      const json = JSON.stringify(ex.profiles.runClips);
      for (const c of suppliedRunClips()) expect(json).toContain(c.identity);
      expect(json).not.toContain('"frames"');
      // plan 13d: the jog block, by value; the trace carries the stride share
      expect((ex.profiles.runClips as { run?: unknown }).run).toEqual({ minStride: 0.45, liftScale: 1, shareRadPerS: 12 });
      const row = sim.trace.at(-1)!.players;
      for (const id of ['R', 'D']) expect(Object.keys(row[id].run!).sort()).toEqual(['b', 'clip', 'r', 'res', 's', 'u', 'v', 'w', 'wt']);
      // fixtures without a clip profile export and trace nothing new
      const g = await Simulation.create(FIX('G4-F3-twoArm-M'));
      g.stepTick();
      await pace();
      expect((g.exportFixture() as { profileIds: Record<string, unknown> }).profileIds.runClips).toBeUndefined();
      expect(g.trace.at(-1)!.players.R.run).toBeUndefined();
      for (const s of [sim, g]) s.dispose();
    },
  ],
  [
    'plan 08: the export names the locomotion and footwork profiles and the per-player mode',
    async () => {
      const sim = await run(FIX('L3-F7-phase0'));
      const x = sim.exportFixture() as { profiles: Record<string, unknown> };
      expect(JSON.stringify(x.profiles)).toContain('locomotion-l3-v4');
      expect(JSON.stringify(x.profiles)).toContain('footwork-l3-v4');
      expect(sim.trace.at(-1)!.players.R.loco).toBeDefined();
      sim.dispose();
    },
  ],
  [
    'L4: exports report solver, profiles, effort and limit error',
    async () => {
      const s = await run(FIX('L4-F3-forward-on'));
      const e = s.exportFixture() as any;
      expect(e.profiles.fallResponse.id).toBe(FALL_L4.id);
      expect(e.profileIds.fallResponse).toBe(FALL_L4.id);
      expect(e.solver?.id ?? e.profileIds.solver).toBeDefined();
      expect(e.jointLimits.R.envelope.mode).toBe('soft');
      const row = s.trace.find((r) => r.players.R.fall)!;
      expect(row).toBeDefined();
      s.dispose();
    },
  ],
  [
    '10a A3/A4/A12: every non-null profile id in an export has a profiles entry with the same id (all fixtures)',
    async () => {
      let carry = 0;
      for (const def of allFixtures()) {
        const sim = await Simulation.create(def, { trace: false });
        const ex = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown>; engine: { version: string } };
        for (const [k, id] of Object.entries(ex.profileIds)) {
          if (id === undefined || id === null) continue;
          const p = ex.profiles[k];
          expect(p, `${def.id}: profiles.${k}`).toBeDefined();
          if (k === 'body') {
            for (const [pid, bid] of Object.entries(id as Record<string, string>)) expect((p as Record<string, { id: string }>)[bid]?.id, `${def.id}: body of ${pid}`).toBe(bid);
          } else expect((p as { id: string }).id, `${def.id}: profiles.${k}.id`).toBe(id);
        }
        if (def.carry) {
          carry++;
          expect(stable(ex.profiles.carry)).toBe(stable(def.carry));
        }
        expect(ex.engine.version).toBe(RAPIER.version());
        sim.dispose();
        await breathe();
      }
      expect(carry).toBeGreaterThan(100);
      expect(RAPIER.version()).toBe('0.21.0');
    },
  ],
  [
    '10a A3/A4/A12: one id stands for one set of values, for every profile kind over the registry',
    () => {
      const kinds = ['motor', 'solver', 'stance', 'armProfile', 'balance', 'ragdoll', 'rules', 'runClips', 'support', 'footwork', 'locomotion', 'carry', 'fallResponse'] as const;
      const seen = new Map<string, { value: string; fixture: string }>();
      const clash: string[] = [];
      const note = (kind: string, p: { id: string } | undefined, fixture: string): void => {
        if (!p) return;
        const k = `${kind}:${p.id}`;
        const value = stable(p);
        const prev = seen.get(k);
        if (!prev) seen.set(k, { value, fixture });
        else if (prev.value !== value) clash.push(`${k} (${prev.fixture} vs ${fixture})`);
      };
      for (const d of allFixtures()) {
        for (const k of kinds) note(k, d[k] as { id: string } | undefined, d.id);
        for (const p of d.players) {
          note('body', p.body, d.id);
          note('motor', p.motor, d.id);
        }
      }
      expect([...new Set(clash)]).toEqual([]);
      expect(seen.size).toBeGreaterThan(40);
    },
  ],
  [
    'plan 11: an opted export records the self-clearance profile and the trunk; every other export is as before (no trunk, no profile)',
    async () => {
      const on = await Simulation.create(FIX('L3-F16-sprint'));
      const e = on.exportFixture() as { profileIds: Record<string, unknown>; profiles: { body: Record<string, { measured?: { trunkHull?: unknown[] } }>; selfClearance?: unknown } };
      // (with the met-arm flip's parts since ladder 18e)
      const stayed = withMetArmStay(withClipArmSwing(SELF_CLEARANCE_V1));
      expect(e.profileIds.selfClearance).toBe(stayed.id);
      expect(e.profiles.selfClearance).toEqual(stayed);
      for (const b of Object.values(e.profiles.body)) expect(b.measured?.trunkHull).toHaveLength(7);
      on.dispose();
      // L2-F3-runStop uses the model body: its export keeps the measured block without the trunk or hand tip
      const off = await Simulation.create(FIX('L2-F3-runStop'));
      const x = JSON.stringify(off.exportFixture());
      expect(x).toContain('"calibrationId"');
      for (const k of ['trunkHull', 'handTipM', 'selfClearance']) expect(x).not.toContain(k);
      off.dispose();
    },
  ],
];

describe('plan 13b: every plan opts its fixtures in and names its profiles in the export', () => {
  it('each profile is on for exactly the fixtures that opt in, and every other fixture keeps its path: every opt-in row', async () => {
    await rows(OPT_IN, ([n]) => n, ([, f]) => f());
  });

  it('exports identify their profiles by id and by value, and an opted profile is in the export: every export row', async () => {
    await rows(EXPORTS, ([n]) => n, ([, f]) => f());
  }, 120000);
});

describe('10a A5: reset leaves no per-tick scratch', () => {
  it('G1-F2-legacy: after a run and a reset, trace row 0 equals a fresh row 0 in every field', async () => {
    const fresh = await Simulation.create(FIX('G1-F2-legacy'));
    const row0 = JSON.stringify(fresh.trace[0]);
    fresh.dispose();
    const sim = await run(FIX('G1-F2-legacy'));
    expect(sim.trace.some((r) => Object.values(r.players).some((p) => p.c.length > 0))).toBe(true);
    sim.reset();
    expect(sim.trace).toHaveLength(1);
    expect(JSON.stringify(sim.trace[0])).toBe(row0);
    sim.dispose();
  });

  it('a reset mid-run reproduces the fresh run in every trace field and event', async () => {
    const def = FIX('G4-F3-twoArm');
    const fresh = await run(def);
    const sim = await create(def);
    await runSim(sim, 60);
    sim.reset();
    await runSim(sim);
    expect(traceRowsDiff(sim.trace, fresh.trace)).toBeNull();
    expect(JSON.stringify(sim.events)).toBe(JSON.stringify(fresh.events));
    fresh.dispose();
    sim.dispose();
  });
});

describe('10a A6: a numerical failure stops the substep and the tick', () => {
  it('no pose update, rule observation or event follows the failure', async () => {
    const def = FIX('G4-F11-heldUp');
    const sim = await create(def);
    await runSim(sim, 10);
    const R = sim.players.find((p) => p.id === 'R')!;
    const pose = R.pose;
    const ruleRow = sim.rules?.lastRow;
    const steps = sim.steps;
    R.proxy.body.setTranslation({ x: NaN, y: 1, z: 0 }, true);
    await runSim(sim);
    expect(sim.result).toBe('numericalFailure');
    const i = sim.events.findIndex((e) => e.type === 'numericalFailure');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(sim.events.slice(i + 1)).toEqual([]);
    expect(sim.events.filter((e) => e.type === 'numericalFailure')).toHaveLength(1);
    expect(R.pose).toBe(pose); // updatePoses never ran on the non-finite state
    expect(sim.rules?.lastRow).toBe(ruleRow);
    expect(sim.steps).toBe(steps + 1); // the failing substep is the last one
    expect(sim.stop).toMatchObject({ reason: 'numericalFailure', result: 'numericalFailure', playerId: 'R' });
    sim.dispose();
  });
});

describe('10a A7: events carry the tick of their trace row', () => {
  it('every event lies within its row; contactBegin is solved inside it; ledger ticks use the same stamp', async () => {
    for (const id of ['G2-F1', 'G4-F3-twoArm', 'L3-F3-side']) {
      const sim = await run(FIX(id));
      const S = sim.def.solver.substeps;
      const rows = new Map(sim.trace.map((r) => [r.tick, r]));
      expect(sim.events.length).toBeGreaterThan(0);
      for (const e of sim.events) {
        const row = rows.get(e.tick)!;
        expect(row, `${id} ${e.type} tick ${e.tick}`).toBeDefined();
        expect(e.t).toBeLessThanOrEqual(row.t + 1e-9);
        if (e.tick > 0) {
          expect(e.t).toBeGreaterThanOrEqual(rows.get(e.tick - 1)!.t - 1e-9);
          expect(e.step).toBeGreaterThanOrEqual((e.tick - 1) * S);
          expect(e.step).toBeLessThanOrEqual(e.tick * S);
        } else expect(e.step).toBe(0);
      }
      const begins = sim.events.filter((e) => e.type === 'contactBegin');
      for (const e of begins) expect(e.t).toBeGreaterThan(rows.get(e.tick - 1)!.t + 1e-9);
      if (id === 'G4-F3-twoArm') {
        expect(begins.length).toBeGreaterThan(0);
        // a ledger entry is written before its substep's solve (`step` substeps completed): it belongs to that tick's row
        const ledger = sim.arms!.ledger;
        expect(ledger.length).toBeGreaterThan(0);
        expect(ledger.filter((x) => x.tick !== Math.floor(x.step / S) + 1)).toEqual([]);
      }
      sim.dispose();
      await breathe();
    }
  });
});

describe('10a A8: stops keep their cause', () => {
  it('result labels are unchanged; the exported stop names the stop and the folded conditions', async () => {
    const cases: [string, string, string, Partial<Record<'invalidTransfer' | 'invalidHandoff', boolean>>][] = [
      ['G1-F1', 'duration', 'duration', { invalidTransfer: false, invalidHandoff: false }],
      ['G4-F3-failed', 'practiceOutOfBounds', 'practiceOutOfBounds', { invalidTransfer: false }],
      ['L4-F9-transferFailed', 'invalidTransfer', 'duration', { invalidTransfer: true }],
      ['L3-F1-phase0', 'groundDown', 'ruleEnding', { invalidTransfer: false }],
    ];
    for (const [id, result, reason, flags] of cases) {
      const sim = await run(FIX(id));
      expect(sim.result, id).toBe(result);
      expect(sim.stop, id).toMatchObject({ reason, result, flags });
      expect((sim.exportFixture() as { stop: unknown }).stop).toEqual(sim.stop);
      if (reason === 'practiceOutOfBounds') expect(sim.stop!.playerId).toBeDefined();
      if (reason === 'ruleEnding') expect(sim.stop!.ending).toBe(result);
      sim.dispose();
      await breathe();
    }
  });
});

describe('10a A9: lifecycle', () => {
  const CHECKS: [string, () => Promise<void> | void][] = [
    [
      'dispose is idempotent for the physics world and the simulation',
      async () => {
        await initPhysics();
        const w = new PhysicsWorld(FIX('G1-F1').solver);
        w.dispose();
        expect(() => w.dispose()).not.toThrow();
        const sim = await Simulation.create(FIX('G1-F1'));
        sim.dispose();
        expect(() => sim.dispose()).not.toThrow();
      },
    ],
    [
      'the fixed-step driver keeps the sub-tick remainder when a frame overflows, and validates its inputs',
      () => {
        const d = new FixedStepDriver(1 / 60, 4);
        expect(d.frame(1 + 0.5 / 60)).toBe(4);
        expect(d.alpha()).toBeCloseTo(0.5, 6);
        expect(d.discardedWallS).toBeCloseTo(56 / 60, 9);
        expect(d.frame(0.5 / 60)).toBe(1);
        expect(d.frame(Number.NaN)).toBe(0);
        expect(d.frame(-1)).toBe(0);
        expect(d.frame(Number.POSITIVE_INFINITY)).toBe(0);
        expect(() => d.setSpeed(Number.NaN)).toThrow(RangeError);
        expect(() => d.setSpeed(-1)).toThrow(RangeError);
        d.setSpeed(0);
        expect(d.frame(1)).toBe(0);
        expect(() => new FixedStepDriver(0, 4)).toThrow(RangeError);
        expect(() => new FixedStepDriver(1 / 60, 0)).toThrow(RangeError);
      },
    ],
  ];

  it('dispose is idempotent for the physics world and the simulation; the fixed-step driver keeps the sub-tick remainder when a frame overflows, and validates its inputs', async () => {
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('10a A11: the fixture registry is built once', () => {
  it('repeat calls share frozen definitions in a new array', () => {
    const a = allFixtures();
    const t0 = performance.now();
    const b = allFixtures();
    expect(performance.now() - t0).toBeLessThan(20);
    expect(b).not.toBe(a);
    expect(b[0]).toBe(a[0]);
    expect(Object.isFrozen(a[0])).toBe(true);
    expect(() => {
      (a[0] as { id: string }).id = 'x';
    }).toThrow(TypeError);
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
  });
});

describe('plan 13a: contact-time shape queries', () => {
  it('the segment cull never skips a pair the query returns: 10,000 random ball, capsule and box pairs near the boundary', async () => {
    await initPhysics();
    let seed = 0x13a;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const span = (a: number, b: number): number => a + (b - a) * rnd();
    const rot = (): { x: number; y: number; z: number; w: number } => {
      const [u, v, w] = [rnd(), rnd(), rnd()];
      const a = Math.sqrt(1 - u);
      const b = Math.sqrt(u);
      return { x: a * Math.sin(2 * Math.PI * v), y: a * Math.cos(2 * Math.PI * v), z: b * Math.sin(2 * Math.PI * w), w: b * Math.cos(2 * Math.PI * w) };
    };
    const shape = (): RAPIER.Shape => {
      const k = rnd();
      if (k < 0.25) return new RAPIER.Ball(span(0.02, 0.15));
      if (k < 0.45) return new RAPIER.Cuboid(span(0.01, 0.2), span(0.01, 0.2), span(0.01, 0.2));
      return new RAPIER.Capsule(span(0, 0.35), span(0.02, 0.15));
    };
    let returned = 0;
    let missed = 0;
    let culledEmpty = 0;
    let empty = 0;
    for (let i = 0; i < 10000; i++) {
      const a = shape();
      const b = shape();
      // field-scale positions (f32 rounding), parallel and antiparallel axes in a fifth of the pairs
      const pa = { x: span(-60, 60), y: span(0, 2), z: span(-30, 30) };
      const qa = rot();
      const k = rnd();
      const qb = k < 0.1 ? qa : k < 0.2 ? { x: -qa.z, y: qa.w, z: qa.x, w: -qa.y } : rot();
      const ra = shapeRadius(a)!;
      const rb = shapeRadius(b)!;
      const dir = { x: span(-1, 1), y: span(-1, 1), z: span(-1, 1) };
      const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const reach = span(0, ra + rb + 0.08);
      const pb = { x: pa.x + (dir.x / dl) * reach, y: pa.y + (dir.y / dl) * reach, z: pa.z + (dir.z / dl) * reach };
      const prediction = rnd() < 0.3 ? 0 : span(0, 0.05);
      const r = a.contactShape(pa, qa, b, pb, qb, prediction);
      const near = geomNear(cullGeom(a, pa, qa), cullGeom(b, pb, qb), prediction);
      if (r) {
        returned++;
        if (!near) missed++;
      } else {
        empty++;
        if (!near) culledEmpty++;
      }
    }
    expect(missed, `${missed} of ${returned} returned pairs culled`).toBe(0);
    expect(returned).toBeGreaterThan(2000);
    // tight: most pairs the query finds empty are culled (round pairs exactly; boxes by their enclosing capsule)
    expect(culledEmpty / empty, `${culledEmpty} of ${empty} empty pairs culled`).toBeGreaterThan(0.9);
  });

  // The pose clearance's push-outs read penetrating contacts only and ask at the depth checks' prediction, reusing the depth
  // check's answer for the same shape (src/sim/pose-runtime.ts poseClearanceOf). Exact only if a returned penetrating
  // contact is the same at any prediction: checked on random pairs of every shape kind the clearance meets (ball, capsule,
  // box, convex hull: the measured trunk pieces), by both query paths (Shape.contactShape for poses, Collider.contactShape
  // for live colliders and trunk pieces).
  it('a penetrating contact does not depend on the query prediction: 20,000 random pairs, both query paths', async () => {
    await initPhysics();
    let seed = 0x5b;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const span = (a: number, b: number): number => a + (b - a) * rnd();
    const rot = (): { x: number; y: number; z: number; w: number } => {
      const [u, v, w] = [rnd(), rnd(), rnd()];
      const a = Math.sqrt(1 - u);
      const b = Math.sqrt(u);
      return { x: a * Math.sin(2 * Math.PI * v), y: a * Math.cos(2 * Math.PI * v), z: b * Math.sin(2 * Math.PI * w), w: b * Math.cos(2 * Math.PI * w) };
    };
    const hull = (): Float32Array => {
      const s = span(0.05, 0.2);
      return new Float32Array(Array.from({ length: 3 * (8 + Math.floor(rnd() * 10)) }, () => span(-s, s)));
    };
    type Kind = 'ball' | 'box' | 'hull' | 'capsule';
    const make = (): { kind: Kind; shape: RAPIER.Shape; desc: () => RAPIER.ColliderDesc } => {
      const k = rnd();
      if (k < 0.2) {
        const r = span(0.02, 0.15);
        return { kind: 'ball', shape: new RAPIER.Ball(r), desc: () => RAPIER.ColliderDesc.ball(r) };
      }
      if (k < 0.4) {
        const [x, y, z] = [span(0.01, 0.2), span(0.01, 0.2), span(0.01, 0.2)];
        return { kind: 'box', shape: new RAPIER.Cuboid(x, y, z), desc: () => RAPIER.ColliderDesc.cuboid(x, y, z) };
      }
      if (k < 0.6) {
        const p = hull();
        return { kind: 'hull', shape: new RAPIER.ConvexPolyhedron(p, null), desc: () => RAPIER.ColliderDesc.convexHull(p)! };
      }
      const [h, r] = [span(0, 0.35), span(0.02, 0.15)];
      return { kind: 'capsule', shape: new RAPIER.Capsule(h, r), desc: () => RAPIER.ColliderDesc.capsule(h, r) };
    };
    const same = (a: RAPIER.ShapeContact, b: RAPIER.ShapeContact): boolean => {
      const v = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }): boolean => Object.is(p.x, q.x) && Object.is(p.y, q.y) && Object.is(p.z, q.z);
      return Object.is(a.distance, b.distance) && v(a.point1, b.point1) && v(a.point2, b.point2) && v(a.normal1, b.normal1) && v(a.normal2, b.normal2);
    };
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const DEPTH = 0.02;
    let penetrating = 0;
    let differ = 0;
    // the twin: a separated pair the larger prediction returns, which the plain query does not (an answer that does depend on
    // the prediction, so the comparison above can see one)
    let separatedOnlyAtDepth = 0;
    const kinds = new Set<string>();
    try {
      for (let i = 0; i < 20000; i++) {
        const a = make();
        const b = make();
        const pa = { x: span(-60, 60), y: span(0, 2), z: span(-30, 30) };
        const qa = rot();
        const qb = rot();
        const dir = { x: span(-1, 1), y: span(-1, 1), z: span(-1, 1) };
        const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
        const reach = span(0, 0.45);
        const pb = { x: pa.x + (dir.x / dl) * reach, y: pa.y + (dir.y / dl) * reach, z: pa.z + (dir.z / dl) * reach };
        const viaCollider = i % 2 === 1;
        let ask: (prediction: number) => RAPIER.ShapeContact | null;
        if (viaCollider) {
          const c = world.createCollider(a.desc());
          c.setTranslation(pa);
          c.setRotation(qa);
          ask = (p) => c.contactShape(b.shape, pb, qb, p);
        } else ask = (p) => a.shape.contactShape(pa, qa, b.shape, pb, qb, p);
        const r0 = ask(0);
        const rD = ask(DEPTH);
        const pen0 = r0 && r0.distance < 0 ? r0 : null;
        const penD = rD && rD.distance < 0 ? rD : null;
        if (pen0 || penD) {
          penetrating++;
          kinds.add(`${a.kind}-${b.kind}${viaCollider ? ' collider' : ''}`);
          if (!pen0 || !penD || !same(pen0, penD)) differ++;
        }
        if (rD && rD.distance > 0.005 && !r0) separatedOnlyAtDepth++;
      }
    } finally {
      world.free();
    }
    expect(differ, `${differ} of ${penetrating} penetrating contacts differ between predictions 0 and ${DEPTH}`).toBe(0);
    expect(penetrating).toBeGreaterThan(5000);
    // every pair of kinds on both paths
    expect(kinds.size).toBe(32);
    expect(separatedOnlyAtDepth, 'the twin: separated pairs answered at the larger prediction only').toBeGreaterThan(100);
  });

  it('far pairs are culled: under 4,000 shape queries in every tick of a representative set of contact fixtures', async () => {
    await initPhysics();
    // L4-F10-wrap-on is counted on the file's one direct run of it (the lab's real-fixture frames read the same run). The
    // set: the two plan 13a cases, and the worst ticks of the leg matrix's runs (the full check counts every one,
    // queries.jsonl): HC-F1-at0.9 at 0.867 s (R's held left arm's continuity push-outs in D's wrap, 4030 before the push
    // reused the depth answers) and L3-F7-mirror50
    const counted = new Map<string, { n: number; t: number }>([['L4-F10-wrap-on', (await wrapOnDirect()).worst]]);
    const q = shapeQueryCounter();
    try {
      for (const id of ['L4-F10-wrap-on', 'L3-F8-recontact', 'HC-F1-at0.9', 'L3-F7-mirror50']) {
        let worst = counted.get(id);
        if (!worst) {
          const sim = await create(FIX(id));
          q.take();
          let w = { n: 0, t: 0 };
          await runSim(sim, Infinity, (s) => {
            const n = q.take();
            if (n > w.n) w = { n, t: s.t };
          });
          sim.dispose();
          worst = w;
        }
        expect(worst.n, `${id}: ${worst.n} queries in the tick ending ${worst.t.toFixed(3)} s`).toBeLessThan(SHAPE_QUERY_BUDGET);
        await breathe();
      }
    } finally {
      q.restore();
    }
  }, 180000);

  it('ladder 9g: a deferred conversion\'s validation is culled too: under 4,000 in every tick while D\'s conversion beside R\'s ragdoll is tried again (L3-F1-phase4 reversed, from 1.267 s)', async () => {
    // The full check's worst tick at ladder 9d, 4036 at 1.317 s: D supported beside R's ragdoll, its conversion deferred
    // (8j) and validated again each substep, D's pose contact queries against R's ragdoll (2324 of them) and the
    // candidate's depth against every external shape (1344, not culled before 9g). Captured at the end of tick 76
    // (1.267 s), as registered. With the cull, 2771 there. Fault twin (ragdoll.ts depthAgainst without the cull, run
    // once): 4036 and 4035 in ticks 79 and 80, the test fails on them.
    await initPhysics();
    // per tick: the shape queries, and the substeps in it with D's conversion deferred while R is a ragdoll
    const ticks: { tick: number; n: number; deferred: number }[] = [];
    let deferred = 0;
    // (captured before the ladder 10 leg-guard flip: resumed under the definition it ran under)
    const cap = loadState('tests/data/state/L3-F1-phase4~rev@76.json.gz');
    const sim = await resumeState(cap, {
      def: asCaptured(cap),
      opts: {
        onSubstep: (s) => {
          const D = s.byId.get('D')!;
          if (D.deferred && !D.rag && s.byId.get('R')!.rag) deferred++;
        },
      },
    });
    const q = shapeQueryCounter();
    try {
      q.take();
      while (!sim.done && !sim.byId.get('D')!.rag) {
        deferred = 0;
        sim.stepTick();
        ticks.push({ tick: sim.tick, n: q.take(), deferred });
        await pace();
      }
    } finally {
      q.restore();
      sim.dispose();
    }
    // the mechanism is reached: D's conversion deferred and tried again over several ticks, then accepted
    expect(ticks.filter((t) => t.deferred > 0).map((t) => t.tick)).toEqual([78, 79, 80, 81]);
    expect(ticks.at(-1)!.tick).toBe(81);
    for (const t of ticks) expect(t.n, `tick ${t.tick} (${t.deferred} substeps deferred)`).toBeLessThan(SHAPE_QUERY_BUDGET);
  }, 60000);
});

// ------------------------------------------------------------------------------------------- plan 10f debug switches
async function solo(id: string, debug?: SimDebug): Promise<Simulation> {
  const sim = await Simulation.create(FIX(id), debug ? { debug } : {});
  sim.runToEnd();
  return sim;
}

describe('plan 10f: per-simulation debug switches', () => {
  /** The default (no switch) solo run of a fixture, once for the file; read only. */
  const plain = new Map<string, Promise<Simulation>>();
  const soloDefault = (id: string): Promise<Simulation> => {
    let p = plain.get(id);
    if (!p) plain.set(id, (p = solo(id)));
    return p;
  };
  afterAll(async () => {
    for (const p of plain.values()) (await p).dispose();
  });

  const SWITCHES = [
    ['L2-F3-runStop', { foot: { legacyEntry: true, noQuick: true } }],
    ['RH-F5-playerBelow', { pose: { noContinuity: true } }],
  ] as const;

  it('a switched and a default simulation stepped together each match their solo run, on every switch row', async () => {
    await rows(SWITCHES, ([id]) => id, async ([id, debug]) => {
      const ref = await soloDefault(id);
      const refOn = await solo(id, debug);
      // the switch has an effect, so a leak either way shows
      expect(traceRowsDiff(ref.trace, refOn.trace)).not.toBeNull();
      const on = await Simulation.create(FIX(id), { debug });
      const off = await Simulation.create(FIX(id));
      while (!on.done || !off.done) {
        on.stepTick();
        off.stepTick();
        await pace();
      }
      expect(traceRowsDiff(off.trace, ref.trace)).toBeNull();
      expect(traceRowsDiff(on.trace, refOn.trace)).toBeNull();
      expect(on.exportFixture().debug).toEqual(debug);
      expect('debug' in off.exportFixture()).toBe(false);
      for (const s of [refOn, on, off]) s.dispose();
    });
  }, 60000);

  it('the pose diagnostics are read-only and not exported; a switch set false is not exported', async () => {
    const ref = await soloDefault('RH-F5-playerBelow');
    let calls = 0;
    const probe = poseProbe({ on: true, trace: () => calls++ });
    const seen = await solo('RH-F5-playerBelow', { poseProbe: probe, pose: { noContinuity: false }, foot: { noQuick: false } });
    expect(calls).toBeGreaterThan(0);
    expect(Object.keys(probe.last).length).toBeGreaterThan(0);
    expect(traceRowsDiff(seen.trace, ref.trace)).toBeNull();
    expect(JSON.stringify(seen.exportFixture())).toBe(JSON.stringify(ref.exportFixture()));
    seen.dispose();
  }, 30000);
});

// ------------------------------------------------------------------------------------------- lab render
/** A fake simulation: tick k costs `cost(k)` ms on the fake clock; its frames are the tick numbers. */
function fakeSource(ticks: number, cost: (k: number) => number, clock: { ms: number }): PlaybackSource<number> & { k: number } {
  return {
    k: 0,
    capture() {
      return this.k;
    },
    step() {
      clock.ms += cost(this.k);
      this.k++;
    },
    done() {
      return this.k >= ticks;
    },
  };
}

describe('lab render: look-ahead playback', () => {
  const FAKE_CLOCK: [string, () => void][] = [
    [
      'a slow stretch costs buffer lead, not frames: no frame computes past its budget, shown time follows wall time',
      () => {
        const clock = { ms: 0 };
        // 0.5 ms ticks, 40 ticks of 12 ms from tick 120 (a contact): over budget for real time, covered by the lead
        const src = fakeSource(400, (k) => (k >= 120 && k < 160 ? 12 : 0.5), clock);
        const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
        pb.paused = false;
        const wallS = 1 / 60;
        let worstFillMs = 0;
        let shownPrev = 0;
        let held = 0;
        for (let f = 0; f < 600 && !pb.ended; f++) {
          const t0 = clock.ms;
          pb.frame(wallS);
          // a tick starts only while its estimated cost fits; one tick of misestimate at most (0.5 ms estimate, 12 ms tick)
          worstFillMs = Math.max(worstFillMs, clock.ms - t0);
          const shown = pb.shown;
          if (pb.computing) held++;
          else if (!pb.ended) expect(shown - shownPrev).toBeCloseTo(1, 6); // one tick per 60 Hz frame at 1x
          shownPrev = shown;
          clock.ms += 16.7 - (clock.ms - t0); // the rest of the display frame
        }
        expect(pb.ended).toBe(true);
        expect(pb.newest).toBe(400);
        expect(worstFillMs).toBeLessThanOrEqual(8 + 12);
        // the 40 slow ticks need 480 ms of compute; the lead built over the first 2 s covers them, so playback never waits
        expect(held).toBe(0);
      },
    ],
    [
      'when playback catches the buffer it holds the newest frame (computing) and resumes without skipping a tick',
      () => {
        const clock = { ms: 0 };
        const src = fakeSource(100, () => 20, clock); // every tick over the budget, played at 2x: playback outruns the simulation
        const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
        pb.paused = false;
        pb.speed = 2;
        const seen: number[] = [];
        for (let f = 0; f < 400 && !pb.ended; f++) {
          pb.frame(1 / 60);
          seen.push(pb.view().tick);
          if (f > 2 && !pb.ended) expect(pb.computing).toBe(true);
        }
        expect(pb.ended).toBe(true);
        for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBeLessThanOrEqual(1);
        expect(seen[seen.length - 1]).toBe(100);
      },
    ],
    [
      'paused, the buffer fills in the background; step, seek, finish and restart address ticks exactly',
      () => {
        const clock = { ms: 0 };
        const src = fakeSource(50, () => 1, clock);
        const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
        pb.frame(1 / 60);
        expect(pb.paused).toBe(true);
        expect(pb.shown).toBe(0);
        expect(pb.newest).toBeGreaterThanOrEqual(7);
        pb.step();
        expect(pb.view()).toMatchObject({ tick: 1, a: 1, alpha: 0 });
        pb.seek(30);
        expect(pb.view()).toMatchObject({ tick: 30, a: 30 });
        pb.seek(99);
        expect(pb.view().tick).toBe(50);
        expect(pb.ended).toBe(true);
        src.k = 0;
        pb.restart();
        expect(pb.newest).toBe(0);
        pb.finish();
        expect(pb.newest).toBe(50);
        expect(pb.shown).toBe(0);
      },
    ],
    [
      'plan 14: with a lead cap the buffer stays at most the cap ahead of the shown time, paused or playing; step and seek still compute past it',
      () => {
        const clock = { ms: 0 };
        const src = fakeSource(200, () => 0.1, clock);
        const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
        pb.maxLeadTicks = 3;
        pb.frame(1 / 60);
        pb.frame(1 / 60);
        expect(pb.newest).toBe(3);
        pb.paused = false;
        for (let f = 0; f < 60; f++) {
          pb.frame(1 / 60);
          expect(pb.newest - pb.shown).toBeLessThanOrEqual(3 + 1e-9);
        }
        expect(pb.shown).toBeCloseTo(60, 6);
        pb.seek(120);
        expect(pb.view().tick).toBe(120);
        expect(pb.newest).toBe(120);
      },
    ],
  ];

  it('on a fake clock: a slow stretch costs buffer lead, not frames; caught up, playback holds the newest frame and resumes without skipping a tick; paused, the buffer fills and step, seek, finish and restart address ticks exactly; a lead cap bounds the buffer', async () => {
    await rows(FAKE_CLOCK, ([n]) => n, ([, f]) => f());
  });

  it('frames of a real fixture: one per tick, in order, identical to stepping the simulation directly', async () => {
    // the direct run: L4-F10-wrap-on stepped once for the file (its core position after every tick)
    const { ref } = await wrapOnDirect();
    const sim = await create(FIX('L4-F10-wrap-on'));
    const cap = new FrameCapture(sim);
    const clock = { ms: 0 };
    const pb = new Playback<LabFrame>({ capture: () => cap.capture(), step: () => sim.stepTick(), done: () => sim.done }, sim.def.solver.outerTickS, () => clock.ms++, 8);
    while (!pb.complete) {
      pb.frame(0);
      await pace();
    }
    expect(pb.frames.length).toBe(ref.length);
    pb.frames.forEach((f, k) => {
      expect(f.tick).toBe(k);
      expect(f.t).toBe(ref[k].t);
      expect(f.players[0].core.p).toEqual(ref[k].core);
    });
    // the wireframe set is shared while unchanged and replaced at the representation change
    const sets = new Set(pb.frames.map((f) => f.players[0].colliderSet));
    const reps = new Set(pb.frames.map((f) => f.players[0].rep));
    expect(sets.size).toBe(reps.size);
    sim.dispose();
  });
});

describe('lab render: follow camera', () => {
  it('the drawn runner holds still against the follow camera at 60, 120 and 144 Hz display rates (no per-tick stepping)', async () => {
    for (const hz of [60, 120, 144]) {
      const def = L1.l1f1('fastRun');
      const sim = await Simulation.create(def);
      const cap = new FrameCapture(sim);
      let clockMs = 0;
      const pb = new Playback<LabFrame>({ capture: () => cap.capture(), step: () => sim.stepTick(), done: () => sim.done }, def.solver.outerTickS, () => clockMs, 8);
      pb.paused = false;
      const rel: Vec3[] = [];
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      while (!pb.ended && pb.view().a.t < 1.5) {
        pb.frame(1 / hz + (rnd() - 0.5) * 0.0004);
        clockMs += 1000 / hz;
        await pace();
        const { a, b, alpha } = pb.view();
        const pa = a.players.find((p) => p.id === 'R')!;
        const pbf = b.players.find((p) => p.id === 'R')!;
        if (a.tick === 0) continue;
        const ca = pa.pose!.segments.core.originWorld;
        const cb = pbf.pose!.segments.core.originWorld;
        const drawn = v3(ca.x + (cb.x - ca.x) * alpha, 0, ca.z + (cb.z - ca.z) * alpha);
        const cam = followCenter([{ prev: pa.com, cur: pbf.com }], alpha);
        rel.push(v3(drawn.x - cam.x, 0, drawn.z - cam.z));
      }
      let worst = 0;
      for (let i = 1; i < rel.length - 1; i++) worst = Math.max(worst, len(v3(rel[i + 1].x - 2 * rel[i].x + rel[i - 1].x, 0, rel[i + 1].z - 2 * rel[i].z + rel[i - 1].z)));
      expect(rel.length).toBeGreaterThan(50);
      expect(worst).toBeLessThan(1e-3);
      sim.dispose();
    }
  });
});

describe('plan 13c: the lab review set', () => {
  it('every review-set id is registered, unique and on the model body; at most 30; every group and name is filled', () => {
    const all = allFixtures();
    const byId = new Map(all.map((f) => [f.id, f]));
    const entries = REVIEW_SET.flatMap((g) => g.entries);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(30);
    expect(new Set(entries.map((e) => e.id)).size, 'duplicate review-set ids').toBe(entries.length);
    const bad: string[] = [];
    for (const g of REVIEW_SET) if (!g.label.trim() || g.entries.length === 0) bad.push(`group '${g.label}': empty label or no entries`);
    for (const e of entries) {
      const f = byId.get(e.id);
      if (!f) bad.push(`${e.id}: not registered`);
      else if (!f.players.every((p) => p.body.measured?.calibrationId === MODEL_CALIBRATION_ID)) bad.push(`${e.id}: a player is not on the model body`);
      if (!e.name.trim()) bad.push(`${e.id}: no name`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('the review list shows the set as name · id; the full list holds every fixture as id · title; the filter narrows either by id, name or title', () => {
    const all = allFixtures();
    const ids = (gs: ReturnType<typeof fixtureList>): string[] => gs.flatMap((g) => g.options.map((o) => o.id));
    const review = fixtureList(all, false);
    expect(ids(review)).toEqual(REVIEW_SET.flatMap((g) => g.entries.map((e) => e.id)));
    expect(review.map((g) => g.label)).toEqual(REVIEW_SET.map((g) => g.label));
    const first = REVIEW_SET[0].entries[0];
    expect(review[0].options[0].text).toBe(`${first.name} · ${first.id}`);
    const full = fixtureList(all, true);
    expect(ids(full)).toEqual(all.map((f) => f.id));
    for (const o of full.flatMap((g) => g.options)) {
      const title = all.find((f) => f.id === o.id)!.title;
      expect(o.text.startsWith(`${o.id} · `)).toBe(true);
      expect(o.text.length).toBeLessThanOrEqual(o.id.length + 3 + 60);
      if (title.length <= 60) expect(o.text).toBe(`${o.id} · ${title}`);
    }
    // by name (review set), by id, by title (the review set's titles are searchable too), case and order of words ignored
    expect(ids(filterList(review, 'HEAD-ON'))).toEqual(['L3-F3-collision']);
    expect(ids(filterList(review, 'l4-f10'))).toEqual(['L4-F10-wrap-on']);
    expect(ids(filterList(review, 'contested'))).toEqual(['L3-F6-hold']);
    const g4f1 = ids(filterList(full, ' g4-F1 '));
    expect(g4f1).toContain('G4-F1');
    expect(g4f1).toContain('G4-F1-M');
    expect(g4f1.length).toBeLessThan(20);
    const wraps = ids(filterList(full, 'wrap two-arm L4'));
    expect(wraps).toContain('L4-F10-wrap-on');
    expect(wraps.every((id) => id.startsWith('L4'))).toBe(true);
    expect(filterList(full, 'no fixture is called this')).toEqual([]);
    expect(filterList(full, '  ')).toEqual(full);
    // a URL fixture outside the set opens the full list
    expect(inReviewSet(first.id)).toBe(true);
    expect(inReviewSet('G4-F1')).toBe(false);
  });
});
