// Full-state capture of a fixture run at a tick boundary, and a deterministic resume from it (test support, no vitest
// import). A capture holds the Rapier world (`World.takeSnapshot`) and the whole JS state graph reachable from the
// Simulation, so a regression test can start shortly before a defect from a fixed state: later rungs that move the
// fixture's trajectory before that point do not move the test. The same capture can be resumed under a profile variant
// (`resumeState(cap, { def })`), the controlled twin of ladder rule 7. How to capture, and when a capture must be
// regenerated: tests/README.md.
//
// Mechanism. The resume builds a fresh Simulation from the (possibly variant) fixture definition, replaces its Rapier
// world with the snapshot's, and writes the captured graph into the fresh one in place: an object at the same path of
// the same kind is reused (so the closures the build made, which capture the Simulation, its PhysicsWorld and the arm
// host, stay bound to live objects), every other object is created with its class's prototype. Encoded specially:
// - objects reachable from `sim.def` (profiles, clips, the fixture's data): by their path in the definition, resolved
//   against the resume definition (this is how a variant's profile reaches the state);
// - the simulation world's rigid bodies, colliders and impulse joints: by handle, with their JS-side fields (body
//   `userData`, the collider's cached JS shape, whose exact f64 sizes the queries read);
// - functions and accessors: taken from the fresh build at the same path (they all close over the Simulation);
// - the measured trunk pieces (a process-wide cache with colliders in a private query world): by owner and index;
// - other engine objects (the hook event queue): the fresh build's at the same path;
// - a frozen profile constant the build uses outside the definition (a default such as ARM_G2, `sim.arms.profile` when
//   the fixture names no `armProfile`: frozen because another registered fixture names it): by its export path in
//   src/sim/profiles, with its id, which the resume checks.
// Numbers are written exactly (JSON's shortest round-trip form, NaN / infinities / -0 tagged). Captures are taken
// between ticks only (`stepTick` keeps no state on its stack across ticks).
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import type { FixtureDef } from '../src/sim/fixture';
import { RAPIER, trunkPieces } from '../src/sim/physics';
import * as PROFILES from '../src/sim/profiles';
import { SIM_DEFAULTS, Simulation, type SimOptions } from '../src/sim/simulation';
import { create, FIX, pathsOf, profileIds } from './runs';

/** Bumped whenever the encoding changes; a capture of another format is refused. */
export const STATE_FORMAT = 1;

export interface StateCapture {
  format: number;
  rapier: string;
  fixture: string;
  tick: number;
  steps: number;
  /** Every profile id in the definition the capture ran under, by path (`ragdoll.id`, `legGuard.id`, ...). */
  profiles: Record<string, string>;
  /** The run's options that shape its state (callbacks excluded). */
  opts: Record<string, unknown>;
  /** Own field names of every class instance, by path: the state layout the capture was written against. */
  layout: Record<string, string[]>;
  world: string;
  state: unknown;
  bodies: [number, unknown][];
  colliders: [number, unknown][];
}

type Node = any;
const RAPIER_NAME = new Map<unknown, string>(Object.entries(RAPIER).filter(([, v]) => typeof v === 'function').map(([k, v]) => [v, k]));
/**
 * Rapier classes that are plain JS values (shapes and math), written field by field. RoundConvexPolyhedron: the physical
 * supported legs' shapes (LegGuardProfile.physicalLegs), cached on their colliders.
 */
const RAPIER_VALUES = new Set(['Ball', 'Capsule', 'Cuboid', 'RoundCuboid', 'Cylinder', 'Cone', 'ConvexPolyhedron', 'RoundConvexPolyhedron', 'Segment', 'Triangle', 'Vector3', 'Quaternion']);
const TYPED: Record<string, new (a: number[]) => ArrayBufferView> = { Float32Array, Float64Array, Int32Array, Uint32Array, Uint8Array, Uint16Array, Int16Array, Int8Array };

const num = (x: number): Node => (Number.isNaN(x) ? { $n: 'NaN' } : x === Infinity ? { $n: 'Inf' } : x === -Infinity ? { $n: '-Inf' } : Object.is(x, -0) ? { $n: '-0' } : x);
const unnum = (n: { $n: string }): number => ({ NaN: NaN, Inf: Infinity, '-Inf': -Infinity, '-0': -0 })[n.$n]!;

/**
 * The frozen objects src/sim/profiles exports or reaches, by their first path in export order (`.ARM_G2`,
 * `.ARM_G2.wrap`): the constants a build may hold outside its definition. Only frozen ones: an extensible constant is
 * written by value, as before. Read at each capture (the fixture registry freezes what it reaches when first built).
 */
