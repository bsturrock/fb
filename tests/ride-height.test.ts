// Plan 06a (RH): physical ride height and support. The ground-probed suspension (bounded force law, probe eligibility,
// load-bounded authority), stance and clip-derived height targets, standing/stance settling, running tracking, limits
// and disturbances, no false support, legacy-vs-suspension pairs, handoff with vertical motion, fixed-step
// reproducibility, legacy invariance.
//
// Plan 13b: each RH fixture is simulated once for the whole file (`rhRun`) with every per-tick observer that reads it
// attached (limb lengths and shoe penetration, vertical momentum, the stance requests, the support after a loss, the
// force application, the isolated defender, the support after a vertical handoff). An observer's per-tick assertions
// are the original ones: the first that fails is kept and rethrown by the check that owns it. A table checks every row
// and lists each failing row. The reproducibility test keeps its own runs.
import { afterAll, describe, expect, it } from 'vitest';
import * as RH from '../src/sim/fixtures/ride-height';
import { Simulation, type PlayerTraceRow } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import type { FixtureDef } from '../src/sim/fixture';
import { SUSPENSION_RH, SUPPORT_LEGACY } from '../src/sim/profiles';
import { suppliedRunClips } from '../src/sim/model/run-clips';
import {
  advanceStance,
  bobAt,
  classifyProbe,
  clipHeightModel,
  composeTarget,
  loadAuthority,
  newSuspensionRuntime,
  splitSupportForce,
  suspensionForce,
  suspensionGains,
} from '../src/sim/support';
import { footFrame, legShapes, type PoseShape } from '../src/sim/pose';
import { dist, qRot, v3 } from '../src/sim/vec';
import { create, FIX, pace, rows, run, runSim, stepWhile } from './helpers';

const S = SUSPENSION_RH;
const G = 9.81;
const playerRows = (sim: Simulation, id: string): { t: number; r: PlayerTraceRow }[] => sim.trace.map((row) => ({ t: row.t, r: row.players[id] }));
const clampReq = (x: number) => Math.min(S.targetRangeM[1], Math.max(S.targetRangeM[0], x));
const lowest = (shapes: PoseShape[]): number => {
  let y = Infinity;
  for (const s of shapes) if (s.kind === 'box') for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) y = Math.min(y, s.c.y + qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z)).y);
  return y;
};

/** Time from each change of the (range-clamped) request until |h - request| <= tol for the rest of that request. */
function settleTimes(rs: { t: number; r: PlayerTraceRow }[], tol = 0.01): { req: number; at: number; settleS: number; tailErr: number }[] {
  const sup = rs.filter((x) => x.r.sup && x.r.sup.ok === 1 && x.r.sup.h !== null && !x.r.run?.w);
  const out: { req: number; at: number; settleS: number; tailErr: number }[] = [];
  let i0 = 0;
  for (let i = 1; i <= sup.length; i++) {
    if (i < sup.length && clampReq(sup[i].r.sup!.req) === clampReq(sup[i - 1].r.sup!.req)) continue;
    const seg = sup.slice(i0, i);
    const req = clampReq(seg[0].r.sup!.req);
    let j = seg.length;
    while (j > 0 && Math.abs(seg[j - 1].r.sup!.h! - req) <= tol) j--;
    const tail = seg.filter((x) => x.t >= seg[seg.length - 1].t - 0.3);
    out.push({ req, at: seg[0].t, settleS: j < seg.length ? seg[j].t - seg[0].t : Infinity, tailErr: Math.max(...tail.map((x) => Math.abs(x.r.sup!.h! - req))) });
    i0 = i;
  }
  return out;
}

// ------------------------------------------------------------------------------------- shared runs (plan 13b)
/**
 * A per-tick observer of a shared run. `tick` holds the original per-tick assertions: the first one that fails is kept
 * (the observer stops, as the original loop did) and `check()` rethrows it in the test that owns the observer.
 */
class Watch {
  private failed = false;
  private err: unknown;
  constructor(private readonly f: () => void) {}
  tick(): void {
    if (this.failed) return;
    try {
      this.f();
    } catch (e) {
      this.failed = true;
      this.err = e;
    }
  }
  check(): void {
    if (this.failed) throw this.err;
  }
}
type Held = { knee: number; gap: number; res: number; ahead: number };

/** The contact-free fixtures whose vertical momentum is checked against the support and gravity impulses. */
const MOMENTUM = (): FixtureDef[] => [RH.rhf1Stand(), RH.rhf1Drop(), RH.rhf2Crouch(), RH.rhf3('fastRun'), RH.rhf3('accelBrake'), RH.rhf4Kick('down'), RH.rhf4Kick('up')];
/** The fixtures whose force application (pivot lever, split components, pivot torque) is checked per tick. */
const FORCE_APPLICATION = (): FixtureDef[] => [RH.rhf3('sprint'), RH.rhf4Load(), RH.rhf6DefenderRun(25)];
const VERTICAL = ['rising', 'falling', 'top', 'bottom'] as const;
const LIMB_IDS = new Set(RH.rideHeightFixtures().filter((d) => !d.obstacles?.length).map((d) => d.id));
const MOMENTUM_IDS = new Set(MOMENTUM().map((d) => d.id));
const STANCE_IDS = new Set([RH.rhf2Crouch().id, RH.rhf2Stagger().id]);
const FORCE_IDS = new Set(FORCE_APPLICATION().map((d) => d.id));
const DEFENDER_IDS = new Set(RH.RH_F6_DEFENDER_PHASES.map((p) => RH.rhf6DefenderRun(p).id));
const VERTICAL_IDS = new Set(VERTICAL.map((w) => RH.rhf7(w).id));

