// Compare two full-check result directories (scripts/check/README.md):
//   npx vite-node scripts/check/compare.ts <before dir> <after dir>
// Prints a compact report. Exits 1 only on the hard invariants: a new suite failure (by message), or a changed G, L1, L2
// or RH fixture summary. Everything else is reported for judgement. Env COMPARE_MAX: lines listed per section (default 60).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENERGY_FAMILIES, familyOf, FAMILIES, FROZEN_FAMILIES, SHAPE_QUERY_BUDGET } from './lib';
import { INJECTION_J } from '../../tests/passive-energy';

const [A, B] = [process.argv[2], process.argv[3]].map((p) => (p ? resolve(p) : ''));
if (!A || !B) {
  console.error('usage: npx vite-node scripts/check/compare.ts <before dir> <after dir>');
  process.exit(2);
}
const MAX = Number(process.env.COMPARE_MAX ?? 60);
const out: string[] = [];
const say = (s = ''): void => void out.push(s);
const list = (items: string[], indent = '  '): void => {
  for (const s of items.slice(0, MAX)) say(indent + s);
  if (items.length > MAX) say(`${indent}... ${items.length - MAX} more (COMPARE_MAX)`);
};
const hard: string[] = [];
const read = (dir: string, f: string): string | null => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
const readJson = <T>(dir: string, f: string): T | null => {
  const s = read(dir, f);
  return s == null ? null : (JSON.parse(s) as T);
};

const ma = readJson<{ head: string; dirtyFiles: number }>(A, 'meta.json');
const mb = readJson<{ head: string; dirtyFiles: number }>(B, 'meta.json');
say(`A ${A}  (${ma?.head?.slice(0, 7) ?? '?'}${ma?.dirtyFiles ? `, ${ma.dirtyFiles} dirty` : ''})`);
say(`B ${B}  (${mb?.head?.slice(0, 7) ?? '?'}${mb?.dirtyFiles ? `, ${mb.dirtyFiles} dirty` : ''})`);
const files = ['status.json', 'suite.json', 'summary.json', 'traces.sha256', 'legmx.jsonl', 'l4mx.jsonl', 'queries.jsonl', 'energymx.jsonl'];
const same = files.filter((f) => read(A, f) != null && read(A, f) === read(B, f));
say(`files byte-identical: ${same.length}/${files.length}${same.length < files.length ? ` (differ or missing: ${files.filter((f) => !same.includes(f)).join(', ')})` : ''}`);

// ------------------------------------------------------------------------------------------------ status
const sa = readJson<Record<string, unknown>>(A, 'status.json') ?? {};
const sb = readJson<Record<string, unknown>>(B, 'status.json') ?? {};
for (const k of ['typecheck', 'build']) {
  const [x, y] = [JSON.stringify(sa[k]), JSON.stringify(sb[k])];
  const okB = (sb[k] as { ok?: boolean } | undefined)?.ok;
  say(`${k}: ${x === y ? y : `${x} -> ${y}`}${okB === false ? '  WARN: fails in B' : ''}`);
}
if (JSON.stringify(sb.shardsFailed ?? []) !== '[]') say(`WARN: B shards failed: ${JSON.stringify(sb.shardsFailed)}`);

