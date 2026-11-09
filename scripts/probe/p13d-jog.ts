// Plan 13d jog acceptance: on L3-F17-runStartFree, while the start passes through 2.5 m/s (2.3-2.7 m/s), the cadence
// against Fast Run's own (phase cycles per second x Fast Run's cycle) is within 0.70-0.75, and every plant that is down
// in that window keeps its contact feature within the plan 07 plant tolerance of its anchor (driftM <= plantTolM), over
// the whole plant. Exit 1 if either fails.
// Usage: npx vite-node scripts/probe/p13d-jog.ts [fixtureId]
import { FOOTWORK_L3 } from '../../src/sim/footwork';
import { suppliedRunClips } from '../../src/sim/model/run-clips';
import { FIX, create } from '../../tests/runs';

const id = process.argv[2] ?? 'L3-F17-runStartFree';
const BAND: [number, number] = [2.3, 2.7];
const CADENCE: [number, number] = [0.7, 0.75];
const FR = suppliedRunClips().find((c) => c.id === 'fast-run')!.record;

const def = FIX(id);
const sim = await create(def);
const R = sim.players[0];
const tol = (def.footwork ?? FOOTWORK_L3).plantTolM;
type Plant = { side: string; from: number; to: number; worst: number; inBand: boolean };
const plants: Plant[] = [];
const open: Record<string, Plant | undefined> = {};
const cad: { t: number; v: number; c: number }[] = [];
let u0: number | null = null;
while (!sim.done && sim.t < 2.5) {
  sim.stepTick();
  const st = R.run!;
  const v = st.speed;
  const inBand = v >= BAND[0] && v <= BAND[1] && st.w > 0;
  if (u0 !== null && inBand) {
    let du = st.u - u0;
    if (du < 0) du += 1;
    cad.push({ t: sim.t, v, c: (du / sim.tickS) * FR.cycleS });
  }
  u0 = st.u;
  for (const side of ['left', 'right'] as const) {
    const f = R.feet!.feet[side];
    if (f.mode === 'planted' && f.anchorW) {
      const p = (open[side] ??= { side, from: sim.t, to: sim.t, worst: 0, inBand: false });
      p.to = sim.t;
      p.worst = Math.max(p.worst, f.driftM);
      p.inBand ||= inBand;
    } else if (open[side]) {
      plants.push(open[side]!);
      open[side] = undefined;
    }
  }
}
for (const p of Object.values(open)) if (p) plants.push(p);
sim.dispose();

const inBand = plants.filter((p) => p.inBand);
const mean = cad.reduce((s, x) => s + x.c, 0) / Math.max(1, cad.length);
console.log(`${id}: ${cad.length} ticks at ${BAND[0]}-${BAND[1]} m/s (${cad[0]?.t.toFixed(4)}-${cad.at(-1)?.t.toFixed(4)} s)`);
console.log(`cadence / Fast Run's: mean ${mean.toFixed(3)}, ${Math.min(...cad.map((x) => x.c)).toFixed(3)}-${Math.max(...cad.map((x) => x.c)).toFixed(3)} (accept ${CADENCE[0]}-${CADENCE[1]} on the mean)`);
for (const p of inBand) console.log(`  plant ${p.side} ${p.from.toFixed(4)}-${p.to.toFixed(4)} s: worst drift ${(p.worst * 1000).toFixed(1)} mm (tolerance ${tol * 1000} mm)`);
const ok = cad.length > 0 && mean >= CADENCE[0] && mean <= CADENCE[1] && inBand.length > 0 && inBand.every((p) => p.worst <= tol);
console.log(ok ? 'PASS' : 'FAIL');
process.exitCode = ok ? 0 : 1;
