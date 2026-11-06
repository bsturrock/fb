// Plan 07 probe (L2-F13): load-release recovery. Per variant: compression and release history (height, vertical
// velocity, applied/commanded force, saturation, guard contact, work, target), peak root height after release against
// the original standing request, time beyond travel, settle time to |err| <= 0.01 m (staying), oscillation count.
// Usage: vite-node scripts/probe/p07-load.ts [--history] [variant regex]
import { Simulation } from '../../src/sim/simulation';
import { loadReleaseFixtures } from '../../src/sim/fixtures/footwork';
import { rhf4Kick, rhf4Load } from '../../src/sim/fixtures/ride-height';

const args = process.argv.slice(2);
const hist = args.includes('--history');
const filt = args.find((a) => !a.startsWith('--'));
const re = filt ? new RegExp(filt) : null;
const f = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
for (const def of [rhf4Load(), ...loadReleaseFixtures(), rhf4Kick('down'), rhf4Kick('up')]) {
  if (re && !re.test(def.id)) continue;
  const sim = await Simulation.create(def);
  const load = def.diagnostics?.forces?.[0];
  const rel = load?.toS ?? 0;
  const S = def.support!.kind === 'suspension' ? def.support : null;
  const H = S!.standingHeightM;
  const rows: { t: number; h: number; vy: number; F: number; Fc: number; sat: number; bot: number; W: number; ht: number; ok: number; st: string; rec: number }[] = [];
  while (!sim.done) {
    sim.stepTick();
    const pl = sim.players[0];
    const s = pl.sus!;
    rows.push({ t: sim.t, h: s.probe.heightM, vy: pl.proxy.body.linvel().y, F: s.appliedN, Fc: s.commandedN, sat: s.saturated === 'max' ? 2 : s.saturated === 'zero' ? 1 : 0, bot: s.bottomed ? 1 : 0, W: s.workJ, ht: s.targetM, ok: s.probe.valid ? 1 : 0, st: s.probe.status, rec: s.approachLimitMps });
  }
  const after = rows.filter((r) => r.t > rel + 1e-9);
  const peak = after.reduce((m, r) => (r.h > m.h ? r : m), after[0]);
  const out = after.filter((r) => !r.ok);
  // settle: first time after release from which |h - standing| <= 0.01 holds to the end
  let settle = NaN;
  for (let i = after.length - 1; i >= 0; i--) {
    if (!(Math.abs(after[i].h - H) <= 0.01)) break;
    settle = after[i].t - rel;
  }
  // sign changes of the error after settling start (sustained oscillation check): crossings beyond +-2 mm
  let cross = 0;
  let side = 0;
  for (const r of after) {
    const e = r.h - H;
    const sd = e > 0.002 ? 1 : e < -0.002 ? -1 : 0;
    if (sd && side && sd !== side) cross++;
    if (sd) side = sd;
  }
  const comp = rows.filter((r) => r.t <= rel + 1e-9 && r.t >= (load?.fromS ?? 0));
  const minH = comp.length ? Math.min(...comp.map((r) => r.h)) : Math.min(...rows.map((r) => r.h));
  const maxSat = rows.filter((r) => r.sat === 2).length;
  const W = sim.players[0].mass.massKg * 9.81;
  console.log(
    `${def.id.padEnd(28)} ${String(sim.summary().result).padEnd(9)} minH ${f(minH, 3)} bottomed ${rows.filter((r) => r.bot).length} sat ${maxSat}  ` +
      `peak ${f(peak?.h ?? NaN, 4)} (+${f((peak?.h ?? NaN) - H, 4)}) at +${f((peak?.t ?? NaN) - rel, 3)} s  outOfTravel ${out.length} ticks  ` +
      `settle ${f(settle, 3)} s  crossings ${cross}  F/W ${f(Math.max(...rows.map((r) => r.F)) / W, 2)}  work ${f(rows[rows.length - 1].W, 1)} J`,
  );
  if (hist)
    for (const r of rows.filter((x) => x.t >= (load?.fromS ?? 0) - 0.05 && x.t <= rel + 1.2))
      console.log(`   ${f(r.t, 4)} h ${f(r.h)} ht ${f(r.ht)} vy ${f(r.vy, 3)} F ${f(r.F, 0)} Fc ${f(r.Fc, 0)} sat ${r.sat} bot ${r.bot} W ${f(r.W, 1)} ${r.st}${Number.isFinite(r.rec) ? ` vlim ${f(r.rec, 3)}` : ''}`);
  sim.dispose();
}
