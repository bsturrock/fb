// Plan 07 probe: heel lift. Per foot, the height of the shoe's rear sole edge (both heel corners, lowest) above the
// turf on every supported tick, reported as the max over frames where the foot is meant to be flat: planted (footwork),
// or any supported frame for players without a planner; plus the frame/time of that max, the root height and the knee.
// Usage: vite-node scripts/probe/p07-heel.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { footFrame } from '../../src/sim/pose';
import { RAGDOLL_G4 as DEFAULT_POSE_PROFILE } from '../../src/sim/profiles';
import { qRot, v3 } from '../../src/sim/vec';
const re = new RegExp(process.argv[2] ?? '^L2-F1-|^L2-F13-load$');
for (const def of allFixtures()) {
  if (!re.test(def.id)) continue;
  const R = def.ragdoll ?? DEFAULT_POSE_PROFILE;
  const he = R.shoe.halfExtents;
  const sim = await Simulation.create(def);
  const worst: Record<string, { lift: number; t: number; h: number; knee: number }> = {};
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (!pl.pose || pl.rag || pl.controlMode !== 'supported' || !pl.sus?.probe.valid) continue;
      const gy = pl.sus.probe.groundY;
      for (const s of ['left', 'right'] as const) {
        if (pl.feet && pl.feet.feet[s].mode !== 'planted') continue;
        const q = footFrame(pl.pose, s);
        const c = pl.pose.jointLandmarksWorld[`${s}Shoe`];
        let heel = Infinity;
        for (const x of [-he.x, he.x]) heel = Math.min(heel, c.y + qRot(q, v3(x, -he.y, -he.z)).y - gy);
        const k = `${pl.id}.${s}`;
        if (!worst[k] || heel > worst[k].lift) worst[k] = { lift: heel, t: sim.t, h: pl.sus.probe.heightM, knee: pl.pose.hingeDeg[`${s}Knee`] };
      }
    }
  }
  console.log(def.id, Object.entries(worst).map(([k, w]) => `${k} heel ${(w.lift * 100).toFixed(1)} cm @${w.t.toFixed(2)} (h ${w.h.toFixed(3)}, knee ${w.knee.toFixed(0)})`).join('  '));
  sim.dispose();
}
