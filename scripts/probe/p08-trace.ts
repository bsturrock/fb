// Plan 08 closeout probe: one player's legs at actual physics substeps (dt = 1/240 s) around a boundary. World frame unless
// marked: achieved ankle displacement (dx, cm per substep), its velocity change (dv, m/s) and second difference (d2, cm); the
// ordinary request and its speed, the composed target, offset and rate, sole and pole blends, candidate, soft reach, floor
// lift, continuity departure and push-out, penetration, and the audit's old/new difference at a boundary.
// Usage: vite-node scripts/probe/p08-trace.ts <fixture id> <player> <from> <to> [left|right]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { poseProbe } from '../../src/sim/debug';
const PROBE = poseProbe();
import { len, sub, type Vec3 } from '../../src/sim/vec';

const [id, who, from, to, side] = process.argv.slice(2);
const a = Number(from);
const b = Number(to);
const def = allFixtures().find((d) => d.id === id)!;
const sides = side ? [side as 'left' | 'right'] : (['left', 'right'] as const);
const last: Record<string, Vec3[]> = {};
const f3 = (v: Vec3): string => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
let cont: Record<string, Record<string, unknown>> = {};
PROBE.trace = (key, r) => {
  // the live pose is built first; the audit's old pose after it
  cont[key] ??= r;
};
let seen = 0;
const sim = await Simulation.create(def, {
  debug: { poseProbe: PROBE },
  transitionAudit: true,
  onSubstep: (s) => {
    const pl = s.byId.get(who)!;
    const fp = pl.feet;
    const c = cont;
    cont = {};
    if (!fp || !pl.pose) return;
    const t = s.t;
    const hits = s.transitionDeltas.slice(seen).filter((d) => d.playerId === who);
    seen = s.transitionDeltas.length;
    if (t < a - 1e-9 || t > b + 1e-9) {
      for (const sd of sides) (last[sd] ??= []).push(pl.pose.jointLandmarksWorld[`${sd}Ankle`]);
      return;
    }
    const v = pl.proxy.body.linvel();
    console.log(`t ${t.toFixed(4)} ${who} root v ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)} loco ${pl.loco?.mode} contactW ${(pl.loco?.contactW ?? 0).toFixed(3)} clip w ${(pl.run?.w ?? 0).toFixed(3)} ${s.contactObs[who]?.length ? 'CONTACT' : ''}`);
    for (const sd of sides) {
      const h = (last[sd] ??= []);
      const f = fp.feet[sd];
      const p = pl.pose.jointLandmarksWorld[`${sd}Ankle`];
      h.push(p);
      const n = h.length;
      const dx = n > 1 ? sub(h[n - 1], h[n - 2]) : p;
      const dp = n > 2 ? sub(h[n - 2], h[n - 3]) : dx;
      const d2 = len(sub(dx, dp));
      const info = pl.pose.legInfo?.[sd];
      const r = c[`${who}:${sd}Leg`] as { cont?: { al?: number; push?: number; a0?: number; dd?: number } | null; dc?: Vec3; shown?: Vec3; depth?: number; chosenDepth?: number } | undefined;
      console.log(`  ${sd[0]} ${f.mode}/${f.source}${f.wait ? '+w' : ''}${f.tentative ? '+t' : ''} ankle ${f3(p)} dx ${(len(dx) * 100).toFixed(2)} dv ${(len(sub(dx, dp)) * 240).toFixed(2)} d2 ${(d2 * 100).toFixed(2)} | req ${f3(f.lastRequest ?? p)} rv ${len(f.requestV).toFixed(2)} tgt ${f3(f.target)} solved ${f3(f.solvedW)} off ${len(f.offset).toFixed(3)} offV ${len(f.offsetV).toFixed(2)} stepV ${f3({ ...f.stepH.v, y: f.stepY.v })} vy ${f.liftRateMps.toFixed(2)}`);
      console.log(`    sole o ${f.soleO.toFixed(3)} v ${f.soleV.toFixed(2)} ang ${f.soleAngle.toFixed(3)} base ${f.soleBase.toFixed(3)} poleW ${f.poleW.toFixed(3)} var ${info?.variant} soft ${(info?.softM ?? 0).toFixed(4)} lift ${(info?.liftM ?? 0).toFixed(4)} gap ${f.gapM.toFixed(4)} roll ${f.rollF.toFixed(2)} edge ${f.edgeX.toFixed(3)} | cont al ${r?.cont?.al?.toFixed?.(3)} a0 ${r?.cont?.a0?.toFixed?.(3)} dd ${r?.cont?.dd?.toFixed?.(3)} push ${r?.cont?.push?.toFixed?.(4)} depth ${r?.depth?.toFixed?.(4)}/${r?.chosenDepth?.toFixed?.(4)} dc ${r?.dc ? len(r.dc).toFixed(3) : ''} shown ${r?.shown ? len(r.shown).toFixed(3) : ''}`);
    }
    for (const d of hits) {
      console.log(`  ** boundary ${(d.deltaM * 100).toFixed(2)} cm ${d.landmark}\n     ${d.from}\n     ${d.to}`);
      for (const sd of sides) {
        const l = d.legs[sd];
        console.log(`     ${sd[0]} old ${l.old.kind} ankle ${f3(l.old.ankle)} req ${f3(l.old.request)} var ${l.old.variant} soleO ${l.old.soleO.toFixed(3)} poleW ${l.old.poleW.toFixed(3)} | new ${l.now.kind} ankle ${f3(l.now.ankle)} req ${f3(l.now.request)} var ${l.now.variant} soleO ${l.now.soleO.toFixed(3)} poleW ${l.now.poleW.toFixed(3)} d ${(len(sub(l.now.ankle, l.old.ankle)) * 100).toFixed(2)}`);
      }
    }
  },
});
while (!sim.done && sim.t <= b + 0.02) sim.stepTick();
sim.dispose();
