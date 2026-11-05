// Probe (review finding 1): passive grasp force direction, duration and separation in the G4-F4 owner conversions.
import { Simulation } from '../../src/sim/simulation';
import * as G4 from '../../src/sim/fixtures/gate4';
import { dot, len, sub, toWorld, vc } from '../../src/sim/vec';

for (const kind of ['ownerOnly', 'simultaneous'] as const) {
  const sim = await Simulation.create(G4.g4f4(kind));
  sim.arms!.keepLedger = true;
  let maxSep = 0;
  while (!sim.done) {
    sim.stepTick();
    for (const g of sim.arms!.grips.values()) {
      if (!g.passive) continue;
      const own = sim.byId.get(g.ownerId)!.rag!;
      const tgt = sim.byId.get(g.targetId)!;
      const tb = tgt.rag ? tgt.rag.bodies[g.targetPart] : tgt.proxy.body;
      const pT = toWorld({ p: vc(tb.translation()), q: { ...tb.rotation() } }, g.targetPointLocal);
      const ob = own.bodies[g.passive.ownerPart];
      const pO = toWorld({ p: vc(ob.translation()), q: { ...ob.rotation() } }, g.passive.ownerPointLocal);
      maxSep = Math.max(maxSep, len(sub(pT, pO)));
    }
  }
  const pas = sim.arms!.ledger.filter((x) => x.kind === 'passive' && x.actual > 1);
  const signs = pas.map((x) => dot(x.forceOnTarget, sub(x.pointOnTarget, x.pointOnOwner)));
  const begin = sim.events.filter((e) => e.type === 'gripPassive');
  const rel = sim.events.filter((e) => e.type === 'gripRelease');
  console.log(kind, 'passive entries >1N', pas.length, 'positive (push apart)', signs.filter((s) => s > 0).length, 'negative (tensile)', signs.filter((s) => s < 0).length, 'max actual N', Math.max(...pas.map((x) => x.actual)).toFixed(1));
  for (const b of begin) {
    const r = rel.find((x) => x.data!.grip === b.data!.grip);
    console.log('  ', b.data!.grip, 'passive from', b.t, r ? `released ${r.t} (${r.data!.reason}) held ${(r.t - b.t).toFixed(4)} s` : 'never released');
  }
  console.log('  max passive separation m', maxSep.toFixed(4), 'result', sim.result, 't', sim.t.toFixed(3));
  sim.dispose();
}
