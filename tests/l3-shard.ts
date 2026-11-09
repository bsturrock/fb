// Plan 13b: one shard process of the L3 contract pass (tests/l3-pass.ts), started by tests/l3-contracts.test.ts under
// vite-node with an IPC channel (advanced serialization). It asks for a fixture, runs that fixture's part of the pass,
// sends back what the checks found, and asks again; told to end, it sends its records and exits.
// Messages in: { id } (a fixture to run) or { end: true }. Out: { ready: true }, { id, pass }, { records }, { id, error }.
import { SIM_DEFAULTS } from '../src/sim/simulation';
import { FIX } from './runs';
import { passFixture, RECORDS } from './l3-pass';

// as tests/setup.ts sets for every vitest file (plan 10c C7: tests read the force and effort ledgers)
SIM_DEFAULTS.ledgers = true;

if (!process.send) throw new Error('tests/l3-shard.ts runs as a child of tests/l3-contracts.test.ts (no IPC channel)');
const send = (m: unknown): Promise<void> => new Promise((resolve, reject) => process.send!(m, undefined, {}, (e) => (e ? reject(e) : resolve())));

// the test process went away: nothing would read the results
process.on('disconnect', () => process.exit(1));
process.on('message', (m: { id?: string; end?: boolean }) => {
  void (async () => {
    try {
      if (m.end) {
        await send({ records: RECORDS });
        process.exit(0);
      }
      await send({ id: m.id, pass: await passFixture(FIX(m.id!)) });
    } catch (e) {
      await send({ id: m.id ?? null, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
      process.exit(1);
    }
  })();
});
await send({ ready: true });
