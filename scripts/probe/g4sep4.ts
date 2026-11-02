// Probe: hinge angle and contact state at the worst joint-separation frames.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { anchorErrors, hingeAngles } from '../../src/sim/ragdoll';
const nolim = process.argv[2] === 'nolim';
for (const def of gate4Fixtures().filter((d) => /F2/.test(d.id))) {
  const sim = await Simulation.create(def);
  let worst = 0, worstJ = '', hingeMin = 1e9, hingeMax = -1e9;
  for (;;) {
    sim.stepTick();
    const r = sim.players[0].rag;
    if (r && nolim && !(r as any)._p) { for (const j of r.joints) if (j.limitsRad) (j.joint as any).setLimits(-3.1, 3.1); (r as any)._p = 1; }
    if (r) {
      const ae = anchorErrors(r);
      const h = hingeAngles(r);
      for (const [j, m] of Object.entries(ae)) {
        if (m > 0.01) console.log(' ', sim.t.toFixed(3), j, (m * 1000).toFixed(1), 'hinge', JSON.stringify(Object.fromEntries(Object.entries(h).map(([k, v]) => [k, +v.toFixed(0)]))));
        if (m > worst) { worst = m; worstJ = j; }
      }
      for (const [k, v] of Object.entries(h)) if (k !== 'neck') { hingeMin = Math.min(hingeMin, v); hingeMax = Math.max(hingeMax, v); }
    }
    if (sim.result !== 'running' || sim.t >= def.durationS - 1e-9) break;
  }
  console.log(def.id, 'worst', (worst * 1000).toFixed(1), worstJ, 'hinge range', hingeMin.toFixed(1), hingeMax.toFixed(1));
  sim.dispose();
}
