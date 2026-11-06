// Plan 07 probe: braking. For each fixture, from the brake request (desired speed drops) to rest: time, distance, peak
// deceleration (100 ms window), foot swings started, confirmed / sustained plants and failed proposals; braking motor id. Usage: vite-node scripts/probe/p07-stop.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^L2-F3-runStop$|^RH-F3-accelBrake$');
for (const def of allFixtures()) {
  if (!re.test(def.id)) continue;
  const sim = await Simulation.create(def);
  const pl = () => sim.players[0];
  const rows: { t: number; x: number; z: number; v: number; req: number }[] = [];
  while (!sim.done) {
    sim.stepTick();
    const p = pl();
    if (p.rag) break;
    const b = p.proxy.body;
    const v = b.linvel();
    const dv = p.intent.locomotion.desiredVelocityWorld;
    const req = Math.hypot(dv.x, dv.z);
    rows.push({ t: sim.t, x: b.translation().x, z: b.translation().z, v: Math.hypot(v.x, v.z), req });
  }
  let i0 = rows.findIndex((r, i) => i > 0 && r.req < rows[i - 1].req - 0.5);
  if (i0 < 0) i0 = rows.findIndex((r) => r.t >= 2.6);
  const i1 = rows.findIndex((r, i) => i > i0 && r.v < 0.05);
  const w = Math.round(0.1 / sim.tickS);
  let peak = 0;
  for (let i = i0; i + w < (i1 < 0 ? rows.length : i1); i++) peak = Math.max(peak, (rows[i].v - rows[i + w].v) / (w * sim.tickS));
  const t0 = rows[i0].t;
  const t1 = i1 < 0 ? NaN : rows[i1].t;
  const inWin = (e: { t: number }) => e.t >= t0 && (i1 < 0 || e.t <= t1 + 0.3);
  const steps = sim.events.filter((e) => e.type === 'footSwing' && inWin(e)).length;
  // confirmed plants (footPlant) and sustained ones (survived a later solve: its release has solves >= 1, or still planted)
  const plants = sim.events.filter((e) => e.type === 'footPlant' && inWin(e)).length;
  let sustained = 0;
  for (const e of sim.events.filter((x) => x.type === 'footPlant' && inWin(x))) {
    const rel = sim.events.find((x) => x.type === 'footRelease' && x.playerId === e.playerId && x.data?.side === e.data?.side && x.substep > e.substep);
    const f = pl().feet?.feet[e.data!.side as 'left' | 'right'];
    if (rel ? (rel.data!.solves as number) >= 1 : (f?.solves ?? 0) >= 1) sustained++;
  }
  const failed = sim.events.filter((e) => e.type === 'footPlantFailed' && inWin(e)).length;
  console.log(
    `${def.id.padEnd(20)} motor ${def.motor.id} brake at ${t0.toFixed(2)} s from ${rows[i0].v.toFixed(2)} m/s: rest ${i1 < 0 ? 'never' : `${(t1 - t0).toFixed(2)} s`} over ${(i1 < 0 ? NaN : Math.hypot(rows[i1].x - rows[i0].x, rows[i1].z - rows[i0].z)).toFixed(2)} m, peak decel ${peak.toFixed(1)} m/s^2, swings ${steps} plants ${plants} (sustained ${sustained}, failed proposals ${failed})`,
  );
}