interface RhRun {
  sim: Simulation;
  /** Fixed limb lengths and shoe penetration (flat-turf RH fixtures). */
  limbs: { len: number; pen: number } | null;
  /** Worst vertical momentum residual (contact-free fixtures). */
  momentum: { worst: number } | null;
  /** RH-F2: the target slew per tick and the held crouch sample. */
  stance: { watch: Watch; held: Held | null } | null;
  /** RH-F5-noRescue: no support after the loss; ticks with a valid probe while falling. */
  noRescue: { watch: Watch; okAfter: number } | null;
  /** Force application per supported tick; ticks with an excess through the COM. */
  force: { watch: Watch; excess: number } | null;
  /** Isolated defender: supported every tick; peak lean after 0.5 s. */
  defender: { watch: Watch; peak: number } | null;
  /** RH-F7: no support once converted. */
  vertical: { watch: Watch } | null;
}

function observe(sim: Simulation, def: FixtureDef): { tick: () => void; done: () => Omit<RhRun, 'sim'> } {
  const ticks: (() => void)[] = [];
  let limbs: RhRun['limbs'] = null;
  if (LIMB_IDS.has(def.id)) {
    const R = def.ragdoll!;
    const o = { len: 0, pen: 0 };
    ticks.push(() => {
      for (const pl of sim.players) {
        if (!pl.pose || pl.rag) continue;
        const p = pl.pose;
        const lm = p.jointLandmarksWorld;
        for (const s of ['left', 'right'] as const) {
          o.len = Math.max(o.len, Math.abs(dist(lm[`${s}Hip`], lm[`${s}Knee`]) - R.lengths.thigh), Math.abs(dist(lm[`${s}Knee`], lm[`${s}Ankle`]) - R.lengths.shin));
          o.pen = Math.max(o.pen, -lowest(legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], p.segments[`${s}Shin`].rotationWorld, footFrame(p, s))));
        }
      }
    });
    limbs = o;
  }
  let momentum: RhRun['momentum'] = null;
  if (MOMENTUM_IDS.has(def.id)) {
    const pl = sim.players[0];
    const m = pl.mass.massKg;
    const v0 = sim.bulk(pl).v.y;
    const o = { worst: 0 };
    ticks.push(() => {
      const dp = m * (sim.bulk(pl).v.y - v0);
      o.worst = Math.max(o.worst, Math.abs(dp - (pl.sus!.impulseNs - m * G * sim.t)));
    });
    momentum = o;
  }
  let stance: RhRun['stance'] = null;
  if (STANCE_IDS.has(def.id)) {
    const R = def.ragdoll!;
    const pl = sim.players[0];
    let prevT = pl.sus!.targetM;
    const o: { watch: Watch; held: Held | null } = {
      held: null,
      watch: new Watch(() => {
        const u = pl.sus!;
        expect(Math.abs(u.targetM - prevT)).toBeLessThanOrEqual(S.targetSlewMps * def.solver.outerTickS + 1e-9);
        prevT = u.targetM;
        if (sim.t > 1.6 && sim.t < 1.62) {
          // held crouch: knees bent, both shoes on the turf, ankle targets reached
          const p = pl.pose!;
          const lm = p.jointLandmarksWorld;
          const gaps = (['left', 'right'] as const).map((s) => lowest(legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], p.segments[`${s}Shin`].rotationWorld, footFrame(p, s))));
          const fwd = qRot(sim.poseOf(pl).q, v3(0, 0, 1));
          o.held = {
            knee: Math.min(p.hingeDeg.leftKnee, p.hingeDeg.rightKnee),
            gap: Math.max(...gaps.map(Math.abs)),
            res: Math.max(...Object.values(p.targetResidualM ?? {})),
            ahead: (lm.leftAnkle.x - lm.rightAnkle.x) * fwd.x + (lm.leftAnkle.z - lm.rightAnkle.z) * fwd.z,
          };
        }
      }),
    };
    ticks.push(() => o.watch.tick());
    stance = o;
  }
  let noRescue: RhRun['noRescue'] = null;
  if (def.id === RH.rhf5NoRescue().id) {
    const pl = sim.players[0];
    const o: { watch: Watch; okAfter: number } = {
      okAfter: 0,
      watch: new Watch(() => {
        if (pl.controlMode !== 'falling') return;
        expect(pl.sus!.appliedN).toBe(0);
        expect(pl.sus!.active).toBe(false);
        expect(pl.applied.driveCap).toBe(0);
        if (pl.sus!.probe.valid) o.okAfter++;
      }),
    };
    ticks.push(() => o.watch.tick());
    noRescue = o;
  }
  let force: RhRun['force'] = null;
  if (FORCE_IDS.has(def.id)) {
    const pl = sim.players[0];
    const W = pl.mass.massKg * G;
    const o: { watch: Watch; excess: number } = {
      excess: 0,
      watch: new Watch(() => {
        const u = pl.sus!;
        if (!u.active) return;
        // the pivot is the body's legacy support-hemisphere centre: the same COM lever as the legacy balance geometry
        expect(u.leverM, def.id).toBeCloseTo(pl.balance.leverM, 5);
        expect(u.pivotN + u.comN).toBeCloseTo(u.appliedN, 6);
        expect(u.pivotN).toBeLessThanOrEqual(W + 1e-9);
        expect(u.comN).toBeCloseTo(Math.max(0, u.appliedN - W), 6);
        if (u.comN > 0) o.excess++;
        // torque about the COM comes from the pivot share only: r x (0, Fp, 0), horizontal, at most Fp * lever
        expect(u.tipTorqueNm.y).toBeCloseTo(0, 9);
        expect(Math.hypot(u.tipTorqueNm.x, u.tipTorqueNm.z)).toBeLessThanOrEqual(u.pivotN * u.leverM + 1e-6);
        // balance ceiling at the nominal body weight while support is valid
        expect(pl.applied.balanceCap).toBeCloseTo(Math.min(sim.balanceProfile.maxBalanceTorqueNm, W * pl.body.supportRadiusM), 9);
      }),
    };
    ticks.push(() => o.watch.tick());
    force = o;
  }
  let defender: RhRun['defender'] = null;
  if (DEFENDER_IDS.has(def.id)) {
    const pl = sim.players[0];
    const o: { watch: Watch; peak: number } = {
      peak: 0,
      watch: new Watch(() => {
        expect(pl.controlMode, `${def.id} t ${sim.t}`).toBe('supported');
        if (sim.t > 0.5) o.peak = Math.max(o.peak, (pl.balance.theta * 180) / Math.PI);
      }),
    };
    ticks.push(() => o.watch.tick());
    defender = o;
  }
  let vertical: RhRun['vertical'] = null;
  if (VERTICAL_IDS.has(def.id)) {
    const pl = sim.players[0];
    const o = {
      watch: new Watch(() => {
        if (pl.rag) expect(pl.sus!.active).toBe(false), expect(pl.sus!.appliedN).toBe(0);
      }),
    };
    ticks.push(() => o.watch.tick());
    vertical = o;
  }
  return { tick: () => ticks.forEach((f) => f()), done: () => ({ limbs, momentum, stance, noRescue, force, defender, vertical }) };
}

