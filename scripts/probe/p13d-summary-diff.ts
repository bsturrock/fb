// Plan 13d evidence: compare the exported summaries and rule endings with a base commit. Lists, by milestone, the
// changed summaries (by id) and the count of identical ones; every result change; every end-time change; every rule-ending kind or ball-spot change
// (read from the `ruleEnding` events of the new traces and of traces exported at the base into another directory).
// Usage: npx vite-node scripts/probe/p13d-summary-diff.ts <base summary.json> <base traces dir> [new summary] [new traces]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Sum = { fixtureId: string; result: string; t: number };
const [baseSum, baseTr, newSum = 'evidence/summary.json', newTr = 'evidence/traces'] = process.argv.slice(2);
if (!baseSum || !baseTr) throw new Error('usage: p13d-summary-diff.ts <base summary.json> <base traces dir> [new summary] [new traces]');
const A = new Map((JSON.parse(readFileSync(baseSum, 'utf8')) as Sum[]).map((s) => [s.fixtureId, s]));
const B = new Map((JSON.parse(readFileSync(newSum, 'utf8')) as Sum[]).map((s) => [s.fixtureId, s]));
const ending = (dir: string, id: string): { kind: string; spot: number[] } | null => {
  const f = join(dir, `${id}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8')) as { events: { type: string; data?: { kind: string; ballSpot: number[] } }[] };
  const e = j.events.find((x) => x.type === 'ruleEnding');
  return e?.data ? { kind: e.data.kind, spot: e.data.ballSpot } : null;
};
const ms = (id: string): string => id.split('-')[0]!;
const by: Record<string, { changed: string[]; same: number }> = {};
const results: string[] = [];
const times: string[] = [];
const endings: string[] = [];
const missing = [...A.keys()].filter((k) => !B.has(k)).concat([...B.keys()].filter((k) => !A.has(k)));
for (const [id, b] of B) {
  const a = A.get(id);
  if (!a) continue;
  const m = (by[ms(id)] ??= { changed: [], same: 0 });
  if (JSON.stringify(a) === JSON.stringify(b)) {
    m.same++;
    continue;
  }
  m.changed.push(id);
  if (a.result !== b.result) results.push(`${id}: ${a.result} -> ${b.result}`);
  if (a.t !== b.t) times.push(`${id}: ${a.t} -> ${b.t} (${b.t > a.t ? '+' : ''}${Math.round((b.t - a.t) * 1000)} ms)`);
  const ea = ending(baseTr, id);
  const eb = ending(newTr, id);
  if (JSON.stringify(ea) !== JSON.stringify(eb)) endings.push(`${id}: ${ea ? `${ea.kind} @ ${ea.spot.join(',')}` : 'none'} -> ${eb ? `${eb.kind} @ ${eb.spot.join(',')}` : 'none'}`);
}
console.log(`fixtures: base ${A.size}, new ${B.size}; only in one: ${missing.join(', ') || 'none'}`);
for (const [k, v] of Object.entries(by).sort()) console.log(`${k}: ${v.changed.length} changed, ${v.same} identical${v.changed.length ? `: ${v.changed.join(', ')}` : ''}`);
console.log(`\nresult changes (${results.length}):\n  ${results.join('\n  ') || 'none'}`);
console.log(`\nend time changes (${times.length}):\n  ${times.join('\n  ') || 'none'}`);
console.log(`\nrule ending kind or ball spot changes (${endings.length}):\n  ${endings.join('\n  ') || 'none'}`);
