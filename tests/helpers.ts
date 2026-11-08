import { expect } from 'vitest';
import type { SimEvent } from '../src/sim/contracts';
import { Simulation, type SimOptions, type TraceRow } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';

/** The registered fixture `id` (a fresh definition each call); throws when there is none. */
export const FIX = (id: string): FixtureDef => {
  const f = allFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};

/** An event with its data read loosely (tests read event-specific fields). */
export type TestEvent = Omit<SimEvent, 'data'> & { data: any };

/** The events of one type, optionally of one player. */
export const evs = (sim: Simulation, type: string, id?: string): TestEvent[] => sim.events.filter((e) => e.type === type && (!id || e.playerId === id)) as TestEvent[];

/**
 * Yield a macrotask when the worker has run synchronously for `everyMs` of wall time. Simulation runs are synchronous;
 * an await on an already-resolved promise yields only a microtask, which never lets the test runner's RPC through
 * (the `Timeout calling "onTaskUpdate"` unhandled error). Every long loop in the tests awaits this between ticks.
 * Wall-time based, so it never changes what a run computes.
 */
let lastYield = Date.now();
export async function pace(everyMs = 50): Promise<void> {
  if (Date.now() - lastYield < everyMs) return;
  await new Promise<void>((r) => setImmediate(r));
  lastYield = Date.now();
}

/** A macrotask yield now (between fixture runs). */
export const breathe = (): Promise<void> =>
  new Promise<void>((r) =>
    setImmediate(() => {
      lastYield = Date.now();
      r();
    }),
  );

/** Step `sim` to its end (or `maxTicks` more ticks), yielding to the runner while it goes. */
export async function runSim(sim: Simulation, maxTicks = Infinity, onTick?: (sim: Simulation) => void): Promise<Simulation> {
  let n = 0;
  while (!sim.done && n < maxTicks) {
    sim.stepTick();
    onTick?.(sim);
    n++;
    await pace();
  }
  return sim;
}

/** Step `sim` while `cond` holds and it is not done, yielding to the runner while it goes. */
export async function stepWhile(sim: Simulation, cond: (sim: Simulation) => boolean, onTick?: (sim: Simulation) => void): Promise<Simulation> {
  while (!sim.done && cond(sim)) {
    sim.stepTick();
    onTick?.(sim);
    await pace();
  }
  return sim;
}

/** Simulations created through `create`/`run` and not yet disposed (tests/setup.ts disposes the rest after each file). */
const live = new Set<Simulation>();

/** Simulation.create, tracked so `disposeTracked` (afterEach / afterAll) frees the engine world of anything left over. */
export async function create(def: FixtureDef, opts: SimOptions = {}): Promise<Simulation> {
  const sim = await Simulation.create(def, opts);
  live.add(sim);
  const dispose = sim.dispose.bind(sim);
  sim.dispose = () => {
    live.delete(sim);
    dispose();
  };
  return sim;
}

/** Dispose every tracked simulation still alive. */
export function disposeTracked(): void {
  for (const s of [...live]) s.dispose();
}

/** Run `def` to its end (tracked), calling `each` before the first tick and after every tick. */
export async function runEach(def: FixtureDef, each: (sim: Simulation) => void, opts: SimOptions = {}): Promise<Simulation> {
  const sim = await create(def, opts);
  each(sim);
  while (!sim.done) {
    sim.stepTick();
    await pace();
    each(sim);
  }
  return sim;
}

export async function run(def: FixtureDef, opts: SimOptions = {}): Promise<Simulation> {
  return runSim(await create(def, opts));
}

/**
 * Within one test file: run each (fixture, options) once and share the finished simulation between tests that only
 * read it. Options must be plain data (no callbacks). Call `dispose()` in `afterAll`.
 */
export function sharedRuns(): { get: (def: FixtureDef, opts?: SimOptions) => Promise<Simulation>; dispose: () => void } {
  const m = new Map<string, Promise<Simulation>>();
  return {
    get(def, opts = {}) {
      const k = `${def.id}|${JSON.stringify(opts)}`;
      let p = m.get(k);
      if (!p) m.set(k, (p = run(def, opts)));
      return p;
    },
    dispose() {
      for (const p of m.values()) void p.then((s) => s.dispose());
      m.clear();
    },
  };
}

export const hyp = (x: number, z: number): number => Math.hypot(x, z);
export const speedH = (row: TraceRow, id: string): number => hyp(row.players[id].v[0], row.players[id].v[2]);

/** Max absolute difference between two traces for the given players (position/velocity/yaw). */
export function traceDiff(a: TraceRow[], b: TraceRow[], ids: string[]): { pos: number; vel: number; yaw: number; ticks: number } {
  const n = Math.min(a.length, b.length);
  let pos = 0;
  let vel = 0;
  let yaw = 0;
  for (let i = 0; i < n; i++)
    for (const id of ids) {
      const pa = a[i].players[id];
      const pb = b[i].players[id];
      for (let k = 0; k < 3; k++) {
        pos = Math.max(pos, Math.abs(pa.p[k] - pb.p[k]));
        vel = Math.max(vel, Math.abs(pa.v[k] - pb.v[k]));
      }
      let dy = Math.abs(pa.yaw - pb.yaw);
      if (dy > Math.PI) dy = 2 * Math.PI - dy;
      yaw = Math.max(yaw, dy);
    }
  return { pos, vel, yaw, ticks: Math.abs(a.length - b.length) };
}

/**
 * Every field of every trace row: the first row and top-level field that differ in their serialized form, or null
 * when both traces are identical (same length, same rows).
 */
export function traceRowsDiff(a: TraceRow[], b: TraceRow[]): { row: number; field: string } | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ra = a[i];
    const rb = b[i];
    if (!ra || !rb) return { row: i, field: '(length)' };
    if (JSON.stringify(ra) === JSON.stringify(rb)) continue;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)]) as Set<keyof TraceRow>) {
      if (k !== 'players') {
        if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) return { row: i, field: k };
        continue;
      }
      for (const id of new Set([...Object.keys(ra.players), ...Object.keys(rb.players)])) {
        const pa = ra.players[id] as unknown as Record<string, unknown> | undefined;
        const pb = rb.players[id] as unknown as Record<string, unknown> | undefined;
        if (!pa || !pb) return { row: i, field: `players.${id}` };
        for (const f of new Set([...Object.keys(pa), ...Object.keys(pb)]))
          if (JSON.stringify(pa[f]) !== JSON.stringify(pb[f])) return { row: i, field: `players.${id}.${f}` };
      }
    }
    return { row: i, field: '(order)' };
  }
  return null;
}

export const firstContactT = (sim: Simulation): number | null => {
  const e = sim.events.find((x) => x.type === 'contactBegin');
  return e ? e.t : null;
};

/** The items as an array, after asserting there is at least one (a per-item loop over nothing proves nothing). */
export function nonEmpty<T>(xs: Iterable<T>, what = 'items'): T[] {
  const a = [...xs];
  expect(a.length, `${what}: expected at least one`).toBeGreaterThan(0);
  return a;
}
