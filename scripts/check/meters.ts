// The full check's runs (scripts/check/README.md): one run of a fixture in one body order with every meter that order
// feeds attached, and the row each part makes of it. The meters only read a run (the leg matrix's onSubstep sample, the
// shape-query counter's prototype wrappers, the passive-energy meter's step wrapper, the visible meter after each tick;
// the fall-response stats at the end), so a run metered for one part and a run metered for all of them are the same run
// (README "One pass"). Used by the full check's workers (pass.ts) and by the per-matrix scripts run by hand
// (legmx.ts, l4mx.ts, energymx.ts, visiblemx.ts).
import { createHash } from 'node:crypto';
import type { FixtureDef } from '../../src/sim/fixture';
import { allFixtures } from '../../src/sim/fixtures/index';
import { Simulation } from '../../src/sim/simulation';
import { passiveEnergyMeter } from '../../tests/passive-energy';
import { shapeQueryCounter } from '../../tests/runs';
import { idleBaseline, VisibleMeter, type IdleBaseline } from '../../tests/visible';
import { traceFileOf } from '../fixture-runner';
import { ENERGY_FAMILIES, familyOf, LEG_REGIONS, round } from './lib';

/** The parts of the full check a run can feed. `queries` comes with `legmx` (the leg matrix's runs). */
export const PARTS = ['fixtures', 'legmx', 'l4mx', 'energymx', 'visiblemx'] as const;
export type Part = (typeof PARTS)[number];

/** The parts the run of `d` in one order feeds: the export forward only; each matrix both orders of its fixtures. */
export function partsOf(d: FixtureDef, rev: boolean): Part[] {
  const out: Part[] = [];
  if (!rev) out.push('fixtures');
  if (d.legGuard) out.push('legmx');
  if (d.fallResponse) out.push('l4mx');
  if (d.ragdoll && ENERGY_FAMILIES.includes(familyOf(d.id))) out.push('energymx', 'visiblemx');
  return out;
}

/** What one run gives each part it fed (JSON lines without their newline; `k` the registry index, for the merge). */
export interface PassRows {
  fixtures?: { summary: Record<string, unknown>; sha256: string };
  legmx?: string;
  queries?: string;
  l4mx?: string;
  energymx?: string;
  visiblemx?: string;
}

/** Process-wide state of the runs: the shape-query counter (installed once) and the idle baseline (computed once). */
export interface PassContext {
  q: ReturnType<typeof shapeQueryCounter> | null;
  base: IdleBaseline | null;
}
export function passContext(): PassContext {
  return { q: null, base: null };
}

