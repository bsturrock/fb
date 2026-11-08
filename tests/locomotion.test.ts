// Plan 06 (L1): supplied run clips sampled into the calibrated player's physical pose. Asset/record contract, decode
// errors, root-motion removal, loop seams, playback from solved travel (speed scaling, bounded fallback), independent
// phases, held/carry-arm precedence, render-rate and reset reproducibility, limb contract, unchanged physics before the
// first handoff, candidate/transfer audits and the exported identity.
import { describe, expect, it } from 'vitest';
import { clipIntake } from '../scripts/model/clip-intake';
import FAST from '../models/animations/fast-run.json';
import { RUN_CLIPS_RECORD, decodeRunClips, runClipsBew, suppliedRunClips } from '../src/sim/model/run-clips';
import {
  RunClipError,
  advanceRunPlayback,
  analyzeRunClip,
  decodeRunClip,
  newRunPlayback,
  playbackArmMean,
  playbackSample,
  retargetSample,
  sampleRunClip,
  validateRunClipProfile,
  type ClipSample,
  type RunClipRecord,
} from '../src/sim/run-clip';
import * as L1 from '../src/sim/fixtures/locomotion';
import { allFixtures } from '../src/sim/fixtures/index';
import { Simulation, type PlayerTraceRow, type TraceRow } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import type { FixtureDef } from '../src/sim/fixture';
import { add, dist, len, qInvRot, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { footFrame } from '../src/sim/pose';
import { pace, run, runSim, stepWhile } from './helpers';

type Raw = { fps: number; frames: Record<string, number[]>[]; rest: Record<string, number[]>; rot: Record<string, number[]>[] };
const clone = (): Raw => JSON.parse(JSON.stringify(FAST));
const REC = (id: string): RunClipRecord => {
  const r = RUN_CLIPS_RECORD.clips.find((c) => c.id === id);
  if (!r) throw new Error(`no clip record ${id}`);
  return r;
};
const FIX = (id: string): FixtureDef => {
  const f = allFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};
const frac = (x: number): number => ((x % 1) + 1) % 1;
/** Phase difference b - a wrapped to (-0.5, 0.5]. */
const du = (a: number, b: number): number => {
  const d = frac(b - a);
  return d > 0.5 ? d - 1 : d;
};
function sampleDiff(a: ClipSample, b: ClipSample): number {
  let m = 0;
  const d = (p: Vec3, q: Vec3) => (m = Math.max(m, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z)));
  for (const s of ['left', 'right'] as const) {
    for (const k of ['hip', 'knee', 'ankle', 'toe'] as const) d(a.leg[s][k], b.leg[s][k]);
    for (const k of ['upper', 'fore'] as const) d(a.arm[s][k], b.arm[s][k]);
  }
  return m;
}
const playerRows = (sim: Simulation, id: string): { t: number; r: PlayerTraceRow }[] => sim.trace.map((row) => ({ t: row.t, r: row.players[id] }));
const legScale = (def: FixtureDef, rec: RunClipRecord): number => (def.ragdoll!.lengths.thigh + def.ragdoll!.lengths.shin) / rec.restLegM;

describe('L1 asset and intake record', () => {
  it('the committed intake record reproduces from models/animations (manifest FBX hashes, analysis, policy)', () => {
    expect(clipIntake()).toEqual(JSON.parse(JSON.stringify(RUN_CLIPS_RECORD)));
  });

  it('each clip stores identity, root-motion policy, nominal speed, playback bounds, half-open stance and phase zero', () => {
    for (const r of RUN_CLIPS_RECORD.clips) {
      expect(r.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.dataSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.rootMotion.policy).toBe('inPlace');
      expect(r.phaseZero).toBe('leftTouchdown');
      expect(r.nominalSpeedMps).toBeGreaterThan(0);
      expect(r.playback.minRate).toBeGreaterThan(0);
      expect(r.playback.maxRate).toBeGreaterThanOrEqual(r.playback.minRate);
      // phase 0 is the left touchdown: the left stance interval starts at 0; intervals are [touchdown, liftoff)
      expect(r.stance.left[0]).toBe(0);
      for (const s of ['left', 'right'] as const) {
        expect(r.stance[s][0]).toBeGreaterThanOrEqual(0);
        expect(r.stance[s][0]).toBeLessThan(1);
        expect(r.stance[s][1]).toBeGreaterThan(0);
        expect(r.stance[s][1]).toBeLessThanOrEqual(1);
      }
      // a run has flight: both feet off the floor for part of the cycle
      expect(r.flightFraction).toBeGreaterThan(0);
      // the clip rest pose is the calibrated model's rest pose (same skeleton)
      expect(r.restVsCalibrationM).toBeLessThan(0.001);
    }
    expect(suppliedRunClips().map((c) => c.id)).toEqual(['fast-run', 'sprint']);
  });
});

