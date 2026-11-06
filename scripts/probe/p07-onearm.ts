// Plan 07 probe: RH-F6-oneArm late defender conversion. Events, rejected candidate hinge angles vs limits, and the
// supported pose hinge history leading up to the conversion.
import { Simulation } from '../../src/sim/simulation';
import { rhf6 } from '../../src/sim/fixtures/ride-height';

const id = process.argv[2] ?? 'RH-F6-oneArm';
const def = rhf6().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const hist: { t: number; mode: string; h: Record<string, number>; fb: string[] }[] = [];
while (!sim.done) {
  sim.stepTick();
  const D = sim.players.find((p) => p.id === 'D')!;
  if (D.pose && !D.rag) hist.push({ t: sim.t, mode: D.controlMode, h: { ...D.pose.hingeDeg }, fb: [...D.pose.straightFallback] });
}
for (const e of sim.events) if (['controlMode', 'handoffRejected', 'representation', 'lossOfSupport'].includes(e.type)) console.log(e.t.toFixed(4), e.type, e.playerId, JSON.stringify(e.data).slice(0, 600));
console.log('result', sim.summary().result);
const last = hist.slice(-12);
for (const r of last) console.log(r.t.toFixed(4), r.mode, Object.entries(r.h).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' '), r.fb.join(','));
