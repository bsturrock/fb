// Plan 07 closeout item 4 probe: the braking stance. Each case runs with the fixture's support profile replaced by
// SUSPENSION_L2 (no braking stance) and SUSPENSION_L2_BRAKE (braking stance); everything else identical. Per run: the
// brake start (first tick with braking demand), the crossing (clip weight reaching 0), root height (probe) at the
// crossing and its minimum while braking, stop time (speed <= 0.1 m/s and staying below) and distance from the brake,
// peak horizontal deceleration, support force range (body weights), the largest target rate / feedforward acceleration,
// the height overshoot above the final standing target after the stop, foot steps from the crossing (count, shortest
// duration, quick steps shorter than minS, drag time, overlapping lifted steps, both shoes > 2 cm up), the largest
// one-tick second difference of a knee/ankle landmark (proxy frame) from the brake, knee range and the lowest shoe gap.
// Usage: vite-node scripts/probe/p07-brakestance.ts [case regex] [--trace from to]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { runStop } from '../../src/sim/fixtures/footwork';
import { SUSPENSION_L2, SUSPENSION_L2_BRAKE, type SuspensionSupport } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { FOOTWORK_L2, type FootPlanInput } from '../../src/sim/footwork';
import { add, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';

const args = process.argv.slice(2);
const re = new RegExp(args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a))) ?? '.');
const ti = args.indexOf('--trace');
const trace = ti >= 0 ? [Number(args[ti + 1]), Number(args[ti + 2])] : null;
const fx = (id: string): FixtureDef => allFixtures().find((d) => d.id === id)!;
const cases: [string, () => FixtureDef][] = [
  ['runStop 2.6', () => fx('L2-F3-runStop')],
  ['runStop 2.3', () => runStop('p-2.3', 2.3, true)],
  ['runStop 2.45', () => runStop('p-2.45', 2.45, true)],
  ['runStop 2.55', () => runStop('p-2.55', 2.55, true)],
  ['runStop 2.65', () => runStop('p-2.65', 2.65, true)],
  ['runStop 1.6 (slower)', () => runStop('p-1.6', 1.6, true)],
  ['runStop 1.2 (slower)', () => runStop('p-1.2', 1.2, true)],
  ['walkStop', () => fx('L2-F3-walkStop')],
  ['runStopHard (no braking limit)', () => fx('L2-F3-runStopHard')],
  ['runStopReaccel', () => fx('L2-F3-runStopReaccel')],
  ['runStopKick', () => fx('L2-F3-runStopKick')],
  ['runStopHandoff', () => fx('L2-F3-runStopHandoff')],
];
const SIDES = ['left', 'right'] as const;
const f2 = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : '—');
console.log('| Case | Support | Brake s | Crossing s (h m) | Min h braking (at s) | Stop s / m | Peak decel | F BW min–max | max vt / at | Overshoot cm | Steps (shortest s; quick) | Drag s | Overlap s | Shoes up s | Max 2nd diff cm (at s) | Knee ° | Min gap cm |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, mk] of cases) {
  if (!re.test(name)) continue;
  for (const S of [SUSPENSION_L2, SUSPENSION_L2_BRAKE] as SuspensionSupport[]) {
    const def = { ...mk(), support: S };
    const sim = await Simulation.create(def);
    const proto = Object.getPrototypeOf(sim) as { footInput: (...a: unknown[]) => FootPlanInput };
    const orig = proto.footInput;
    let brakeT = -1;
    let cross = -1;
    let crossH = NaN;
    let hadClip = false;
    let overlap = 0;
    let dragS = 0;
    let bothUp = 0;
    let minGap = Infinity;
    proto.footInput = function (this: Simulation, ...a: unknown[]): FootPlanInput {
      const inp = orig.apply(this, a);
      const fp = this.players[0].feet!;
      if (inp.clip) hadClip = true;
      else if (hadClip && cross < 0 && inp.supported) {
        cross = inp.t;
        crossH = this.players[0].sus!.probe.heightM;
      }
      if (brakeT >= 0) {
        const lifted = (s: 'left' | 'right'): boolean => fp.feet[s].mode === 'swing' && fp.feet[s].source === 'step' && !fp.feet[s].drag;
        if (cross >= 0 && lifted('left') && lifted('right')) overlap += inp.dt;
        for (const s of SIDES) if (fp.feet[s].mode === 'swing' && fp.feet[s].source === 'step' && fp.feet[s].drag) dragS += inp.dt;
        if (cross >= 0 && fp.feet.left.gapM > 0.02 && fp.feet.right.gapM > 0.02) bothUp += inp.dt;
        for (const s of SIDES) minGap = Math.min(minGap, fp.feet[s].gapM);
      }
      return inp;
    };
    let prevV: Vec3 | null = null;
    let peakDecel = 0;
    let minH = Infinity;
    let minHT = 0;
    let fMin = Infinity;
    let fMax = 0;
    let vtMax = 0;
    let atMax = 0;
    let stopT = -1;
    let x0: Vec3 | null = null;
    let dist = 0;
    let kMin = Infinity;
    let kMax = 0;
    let d2 = 0;
    let d2T = 0;
    let hAfter = -Infinity;
    const hist: Record<string, Vec3[]> = {};
    while (!sim.done) {
      sim.stepTick();
      const p = sim.players[0];
      if (p.rag || !p.sus) continue;
      const b = p.proxy.body;
      const v = b.linvel();
      const vh = { x: v.x, y: 0, z: v.z };
      const sp = Math.hypot(v.x, v.z);
      const m = b.mass();
      const g = 9.81;
      const u = p.sus;
      const desired = p.intent.locomotion.desiredVelocityWorld;
      const reqSp = Math.hypot(desired.x, desired.z);
      if (brakeT < 0 && sim.t > 0.6 && reqSp < sp - 0.5) {
        brakeT = sim.t;
        x0 = { ...b.translation() };
      }
      if (brakeT >= 0) {
        if (prevV) peakDecel = Math.max(peakDecel, (Math.hypot(prevV.x, prevV.z) - sp) / sim.tickS);
        const h = u.probe.heightM;
        if (stopT < 0) {
          if (h < minH) {
            minH = h;
            minHT = sim.t;
          }
          fMin = Math.min(fMin, u.appliedN / (m * g));
          fMax = Math.max(fMax, u.appliedN / (m * g));
          vtMax = Math.max(vtMax, Math.abs(u.targetVMps));
          atMax = Math.max(atMax, Math.abs(u.targetAMps2));
        } else hAfter = Math.max(hAfter, h - u.targetM);
        if (sp <= 0.1 && stopT < 0) {
          stopT = sim.t;
          dist = Math.hypot(b.translation().x - x0!.x, b.translation().z - x0!.z);
        } else if (sp > 0.1 && stopT >= 0 && reqSp < 0.01) stopT = -1;
        for (const k of Object.values(p.pose?.hingeDeg ?? {}).slice(0, 0)) void k;
        for (const s of SIDES) {
          const kd = p.pose?.hingeDeg[`${s}Knee`];
          if (kd !== undefined) {
            kMin = Math.min(kMin, kd);
            kMax = Math.max(kMax, kd);
          }
        }
        if (p.pose) {
          const o = b.translation();
          const q = b.rotation();
          const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
          for (const n of ['leftAnkle', 'rightAnkle', 'leftKnee', 'rightKnee']) {
            const pt = qRot(qi, sub(p.pose.jointLandmarksWorld[n], o));
            const hh = (hist[n] ??= []);
            hh.push(pt);
            if (hh.length > 3) hh.shift();
            if (hh.length === 3) {
              const dd = len(add(sub(hh[2], scale(hh[1], 2)), hh[0]));
              if (dd > d2) {
                d2 = dd;
                d2T = sim.t;
              }
            }
          }
        }
        if (trace && sim.t >= trace[0] && sim.t <= trace[1])
          console.log(`   ${sim.t.toFixed(3)} v ${sp.toFixed(2)} h ${f2(u.probe.heightM)} ht ${f2(u.targetM)} bk ${f2(u.brakeB)} bw ${f2(u.brakeWant)} run ${f2(u.runM)} w ${f2(p.run?.w ?? 0, 2)} F ${(u.appliedN / (m * g)).toFixed(2)} feet ${SIDES.map((s) => p.feet!.feet[s].mode[0] + (p.feet!.feet[s].drag ? 'd' : '')).join('')}`);
      }
      prevV = vh;
    }
    proto.footInput = orig;
    const ev = sim.events.filter((e) => e.playerId === 'R' && e.t >= cross - 1e-9 && e.type === 'footSwing' && e.data!.source === 'step');
    const durs = ev.map((e) => Number(e.data!.durS)).filter((x) => Number.isFinite(x));
    const quick = durs.filter((x) => x < FOOTWORK_L2.swing.minS - 1e-9).length;
    console.log(
      `| ${name} | ${S.id.replace('support-suspension-', '')} | ${f2(brakeT)} | ${f2(cross)} (${f2(crossH)}) | ${f2(minH)} (${f2(minHT)}) | ${stopT >= 0 ? `${f2(stopT - brakeT, 2)} / ${f2(dist, 2)}` : '—'} | ${f2(peakDecel, 1)} | ${f2(fMin, 2)}–${f2(fMax, 2)} | ${f2(vtMax, 2)} / ${f2(atMax, 1)} | ${f2(hAfter * 100, 2)} | ${ev.length} (${durs.length ? f2(Math.min(...durs)) : '—'}; ${quick}) | ${f2(dragS)} | ${f2(overlap)} | ${f2(bothUp)} | ${f2(d2 * 100, 1)} (${f2(d2T)}) | ${f2(kMin, 0)}–${f2(kMax, 0)} | ${f2(minGap * 100, 2)} |`,
    );
    sim.dispose();
  }
}
