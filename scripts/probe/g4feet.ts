// Supported runner: achieved-pose foot probes (pose query) relative to the COM, for the sideline fixture geometry.
import { Simulation } from '../../src/sim/simulation';
import { base4, bodyG4 } from '../../src/sim/fixtures/gate4';
import { RULES_FOOTBALL } from '../../src/sim/profiles';
import { v3 } from '../../src/sim/vec';
for (const sp of [0, 2, 4]) {
  const def = base4({
    id: 'feet', milestone: 'x', title: '', durationS: 2,
    rules: RULES_FOOTBALL('R', { sideline: false, progress: false }),
    players: [{ id: 'R', role: 'runner', body: bodyG4(), initial: { x: -4, z: 0, yawDeg: 90, velocity: v3(sp, 0, 0) }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(sp, 0, 0), facing: v3(1, 0, 0) }] } }],
  });
  const sim = await Simulation.create(def);
  let zmax = -9, zmin = 9, n = 0, ticks = 0, labels = new Set<string>();
  while (!sim.done) {
    sim.stepTick();
    const R = sim.players[0];
    const f = (sim.rules as any).groundTouches({ representation: 'proxy', pose: R.pose, contacts: sim.contacts, runnerId: 'R' }) as { label: string; source: string; point: { x: number; z: number } }[];
    const com = sim.bulk(R).com;
    let any = false;
    for (const g of f) { labels.add(`${g.label}:${g.source}`); if (g.source === 'poseQuery' && g.label === 'foot') { any = true; zmax = Math.max(zmax, g.point.z - com.z); zmin = Math.min(zmin, g.point.z - com.z); n++; } }
    if (any) ticks++;
  }
  console.log('speed', sp, 'foot-probe ticks', ticks, '/', sim.tick, 'z rel COM', zmin.toFixed(3), zmax.toFixed(3), [...labels].join(' '));
  sim.dispose();
}