// ------------------------------------------------------------------------------------------------ suite
interface Failure {
  file: string;
  name: string;
  kind: string;
  message: string;
  detail: string;
}
interface Suite {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: Failure[];
}
const ua = readJson<Suite>(A, 'suite.json');
const ub = readJson<Suite>(B, 'suite.json');
say();
if (!ua || !ub) say(`suite: ${!ua ? 'A' : 'B'} has no suite.json (skipped)`);
else {
  say(`suite: A ${ua.passed}/${ua.total} passed, ${ua.failed} failed | B ${ub.passed}/${ub.total} passed, ${ub.failed} failed`);
  // failures are matched by message (kind + first line), not by test name; what is left is matched by name
  const key = (f: Failure): string => `${f.kind}|${f.message}`;
  const pool = new Map<string, Failure[]>();
  for (const f of ua.failures) pool.set(key(f), [...(pool.get(key(f)) ?? []), f]);
  const unmatched: Failure[] = [];
  const detail: string[] = [];
  for (const f of ub.failures) {
    const m = pool.get(key(f));
    if (m?.length) {
      const a = m.findIndex((x) => x.name === f.name);
      const [was] = m.splice(a < 0 ? 0 : a, 1);
      if (was.detail !== f.detail) detail.push(`${f.name} :: ${f.message}`);
    } else unmatched.push(f);
  }
  const leftA = [...pool.values()].flat();
  const changed: string[] = [];
  const added: string[] = [];
  for (const f of unmatched) {
    const i = leftA.findIndex((x) => x.name === f.name);
    if (i >= 0) {
      changed.push(`${f.kind} ${f.name}\n      was: ${leftA[i].message}\n      now: ${f.message}`);
      leftA.splice(i, 1);
    } else added.push(`${f.kind} ${f.file} > ${f.name}\n      ${f.message}`);
  }
  if (added.length) {
    say(`  ADDED failures (hard): ${added.length}`);
    list(added, '    ');
    hard.push(`${added.length} new suite failure(s)`);
  }
  if (changed.length) {
    say(`  changed message: ${changed.length}`);
    list(changed, '    ');
  }
  if (leftA.length) {
    say(`  removed failures: ${leftA.length}`);
    list(
      leftA.map((f) => `${f.kind} ${f.name} :: ${f.message}`),
      '    ',
    );
  }
  if (detail.length) {
    say(`  same message, detail differs: ${detail.length}`);
    list(detail, '    ');
  }
  if (!added.length && !changed.length && !leftA.length && !detail.length) say('  no failure changes');
}

// ------------------------------------------------------------------------------------------------ fixtures
type Summary = { fixtureId: string; result: string; players: Record<string, { rep?: string }> };
const fa = readJson<Summary[]>(A, 'summary.json');
const fb = readJson<Summary[]>(B, 'summary.json');
say();
if (!fa || !fb) say(`fixtures: ${!fa ? 'A' : 'B'} has no summary.json (skipped)`);
else {
  const byA = new Map(fa.map((s) => [s.fixtureId, s]));
  const byB = new Map(fb.map((s) => [s.fixtureId, s]));
  const ids = [...new Set([...byA.keys(), ...byB.keys()])];
  const changedIds = ids.filter((id) => JSON.stringify(byA.get(id)) !== JSON.stringify(byB.get(id)));
  const traceMap = (dir: string): Map<string, string> =>
    new Map(
      (read(dir, 'traces.sha256') ?? '')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(/\s+/))
        .map(([h, f]) => [f, h] as [string, string]),
    );
  const ta = traceMap(A);
  const tb = traceMap(B);
  const traceDiff = [...new Set([...ta.keys(), ...tb.keys()])].filter((f) => ta.get(f) !== tb.get(f));
  say(`fixtures: A ${fa.length}, B ${fb.length}; summaries changed ${changedIds.length}; traces changed ${traceDiff.length}${(read(A, 'summary.json') === read(B, 'summary.json')) ? '; summary.json byte-identical' : ''}`);
  const fam = (id: string): string => familyOf(id);
  const row: string[] = [];
  for (const f of FAMILIES) {
    const all = ids.filter((id) => fam(id) === f);
    if (!all.length) continue;
    const ch = changedIds.filter((id) => fam(id) === f);
    const tr = traceDiff.filter((x) => fam(x.replace(/\.json$/, '')) === f);
    row.push(`${f} ${ch.length}/${all.length}${tr.length !== ch.length ? ` (traces ${tr.length})` : ''}`);
  }
  say(`  by family (changed/total): ${row.join(', ')}`);
  const frozen = [...new Set([...changedIds, ...traceDiff.map((x) => x.replace(/\.json$/, ''))])].filter((id) => FROZEN_FAMILIES.includes(fam(id)));
  say(`  G/L1/L2/RH byte-identical: ${frozen.length ? 'FAIL' : 'PASS'}${frozen.length ? ` (${frozen.length}: ${frozen.slice(0, 20).join(', ')}${frozen.length > 20 ? ', ...' : ''})` : ''}`);
  if (frozen.length) hard.push(`${frozen.length} G/L1/L2/RH fixture(s) changed`);
  const res: string[] = [];
  for (const id of changedIds) {
    const a = byA.get(id);
    const b = byB.get(id);
    if (!a || !b) {
      res.push(`${id}: ${a ? 'only in A' : 'only in B'}`);
      continue;
    }
    if (a.result !== b.result) res.push(`${id}: result ${a.result} -> ${b.result}`);
    for (const p of [...new Set([...Object.keys(a.players), ...Object.keys(b.players)])].sort()) {
      const [ra, rb] = [a.players[p]?.rep, b.players[p]?.rep];
      if (ra !== rb) res.push(`${id}: ${p} ends ${ra} -> ${rb}`);
    }
  }
  if (res.length) {
    say(`  result / who-falls changes: ${res.length}`);
    list(res, '    ');
  }
  const other = changedIds.filter((id) => !res.some((r) => r.startsWith(`${id}:`)));
  if (other.length) say(`  changed with the same result and end representations: ${other.length}${other.length <= 30 ? ` (${other.join(', ')})` : ''}`);
}

