import { Simulation } from '../../src/sim/simulation';
import { asL4, tippedFall } from '../../src/sim/fixtures/falls';
const out: string[] = [];
for (const dir of ['forward', 'back', 'side', 'oblique'] as const)
  for (const role of ['runner', 'defender'] as const)
    for (const on of [true, false]) {
      const def = asL4(tippedFall({ id: 'x', dir, role }), `x-${dir}-${role}-${on}`, 't', on ? undefined : null);
      const sim = await Simulation.create(def, { trace: false });
      sim.runToEnd();
      const pl = sim.players[0];
      const ex = sim.exportFixture() as any;
      const env = ex.jointLimits.R.envelope.joints;
      const f = ex.fallEffort?.R;
      const over = sim.events.filter((e) => e.type === 'fallEffortOver');
      out.push(`${def.id} maxSpeed ${pl.ragStats!.maxSpeed.toFixed(2)} anchor ${(pl.ragStats!.maxAnchorErrM * 1000).toFixed(1)}mm over ${Math.max(...env.map((j: any) => j.maxOverDeg)).toFixed(1)} run ${Math.max(...env.map((j: any) => j.maxOverRunS)).toFixed(3)} passive+ ${env.reduce((s: number, j: any) => s + j.passivePositiveJ, 0).toFixed(1)} brace ${JSON.stringify(f?.brace)} W ${f?.positiveWorkJ} Wn ${f?.negativeWorkJ} peakP ${f?.peakPositiveW} overN ${f?.overPowerSubsteps}`);
      if (over.length && sim.fall) {
        const t = over[0].t;
        const rows = sim.fall.ledger.filter((e) => Math.abs(e.step - (over[0].step - 1)) <= 1).map((e) => `  s${e.step} ${e.joint} ${e.appliedNm.toFixed(1)}Nm pred ${e.predictedW.toFixed(1)} real ${e.realizedW.toFixed(1)}`);
        out.push(`  over at ${t}\n` + rows.join('\n'));
      }
      sim.dispose();
    }
console.log(out.join('\n'));