const profileConstants = (): Map<object, string> =>
  new Map([...pathsOf(PROFILES as unknown as object)].filter(([o, p]) => p !== '' && !Object.isExtensible(o)));

/** The measured trunk pieces any player of `sim` can reach (module cache), keyed by player index and piece. */
function trunkRegistry(sim: Simulation): Map<unknown, string> {
  const out = new Map<unknown, string>();
  sim.players.forEach((pl, i) => {
    trunkPieces(pl.body)?.forEach((t, k) => {
      for (const [f, v] of Object.entries(t)) if (v && typeof v === 'object') out.set(v, `${i}.${k}.${f}`);
      out.set(t, `${i}.${k}`);
    });
  });
  return out;
}

/** The world's body, collider and joint sets (JS and raw) by name: the fields a dead wrapper keeps. */
function worldSets(world: RAPIER.World): Map<unknown, string> {
  const W = world as unknown as Record<'bodies' | 'colliders' | 'impulseJoints', { raw: unknown }>;
  return new Map<unknown, string>((['bodies', 'colliders', 'impulseJoints'] as const).flatMap((k) => [[W[k], k], [W[k].raw, `${k}.raw`]] as [unknown, string][]));
}

const stateOpts = (o: SimOptions): Record<string, unknown> => {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v !== 'function' && v !== undefined) r[k] = v;
  return r;
};

/** The full state of `sim` now (call between ticks). */
export function captureState(sim: Simulation): StateCapture {
  const world = sim.physics.world;
  const defPaths = pathsOf(sim.def);
  const trunk = trunkRegistry(sim);
  const consts = profileConstants();
  const ids = new Map<object, number>();
  const layout: Record<string, string[]> = {};
  const W = world as unknown as { bodies: { raw: unknown }; colliders: { raw: unknown }; impulseJoints: { raw: unknown } };
  const sets = worldSets(world);
  const enc = (v: unknown, path: string): Node => {
    if (typeof v === 'number') return num(v);
    if (v === undefined) return { $u: 1 };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'function') return { $fn: 1 };
    if (typeof v !== 'object') throw new Error(`state capture: unsupported ${typeof v} at ${path}`);
    const o = v as Record<string, unknown>;
    if (ids.has(o)) return { $ref: ids.get(o) };
    if (defPaths.has(o)) return { $def: defPaths.get(o) };
    if (trunk.has(o)) return { $trunk: trunk.get(o) };
    // a frozen profile constant outside the definition (by reference: no $id, every reference resolves to it again)
    if (consts.has(o)) return { $const: consts.get(o), ...(typeof o.id === 'string' ? { id: o.id } : {}) };
    const ctor = Object.getPrototypeOf(o)?.constructor;
    const rn = RAPIER_NAME.get(ctor);
    if (rn === 'World') {
      if ((o as unknown) !== world) throw new Error(`state capture: a foreign Rapier world at ${path}`);
      return { $world: 1 };
    }
    if (sets.has(o)) return { $set: sets.get(o) };
    // a live body, collider or joint of the world by handle; one the world has removed (a proxy body kept after its
    // conversion) is written as a dead wrapper of the same handle, as invalid after the resume as before
    let dead = false;
    if (rn === 'RigidBody' || rn === 'Collider' || (rn && /ImpulseJoint$/.test(rn))) {
      const h = (o as { handle: number }).handle;
      const own = rn === 'RigidBody' ? (o as { rawSet?: unknown }).rawSet === W.bodies.raw : rn === 'Collider' ? (o as { colliderSet?: unknown }).colliderSet === W.colliders : (o as { rawSet?: unknown }).rawSet === W.impulseJoints.raw;
      if (!own) throw new Error(`state capture: a ${rn} of another world at ${path}`);
      const live = rn === 'RigidBody' ? world.getRigidBody(h) : rn === 'Collider' ? world.getCollider(h) : world.getImpulseJoint(h);
      if ((live as unknown) === o) return rn === 'RigidBody' ? { $rb: h } : rn === 'Collider' ? { $col: h } : { $joint: h };
      dead = true;
    }
    if (rn && !dead && !RAPIER_VALUES.has(rn)) return { $fresh: rn };
    const id = ids.size;
    ids.set(o, id);
    if (ArrayBuffer.isView(o)) {
      const t = ctor.name as string;
      if (!TYPED[t]) throw new Error(`state capture: unsupported ${t} at ${path}`);
      return { $id: id, $t: t, v: Array.from(o as unknown as ArrayLike<number>, num) };
    }
    if (Array.isArray(o)) {
      if (Object.keys(o).length !== o.length) throw new Error(`state capture: a sparse or decorated array at ${path}`);
      return { $id: id, $a: o.map((x, i) => enc(x, `${path}[${i}]`)) };
    }
    if (o instanceof Map) return { $id: id, $m: [...o].map(([k, x]) => [enc(k, `${path}<key>`), enc(x, `${path}[${String(k)}]`)]) };
    if (o instanceof Set) return { $id: id, $s: [...o].map((x, i) => enc(x, `${path}{${i}}`)) };
    const proto = Object.getPrototypeOf(o);
    const cls = proto === Object.prototype ? undefined : proto === null ? '$null' : rn ? `rapier:${rn}` : (ctor?.name as string);
    if (cls === undefined && !Object.isExtensible(o)) throw new Error(`state capture: a frozen object outside the definition at ${path}`);
    // fields as a JSON object in own-key order (integer-like keys lead in both, as in any object); non-enumerable ones listed
    const f: Record<string, Node> = {};
    const ne: string[] = [];
    for (const k of Object.getOwnPropertyNames(o)) {
      const d = Object.getOwnPropertyDescriptor(o, k)!;
      // the test helpers' tracking wrapper (tests/runs.ts create), not simulation state
      if (o === (sim as unknown) && k === 'dispose') continue;
      f[k] = d.get || d.set ? { $acc: 1 } : enc(d.value, `${path}.${k}`);
      if (!d.enumerable) ne.push(k);
    }
    if (cls && !rn && cls !== '$null') layout[path] = Object.keys(f);
    return { $id: id, ...(cls ? { $c: cls } : {}), f, ...(ne.length ? { ne } : {}) };
  };
  const state = enc(sim, 'sim');
  const bodies: [number, unknown][] = [];
  world.bodies.forEach((b) => {
    if (b.userData !== undefined) bodies.push([b.handle, enc(b.userData, `body#${b.handle}.userData`)]);
  });
  const colliders: [number, unknown][] = [];
  world.colliders.forEach((c) => {
    const s = (c as unknown as { _shape?: unknown })._shape;
    if (s) colliders.push([c.handle, enc(s, `collider#${c.handle}._shape`)]);
  });
  return {
    format: STATE_FORMAT,
    rapier: RAPIER.version(),
    fixture: sim.def.id,
    tick: sim.tick,
    steps: sim.steps,
    profiles: profileIds(sim.def),
    // the ledger default is read at the build: recorded as the option it was
    opts: stateOpts({ ledgers: SIM_DEFAULTS.ledgers, ...sim.opts }),
    layout,
    world: Buffer.from(world.takeSnapshot()).toString('base64'),
    state,
    bodies,
    colliders,
  };
}