// ------------------------------------------------------------------------------------------------ matrices
type MxRow = { id: string; rev: boolean; result: string; pl: Record<string, Record<string, unknown>> } & Record<string, unknown>;
// a column a tree does not have yet is the string "absent" (scripts/check/legmx.ts): it flattens to no fields
const flat = (o: unknown, pre = '', into: Record<string, unknown> = {}): Record<string, unknown> => {
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) flat(v, pre ? `${pre}.${k}` : k, into);
  else if (o !== 'absent') into[pre] = o;
  return into;
};
const leaf = (f: string): string => f.split('.').pop()!;
const isOver = (f: string): boolean => /^over/i.test(leaf(f));
const isPeak = (f: string): boolean => /peak|^injJ$|^depth$/i.test(leaf(f)) && !/At$|^at$/.test(leaf(f));
const overVal = (v: unknown): number => (v === true ? 1 : typeof v === 'number' ? v : 0);

function matrix(file: string, label: string): void {
  const load = (dir: string): Map<string, MxRow> | null => {
    const s = read(dir, file);
    if (s == null) return null;
    return new Map(
      s
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as MxRow)
        .map((r) => [`${r.id} ${r.rev ? 'rev' : 'fwd'}`, r]),
    );
  };
  const ra = load(A);
  const rb = load(B);
  say();
  if (!ra || !rb) {
    say(`${label}: ${!ra ? 'A' : 'B'} has no ${file} (skipped)`);
    return;
  }
  const keys = [...new Set([...ra.keys(), ...rb.keys()])];
  const vanished = keys.filter((k) => !rb.has(k));
  const added = keys.filter((k) => !ra.has(k));
  const changedRows = keys.filter((k) => ra.has(k) && rb.has(k) && JSON.stringify(ra.get(k)) !== JSON.stringify(rb.get(k)));
  const overB = [...rb.entries()].flatMap(([k, r]) => Object.entries(r.pl).flatMap(([p, v]) => Object.entries(flat(v)).filter(([f, x]) => isOver(f) && overVal(x) > 0).map(([f, x]) => `${k} ${p} ${f}=${x}`)));
  say(`${label}: rows A ${ra.size}, B ${rb.size}; changed ${changedRows.length}, vanished ${vanished.length}, new ${added.length}; over-ceiling entries in B ${overB.length}`);
  if (vanished.length) {
    say('  rows that vanished:');
    list(vanished, '    ');
  }
  if (added.length) {
    say('  new rows:');
    list(added, '    ');
  }
  const cols = new Map<string, number>();
  const newOver: string[] = [];
  const rises: string[] = [];
  const outcome: string[] = [];
  let statsOnly = 0;
  for (const k of changedRows) {
    const a = ra.get(k)!;
    const b = rb.get(k)!;
    let notable = false;
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (f !== 'pl' && JSON.stringify(a[f]) !== JSON.stringify(b[f])) {
        outcome.push(`${k}: ${f} ${JSON.stringify(a[f])} -> ${JSON.stringify(b[f])}`);
        notable = true;
      }
    for (const p of [...new Set([...Object.keys(a.pl), ...Object.keys(b.pl)])].sort()) {
      const xa = flat(a.pl[p] ?? {});
      const xb = flat(b.pl[p] ?? {});
      for (const f of ['conv', 'mode'])
        if (xa[f] !== xb[f]) {
          outcome.push(`${k} ${p}: ${f} ${xa[f]} -> ${xb[f]}`);
          notable = true;
        }
      for (const f of new Set([...Object.keys(xa), ...Object.keys(xb)])) {
        const [va, vb] = [xa[f], xb[f]];
        if (f in xa !== f in xb) {
          // a column one side has and the other reports absent (or lacks): tallied, not listed per row
          const c = f in xa ? `${f}: present in A, absent in B` : `${f}: absent in A, present in B`;
          cols.set(c, (cols.get(c) ?? 0) + 1);
          continue;
        }
        if (isOver(f) && overVal(vb) > overVal(va)) {
          newOver.push(`${k} ${p} ${f} ${va} -> ${vb}`);
          notable = true;
        } else if (isPeak(f) && typeof va === 'number' && typeof vb === 'number' && vb > va) {
          rises.push(`${k} ${p} ${f} ${va} -> ${vb}`);
          notable = true;
        }
      }
    }
    if (!notable) statsOnly++;
  }
  if (cols.size) {
    say('  columns present on one side only (rows):');
    list(
      [...cols.entries()].map(([c, n]) => `${c} (${n})`),
      '    ',
    );
  }
  if (newOver.length) {
    say(`  NEW over-ceiling (or more over) entries: ${newOver.length}`);
    list(newOver, '    ');
  }
  if (outcome.length) {
    say(`  result / conversion / mode changes: ${outcome.length}`);
    list(outcome, '    ');
  }
  if (rises.length) {
    say(`  peaks that rise: ${rises.length}`);
    list(rises, '    ');
  }
  if (statsOnly) say(`  rows changed in other stats only (or peaks that fell): ${statsOnly}`);
}
matrix('legmx.jsonl', 'leg matrix');
matrix('l4mx.jsonl', 'L4 matrix');

