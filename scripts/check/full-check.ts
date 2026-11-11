// The full check (scripts/check/README.md): typecheck, build, the test suite, the fixture export, the leg matrix and the
// L4 matrix of the current tree, written into one result directory.
//   npx vite-node scripts/check/full-check.ts <result dir>
// Env: CHECK_JOBS (parallel workers after the suite, default 6), CHECK_SKIP (comma list of
// typecheck,build,suite,fixtures,legmx,l4mx; a skipped part is recorded as skipped).
// The leg matrix's runs also write the shape-query budget (queries.jsonl).
// The suite runs first and alone (no competing load, so no induced timeouts); the export and matrix shards then run in a
// bounded pool. Every compared file is deterministic: no timestamps, stable order. Timings go to meta.json and logs/.
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outArg = process.argv[2];
if (!outArg) {
  console.error('usage: npx vite-node scripts/check/full-check.ts <result dir>');
  process.exit(2);
}
const OUT = resolve(outArg);
const WORK = join(OUT, '.work');
const LOGS = join(OUT, 'logs');
const JOBS = Math.max(1, Number(process.env.CHECK_JOBS ?? 6));
const SKIP = new Set((process.env.CHECK_SKIP ?? '').split(',').filter(Boolean));
const SHARDS = { fixtures: 8, legmx: 8, l4mx: 4 };
const VITE_NODE = join(ROOT, 'node_modules/vite-node/vite-node.mjs');

rmSync(WORK, { recursive: true, force: true });
rmSync(LOGS, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(LOGS, { recursive: true });

const git = (...a: string[]): string => {
  try {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const meta: Record<string, unknown> = {
  root: ROOT,
  head: git('rev-parse', 'HEAD'),
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  dirtyFiles: git('status', '--porcelain').split('\n').filter(Boolean).length,
  startedAt: new Date().toISOString(),
  jobs: JOBS,
  shards: SHARDS,
  skipped: [...SKIP],
  node: process.version,
  ms: {} as Record<string, number>,
};
const ms = meta.ms as Record<string, number>;

/** Run a command with its output in logs/<log>.log; resolves to its exit code. */
function run(log: string, cmd: string, args: string[], env: Record<string, string> = {}): Promise<number> {
  const fd = openSync(join(LOGS, `${log}.log`), 'w');
  const t0 = Date.now();
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, ...env } });
    p.on('close', (code) => {
      closeSync(fd);
      ms[log] = Date.now() - t0;
      res(code ?? 1);
    });
  });
}
const node = (log: string, script: string, args: string[]): Promise<number> => run(log, process.execPath, [VITE_NODE, script, ...args]);

async function pool(tasks: (() => Promise<void>)[], n: number): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]();
    }),
  );
}

const write = (name: string, body: string): void => writeFileSync(join(OUT, name), body);
const json = (v: unknown): string => JSON.stringify(v, null, 1) + '\n';
const status: Record<string, unknown> = {};
const t0 = Date.now();