describe('L1 decode: errors, root-motion removal, loop seams, determinism', () => {
  const rec = REC('fast-run');
  it('missing or invalid assets are explicit RunClipErrors', () => {
    expect(() => decodeRunClips([rec], {})).toThrow(/data models\/animations\/fast-run.json missing/);
    expect(() => decodeRunClip(rec, undefined)).toThrow(/data missing/);
    const cases: [string, (c: Raw) => void, RegExp][] = [
      ['missing joint', (c) => delete c.frames[3].LeftFoot, /joint LeftFoot missing or not finite/],
      ['NaN', (c) => (c.frames[3].Hips[0] = NaN), /joint Hips missing or not finite/],
      ['fps', (c) => (c.fps = 0), /invalid fps/],
      ['quaternion', (c) => (c.rot[2].Spine2 = [0, 0, 0, 2]), /not a unit quaternion/],
      ['rotation count', (c) => c.rot.pop(), /rotation track count/],
      ['scale change', (c) => (c.frames[5] = Object.fromEntries(Object.entries(c.frames[5]).map(([k, p]) => [k, p.map((x) => x * 1.08)]))), /scale change/],
      [
        'open loop',
        (c) => {
          const n = c.frames.length;
          for (let i = Math.floor(n / 2); i < n; i++) for (const k of Object.keys(c.frames[i])) c.frames[i][k][1] += (0.05 * (i - n / 2)) / n;
        },
        /not a closed cycle/,
      ],
    ];
    for (const [, edit, re] of cases) {
      const c = clone();
      edit(c);
      expect(() => decodeRunClip(rec, c)).toThrow(RunClipError);
      expect(() => decodeRunClip(rec, c)).toThrow(re);
    }
    expect(() => decodeRunClip({ ...rec, nominalSpeedMps: rec.nominalSpeedMps + 0.01 }, clone())).toThrow(/re-run npm run intake-clips/);
  });

  it('root travel and yaw added to the samples are removed: identical working samples', () => {
    const c = clone();
    const a = (25 * Math.PI) / 180;
    const [ca, sa] = [Math.cos(a), Math.sin(a)];
    const qy = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
    const qm = (p: number[], q: number[]) => [
      p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1],
      p[3] * q[1] - p[0] * q[2] + p[1] * q[3] + p[2] * q[0],
      p[3] * q[2] + p[0] * q[1] - p[1] * q[0] + p[2] * q[3],
      p[3] * q[3] - p[0] * q[0] - p[1] * q[1] - p[2] * q[2],
    ];
    c.frames.forEach((f, i) => {
      for (const k of Object.keys(f)) {
        const [x, y, z] = f[k];
        f[k] = [ca * x + sa * z + 0.2 * i, y, -sa * x + ca * z + 0.06 * i];
      }
    });
    c.rot.forEach((f) => {
      for (const k of Object.keys(f)) f[k] = qm(qy, f[k]);
    });
    const an = analyzeRunClip('fast-run', c);
    expect(an.residualTravelM[0]).toBeGreaterThan(1);
    expect(an.travelHeadingDeg).toBeCloseTo(rec.travelHeadingDeg + 25, 4);
    const moved = decodeRunClip({ ...rec, travelHeadingDeg: an.travelHeadingDeg }, c);
    const base = suppliedRunClips()[0];
    for (const u of [0, 0.13, 0.5, 0.77, 0.999]) expect(sampleDiff(sampleRunClip(base, u), sampleRunClip(moved, u))).toBeLessThan(1e-9);
  });

  it('loop seams are continuous, sampling is deterministic and wraps', () => {
    for (const clip of suppliedRunClips()) {
      expect(sampleDiff(sampleRunClip(clip, 1 - 1e-7), sampleRunClip(clip, 0))).toBeLessThan(1e-5);
      expect(sampleRunClip(clip, 0.37)).toEqual(sampleRunClip(clip, 0.37));
      expect(sampleDiff(sampleRunClip(clip, 1.37), sampleRunClip(clip, 0.37))).toBeLessThan(1e-9);
      expect(sampleDiff(sampleRunClip(clip, -0.63), sampleRunClip(clip, 0.37))).toBeLessThan(1e-9);
      // shared and immutable
      expect(Object.isFrozen(clip.frames)).toBe(true);
      expect(Object.isFrozen(clip.frames[0])).toBe(true);
      expect(Object.isFrozen(clip.frames[0].leg.left.ankle)).toBe(true);
      expect(Object.isFrozen(clip.record.stance.left)).toBe(true);
    }
  });
});

