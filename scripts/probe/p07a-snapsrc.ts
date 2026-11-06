// Plan 07a probe: limb snaps with their source. Per limb and tick (proxy shown): the body-local knee/ankle or
// elbow/wrist one-tick second difference and first displacement (as p07-snap), attributed from the pose trace of the
// tick's substeps:
//   achieved  - an achieved (arm system) arm owns the pose (no procedural trace);
//   advance   - the continuity guard advanced past the rate-limited step (pose selection jumped);
//   switch    - the chosen variant changed this tick (rate-limited blend toward it);
//   push      - the shown target was pushed out along contact normals (> 1 cm in some substep: contact motion);
//   request   - none of the above: the ordinary request (gait, clip, plant, ground) moved.
// Usage: vite-node scripts/probe/p07a-snapsrc.ts [id regex] [--min cm] [--list]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { add, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';
import { POSE_DEBUG } from '../../src/sim/pose';
POSE_DEBUG.on = true;

const args = process.argv.slice(2);
const re = new RegExp(args.find((a) => !a.startsWith('--') && !/^\d/.test(a)) ?? '^RH-F6-simultaneous$|^RH-F5-playerBelow$|^L2-F14-oneArmFeet$');
const mi = args.indexOf('--min');
const MIN = mi >= 0 ? +args[mi + 1] / 100 : 0.08;
const list = args.includes('--list');
const LIMBS: Record<string, string[]> = { leftLeg: ['leftKnee', 'leftAnkle'], rightLeg: ['rightKnee', 'rightAnkle'], leftArm: ['leftElbow', 'leftWrist'], rightArm: ['rightElbow', 'rightWrist'] };
export interface SnapRow { fixture: string; key: string; t: number; d2: number; d1: number; src: string; detail: string }
export async function snapSources(defId: string, min = MIN): Promise<{ rows: SnapRow[]; worst: Record<string, SnapRow> }> {
  const def = allFixtures().find((d) => d.id === defId)!;
  const sim = await Simulation.create(def);
  const tickInfo: Record<string, { adv: number; push: number; v: Set<number>; traced: boolean }> = {};
  POSE_DEBUG.trace = (k, r) => {
    const [id, limb] = k.split(':');
    const key = `${id}.${limb}`;
    const s = (tickInfo[key] ??= { adv: 0, push: 0, v: new Set(), traced: false });
    s.traced = true;
    s.v.add(r.v as number);
    const c = r.cont as { a0: number; al: number; dd: number; push: number } | null;
    if (c) {
      if (c.al > c.a0 + 1e-6) s.adv = Math.max(s.adv, (c.al - c.a0) * c.dd);
      s.push = Math.max(s.push, c.push);
    }
  };
  const prev: Record<string, { p: Record<string, Vec3>; pp?: Record<string, Vec3>; v: Set<number> }> = {};
  const rows: SnapRow[] = [];
  const worst: Record<string, SnapRow> = {};
  while (!sim.done) {
    for (const k of Object.keys(tickInfo)) delete tickInfo[k];
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body;
      const o = b.translation();
      const q = b.rotation();
      const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      for (const [limb, keys] of Object.entries(LIMBS)) {
        const key = `${pl.id}.${limb}`;
        const p: Record<string, Vec3> = {};
        for (const n of keys) p[n] = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
        const ti = tickInfo[key];
        const pr = prev[key];
        if (pr?.pp) {
          let d2 = 0;
          let d1 = 0;
          let worstN = keys[0];
          for (const n of keys) {
            const x = len(add(sub(p[n], scale(pr.p[n], 2)), pr.pp[n]));
            if (x > d2) {
              d2 = x;
              worstN = n;
              d1 = len(sub(p[n], pr.p[n]));
            }
          }
          const vs = ti ? [...ti.v] : [];
          const switched = !!ti && vs.some((v) => !pr.v.has(v));
          const src = !ti?.traced ? 'achieved' : ti.adv > 0.005 ? 'advance' : switched ? 'switch' : ti.push > 0.01 ? 'push' : 'request';
          const row: SnapRow = { fixture: defId, key, t: sim.t, d2, d1, src, detail: `${worstN} v ${[...pr.v].join('/')}->${vs.join('/')} adv ${((ti?.adv ?? 0) * 100).toFixed(1)}cm push ${((ti?.push ?? 0) * 100).toFixed(1)}cm ${pl.controlMode}` };
          if (!worst[key] || d2 > worst[key].d2) worst[key] = row;
          if (d2 > min) rows.push(row);
        }
        prev[key] = { p, pp: pr?.p, v: ti ? new Set(ti.v) : new Set() };
      }
    }
  }
  POSE_DEBUG.trace = undefined;
  sim.dispose();
  return { rows, worst };
}

if (!process.env.SNAPSRC_LIB) {
  for (const def of allFixtures()) {
    if (!re.test(def.id)) continue;
    const { rows, worst } = await snapSources(def.id);
    const bySrc: Record<string, number> = {};
    for (const r of rows) bySrc[r.src] = (bySrc[r.src] ?? 0) + 1;
    console.log(`${def.id}  snaps > ${(MIN * 100).toFixed(0)} cm by source: ${JSON.stringify(bySrc)}`);
    for (const w of Object.values(worst)) if (w.d2 > MIN) console.log(`  worst ${w.key.padEnd(12)} ${(w.d2 * 100).toFixed(1)} cm (disp ${(w.d1 * 100).toFixed(1)} cm) at ${w.t.toFixed(3)} [${w.src}] ${w.detail}`);
    if (list) for (const r of rows) console.log(`    ${r.t.toFixed(3)} ${r.key.padEnd(12)} ${(r.d2 * 100).toFixed(1)} cm disp ${(r.d1 * 100).toFixed(1)} [${r.src}] ${r.detail}`);
  }
}
