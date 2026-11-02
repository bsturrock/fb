// F5 handoff numbers: R-D contact impulse while R is a ragdoll, deepest cross-owner overlap, divergence from solo runs.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import type { FixtureDef } from '../../src/sim/fixture';
const without = (def: FixtureDef, id: string): FixtureDef => ({ ...def, id: `${def.id}-solo`, players: def.players.filter((p) => p.id !== id), diagnostics: def.diagnostics ? { conversions: def.diagnostics.conversions?.filter((c) => c.playerId !== id) } : undefined });
const run = async (def: FixtureDef, each?: (s: Simulation) => void) => { const s = await Simulation.create(def); while (!s.done) { s.stepTick(); each?.(s); } return s; };
const pathOf = (sim: Simulation, id: string) => sim.trace.map((r) => r.players[id]?.p);
const div = (a: ReturnType<typeof pathOf>, b: ReturnType<typeof pathOf>) => { let m = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] && b[i]) m = Math.max(m, Math.hypot(a[i]![0] - b[i]![0], a[i]![1] - b[i]![1], a[i]![2] - b[i]![2])); return m; };
for (const id of ['G4-F5-standingOpponent', 'G4-F5-twoRagdolls']) {
  const def = gate4Fixtures().find((f) => f.id === id)!;
  let imp = 0, deep = 0, n = 0, dMaxDrive = 0, dCap = 0;
  const sim = await run(def, (s) => {
    const anyRag = s.players.some((p) => p.rag);
    for (const c of s.contacts) if (anyRag && c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) { imp += c.impulse; n++; for (const p of c.points) deep = Math.max(deep, -p.dist); }
    const D = s.players.find((p) => p.id === 'D')!;
    if (D.representation === 'proxy' && D.controlMode === 'supported') { dMaxDrive = Math.max(dMaxDrive, Math.hypot(D.applied.drive.x, D.applied.drive.y, D.applied.drive.z)); dCap = Math.max(dCap, D.applied.driveCap); }
  });
  const out = [`${id}: cross-owner contacts ${n}, impulse ${imp.toFixed(1)} N·s, deepest ${(deep * 1000).toFixed(1)} mm, D supported max drive ${dMaxDrive.toFixed(0)} / cap ${dCap.toFixed(0)} N`];
  for (const pid of ['R', 'D']) { const solo = await run(without(def, pid === 'R' ? 'D' : 'R')); out.push(`${pid} diverges from solo by ${div(pathOf(sim, pid), pathOf(solo, pid)).toFixed(2)} m`); solo.dispose(); }
  console.log(out.join('; '));
  sim.dispose();
}