export interface ResumeOptions {
  /**
   * The definition to resume under (default: the registered fixture). It must carry every profile id the capture ran
   * under, except at the paths listed in `variant` (the twin's change, e.g. `['legGuard']`).
   */
  def?: FixtureDef;
  variant?: string[];
  /** Run options; callbacks are free, the state-shaping ones must equal the capture's. */
  opts?: SimOptions;
  /**
   * A fault twin's debug switches (`SimOptions.debug`), on from the capture's tick: the same state resumed with a
   * change of behaviour off (ladder rule 7). Read live by the code they switch (a pose build reads its `debug` each
   * time), never captured state; they replace the capture's debug options.
   */
  faults?: SimOptions['debug'];
}

class StaleCapture extends Error {}
const stale = (cap: StateCapture, why: string): never => {
  throw new StaleCapture(`stale state capture (${cap.fixture} at tick ${cap.tick}): ${why}. Regenerate it (tests/README.md)`);
};

/** A Simulation in the captured state, ready to step on from the capture's tick. */
export async function resumeState(cap: StateCapture, o: ResumeOptions = {}): Promise<Simulation> {
  if (cap.format !== STATE_FORMAT) stale(cap, `format ${cap.format}, this tree reads ${STATE_FORMAT}`);
  const def = o.def ?? FIX(cap.fixture);
  const variant = o.variant ?? [];
  const opts: SimOptions = { ...cap.opts, ...o.opts, ...(o.faults ? { debug: o.faults } : {}) };
  for (const [k, v] of Object.entries(stateOpts(o.opts ?? {}))) if (JSON.stringify(cap.opts[k]) !== JSON.stringify(v)) throw new Error(`state resume: option ${k} differs from the capture's (${JSON.stringify(cap.opts[k])})`);
  // tracked (tests/runs.ts), so a test's leftover is freed with the file's other simulations
  const sim = await create(def, opts);
  try {
    if (cap.rapier !== RAPIER.version()) stale(cap, `Rapier ${cap.rapier}, this tree loads ${RAPIER.version()}`);
    const now = profileIds(sim.def);
    const inVariant = (p: string): boolean => variant.some((v) => p === v || p.startsWith(`${v}.`));
    for (const [p, id] of Object.entries(cap.profiles)) {
      if (inVariant(p)) continue;
      if (now[p] !== id) stale(cap, `profile at ${p} is ${now[p] ?? 'absent'}, the capture ran under ${id}`);
    }
    for (const p of Object.keys(now)) if (!inVariant(p) && !(p in cap.profiles)) stale(cap, `profile ${now[p]} at ${p} is new`);
    decodeInto(sim, cap, stale);
  } catch (e) {
    try {
      sim.dispose();
    } catch {
      // a half-written state may not dispose; the error that stopped it is what matters
    }
    throw e;
  }
  return sim;
}

