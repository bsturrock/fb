// Plan 13a probe: Rapier shape queries per tick (Shape.contactShape, Collider.contactShape, Collider.contactCollider),
// the worst tick, and the share returning a contact within the query's prediction distance.
// Usage: vite-node scripts/probe/p13-qcount.ts <id regex>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { initPhysics, RAPIER } from '../../src/sim/physics';

await initPhysics();
let n = 0;
let near = 0;
type Fn = (...a: unknown[]) => unknown;
const wrap = (proto: Record<string, unknown>, name: string): void => {
  const orig = proto[name] as Fn;
  proto[name] = function (this: unknown, ...a: unknown[]) {
    n++;
    const r = orig.apply(this, a);
    if (r) near++;
    return r;
  };
};
wrap(RAPIER.Shape.prototype as unknown as Record<string, unknown>, 'contactShape');
wrap(RAPIER.Collider.prototype as unknown as Record<string, unknown>, 'contactShape');
wrap(RAPIER.Collider.prototype as unknown as Record<string, unknown>, 'contactCollider');
for (const def of allFixtures().filter((d) => new RegExp(process.argv[2]).test(d.id))) {
  const sim = await Simulation.create(def);
  let total = 0;
  let totalNear = 0;
  let worst = { n: 0, t: 0 };
  let ticks = 0;
  while (!sim.done) {
    n = 0;
    near = 0;
    sim.stepTick();
    ticks++;
    total += n;
    totalNear += near;
    if (n > worst.n) worst = { n, t: sim.t };
  }
  console.log(`${def.id} ticks ${ticks} queries ${total} mean/tick ${(total / ticks).toFixed(0)} worst ${worst.n} @${worst.t.toFixed(3)} near ${((100 * totalNear) / Math.max(1, total)).toFixed(1)}%`);
  sim.dispose();
}