// ------------------------------------------------------------------------------------------------ shape queries
{
  type QRow = { id: string; rev: boolean; worstTickQueries: number; at: number };
  const load = (dir: string): Map<string, QRow> | null => {
    const s = read(dir, 'queries.jsonl');
    return s == null
      ? null
      : new Map(
          s
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as QRow)
            .map((r) => [`${r.id} ${r.rev ? 'rev' : 'fwd'}`, r]),
        );
  };
  const qa = load(A);
  const qb = load(B);
  say();
  if (!qb) say('shape queries: B has no queries.jsonl (skipped)');
  else {
    const over = (m: Map<string, QRow>): [string, QRow][] => [...m.entries()].filter(([, r]) => r.worstTickQueries >= SHAPE_QUERY_BUDGET);
    const ob = over(qb);
    const worst = [...qb.entries()].sort((x, y) => y[1].worstTickQueries - x[1].worstTickQueries)[0];
    say(`shape queries: rows ${qb.size}; worst tick over ${SHAPE_QUERY_BUDGET} in B: ${ob.length}${worst ? ` (highest ${worst[1].worstTickQueries}, ${worst[0]} at ${worst[1].at} s)` : ''}`);
    list(ob.map(([k, r]) => `${k}: ${r.worstTickQueries} at ${r.at} s${qa?.get(k) ? ` (A ${qa.get(k)!.worstTickQueries})` : ''}`), '    ');
    if (!qa) say('  A has no queries.jsonl: no comparison');
    else {
      const rises = [...qb.entries()]
        .filter(([k, r]) => qa.has(k) && r.worstTickQueries > qa.get(k)!.worstTickQueries)
        .sort((x, y) => y[1].worstTickQueries - qa.get(y[0])!.worstTickQueries - (x[1].worstTickQueries - qa.get(x[0])!.worstTickQueries));
      const fell = [...qb.entries()].filter(([k, r]) => qa.has(k) && r.worstTickQueries < qa.get(k)!.worstTickQueries).length;
      const newOver = ob.filter(([k]) => !qa.has(k) || qa.get(k)!.worstTickQueries < SHAPE_QUERY_BUDGET);
      if (newOver.length) {
        say(`  NEW over ${SHAPE_QUERY_BUDGET}: ${newOver.length}`);
        list(newOver.map(([k, r]) => `${k}: ${qa.get(k)?.worstTickQueries ?? '-'} -> ${r.worstTickQueries}`), '    ');
      }
      say(`  worst tick rises: ${rises.length}, falls: ${fell}`);
      list(rises.map(([k, r]) => `${k}: ${qa.get(k)!.worstTickQueries} -> ${r.worstTickQueries}`), '    ');
    }
  }
}