interface Peak {
  ns: number;
  at: number | null;
}
const bump = (p: Peak, ns: number, t: number): void => {
  if (ns > p.ns) Object.assign(p, { ns, at: t });
};
const byId = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * The leg matrix's sample (after every substep): the largest one-substep player-player contact impulse on each player
 * and its leg colliders, and the leg ledger (a later rung's feature) per substep.
 */
function legSampler(): { sample: (s: Simulation) => void; row: (sim: Simulation, k: number, d: FixtureDef, rev: boolean) => string } {
  const contact = new Map<string, { all: Peak; leg: Peak }>();
  const led = new Map<string, { last: number; peak: Peak; ungrounded: number }>();
  let hasLedger = false;
  const sample = (s: Simulation): void => {
    const S = s as unknown as { legLedger?: unknown };
    // contact records of this substep's solve: player-player manifolds, summed per player (and its leg colliders)
    const tot = new Map<string, number>();
    const leg = new Map<string, number>();
    for (const c of s.contacts) {
      const pa = c.a.playerId;
      const pb = c.b.playerId;
      if (!pa || !pb || pa === pb) continue;
      for (const side of [c.a, c.b]) {
        const id = side.playerId!;
        tot.set(id, (tot.get(id) ?? 0) + c.impulse);
        if (LEG_REGIONS.has(side.region)) leg.set(id, (leg.get(id) ?? 0) + c.impulse);
      }
    }
    for (const p of s.players) {
      const o = contact.get(p.id) ?? { all: { ns: 0, at: null }, leg: { ns: 0, at: null } };
      contact.set(p.id, o);
      bump(o.all, tot.get(p.id) ?? 0, s.t);
      bump(o.leg, leg.get(p.id) ?? 0, s.t);
    }
    // the leg ledger (a later rung's feature): impulse added in this substep, per player
    if (!(S.legLedger instanceof Map)) return;
    hasLedger = true;
    for (const [id, L] of S.legLedger as Map<string, { impulseNs?: number }>) {
      const o = led.get(id) ?? { last: 0, peak: { ns: 0, at: null }, ungrounded: 0 };
      led.set(id, o);
      const now = L.impulseNs ?? 0;
      const j = now - o.last;
      o.last = now;
      bump(o.peak, j, s.t);
      if (j > 0 && !s.players.find((p) => p.id === id)?.grounded) o.ungrounded++;
    }
  };
  const row = (sim: Simulation, k: number, d: FixtureDef, rev: boolean): string => {
    const S = sim as unknown as { legLedger?: Map<string, Record<string, unknown>> };
    const num = (x: unknown): number | string | null => (typeof x === 'number' ? round(x) : null);
    const pl: Record<string, unknown> = {};
    for (const p of byId(sim.players)) {
      const c = contact.get(p.id);
      const L = hasLedger ? S.legLedger!.get(p.id) : undefined;
      const o = led.get(p.id);
      pl[p.id] = {
        conv: p.handoff ? round(p.handoff.t) : null,
        mode: p.controlMode,
        contactPeakNs: round(c?.all.ns ?? 0),
        contactPeakAt: c?.all.at == null ? null : round(c.all.at),
        legContactPeakNs: round(c?.leg.ns ?? 0),
        legContactPeakAt: c?.leg.at == null ? null : round(c.leg.at),
        ledger: !hasLedger
          ? 'absent'
          : {
              peakNs: round(o?.peak.ns ?? 0),
              at: o?.peak.at == null ? null : round(o.peak.at),
              ungrounded: o?.ungrounded ?? 0,
              J: num(L?.impulseNs),
              sub: num(L?.substeps),
              injJ: num(L?.injectedJ),
              depth: num(L?.maxDepthM),
            },
      };
    }
    return JSON.stringify({ k, id: d.id, rev, legGuard: d.legGuard?.id ?? null, result: sim.result, pl });
  };
  return { sample, row };
}

/** The L4 matrix's stats: scalars, nested records flattened (`peakNm.knee`), keys sorted. */
function flat(o: Record<string, unknown>, pre = '', into: Record<string, unknown> = {}): Record<string, unknown> {
  for (const key of Object.keys(o).sort()) {
    const v = o[key];
    if (typeof v === 'number') into[pre + key] = round(v);
    else if (typeof v === 'boolean' || typeof v === 'string' || v === null) into[pre + key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flat(v as Record<string, unknown>, `${pre}${key}.`, into);
  }
  return into;
}

/**
 * Run `d` (registry index `k`) in one order to its end with the meters of `parts` attached and return each part's row.
 * Throws what the run throws. With `legmx` the shape queries of each tick are counted (the visible meter's own shape
 * queries, between ticks, are not).
 */
export async function runPass(ctx: PassContext, k: number, d: FixtureDef, rev: boolean, parts: ReadonlySet<Part>): Promise<PassRows> {
  const leg = parts.has('legmx') ? legSampler() : null;
  if (leg && !ctx.q) ctx.q = shapeQueryCounter();
  if (parts.has('visiblemx') && !ctx.base) {
    const idle = allFixtures().find((f) => f.id === 'L3-F13-free');
    if (!idle) throw new Error('visiblemx: the idle baseline fixture L3-F13-free is gone');
    ctx.base = await idleBaseline(idle);
  }
  const sim = await Simulation.create(d, { ...(rev ? { reverseOrder: true } : {}), ...(leg ? { onSubstep: leg.sample } : {}) });
  try {
    const energy = parts.has('energymx') ? passiveEnergyMeter(sim) : null;
    const vis = parts.has('visiblemx') ? new VisibleMeter(sim, ctx.base!) : null;
    const q = leg ? ctx.q : null;
    // the build's queries are not a tick's
    q?.take();
    let worst = { n: 0, t: 0 };
    while (!sim.done) {
      sim.stepTick();
      if (q) {
        const nq = q.take();
        if (nq > worst.n) worst = { n: nq, t: sim.t };
      }
      if (vis) {
        vis.frame();
        q?.take();
      }
    }
    energy?.restore();
    const out: PassRows = {};
    if (parts.has('fixtures')) {
      const s = sim.summary();
      out.fixtures = { summary: s, sha256: createHash('sha256').update(traceFileOf(sim, s)).digest('hex') };
    }
    if (leg) {
      out.queries = JSON.stringify({ k, id: d.id, rev, worstTickQueries: worst.n, at: round(worst.t) });
      out.legmx = leg.row(sim, k, d, rev);
    }
    if (parts.has('l4mx')) {
      const pl: Record<string, unknown> = {};
      for (const p of byId(sim.players))
        pl[p.id] = { conv: p.handoff ? round(p.handoff.t) : null, mode: p.controlMode, fall: p.fall ? flat(p.fall.stats as unknown as Record<string, unknown>) : null };
      out.l4mx = JSON.stringify({ k, id: d.id, rev, result: sim.result, pl });
    }
    if (energy) {
      const pl: Record<string, unknown> = {};
      for (const [id, r] of [...energy.runs()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        pl[id] = {
          solves: r.solves,
          injecting: r.injecting,
          injectedJ: round(r.injectedJ, 3),
          maxJ: round(r.maxJ, 3),
          maxStep: r.maxStep,
          maxAt: r.maxAt == null ? null : round(r.maxAt),
          maxPinch: r.maxPinch?.join(',') || null,
          quietMaxJ: round(r.quietMaxJ, 3),
          over: r.over.map((o) => [o.step, round(o.J, 3), o.pinch.join(',') || null, round(o.priorLossJ, 3), o.contact ? 1 : 0]),
        };
      out.energymx = JSON.stringify({ k, id: d.id, rev, pl });
    }
    if (vis) out.visiblemx = JSON.stringify({ k, id: d.id, rev, ...vis.finish() });
    return out;
  } finally {
    sim.dispose();
  }
}

/**
 * A per-matrix script run by hand (legmx.ts, ...): shard i of n of the registry, the fixtures `part` covers (limited by
 * ONLY=<regex>), both orders, one JSON line per row to `out` (and the shape queries to `<out>.q` for the leg matrix).
 * `variant` replaces a fixture's definition (the leg matrix's LEGV2).
 */
export async function runMatrix(part: Exclude<Part, 'fixtures'>, i: number, n: number, variant: (d: FixtureDef) => FixtureDef = (d) => d): Promise<{ lines: string[]; queries: string[] }> {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const ctx = passContext();
  const all = allFixtures();
  const lines: string[] = [];
  const queries: string[] = [];
  for (let k = 0; k < all.length; k++) {
    if (!partsOf(all[k], true).includes(part) || k % n !== i || (only && !only.test(all[k].id))) continue;
    const d = variant(all[k]);
    for (const rev of [false, true]) {
      const r = await runPass(ctx, k, d, rev, new Set([part]));
      lines.push(r[part]!);
      if (r.queries) queries.push(r.queries);
    }
  }
  ctx.q?.restore();
  return { lines, queries };
}
