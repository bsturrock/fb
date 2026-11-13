// Simulation runs for the tests, with no vitest import: tests/helpers.ts re-exports all of it, and the L3 contract pass
// (tests/l3-pass.ts) runs it in shard processes outside vitest (plan 13b).
import type { SimEvent } from '../src/sim/contracts';
import { Simulation, type SimOptions, type TraceRow } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { withoutHoldStill } from '../src/sim/footwork';
import { RAPIER } from '../src/sim/physics';
import {
  HIP_STOPS_L4_V1, HIP_STOPS_V2, LEG_GUARD_V1, withAdditionalPgsIterations, withHipStops, withJointRange, withKneeStop, withoutConversionRetry, withoutHipStops, withoutKneeStop,
  withClipArmSwing, withMetArmStay, withoutBornOverlap, withoutBornSeparation, withoutClipArmSwing, withoutMetArmStay, withoutPgsIterations, withoutSelfLegs, type HipStopProfile, type RagdollProfile,
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
/**
 * Ladder 10: `d` with its leg guard as before the leg-guard flip (LEG_GUARD_V1, plan 13f's predictive guard; the flip
 * registers LEG_GUARD_V3): the guard every state capture without `~v3` in its name, and every natural sample taken
 * before the flip, ran under. Composes with `preOwnLegs`, `preFlip` and `flip8i`, which leave the leg guard as given.
 */
export const preV3 = (d: FixtureDef): FixtureDef => (d.legGuard ? { ...d, legGuard: LEG_GUARD_V1 } : d);
/**
 * Ladder 14a: `d` with its foot planner as before the still-feet flip (no `holdStill`): the planner every state capture
 * and natural sample taken before the flip ran under. Composes with the other `pre*` helpers.
 */
export const preHoldStill = (d: FixtureDef): FixtureDef => (d.footwork?.holdStill ? { ...d, footwork: withoutHoldStill(d.footwork) } : d);
/**
 * Ladder 17b: `d` with its ragdoll profile as before the born-overlap flip (no `bornOverlap`): the profile every state
 * capture and natural sample taken before the flip ran under. Composes with the other `pre*` helpers, which leave it as
 * given.
 */
export const preBornOverlap = (d: FixtureDef): FixtureDef => (d.ragdoll?.bornOverlap ? { ...d, ragdoll: withoutBornOverlap(d.ragdoll) } : d);
/**
 * Ladder 18c: `d` with its ragdoll profile as before the born-separation flip (BORN_OVERLAP_V1 in V2's place, its id as
 * it was): the profile every state capture and natural sample taken before the flip ran under. Composes with the other
 * `pre*` helpers (`preBornOverlap` takes either off).
 */
export const preBornSeparation = (d: FixtureDef): FixtureDef => (d.ragdoll?.bornOverlap?.separation ? { ...d, ragdoll: withoutBornSeparation(d.ragdoll) } : d);
/**
 * Ladder 18 (the met-arm flip, 16b's `metArmStay` with 14b's `clipArmSwing`): `d` as before it, its self-clearance
 * without either (the same definition on a fixture without them): what a case that loads the arm the flip keeps, and
 * every state capture and natural sample taken before it, ran under. Composes with the other `pre*` helpers.
 */
export const preMetArmStay = (d: FixtureDef): FixtureDef => (d.selfClearance?.metArmStay ? { ...d, selfClearance: withoutClipArmSwing(withoutMetArmStay(d.selfClearance)) } : d);
/** Ladder 18: `d` with the met-arm flip's self-clearance (`metArmStay` and `clipArmSwing`; as it is when it has them). */
export const metArmStayed = (d: FixtureDef): FixtureDef => (d.selfClearance ? { ...d, selfClearance: withMetArmStay(withClipArmSwing(d.selfClearance)) } : d);
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

/** Every object reachable from `root` (own data fields, arrays, map and set members), with its first path. */
export function pathsOf(root: object, skip?: Set<object>): Map<object, string> {
  const out = new Map<object, string>();
  const walk = (o: unknown, p: string): void => {
    if (!o || typeof o !== 'object' || out.has(o) || skip?.has(o)) return;
    out.set(o, p);
    if (o instanceof Map) for (const [k, v] of o) walk(v, `${p}[${String(k)}]`);
    else if (o instanceof Set) [...o].forEach((v, i) => walk(v, `${p}{${i}}`));
    else if (!ArrayBuffer.isView(o)) for (const k of Object.keys(o)) walk((o as Record<string, unknown>)[k], `${p}.${k}`);
  };
  walk(root, '');
  return out;
}

/** Every profile id in a definition, by path (`ragdoll`, `legGuard`, `footwork.holdStill`, ...), and the fixture's at `.`. */
export function profileIds(def: FixtureDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [o, p] of pathsOf(def)) {
    const id = (o as { id?: unknown }).id;
    if (typeof id === 'string' && p !== '') out[p.slice(1)] = id;
  }
  out['.'] = def.id;
  return out;
}

