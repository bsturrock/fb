// Plan 08 probe: every boundary whose raw old/new difference is over 1 cm, with the owner change and the requests on both sides.
// Usage: vite-node scripts/probe/p08-rawover.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^L3-');
const kinds = (from: string, to: string): string => {
  const a = from.split(' ');
  const b = to.split(' ');
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(`${a[i]}>${b[i]}`);
  return out.join(' + ');
};
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  while (!sim.done) sim.stepTick();
  for (const d of sim.transitionDeltas.filter((x) => x.deltaM > 0.01)) {
    const k = d.landmark;
    const s = k.startsWith('left') ? 'left' : 'right';
    const L = d.legs[s];
    const dReq = Math.hypot(L.old.request.x - L.now.request.x, L.old.request.y - L.now.request.y, L.old.request.z - L.now.request.z);
    console.log(`${def.id.padEnd(24)} ${d.t.toFixed(4)} ${d.playerId} accept ${(d.deltaM * 100).toFixed(2)} ${k} raw ${(d.rawM * 100).toFixed(2)} cont ${(d.continuedM * 100).toFixed(2)} jump ${(d.requestJumpM[s] * 100).toFixed(2)} kind ${L.old.kind}>${L.now.kind} dReq ${(dReq * 100).toFixed(2)} var ${L.old.variant}/${L.now.variant} | ${kinds(d.from, d.to)}`);
  }
  sim.dispose();
}
