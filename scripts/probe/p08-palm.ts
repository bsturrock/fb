// Plan 08 probe: a palm around an arm owner change: old and new at the boundary, the achieved body-frame motion around it.
// Usage: vite-node scripts/probe/p08-palm.ts <id> <player> <left|right> <t> [window s]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { qInvRot, sub, type Vec3 } from '../../src/sim/vec';

const [id, player, side, tS, winS] = process.argv.slice(2);
const T = Number(tS);
const W = Number(winS ?? 0.0126);
const f3 = (v: Vec3): string => `${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`;
let last: Vec3 | null = null;
const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!, {
  transitionAudit: true,
  onSubstep: (S) => {
    if (Math.abs(S.t - T) > W) return;
    const pl = S.players.find((p) => p.id === player)!;
    const b = pl.proxy.body;
    const L = qInvRot(b.rotation(), sub(pl.pose!.jointLandmarksWorld[`${side}Palm`], b.translation() as Vec3));
    const dM = last ? Math.hypot(L.x - last.x, L.y - last.y, L.z - last.z) : 0;
    const d = S.transitionDeltas.at(-1);
    const hit = d && d.playerId === player && Math.abs(d.t - S.t) < 1e-9;
    console.log(`t ${S.t.toFixed(4)} palmL ${f3(L)} moved ${(dM * 100).toFixed(2)} cm hands ${pl.intent.debug?.readyHands ? 'ready' : '-'} braceW ${pl.loco?.braceW?.toFixed(3)} mode ${pl.loco?.mode}${hit ? ` | AUDIT ${(d!.deltaM * 100).toFixed(2)} ${d!.landmark} ${d!.from.split(' ').slice(4, 6).join(' ')} > ${d!.to.split(' ').slice(4, 6).join(' ')}` : ''}`);
    last = L;
  },
});
while (!sim.done) sim.stepTick();
sim.dispose();
