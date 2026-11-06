// Probe (plan 06a step 1): the committed baseline in one calibrated coordinate system. World Y up, turf at y = 0;
// body-local = proxy origin frame (bew-v6: GLB rest - (0, 0.95, -0.059)). Reports the proxy support geometry, mass and
// inertia, rest heights (proxy origin, hip landmark = UpLeg joint, COM, shoe sole, straight-leg hip), the clips'
// pelvis-to-ground trajectories converted to hip and root heights, and their vertical accelerations at nominal rate.
// Usage: vite-node scripts/probe/rh-baseline.ts
import { execSync } from 'node:child_process';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { suppliedRunClips } from '../../src/sim/model/run-clips';
import { sampleRunClip } from '../../src/sim/run-clip';
import { footFrame, legShapes, type PoseShape } from '../../src/sim/pose';
import { qRot, v3 } from '../../src/sim/vec';

const rev = execSync('git rev-parse --short=12 HEAD').toString().trim();
const dirty = execSync('git status --porcelain src').toString().trim() ? ' (src modified)' : '';
console.log(`source ${rev}${dirty}`);
const def = allFixtures().find((d) => d.id === 'L1-F1-fastRun')!;
const sim = await Simulation.create(def);
const pl = sim.players[0];
const R = def.ragdoll!;
const b = pl.body;
console.log('profiles', JSON.stringify(sim.exportFixture().profileIds));
console.log('support geometry', JSON.stringify(b.compound.support), 'rest origin', b.restOriginY);
const m = pl.mass;
console.log('mass', m.massKg.toFixed(4), 'localCom', JSON.stringify(m.localCom), 'principal inertia', JSON.stringify(m.principalInertia));
const lm = pl.pose!.jointLandmarksWorld;
const hipY = 0.5 * (lm.leftHip.y + lm.rightHip.y);
const leg = R.lengths.thigh + R.lengths.shin;
const sole = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
const lowest = (shapes: PoseShape[]): number => {
  let y = Infinity;
  for (const s of shapes) if (s.kind === 'box') for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, s.c.y + qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z)).y);
  return y;
};
const p = pl.pose!;
const shoeGap = (['left', 'right'] as const).map((s) => lowest(legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], p.segments[`${s}Shin`].rotationWorld, footFrame(p, s))));
console.log(
  `t=0 origin ${sim.poseOf(pl).p.y.toFixed(4)} hip ${hipY.toFixed(4)} COM ${sim.bulk(pl).com.y.toFixed(4)} flat-shoe ankle ${sole.toFixed(4)} straight-leg hip ${(sole + leg).toFixed(4)} ` +
    `(leg ${leg.toFixed(4)}) knee flexion L/R ${p.hingeDeg.leftKnee.toFixed(1)}/${p.hingeDeg.rightKnee.toFixed(1)} deg lowest shoe point L/R ${shoeGap.map((x) => x.toFixed(4)).join('/')}`,
);
const hipLocalY = b.hipRight.y;
for (const c of suppliedRunClips()) {
  const N = 256;
  const ys: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = sampleRunClip(c, i / N);
    ys.push(sole + 0.5 * (s.leg.left.hip.y + s.leg.right.hip.y) * leg);
  }
  const T = c.record.cycleS;
  const dt = T / N;
  const acc = ys.map((y, i) => (ys[(i + 1) % N] - 2 * y + ys[(i - 1 + N) % N]) / (dt * dt));
  const mean = ys.reduce((a, x) => a + x) / N;
  let iMin = 0;
  let iMax = 0;
  ys.forEach((y, i) => {
    if (y < ys[iMin]) iMin = i;
    if (y > ys[iMax]) iMax = i;
  });
  console.log(
    `${c.id}: hip min ${Math.min(...ys).toFixed(4)} (u ${(iMin / N).toFixed(3)}) max ${Math.max(...ys).toFixed(4)} (u ${(iMax / N).toFixed(3)}) mean ${mean.toFixed(4)}; ` +
      `root = hip - ${hipLocalY.toFixed(5)}: ${(Math.min(...ys) - hipLocalY).toFixed(4)}..${(Math.max(...ys) - hipLocalY).toFixed(4)} mean ${(mean - hipLocalY).toFixed(4)}; ` +
      `vertical accel at rate 1: min ${Math.min(...acc).toFixed(1)} max ${Math.max(...acc).toFixed(1)} m/s^2; stance ${JSON.stringify(c.record.stance)}`,
  );
  // harmonic content of the bob (per cycle)
  const harm: string[] = [];
  for (const k of [1, 2, 3, 4]) {
    let re = 0;
    let im = 0;
    ys.forEach((y, i) => {
      re += (y - mean) * Math.cos((2 * Math.PI * k * i) / N);
      im += (y - mean) * Math.sin((2 * Math.PI * k * i) / N);
    });
    harm.push(`${k}:${((2 * Math.hypot(re, im)) / N).toFixed(4)}`);
  }
  console.log(`   bob harmonics (amplitude m, per cycle) ${harm.join(' ')}`);
  const line: string[] = [];
  for (let i = 0; i < N; i += 16) line.push(`${(i / N).toFixed(2)}:${ys[i].toFixed(3)}`);
  console.log('   ', line.join(' '));
}
sim.dispose();
