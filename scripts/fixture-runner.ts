// Headless fixture runner (scripts/run-fixtures.ts). A filtered run writes `summary.filtered.json` and never touches the
// committed `summary.json`, which only a full run rewrites; a run in which any fixture throws writes no summary file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../src/sim/simulation';
import { allFixtures } from '../src/sim/fixtures/index';
import type { FixtureDef } from '../src/sim/fixture';

export interface FixtureRunOptions {
  filter?: RegExp | null;
  /** Evidence root (default `evidence`): summaries at its top, traces under `traces/`. */
  evidenceDir?: string;
  /** Fixture list (default: the registry). */
  defs?: FixtureDef[];
  log?: (line: string) => void;
}

export interface FixtureRunResult {
  summaries: Record<string, unknown>[];
  failed: { id: string; error: unknown }[];
  /** The summary file written, or null when a fixture threw. */
  summaryPath: string | null;
}

export function summaryFileFor(evidenceDir: string, filter: RegExp | null | undefined): string {
  return join(evidenceDir, filter ? 'summary.filtered.json' : 'summary.json');
}

export function assertUniqueIds(defs: FixtureDef[]): void {
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`duplicate fixture id ${d.id}`);
    seen.add(d.id);
  }
}

export async function runFixtures(o: FixtureRunOptions = {}): Promise<FixtureRunResult> {
  const filter = o.filter ?? null;
  const root = o.evidenceDir ?? 'evidence';
  const log = o.log ?? ((s: string) => console.log(s));
  const defs = o.defs ?? allFixtures();
  assertUniqueIds(defs);
  const traceDir = join(root, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const summaries: Record<string, unknown>[] = [];
  const failed: { id: string; error: unknown }[] = [];
  for (const def of defs) {
    if (filter && !filter.test(def.id)) continue;
    let sim: Simulation | null = null;
    try {
      sim = await Simulation.create(def);
      sim.runToEnd();
      const s = sim.summary();
      summaries.push(s);
      writeFileSync(join(traceDir, `${def.id}.json`), JSON.stringify({ fixture: sim.exportFixture(), summary: s, events: sim.events, trace: sim.trace }));
      const ev = sim.events
        .filter((e) => e.type !== 'grounded')
        .map((e) => `${e.t}:${e.type}${e.playerId ? '@' + e.playerId : ''}${e.data && 'own' in e.data ? `(${e.data.own}>${e.data.otherClass})` : ''}`);
      log(`${def.id.padEnd(40)} ${String(s.result).padEnd(20)} ${JSON.stringify(s.players)}\n    ${ev.slice(0, 14).join(' ')}`);
    } catch (error) {
      failed.push({ id: def.id, error });
      log(`FAILED ${def.id}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    } finally {
      sim?.dispose();
    }
  }
  if (failed.length) return { summaries, failed, summaryPath: null };
  const summaryPath = summaryFileFor(root, filter);
  writeFileSync(summaryPath, JSON.stringify(summaries, null, 1));
  return { summaries, failed, summaryPath };
}
