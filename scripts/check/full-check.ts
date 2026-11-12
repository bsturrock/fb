// The full check (scripts/check/README.md): typecheck, build, the test suite, the fixture export, the leg matrix, the
// L4 matrix, the passive-energy matrix and the visible-quality matrix of the current tree, written into one result
// directory.
//   npx vite-node scripts/check/full-check.ts <result dir>
// Env: CHECK_JOBS (parallel workers after the suite, default 6), CHECK_SKIP (comma list of
// typecheck,build,suite,fixtures,legmx,l4mx,energymx,visiblemx; a skipped part is recorded as skipped), CHECK_REUSE
// (a previous result directory: its export and matrices are taken when the pass's inputs are unchanged, README "Reuse").
// The leg matrix's runs also write the shape-query budget (queries.jsonl).
// The suite runs first and alone (no competing load, so no induced timeouts); then every fixture runs once per body
// order it is needed in, with the meters of every part it feeds attached (scripts/check/meters.ts), in a pool of
// worker processes (pass.ts) that take the runs longest first. Every compared file is deterministic: no timestamps,
// stable order. Timings go to meta.json and logs/.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allFixtures } from '../../src/sim/fixtures/index';
import { familyOf, visibleHeadline, type VisRow } from './lib';
import { passInputDigest } from './inputs';
import { PARTS, partsOf, type Part, type PassRows } from './meters';

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

// 3a. reuse: a previous result whose pass ran on the same inputs (every file the runs execute or read, the installed
// packages, Node) is this tree's pass, byte for byte (README "Reuse"); its files are taken and status.json says so
const PASS_PARTS: string[] = [...PARTS];
const PASS_FILES = ['summary.json', 'traces.sha256', 'traces-rev.sha256', 'legmx.jsonl', 'l4mx.jsonl', 'queries.jsonl', 'energymx.jsonl', 'visiblemx.jsonl'];
const inputs = passInputDigest(ROOT);
meta.passInputs = { digest: inputs.digest, files: inputs.files, ...(inputs.unresolved.length ? { unresolved: inputs.unresolved } : {}) };
function reuseRefusal(prev: string): string | null {
  if (!inputs.digest) return `an import does not resolve: ${inputs.unresolved.join('; ')}`;
  const pm = existsSync(join(prev, 'meta.json')) ? (JSON.parse(readFileSync(join(prev, 'meta.json'), 'utf8')) as { passInputs?: { digest?: string }; skipped?: string[] }) : null;
  const ps = existsSync(join(prev, 'status.json')) ? (JSON.parse(readFileSync(join(prev, 'status.json'), 'utf8')) as Record<string, unknown>) : null;
  if (!pm || !ps) return 'no meta.json or status.json there';
  if (pm.passInputs?.digest !== inputs.digest) return `the pass inputs changed (${pm.passInputs?.digest?.slice(0, 16) ?? 'none recorded'} -> ${inputs.digest.slice(0, 16)})`;
  if (PASS_PARTS.some((p) => SKIP.has(p))) return 'this check skips a part of the pass';
  if ((pm.skipped ?? []).some((p) => PASS_PARTS.includes(p))) return 'that check skipped a part of the pass';
  if (JSON.stringify(ps.shardsFailed) !== '[]') return 'runs failed there';
  const missing = PASS_FILES.filter((f) => !existsSync(join(prev, f)));
  if (missing.length) return `missing there: ${missing.join(', ')}`;
  return null;
}
if (process.env.CHECK_REUSE) {
  const prev = resolve(process.env.CHECK_REUSE);
  const why = reuseRefusal(prev);
  if (why) {
    meta.reuseRefused = why;
    console.log(`CHECK_REUSE ${prev}: not reused (${why}); running the pass`);
  } else {
    for (const f of PASS_FILES) copyFileSync(join(prev, f), join(OUT, f));
    const ps = JSON.parse(readFileSync(join(prev, 'status.json'), 'utf8')) as Record<string, unknown>;
    const committed = join(ROOT, 'evidence/summary.json');
    status.shardsFailed = ps.shardsFailed;
    status.fixtures = { ...(ps.fixtures as object), sameAsCommittedSummary: existsSync(committed) && readFileSync(committed, 'utf8') === readFileSync(join(OUT, 'summary.json'), 'utf8') };
    for (const part of ['legmx', 'l4mx', 'energymx', 'visiblemx']) status[part] = ps[part];
    status.passReused = { from: basename(prev), inputs: inputs.digest };
    meta.passReusedFrom = prev;
    finish([]);
  }
}

