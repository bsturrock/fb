// Run fixtures headless; write reproduction JSON + traces + event logs to evidence/.
// `npm run fixtures` rewrites evidence/summary.json; `npm run fixtures <regex>` writes evidence/summary.filtered.json
// (ignored by git) and leaves the committed summaries alone. Exits non-zero, writing no summary, if any fixture throws.
import { runFixtures } from './fixture-runner';

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const r = await runFixtures({ filter });
if (r.failed.length) {
  console.error(`${r.failed.length} fixture(s) threw: ${r.failed.map((f) => f.id).join(', ')}; no summary written`);
  process.exit(1);
}
console.log(`${r.summaries.length} summaries -> ${r.summaryPath}`);
