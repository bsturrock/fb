// Plan 07 probe: foot planner metrics per fixture. Per foot: plants, steps, release reasons, max contact-feature drift
// and error while planted, max leg residual (planted / swing), max commanded swing speed and lift rate, lowest shoe
// corner below the ground (shoe volume), limb length error, knee range; the mode timeline with --timeline.
// Usage: vite-node scripts/probe/p07-feet.ts [--timeline] [--events] [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { footFrame } from '../../src/sim/pose';
import { RAGDOLL_G4 as DEFAULT_POSE_PROFILE } from '../../src/sim/profiles';
import { dist, qRot, v3 } from '../../src/sim/vec';
import type { ArmSide } from '../../src/sim/contracts';

const args = process.argv.slice(2);
const tl = args.includes('--timeline');
const evs = args.includes('--events');
const filt = args.find((a) => !a.startsWith('--'));
const re = new RegExp(filt ?? '^L2-F(1|2|3|4|5|6|7|8|11|12)-');
const f = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const SIDES: ArmSide[] = ['left', 'right'];
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.footwork) continue;
  const sim = await Simulation.create(def);
  const R = def.ragdoll ?? DEFAULT_POSE_PROFILE;
  type M = Record<ArmSide, { plants: number; steps: number; why: Record<string, number>; drift: number; err: number; resP: number; resS: number; v: number; vOver: number; vOff: number; vy: number; pen: number; len: number; kneeMin: number; kneeMax: number; line: string[]; last: string }>;
  const all = new Map<string, M>();
  const samplers: (() => void)[] = [];
  for (const pl of sim.players) {
    if (!pl.feet) continue;
    const m = Object.fromEntries(
      SIDES.map((s) => [s, { plants: 0, steps: 0, why: {} as Record<string, number>, drift: 0, err: 0, resP: 0, resS: 0, v: 0, vOver: -99, vOff: 0, vy: 0, pen: 0, len: 0, kneeMin: 999, kneeMax: -999, line: [] as string[], last: '' }]),
    ) as Record<ArmSide, { plants: number; steps: number; why: Record<string, number>; drift: number; err: number; resP: number; resS: number; v: number; vOver: number; vOff: number; vy: number; pen: number; len: number; kneeMin: number; kneeMax: number; line: string[]; last: string }>;
    all.set(pl.id, m);
    const sample = (): void => {
      if (!pl.feet || pl.rag || !pl.pose) return;
      const gy = pl.sus?.probe.groundY ?? 0;
      for (const s of SIDES) {
        const ft = pl.feet.feet[s];
        const o = m[s];
        const mode = ft.mode === 'planted' ? 'P' : ft.mode === 'airborne' ? 'A' : ft.source === 'step' ? 'S' : 'F';
        if (mode !== o.last) {
          o.line.push(`${mode}@${f(sim.t, 3)}`);
          o.last = mode;
        }
        if (ft.mode === 'planted') {
          o.drift = Math.max(o.drift, ft.driftM);
          o.err = Math.max(o.err, ft.featureErrM);
          o.resP = Math.max(o.resP, ft.residualM);
        } else if (ft.mode === 'swing') {
          o.resS = Math.max(o.resS, ft.residualM);
          if (ft.source === 'step') {
            const sp = Math.hypot(pl.proxy.body.linvel().x, pl.proxy.body.linvel().z);
            o.v = Math.max(o.v, ft.speedMps);
            o.vOver = Math.max(o.vOver, ft.speedMps - (pl.feet.profile.swing.maxSpeedMps + pl.feet.profile.swing.travelSpeedK * sp));
            o.vy = Math.max(o.vy, ft.liftRateMps);
          } else o.vOff = Math.max(o.vOff, ft.speedMps);
        }
        const lm = pl.pose.jointLandmarksWorld;
        o.len = Math.max(o.len, Math.abs(dist(lm[`${s}Hip`], lm[`${s}Knee`]) - R.lengths.thigh), Math.abs(dist(lm[`${s}Knee`], lm[`${s}Ankle`]) - R.lengths.shin));
        const k = pl.pose.hingeDeg[`${s}Knee`];
        o.kneeMin = Math.min(o.kneeMin, k);
        o.kneeMax = Math.max(o.kneeMax, k);
        if (ft.mode !== 'airborne' && pl.sus?.probe.valid) {
          const q = footFrame(pl.pose, s);
          const c = lm[`${s}Shoe`];
          const he = R.shoe.halfExtents;
          let low = Infinity;
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) low = Math.min(low, c.y + qRot(q, v3(sx * he.x, sy * he.y, sz * he.z)).y);
          o.pen = Math.max(o.pen, gy - low);
        }
      }
    };
    samplers.push(sample);
  }
  for (const smp of samplers) smp();
  while (!sim.done) {
    sim.stepTick();
    for (const smp of samplers) smp();
  }
  for (const pl of sim.players) {
    const m = all.get(pl.id);
    if (!m) continue;
    for (const e of sim.events) {
      if (e.playerId !== pl.id) continue;
      const d = e.data ?? {};
      const s = d.side as ArmSide;
      if (e.type === 'footPlant') m[s].plants++;
      if (e.type === 'footSwing' && d.source === 'step') m[s].steps++;
      if (e.type === 'footRelease') m[s].why[String(d.reason)] = (m[s].why[String(d.reason)] ?? 0) + 1;
      if (evs && e.type.startsWith('foot')) console.log(`  ${f(e.t, 3)} ${pl.id} ${e.type} ${JSON.stringify(d)}`);
    }
    const p = pl.rag ? pl.pose!.segments.core.originWorld : pl.proxy.body.translation();
    console.log(`${def.id} ${pl.id} end p=(${f(p.x, 3)},${f(p.y, 3)},${f(p.z, 3)}) mode=${pl.controlMode} rep=${pl.representation} result=${sim.result}`);
    for (const s of SIDES) {
      const o = m[s];
      console.log(
        `  ${s.padEnd(5)} plants=${o.plants} steps=${o.steps} rel=${JSON.stringify(o.why)} drift=${f(o.drift, 5)} err=${f(o.err, 5)} resP=${f(o.resP)} resS=${f(o.resS)} vStep=${f(o.v, 2)} (cap-${f(-o.vOver, 2)}) vOff=${f(o.vOff, 2)} vy=${f(o.vy, 2)} pen=${f(o.pen)} lenErr=${o.len.toExponential(1)} knee=[${f(o.kneeMin, 1)},${f(o.kneeMax, 1)}]`,
      );
      if (tl) console.log(`        ${o.line.join(' ')}`);
    }
  }
}