const RUNS = new Map<string, { json: string; run: Promise<RhRun> }>();
/** The finished run of RH fixture `def`, simulated once per file with every observer that reads it (they only read). */
function rhRun(def: FixtureDef): Promise<RhRun> {
  const json = JSON.stringify(def);
  const hit = RUNS.get(def.id);
  if (hit) {
    if (hit.json !== json) throw new Error(`rhRun: ${def.id} requested with another definition`);
    return hit.run;
  }
  const p = (async (): Promise<RhRun> => {
    const sim = await create(def);
    const obs = observe(sim, def);
    while (!sim.done) {
      sim.stepTick();
      await pace();
      obs.tick();
    }
    return { sim, ...obs.done() };
  })();
  RUNS.set(def.id, { json, run: p });
  return p;
}
afterAll(async () => {
  for (const { run: p } of RUNS.values()) (await p).sim.dispose();
  RUNS.clear();
});

describe('RH support law and targets (unit)', () => {
  it('force law and split, probe eligibility, stance filter and target, clip height model, every row', async () => {
    const CHECKS: [string, () => void][] = [
      [
        'force: m g at the target at rest; clamped to [0, maxForceBW m g]; the floor never pulls',
        () => {
          const m = 100;
          expect(suspensionForce(S, m, -G, 0.89, 0, 0.89, 0).appliedN).toBeCloseTo(m * G, 9);
          const hi = suspensionForce(S, m, -G, 0.6, -3, 0.89, 0);
          expect(hi.saturated).toBe('max');
          expect(hi.appliedN).toBeCloseTo(S.maxForceBW * m * G, 9);
          const lo = suspensionForce(S, m, -G, 1.0, 3, 0.89, 0);
          expect(lo.saturated).toBe('zero');
          expect(lo.appliedN).toBe(0);
          expect(lo.commandedN).toBeLessThan(0);
          // spring/damper gains follow the declared frequency and damping for the measured mass; feedforward is m a_t
          const { k, c } = suspensionGains(S, m);
          expect(k).toBeCloseTo(m * (2 * Math.PI * S.frequencyHz) ** 2, 9);
          expect(c).toBeCloseTo(2 * S.dampingRatio * m * 2 * Math.PI * S.frequencyHz, 9);
          expect(suspensionForce(S, m, -G, 0.89, 0, 0.89, 0, -2).appliedN).toBeCloseTo(m * (G - 2), 9);
          expect(loadAuthority(0, m, -G)).toBe(0);
          expect(loadAuthority(0.5 * m * G, m, -G)).toBeCloseTo(0.5, 12);
          expect(loadAuthority(3 * m * G, m, -G)).toBe(1);
        },
      ],
      [
        'force split after the clamp: the pivot carries at most the body weight, the excess acts through the COM',
        () => {
          const W = 100 * G;
          expect(splitSupportForce(S, 0.6 * W, W)).toEqual({ pivotN: 0.6 * W, comN: 0 });
          expect(splitSupportForce(S, W, W)).toEqual({ pivotN: W, comN: 0 });
          const hi = splitSupportForce(S, 1.7 * W, W);
          expect(hi.pivotN).toBe(W);
          expect(hi.comN).toBeCloseTo(0.7 * W, 9);
          // superseded application: all of it at the pivot
          expect(splitSupportForce({ ...S, application: { pivot: 'probeDepth', excess: 'atPivot' } }, 1.7 * W, W)).toEqual({ pivotN: 1.7 * W, comN: 0 });
        },
      ],
      [
        'probe: turf with an acceptable normal within travel only; players obstruct; hysteresis at the travel limit',
        () => {
          const hit = (o: Partial<{ distM: number; normalUpDot: number; turf: boolean; player: boolean }>) => ({ distM: 0.9, groundY: 0, normalUpDot: 1, turf: true, surface: 'floor', ...o });
          expect(classifyProbe(S, null, true).status).toBe('none');
          expect(classifyProbe(S, hit({}), true).valid).toBe(true);
          expect(classifyProbe(S, hit({ turf: false }), true).status).toBe('invalidSurface');
          expect(classifyProbe(S, hit({ normalUpDot: Math.cos((25 * Math.PI) / 180) }), true).status).toBe('invalidNormal');
          expect(classifyProbe(S, hit({ player: true, distM: 0.3 }), true).status).toBe('obstructed');
          expect(classifyProbe(S, hit({ distM: S.probeMaxM + 0.001 }), true).status).toBe('beyondTravel');
          // inside the hysteresis band: kept while valid, not re-acquired once lost
          const band = S.probeMaxM - 0.5 * S.probeHysteresisM;
          expect(classifyProbe(S, hit({ distM: band }), true).valid).toBe(true);
          expect(classifyProbe(S, hit({ distM: band }), false).valid).toBe(false);
          expect(classifyProbe(S, hit({ distM: S.probeMaxM - 1.5 * S.probeHysteresisM }), false).valid).toBe(true);
        },
      ],
      [
        'stance filter and target: bounded acceleration and rate, range clamp, slew limit, feedforward only when free',
        () => {
          const st = newSuspensionRuntime(S.standingHeightM);
          const dt = 1 / 240;
          let vmax = 0;
          let amax = 0;
          for (let i = 0; i < 480; i++) {
            advanceStance(st, S, 0.8, dt);
            vmax = Math.max(vmax, Math.abs(st.stanceV));
            amax = Math.max(amax, Math.abs(st.stanceA));
            composeTarget(st, S, null, 0, dt);
            expect(Math.abs(st.targetVMps)).toBeLessThanOrEqual(S.targetSlewMps + 1e-9);
          }
          expect(vmax).toBeLessThanOrEqual(S.stance.maxRateMps + 1e-12);
          expect(amax).toBeLessThanOrEqual(S.stance.maxAccelMps2 + 1e-9);
          expect(Math.abs(st.stanceH - 0.8)).toBeLessThan(1e-3);
          // out-of-range running request: clamped, no feedforward while the clamp holds
          composeTarget(st, S, { heightM: 0.5, velMps: 0, accelMps2: -3 }, 1, dt);
          expect(st.targetAMps2).toBe(0);
          for (let i = 0; i < 400; i++) composeTarget(st, S, { heightM: 0.5, velMps: 0, accelMps2: -3 }, 1, dt);
          expect(st.targetM).toBeCloseTo(S.targetRangeM[0], 12);
        },
      ],
      [
        'clip height model: the calibrated hip-joint mean is kept; the truncated bob follows the clip',
        () => {
          for (const c of suppliedRunClips()) {
            const m = clipHeightModel(c, S.run.bobHarmonics);
            const y = c.frames.map((f) => 0.5 * (f.leg.left.hip.y + f.leg.right.hip.y));
            expect(m.meanLegU).toBeCloseTo(y.reduce((a, x) => a + x, 0) / y.length, 12);
            expect(m.a.length).toBe(S.run.bobHarmonics);
            // the truncated bob stays within the raw frame range around the mean
            for (let j = 0; j < 64; j++) {
              const b = m.meanLegU + bobAt(m.a, m.b, j / 64);
              expect(b).toBeGreaterThan(m.rawMinLegU - 0.01);
              expect(b).toBeLessThan(m.rawMaxLegU + 0.01);
            }
          }
        },
      ],
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('RH-F1/F2 standing, settling and stances', () => {
  it('the legacy body\'s mass and the support export; RH-F1 standing, drop and lean, RH-F2 crouch and stagger settle and stay physical, every row', async () => {
    const CHECKS: [string, () => Promise<void>][] = [
      [
        'same mass, COM and inertia as the legacy body; the export names the support profile',
        async () => {
          const a = await Simulation.create(FIX('L1-F1-fastRun'));
          const b = await Simulation.create(RH.rhf3('fastRun'));
          const ma = a.players[0].mass;
          const mb = b.players[0].mass;
          expect(mb.massKg).toBe(ma.massKg);
          expect(mb.localCom).toEqual(ma.localCom);
          // the massless guard collider changes Rapier's float32 summation order only (relative difference ~2e-7)
          for (const k of ['x', 'y', 'z'] as const) expect(Math.abs(mb.principalInertia[k] - ma.principalInertia[k]) / ma.principalInertia[k]).toBeLessThan(1e-6);
          const ea = a.exportFixture() as { profileIds: Record<string, unknown> };
          const eb = b.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
          expect(ea.profileIds.support).toBe(SUPPORT_LEGACY.id);
          expect(eb.profileIds.support).toBe(S.id);
          expect(JSON.stringify(eb.profiles.support)).toContain('"standingHeightM":0.89');
          expect(a.trace.at(-1)!.players.R.sup).toBeUndefined();
          for (const s of [a, b]) s.dispose();
        },
      ],
      [
        'RH-F1 standing: reproducible height and load, no force chatter; drop and lean settle within 1 s',
        async () => {
          const stand = (await rhRun(RH.rhf1Stand())).sim;
          const W = stand.players[0].mass.massKg * G;
          const rs = playerRows(stand, 'R').slice(1);
          for (const x of rs) {
            expect(Math.abs(x.r.sup!.h! - S.standingHeightM)).toBeLessThan(1e-4);
            expect(Math.abs(x.r.sup!.F - W)).toBeLessThan(2);
          }
          for (let i = 1; i < rs.length; i++) expect(Math.abs(rs[i].r.sup!.F - rs[i - 1].r.sup!.F)).toBeLessThan(1);
          for (const def of [RH.rhf1Drop(), RH.rhf1Lean()]) {
            const sim = (await rhRun(def)).sim;
            for (const s of settleTimes(playerRows(sim, 'R'))) {
              expect(s.settleS).toBeLessThanOrEqual(1);
              expect(s.tailErr).toBeLessThan(0.002);
            }
          }
        },
      ],
      [
        'RH-F2 crouch and stagger: continuous bounded requests, physical movement, reachable bent-knee stances',
        async () => {
          for (const def of [RH.rhf2Crouch(), RH.rhf2Stagger()]) {
            const o = await rhRun(def);
            const sim = o.sim;
            const pl = sim.players[0];
            // the per-tick request slew (rethrows its first failure) and the held crouch sample at 1.6 s
            o.stance!.watch.check();
            const held = o.stance!.held;
            const st = settleTimes(playerRows(sim, 'R'));
            expect(st.map((s) => s.req)).toEqual(def.id.endsWith('crouch') ? [0.89, 0.8, 0.89] : [0.89, 0.82, 0.89]);
            for (const s of st) {
              expect(s.settleS).toBeLessThanOrEqual(1);
              expect(s.tailErr).toBeLessThan(0.002);
            }
            expect(held!.knee).toBeGreaterThan(60);
            expect(held!.gap).toBeLessThan(0.005);
            expect(held!.res).toBeLessThan(0.005);
            if (def.id.endsWith('stagger')) expect(held!.ahead).toBeCloseTo(0.3, 2);
            // the crouch is physical: the root moved by the support force (work done), never placed
            expect(Math.abs(pl.sus!.workJ)).toBeGreaterThan(0);
          }
        },
      ],
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });

  it('fixed limb lengths (<= 0.001 m) and shoe penetration (<= 0.01 m) on every flat-turf RH fixture', async () => {
    await rows(RH.rideHeightFixtures().filter((d) => !d.obstacles?.length), (d) => d.id, async (def) => {
      const { len, pen } = (await rhRun(def)).limbs!;
      expect(len, def.id).toBeLessThanOrEqual(0.001);
      expect(pen, def.id).toBeLessThanOrEqual(0.01);
    });
  });
});

describe('RH-F3 running height from the clips', () => {
  it('unsaturated nominal running: RMS <= 0.02 m, bob lag <= 10% of a stride; amplitude, extrema and gaps reported', async () => {
    const report: string[] = [];
    for (const kind of ['fastRun', 'sprint', 'accelBrake'] as const) {
      const def = RH.rhf3(kind);
      const sim = (await rhRun(def)).sim;
      const rs = playerRows(sim, 'R').filter((x) => x.r.sup && x.r.sup.ok === 1 && x.r.run && x.r.run.w >= 0.999 && x.t >= 0.3);
      expect(rs.length).toBeGreaterThan(60);
      for (const x of rs) expect(x.r.sup!.sat).toBe(0);
      const h = rs.map((x) => x.r.sup!.h!);
      const ht = rs.map((x) => x.r.sup!.ht);
      const rms = Math.sqrt(h.reduce((s, x, i) => s + (x - ht[i]) ** 2, 0) / h.length);
      // bob lag by cross-correlation (whole ticks)
      const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
      const mh = mean(h);
      const mt = mean(ht);
      let best = 0;
      let bv = -Infinity;
      for (let k = -12; k <= 12; k++) {
        let c = 0;
        let n = 0;
        for (let i = 0; i < h.length; i++) if (i + k >= 0 && i + k < h.length) (c += (ht[i] - mt) * (h[i + k] - mh)), n++;
        if (c / n > bv) (bv = c / n), (best = k);
      }
      const P = def.runClips!;
      const stride = mean(rs.map((x) => P.clips.find((c) => x.r.run!.clip.startsWith(c.id))?.record.cycleS ?? P.clips[0].record.cycleS)) / mean(rs.map((x) => x.r.run!.r));
      const lagFrac = Math.abs(best * def.solver.outerTickS) / stride;
      expect(rms).toBeLessThanOrEqual(0.02);
      expect(lagFrac).toBeLessThanOrEqual(0.1);
      const amp = (Math.max(...h) - Math.min(...h)) / (Math.max(...ht) - Math.min(...ht));
      // the suspension stays on during the clip's visual flight (both drawn feet up): an explicit approximation
      const flight = rs.filter((x) => x.r.sup!.fl === 1);
      for (const x of flight) expect(x.r.sup!.F).toBeGreaterThan(0);
      report.push(
        `${def.id}: RMS ${rms.toFixed(4)} m  lag ${(100 * lagFrac).toFixed(1)}% stride  amplitude ratio ${amp.toFixed(3)}  h ${Math.min(...h).toFixed(3)}..${Math.max(...h).toFixed(3)}  target ${Math.min(...ht).toFixed(3)}..${Math.max(...ht).toFixed(3)}  bob scale ${Math.min(...rs.map((x) => x.r.sup!.s)).toFixed(3)}  flight ticks ${flight.length}`,
      );
    }
    console.log(`[RH-F3]\n  ${report.join('\n  ')}`);
  });
});

describe('RH-F4 limits and disturbances', () => {
  it('out-of-range requests clamp, excessive load overcomes the support, kicks stay finite; no hidden root correction, every row', async () => {
    const CHECKS: [string, () => Promise<void>][] = [
      [
        'out-of-range requests are clamped to the target range and reached',
        async () => {
          const sim = (await rhRun(RH.rhf4Range())).sim;
          const st = settleTimes(playerRows(sim, 'R'));
          expect(st.map((s) => s.req)).toEqual([0.89, S.targetRangeM[0], S.targetRangeM[1], 0.89]);
          for (const s of st) expect(s.settleS).toBeLessThanOrEqual(1);
          for (const x of playerRows(sim, 'R')) expect(x.r.sup!.ht).toBeGreaterThanOrEqual(S.targetRangeM[0] - 1e-12), expect(x.r.sup!.ht).toBeLessThanOrEqual(S.targetRangeM[1] + 1e-12);
        },
      ],
      [
        'excessive load overcomes the finite support (saturated at its ceiling, bump stop reached); kicks stay finite',
        async () => {
          for (const def of [RH.rhf4Load(), RH.rhf4Kick('down'), RH.rhf4Kick('up')]) {
            const sim = (await rhRun(def)).sim;
            const W = sim.players[0].mass.massKg * G;
            const rs = playerRows(sim, 'R').filter((x) => x.r.sup);
            for (const x of rs) {
              expect(x.r.sup!.F).toBeGreaterThanOrEqual(0);
              expect(x.r.sup!.F).toBeLessThanOrEqual(S.maxForceBW * W + 1e-6);
            }
            if (def.id === 'RH-F4-load') {
              expect(rs.some((x) => x.r.sup!.sat === 2)).toBe(true);
              expect(rs.some((x) => x.r.sup!.bot === 1)).toBe(true);
              expect(Math.min(...rs.map((x) => x.r.sup!.h ?? Infinity))).toBeLessThan(S.standingHeightM - 0.2);
            } else {
              for (const s of settleTimes(playerRows(sim, 'R'))) expect(s.settleS).toBeLessThanOrEqual(1);
            }
            if (def.id === 'RH-F4-kickUp') {
              // above the travel the support and every supported authority are off from the first substep after the probe
              // (of the solved state) reports it: every tick that starts and ends beyond the travel
              const out = rs.filter((x, i) => x.r.sup!.st === 'beyondTravel' && i > 0 && rs[i - 1].r.sup!.st === 'beyondTravel');
              expect(out.length).toBeGreaterThan(5);
              for (const x of out) expect(x.r.sup!.F).toBe(0), expect(x.r.cap).toBe(0), expect(x.r.yawT).toBe(0), expect(x.r.lean!.tauB).toBe(0);
            }
          }
        },
      ],
      [
        'no hidden root correction: vertical momentum = support impulse + gravity impulse on contact-free fixtures',
        async () => {
          for (const def of MOMENTUM()) {
            const { worst } = (await rhRun(def)).momentum!;
            expect(worst, def.id).toBeLessThan(0.05);
          }
        },
      ],
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('RH-F5 no false support', () => {
  it('ground out of range, invalid normal and surface, a player below, and no recovery after a loss: never false support, every row', async () => {
    const CHECKS: [string, () => Promise<void>][] = [
      [
        'ground out of range: no support or traction until back inside travel (with hysteresis), then normal support',
        async () => {
          const sim = (await rhRun(RH.rhf5OutOfRange())).sim;
          const rs = playerRows(sim, 'R');
          const first = rs.findIndex((x) => x.r.sup!.ok === 1);
          expect(first).toBeGreaterThan(5);
          for (const x of rs.slice(1, first)) expect(x.r.sup!.F).toBe(0), expect(x.r.cap).toBe(0), expect(x.r.lean!.tauB).toBe(0);
          expect(rs[first].r.sup!.h!).toBeLessThanOrEqual(S.probeMaxM - S.probeHysteresisM);
          for (const s of settleTimes(rs)) expect(s.settleS).toBeLessThanOrEqual(1);
        },
      ],
      [
        'invalid normal and invalid surface: never supported; the collapse onto the bump stop is a loss of support',
        async () => {
          for (const def of [RH.rhf5InvalidNormal(), RH.rhf5Obstacle()]) {
            const sim = (await rhRun(def)).sim;
            for (const x of playerRows(sim, 'R')) if (x.r.sup && x.t < 0.2) expect(x.r.sup.F).toBe(0), expect(x.r.cap).toBe(0);
            const loss = sim.events.find((e) => e.type === 'lossOfSupport');
            expect(loss?.data?.reason).toBe('unsupportedBottomOut');
            expect(sim.result).not.toBe('invalidTransfer');
            const h = sim.players[0].handoff!;
            if (h.outcome === 'accepted') expect(h.audit!.ok).toBe(true);
            else expect(h.report.reasons.length).toBeGreaterThan(0);
          }
        },
      ],
      [
        'another player below obstructs the probe: no support on a player; no support after the falling switch',
        async () => {
          const sim = (await rhRun(RH.rhf5PlayerBelow())).sim;
          const rs = playerRows(sim, 'A').filter((x) => x.r.sup);
          expect(rs.filter((x) => x.r.sup!.st === 'obstructed').length).toBeGreaterThan(20);
          for (const x of rs) {
            if (x.r.sup!.st === 'obstructed') expect(x.r.sup!.F).toBe(0);
            if (x.r.mode === 'falling') expect(x.r.sup!.F).toBe(0);
          }
        },
      ],
      [
        'no recovery after loss: a falling proxy over valid turf gets no support force or authority',
        async () => {
          const o = await rhRun(RH.rhf5NoRescue());
          const pl = o.sim.players[0];
          // per tick while falling: no support force, no active support, no drive authority (rethrows its first failure)
          o.noRescue!.watch.check();
          const okAfter = o.noRescue!.okAfter;
          expect(pl.handoff?.outcome).toBe('rejected');
          expect(okAfter).toBeGreaterThan(0);
        },
      ],
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('RH-F6 legacy and suspension versions (same requests)', () => {
  it('each pair differs only in support and identity; outcome deltas are reported; known rejections are retained', async () => {
    const report: string[] = [];
    const strip = (d: FixtureDef) => JSON.stringify(d.players.map((p) => ({ id: p.id, initial: p.initial, controller: p.controller, arms: p.arms })));
    const rh = new Map(RH.rideHeightFixtures().map((d) => [d.id, d]));
    for (const [rid, lid] of Object.entries(RH.RH_F6_PAIRS)) {
      const a = FIX(lid);
      const b = rh.get(rid)!;
      expect(strip(b)).toBe(strip(a));
      expect({ ...b, id: a.id, milestone: a.milestone, title: a.title, notes: a.notes, support: undefined }).toEqual({ ...a, support: undefined });
      const sa = await run(a);
      const sb = (await rhRun(b)).sim;
      const sum = (s: Simulation) =>
        `${s.result}; ${s.players.map((p) => `${p.id} ${p.handoff ? `${p.handoff.outcome}@${p.handoff.t.toFixed(3)}${p.handoff.report.reasons.length ? `(${p.handoff.report.reasons.join(',')})` : ''}` : 'no handoff'}`).join(', ')}`;
      report.push(`${lid} -> ${rid}\n    legacy:     ${sum(sa)}\n    suspension: ${sum(sb)}`);
      // known rejection retained on the legacy support; plan 07a: the suspension version (RH-F6-simultaneous) converts
      // both players (the published poses now clear each other's candidate-equivalent limbs)
      if (lid === 'G4-F10-simultaneous-M') {
        for (const p of sa.players) expect(p.handoff?.report.reasons).toContain('externalPenetration');
        for (const p of sb.players) expect(p.handoff?.outcome, `${rid} ${p.id}`).toBe('accepted');
      }
      sa.dispose();
    }
    console.log(`[RH-F6]\n  ${report.join('\n  ')}`);
  });
});

describe('RH-F6 balance under the suspension: isolated defender and defeat cases', () => {
  it('the calibrated pivot lever and traced force split; the isolated defender stays supported; strong hits still lose support, every row', async () => {
    const CHECKS: [string, () => Promise<void>][] = [
      [
        'force application: calibrated legacy pivot lever; split components and the pivot torque are traced and consistent',
        async () => {
          for (const def of FORCE_APPLICATION()) {
            const o = await rhRun(def);
            const sim = o.sim;
            const pl = sim.players[0];
            // per supported tick: lever, split, pivot torque and balance ceiling (rethrows its first failure)
            o.force!.watch.check();
            const excess = o.force!.excess;
            expect(excess, def.id).toBeGreaterThan(0);
            // the trace carries both components and the torque
            const r = sim.trace.find((x) => (x.players[pl.id].sup?.Fm ?? 0) > 0)!.players[pl.id].sup!;
            expect(r.Fp + r.Fm).toBeCloseTo(r.F, 1);
            expect(r.T).toHaveLength(3);
          }
        },
      ],
      [
        'isolated defender (7 m/s line, 12 deg lean, no runner) stays supported across starting phases for several strides',
        async () => {
          for (const p of RH.RH_F6_DEFENDER_PHASES) {
            const def = RH.rhf6DefenderRun(p);
            const o = await rhRun(def);
            const sim = o.sim;
            const pl = sim.players[0];
            // supported at every tick (rethrows its first failure); the peak lean after 0.5 s
            o.defender!.watch.check();
            const peak = o.defender!.peak;
            expect(sim.result).toBe('duration');
            expect(sim.events.some((e) => e.type === 'lossOfSupport')).toBe(false);
            expect(sim.events.some((e) => e.type === 'contactBegin')).toBe(false);
            const stride = def.runClips!.clips[pl.run!.k].record.cycleS / pl.run!.rate;
            expect(sim.t / stride).toBeGreaterThan(5);
            expect(peak).toBeLessThan(15);
          }
        },
      ],
      [
        'balance stays defeatable: strong tackles, side hits and an over-capacity lean still lose support',
        async () => {
          const all = new Map([...RH.rhf6(), ...RH.rhf6Defeat()].map((d) => [d.id, d]));
          const loses: [string, string[]][] = [
            ['RH-F6-collision', ['R', 'D']],
            ['RH-F6-twoArm', ['R']],
            ['RH-F6-oneArm', ['R']],
            ['RH-F6-sideRecover', ['R']],
            ['RH-F6-sideLoss', ['R']],
            ['RH-F6-lean14-cap240', ['R']],
            ['RH-F6-lean14-cap168', ['R']],
          ];
          for (const [id, who] of loses) {
            const sim = (await rhRun(all.get(id)!)).sim;
            for (const pid of who) expect(sim.events.some((e) => e.type === 'lossOfSupport' && e.playerId === pid), `${id} ${pid}`).toBe(true);
          }
        },
      ],
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });
});

describe('RH-F7 handoff while moving vertically', () => {
  it('converted at the first rising/falling/extremum substep with the actual vertical velocity; no double support', async () => {
    for (const when of VERTICAL) {
      const o = await rhRun(RH.rhf7(when));
      const pl = o.sim.players[0];
      // once converted: no active support and no support force at any tick (rethrows its first failure)
      o.vertical!.watch.check();
      const h = pl.handoff!;
      expect(h.reason).toBe('diagnostic');
      expect(h.outcome).toBe('accepted');
      expect(h.audit!.ok).toBe(true);
      const vy = h.audit!.before.v[1];
      if (when === 'rising') expect(vy).toBeGreaterThan(0.05);
      if (when === 'falling') expect(vy).toBeLessThan(-0.05);
      if (when === 'top' || when === 'bottom') expect(Math.abs(vy)).toBeLessThan(0.05);
      // vertical momentum carried over exactly (the candidate takes the proxy's bulk velocity, vertical included)
      expect(h.audit!.after.P[1]).toBeCloseTo(h.audit!.before.P[1], 3);
    }
    const both = (await rhRun(RH.rhf7Both())).sim;
    const hs = both.players.map((p) => p.handoff!);
    expect(hs.every((h) => h.outcome === 'accepted' && h.audit!.ok)).toBe(true);
    expect(hs[0].step).toBe(hs[1].step);
  });
});

describe('RH-F8 fixed-step reproducibility', () => {
  it('render rates, pause and single steps give the same trace; repeated reset reproduces it without resource growth', async () => {
    for (const def of [RH.rhf2Crouch(), RH.rhf3('accelBrake'), RH.rhf7('top')]) {
      const byRate = async (hz: number, pauseEvery = 0) => {
        const s = await Simulation.create(def);
        const drv = new FixedStepDriver(def.solver.outerTickS, 8);
        let f = 0;
        while (!s.done) {
          f++;
          drv.paused = pauseEvery > 0 && f % pauseEvery < 3;
          for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) {
            s.stepTick();
            await pace();
          }
        }
        return s;
      };
      const a = await byRate(30);
      const b = await byRate(144);
      const p = await byRate(60, 7);
      const ref = JSON.stringify(a.trace);
      expect(JSON.stringify(b.trace)).toBe(ref);
      expect(JSON.stringify(p.trace)).toBe(ref);
      const c = await Simulation.create(def);
      const counts0 = c.counts();
      for (let k = 0; k < 3; k++) {
        await stepWhile(c, () => c.t < 0.9 - 1e-9 && !c.done);
        c.reset();
        expect(c.counts()).toEqual(counts0);
      }
      await runSim(c);
      expect(JSON.stringify(c.trace)).toBe(ref);
      for (const s of [a, b, p, c]) s.dispose();
    }
  });
});
