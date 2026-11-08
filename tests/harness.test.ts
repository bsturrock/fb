// Plan 10a: the test gate and evidence integrity. The fixture runner cannot damage committed evidence, exports identify
// their profiles by id and by value, reset leaves nothing behind, events are stamped with their trace row, stops keep
// their cause, numerical failures stop at once, and the engine lifecycle is safe to repeat.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { FixedStepDriver } from '../src/sim/driver';
import { initPhysics, PhysicsWorld, RAPIER } from '../src/sim/physics';
import { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { assertUniqueIds, runFixtures } from '../scripts/fixture-runner';
import { breathe, create, FIX, run, runSim, traceRowsDiff } from './helpers';

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
/** Key-order independent serialization (deep equality of plain profile data). */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !ArrayBuffer.isView(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

describe('10a A2: the fixture runner', () => {
  it('a filtered run writes summary.filtered.json and leaves summary.json byte-identical', async () => {
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
  });

  it('duplicate ids are refused; a fixture that throws fails the run, writes no summary and still disposes', async () => {
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
  });
});

describe('10a A3/A4/A12: exports identify their profiles', () => {
  it('every non-null profile id in an export has a profiles entry with the same id (all fixtures)', async () => {
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
  });

  it('one id stands for one set of values, for every profile kind over the registry', () => {
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
  });
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
  it('dispose is idempotent for the physics world and the simulation', async () => {
    await initPhysics();
    const w = new PhysicsWorld(FIX('G1-F1').solver);
    w.dispose();
    expect(() => w.dispose()).not.toThrow();
    const sim = await Simulation.create(FIX('G1-F1'));
    sim.dispose();
    expect(() => sim.dispose()).not.toThrow();
  });

  it('the fixed-step driver keeps the sub-tick remainder when a frame overflows, and validates its inputs', () => {
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
