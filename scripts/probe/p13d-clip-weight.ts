// Plan 13d acceptance probe: on every exported fixture with a run-clip profile, a supported player travelling between
// 2.2 and 6.6 m/s plays Fast Run at clip weight 1 once the weight has settled (0.2 s at weightRatePerS 5). Rows whose
// weight target is below 1 (a heading fade, contact mode, loss of support) are reported, not failed; so are rows at weight 1
// still blending in from the walk (L3's walk-to-run crossing at blendRatePerS, plan 08). Reads the traces
// `npm run fixtures` writes to evidence/traces/.
// Usage: npx vite-node scripts/probe/p13d-clip-weight.ts [traceDir]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = { t: number; players: Record<string, { mode?: string; g?: number; loco?: { m: string }; run?: { clip: string; w: number; wt: number; v: number } }> };
const dir = process.argv[2] ?? 'evidence/traces';
const BAND: [number, number] = [2.2, 6.6];
const SETTLE_S = 0.2;

let fixtures = 0;
let rows = 0;
const bad: string[] = [];
const fades: Record<string, number> = {};
const walkBlend: Record<string, number> = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { fixture: { fixtureId: string }; trace: Row[] };
  const trace = j.trace;
  if (!trace.some((r) => Object.values(r.players).some((p) => p.run))) continue;
  fixtures++;
  const ids = Object.keys(trace[0]?.players ?? {});
  for (const id of ids) {
    let since = -Infinity; // time the player entered the band, supported
    let wtSince = -Infinity; // time the weight target became 1 (inside the band)
    for (const r of trace) {
      const p = r.players[id];
      const run = p?.run;
      const eligible = !!run && p.mode === 'supported' && p.loco?.m !== 'contact' && run.v >= BAND[0] && run.v <= BAND[1];
      if (!eligible) {
        since = wtSince = -Infinity;
        continue;
      }
      if (since === -Infinity) since = r.t;
      if (run!.wt < 1) {
        wtSince = -Infinity;
        if (r.t - since >= SETTLE_S) fades[j.fixture.fixtureId] = (fades[j.fixture.fixtureId] ?? 0) + 1;
        continue;
      }
      if (wtSince === -Infinity) wtSince = r.t;
      if (r.t - since < SETTLE_S || r.t - wtSince < SETTLE_S) continue;
      rows++;
      if (run!.w === 1 && run!.clip === 'walk+fast-run') walkBlend[j.fixture.fixtureId] = (walkBlend[j.fixture.fixtureId] ?? 0) + 1;
      else if (run!.w !== 1 || run!.clip !== 'fast-run') bad.push(`${j.fixture.fixtureId} ${id} ${r.t.toFixed(4)} v ${run!.v} w ${run!.w} clip ${run!.clip}`);
    }
  }
}
console.log(`${fixtures} fixtures with run clips; ${rows} settled rows in ${BAND[0]}-${BAND[1]} m/s; ${bad.length} not on Fast Run at weight 1`);
for (const b of bad.slice(0, 40)) console.log(`  ${b}`);
const wk = Object.keys(walkBlend);
console.log(`at weight 1, still blending in from the walk, rows by fixture: ${wk.length ? wk.map((k) => `${k} ${walkBlend[k]}`).join(', ') : 'none'}`);
const fk = Object.keys(fades);
console.log(`weight target below 1 while settled in the band (heading fade or similar), rows by fixture: ${fk.length ? fk.map((k) => `${k} ${fades[k]}`).join(', ') : 'none'}`);
process.exitCode = bad.length ? 1 : 0;
