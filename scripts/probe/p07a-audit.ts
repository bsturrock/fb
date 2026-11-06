// Plan 07a probe: candidate and transfer audit of every handoff (accepted, rejected, transferFailed): time, reason,
// landmark continuity, new external / floor penetration (worst pair), limb length and anchor error, signed hinge angles,
// mass, linear / angular momentum error, energy change against its limit, and the transferred bulk velocity.
// Usage: vite-node scripts/probe/p07a-audit.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^RH-F6-simultaneous$|^RH-F5-playerBelow$|^L2-F14-oneArmFeet$|^HC-');
const f = (x: number, d = 1) => x.toFixed(d);
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.ragdoll) continue;
  const sim = await Simulation.create(def);
  sim.runToEnd();
  for (const p of sim.players) {
    const h = p.handoff;
    if (!h) continue;
    const r = h.report;
    const a = h.audit;
    const hg = ['leftKnee', 'rightKnee', 'leftElbow', 'rightElbow'].map((k) => f(r.hingeDeg[k] ?? NaN, 0)).join('/');
    const we = r.worstExternal ? `${r.worstExternal.own}>${r.worstExternal.other}` : '-';
    const tr = a
      ? `m ${f(a.massDiffKg, 6)} P ${a.linearRelErr.toExponential(1)} L ${a.angularRelErr.toExponential(1)} dE ${f(a.energyDeltaJ)}/${f(a.energyGainLimitJ)} J v (${a.before.v.map((x) => f(x, 2)).join(',')})`
      : '-';
    console.log(`${def.id.padEnd(22)} ${p.id} ${h.outcome.padEnd(14)} @${f(h.t, 3)} ${h.reason.padEnd(13)} ${r.reasons.join(',') || 'ok'} | lm ${f(r.maxLandmarkErrM * 1000)} mm  ext ${f(r.maxNewExternalPenetrationM * 100, 2)} cm (${we})  floor ${f(r.floorPenetrationM * 100, 2)} cm  len ${f(r.lengthErrM * 1000, 2)} mm anchor ${f(r.maxAnchorErrM * 1000, 2)} mm  hinge K/E ${hg} deg  mass ${f(r.massKg)} kg | ${tr}`);
  }
  sim.dispose();
}
