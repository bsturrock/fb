// Plan 07 closeout item 3 probe: per footwork fixture and player, the stepping before item 3 (debug switches legacyEntry +
// noQuick), with the item 3 reactive entry only (noQuick) and with item 3 complete. Supported, articulated-free
// substeps: time with both feet in lifted (non-drag) planner steps, time in drag steps, ordinary step starts while the
// other foot is in a lifted step, steps, shortest step duration, confirmed / failed plants, eligible stance planted.
// Usage: vite-node scripts/probe/p07-item3-compare.ts [id regex]
import { type FootPlanInput } from '../../src/sim/footwork';

const { Simulation } = await import('../../src/sim/simulation');
const { allFixtures } = await import('../../src/sim/fixtures/index');
const re = new RegExp(process.argv[2] ?? '^L2-F(3-runStop|6-hop|7-shove|8-sideLoss|8-outOfRange|14-oneArmFeet)');
const SIDES = ['left', 'right'] as const;
const modes = { old: { legacyEntry: true, noQuick: true }, entry: { legacyEntry: false, noQuick: true }, item3: { legacyEntry: false, noQuick: false } };
console.log('| Fixture (player) | Config | Both lifted s | Drag s | Starts during lifted | Steps (min dur s) | Confirmed / failed | Eligible planted L/R | Result |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const def of allFixtures().filter((d) => re.test(d.id) && d.footwork)) {
  for (const pl of def.players) {
    for (const [name, m] of Object.entries(modes)) {
      const sim = await Simulation.create(def, { debug: { foot: m } });
      const proto = Object.getPrototypeOf(sim) as { footInput: (...a: unknown[]) => FootPlanInput };
      const orig = proto.footInput;
      let both = 0;
      let drag = 0;
      proto.footInput = function (this: typeof sim, ...a: unknown[]): FootPlanInput {
        const inp = orig.apply(this, a);
        const p = this.players.find((x) => x.id === (a[0] as { id: string }).id)!;
        if (p.id === pl.id && inp.supported && !inp.ragdoll && p.feet) {
          const f = p.feet.feet;
          const lifted = (s: 'left' | 'right'): boolean => f[s].mode === 'swing' && f[s].source === 'step' && !f[s].drag;
          if (lifted('left') && lifted('right')) both += inp.dt;
          for (const s of SIDES) if (f[s].mode === 'swing' && f[s].source === 'step' && f[s].drag) drag += inp.dt;
        }
        return inp;
      };
      while (!sim.done) sim.stepTick();
      proto.footInput = orig;
      const P = sim.players.find((x) => x.id === pl.id)!;
      if (!P.feet) continue;
      const ev = sim.events.filter((e) => e.playerId === pl.id && e.type.startsWith('foot'));
      const inStep: Record<string, boolean> = { left: false, right: false };
      let during = 0;
      const durs: number[] = [];
      for (const e of ev) {
        const s = e.data!.side as string;
        const o = s === 'left' ? 'right' : 'left';
        if (e.type === 'footSwing' && e.data!.source === 'step') {
          if (inStep[o] && !e.data!.drag && e.data!.reason !== 'continue') during++;
          inStep[s] = !e.data!.drag;
          durs.push(e.data!.durS as number);
        } else if (e.type === 'footSwing' || e.type === 'footPlant' || e.type === 'footPlantFailed') inStep[s] = false;
      }
      const st = P.feet.stats;
      const cov = (s: 'left' | 'right'): string => (st.cover[s].eligibleS > 0 ? `${((100 * st.cover[s].plantedS) / st.cover[s].eligibleS).toFixed(0)}%` : '—');
      console.log(`| ${def.id} (${pl.id}) | ${name} | ${both.toFixed(3)} | ${drag.toFixed(3)} | ${during} | ${durs.length} (${durs.length ? Math.min(...durs).toFixed(3) : '—'}) | ${st.confirmed} / ${st.failed} | ${cov('left')} / ${cov('right')} | ${sim.result} |`);
      sim.dispose();
    }
  }
}
