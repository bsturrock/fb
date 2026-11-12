// Simulation runs for the tests, with no vitest import: tests/helpers.ts re-exports all of it, and the L3 contract pass
// (tests/l3-pass.ts) runs it in shard processes outside vitest (plan 13b).
import type { SimEvent } from '../src/sim/contracts';
import { Simulation, type SimOptions, type TraceRow } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { RAPIER } from '../src/sim/physics';
import {
  HIP_STOPS_L4_V1, HIP_STOPS_V2, withAdditionalPgsIterations, withHipStops, withKneeStop, withoutConversionRetry, withoutHipStops, withoutKneeStop,
  withoutPgsIterations, withoutSelfLegs, type HipStopProfile, type RagdollProfile,
} from '../src/sim/profiles';

/** The registered fixture `id` (a fresh definition each call); throws when there is none. */
export const FIX = (id: string): FixtureDef => {
  const f = allFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};

/**
 * Ladder 8i/8j: a ragdoll profile without the visible flip's parts (hip stops, additional PGS iterations, knee stop),
 * without the deferred conversion (8j) and without own-leg contact (ladder 9, registered after them), under the id it
 * had before them.
 */
export const unflipped = (r: RagdollProfile): RagdollProfile => withoutConversionRetry(withoutKneeStop(withoutPgsIterations(withoutHipStops(withoutSelfLegs(r)))));
/**
 * Ladder 9: `d` with its ragdoll profile as before own-leg contact was registered (the visible flip kept): the profile a
 * capture taken under rung 8m's registration, or a case "without the field", ran under.
 */
export const preOwnLegs = (d: FixtureDef): FixtureDef => (d.ragdoll ? { ...d, ragdoll: withoutSelfLegs(d.ragdoll) } : d);
/**
 * Ladder 8l: `d` with its ragdoll profile as before the visible flip: the profile a state capture taken before it, a
 * case "without the field" or a natural sample was taken under (as LEG_GUARD_V1 pins those of ladder rung 7d).
 */
export const preFlip = (d: FixtureDef): FixtureDef => (d.ragdoll ? { ...d, ragdoll: unflipped(d.ragdoll) } : d);
/** Ladder 8i: the hip stops the 8i assessment gave a ragdoll (`hipStopsFor` before rung 8k: on L4 the backstop). */
export const hipStops8i = (r: RagdollProfile): HipStopProfile => (r.envelope?.hip ? HIP_STOPS_L4_V1 : HIP_STOPS_V2);
/**
 * Ladder 8i: `d` with the visible flip as the 8i assessment ran it (the hip stops `hipStops8i` gives, 4 additional PGS
 * iterations, the knee stop at 140) on its profile without them: the profile a capture taken under that variant ran
 * under (`scripts/capture-state.ts --flip8i`).
 */
export const flip8i = (d: FixtureDef): FixtureDef => {
  if (!d.ragdoll) return d;
  const r = unflipped(d.ragdoll);
  return { ...d, ragdoll: withKneeStop(withAdditionalPgsIterations(withHipStops(r, hipStops8i(r)), 4), 140) };
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

/**
 * Plan 13a: counts Rapier shape queries (Shape.contactShape, Collider.contactShape, Collider.contactCollider) until
 * `restore`. `take` returns the count since the previous `take`. Counting never changes a result.
 */
export function shapeQueryCounter(): { take: () => number; restore: () => void } {
  let n = 0;
  const undo: (() => void)[] = [];
  const wrap = (proto: object, name: string): void => {
    const p = proto as Record<string, unknown>;
    const orig = p[name] as (...a: unknown[]) => unknown;
    p[name] = function (this: unknown, ...a: unknown[]) {
      n++;
      return orig.apply(this, a);
    };
    undo.push(() => (p[name] = orig));
  };
  wrap(RAPIER.Shape.prototype, 'contactShape');
  wrap(RAPIER.Collider.prototype, 'contactShape');
  wrap(RAPIER.Collider.prototype, 'contactCollider');
  return {
    take: () => {
      const k = n;
      n = 0;
      return k;
    },
    restore: () => undo.forEach((f) => f()),
  };
}
