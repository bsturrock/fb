// Actual ragdoll blueprint after a G4-F1 conversion: per-segment mass/collider/joint data read back from Rapier.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const sim = await Simulation.create(gate4Fixtures().find((f) => f.id === 'G4-F1')!);
while (!sim.players[0].rag && !sim.done) sim.stepTick();
const pl = sim.players.find((p) => p.rag)!;
const rag = pl.rag!;
let total = 0;
for (const [id, b] of Object.entries(rag.bodies)) { total += b.mass(); console.log(id.padEnd(14), 'mass', b.mass().toFixed(2), 'kg  colliders', b.numColliders()); }
console.log('total', total.toFixed(2), 'kg');
for (const j of rag.joints as any[]) console.log('joint', String(j.id).padEnd(14), j.kind ?? j.type ?? '', `${j.parent ?? ''}->${j.child ?? ''}`, j.limitsRad ? `[${(j.limitsRad[0] * 180 / Math.PI).toFixed(0)}, ${(j.limitsRad[1] * 180 / Math.PI).toFixed(0)}]° engine ${(j.joint?.limitsMin?.() ?? NaN)}` : 'no limit');
console.log('colliders', rag.colliders.length, rag.colliders.map((c: any) => `${c.seg ?? c.segment}:${c.shape ?? c.kind ?? ''}`).join(' '));
console.log('handoff', JSON.stringify(pl.handoff?.audit).slice(0, 400));
sim.dispose();
