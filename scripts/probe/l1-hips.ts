// Probe (plan 06): clip hip height over the cycle (scaled to the player's leg) against the supported proxy's hip height.
// Usage: vite-node scripts/probe/l1-hips.ts
import { suppliedRunClips } from '../../src/sim/model/run-clips';
import { sampleRunClip } from '../../src/sim/run-clip';
import { Simulation } from '../../src/sim/simulation';
import * as L1 from '../../src/sim/fixtures/locomotion';
const def = L1.l1f1('fastRun');
const sim = await Simulation.create(def);
sim.stepTick();
const pl = sim.players.find((p) => p.id === 'R')!;
const lm = pl.pose!.jointLandmarksWorld;
const R = def.ragdoll!;
const leg = R.lengths.thigh + R.lengths.shin;
const ankle0 = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
console.log('proxy hip height (m):', ((lm.leftHip.y + lm.rightHip.y) / 2).toFixed(3), 'leg', leg.toFixed(3), 'flat-shoe ankle height', ankle0.toFixed(3));
for (const c of suppliedRunClips()) {
  const ys: number[] = [];
  for (let i = 0; i < 64; i++) {
    const s = sampleRunClip(c, i / 64);
    ys.push(ankle0 + 0.5 * (s.leg.left.hip.y + s.leg.right.hip.y) * leg);
  }
  console.log(c.id, 'clip hip height scaled (m): min', Math.min(...ys).toFixed(3), 'max', Math.max(...ys).toFixed(3), 'mean', (ys.reduce((a, b) => a + b) / ys.length).toFixed(3));
}
