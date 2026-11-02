// Ragdoll integrity extremes per Gate 4 fixture (accepted handoffs): joint separation, floor penetration, hinge
// excursions past limits, peak segment speed, inter-player penetration while either is a ragdoll, and audits.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const rows: string[] = [];
for (const def of gate4Fixtures()) {
  const sim = await Simulation.create(def);
  let pairPen = 0;
  while (!sim.done) {
    sim.stepTick();
    if (!sim.players.some((p) => p.rag)) continue;
    for (const c of sim.contacts) if (c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) for (const p of c.points) pairPen = Math.max(pairPen, -p.dist);
  }
  for (const pl of sim.players) {
    const h = pl.handoff;
    if (!h) continue;
    if (!h.accepted) { rows.push(`${def.id.padEnd(28)} ${pl.id} REJECTED ${h.report.reasons.join(',')}`); continue; }
    const s = pl.ragStats!;
    rows.push(`${def.id.padEnd(28)} ${pl.id} ${h.reason.padEnd(13)} sep ${(s.maxAnchorErrM * 1000).toFixed(1).padStart(5)} mm  floorPen ${(s.maxFloorPenM * 1000).toFixed(1).padStart(4)} mm  hingeOver ${s.maxHingeOverDeg.toFixed(1).padStart(5)}° ${String(s.hingeOverJoint ?? '-').padEnd(10)} reverse ${s.maxHingeReverseDeg.toFixed(1).padStart(5)}° ${String(s.hingeReverseJoint ?? '-').padEnd(10)} vmax ${s.maxSpeed.toFixed(2)}  pairPen ${(pairPen * 1000).toFixed(1)} mm  dKE ${h.audit!.energyDeltaJ.toFixed(1)} J (lim ${h.audit!.energyGainLimitJ.toFixed(1)})  P ${h.audit!.linearRelErr.toExponential(1)} L ${h.audit!.angularRelErr.toExponential(1)}  anchor ${(h.report.maxAnchorErrM * 1000).toFixed(2)} mm  lmk ${(h.report.maxLandmarkErrM * 1000).toFixed(2)} mm  extPen ${(h.report.maxNewExternalPenetrationM * 1000).toFixed(1)} mm`);
  }
  sim.dispose();
}
console.log(rows.join('\n'));
