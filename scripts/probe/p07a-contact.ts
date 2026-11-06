// Plan 07a probe: per tick, every overlap of one player's published limb shapes (candidate geometry) with the other
// players' active colliders and published limbs, plus root height, vertical speed and control mode.
// Usage: vite-node scripts/probe/p07a-contact.ts <fixture> <player> <fromS> <toS> [--sub]
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { poseLimbShapes, type PoseShape } from '../../src/sim/pose';
import { addScaled, len, qFromUnitVectors, scale, sub, v3, vc } from '../../src/sim/vec';

const [id, who, a, b] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const toR = (s: PoseShape): { shape: RAPIER.Shape; p: any; q: any } => {
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), p: s.c, q: { x: 0, y: 0, z: 0, w: 1 } };
  if (s.kind === 'box') return { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), p: s.c, q: s.q };
  const d = sub(s.b, s.a);
  const l = len(d);
  return { shape: new RAPIER.Capsule(l / 2, s.r), p: addScaled(s.a, d, 0.5), q: l > 1e-6 ? qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) : { x: 0, y: 0, z: 0, w: 1 } };
};
const R = def.ragdoll!;
while (!sim.done && sim.t <= +b) {
  sim.stepTick();
  if (sim.t < +a) continue;
  const pl = sim.players.find((p) => p.id === who)!;
  if (!pl.pose) continue;
  const mine = pl.rag ? [] : poseLimbShapes(R, pl.pose);
  const rows: string[] = [];
  for (const o of sim.players) {
    if (o === pl) continue;
    const others: { key: string; shape: RAPIER.Shape; p: any; q: any }[] = sim
      .activeColliders(o)
      .map((c) => ({ key: `${o.id}:${(sim as any).physics.tags.get(c.handle)?.key}`, shape: c.shape, p: vc(c.translation()), q: { ...c.rotation() } }));
    if (!o.rag && o.pose) for (const s of poseLimbShapes(R, o.pose)) others.push({ key: `${o.id}:pose:${s.key}`, ...toR(s) });
    for (const m of mine) {
      const mr = toR(m);
      for (const e of others) {
        const r = e.shape.contactShape(e.p, e.q, mr.shape, mr.p, mr.q, 0);
        if (r && r.distance < -0.002) rows.push(`${m.key}x${e.key} ${(-r.distance * 100).toFixed(1)}`);
      }
    }
  }
  const t = pl.proxy.body.translation();
  const v = pl.proxy.body.linvel();
  console.log(`${sim.t.toFixed(4)} y ${t.y.toFixed(3)} vy ${v.y.toFixed(2)} ${pl.controlMode}${pl.rag ? ' RAG' : ''} | ${rows.join('  ')}`);
}
