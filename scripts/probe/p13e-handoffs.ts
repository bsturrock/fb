// Plan 13e evidence: every ragdoll handoff of two trace exports, compared fixture by fixture: accepted conversions
// (`representation` to ragdoll), rejections (`handoffRejected`, with reasons and the worst new external penetration)
// and audit failures. Prints each fixture whose handoffs differ and the newly rejected ones (for the user's ruling).
// Usage: npx vite-node scripts/probe/p13e-handoffs.ts <base traces dir> [new traces dir]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Ev = { type: string; t: number; playerId?: string; data?: Record<string, unknown> };
const [baseDir, newDir = 'evidence/traces'] = process.argv.slice(2);
if (!baseDir) throw new Error('usage: p13e-handoffs.ts <base traces dir> [new traces dir]');
const scan = (dir: string): Map<string, { acc: string[]; rej: string[]; fail: string[] }> => {
  const out = new Map<string, { acc: string[]; rej: string[]; fail: string[] }>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { fixture: { fixtureId: string }; events: Ev[] };
    const r = { acc: [] as string[], rej: [] as string[], fail: [] as string[] };
    for (const e of j.events) {
      if (e.type === 'representation' && e.data?.to === 'ragdoll') r.acc.push(`${e.playerId}@${e.t.toFixed(3)}`);
      if (e.type === 'handoffRejected') r.rej.push(`${e.playerId}@${e.t.toFixed(3)} ${e.data?.reasons} pen ${e.data?.maxNewExternalPenetrationM}`);
      if (e.type === 'handoffAuditFailure') r.fail.push(`${e.playerId}@${e.t.toFixed(3)} ${e.data?.reasons}`);
    }
    out.set(j.fixture.fixtureId, r);
  }
  return out;
};
const A = scan(baseDir);
const B = scan(newDir);
const fmt = (r?: { acc: string[]; rej: string[]; fail: string[] }): string => (r ? `accepted [${r.acc.join(', ')}] rejected [${r.rej.join('; ')}] auditFailures [${r.fail.join('; ')}]` : 'absent');
let changed = 0;
const newly: string[] = [];
const gone: string[] = [];
for (const id of [...new Set([...A.keys(), ...B.keys()])].sort()) {
  const a = A.get(id);
  const b = B.get(id);
  const players = (x?: { rej: string[] }): Set<string> => new Set((x?.rej ?? []).map((s) => s.split('@')[0]!));
  if (JSON.stringify(a) === JSON.stringify(b)) continue;
  // the same handoffs at the same players with only times or penetrations moved still print, as changes
  changed++;
  console.log(`${id}:\n  base ${fmt(a)}\n  new  ${fmt(b)}`);
  for (const p of players(b)) if (!players(a).has(p)) newly.push(`${id} ${p}`);
  for (const p of players(a)) if (!players(b).has(p)) gone.push(`${id} ${p}`);
}
console.log(`\n${changed} fixtures with changed handoffs`);
console.log(`newly rejected (${newly.length}): ${newly.join(', ') || 'none'}`);
console.log(`no longer rejected (${gone.length}): ${gone.join(', ') || 'none'}`);
