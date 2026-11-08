// Plan 08a probe: one fixture with and without the carry profile: first core trace difference, events, D's right leg.
import { allFixtures } from '../../src/sim/fixtures/index';
import { Simulation } from '../../src/sim/simulation';
import { dist } from '../../src/sim/vec';
const id = process.argv[2] ?? 'L3-F9-noProbe-prep';
const def = allFixtures().find((d) => d.id === id)!;
const base = { ...def, carry: undefined, ...(def.rules ? { rules: { ...def.rules, ballSource: 'carryPalm' as const } } : {}) };
async function go(d: typeof def) {
  const rows: { t: number; c: Record<string, any>; knee: Record<string, any>; plan: string }[] = [];
  const sim = await Simulation.create(d, {
    onSubstep: (s) => {
      const c: Record<string, any> = {};
      const knee: Record<string, any> = {};
      for (const p of s.players) {
        c[p.id] = s.bulk(p).com;
        knee[p.id] = p.pose?.jointLandmarksWorld.rightKnee;
      }
      const D = s.players.find((p) => p.id === 'D');
      rows.push({ t: s.t, c, knee, plan: D?.feet ? `${D.feet.feet.left.mode}/${D.feet.feet.left.source} ${D.feet.feet.right.mode}/${D.feet.feet.right.source} ${D.loco?.mode}` : '' });
    },
  });
  sim.runToEnd();
  const ev = sim.events.filter((e) => /contactBegin|contactEnd|handoff|ruleEnding|loco|Mode/i.test(e.type)).slice(0, 14).map((e) => `${e.t.toFixed(4)} ${e.type} ${e.playerId ?? ''}`);
  sim.dispose();
  return { rows, ev };
}
const a = await go(base);
const b = await go(def);
console.log('BASE', a.ev.join(' | '));
console.log('CARRY', b.ev.join(' | '));
let core = -1, knee = -1, plan = -1;
for (let i = 0; i < Math.min(a.rows.length, b.rows.length); i++) {
  for (const k of Object.keys(a.rows[i].c)) {
    if (core < 0 && dist(a.rows[i].c[k], b.rows[i].c[k]) > 1e-9) core = a.rows[i].t, console.log('core differs', k, a.rows[i].t);
    if (knee < 0 && a.rows[i].knee[k] && b.rows[i].knee[k] && dist(a.rows[i].knee[k], b.rows[i].knee[k]) > 1e-6) knee = a.rows[i].t, console.log('knee differs', k, a.rows[i].t, dist(a.rows[i].knee[k], b.rows[i].knee[k]));
  }
  if (plan < 0 && a.rows[i].plan !== b.rows[i].plan) plan = a.rows[i].t, console.log('plan differs', a.rows[i].t, a.rows[i].plan, '::', b.rows[i].plan);
}
process.exit(0);
