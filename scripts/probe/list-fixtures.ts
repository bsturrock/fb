// Probe: list every fixture with its milestone, ragdoll/rules presence and title.
import { allFixtures } from '../../src/sim/fixtures/index';
for (const f of allFixtures()) console.log(f.id.padEnd(30), f.milestone.padEnd(6), f.ragdoll ? 'rag' : '   ', f.rules ? 'rules' : '     ', f.title.slice(0, 100));