describe('L1 playback from solved travel (unit)', () => {
  const P = runClipsBew();
  const legM = P.clips[0].record.restLegM;
  const drive = (v: number, n: number, dt: number, supported = true, st = newRunPlayback(0)) => {
    let p = v3();
    advanceRunPlayback(st, P, { coreP: p, forward: v3(1, 0, 0), supported, dt: 0, initSpeed: v, initDir: v3(1, 0, 0), legM });
    const out: { u: number; w: number; rate: number }[] = [];
    for (let i = 0; i < n; i++) {
      p = v3(p.x + v * dt, 0, 0);
      advanceRunPlayback(st, P, { coreP: p, forward: v3(1, 0, 0), supported, dt, legM });
      out.push({ u: st.u, w: st.w, rate: st.rate });
    }
    return { st, out };
  };

  it('constant speed: phase rate = actual speed over the stride, bounded by the playback rates', () => {
    const fr = P.clips[0].record;
    const dt = 1 / 240;
    const { st, out } = drive(5, 240, dt);
    expect(st.w).toBe(1);
    expect(st.rate).toBeCloseTo(5 / (fr.strideM / fr.cycleS), 9);
    for (let i = 1; i < out.length; i++) expect(du(out[i - 1].u, out[i].u)).toBeCloseTo((st.rate * dt) / fr.cycleS, 9);
    expect(drive(12, 10, dt).st.rate).toBe(P.clips[1].record.playback.maxRate);
    expect(drive(0.6 * (fr.strideM / fr.cycleS), 10, dt).st.rate).toBe(fr.playback.minRate);
  });

  it('slow, stopped or unsupported: the weight fades (bounded rate) to the procedural fallback', () => {
    const dt = 1 / 240;
    expect(drive(P.fadeMps[0] - 0.1, 10, dt).st.w).toBe(0);
    const { st } = drive(5, 10, dt);
    const fall = drive(5, 120, dt, false, st);
    expect(fall.st.wTarget).toBe(0);
    for (let i = 1; i < fall.out.length; i++) expect(fall.out[i - 1].w - fall.out[i].w).toBeLessThanOrEqual(P.weightRatePerS * dt + 1e-12);
    expect(fall.st.w).toBe(0);
    // with zero weight the phase does not advance (the procedural gait owns it)
    expect(fall.out.at(-1)!.u).toBe(fall.out.at(-2)!.u);
  });

  it('a hard speed change crosses the clip blend at the bounded blend rate, not in one step', () => {
    const dt = 1 / 240;
    const st = newRunPlayback(0);
    let x = 0;
    const step = (v: number) => {
      x += v * dt;
      advanceRunPlayback(st, P, { coreP: v3(x, 0, 0), forward: v3(1, 0, 0), supported: true, dt, legM });
    };
    advanceRunPlayback(st, P, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt: 0, initSpeed: 6.8, initDir: v3(1, 0, 0), legM });
    for (let i = 0; i < 20; i++) step(6.8);
    expect(st.pos).toBe(1);
    const pos = [st.pos];
    for (let i = 0; i < 240; i++) {
      step(5);
      pos.push(st.pos);
      expect(st.k + st.blend).toBeCloseTo(st.pos, 12);
    }
    for (let i = 1; i < pos.length; i++) expect(Math.abs(pos[i] - pos[i - 1])).toBeLessThanOrEqual(P.blendRatePerS * dt + 1e-12);
    expect(pos[1]).toBeGreaterThan(0.9);
    expect(pos.at(-1)).toBe(0);
  });

  it('invalid profiles are rejected at simulation initialization', async () => {
    const def = L1.l1f1('fastRun');
    await expect(Simulation.create({ ...def, runClips: runClipsBew({ clips: [] }) })).rejects.toThrow(/no clips/);
    await expect(Simulation.create({ ...def, runClips: runClipsBew({ clips: [...suppliedRunClips()].reverse() }) })).rejects.toThrow(/ascending nominal speed/);
    await expect(Simulation.create({ ...def, runClips: runClipsBew({ fadeMps: [3, 2] }) })).rejects.toThrow(/fade band/);
    await expect(Simulation.create({ ...def, runClips: runClipsBew({ blendRatePerS: 0 }) })).rejects.toThrow(/blend rate/);
    const R = def.ragdoll!;
    expect(() => validateRunClipProfile(P, { ...R, lengths: { ...R.lengths, thigh: R.lengths.thigh * 2, shin: R.lengths.shin * 2 } })).toThrow(/leg scale/);
  });
});

