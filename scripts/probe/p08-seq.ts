// Plan 08 closeout probe: what a fixture actually does: locomotion modes per player, contact, grip and clamp events, falling, conversions and result.
// Usage: vite-node scripts/probe/p08-seq.ts <id regex>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2]);
const types = new Set(['locoMode', 'contactBegin', 'contactEnd', 'gripBegin', 'gripRelease', 'clampBegin', 'clampEnd', 'fallingBegin', 'falling', 'proxyFalling', 'handoffRejected', 'handoff', 'ragdollHandoff', 'supportLost', 'supportRegained', 'practiceOutOfBounds']);
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def);
  let lost = 0;
  let regained = 0;
  const was = new Map<string, boolean>();
  while (!sim.done) {
    sim.stepTick();
    for (const p of sim.players) {
      const s = p.sus ? p.sus.probe.valid : null;
      if (s === null) continue;
      if (was.get(p.id) === true && !s) lost++;
      if (was.get(p.id) === false && s) regained++;
      was.set(p.id, s);
    }
  }
  const seen = new Set(sim.events.map((e) => e.type));
  console.log(`${def.id}: ${sim.result} t ${sim.t.toFixed(2)} support lost ${lost} regained ${regained} types ${[...seen].filter((t) => !/^foot/.test(t)).join(' ')}`);
  for (const e of sim.events) if (types.has(e.type)) console.log(`  ${e.t.toFixed(3)} ${e.playerId ?? ''} ${e.type} ${JSON.stringify(e.data ?? {}).slice(0, 90)}`);
  sim.dispose();
}
