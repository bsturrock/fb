// Plan 08 probe: height and lean requests across mode changes: target rate against the slew limit, tracking error and
// suspension saturation (sampled per tick while supported), lean request rate. Usage: vite-node scripts/probe/p08-height.ts <id regex>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import type { SuspensionSupport } from '../../src/sim/profiles';

const re = new RegExp(process.argv[2]);
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def);
  const S = def.support as SuspensionSupport;
  let rate = 0, track = 0, sat = 0, ticks = 0;
  while (!sim.done) {
    sim.stepTick();
    for (const p of sim.players) {
      if (p.rag || !p.sus || p.controlMode !== 'supported') continue;
      ticks++;
      rate = Math.max(rate, Math.abs(p.sus.targetVMps));
      track = Math.max(track, Math.abs(p.proxy.body.translation().y - p.sus.targetM));
      if (p.sus.saturated !== 'none') sat++;
    }
  }
  console.log(`${def.id.padEnd(24)} ${String(sim.result).padEnd(20)} rate ${rate.toFixed(3)}/${S.targetSlewMps} track ${(track * 100).toFixed(1)}cm sat ${sat}/${ticks}`);
  sim.dispose();
}
