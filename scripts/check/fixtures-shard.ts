// Full check worker: the fixture export (scripts/fixture-runner.ts, the code `npm run fixtures` runs) for shard i of n
// of the registry, into a scratch evidence directory. Writes {rows: [{k, id, summary}], traces: [{k, id, sha256}],
// threw: [{id, message}]} to the output file and deletes its scratch traces (only their hashes are kept).
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allFixtures } from '../../src/sim/fixtures/index';
import { runFixtures } from '../fixture-runner';
import { shardArgs } from './lib';

const { i, n, out } = shardArgs();
const all = allFixtures();
const index = new Map(all.map((d, k) => [d.id, k]));
const defs = all.filter((_, k) => k % n === i);
const dir = `${out}.evidence`;
rmSync(dir, { recursive: true, force: true });
const r = await runFixtures({ defs, evidenceDir: dir, log: () => {} });
const rows = r.summaries.map((s) => ({ k: index.get(String(s.fixtureId))!, id: String(s.fixtureId), summary: s }));
const traces = rows.map(({ k, id }) => ({ k, id, sha256: createHash('sha256').update(readFileSync(join(dir, 'traces', `${id}.json`))).digest('hex') }));
const threw = r.failed.map((f) => ({ id: f.id, message: (f.error instanceof Error ? f.error.message : String(f.error)).split('\n')[0] }));
rmSync(dir, { recursive: true, force: true });
writeFileSync(out, JSON.stringify({ rows, traces, threw }));
