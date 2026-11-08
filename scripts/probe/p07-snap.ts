// Plan 07 probe: limb snapping. Per player and limb, every tick: the body-local knee/ankle and elbow/wrist landmarks
// (proxy frame) and the chosen variant (pose memory). A snap is a one-tick second difference |p(t) - 2p(t-1) + p(t-2)|
// over 3 cm (smooth motion, the gait included, stays far below it). Reports variant switches, snaps, the largest
// with its time, variant change, straight-fallback flip, floor lift change (primary leg) and control mode, while the
// proxy is shown (before any ragdoll). Usage: vite-node scripts/probe/p07-snap.ts [id regex] [--list]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { add, dist, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';
import { poseProbe } from '../../src/sim/debug';
const PROBE = poseProbe({ on: true });

const args = process.argv.slice(2);
const re = new RegExp(args.find((a) => !a.startsWith('--')) ?? '^RH-F6-simultaneous$|^RH-F5-playerBelow$|^L2-F14-');
const list = args.includes('--list');
const LIMBS: Record<string, string[]> = { leftLeg: ['leftKnee', 'leftAnkle'], rightLeg: ['rightKnee', 'rightAnkle'], leftArm: ['leftElbow', 'leftWrist'], rightArm: ['rightElbow', 'rightWrist'] };
const BIG = 0.03;
for (const def of allFixtures()) {
  if (!re.test(def.id)) continue;
  const sim = await Simulation.create(def, { debug: { poseProbe: PROBE } });
  const prev: Record<string, { p: Record<string, Vec3>; pp?: Record<string, Vec3>; v: number | undefined; mode: string; fb: boolean; lift: number }> = {};
  const st: Record<string, { sw: number; max: number; at: number; what: string; big: number; bigList: string[] }> = {};
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body;
      const o = b.translation();
      const q = b.rotation();
      const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      for (const [limb, keys] of Object.entries(LIMBS)) {
        const k = `${pl.id}.${limb}`;
        const p: Record<string, Vec3> = {};
        for (const n of keys) p[n] = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
        const v = pl.poseMemory[limb];
        const joint = keys[0];
        const fb = pl.pose.straightFallback.includes(joint);
        const dl = PROBE.legs[`${pl.id}:${limb.replace('Leg', '')}`];
        const lift = limb.endsWith('Leg') && dl ? dist(dl.lifted, dl.ik) : 0;
        const cd = PROBE.cont[`${pl.id}:${limb}`];
        const cont = cd ? ` a0 ${cd.a0.toFixed(2)} al ${cd.al.toFixed(2)} dd ${(cd.dd * 100).toFixed(0)}cm` : '';
        const s = (st[k] ??= { sw: 0, max: 0, at: 0, what: '', big: 0, bigList: [] });
        const pr = prev[k];
        if (pr) {
          if (pr.v !== v) s.sw++;
          const d2 = (n: string) => (pr.pp ? len(add(sub(p[n], scale(pr.p[n], 2)), pr.pp[n])) : 0);
          const j = Math.max(...keys.map(d2));
          const worst = keys.reduce((a, n) => (d2(n) > d2(a) ? n : a));
          const what = `${worst} v${pr.v}->${v}${pr.fb !== fb ? ` fallback ${pr.fb}->${fb}` : ''} lift ${(pr.lift * 100).toFixed(1)}->${(lift * 100).toFixed(1)}cm ${pr.mode}->${pl.controlMode}${cont}`;
          if (j > s.max) Object.assign(s, { max: j, at: sim.t, what });
          if (j > BIG) {
            s.big++;
            if (list) s.bigList.push(`${sim.t.toFixed(3)} ${(j * 100).toFixed(1)}cm ${what}`);
          }
        }
        prev[k] = { p, pp: pr?.p, v, mode: pl.controlMode, fb, lift };
      }
    }
  }
  console.log(`${def.id}`);
  for (const [k, s] of Object.entries(st)) {
    console.log(`  ${k.padEnd(12)} switches ${String(s.sw).padStart(3)}  snaps>3cm ${String(s.big).padStart(3)}  max ${(s.max * 100).toFixed(1)} cm at ${s.at.toFixed(3)} (${s.what})`);
    for (const l of s.bigList) console.log(`      ${l}`);
  }
  sim.dispose();
}
