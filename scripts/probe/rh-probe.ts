// Probe (plan 06a): ride-height tracking of the RH fixtures. Per player: requested vs achieved root height (settle time
// and error, RMS, max error, amplitude ratio, extrema, phase lag as a fraction of the stride by cross-correlation),
// force range and saturation, guard bottoming, probe status changes, knee bend, sole gap and IK residual, fixed lengths.
// Usage: vite-node scripts/probe/rh-probe.ts [fixture-id regex]
import { Simulation, type PlayerTraceRow } from '../../src/sim/simulation';
import { rideHeightFixtures } from '../../src/sim/fixtures/ride-height';
import { footFrame, legShapes, type PoseShape } from '../../src/sim/pose';
import { dist, qRot, v3 } from '../../src/sim/vec';

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const f = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const lowest = (shapes: PoseShape[]): number => {
  let y = Infinity;
  for (const s of shapes) if (s.kind === 'box') for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, s.c.y + qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z)).y);
  return y;
};

/** Cross-correlation lag (s) of b behind a (positive = b lags), parabolic sub-sample refinement. */
function lagS(a: number[], b: number[], dt: number, maxShift: number): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  const c = (k: number): number => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + k;
      if (j < 0 || j >= b.length) continue;
      s += (a[i] - ma) * (b[j] - mb);
      n++;
    }
    return n ? s / n : -Infinity;
  };
  let best = 0;
  let bv = -Infinity;
  for (let k = -maxShift; k <= maxShift; k++) {
    const v = c(k);
    if (v > bv) {
      bv = v;
      best = k;
    }
  }
  const y0 = c(best - 1);
  const y2 = c(best + 1);
  const den = y0 - 2 * bv + y2;
  const off = Number.isFinite(den) && den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
  return (best + off) * dt;
}

