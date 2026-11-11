// Shared helpers of the full check (scripts/check/README.md).

/** Fixture families of the ladder's rules: G (G1-G4), L1, L2, RH, L3, L4, HC; anything else is `other`. */
export const FAMILIES = ['G', 'L1', 'L2', 'RH', 'L3', 'L4', 'HC', 'other'] as const;
/** Families whose summaries must stay byte-identical on every rung (the ladder's rule 5). */
export const FROZEN_FAMILIES = ['G', 'L1', 'L2', 'RH'];

export function familyOf(id: string): string {
  const p = id.split('-')[0];
  if (/^G\d+$/.test(p)) return 'G';
  return (FAMILIES as readonly string[]).includes(p) ? p : 'other';
}

/** A number for a compared file: fixed decimals, no -0, non-finite kept visible as a string. */
export function round(x: number, d = 4): number | string {
  if (!Number.isFinite(x)) return String(x);
  const r = Number(x.toFixed(d));
  return r === 0 ? 0 : r;
}

/**
 * Plan 13a's shape-query budget: Rapier shape queries one tick may ask (tests/harness.test.ts checks it on a representative
 * set; the full check counts every leg-matrix run, `queries.jsonl`).
 */
export const SHAPE_QUERY_BUDGET = 4000;

/** Ragdoll and physical-leg collider regions counted as legs. */
export const LEG_REGIONS = new Set(['thigh', 'shin', 'shoe']);

/** Shard arguments of a matrix or export worker: shard `i` of `n`, output file. */
export function shardArgs(): { i: number; n: number; out: string } {
  const i = Number(process.argv[2] ?? 0);
  const n = Number(process.argv[3] ?? 1);
  const out = process.argv[4];
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n || !out) {
    console.error(`usage: <shard i> <shards n> <output file> (got ${process.argv.slice(2).join(' ')})`);
    process.exit(2);
  }
  return { i, n, out };
}
