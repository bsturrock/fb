// Plan 09 probe: shoulder/hip limb direction and twist at every accepted conversion across the fixture registry.
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { qConj, qMul, qRot, v3, type Quat } from '../../src/sim/vec';

const deg = (r: number) => (r * 180) / Math.PI;
function swingTwist(q: Quat) {
  const d = qRot(q, v3(0, -1, 0));
  const swing = Math.acos(Math.max(-1, Math.min(1, -d.y)));
  const ax = v3(-d.z, 0, d.x); // (0,-1,0) x d
  const s = Math.hypot(ax.x, ax.z);
  const h = swing / 2;
  const sw: Quat = s < 1e-9 ? { x: 0, y: 0, z: 0, w: 1 } : { x: (ax.x / s) * Math.sin(h), y: 0, z: (ax.z / s) * Math.sin(h), w: Math.cos(h) };
  const tw = qMul(qConj(sw), q);
  let t = 2 * Math.atan2(tw.y, tw.w);
  if (t > Math.PI) t -= 2 * Math.PI;
  if (t <= -Math.PI) t += 2 * Math.PI;
  return { d, swing: deg(swing), twist: deg(t) };
}
interface Rec { fx: string; pl: string; j: string; fwd: number; out: number; up: number; swing: number; twist: number }
const recs: Rec[] = [];
let n = 0;
for (const def of allFixtures()) {
  if (!def.ragdoll) continue;
  const seen = new Set<string>();
  const sim = await Simulation.create(def, {
    trace: false,
    onSubstep: (s) => {
      for (const pl of s.players) {
        if (!pl.rag || seen.has(pl.id) || !pl.handoff?.accepted) continue;
        seen.add(pl.id);
        n++;
        const qc = pl.rag.bodies.core.rotation();
        for (const j of pl.rag.joints) {
          if (j.kind !== 'shoulder' && j.kind !== 'hip') continue;
          const q = qMul(qConj(qc), pl.rag.bodies[j.child].rotation());
          const st = swingTwist(q);
          const sign = j.id.startsWith('right') ? 1 : -1;
          recs.push({ fx: def.id, pl: pl.id, j: j.kind + ':' + (sign > 0 ? 'R' : 'L'), fwd: deg(Math.atan2(st.d.z, -st.d.y)), out: deg(Math.atan2(st.d.x * sign, -st.d.y)), up: st.d.y, swing: st.swing, twist: st.twist });
        }
      }
    },
  });
  sim.runToEnd();
  sim.dispose();
}
writeFileSync('/private/tmp/claude-501/-Users-brandon-Projects-football-sim-7/e66cdcb4-b3a8-4923-9b39-0e46cc2ee3c7/scratchpad/p09-angles.json', JSON.stringify(recs));
console.log('conversions', n);
const groups = [...new Set(recs.map((r) => r.j))].sort();
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
for (const g of groups) {
  const rs = recs.filter((r) => r.j === g);
  const f = (k: 'swing' | 'twist' | 'fwd' | 'out') => {
    const a = rs.map((r) => r[k]);
    return `${k} min ${q(a, 0).toFixed(1)} p5 ${q(a, 0.05).toFixed(1)} med ${q(a, 0.5).toFixed(1)} p95 ${q(a, 0.95).toFixed(1)} max ${q(a, 1).toFixed(1)}`;
  };
  console.log(g, rs.length, '\n ', f('swing'), '\n ', f('fwd'), '\n ', f('out'), '\n ', f('twist'));
}
