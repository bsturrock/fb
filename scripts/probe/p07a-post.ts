// Plan 07a probe: the first solved steps after every accepted handoff. Per converted player, for the first N substeps
// after the switch: deepest contact penetration (players / floor), largest per-point and per-step total normal impulse
// (as body weights over the step), external impulse on the bulk (dP - m g dt, body weights), mechanical energy gain,
// largest joint anchor separation, and every passive grip's palm-anchor gap and its per-step change (hand anchor jumps).
// Usage: vite-node scripts/probe/p07a-post.ts [id regex] [N substeps, default 24]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { anchorErrors, bulkOf, landmarkWorld, SEGMENTS } from '../../src/sim/ragdoll';
import { dist, len, sub, toWorld, vc, type Vec3 } from '../../src/sim/vec';

const re = new RegExp(process.argv[2] ?? '^RH-F6-simultaneous$|^RH-F5-playerBelow$|^L2-F14-oneArmFeet$|^L2-F15-');
const N = +(process.argv[3] ?? 24);
export interface PostStats { id: string; t: number; worstPlayerPenM: number; worstFloorPenM: number; firstPlayerPenM: number; maxPointBW: number; maxStepBW: number; maxExtBW: number; dKeJ: number; maxAnchorM: number; gripGapM: number; gripJumpM: number; grips: number }
export async function postStats(defId: string, n = N): Promise<PostStats[]> {
  const def = allFixtures().find((d) => d.id === defId)!;
  const sim = await Simulation.create(def);
  const S = sim as any;
  const g = Math.abs(def.solver.gravityY);
  const out: PostStats[] = [];
  const st = new Map<string, PostStats & { step0: number; prevP: Vec3; ke0: number; gap: Map<string, number> }>();
  const origStep = S.stepSubstep.bind(S);
  S.stepSubstep = (sub0: number) => {
    origStep(sub0);
    const dt = S.physics.dt;
    for (const pl of sim.players) {
      const h = pl.handoff;
      if (!pl.rag || !h || h.outcome !== 'accepted') continue;
      let r = st.get(pl.id);
      if (!r) {
        const a = h.audit!.after;
        r = { id: pl.id, t: h.t, worstPlayerPenM: 0, worstFloorPenM: 0, firstPlayerPenM: 0, maxPointBW: 0, maxStepBW: 0, maxExtBW: 0, dKeJ: 0, maxAnchorM: 0, gripGapM: 0, gripJumpM: 0, grips: 0, step0: h.step, prevP: { x: a.P[0], y: a.P[1], z: a.P[2] }, ke0: a.keJ + a.massKg * g * a.com[1], gap: new Map() };
        st.set(pl.id, r);
        out.push(r);
      }
      const k = sim.steps - r.step0;
      if (k > n) continue;
      const bodies = SEGMENTS.map((s) => pl.rag!.bodies[s]);
      const m = bodies.reduce((a, b) => a + b.mass(), 0);
      let pp = 0;
      let fp = 0;
      let stepImp = 0;
      for (const c of sim.contacts) {
        const mine = c.a.playerId === pl.id || c.b.playerId === pl.id;
        if (!mine) continue;
        const other = c.a.playerId === pl.id ? c.b : c.a;
        for (const p of c.points) {
          const d = Math.max(0, -p.dist);
          if (other.playerId === null) fp = Math.max(fp, d);
          else if (other.playerId !== pl.id) pp = Math.max(pp, d);
          r.maxPointBW = Math.max(r.maxPointBW, p.impulse / dt / (m * g));
          stepImp += p.impulse;
        }
      }
      if (k === 1) r.firstPlayerPenM = pp;
      r.worstPlayerPenM = Math.max(r.worstPlayerPenM, pp);
      r.worstFloorPenM = Math.max(r.worstFloorPenM, fp);
      r.maxStepBW = Math.max(r.maxStepBW, stepImp / dt / (m * g));
      const b = bulkOf(bodies);
      const ext = sub(sub(b.P, r.prevP), { x: 0, y: -m * g * dt, z: 0 });
      r.maxExtBW = Math.max(r.maxExtBW, len(ext) / dt / (m * g));
      r.prevP = b.P;
      // Include the first collision response, using the switched state before any solve.
      const E = b.ke + m * g * b.com.y;
      r.dKeJ = Math.max(r.dKeJ, E - r.ke0);
      r.maxAnchorM = Math.max(r.maxAnchorM, ...Object.values(anchorErrors(pl.rag)));
      // passive grips owned by this player: palm landmark to target anchor
      for (const gr of S.arms?.grips?.values() ?? []) {
        if (gr.ownerId !== pl.id || !gr.passive) continue;
        const tgt = S.arms.player(gr.targetId);
        const tb = S.arms.partBody(tgt, gr.targetPart);
        const anchor = toWorld({ p: vc(tb.translation()), q: { ...tb.rotation() } }, gr.targetPointLocal);
        const palm = landmarkWorld(pl.rag, `${gr.arm}Palm`);
        const gap = dist(anchor, palm);
        const prev = r.gap.get(gr.id);
        if (prev !== undefined) r.gripJumpM = Math.max(r.gripJumpM, Math.abs(gap - prev));
        r.gap.set(gr.id, gap);
        r.gripGapM = Math.max(r.gripGapM, gap);
        r.grips = r.gap.size;
      }
    }
  };
  while (!sim.done) sim.stepTick();
  sim.dispose();
  return out.map(({ id, t, worstPlayerPenM, worstFloorPenM, firstPlayerPenM, maxPointBW, maxStepBW, maxExtBW, dKeJ, maxAnchorM, gripGapM, gripJumpM, grips }) => ({ id, t, worstPlayerPenM, worstFloorPenM, firstPlayerPenM, maxPointBW, maxStepBW, maxExtBW, dKeJ, maxAnchorM, gripGapM, gripJumpM, grips }));
}

if (!process.env.POST_LIB) {
  const cm = (x: number) => (x * 100).toFixed(1).padStart(5);
  console.log(`first ${N} substeps after each accepted handoff: pen (player first/worst, floor) cm | point/step/ext BW | dE J | anchor mm | grips gap/jump cm`);
  for (const def of allFixtures()) {
    if (!re.test(def.id)) continue;
    for (const s of await postStats(def.id))
      console.log(`${def.id.padEnd(26)} ${s.id} @${s.t.toFixed(3)}  pen ${cm(s.firstPlayerPenM)}/${cm(s.worstPlayerPenM)} ${cm(s.worstFloorPenM)} | ${s.maxPointBW.toFixed(1).padStart(5)} ${s.maxStepBW.toFixed(1).padStart(5)} ${s.maxExtBW.toFixed(1).padStart(5)} | ${s.dKeJ.toFixed(1).padStart(6)} | ${(s.maxAnchorM * 1000).toFixed(1).padStart(5)} | ${s.grips} ${cm(s.gripGapM)}/${cm(s.gripJumpM)}`);
  }
}
