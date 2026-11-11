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

/** Families the passive-energy matrix covers (every fixture of them with a ragdoll profile; scripts/check/energymx.ts). */
export const ENERGY_FAMILIES = ['L3', 'L4', 'HC'];

/** A visible-matrix row's worst event of a column: player, what, peak, peak time, start, end, severity (tests/visible.ts). */
export type VisWorst = [string, string, number, number, number, number, number];
/** A visible-matrix row (scripts/check/visiblemx.ts; tests/visible.ts `VisibleRun`), as far as the headlines read it. */
export interface VisRow {
  id: string;
  rev: boolean;
  ragS: number;
  supS: number;
  rag: { imp: Record<string, number>; impl: Record<string, number>; selfAx: Record<string, number>; selfDeep: Record<string, number>; self: Record<string, number>; snap60: number; kneeStop: number };
  sup: { imp: Record<string, number>; impl: Record<string, number>; selfAx: Record<string, number>; snap60: number };
  cross: { supSup: number; supRag: number; ragRag: number };
  worst: Record<string, VisWorst>;
}

/** The visible matrix's headline columns (scripts/check/README.md): player-seconds (pair-seconds for crossLeg), snaps in joint-frames. */
export const VIS_COLUMNS = ['ragS', 'supS', 'ragImpS', 'ragImplS', 'supImpS', 'ragSelfLegAxS', 'ragSelfDeepS', 'supSelfLegAxS', 'crossLegSupSupS', 'crossLegSupRagS', 'crossLegRagRagS', 'ragSnap60', 'supSnap60', 'kneeStopS'] as const;
export type VisColumn = (typeof VIS_COLUMNS)[number];

export function visibleColumns(r: VisRow): Record<VisColumn, number> {
  const sum = (o: Record<string, number>): number => Number(Object.values(o).reduce((a, b) => a + b, 0).toFixed(3));
  return {
    ragS: r.ragS,
    supS: r.supS,
    ragImpS: sum(r.rag.imp),
    ragImplS: sum(r.rag.impl),
    supImpS: sum(r.sup.imp),
    ragSelfLegAxS: sum(r.rag.selfAx),
    ragSelfDeepS: sum(r.rag.selfDeep),
    supSelfLegAxS: sum(r.sup.selfAx),
    crossLegSupSupS: r.cross.supSup,
    crossLegSupRagS: r.cross.supRag,
    crossLegRagRagS: r.cross.ragRag,
    ragSnap60: r.rag.snap60,
    supSnap60: r.sup.snap60,
    kneeStopS: r.rag.kneeStop,
  };
}

/** The visible matrix's headline per family: every column summed over the family's rows (2 decimals). */
export function visibleHeadline(rows: VisRow[]): Record<string, Record<VisColumn, number>> {
  const out: Record<string, Record<VisColumn, number>> = {};
  for (const r of rows) {
    const f = (out[familyOf(r.id)] ??= Object.fromEntries(VIS_COLUMNS.map((c) => [c, 0])) as Record<VisColumn, number>);
    const c = visibleColumns(r);
    for (const k of VIS_COLUMNS) f[k] = Number((f[k] + c[k]).toFixed(3));
  }
  for (const f of Object.values(out)) for (const k of VIS_COLUMNS) f[k] = Number(f[k].toFixed(2));
  return out;
}

/** Lab link to watch a visible event: 0.15 s before its peak, the side camera for sagittal joints and leg-trunk overlap. */
export function visLabUrl(id: string, rev: boolean, what: string, peakT: number): string {
  const side = /flexion|extension|fold|flexExt|legTrunk|legFold/.test(what) && !/abduction|adduction|rotation/.test(what);
  return `?fixture=${id}${rev ? '&order=rev' : ''}&cam=${side ? 'side' : 'front'}&speed=0.25&t=${Math.max(0, peakT - 0.15).toFixed(2)}`;
}

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
