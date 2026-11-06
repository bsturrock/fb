// Probe (plan 06a step 5): standing-height sweep. Root height request vs achieved origin, hip, knee flexion, lowest shoe
// point above the turf and the ankle-target residual of the ground-relative legs, after 0.5 s standing.
// Usage: vite-node scripts/probe/rh-stand-sweep.ts
import { Simulation } from '../../src/sim/simulation';
import { rhf1Stand } from '../../src/sim/fixtures/ride-height';
import { SUSPENSION_RH } from '../../src/sim/profiles';
import { footFrame, legShapes, type PoseShape } from '../../src/sim/pose';
import { qRot, v3 } from '../../src/sim/vec';
const lowest = (shapes: PoseShape[]): number => { let y = Infinity; for (const s of shapes) if (s.kind === 'box') for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, s.c.y + qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z)).y); return y; };
for (const h of [0.95, 0.93, 0.92, 0.91, 0.90, 0.89, 0.88, 0.86, 0.84, 0.80, 0.76, 0.72]) {
  const def = { ...rhf1Stand(), durationS: 0.5, support: { ...SUSPENSION_RH, standingHeightM: h } };
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const pl = sim.players[0];
  const p = pl.pose!; const lm = p.jointLandmarksWorld; const R = def.ragdoll!;
  const gaps = (['left', 'right'] as const).map((s) => lowest(legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], p.segments[`${s}Shin`].rotationWorld, footFrame(p, s))));
  console.log(h.toFixed(2), 'origin', sim.poseOf(pl).p.y.toFixed(4), 'hip', lm.leftHip.y.toFixed(4), 'knee', p.hingeDeg.leftKnee.toFixed(1), p.hingeDeg.rightKnee.toFixed(1), 'gap', gaps.map((g) => g.toFixed(4)).join('/'), 'res', JSON.stringify(p.targetResidualM), 'ankle', JSON.stringify(p.anklePitchDeg));
  sim.dispose();
}
