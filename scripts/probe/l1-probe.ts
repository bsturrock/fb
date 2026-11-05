// Probe (plan 06): run-clip playback per tick (phase, weight, rate, residuals) and stance quality from the achieved
// shoe boxes: lowest shoe point height during the clip's stance intervals (float gap) and the horizontal speed of the
// lowest point while it is within 1 cm of the floor (contact slip). Usage: vite-node scripts/probe/l1-probe.ts <id> [every]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { footFrame, legShapes, type PoseShape } from '../../src/sim/pose';
import { qRot, v3, type Vec3 } from '../../src/sim/vec';
const id = process.argv[2] ?? 'L1-F1-fastRun';
const every = Number(process.argv[3] ?? 6);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const R = def.ragdoll!;
function lowest(shapes: PoseShape[]): Vec3 {
  let best = v3(0, Infinity, 0);
  for (const s of shapes) {
    if (s.kind !== 'box') continue;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z));
      const p = v3(s.c.x + c.x, s.c.y + c.y, s.c.z + c.z);
      if (p.y < best.y) best = p;
    }
  }
  return best;
}
function corners(shapes: PoseShape[]): Vec3[] {
  const out: Vec3[] = [];
  for (const s of shapes) {
    if (s.kind !== 'box') continue;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z));
      out.push(v3(s.c.x + c.x, s.c.y + c.y, s.c.z + c.z));
    }
  }
  return out;
}
const prev: Record<string, Vec3[]> = {};
const slip: Record<string, number[]> = {};
const gap: Record<string, number[]> = {};
const resMax: Record<string, number> = {};
const resAll: Record<string, number[]> = {};
const inSt = (u: number, [a, b]: number[]) => (a <= b ? u >= a && u < b : u >= a || u < b);
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) {
    const row = sim.trace[sim.trace.length - 1].players[pl.id];
    const pose = pl.pose;
    if (!pose || !row.run) continue;
    const lm = pose.jointLandmarksWorld;
    const clip = def.runClips!.clips[0];
    for (const s of ['left', 'right'] as const) {
      const sh = legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], pose.segments[`${s}Shin`].rotationWorld, footFrame(pose, s));
      const lo = lowest(sh);
      const cs = corners(sh);
      const k = `${pl.id}:${s}`;
      if (row.run.w > 0.99 && inSt(row.run.u, clip.record.stance[s])) (gap[k] ??= []).push(lo.y);
      // slip: slowest shoe corner that stays within 1 cm of the floor over consecutive ticks (same corner)
      if (prev[k] && row.run.w > 0.99) {
        let v = Infinity;
        cs.forEach((c, i) => { const q = prev[k][i]; if (c.y < 0.01 && q.y < 0.01) v = Math.min(v, Math.hypot(c.x - q.x, c.z - q.z) / sim.tickS); });
        if (v < Infinity) (slip[k] ??= []).push(v);
      }
      prev[k] = cs;
    }
    for (const [kk, vv] of Object.entries(row.run.res)) {
      resMax[`${pl.id}:${kk}`] = Math.max(resMax[`${pl.id}:${kk}`] ?? 0, vv);
      (resAll[`${pl.id}:${kk}`] ??= []).push(vv);
    }
    if (sim.tick % every === 0)
      console.log(sim.t.toFixed(3), pl.id, row.run.clip.padEnd(15), 'u', row.run.u.toFixed(3), 'w', row.run.w.toFixed(2), 'wt', row.run.wt.toFixed(2), 'r', row.run.r.toFixed(3), 'b', row.run.b.toFixed(2), 'v', row.run.v.toFixed(2), 'knee L', pose.hingeDeg.leftKnee?.toFixed(0), 'R', pose.hingeDeg.rightKnee?.toFixed(0), 'res', JSON.stringify(row.run.res), 'mem', JSON.stringify(pl.poseMemory), pl.representation, pl.controlMode);
  }
}
const stat = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, min: s[0]?.toFixed(3), med: s[Math.floor(s.length / 2)]?.toFixed(3), p90: s[Math.floor(s.length * 0.9)]?.toFixed(3), max: s[s.length - 1]?.toFixed(3) }; };
for (const [k, v] of Object.entries(gap)) console.log('stance gap (lowest shoe point, m)', k, JSON.stringify(stat(v)));
for (const [k, v] of Object.entries(slip)) console.log('contact slip (lowest point < 1 cm, m/s)', k, JSON.stringify(stat(v)));
for (const [k, v] of Object.entries(resAll)) console.log('residual (m)', k, JSON.stringify(stat(v)));
console.log('max residuals', JSON.stringify(Object.fromEntries(Object.entries(resMax).map(([k, v]) => [k, +v.toFixed(3)]))));
console.log('result', sim.result, JSON.stringify(sim.summary().players));
for (const pl of sim.players) if (pl.handoff) console.log('handoff', pl.id, pl.handoff.outcome, pl.handoff.t.toFixed(3), pl.handoff.report.reasons, pl.handoff.audit?.ok);