function decodeInto(sim: Simulation, cap: StateCapture, bad: (cap: StateCapture, why: string) => never): void {
  const fresh = sim.physics.world;
  // read before the decode rewrites the Simulation's own fields
  const def = sim.def;
  const world = RAPIER.World.restoreSnapshot(new Uint8Array(Buffer.from(cap.world, 'base64')));
  const trunk = new Map<string, unknown>([...trunkRegistry(sim)].map(([v, k]) => [k, v]));
  // classes by name: the fresh build's instances (every class the state holds is made at build) and Rapier's values
  const classes = new Map<string, object>();
  for (const x of pathsOf(sim).keys()) {
    const p = Object.getPrototypeOf(x);
    if (p && p !== Object.prototype && p !== Array.prototype && !RAPIER_NAME.has(p.constructor)) classes.set(p.constructor.name, p);
  }
  for (const [c, n] of RAPIER_NAME) if (RAPIER_VALUES.has(n)) classes.set(`rapier:${n}`, (c as { prototype: object }).prototype);
  for (const [c, n] of RAPIER_NAME) if (n === 'RigidBody' || n === 'Collider' || /ImpulseJoint$/.test(n)) classes.set(`rapier:${n}`, (c as { prototype: object }).prototype);
  const setsBack = new Map([...worldSets(world)].map(([v, k]) => [k, v]));
  const memo = new Map<number, unknown>();
  const claimed = new Set<object>();
  const at = (path: string, root: unknown): unknown => {
    let o = root as Record<string, unknown> | undefined;
    for (const k of path.split('.').slice(1)) o = o?.[k] as Record<string, unknown> | undefined;
    return o;
  };
  const dec = (n: Node, f: unknown, path: string): unknown => {
    if (n === null || typeof n !== 'object') return n;
    if ('$n' in n) return unnum(n);
    if ('$u' in n) return undefined;
    if ('$ref' in n) return memo.get(n.$ref);
    if ('$def' in n) {
      const v = n.$def === '' ? def : at(n.$def, def);
      if (v === undefined) bad(cap, `definition path ${n.$def} (read at ${path}) is gone`);
      return v;
    }
    if ('$trunk' in n) return trunk.get(n.$trunk) ?? bad(cap, `trunk piece ${n.$trunk} (at ${path}) is gone`);
    if ('$const' in n) {
      const v = at(n.$const, PROFILES) as { id?: unknown } | undefined;
      if (!v || typeof v !== 'object') return bad(cap, `profile constant ${n.$const} (read at ${path}) is gone`);
      if (n.id !== undefined && v.id !== n.id) bad(cap, `profile constant ${n.$const} (read at ${path}) is ${String(v.id)}, the capture ran under ${n.id}`);
      return v;
    }
    if ('$world' in n) return world;
    if ('$set' in n) return setsBack.get(n.$set) ?? bad(cap, `no world set ${n.$set}`);
    if ('$rb' in n) return world.getRigidBody(n.$rb) ?? bad(cap, `no rigid body ${n.$rb} at ${path}`);
    if ('$col' in n) return world.getCollider(n.$col) ?? bad(cap, `no collider ${n.$col} at ${path}`);
    if ('$joint' in n) return world.getImpulseJoint(n.$joint) ?? bad(cap, `no joint ${n.$joint} at ${path}`);
    // the run options are the resume's own (its callbacks; the state-shaping ones were checked equal)
    if (path === 'sim.opts') {
      if ('$id' in n) memo.set(n.$id, f);
      return f;
    }
    if ('$fn' in n) return typeof f === 'function' ? f : bad(cap, `no function at ${path} in this build`);
    if ('$fresh' in n) return f && RAPIER_NAME.get(Object.getPrototypeOf(f)?.constructor) === n.$fresh ? f : bad(cap, `no ${n.$fresh} at ${path} in this build`);
    const reuse = (ok: boolean): boolean => ok && !claimed.has(f as object) && (claimed.add(f as object), true);
    if ('$t' in n) {
      const v = new TYPED[n.$t]((n.v as Node[]).map((x) => (typeof x === 'number' ? x : unnum(x))));
      memo.set(n.$id, v);
      return v;
    }
    if ('$a' in n) {
      const a = reuse(Array.isArray(f)) ? (f as unknown[]) : [];
      const old = a.slice();
      memo.set(n.$id, a);
      a.length = 0;
      (n.$a as Node[]).forEach((x, i) => a.push(dec(x, old[i], `${path}[${i}]`)));
      return a;
    }
    if ('$m' in n) {
      const m = reuse(f instanceof Map) ? (f as Map<unknown, unknown>) : new Map();
      const old = new Map(m);
      memo.set(n.$id, m);
      m.clear();
      for (const [k, x] of n.$m as [Node, Node][]) {
        const key = dec(k, undefined, `${path}<key>`);
        m.set(key, dec(x, old.get(key), `${path}[${String(key)}]`));
      }
      return m;
    }
    if ('$s' in n) {
      const s = reuse(f instanceof Set) ? (f as Set<unknown>) : new Set();
      memo.set(n.$id, s);
      s.clear();
      (n.$s as Node[]).forEach((x, i) => s.add(dec(x, undefined, `${path}{${i}}`)));
      return s;
    }
    const cls: string | undefined = n.$c;
    const proto = cls === undefined ? Object.prototype : cls === '$null' ? null : classes.get(cls);
    if (proto === undefined) bad(cap, `class ${cls} (at ${path}) is not made by this build`);
    const fo = f && typeof f === 'object' && !Array.isArray(f) && !(f instanceof Map) && !(f instanceof Set) ? (f as Record<string, unknown>) : undefined;
    const o = (reuse(!!fo && !cls?.startsWith('rapier:') && Object.getPrototypeOf(fo) === proto) ? fo : Object.create(proto as object | null)) as Record<string, unknown>;
    memo.set(n.$id, o);
    // the fields in the captured order: every own field is removed and defined again (functions and accessors from the
    // fresh build), so key order, which the exports and Object.keys walks read, is the capture's
    const prior = new Map(Object.getOwnPropertyNames(o).map((k) => [k, Object.getOwnPropertyDescriptor(o, k)!]));
    const tracking = path === 'sim' && typeof prior.get('dispose')?.value === 'function' ? prior.get('dispose') : undefined;
    if (tracking) prior.delete('dispose');
    if (cls && cap.layout[path]) {
      const want = cap.layout[path];
      const extra = [...prior.keys()].filter((k) => !want.includes(k));
      if (extra.length) bad(cap, `${cls} at ${path} has fields the capture lacks (${extra.join(', ')})`);
    }
    for (const k of prior.keys()) delete o[k];
    if (tracking) delete o.dispose;
    const ne = new Set<string>(n.ne ?? []);
    for (const [k, x] of Object.entries(n.f as Record<string, Node>)) {
      const p = prior.get(k);
      if (x && typeof x === 'object' && '$acc' in x) {
        if (!p || !(p.get || p.set)) bad(cap, `no accessor ${k} at ${path} in this build`);
        Object.defineProperty(o, k, p!);
        continue;
      }
      Object.defineProperty(o, k, { value: dec(x, p && !p.get && !p.set ? p.value : undefined, `${path}.${k}`), writable: true, configurable: true, enumerable: !ne.has(k) });
    }
    if (tracking) Object.defineProperty(o, 'dispose', tracking);
    return o;
  };
  // the fresh world goes when the state no longer reaches it
  dec(cap.state, sim, 'sim');
  for (const [h, n] of cap.bodies) world.getRigidBody(h).userData = dec(n, undefined, `body#${h}.userData`);
  for (const [h, n] of cap.colliders) (world.getCollider(h) as unknown as { _shape: unknown })._shape = dec(n, undefined, `collider#${h}._shape`);
  if (sim.physics.world !== world) bad(cap, 'the state does not hold the simulation world');
  fresh.free();
}

export function saveState(path: string, cap: StateCapture): void {
  writeFileSync(path, gzipSync(JSON.stringify(cap), { level: 9 }));
}

export function loadState(path: string): StateCapture {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as StateCapture;
}
