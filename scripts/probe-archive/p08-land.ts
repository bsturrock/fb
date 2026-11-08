// Plan 08 probe: one audited boundary in detail: both compositions' legs and the foot state around it.
// Usage: vite-node scripts/probe/p08-land.ts <id> <player> <side> <t> [window s]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { footFrame } from '../../src/sim/pose';

const [id, player, side, tS, winS] = process.argv.slice(2);
const T = Number(tS);
const W = Number(winS ?? 0.0126);
const s = side as 'left' | 'right';
const f3 = (v: { x: number; y: number; z: number }): string => `${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`;
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, {
  transitionAudit: true,
  onSubstep: (S) => {
    if (Math.abs(S.t - T) > W) return;
    const pl = S.players.find((p) => p.id === player)!;
    const f = pl.feet!.feet[s];
    const q = footFrame(pl.pose!, s);
    const info = pl.pose!.legInfo?.[s];
    const core = pl.proxy.body.translation();
    console.log(`t ${S.t.toFixed(4)} ${f.mode}/${f.source} tent ${f.tentative} tgt ${f3(f.target)} ankle ${f3(f.ankleW)} req ${info ? f3(info.request) : ''} var ${info?.variant} lift ${info?.liftM.toFixed(4)} soft ${info?.softM.toFixed(4)} gap ${f.gapM.toFixed(4)} el ${f.elapsedS.toFixed(4)}/${f.durS.toFixed(4)} late ${f.lateS.toFixed(4)} pitch ${pl.pose!.anklePitchDeg?.[s]?.toFixed(1)} soleA ${(f.soleAngle * 57.3).toFixed(1)} soleO ${(f.soleO * 57.3).toFixed(1)} soleW ${f.soleW.toFixed(2)} core ${core.x.toFixed(3)} ${core.z.toFixed(3)} qy ${q.y.toFixed(3)}`);
    const d = S.transitionDeltas.at(-1);
    if (d && d.playerId === player && Math.abs(d.t - S.t) < 1e-9) {
      const L = d.legs[s];
      console.log(`   AUDIT raw ${(d.rawM * 100).toFixed(2)} acc ${(d.deltaM * 100).toFixed(2)} ${d.from} > ${d.to}`);
      console.log(`   old ${JSON.stringify(L.old)}`);
      console.log(`   now ${JSON.stringify(L.now)}`);
    }
  },
});
while (!sim.done) sim.stepTick();
sim.dispose();
