import { expect } from 'vitest';
import { breathe } from './runs';

// The simulation runs (tests/runs.ts, no vitest import) and the vitest-side table helpers below.
export * from './runs';

/**
 * Plan 13b: a table test. Runs `check` on every row, yielding a macrotask between rows (the 10a A1 starvation), and
 * records each failing row with its label and its first failed assertion (or what it threw); the other rows still run.
 * Fails once at the end with the whole list, so one red run shows every failing row. A table with no rows fails.
 */
export async function rows<T>(items: Iterable<T>, label: (row: T) => string, check: (row: T) => void | Promise<void>): Promise<void> {
  const failed: string[] = [];
  let n = 0;
  for (const row of items) {
    n++;
    try {
      await check(row);
    } catch (e) {
      failed.push(`${label(row)}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await breathe();
  }
  expect(n, 'table rows: expected at least one').toBeGreaterThan(0);
  // the list goes into the message: reporters that print no diff (the JSON report) still show every failing row
  expect(failed, `${failed.length} of ${n} rows fail:\n${failed.join('\n')}\n`).toEqual([]);
}

/** The items as an array, after asserting there is at least one (a per-item loop over nothing proves nothing). */
export function nonEmpty<T>(xs: Iterable<T>, what = 'items'): T[] {
  const a = [...xs];
  expect(a.length, `${what}: expected at least one`).toBeGreaterThan(0);
  return a;
}
