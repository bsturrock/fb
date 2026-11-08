// Plan 09 review: what the impact guard saw for one player over a range of substeps (fixture, player, from, to).
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
import { vc } from '../../src/sim/vec';
const [id, pid, from, to] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5]];
const def = fallFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, { trace: false });
const s = sim as any;
const orig = s.closingSpeeds.bind(s);
s.closingSpeeds = (rag: any, look: number, pred: number, skin: number) => {
  const out = orig(rag, look, pred, skin);
  if (rag.playerId === pid && s.steps >= from && s.steps <= to) {
    const floor = s.physics.floorCollider;
    const rows: string[] = [];
    for (const rc of rag.colliders) {
      const r = floor.shape.contactShape(floor.translation(), floor.rotation(), rc.collider.shape, rc.collider.translation(), rc.collider.rotation(), 0.3);
      if (!r || rc.segment !== 'core') continue;
      const v = vc(rag.bodies.core.velocityAtPoint(r.point2));
      rows.push(`${rc.region} gap ${r.distance.toFixed(4)} vy ${v.y.toFixed(2)} n ${vc(r.normal1).y.toFixed(2)}`);
    }
    console.log(`s${s.steps} guard ${JSON.stringify(out)} | ${rows.join(' ; ')}`);
  }
  return out;
};
sim.runToEnd();
sim.dispose();
