// Plan 06 (L1): supplied run clips sampled into the calibrated player's physical pose. Asset/record contract, decode
// errors, root-motion removal, loop seams, playback from solved travel (speed scaling, bounded fallback), independent
// phases, held/carry-arm precedence, render-rate and reset reproducibility, limb contract, unchanged physics before the
// first handoff, candidate/transfer audits and the exported identity.
// Plan 13d: one run clip, Fast Run, for every run speed: below its slowest cadence the stride shortens (the jog), and the
// swing lift and the run bob scale with the stride share.
import { afterAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clipIntake } from '../scripts/model/clip-intake';
import { idleIntake } from '../scripts/model/idle-intake';
import { IDLE_POSE_RECORD } from '../src/sim/locomotion';
import FAST from '../models/animations/fast-run.json';
import { RUN_CLIPS_RECORD, decodeRunClips, runClipsBew, runClipsL3, suppliedRunClips, suppliedWalkClip } from '../src/sim/model/run-clips';
import { clipHeightModel, runHeight } from '../src/sim/support';
import { SUSPENSION_RH } from '../src/sim/profiles';
import {
  RunClipError,
  advanceRunPlayback,
  analyzeRunClip,
  decodeRunClip,
  newRunPlayback,
  playbackArmMean,
  playbackLabel,
  playbackSample,
  retargetSample,
  sampleRunClip,
  validateRunClipProfile,
  type ClipSample,
  type RunClipRecord,
} from '../src/sim/run-clip';
import * as L1 from '../src/sim/fixtures/locomotion';
import { Simulation, type PlayerTraceRow, type TraceRow } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import type { FixtureDef } from '../src/sim/fixture';
import { add, dist, len, qInvRot, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { footFrame } from '../src/sim/pose';
import { create, FIX, pace, rows, run, runSim, stepWhile } from './helpers';

type Raw = { fps: number; frames: Record<string, number[]>[]; rest: Record<string, number[]>; rot: Record<string, number[]>[] };
const clone = (): Raw => JSON.parse(JSON.stringify(FAST));
const REC = (id: string): RunClipRecord => {
  const r = RUN_CLIPS_RECORD.clips.find((c) => c.id === id);
  if (!r) throw new Error(`no clip record ${id}`);
  return r;
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

// ------------------------------------------------------------------------------------------- shared runs
/** An observer of a shared run. It keeps its first failure; its own test rethrows it. */
type Watch<F> = { each: F; error?: unknown };
const throwIfFailed = (w: { error?: unknown }): void => {
  if (w.error !== undefined) throw w.error;
};
const call = <A extends unknown[]>(ws: Watch<(...a: A) => void>[], ...a: A): void => {
  for (const w of ws) {
    if (w.error !== undefined) continue;
    try {
      w.each(...a);
    } catch (e) {
      w.error = e;
    }
  }
};

const fixtureWatches = new Map<string, Watch<(sim: Simulation) => void>[]>();
/** Observe the shared run of locomotion fixture `id` after every tick (registered while the file is collected). */
function watch(id: string, each: (sim: Simulation) => void): Watch<(sim: Simulation) => void> {
  const w = { each };
  if (!fixtureWatches.has(id)) fixtureWatches.set(id, []);
  fixtureWatches.get(id)!.push(w);
  return w;
}
const fixtureRuns = new Map<string, Promise<Simulation>>();
/**
 * A locomotion fixture run once for the file, with every observer registered for it called after every tick; tests read
 * the finished simulation and never change it. Observers only read.
 */
function shared(def: FixtureDef): Promise<Simulation> {
  let p = fixtureRuns.get(def.id);
  if (!p) {
    const ws = fixtureWatches.get(def.id) ?? [];
    p = (async () => {
      const sim = await create(def);
      while (!sim.done) {
        sim.stepTick();
        await pace();
        call(ws, sim);
      }
      return sim;
    })();
    fixtureRuns.set(def.id, p);
  }
  return p;
}

const pairWatches = new Map<string, Watch<(A: Simulation, B: Simulation) => void>[]>();
/** Observe the shared lockstep run of a G4-F3-*-M fixture and its L1 twin, after every tick up to the first handoff. */
function watchPair(g4: string, l1: string, each: (A: Simulation, B: Simulation) => void): Watch<(A: Simulation, B: Simulation) => void> {
  const k = `${g4}|${l1}`;
  const w = { each };
  if (!pairWatches.has(k)) pairWatches.set(k, []);
  pairWatches.get(k)!.push(w);
  return w;
}
const pairRuns = new Map<string, Promise<void>>();
/** G4-F3-*-M and its L1 twin stepped together until either hands off, once per pair for the file. */
function lockstep(g4: string, l1: string): Promise<void> {
  const k = `${g4}|${l1}`;
  let p = pairRuns.get(k);
  if (!p) {
    const ws = pairWatches.get(k) ?? [];
    p = (async () => {
      const A = await Simulation.create(FIX(g4));
      const B = await Simulation.create(FIX(l1));
      while (!A.done && !B.done) {
        A.stepTick();
        await pace();
        B.stepTick();
        await pace();
        if (A.players.some((p) => p.handoff) || B.players.some((p) => p.handoff)) break;
        call(ws, A, B);
      }
      for (const s of [A, B]) s.dispose();
    })();
    pairRuns.set(k, p);
  }
  return p;
}
afterAll(async () => {
  for (const p of fixtureRuns.values()) (await p).dispose();
});

describe('L1 asset and intake record', () => {
  const CHECKS: [string, () => void][] = [
    [
      'the committed intake record reproduces from models/animations (manifest FBX hashes, analysis, policy)',
      () => {
        expect(clipIntake()).toEqual(JSON.parse(JSON.stringify(RUN_CLIPS_RECORD)));
      },
    ],
    [
      'intake inputs it cannot use fail by name: no walk clip, an idle rest skeleton off +Z or with unequal legs (plan 10b)',
      () => {
        const dir = mkdtempSync(join(tmpdir(), 'intake-'));
        try {
          const manifest = JSON.parse(readFileSync('models/animations/manifest.json', 'utf8')) as { kind?: string; source: string; data: string }[];
          writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest.filter((m) => m.kind !== 'walk')));
          expect(() => clipIntake(dir)).toThrow(RunClipError);
          expect(() => clipIntake(dir)).toThrow(/exactly one walk clip.*has 0/);
          // the idle: the real source, its data with the rest skeleton turned 2 degrees, then with one rest leg 2 mm longer
          const idle = manifest.find((m) => m.kind === 'idle')!;
          writeFileSync(join(dir, 'manifest.json'), JSON.stringify([idle]));
          mkdirSync(dirname(join(dir, idle.source)), { recursive: true });
          copyFileSync(`models/animations/${idle.source}`, join(dir, idle.source));
          const raw = JSON.parse(readFileSync(`models/animations/${idle.data}`, 'utf8')) as { rest: Record<string, number[]> };
          const turn = (deg: number): Record<string, number[]> => {
            const c = Math.cos((deg * Math.PI) / 180);
            const sn = Math.sin((deg * Math.PI) / 180);
            return Object.fromEntries(Object.entries(raw.rest).map(([k, p]) => [k, [p[0]! * c - p[2]! * sn, p[1]!, p[0]! * sn + p[2]! * c]]));
          };
          expect(idleIntake('models/animations')).toEqual(IDLE_POSE_RECORD);
          writeFileSync(join(dir, idle.data), JSON.stringify({ ...raw, rest: turn(2) }));
          expect(() => idleIntake(dir)).toThrow(/turned 2\.\d+ degrees from \+Z/);
          writeFileSync(join(dir, idle.data), JSON.stringify({ ...raw, rest: { ...raw.rest, LeftFoot: [raw.rest.LeftFoot![0]!, raw.rest.LeftFoot![1]! - 0.002, raw.rest.LeftFoot![2]!] } }));
          expect(() => idleIntake(dir)).toThrow(/rest legs differ/);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    ],
    [
      'each clip stores identity, root-motion policy, nominal speed, playback bounds, half-open stance and phase zero',
      () => {
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
        expect(suppliedRunClips().map((c) => c.id)).toEqual(['fast-run']);
        // plan 13d: the manifest lists one run clip
        const manifest = JSON.parse(readFileSync('models/animations/manifest.json', 'utf8')) as { id: string }[];
        expect(manifest.map((m) => m.id)).toEqual(['walk', 'fast-run', 'idle']);
      },
    ],
  ];

  it('the committed intake record reproduces from models/animations; inputs it cannot use fail by name; each clip stores identity, root-motion policy, nominal speed, playback bounds, half-open stance and phase zero', async () => {
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('L1 decode: errors, root-motion removal, loop seams, determinism', () => {
  const rec = REC('fast-run');
  const CHECKS: [string, () => void][] = [
    [
      'missing or invalid assets are explicit RunClipErrors',
      () => {
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
      },
    ],
    [
      'root travel and yaw added to the samples are removed: identical working samples',
      () => {
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
      },
    ],
    [
      'loop seams are continuous, sampling is deterministic and wraps',
      () => {
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
      },
    ],
  ];

  it('missing or invalid assets are explicit RunClipErrors; root travel and yaw added to the samples are removed; loop seams are continuous, sampling is deterministic and wraps', async () => {
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
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

  const CHECKS: [string, () => Promise<void> | void][] = [
    [
      'constant speed: phase rate = actual speed over the stride, bounded by the playback rates',
      () => {
        const fr = P.clips[0].record;
        const dt = 1 / 240;
        const { st, out } = drive(5, 240, dt);
        expect(st.w).toBe(1);
        expect(st.rate).toBeCloseTo(5 / (fr.strideM / fr.cycleS), 9);
        for (let i = 1; i < out.length; i++) expect(du(out[i - 1].u, out[i].u)).toBeCloseTo((st.rate * dt) / fr.cycleS, 9);
        expect(drive(12, 10, dt).st.rate).toBe(fr.playback.maxRate);
        expect(drive(0.6 * (fr.strideM / fr.cycleS), 10, dt).st.rate).toBeCloseTo(fr.playback.minRate, 9);
      },
    ],
    [
      'slow, stopped or unsupported: the weight fades (bounded rate) to the procedural fallback',
      () => {
        const dt = 1 / 240;
        expect(drive(P.fadeMps[0] - 0.1, 10, dt).st.w).toBe(0);
        const { st } = drive(5, 10, dt);
        const fall = drive(5, 120, dt, false, st);
        expect(fall.st.wTarget).toBe(0);
        for (let i = 1; i < fall.out.length; i++) expect(fall.out[i - 1].w - fall.out[i].w).toBeLessThanOrEqual(P.weightRatePerS * dt + 1e-12);
        expect(fall.st.w).toBe(0);
        // with zero weight the phase does not advance (the procedural gait owns it)
        expect(fall.out.at(-1)!.u).toBe(fall.out.at(-2)!.u);
      },
    ],
    [
      'a walk speeding up crosses the clip blend (walk to Fast Run) at the bounded blend rate, not in one step',
      () => {
        const L3 = runClipsL3();
        const dt = 1 / 240;
        const st = newRunPlayback(0);
        let x = 0;
        const step = (v: number, req: number) => {
          x += v * dt;
          advanceRunPlayback(st, L3, { coreP: v3(x, 0, 0), forward: v3(1, 0, 0), supported: true, dt, legM, requestMps: req, braking: false });
        };
        advanceRunPlayback(st, L3, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt: 0, initSpeed: 1.5, initDir: v3(1, 0, 0), legM, requestMps: 1.5, braking: false });
        for (let i = 0; i < 20; i++) step(1.5, 1.5);
        expect(st.pos).toBe(0);
        expect(st.walking).toBe(true);
        const pos = [st.pos];
        for (let i = 0; i < 240; i++) {
          step(3.5, 3.5);
          pos.push(st.pos);
          expect(st.k + st.blend).toBeCloseTo(st.pos, 12);
        }
        for (let i = 1; i < pos.length; i++) expect(Math.abs(pos[i] - pos[i - 1])).toBeLessThanOrEqual(L3.blendRatePerS * dt + 1e-12);
        expect(pos[1]).toBeLessThan(0.1);
        expect(pos.at(-1)).toBe(1);
        // plan 13d: the label names the clip that plays (Fast Run alone at blend 1, not the walk+fast-run pair)
        expect(playbackLabel(st, L3)).toBe('fast-run');
        // on the run clip the stride is the jog's share at its slowest cadence (followed: settled after 1 s)
        const fr = L3.clips[1].record;
        expect(st.stride).toBeCloseTo(3.5 / (fr.playback.minRate * (fr.strideM / fr.cycleS)), 3);
      },
    ],
    [
      'plan 13d: one run clip, Fast Run, for every run speed; the jog shortens the stride at the slowest cadence; 6.6 m/s plays at 1.13x',
      () => {
        const fr = P.clips[0].record;
        expect(P.clips.map((c) => c.id)).toEqual(['fast-run']);
        expect(P.id).toBe(`run-clips:${P.clips[0].identity}+jog-v1`);
        expect(P.fadeMps).toEqual([1.6, 2.2]);
        expect(P.run).toEqual({ minStride: 0.45, liftScale: 1, shareRadPerS: 12 });
        expect(runClipsL3().clips.map((c) => c.id)).toEqual(['walk', 'fast-run']);
        expect(runClipsL3().stanceWidthAddM).toEqual({ walk: 0, 'fast-run': 0.065 });
        const nominal = fr.strideM / fr.cycleS;
        const vMin = fr.playback.minRate * nominal;
        expect(vMin).toBeCloseTo(4.08, 2);
        const dt = 1 / 240;
        // at and above the slowest cadence: the full stride, the cadence follows the speed
        const above = drive(vMin + 0.05, 60, dt).st;
        expect(above.stride).toBe(1);
        expect(above.lift).toBe(1);
        expect(above.rate).toBeCloseTo((vMin + 0.05) / nominal, 9);
        // a jog: the stride shortens, the cadence stays at its slowest, the clip plays
        for (const v of [2.5, 3.5]) {
          const st = drive(v, 60, dt).st;
          expect(st.w).toBe(1);
          expect(st.stride).toBeCloseTo(v / vMin, 9);
          expect(st.lift).toBeCloseTo((v / vMin) ** P.run!.liftScale, 9);
          expect(st.rate).toBeCloseTo(fr.playback.minRate, 9);
        }
        // the shortest stride, at 1.84 m/s; slower keeps it (the slowest cadence then holds and the feet slip)
        const vShort = P.run!.minStride * vMin;
        expect(vShort).toBeCloseTo(1.84, 2);
        expect(drive(vShort, 60, dt).st.stride).toBeCloseTo(P.run!.minStride, 9);
        expect(drive(vShort - 0.1, 60, dt).st.stride).toBe(P.run!.minStride);
        // top speed: 6.6 m/s inside the 1.3x limit
        expect(Math.abs(drive(6.6, 60, dt).st.rate - 1.13)).toBeLessThanOrEqual(0.01);
        // the lift scale is the exponent of the share
        const sq = runClipsBew({ run: { minStride: 0.45, liftScale: 2, shareRadPerS: 12 } });
        const st = newRunPlayback(0);
        advanceRunPlayback(st, sq, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt: 0, initSpeed: 3, initDir: v3(1, 0, 0), legM });
        expect(st.lift).toBeCloseTo((3 / vMin) ** 2, 9);
        // the share follows a speed step critically damped: no jump in a substep, no overshoot, settled within 1 s
        const f = newRunPlayback(0);
        let fx = 0;
        advanceRunPlayback(f, P, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt: 0, initSpeed: 5, initDir: v3(1, 0, 0), legM });
        const shares = [f.share!];
        for (let i = 0; i < 240; i++) {
          fx += 2.5 * dt;
          advanceRunPlayback(f, P, { coreP: v3(fx, 0, 0), forward: v3(1, 0, 0), supported: true, dt, legM });
          shares.push(f.share!);
        }
        expect(shares[0]).toBe(1);
        expect(1 - shares[1]).toBeLessThan(0.01);
        for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThanOrEqual(shares[i - 1]);
        expect(shares.at(-1)!).toBeCloseTo(2.5 / vMin, 2);
        expect(shares.at(-1)!).toBeGreaterThanOrEqual(2.5 / vMin - 1e-12);
        // a substep with no travel measured (the first after setup) holds the share: it does not follow 0 m/s down
        const h = newRunPlayback(0);
        advanceRunPlayback(h, P, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt: 0, initSpeed: 6, initDir: v3(1, 0, 0), legM });
        advanceRunPlayback(h, P, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt, legM });
        expect(h.share).toBe(1);
        expect(h.shareV).toBe(0);
        // without the block: no share, no lift (the historical path)
        const none = newRunPlayback(0);
        advanceRunPlayback(none, { ...P, run: undefined }, { coreP: v3(), forward: v3(1, 0, 0), supported: true, dt: 0, initSpeed: 3, initDir: v3(1, 0, 0), legM });
        expect(none.stride).toBeUndefined();
        expect(none.lift).toBeUndefined();
      },
    ],
    [
      'plan 13d: the lift scales the swing foot and the run bob; the stance foot keeps the floor',
      () => {
        const def = L1.l1f1('fastRun');
        const body = def.players[0].body;
        const R = def.ragdoll!;
        const clip = P.clips[0];
        const core = { p: v3(0, 0.9, 0), q: { x: 0, y: 0, z: 0, w: 1 } };
        const opts = { armSwing: false, carrySwing: 0, restToe: clip.restToe, armMean: clip.meanArm };
        const st = clip.record.stance.left;
        const sole = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
        const ankleY = (u: number, lift?: number): number => {
          const l = retargetSample(sampleRunClip(clip, u), 1, body, R, core, 0, lift === undefined ? opts : { ...opts, lift }).legs.left.ankleLocal;
          return l.y + core.p.y - sole;
        };
        // mid-swing: half the lift is half the height above the flat-shoe ankle
        const swingU = (st[1] + 1) / 2;
        expect(ankleY(swingU)).toBeGreaterThan(0.05);
        expect(ankleY(swingU, 0.5)).toBeCloseTo(0.5 * ankleY(swingU), 9);
        expect(ankleY(swingU, 1)).toBe(ankleY(swingU));
        // mid-stance: unchanged
        const stanceU = (st[0] + st[1]) / 2;
        expect(ankleY(stanceU, 0.5)).toBeCloseTo(ankleY(stanceU), 12);
        // the bob: the lift multiplies its scale
        const S = SUSPENSION_RH;
        const models = P.clips.map((c) => clipHeightModel(c, S.run.bobHarmonics));
        const cal = { legM: R.lengths.thigh + R.lengths.shin, soleM: sole, hipLocalY: -0.1 };
        const pb = drive(3, 60, 1 / 240).st;
        const full = runHeight(S, P, models, { ...pb, lift: 1 }, cal, -9.81);
        const half = runHeight(S, P, models, { ...pb, lift: 0.5 }, cal, -9.81);
        expect(half.bobScale).toBeCloseTo(0.5 * full.bobScale, 12);
        expect(full.bobScale).toBeGreaterThan(0);
      },
    ],
    [
      'invalid profiles are rejected at simulation initialization',
      async () => {
        const def = L1.l1f1('fastRun');
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ clips: [] }) })).rejects.toThrow(/no clips/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ clips: [...suppliedRunClips(), suppliedWalkClip()] }) })).rejects.toThrow(/ascending nominal speed/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ run: { minStride: 0, liftScale: 1, shareRadPerS: 12 } }) })).rejects.toThrow(/invalid run stride/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ run: { minStride: 1.2, liftScale: 1, shareRadPerS: 12 } }) })).rejects.toThrow(/invalid run stride/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ run: { minStride: 0.5, liftScale: 1, shareRadPerS: 0 } }) })).rejects.toThrow(/invalid run stride/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ run: { minStride: 0.5, liftScale: -1, shareRadPerS: 12 } }) })).rejects.toThrow(/invalid run stride/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ fadeMps: [3, 2] }) })).rejects.toThrow(/fade band/);
        await expect(Simulation.create({ ...def, runClips: runClipsBew({ blendRatePerS: 0 }) })).rejects.toThrow(/blend rate/);
        const R = def.ragdoll!;
        expect(() => validateRunClipProfile(P, { ...R, lengths: { ...R.lengths, thigh: R.lengths.thigh * 2, shin: R.lengths.shin * 2 } })).toThrow(/leg scale/);
      },
    ],
  ];

  it('phase rate follows the actual speed over the stride within the playback rates; slow, stopped or unsupported fades to the procedural fallback; a speed change crosses the clip blend at the bounded rate; invalid profiles are rejected at initialization', async () => {
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('L1 fixtures: supplied clips in the simulation', () => {
  // Every locomotion fixture runs once for the file (`shared`); the per-tick checks below observe that run.

  const PLAYBACK: [string, () => Promise<void>][] = [
    [
      'L1-F1 constant speed: clip plays from the first tick, phase follows the solved travel each tick',
      async () => {
        for (const [kind, clipLabel] of [
          ['fastRun', 'fast-run'],
          ['sprint', 'fast-run'],
        ] as const) {
          const def = L1.l1f1(kind);
          const sim = await shared(def);
          const rows = playerRows(sim, 'R');
          const tick = sim.tickS;
          for (let i = 1; i < rows.length; i++) {
            const a = rows[i - 1].r.run!;
            const b = rows[i].r.run!;
            expect(b.w).toBe(1);
            expect(b.clip).toBe(clipLabel);
            expect(b.b).toBe(0);
            // plan 13d: both speeds are above the slowest cadence: the full stride from the first tick
            expect(b.s, `${kind} ${rows[i].t}`).toBe(1);
            const cyc = REC('fast-run').cycleS;
            expect(Math.abs(du(a.u, b.u) - (b.r * tick) / cyc)).toBeLessThan(2e-4);
          }
          const last = rows.at(-1)!.r.run!;
          const rec = REC('fast-run');
          const nominal = (rec.strideM * legScale(def, rec)) / rec.cycleS;
          expect(last.r).toBeCloseTo(Math.min(rec.playback.maxRate, Math.max(rec.playback.minRate, last.v / nominal)), 3);
          // plan 13d: the 6.6 m/s request plays Fast Run at about 1.13x its cadence
          if (kind === 'sprint') expect(Math.abs(last.r - 1.13)).toBeLessThanOrEqual(0.01);
          console.log(`[L1-F1-${kind}] v ${last.v} m/s rate ${last.r} clip ${last.clip} max residuals ${JSON.stringify(maxRes(rows))}`);
        }
      },
    ],
    [
      'L1-F2 accelerate/brake: procedural at rest, clip while running, back to procedural; weight changes are bounded',
      async () => {
        const def = L1.l1f2();
        const sim = await shared(def);
        const rows = playerRows(sim, 'R');
        const lim = def.runClips!.weightRatePerS * sim.tickS + 1e-4;
        for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i].r.run!.w - rows[i - 1].r.run!.w)).toBeLessThanOrEqual(lim);
        expect(rows.filter((x) => x.t < 0.5).every((x) => x.r.run!.w === 0)).toBe(true);
        expect(Math.max(...rows.map((x) => x.r.run!.w))).toBe(1);
        expect(rows.at(-1)!.r.run!.w).toBe(0);
      },
    ],
    [
      'L1-F3 collision slowdown: playback rate follows the actual (reduced) speed, not the request',
      async () => {
        const def = L1.l1f3();
        const sim = await shared(def);
        const rec = REC('fast-run');
        const nominal = (rec.strideM * legScale(def, rec)) / rec.cycleS;
        const rows = playerRows(sim, 'R').filter((x) => x.r.run && x.r.run.w > 0 && x.r.run.b === 0);
        const slow = rows.filter((x) => x.r.run!.v < 0.8 * 5.8);
        expect(slow.length).toBeGreaterThan(0);
        // plan 13d: over the jog's stride share (traced as s), which follows the speed critically damped
        for (const x of rows) expect(x.r.run!.r).toBeCloseTo(Math.min(rec.playback.maxRate, Math.max(rec.playback.minRate, x.r.run!.v / (nominal * x.r.run!.s!))), 3);
        expect(slow.some((x) => x.r.run!.s! < 1)).toBe(true);
      },
    ],
    [
      'L1-F4 two independent phases: each player advances its own phase at its own rate; a solo run gives the same playback',
      async () => {
        const def = L1.l1f4();
        const sim = await shared(def);
        const R = playerRows(sim, 'R');
        const D = playerRows(sim, 'D');
        expect(R[0].r.run!.u).not.toBe(D[0].r.run!.u);
        expect(R.at(-1)!.r.run!.r).not.toBe(D.at(-1)!.r.run!.r);
        const solo = await run({ ...def, players: def.players.filter((p) => p.id === 'R') });
        expect(playerRows(solo, 'R').map((x) => x.r.run)).toEqual(R.map((x) => x.r.run));
        solo.dispose();
      },
    ],
  ];

  it('clip playback follows the solved travel: L1-F1 constant speed, L1-F2 accelerate/brake with bounded weight changes, L1-F3 collision slowdown, L1-F4 two independent phases', async () => {
    await rows(PLAYBACK, ([n]) => n, ([, f]) => f());
  });

  // ---- held arms: observed on the lockstep runs of G4-F3-twoArm-M / L1-F5-twoArm and G4-F3-oneArm-M / L1-F6-oneArm
  const HELD = [
    ['G4-F3-twoArm-M', 'L1-F5-twoArm'],
    ['G4-F3-oneArm-M', 'L1-F6-oneArm'],
  ] as const;
  const held = HELD.map(([g4, l1]) => {
    const c = { g4, l1, held: 0, swung: 0, carried: 0, ballRows: 0 };
    const w = watchPair(g4, l1, (A, B) => {
      for (const id of ['R', 'D'])
        for (const s of ['left', 'right'] as const) {
          const la = A.players.find((p) => p.id === id)!.pose!.jointLandmarksWorld;
          const lb = B.players.find((p) => p.id === id)!.pose!.jointLandmarksWorld;
          const d = Math.max(...[`${s}Elbow`, `${s}Wrist`, `${s}Palm`].map((k) => dist(la[k], lb[k])));
          const ph = B.trace.at(-1)!.players[id].arm?.[s]?.ph;
          if (ph) {
            // achieved (ArmSystem) arm: never the clip
            expect(d).toBe(0);
            c.held++;
          } else if (id === 'R' && s === 'right') {
            if (d > 0) c.carried++;
          } else if (d > 0) c.swung++;
        }
      // the rule ball is the carry palm (ballSource carryPalm)
      const row = B.trace.at(-1)!.rule;
      if (row) {
        const palm = B.players.find((p) => p.id === 'R')!.pose!.jointLandmarksWorld.rightPalm;
        expect(dist({ x: row.ball[0], y: row.ball[1], z: row.ball[2] }, palm)).toBeLessThan(1e-4);
        c.ballRows++;
      }
    });
    return { c, w };
  });

  it('held arms keep precedence (identical to the clip-free run); the carry arm swings with the ball in its palm', async () => {
    for (const { c, w } of held) {
      await lockstep(c.g4, c.l1);
      throwIfFailed(w);
      expect(c.held).toBeGreaterThan(0);
      expect(c.swung).toBeGreaterThan(0);
      expect(c.carried).toBeGreaterThan(0);
      expect(c.ballRows).toBeGreaterThan(0);
    }
  });

  // ---- no pops: observed on the shared runs of L1-F1 (both clips), L1-F2 and L1-F4
  // defect detector: second difference per tick of body-local landmarks vs the largest of the clip's own retargeted
  // request (ankle targets for the legs, palm targets / carry swing for the arms) over the same run
  const keys = { leg: ['Knee', 'Ankle', 'Shoe'], arm: ['Elbow', 'Palm'] };
  const pops = [L1.l1f1('fastRun'), L1.l1f1('sprint'), L1.l1f2(), L1.l1f4()].map((def) => {
    const P = def.runClips!;
    const hist: Record<string, Record<string, Vec3>[]> = {};
    const w = watch(def.id, (sim) => {
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
    });
    return { def, hist, w };
  });

  it('no pops: no tick moves a body-local knee, ankle, shoe, elbow or palm faster than twice the clip request does', async () => {
    for (const { def, hist, w } of pops) {
      await shared(def);
      throwIfFailed(w);
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
    }
  });

  // ---- shoe: observed on the shared run of L1-F5
  const shoeDef = L1.l1f5();
  let pitched = 0;
  let after = 0;
  let frozen: Partial<Record<'left' | 'right', number>> | null = null;
  const shoe = watch(shoeDef.id, (sim) => {
    const R = shoeDef.ragdoll!;
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
  });

  it('the shoe follows the clip foot angle; after a handoff it stays at the handoff ankle pitch', async () => {
    await shared(shoeDef);
    throwIfFailed(shoe);
    expect(pitched).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
    expect(Object.keys(frozen!).length).toBe(2);
  });

  // ---- limbs: observed on the shared run of every locomotion fixture
  let flight = 0;
  const limbs = L1.locomotionFixtures().map((def) => {
    const R = def.ragdoll!;
    const w = watch(def.id, (sim) => {
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
    });
    return { def, w };
  });

  it('limbs stay finite with fixed lengths; flight phases stay visible in the pose', async () => {
    for (const { def, w } of limbs) {
      await shared(def);
      throwIfFailed(w);
    }
    expect(flight).toBeGreaterThan(0);
  });

  // ---- physics: observed on the lockstep runs of every G4-F3-*-M fixture and its L1 twin
  const physics = (
    [
      ['G4-F3-twoArm-M', 'L1-F5-twoArm'],
      ['G4-F3-oneArm-M', 'L1-F6-oneArm'],
      ['G4-F3-failed-M', 'L1-F7-failed'],
    ] as const
  ).map(([g4, l1]) => {
    const c = { g4, l1, n: 0 };
    const w = watchPair(g4, l1, (A, B) => {
      const strip = (row: TraceRow) => JSON.stringify(Object.fromEntries(Object.entries(row.players).map(([id, r]) => [id, { ...r, run: undefined }])));
      expect(strip(B.trace.at(-1)!)).toBe(strip(A.trace.at(-1)!));
      c.n++;
    });
    return { c, w };
  });

  it('physics before the first handoff is unchanged by the clips (same requests, forces and root as G4-F3-*-M)', async () => {
    for (const { c, w } of physics) {
      await lockstep(c.g4, c.l1);
      throwIfFailed(w);
      expect(c.n).toBeGreaterThan(30);
    }
  });

  it('candidate and transfer audits: every handoff is accepted with a passing audit or rejected with reasons', async () => {
    const rows: string[] = [];
    for (const def of L1.locomotionFixtures()) {
      const sim = await shared(def);
      expect(['invalidTransfer', 'numericalFailure']).not.toContain(sim.result);
      for (const pl of sim.players) {
        if (!pl.handoff) continue;
        expect(pl.handoff.outcome).not.toBe('transferFailed');
        if (pl.handoff.outcome === 'accepted') expect(pl.handoff.audit?.ok).toBe(true);
        else expect(pl.handoff.report.reasons.length).toBeGreaterThan(0);
        rows.push(`${def.id} ${pl.id} ${pl.handoff.outcome} t ${pl.handoff.t.toFixed(3)} ${pl.handoff.report.reasons.join(',')}`);
      }
      rows.push(`${def.id} result ${sim.result}`);
    }
    console.log(`[L1] handoffs and results:\n  ${rows.join('\n  ')}`);
  });
});

describe('L1 fixtures: supplied clips in the simulation', () => {
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
});

function maxRes(rows: { r: PlayerTraceRow }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const x of rows) for (const [k, v] of Object.entries(x.r.run?.res ?? {})) m[k] = Math.max(m[k] ?? 0, v);
  return m;
}
