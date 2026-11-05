// Probe (plan 06 pass 2): one leg tick by tick: body-local ankle/knee, the clip request and contact weight, the residual.
// Usage: vite-node scripts/probe/l1-tick.ts <id> <side> <t0> <t1> [player]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { playbackArmMean, playbackSample, retargetSample, sampleRunClip } from '../../src/sim/run-clip';
import { qInvRot, sub, type Vec3 } from '../../src/sim/vec';
const [id, side, t0s, t1s, whoA] = process.argv.slice(2);
const s = side as 'left' | 'right';
const who = whoA ?? 'R';
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const f = (v: Vec3) => `(${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`;
while (!sim.done && sim.t < Number(t1s)) {
  sim.stepTick();
  if (sim.t < Number(t0s)) continue;
  const pl = sim.players.find((p) => p.id === who)!;
  const core = { p: pl.pose!.segments.core.originWorld, q: pl.pose!.segments.core.rotationWorld };
  const L = (w: Vec3) => qInvRot(core.q, sub(w, core.p));
  const P = def.runClips!;
  const st = pl.run!;
  const smp = playbackSample(st, P) ?? sampleRunClip(P.clips[st.k], st.u);
  const r = retargetSample(smp, st.w, pl.body, def.ragdoll!, core, st.heading, { armSwing: P.armSwing, carrySwing: P.carrySwing, restToe: P.clips[st.k].restToe, armMean: playbackArmMean(st, P) });
  const lm = pl.pose!.jointLandmarksWorld;
  console.log(sim.t.toFixed(3), 'u', st.u.toFixed(3), 'w', st.w.toFixed(2), 'ankle', f(L(lm[`${s}Ankle`])), 'knee', f(L(lm[`${s}Knee`])), 'req', f(r.legs[s].ankleLocal), 'cw', (r.legs[s].contact?.weight ?? 0).toFixed(2), 'res', (pl.pose!.targetResidualM?.[`${s}Leg`] ?? 0).toFixed(3), 'kneeDeg', pl.pose!.hingeDeg[`${s}Knee`].toFixed(1));
}
