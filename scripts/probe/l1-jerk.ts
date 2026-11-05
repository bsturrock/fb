// Probe (plan 06 pass 2): frame-to-frame smoothness of the sampled pose. Per tick, body-local landmarks (knee, ankle,
// shoe, elbow, palm) and the clip's retargeted ankle request; second differences |p[i+1] - 2 p[i] + p[i-1]| (m) per
// tick. Spikes far above the request's own second difference are discontinuities added by the pose solve.
// Usage: vite-node scripts/probe/l1-jerk.ts <id> [player] [top]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { playbackArmMean, playbackSample, retargetSample } from '../../src/sim/run-clip';
import { qInvRot, sub, len, scale, type Vec3 } from '../../src/sim/vec';
const id = process.argv[2] ?? 'L1-F1-fastRun';
const who = process.argv[3] ?? 'R';
const top = Number(process.argv[4] ?? 12);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const keys = ['leftKnee', 'leftAnkle', 'leftShoe', 'rightKnee', 'rightAnkle', 'rightShoe', 'leftElbow', 'leftPalm', 'rightElbow', 'rightPalm'];
const hist: { t: number; lm: Record<string, Vec3>; req: Record<string, Vec3>; mem: string; res: string; w: number }[] = [];
while (!sim.done) {
  sim.stepTick();
  const pl = sim.players.find((p) => p.id === who)!;
  if (!pl.pose || pl.rag) break;
  const core = { p: pl.pose.segments.core.originWorld, q: pl.pose.segments.core.rotationWorld };
  const L = (w: Vec3) => qInvRot(core.q, sub(w, core.p));
  const lm: Record<string, Vec3> = {};
  for (const k of keys) lm[k] = L(pl.pose.jointLandmarksWorld[k]);
  const req: Record<string, Vec3> = {};
  const P = def.runClips!;
  const smp = P && pl.run && pl.run.w > 0 ? playbackSample(pl.run, P) : null;
  if (smp) {
    const r = retargetSample(smp, pl.run!.w, pl.body, def.ragdoll!, core, pl.run!.heading, { armSwing: P.armSwing, carrySwing: P.carrySwing, restToe: P.clips[pl.run!.k].restToe, armMean: playbackArmMean(pl.run!, P) });
    for (const s of ['left', 'right'] as const) req[`${s}Ankle`] = r.legs[s].ankleLocal;
    if (r.arms) for (const s of ['left', 'right'] as const) req[`${s}Palm`] = s === 'right' && pl.setup.role === 'runner' ? scale(r.arms[s].swingLocal, r.carrySwing) : r.arms[s].palmLocal;
  }
  hist.push({ t: sim.t, lm, req, mem: JSON.stringify(pl.poseMemory), res: JSON.stringify(pl.pose.targetResidualM ?? {}), w: pl.run?.w ?? 0 });
}
const spikes: { t: number; k: string; a: number; ra: number; mem: string; res: string }[] = [];
const per: Record<string, number[]> = {};
for (let i = 1; i < hist.length - 1; i++)
  for (const k of keys) {
    const [a, b, c] = [hist[i - 1].lm[k], hist[i].lm[k], hist[i + 1].lm[k]];
    const acc = len({ x: c.x - 2 * b.x + a.x, y: c.y - 2 * b.y + a.y, z: c.z - 2 * b.z + a.z });
    let ra = NaN;
    const q = [hist[i - 1].req[k], hist[i].req[k], hist[i + 1].req[k]];
    if (q.every(Boolean)) ra = len({ x: q[2].x - 2 * q[1].x + q[0].x, y: q[2].y - 2 * q[1].y + q[0].y, z: q[2].z - 2 * q[1].z + q[0].z });
    (per[k] ??= []).push(acc);
    if (!Number.isNaN(ra)) (per[`req:${k}`] ??= []).push(ra);
    spikes.push({ t: hist[i].t, k, a: acc, ra, mem: hist[i].mem, res: hist[i].res });
  }
const st = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return `med ${s[s.length >> 1].toFixed(4)} p90 ${s[Math.floor(s.length * 0.9)].toFixed(4)} p99 ${s[Math.floor(s.length * 0.99)].toFixed(4)} max ${s[s.length - 1].toFixed(4)}`; };
for (const [k, v] of Object.entries(per)) console.log(k.padEnd(11), st(v));
spikes.sort((x, y) => y.a - x.a);
for (const s of spikes.slice(0, top)) console.log(s.t.toFixed(3), s.k.padEnd(11), 'acc', s.a.toFixed(4), 'reqAcc', s.ra.toFixed(4), s.mem, s.res);