describe('L1 fixtures: supplied clips in the simulation', () => {
  it('L1-F1 constant speed: clip plays from the first tick, phase follows the solved travel each tick', async () => {
    for (const [kind, clipLabel] of [
      ['fastRun', 'fast-run'],
      ['sprint', 'fast-run+sprint'],
    ] as const) {
      const def = L1.l1f1(kind);
      const sim = await run(def);
      const rows = playerRows(sim, 'R');
      const tick = sim.tickS;
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1].r.run!;
        const b = rows[i].r.run!;
        expect(b.w).toBe(1);
        expect(b.clip).toBe(clipLabel);
        const cyc = P_cycle(b.b);
        expect(Math.abs(du(a.u, b.u) - (b.r * tick) / cyc)).toBeLessThan(2e-4);
      }
      const last = rows.at(-1)!.r.run!;
      if (kind === 'sprint') expect(last.b).toBe(1);
      const rec = REC(kind === 'fastRun' ? 'fast-run' : 'sprint');
      const nominal = (rec.strideM * legScale(def, rec)) / rec.cycleS;
      expect(last.r).toBeCloseTo(Math.min(rec.playback.maxRate, Math.max(rec.playback.minRate, last.v / nominal)), 3);
      console.log(`[L1-F1-${kind}] v ${last.v} m/s rate ${last.r} clip ${last.clip} max residuals ${JSON.stringify(maxRes(rows))}`);
      sim.dispose();
    }
  });

  it('L1-F2 accelerate/brake: procedural at rest, clip while running, back to procedural; weight changes are bounded', async () => {
    const def = L1.l1f2();
    const sim = await run(def);
    const rows = playerRows(sim, 'R');
    const lim = def.runClips!.weightRatePerS * sim.tickS + 1e-4;
    for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i].r.run!.w - rows[i - 1].r.run!.w)).toBeLessThanOrEqual(lim);
    expect(rows.filter((x) => x.t < 0.5).every((x) => x.r.run!.w === 0)).toBe(true);
    expect(Math.max(...rows.map((x) => x.r.run!.w))).toBe(1);
    expect(rows.at(-1)!.r.run!.w).toBe(0);
    sim.dispose();
  });

  it('L1-F3 collision slowdown: playback rate follows the actual (reduced) speed, not the request', async () => {
    const def = L1.l1f3();
    const sim = await run(def);
    const rec = REC('fast-run');
    const nominal = (rec.strideM * legScale(def, rec)) / rec.cycleS;
    const rows = playerRows(sim, 'R').filter((x) => x.r.run && x.r.run.w > 0 && x.r.run.b === 0);
    const slow = rows.filter((x) => x.r.run!.v < 0.8 * 5.8);
    expect(slow.length).toBeGreaterThan(0);
    for (const x of rows) expect(x.r.run!.r).toBeCloseTo(Math.min(rec.playback.maxRate, Math.max(rec.playback.minRate, x.r.run!.v / nominal)), 3);
    sim.dispose();
  });

  it('L1-F4 two independent phases: each player advances its own phase at its own rate; a solo run gives the same playback', async () => {
    const def = L1.l1f4();
    const sim = await run(def);
    const R = playerRows(sim, 'R');
    const D = playerRows(sim, 'D');
    expect(R[0].r.run!.u).not.toBe(D[0].r.run!.u);
    expect(R.at(-1)!.r.run!.r).not.toBe(D.at(-1)!.r.run!.r);
    const solo = await run({ ...def, players: def.players.filter((p) => p.id === 'R') });
    expect(playerRows(solo, 'R').map((x) => x.r.run)).toEqual(R.map((x) => x.r.run));
    for (const s of [sim, solo]) s.dispose();
  });

  it('held arms keep precedence (identical to the clip-free run); the carry arm swings with the ball in its palm', async () => {
    for (const [g4, l1] of [
      ['G4-F3-twoArm-M', 'L1-F5-twoArm'],
      ['G4-F3-oneArm-M', 'L1-F6-oneArm'],
    ]) {
      const A = await Simulation.create(FIX(g4));
      const B = await Simulation.create(FIX(l1));
      let held = 0;
      let swung = 0;
      let carried = 0;
      let ballRows = 0;
      while (!A.done && !B.done) {
        A.stepTick();
        await pace();
        B.stepTick();
        await pace();
        if (A.players.some((p) => p.handoff) || B.players.some((p) => p.handoff)) break;
        for (const id of ['R', 'D'])
          for (const s of ['left', 'right'] as const) {
            const la = A.players.find((p) => p.id === id)!.pose!.jointLandmarksWorld;
            const lb = B.players.find((p) => p.id === id)!.pose!.jointLandmarksWorld;
            const d = Math.max(...[`${s}Elbow`, `${s}Wrist`, `${s}Palm`].map((k) => dist(la[k], lb[k])));
            const ph = B.trace.at(-1)!.players[id].arm?.[s]?.ph;
            if (ph) {
              // achieved (ArmSystem) arm: never the clip
              expect(d).toBe(0);
              held++;
            } else if (id === 'R' && s === 'right') {
              if (d > 0) carried++;
            } else if (d > 0) swung++;
          }
        // the rule ball is the carry palm (ballSource carryPalm)
        const row = B.trace.at(-1)!.rule;
        if (row) {
          const palm = B.players.find((p) => p.id === 'R')!.pose!.jointLandmarksWorld.rightPalm;
          expect(dist({ x: row.ball[0], y: row.ball[1], z: row.ball[2] }, palm)).toBeLessThan(1e-4);
          ballRows++;
        }
      }
      expect(held).toBeGreaterThan(0);
      expect(swung).toBeGreaterThan(0);
      expect(carried).toBeGreaterThan(0);
      expect(ballRows).toBeGreaterThan(0);
      for (const s of [A, B]) s.dispose();
    }
  });

  it('no pops: no tick moves a body-local knee, ankle, shoe, elbow or palm faster than twice the clip request does', async () => {
    // defect detector: second difference per tick of body-local landmarks vs the largest of the clip's own retargeted
    // request (ankle targets for the legs, palm targets / carry swing for the arms) over the same run
    const keys = { leg: ['Knee', 'Ankle', 'Shoe'], arm: ['Elbow', 'Palm'] };
    for (const def of [L1.l1f1('fastRun'), L1.l1f1('sprint'), L1.l1f2(), L1.l1f4()]) {
      const sim = await Simulation.create(def);
      const P = def.runClips!;
      const hist: Record<string, Record<string, Vec3>[]> = {};
      while (!sim.done) {
        sim.stepTick();
        await pace();
        for (const pl of sim.players) {
          if (!pl.pose || pl.rag) continue;
          const c = pl.pose.segments.core;
          const L = (w: Vec3): Vec3 => qInvRot(c.rotationWorld, sub(w, c.originWorld));
          const row: Record<string, Vec3> = {};
          for (const s of ['left', 'right'] as const) for (const k of [...keys.leg, ...keys.arm]) row[`${s}${k}`] = L(pl.pose.jointLandmarksWorld[`${s}${k}`]);
          const smp = pl.run && pl.run.w > 0 ? playbackSample(pl.run, P) : null;
          if (smp) {
            const r = retargetSample(smp, pl.run!.w, pl.body, def.ragdoll!, { p: c.originWorld, q: c.rotationWorld }, pl.run!.heading, {
              armSwing: P.armSwing,
              carrySwing: P.carrySwing,
              restToe: P.clips[pl.run!.k].restToe,
              armMean: playbackArmMean(pl.run!, P),
            });
            for (const s of ['left', 'right'] as const) {
              row[`req:leg:${s}`] = r.legs[s].ankleLocal;
              row[`req:arm:${s}`] = s === 'right' && pl.setup.role === 'runner' ? scale(r.arms![s].swingLocal, r.carrySwing) : r.arms![s].palmLocal;
            }
          }
          (hist[pl.id] ??= []).push(row);
        }
      }
      const acc = (h: Record<string, Vec3>[], k: string): number[] => {
        const out: number[] = [];
        for (let i = 1; i < h.length - 1; i++) {
          const [a, b, c] = [h[i - 1][k], h[i][k], h[i + 1][k]];
          if (a && b && c) out.push(len(v3(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y, c.z - 2 * b.z + a.z)));
        }
        return out;
      };
      for (const [id, h] of Object.entries(hist)) {
        for (const part of ['leg', 'arm'] as const) {
          const ref = Math.max(...['left', 'right'].flatMap((s) => acc(h, `req:${part}:${s}`)));
          expect(ref).toBeGreaterThan(0);
          for (const s of ['left', 'right'])
            for (const k of keys[part]) {
              const worst = Math.max(...acc(h, `${s}${k}`));
              if (worst > 2 * ref) throw new Error(`${def.id} ${id} ${s}${k}: ${worst.toFixed(4)} m/tick^2 > 2 x request ${ref.toFixed(4)}`);
            }
        }
      }
      sim.dispose();
    }
  });

  it('the shoe follows the clip foot angle; after a handoff it stays at the handoff ankle pitch', async () => {
    const def = L1.l1f5();
    const R = def.ragdoll!;
    const sim = await Simulation.create(def);
    let pitched = 0;
    let after = 0;
    let frozen: Partial<Record<'left' | 'right', number>> | null = null;
    while (!sim.done) {
      sim.stepTick();
      await pace();
      for (const pl of sim.players) {
        const pose = pl.pose;
        if (!pose) continue;
        const lm = pose.jointLandmarksWorld;
        for (const s of ['left', 'right'] as const) {
          // the shoe landmark is on the pitched shoe frame (supported and ragdoll poses alike)
          const want = add(lm[`${s}Ankle`], qRot(footFrame(pose, s), v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM)));
          expect(dist(lm[`${s}Shoe`], want)).toBeLessThan(1e-6);
          if (!pl.rag && Math.abs(pose.anklePitchDeg?.[s] ?? 0) > 5) pitched++;
        }
        if (pl.id === 'R' && pl.rag) {
          frozen ??= { ...pl.rag.anklePitchDeg };
          expect(pose.anklePitchDeg).toEqual(frozen);
          after++;
        }
      }
    }
    expect(pitched).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
    expect(Object.keys(frozen!).length).toBe(2);
    sim.dispose();
  });

  it('render rate never changes the playback or the trace; reset reproduces the phase sequence', async () => {
    for (const def of [L1.l1f2(), L1.l1f4()]) {
      const byRate = async (hz: number) => {
        const s = await Simulation.create(def);
        const drv = new FixedStepDriver(def.solver.outerTickS, 8);
        while (!s.done) {
          for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
          await pace();
        }
        return s;
      };
      const a = await byRate(30);
      const b = await byRate(144);
      expect(JSON.stringify(b.trace)).toBe(JSON.stringify(a.trace));
      const c = await Simulation.create(def);
      await stepWhile(c, () => c.t < 1.2 - 1e-9);
      c.reset();
      await runSim(c);
      expect(JSON.stringify(c.trace)).toBe(JSON.stringify(a.trace));
      for (const s of [a, b, c]) s.dispose();
    }
  });

  it('limbs stay finite with fixed lengths; flight phases stay visible in the pose', async () => {
    let flight = 0;
    for (const def of L1.locomotionFixtures()) {
      const R = def.ragdoll!;
      const sim = await Simulation.create(def);
      const check = () => {
        for (const pl of sim.players) {
          if (!pl.pose || pl.rag) continue;
          const lm = pl.pose.jointLandmarksWorld;
          for (const v of Object.values(lm)) expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
          for (const s of ['left', 'right']) {
            expect(Math.abs(dist(lm[`${s}Hip`], lm[`${s}Knee`]) - R.lengths.thigh)).toBeLessThan(1e-6);
            expect(Math.abs(dist(lm[`${s}Knee`], lm[`${s}Ankle`]) - R.lengths.shin)).toBeLessThan(1e-6);
            expect(Math.abs(dist(lm[`${s}Shoulder`], lm[`${s}Elbow`]) - R.lengths.upperArm)).toBeLessThan(1e-6);
          }
          if (def.id === 'L1-F1-fastRun' && pl.run && pl.run.w === 1 && lm.leftShoe.y > 0.15 && lm.rightShoe.y > 0.15) flight++;
        }
      };
      while (!sim.done) {
        sim.stepTick();
        await pace();
        check();
      }
      sim.dispose();
    }
    expect(flight).toBeGreaterThan(0);
  });

  it('physics before the first handoff is unchanged by the clips (same requests, forces and root as G4-F3-*-M)', async () => {
    for (const [g4, l1] of [
      ['G4-F3-twoArm-M', 'L1-F5-twoArm'],
      ['G4-F3-oneArm-M', 'L1-F6-oneArm'],
      ['G4-F3-failed-M', 'L1-F7-failed'],
    ]) {
      const A = await Simulation.create(FIX(g4));
      const B = await Simulation.create(FIX(l1));
      let n = 0;
      while (!A.done && !B.done) {
        A.stepTick();
        await pace();
        B.stepTick();
        await pace();
        if (A.players.some((p) => p.handoff) || B.players.some((p) => p.handoff)) break;
        const strip = (row: TraceRow) => JSON.stringify(Object.fromEntries(Object.entries(row.players).map(([id, r]) => [id, { ...r, run: undefined }])));
        expect(strip(B.trace.at(-1)!)).toBe(strip(A.trace.at(-1)!));
        n++;
      }
      expect(n).toBeGreaterThan(30);
      for (const s of [A, B]) s.dispose();
    }
  });

  it('candidate and transfer audits: every handoff is accepted with a passing audit or rejected with reasons', async () => {
    const rows: string[] = [];
    for (const def of L1.locomotionFixtures()) {
      const sim = await run(def);
      expect(['invalidTransfer', 'numericalFailure']).not.toContain(sim.result);
      for (const pl of sim.players) {
        if (!pl.handoff) continue;
        expect(pl.handoff.outcome).not.toBe('transferFailed');
        if (pl.handoff.outcome === 'accepted') expect(pl.handoff.audit?.ok).toBe(true);
        else expect(pl.handoff.report.reasons.length).toBeGreaterThan(0);
        rows.push(`${def.id} ${pl.id} ${pl.handoff.outcome} t ${pl.handoff.t.toFixed(3)} ${pl.handoff.report.reasons.join(',')}`);
      }
      rows.push(`${def.id} result ${sim.result}`);
      sim.dispose();
    }
    console.log(`[L1] handoffs and results:\n  ${rows.join('\n  ')}`);
  });

  it('export and trace carry the clip profile identity and per-player playback', async () => {
    const def = L1.l1f4();
    const sim = await Simulation.create(def);
    sim.stepTick();
    await pace();
    const ex = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
    expect(ex.profileIds.runClips).toBe(def.runClips!.id);
    expect(def.runClips!.id).toBe(`run-clips:${suppliedRunClips().map((c) => c.identity).join('+')}`);
    const json = JSON.stringify(ex.profiles.runClips);
    for (const c of suppliedRunClips()) expect(json).toContain(c.identity);
    expect(json).not.toContain('"frames"');
    const row = sim.trace.at(-1)!.players;
    for (const id of ['R', 'D']) expect(Object.keys(row[id].run!).sort()).toEqual(['b', 'clip', 'r', 'res', 'u', 'v', 'w', 'wt']);
    // fixtures without a clip profile export and trace nothing new
    const g = await Simulation.create(FIX('G4-F3-twoArm-M'));
    g.stepTick();
    await pace();
    expect((g.exportFixture() as { profileIds: Record<string, unknown> }).profileIds.runClips).toBeUndefined();
    expect(g.trace.at(-1)!.players.R.run).toBeUndefined();
    for (const s of [sim, g]) s.dispose();
  });
});

/** Blended cycle length of the supplied pair at blend b. */
function P_cycle(b: number): number {
  const [a, c] = suppliedRunClips().map((x) => x.record.cycleS);
  return a + (c - a) * b;
}

function maxRes(rows: { r: PlayerTraceRow }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of rows) for (const [k, v] of Object.entries(x.r.run?.res ?? {})) m[k] = Math.max(m[k] ?? 0, v);
  return m;
}