/**
 * The definition as `Simulation.create` builds it, whose profile ids a state capture records (plan 12: under a
 * joint-range profile the ragdoll's shoulder envelope is the profile's). Kept equal to `create` by every capture test:
 * `asCaptured` finds nothing, or the resume refuses, if the two part.
 */
const asBuilt = (d: FixtureDef): FixtureDef => (d.jointRange && d.ragdoll ? { ...d, ragdoll: withJointRange(d.ragdoll, d.jointRange) } : d);

/**
 * The flips registered on L3, L4 and HC since the first state capture, the latest first: each gives a definition as
 * before its flip (18e met arms, 18c born separation, 17b born overlap, 14a still feet, 10d physical legs, 9d own-leg contact, 8m the visible flip). A flip
 * adds its `pre*` helper at the head, and every capture taken before it then resumes under the definition it ran under
 * (`asCaptured`).
 */
export const BEFORE_FLIPS: readonly ((d: FixtureDef) => FixtureDef)[] = [preMetArmStay, preBornSeparation, preBornOverlap, preHoldStill, preV3, preOwnLegs, preFlip];

/**
 * The definition a state capture (tests/state.ts) ran under: of the registered fixture and the definitions as before
 * each flip in turn (BEFORE_FLIPS applied one after another), the first whose profile ids, as built, are the capture's.
 * `as` maps each one to the variant a capture was taken under (scripts/capture-state.ts `--v3`, `--flip8i`, `--hips`,
 * `--joints`): the definition returned is `as` of it. `variant`: paths the test resumes as a variant of the capture
 * (resumeState's `variant`), not compared; no flip in the chain may change one, so the chain cannot stop early on it.
 * Throws when no definition matches.
 */
export function asCaptured(cap: { fixture: string; tick: number; profiles: Record<string, string> }, as: (d: FixtureDef) => FixtureDef = (d) => d, variant: string[] = []): FixtureDef {
  const skip = (p: string): boolean => variant.some((v) => p === v || p.startsWith(`${v}.`));
  const mismatch = (ids: Record<string, string>): string[] =>
    [...new Set([...Object.keys(ids), ...Object.keys(cap.profiles)])].filter((p) => !skip(p) && ids[p] !== cap.profiles[p]).map((p) => `${p} ${ids[p] ?? 'absent'}`);
  const chain = [FIX(cap.fixture)];
  for (const f of BEFORE_FLIPS) chain.push(f(chain[chain.length - 1]));
  const defs = chain.map(as);
  const ids = defs.map((v) => profileIds(asBuilt(v)));
  for (const p of new Set(ids.flatMap((x) => Object.keys(x)))) if (skip(p) && ids.some((x) => x[p] !== ids[0][p])) throw new Error(`asCaptured(${cap.fixture}@${cap.tick}): the flip chain changes ${p}, which the test resumes as a variant`);
  const tried: string[] = [];
  for (let i = 0; i < defs.length; i++) {
    const off = mismatch(ids[i]);
    if (!off.length) return defs[i];
    tried.push(off.join(', '));
  }
  throw new Error(`asCaptured(${cap.fixture}@${cap.tick}): no definition in the flip chain ran the capture's profiles (differing, from the registered on: ${tried.map((t) => `[${t}]`).join(' ')})`);
}

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