for (const def of rideHeightFixtures()) {
  if (filter && !filter.test(def.id)) continue;
  const sim = await Simulation.create(def);
  const R = def.ragdoll!;
  type Row = { t: number; r: PlayerTraceRow; knee: number; gap: number; res: number; len: number; flight: boolean; stride: number; w: number; stanceGap: number[]; stanceRes: number[]; swingRes: number[] };
  const rows: Record<string, Row[]> = {};
  const sample = () => {
    const row = sim.trace[sim.trace.length - 1];
    for (const pl of sim.players) {
      const r = row.players[pl.id];
      if (!r.sup || !pl.pose || pl.rag) continue;
      const p = pl.pose;
      const lm = p.jointLandmarksWorld;
      const gy = pl.sus!.probe.groundY;
      let len = 0;
      for (const s of ['left', 'right'] as const) len = Math.max(len, Math.abs(dist(lm[`${s}Hip`], lm[`${s}Knee`]) - R.lengths.thigh), Math.abs(dist(lm[`${s}Knee`], lm[`${s}Ankle`]) - R.lengths.shin));
      const gaps = (['left', 'right'] as const).map((s) => lowest(legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], p.segments[`${s}Shin`].rotationWorld, footFrame(p, s))) - gy);
      const res = Math.max(0, ...Object.values(p.targetResidualM ?? {}));
      const stride = pl.run && def.runClips ? def.runClips.clips[pl.run.k].record.cycleS / Math.max(pl.run.rate, 1e-6) : NaN;
      (rows[pl.id] ??= []).push({
        t: row.t,
        r,
        knee: Math.max(p.hingeDeg.leftKnee, p.hingeDeg.rightKnee),
        gap: Math.min(...gaps),
        res,
        len,
        flight: r.sup.fl === 1,
        stride,
        w: pl.run?.w ?? 0,
        ...(() => {
          // clip stance intervals (playback phase, half-open, may wrap) of the playing clip
          const o = { stanceGap: [] as number[], stanceRes: [] as number[], swingRes: [] as number[] };
          if (!pl.run || !def.runClips) return o;
          const rec = def.runClips.clips[pl.run.k].record;
          (['left', 'right'] as const).forEach((s, i) => {
            const [a, b] = rec.stance[s];
            const u = pl.run!.u;
            const inSt = a <= b ? u >= a && u < b : u >= a || u < b;
            const rr = p.targetResidualM?.[`${s}Leg`] ?? 0;
            if (inSt) {
              o.stanceGap.push(gaps[i]);
              o.stanceRes.push(rr);
            } else o.swingRes.push(rr);
          });
          return o;
        })(),
      });
    }
  };
  sample();
  while (!sim.done) {
    sim.stepTick();
    sample();
  }
  console.log(`\n${def.id}  ${sim.summary().result}  (${def.durationS} s)`);
  const probeEv = sim.events.filter((e) => ['supportProbe', 'supportGuard', 'supportLost', 'controlModeChanged', 'ragdollHandoff', 'conversionRejected', 'handoffRejected'].includes(e.type));
  if (probeEv.length) console.log('   events', probeEv.slice(0, 12).map((e) => `${e.t.toFixed(3)}:${e.type}@${e.playerId}${e.data && 'status' in e.data ? `(${e.data.status})` : e.data && 'to' in e.data ? `(${e.data.to})` : ''}`).join(' '));
  for (const [id, rs] of Object.entries(rows)) {
    const sup = rs.filter((x) => x.r.sup!.ok === 1 && x.r.sup!.h !== null);
    const F = rs.map((x) => x.r.sup!.F);
    const sat = rs.filter((x) => x.r.sup!.sat === 2).length;
    const zero = rs.filter((x) => x.r.sup!.sat === 1 && x.r.sup!.ok === 1).length;
    const bot = rs.filter((x) => x.r.sup!.bot === 1).length;
    const m = sim.players.find((p) => p.id === id)!.mass.massKg;
    const W = m * 9.81;
    console.log(
      `   ${id}: h0 ${f(rs[0].r.sup!.h ?? NaN)} ht0 ${f(rs[0].r.sup!.ht)}  F/W ${f(Math.min(...F) / W, 3)}..${f(Math.max(...F) / W, 3)}  sat(max) ${sat} zero ${zero} bottomed ${bot} ticks  ` +
        `len ${Math.max(...rs.map((x) => x.len)).toExponential(1)}  minGap ${f(Math.min(...rs.map((x) => x.gap)))} maxRes ${f(Math.max(...rs.map((x) => x.res)))} knee ${f(Math.min(...rs.map((x) => x.knee)), 1)}..${f(Math.max(...rs.map((x) => x.knee)), 1)}`,
    );
    // settle: first time after which |err| stays <= 0.01 for the rest of the supported static window
    const still = sup.filter((x) => !(x.w > 0));
    if (still.length) {
      let tSettle = NaN;
      for (let i = still.length - 1; i >= 0; i--) {
        if (Math.abs(still[i].r.sup!.h! - still[i].r.sup!.ht) > 0.01) {
          tSettle = still[i + 1]?.t ?? NaN;
          break;
        }
        if (i === 0) tSettle = still[0].t;
      }
      const tail = still.filter((x) => x.t >= still[still.length - 1].t - 0.5);
      const te = tail.map((x) => x.r.sup!.h! - x.r.sup!.ht);
      console.log(`      still: settled(|e|<=0.01) from t=${f(tSettle, 3)}  tail 0.5 s err ${f(Math.min(...te))}..${f(Math.max(...te))}  maxErr ${f(Math.max(...still.map((x) => Math.abs(x.r.sup!.h! - x.r.sup!.ht))))}`);
      // request-relative: each change of the (range-clamped) request, time until |h - request| <= 0.01 for good
      const S = def.support!.kind === 'suspension' ? def.support! : null;
      if (S) {
        const reqC = (x: Row) => Math.min(S.targetRangeM[1], Math.max(S.targetRangeM[0], x.r.sup!.req));
        const out: string[] = [];
        let i0 = 0;
        for (let i = 1; i <= still.length; i++) {
          if (i < still.length && reqC(still[i]) === reqC(still[i - 1])) continue;
          const seg = still.slice(i0, i);
          let j = seg.length;
          while (j > 0 && Math.abs(seg[j - 1].r.sup!.h! - reqC(seg[j - 1])) <= 0.01) j--;
          const tReq = seg[0].t;
          const settled = j < seg.length ? seg[j].t - tReq : NaN;
          const after = seg.slice(j);
          let os = 0;
          for (const x of after) os = Math.max(os, Math.abs(x.r.sup!.h! - reqC(x)));
          out.push(`req ${f(reqC(seg[0]), 3)}${seg[0].r.sup!.req !== reqC(seg[0]) ? `(raw ${f(seg[0].r.sup!.req, 2)})` : ''} @${f(tReq, 2)}: settled ${f(settled, 3)} s, after ${f(os)}`);
          i0 = i;
        }
        console.log(`      requests: ${out.join('; ')}`);
      }
    }
    const runRows = sup.filter((x) => x.w >= 0.999 && x.t >= 0.3);
    if (runRows.length > 30) {
      const h = runRows.map((x) => x.r.sup!.h!);
      const ht = runRows.map((x) => x.r.sup!.ht);
      const e = h.map((x, i) => x - ht[i]);
      const rms = Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length);
      const T = runRows.reduce((s, x) => s + x.stride, 0) / runRows.length;
      const lag = lagS(ht, h, 1 / 60, 20);
      const rh = Math.max(...h) - Math.min(...h);
      const rt = Math.max(...ht) - Math.min(...ht);
      const raw = runRows.map((x) => x.r.sup!.run ?? NaN);
      console.log(
        `      run (w=1, ${runRows.length} ticks): RMS ${f(rms)} maxErr ${f(Math.max(...e.map(Math.abs)))} lag ${f(lag, 4)} s = ${f((100 * lag) / T, 1)}% stride (T ${f(T, 3)} s)  ` +
          `amp achieved ${f(rh)} target ${f(rt)} ratio ${f(rh / rt, 3)}  h ${f(Math.min(...h))}..${f(Math.max(...h))} ht ${f(Math.min(...ht))}..${f(Math.max(...ht))} run ${f(Math.min(...raw))}..${f(Math.max(...raw))}  bobScale ${f(Math.min(...runRows.map((x) => x.r.sup!.s)), 3)}  flight ${runRows.filter((x) => x.flight).length}`,
      );
      const sg = runRows.flatMap((x) => x.stanceGap).sort((p, q) => p - q);
      const sr = runRows.flatMap((x) => x.stanceRes).sort((p, q) => p - q);
      const wr = runRows.flatMap((x) => x.swingRes).sort((p, q) => p - q);
      const pct = (a: number[], q: number) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
      const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
      console.log(
        `      stance sole gap (clip stance foot, not a plant): mean ${f(mean(sg))} median ${f(pct(sg, 0.5))} p95 ${f(pct(sg, 0.95))} max ${f(sg[sg.length - 1])} min ${f(sg[0])}  ` +
          `IK residual stance median ${f(pct(sr, 0.5))} p95 ${f(pct(sr, 0.95))} max ${f(sr[sr.length - 1])}; swing median ${f(pct(wr, 0.5))} max ${f(wr[wr.length - 1])}`,
      );
    }
  }
  sim.dispose();
}