// 1. typecheck and build (the build into scratch: the tree's dist/ is left alone)
if (SKIP.has('typecheck')) status.typecheck = 'skipped';
else {
  const code = await run('typecheck', process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', ROOT]);
  const errors = readFileSync(join(LOGS, 'typecheck.log'), 'utf8').split('\n').filter((l) => / error TS\d+/.test(l)).length;
  status.typecheck = { ok: code === 0, errors };
}
if (SKIP.has('build')) status.build = 'skipped';
else {
  const code = await run('build', process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', join(WORK, 'dist'), '--emptyOutDir']);
  status.build = { ok: code === 0 };
  rmSync(join(WORK, 'dist'), { recursive: true, force: true });
}

// 2. the suite, alone
interface Failure {
  file: string;
  name: string;
  kind: 'TIMEOUT' | 'REAL';
  message: string;
  detail: string;
}
if (SKIP.has('suite')) status.suite = 'skipped';
else {
  const report = join(WORK, 'vitest.json');
  const code = await run('suite', process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', `--outputFile=${report}`]);
  const failures: Failure[] = [];
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0, files: 0, failedFiles: 0 };
  const fail = (file: string, name: string, raw: string): void => {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = text.split('\n');
    const stack = lines.findIndex((l) => /^\s+at /.test(l));
    const message = (lines.find((l) => l.trim()) ?? '').trim();
    failures.push({ file, name, kind: /timed out/i.test(message) ? 'TIMEOUT' : 'REAL', message, detail: lines.slice(0, stack < 0 ? 40 : stack).join('\n').slice(0, 2000) });
  };
  if (existsSync(report)) {
    const r = JSON.parse(readFileSync(report, 'utf8')) as {
      testResults: { name: string; status: string; message?: string; assertionResults: { fullName: string; status: string; failureMessages?: string[] }[] }[];
    };
    for (const f of r.testResults) {
      const file = relative(ROOT, f.name);
      counts.files++;
      if (f.status !== 'passed') counts.failedFiles++;
      for (const a of f.assertionResults) {
        counts.total++;
        if (a.status === 'passed') counts.passed++;
        else if (a.status === 'failed') {
          counts.failed++;
          fail(file, a.fullName, a.failureMessages?.[0] ?? '(no message)');
        } else counts.skipped++;
      }
      // a file that failed outside its tests (import error, hook, unhandled error)
      if (f.status === 'failed' && f.message && !f.assertionResults.some((a) => a.status === 'failed')) fail(file, '(file)', f.message);
    }
  }
  if (!existsSync(report) || (code !== 0 && !failures.length)) {
    const log = readFileSync(join(LOGS, 'suite.log'), 'utf8');
    fail('(runner)', '(runner)', log.split('\n').find((l) => /Error|error/.test(l)) ?? `vitest exited ${code} with no report`);
  }
  failures.sort((a, b) => (a.file + a.name + a.message < b.file + b.name + b.message ? -1 : 1));
  status.suite = { exit: code };
  write('suite.json', json({ ...counts, failures }));
  if (existsSync(report)) writeFileSync(join(LOGS, 'vitest.json'), readFileSync(report));
}
ms.beforePool = Date.now() - t0;

// 3. the export and the matrices: shards in a bounded pool (longest first)
const tasks: (() => Promise<void>)[] = [];
const shardCodes: Record<string, number> = {};
const shard = (part: keyof typeof SHARDS, script: string): void => {
  if (SKIP.has(part)) return;
  for (let i = 0; i < SHARDS[part]; i++)
    tasks.push(async () => {
      shardCodes[`${part}-${i}`] = await node(`${part}-${i}`, script, [String(i), String(SHARDS[part]), join(WORK, `${part}-${i}.out`)]);
    });
};
shard('legmx', join(ROOT, 'scripts/check/legmx.ts'));
shard('fixtures', join(ROOT, 'scripts/check/fixtures-shard.ts'));
shard('l4mx', join(ROOT, 'scripts/check/l4mx.ts'));
const tp = Date.now();
await pool(tasks, JOBS);
ms.pool = Date.now() - tp;
const shardFailed = Object.entries(shardCodes)
  .filter(([, c]) => c !== 0)
  .map(([k]) => k);
status.shardsFailed = shardFailed.sort();

const outputs = (part: keyof typeof SHARDS): string[] =>
  Array.from({ length: SHARDS[part] }, (_, i) => join(WORK, `${part}-${i}.out`)).filter((f) => existsSync(f));

if (SKIP.has('fixtures')) status.fixtures = 'skipped';
else {
  type Row = { k: number; id: string; summary: unknown };
  const rows: Row[] = [];
  const traces: { k: number; id: string; sha256: string }[] = [];
  const threw: { id: string; message: string }[] = [];
  for (const f of outputs('fixtures')) {
    const r = JSON.parse(readFileSync(f, 'utf8')) as { rows: Row[]; traces: typeof traces; threw: typeof threw };
    rows.push(...r.rows);
    traces.push(...r.traces);
    threw.push(...r.threw);
  }
  rows.sort((a, b) => a.k - b.k);
  traces.sort((a, b) => a.k - b.k);
  // exactly what scripts/fixture-runner.ts writes for a full run
  const summary = JSON.stringify(
    rows.map((r) => r.summary),
    null,
    1,
  );
  write('summary.json', summary);
  write('traces.sha256', traces.map((t) => `${t.sha256}  ${t.id}.json\n`).join(''));
  const committed = join(ROOT, 'evidence/summary.json');
  status.fixtures = {
    count: rows.length,
    threw: threw.sort((a, b) => (a.id < b.id ? -1 : 1)),
    sameAsCommittedSummary: existsSync(committed) && readFileSync(committed, 'utf8') === summary,
  };
}
for (const part of ['legmx', 'l4mx'] as const) {
  if (SKIP.has(part)) {
    status[part] = 'skipped';
    continue;
  }
  const rows = outputs(part)
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean))
    .map((l) => JSON.parse(l) as { k: number; rev: boolean });
  rows.sort((a, b) => a.k - b.k || Number(a.rev) - Number(b.rev));
  write(`${part}.jsonl`, rows.map(({ k: _k, ...r }) => JSON.stringify(r) + '\n').join(''));
  status[part] = { rows: rows.length };
}
// the shape-query budget (the leg matrix's runs): the most queries in one tick per fixture and order
if (!SKIP.has('legmx')) {
  const rows = outputs('legmx')
    .map((f) => `${f}.q`)
    .filter((f) => existsSync(f))
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean))
    .map((l) => JSON.parse(l) as { k: number; rev: boolean });
  rows.sort((a, b) => a.k - b.k || Number(a.rev) - Number(b.rev));
  write('queries.jsonl', rows.map(({ k: _k, ...r }) => JSON.stringify(r) + '\n').join(''));
}
write('status.json', json(status));
ms.total = Date.now() - t0;
write('meta.json', json(meta));
rmSync(WORK, { recursive: true, force: true });

const suite = SKIP.has('suite') ? null : (JSON.parse(readFileSync(join(OUT, 'suite.json'), 'utf8')) as { total: number; passed: number; failed: number });
console.log(
  [
    `full check -> ${OUT} (${(ms.total / 1000).toFixed(0)} s, ${JOBS} jobs)`,
    `typecheck ${JSON.stringify(status.typecheck)}  build ${JSON.stringify(status.build)}`,
    suite ? `suite ${suite.passed}/${suite.total} passed, ${suite.failed} failed` : 'suite skipped',
    `fixtures ${JSON.stringify(status.fixtures)}`,
    `legmx ${JSON.stringify(status.legmx)}  l4mx ${JSON.stringify(status.l4mx)}`,
    shardFailed.length ? `SHARDS FAILED: ${shardFailed.join(', ')} (see logs/)` : 'all shards ok',
  ].join('\n'),
);
process.exit(shardFailed.length ? 1 : 0);
