// Plan 07 closeout item 3 probe: the clip-to-procedural crossing of a run stop at several run phases (zero request at
// brakeS), controlled braking and the original motor's hard stop. Per run, from the crossing (first supported substep
// without clip weight): lifted planner steps overlapping (both feet in a non-drag step, s), both shoes achieved off the
// ground (gap > 2 cm, s), step starts while the other foot is in a lifted step, drags (time after crossing, reason; time
// in drag mode, s),
// failed proposals, steps and the last step start, final modes, minimum gap (penetration), largest feature error held.
// Usage: vite-node scripts/probe/p07-stopphases.ts [--from 2.2] [--n 12] [--dt 0.05] [--verbose] (the trial ends out of
// bounds at x = 8 m for zero requests after about 2.8 s)
import { Simulation } from '../../src/sim/simulation';
import { runStop } from '../../src/sim/fixtures/footwork';
import type { FootPlanInput } from '../../src/sim/footwork';

const args = process.argv.slice(2);
const opt = (k: string, d: number): number => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
const from = opt('--from', 2.2);
const n = opt('--n', 12);
const dts = opt('--dt', 0.05);
const verbose = args.includes('--verbose');
const SIDES = ['left', 'right'] as const;
console.log('| Brake s | Motor | Crossing s (v m/s) | Crossing states L/R | Overlap lifted steps s | Both shoes up s | Starts during lifted step | Drags (s after crossing: reason; total drag s) | Failed | Steps (last start s) | Final | Min gap cm |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const controlled of [true, false]) {
  for (let k = 0; k < n; k++) {
    const brakeS = +(from + k * dts).toFixed(3);
    const def = runStop(`probe-${brakeS}`, brakeS, controlled);
    const sim = await Simulation.create(def);
    const proto = Object.getPrototypeOf(sim) as { footInput: (...a: unknown[]) => FootPlanInput };
    const orig = proto.footInput;
    let cross = -1;
    let crossV = 0;
    let hadClip = false;
    let overlap = 0;
    let dragS = 0;
    let bothUp = 0;
    let minGap = Infinity;
    let crossStates = '';
    proto.footInput = function (this: Simulation, ...a: unknown[]): FootPlanInput {
      const inp = orig.apply(this, a);
      const fp = this.players[0].feet!;
      if (inp.clip) hadClip = true;
      else if (hadClip && cross < 0 && inp.supported) {
        cross = inp.t;
        crossV = Math.hypot(inp.vel.x, inp.vel.z);
        crossStates = SIDES.map((s) => `${fp.feet[s].mode === 'planted' ? 'P' : `F${fp.feet[s].gapM.toFixed(3)}`}`).join('/');
      }
      if (cross >= 0 && inp.t >= cross) {
        const lifted = (s: 'left' | 'right'): boolean => fp.feet[s].mode === 'swing' && fp.feet[s].source === 'step' && !fp.feet[s].drag;
        if (lifted('left') && lifted('right')) overlap += inp.dt;
        for (const s of SIDES) if (fp.feet[s].mode === 'swing' && fp.feet[s].source === 'step' && fp.feet[s].drag) dragS += inp.dt;
        if (fp.feet.left.gapM > 0.02 && fp.feet.right.gapM > 0.02) bothUp += inp.dt;
        for (const s of SIDES) minGap = Math.min(minGap, fp.feet[s].gapM);
      }
      return inp;
    };
    while (!sim.done) sim.stepTick();
    proto.footInput = orig;
    const ev = sim.events.filter((e) => e.playerId === 'R' && e.t >= cross - 1e-9 && e.type.startsWith('foot'));
    const steps = ev.filter((e) => e.type === 'footSwing' && e.data!.source === 'step');
    const drags = steps.filter((e) => e.data!.drag).map((e) => `${(e.t - cross).toFixed(3)}: ${e.data!.reason}`);
    // a step start while the other foot is in a lifted (non-drag) step, from the event order
    const inStep: Record<string, boolean> = { left: false, right: false };
    let startsDuring = 0;
    for (const e of sim.events.filter((x) => x.playerId === 'R' && x.type.startsWith('foot'))) {
      const s = e.data!.side as string;
      const o = s === 'left' ? 'right' : 'left';
      if (e.type === 'footSwing' && e.data!.source === 'step') {
        if (e.t >= cross - 1e-9 && inStep[o] && e.data!.reason !== 'continue' && !e.data!.drag) startsDuring++;
        inStep[s] = !e.data!.drag;
      } else if (e.type === 'footSwing' || e.type === 'footPlant' || e.type === 'footPlantFailed') inStep[s] = false;
    }
    const failed = ev.filter((e) => e.type === 'footPlantFailed').length;
    const fin = SIDES.map((s) => sim.players[0].feet!.feet[s].mode[0].toUpperCase()).join('/');
    const last = steps.length ? steps[steps.length - 1].t.toFixed(3) : '—';
    console.log(`| ${brakeS} | ${controlled ? 'controlled' : 'original'} | ${cross.toFixed(3)} (${crossV.toFixed(2)}) | ${crossStates} | ${overlap.toFixed(3)} | ${bothUp.toFixed(3)} | ${startsDuring} | ${drags.length ? `${drags.join('; ')}; ${dragS.toFixed(3)}` : '—'} | ${failed} | ${steps.length} (${last}) | ${fin} | ${(minGap * 100).toFixed(2)} |`);
    if (verbose) for (const e of ev.filter((x) => x.type !== 'footRelease' || true)) console.log(`   ${e.t.toFixed(4)} ${e.type} ${JSON.stringify(e.data)}`);
    sim.dispose();
  }
}
