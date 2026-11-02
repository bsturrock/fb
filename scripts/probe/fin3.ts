// Finish/readjustment trace: finish mode, arm states, wrap status, defender/runner positions.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { g3f9, g3f9Partial } from '../../src/sim/fixtures/gate3';
import { v3 } from '../../src/sim/vec';
const id = process.argv[2];
const every = Number(process.argv[3] ?? 6);
const esc = Number(process.argv[4] ?? 1.1);
const extra = [g3f9(false), g3f9(true), g3f9Partial('jog', [{ fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 }]),
  g3f9Partial('escape', [{ fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 }, { fromS: esc, velocity: v3(3, 0, 0), facing: v3(1, 0, 0), effort: 0.8 }])];
const def = [...allFixtures(), ...extra].find((f) => f.id === id)!;
const sim = await Simulation.create(def);
while (!sim.done) {
  sim.stepTick();
  if (sim.tick % every) continue;
  const parts = [sim.t.toFixed(3)];
  for (const pl of sim.players) {
    const a = pl.applied;
    let arm = '';
    for (const side of ['left', 'right'] as const) {
      const f = sim.arms?.lastForce.get(`${pl.id}:${side}`);
      const g = sim.arms?.obs(pl.id)?.[side];
      if (g?.enabled) arm += ` ${side[0]}:${g.gripId ? 'G' : g.clampContactId ? 'C' : '-'}${f ? Math.round(f.actual) : 0}`;
    }
    const tr = pl.proxy.body.translation();
    const dbg = (pl.intent?.debug?.finish as string) ?? '';
    parts.push(`${pl.id} ${pl.controlMode[0]} ${dbg} th ${(pl.balance.theta * 57.3).toFixed(1)} drv ${Math.hypot(a.drive.x, a.drive.z).toFixed(0)}/${a.driveCap.toFixed(0)}${arm} p(${tr.x.toFixed(2)},${tr.z.toFixed(2)})`);
  }
  const w = sim.arms?.wrap.get('D')?.status ?? '';
  console.log(parts.join(' | '), w);
}
for (const e of sim.events.filter((e) => ['lossOfSupport', 'wrapStatus', 'clampBegin', 'clampEnd'].includes(e.type))) console.log(e.t.toFixed(3), e.type, e.playerId, JSON.stringify(e.data).slice(0, 140));
