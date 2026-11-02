import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
for (const def of [G2.g2f3Separation(), G2.g2f3Overload(), G2.g2f3Turn(), G2.g2f3Reacquire(), G2.g2f7()]) {
  const s = await Simulation.create(def); s.runToEnd();
  const last = s.trace[s.trace.length-1];
  console.log(def.id, s.result, s.t.toFixed(3), JSON.stringify(last.players.R.p), JSON.stringify(last.players.D.p), def.durationS);
  if (def.id==='G2-F7') { for (const r of s.trace) if (r.players.D.wrap && s.trace.indexOf(r)%6===0) console.log(r.t.toFixed(2), r.players.D.wrap, r.players.D.arm?.left?.N?.toFixed(1), r.players.D.arm?.right?.N?.toFixed(1)); }
}
