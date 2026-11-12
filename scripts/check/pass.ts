// Full check worker (scripts/check/README.md "One pass"): takes runs from the full check over IPC, one at a time, and
// answers each with the rows of every part it feeds (scripts/check/meters.ts runPass). Started by full-check.ts only.
//   message in:  { k, rev, parts }   (registry index, reversed body order, the parts to meter: none but `fixtures` for a
//                 bare twin)
//   message out: { k, rev, rows, ms } or { k, rev, error, ms }
import { allFixtures } from '../../src/sim/fixtures/index';
import { passContext, runPass, type Part } from './meters';

if (!process.send) {
  console.error('scripts/check/pass.ts is a full-check worker (IPC); run a matrix by hand with legmx.ts, l4mx.ts, energymx.ts or visiblemx.ts');
  process.exit(2);
}
const all = allFixtures();
const ctx = passContext();
const send = (m: unknown): Promise<void> => new Promise((res, rej) => process.send!(m, undefined, {}, (e) => (e ? rej(e) : res())));

process.on('message', (m: { k: number; rev: boolean; parts: Part[] } | 'exit') => {
  if (m === 'exit') {
    ctx.q?.restore();
    process.disconnect();
    return;
  }
  void (async () => {
    const t0 = Date.now();
    try {
      const rows = await runPass(ctx, m.k, all[m.k], m.rev, new Set(m.parts));
      await send({ k: m.k, rev: m.rev, rows, ms: Date.now() - t0 });
    } catch (e) {
      console.error(`${all[m.k].id}${m.rev ? ' (reversed)' : ''}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      await send({ k: m.k, rev: m.rev, error: (e instanceof Error ? e.message : String(e)).split('\n')[0], ms: Date.now() - t0 });
    }
  })();
});
await send('ready');