// 3. the export and the matrices: one run per fixture and body order with every meter it feeds, in a pool of workers
const all = allFixtures();
interface Run {
  k: number;
  rev: boolean;
  parts: Part[];
  cost: number;
  /** A bare twin: the export's run with no meter at all, whose trace must hash as the metered run's (README "One pass"). */
  twin?: boolean;
}
const runs: Run[] = [];
for (let k = 0; k < all.length; k++)
  for (const rev of [false, true]) {
    const parts = partsOf(all[k], rev).filter((p) => !SKIP.has(p));
    // cost estimate for the order (longest first): physics substeps times players
    const d = all[k];
    if (parts.length) runs.push({ k, rev, parts, cost: d.durationS * d.solver.substeps * d.players.length });
  }
// the meters' twins: the first fixture of L3, L4 (with a fall response) and HC, run again forward with no meter
const TWINS = ['L3', 'L4', 'HC'].map((f) => all.findIndex((d) => familyOf(d.id) === f && (f !== 'L4' || !!d.fallResponse))).filter((k) => k >= 0);
if (!SKIP.has('fixtures')) for (const k of TWINS) runs.push({ k, rev: false, parts: ['fixtures'], cost: 0, twin: true });
runs.sort((a, b) => b.cost - a.cost || a.k - b.k || Number(a.rev) - Number(b.rev) || Number(!!a.twin) - Number(!!b.twin));
const twinSha = new Map<number, string>();
/** Every run's rows by part, and the runs that threw (`<part>:<fixture>[:rev]`, one per part the run fed). */
const got = new Map<Part | 'queries', { k: number; rev: boolean; line: string }[]>();
const exportRows: { k: number; id: string; summary: unknown; sha256: string }[] = [];
const revRows: { k: number; id: string; sha256: string }[] = [];
const threw: { id: string; message: string }[] = [];
const shardFailed: string[] = [];
const runMs: Record<string, number> = {};
const tp = Date.now();
if (runs.length) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(JOBS, runs.length) }, (_, w) => {
      const fd = openSync(join(LOGS, `pass-${w}.log`), 'w');
      const t0 = Date.now();
      const p: ChildProcess = spawn(process.execPath, [VITE_NODE, join(ROOT, 'scripts/check/pass.ts')], { cwd: ROOT, stdio: ['ignore', fd, fd, 'ipc'], env: process.env });
      let current: Run | null = null;
      const give = (): void => {
        current = next < runs.length ? runs[next++] : null;
        if (current) p.send({ k: current.k, rev: current.rev, parts: current.parts });
        else p.send('exit');
      };
      p.on('message', (m: 'ready' | { k: number; rev: boolean; rows?: PassRows; error?: string; ms: number }) => {
        if (m !== 'ready' && current?.twin) {
          if (m.error !== undefined) shardFailed.push(`twin:${all[m.k].id}`);
          else twinSha.set(m.k, m.rows!.fixtures!.sha256);
        } else if (m !== 'ready') {
          const id = all[m.k].id;
          runMs[`${id}${m.rev ? ':rev' : ''}`] = m.ms;
          if (m.error !== undefined) {
            if (!m.rev && current?.parts.includes('fixtures')) threw.push({ id, message: m.error });
            for (const part of current!.parts) if (part !== 'fixtures') shardFailed.push(`${part}:${id}${m.rev ? ':rev' : ''}`);
          } else {
            const r = m.rows!;
            if (r.fixtures) exportRows.push({ k: m.k, id, summary: r.fixtures.summary, sha256: r.fixtures.sha256 });
            if (r.revSha256) revRows.push({ k: m.k, id, sha256: r.revSha256 });
            for (const part of [...PARTS, 'queries'] as const) {
              const line = part === 'fixtures' ? undefined : r[part];
              if (line !== undefined) (got.get(part) ?? got.set(part, []).get(part)!).push({ k: m.k, rev: m.rev, line });
            }
          }
        }
        give();
      });
      return new Promise<void>((res) =>
        p.on('close', (code) => {
          closeSync(fd);
          ms[`pass-${w}`] = Date.now() - t0;
          // a worker that died took its current run with it
          if (current) for (const part of (current as Run).parts) shardFailed.push(`${part}:${all[(current as Run).k].id}${(current as Run).rev ? ':rev' : ''}`);
          if (code !== 0) shardFailed.push(`pass-${w}`);
          res();
        }),
      );
    }),
  );
}
ms.pool = Date.now() - tp;
meta.runMs = runMs;
// a meter that changed a run: the metered export's trace differs from its bare twin's
const twins = TWINS.filter((k) => twinSha.has(k)).map((k) => ({ id: all[k].id, same: exportRows.find((r) => r.k === k)?.sha256 === twinSha.get(k) }));
meta.meterTwins = twins;
for (const t of twins) if (!t.same) shardFailed.push(`meters-change-run:${t.id}`);
status.shardsFailed = shardFailed.sort();

