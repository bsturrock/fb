// Per tick: D's clamps (state, patch distance between D forearm segment and R body) and grip/clamp events in a window.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const id = process.argv[2] ?? 'G4-F3-twoArm';
const t0 = Number(process.argv[3] ?? 0.85), t1 = Number(process.argv[4] ?? 1.3);
const sim = await Simulation.create(gate4Fixtures().find((f) => f.id === id)!);
let seen = 0;
while (!sim.done) {
  sim.stepTick();
  for (const e of sim.events.slice(seen)) if (/grip|clamp|handoff|remap|lossOf|ruleEnding|playEnded/i.test(e.type) || /remap/i.test(JSON.stringify(e.data))) console.log('  EV', e.t.toFixed(4), e.type, e.playerId, JSON.stringify(e.data).slice(0, 200));
  seen = sim.events.length;
  if (sim.t < t0 || sim.t > t1) continue;
  const cl = (['left', 'right'] as const).map((sd) => { const c: any = sim.arms!.clampOf('D', sd); return c ? `D:${sd} ${c.id ?? ''} ${c.region ?? c.targetRegion ?? ''} gap ${typeof c.gap === 'number' ? c.gap.toFixed(3) : '?'}` : `D:${sd} -`; });
  console.log(sim.t.toFixed(4), cl.join(' ; '), ' grips', sim.arms!.grips.size, ' R', sim.players.find((p) => p.id === 'R')!.representation);
}
sim.dispose();