// ------------------------------------------------------------------------------------------------ passive energy
// informational (tests/passive-energy.ts): gains over INJECTION_J in solves no other player touches
{
  type EPl = { solves: number; injecting: number; injectedJ: number; maxJ: number; maxAt: number | null; maxPinch: string | null; quietMaxJ: number };
  type ERow = { id: string; rev: boolean; pl: Record<string, EPl> };
  const load = (dir: string): Map<string, ERow> | null => {
    const s = read(dir, 'energymx.jsonl');
    return s == null
      ? null
      : new Map(
          s
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as ERow)
            .map((r) => [`${r.id} ${r.rev ? 'rev' : 'fwd'}`, r]),
        );
  };
  const ea = load(A);
  const eb = load(B);
  say();
  if (!eb) say('passive energy: B has no energymx.jsonl (skipped)');
  else {
    const head = (m: Map<string, ERow>, f: string): string => {
      let runs = 0, inj = 0, solves = 0, J = 0, max = 0;
      for (const r of m.values())
        if (familyOf(r.id) === f)
          for (const p of Object.values(r.pl)) {
            runs++;
            if (p.injecting) inj++;
            solves += p.injecting;
            J += p.injectedJ;
            max = Math.max(max, p.maxJ);
          }
      return `${J.toFixed(1)} J in ${solves} solves (${inj}/${runs} runs; largest ${max.toFixed(2)} J)`;
    };
    say(`passive energy (solves gaining > ${INJECTION_J} J with no other player touching): rows ${ea ? `A ${ea.size}, ` : ''}B ${eb.size}`);
    for (const f of ENERGY_FAMILIES) say(`  ${f}: ${ea ? `${head(ea, f)} -> ` : ''}${head(eb, f)}`);
    if (!ea) say('  A has no energymx.jsonl: no comparison');
    else {
      const rose: string[] = [];
      const fresh: string[] = [];
      for (const [k, b] of eb)
        for (const [p, x] of Object.entries(b.pl)) {
          const y = ea.get(k)?.pl[p];
          const where = `${k} ${p}: ${y ? `${y.maxJ} J at ${y.maxAt}` : '-'} -> ${x.maxJ} J at ${x.maxAt}${x.maxPinch ? ` (pinch ${x.maxPinch})` : ''}`;
          if (x.injecting > 0 && !y?.injecting) fresh.push(`${where}, ${x.injecting} solves ${x.injectedJ} J`);
          else if (x.maxJ > INJECTION_J && x.maxJ > (y?.maxJ ?? 0) + 0.01) rose.push(where);
        }
      if (fresh.length) {
        say(`  NEW runs injecting: ${fresh.length}`);
        list(fresh, '    ');
      }
      if (rose.length) {
        say(`  largest gain rose (over ${INJECTION_J} J): ${rose.length}`);
        list(rose, '    ');
      }
      if (!fresh.length && !rose.length) say('  no new injecting run, no largest gain rose');
    }
  }
}

say();
say(hard.length ? `HARD INVARIANTS: FAIL (${hard.join('; ')})` : 'HARD INVARIANTS: PASS (no new suite failure; G/L1/L2/RH byte-identical)');
console.log(out.join('\n'));
process.exit(hard.length ? 1 : 0);