/** The passive-energy matrix's headline per family: runs, runs and solves injecting, total injected and the largest gain (J). */
type EnergyRow = { id: string; pl: Record<string, { injecting: number; injectedJ: number; maxJ: number }> };
function energyHeadline(rows: EnergyRow[]): Record<string, { runs: number; injectingRuns: number; injecting: number; injectedJ: number; maxJ: number }> {
  const out: Record<string, { runs: number; injectingRuns: number; injecting: number; injectedJ: number; maxJ: number }> = {};
  for (const r of rows)
    for (const p of Object.values(r.pl)) {
      const f = (out[familyOf(r.id)] ??= { runs: 0, injectingRuns: 0, injecting: 0, injectedJ: 0, maxJ: 0 });
      f.runs++;
      if (p.injecting > 0) f.injectingRuns++;
      f.injecting += p.injecting;
      f.injectedJ = Number((f.injectedJ + p.injectedJ).toFixed(3));
      f.maxJ = Math.max(f.maxJ, p.maxJ);
    }
  return out;
}

/** A matrix's lines in registry order, forward before reversed. */
const linesOf = (part: Part | 'queries'): string[] =>
  (got.get(part) ?? [])
    .sort((a, b) => a.k - b.k || Number(a.rev) - Number(b.rev))
    .map((r) => r.line);

if (SKIP.has('fixtures')) status.fixtures = 'skipped';
else {
  const rows = exportRows.sort((a, b) => a.k - b.k);
  const traces = rows;
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
// the reversed runs' traces (every matrix fixture), hashed as the export hashes the forward ones
if (['legmx', 'l4mx', 'energymx', 'visiblemx'].some((p) => !SKIP.has(p)))
  write(
    'traces-rev.sha256',
    revRows
      .sort((a, b) => a.k - b.k)
      .map((t) => `${t.sha256}  ${t.id}.json\n`)
      .join(''),
  );
for (const part of ['legmx', 'l4mx', 'energymx', 'visiblemx'] as const) {
  if (SKIP.has(part)) {
    status[part] = 'skipped';
    continue;
  }
  const rows = linesOf(part).map((l) => JSON.parse(l) as { k: number; rev: boolean });
  write(`${part}.jsonl`, rows.map(({ k: _k, ...r }) => JSON.stringify(r) + '\n').join(''));
  status[part] = {
    rows: rows.length,
    ...(part === 'energymx' ? { byFamily: energyHeadline(rows as unknown as EnergyRow[]) } : {}),
    ...(part === 'visiblemx' ? { byFamily: visibleHeadline(rows as unknown as VisRow[]) } : {}),
  };
}
// the shape-query budget (the leg matrix's runs): the most queries in one tick per fixture and order
if (!SKIP.has('legmx')) {
  const rows = linesOf('queries').map((l) => JSON.parse(l) as { k: number; rev: boolean });
  write('queries.jsonl', rows.map(({ k: _k, ...r }) => JSON.stringify(r) + '\n').join(''));
}
finish(shardFailed);

/** Write status.json and meta.json, print the headline and exit (1 when a run failed). */
function finish(failed: string[]): never {
  write('status.json', json(status));
  ms.total = Date.now() - t0;
  write('meta.json', json(meta));
  rmSync(WORK, { recursive: true, force: true });
  const suite = SKIP.has('suite') ? null : (JSON.parse(readFileSync(join(OUT, 'suite.json'), 'utf8')) as { total: number; passed: number; failed: number });
console.log(
  [
    `full check -> ${OUT} (${(ms.total / 1000).toFixed(0)} s, ${JOBS} jobs)${status.passReused ? `; export and matrices reused from ${meta.passReusedFrom} (pass inputs unchanged)` : ''}`,
    `typecheck ${JSON.stringify(status.typecheck)}  build ${JSON.stringify(status.build)}`,
    suite ? `suite ${suite.passed}/${suite.total} passed, ${suite.failed} failed` : 'suite skipped',
    `fixtures ${JSON.stringify(status.fixtures)}`,
    `legmx ${JSON.stringify(status.legmx)}  l4mx ${JSON.stringify(status.l4mx)}  energymx ${JSON.stringify(status.energymx)}`,
    `visiblemx ${typeof status.visiblemx === 'string' ? status.visiblemx : `${(status.visiblemx as { rows: number }).rows} rows`}`,
    failed.length ? `RUNS FAILED: ${failed.join(', ')} (see logs/pass-*.log)` : 'all runs ok',
  ].join('\n'),
  );
  process.exit(failed.length ? 1 : 0);
}
