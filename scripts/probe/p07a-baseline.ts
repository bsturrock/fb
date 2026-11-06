// Plan 07a probe: what each conversion sees. At every convertBatch call: per converting player the arm ownership
// (achieved grip arm vs procedural), its grips/clamps, hinge angles and pose limb clearance; then every overlapping
// candidate collider pair (candidate vs candidate, candidate vs active colliders of the others) with depth, and the
// same pair measured on the proxy representation (the supported proxy has no limb colliders, so a limb overlap there
// is only in the published pose). Usage: vite-node scripts/probe/p07a-baseline.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { buildCandidate, externalFromColliders, externalFromRagdoll, removeRagdoll, type ExternalShape } from '../../src/sim/ragdoll';

const re = new RegExp(process.argv[2] ?? '^RH-F6-simultaneous$|^G4-F10-simultaneous-M$|^RH-F5-playerBelow$|^L2-F14-oneArmFeet$|^G4-F3-twoArm-M$|^G4-F3-failed-M$');
const SimP = Simulation.prototype as unknown as { convertBatch: (list: { pl: any; reason: string }[]) => void };
const orig = SimP.convertBatch;
let cur: Simulation | null = null;
SimP.convertBatch = function (this: Simulation, list) {
  const sim = this as any;
  console.log(`  -- convert t=${sim.t.toFixed(4)} step ${sim.steps}: ${list.map((c) => `${c.pl.id}(${c.reason})`).join(', ')}`);
  const R = sim.def.ragdoll;
  const cands = list.map((c) => ({ pl: c.pl, rag: buildCandidate(sim.physics, c.pl.id, c.pl.body, c.pl.pose, R, c.pl.proxy.body.mass()) }));
  for (const c of cands) {
    const o = sim.arms?.obs(c.pl.id);
    const own = ['left', 'right'].map((s) => `${s} ${o?.[s]?.enabled ? `achieved(${o[s].phase}${o[s].gripId ? ' grip' : ''}${o[s].clampContactId ? ' clamp' : ''})` : 'procedural'}`).join(', ');
    const h = c.pl.pose.hingeDeg;
    console.log(`    ${c.pl.id}: arms ${own}; hinge ${Object.entries(h).filter(([k]) => k !== 'neck').map(([k, v]) => `${k} ${(v as number).toFixed(1)}`).join(' ')}; limbClearance ${Object.entries(c.pl.pose.limbClearance).map(([k, v]) => `${k} ${((v as number) * 100).toFixed(1)}cm`).join(' ')}`);
    const v = c.pl.proxy.body.linvel();
    console.log(`       proxy v (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}) controlMode ${c.pl.controlMode}`);
  }
  // pairwise overlaps
  const extOf = (o: any): ExternalShape[] => {
    const cc = cands.find((x) => x.pl === o);
    return cc ? externalFromRagdoll(cc.rag) : externalFromColliders(sim.activeColliders(o), (k) => `${o.id}:${sim.physics.tags.get(k.handle)?.key ?? '?'}(active)`);
  };
  for (const c of cands) {
    const mine = externalFromRagdoll(c.rag);
    const rows: string[] = [];
    for (const o of sim.players) {
      if (o === c.pl) continue;
      for (const e of extOf(o))
        for (const m of mine) {
          const r = e.shape.contactShape(e.pose.p, e.pose.q, m.shape, m.pose.p, m.pose.q, 0.0);
          if (r && r.distance < -0.002) rows.push(`${m.key} x ${e.key} ${(-r.distance * 100).toFixed(1)}cm`);
        }
    }
    const fl = sim.physics.floorCollider;
    for (const m of mine) {
      const r = fl.shape.contactShape(fl.translation(), fl.rotation(), m.shape, m.pose.p, m.pose.q, 0);
      if (r && r.distance < -0.002) rows.push(`${m.key} x floor ${(-r.distance * 100).toFixed(1)}cm`);
    }
    console.log(`    ${c.pl.id} candidate overlaps: ${rows.join('; ') || 'none'}`);
  }
  for (const c of cands) removeRagdoll(sim.physics, c.rag);
  orig.call(this, list);
  for (const c of list) {
    const h = c.pl.handoff;
    console.log(`    => ${c.pl.id} ${h?.outcome} ${h?.report.reasons.join(',') ?? ''} new ${((h?.report.maxNewExternalPenetrationM ?? 0) * 100).toFixed(1)}cm ${JSON.stringify(h?.report.worstExternal ?? null)} audit ${h?.audit ? `${h.audit.ok} dE ${h.audit.energyDeltaJ}` : '-'}`);
  }
};
for (const def of allFixtures()) {
  if (!re.test(def.id)) continue;
  console.log(def.id);
  const sim = await Simulation.create(def);
  cur = sim;
  while (!sim.done) sim.stepTick();
  console.log(`  result ${sim.result}`);
  sim.dispose();
}
void cur;
