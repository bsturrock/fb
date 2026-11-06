// Plan 07 review closeout probe: clip touchdown proposals with and without the reach pre-check (confirmed / failed /
// sustained, coverage). Usage: vite-node scripts/probe/p07-precheck.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { FOOT_DEBUG } from '../../src/sim/footwork';

const re = new RegExp(process.argv[2] ?? '^L2-F(3-runStop|11-)');
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.footwork) continue;
  for (const off of [false, true]) {
    FOOT_DEBUG.noReachCheck = off;
    const sim = await Simulation.create(def);
    sim.runToEnd();
    for (const p of sim.players) {
      if (!p.feet) continue;
      const st = p.feet.stats;
      const cov = (['left', 'right'] as const).map((s) => `${s[0]} ${st.cover[s].plantedS.toFixed(3)}/${st.cover[s].eligibleS.toFixed(3)} s`).join(', ');
      console.log(`${def.id.padEnd(20)} ${p.id} precheck ${off ? 'off' : 'on '}: attempts ${st.attempts} confirmed ${st.confirmed} failed ${st.failed} (max err ${(st.failedErrM * 100).toFixed(2)} cm) sustained ${st.sustained}; cover ${cov}`);
    }
    sim.dispose();
  }
}
FOOT_DEBUG.noReachCheck = false;
