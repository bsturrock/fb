// Gates 1-3 acceptance (plan 13b: tests/gate1, gate2 and gate3 in one file). The checks of one topic are one test whose
// rows are the former tests, each with its assertions verbatim; the reproducibility, export and opt-in tests stay as
// they were (the harness tables take them later).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  g1f1, g1f2, g1f2Control, g1f3, g1f4, g1f5, g1f6Airborne, g1f6Impact, g1f7, g1f8Cases, g1f9Fit, g1f9Glance, g1f9Poor,
  g1f10Cases, coachedFixture,
} from '../src/sim/fixtures/gate1';
import * as G2 from '../src/sim/fixtures/gate2';
import * as G3 from '../src/sim/fixtures/gate3';
import { allFixtures } from '../src/sim/fixtures/index';
import { Simulation } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import { computeDrive, computeYaw } from '../src/sim/motors';
import {
  availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, envelopeStep, leanScale, measureLean, projectedLean,
} from '../src/sim/balance';
import { ARM_G2, BALANCE_G3, DEFAULT_MOTOR, shoulderLocal } from '../src/sim/profiles';
import type { FixtureDef } from '../src/sim/fixture';
import { len, qFromAxisAngle, qFromYaw, qMul, sub, toLocal, toWorld, UP, v3, type Vec3 } from '../src/sim/vec';
import {
  create, disposeTracked, evs, nonEmpty, pace, rows, run, runEach, runSim, sharedRuns, speedH, traceDiff, traceRowsDiff,
} from './helpers';

/** Plain finished runs shared by the rows of one test (a fixture read by two rows runs once). */
const shared = sharedRuns();

// free every engine world a test created (gate tests do not dispose their simulations themselves)
afterEach(() => {
  shared.dispose();
  disposeTracked();
});

/** Plan 13b: one test over the distinct checks of one topic, as `[name, check]` rows. */
type Check = [string, () => void | Promise<void>];
const checks = (cs: Check[]): Promise<void> => rows(cs, ([n]) => n, ([, f]) => f());

// ============================================================================================= Gate 1
const TOL = { pos: 0.001, vel: 0.001, yaw: 0.001 };

describe('G1 motor laws (unit)', () => {
  it('drive is one combined horizontal budget, capped, zero when unsupported; yaw torque is damped, proportional, capped at 180 N m', async () => {
    await checks([
      ['drive is one combined horizontal budget, capped, zero when unsupported', () => {
        const intent = { desiredVelocityWorld: v3(6, 0, 6), desiredFacingWorld: v3(0, 0, 1), effort: 1 };
        const d = computeDrive(intent, v3(), 100, DEFAULT_MOTOR, true);
        expect(Math.hypot(d.force.x, d.force.z)).toBeCloseTo(1400, 6);
        expect(Math.hypot(d.requestedVelocity.x, d.requestedVelocity.z)).toBeCloseTo(6, 6);
        expect(computeDrive(intent, v3(), 100, DEFAULT_MOTOR, false).force).toEqual(v3());
        const half = computeDrive({ ...intent, effort: 0.5 }, v3(), 100, DEFAULT_MOTOR, true);
        expect(Math.hypot(half.force.x, half.force.z)).toBeCloseTo(700, 6);
      }],
      ['yaw torque is damped, proportional, capped at 180 N m', () => {
        const y = computeYaw({ desiredVelocityWorld: v3(), desiredFacingWorld: v3(1, 0, 0), effort: 1 }, qFromYaw(0), 0, DEFAULT_MOTOR, true);
        expect(y.angleError).toBeCloseTo(Math.PI / 2, 6);
        expect(y.torqueY).toBeCloseTo(180, 6);
        const small = computeYaw({ desiredVelocityWorld: v3(), desiredFacingWorld: v3(Math.sin(0.1), 0, Math.cos(0.1)), effort: 1 }, qFromYaw(0), 0.5, DEFAULT_MOTOR, true);
        expect(small.torqueY).toBeCloseTo(300 * 0.1 - 80 * 0.5, 6);
      }],
    ]);
  });
});

describe('G1-A: one bounded motor (F1) and unsupported movement (F6 airborne)', () => {
  it('G1-F1 force stays capped, acceleration and braking take time, zero request does not freeze; G1-F6 airborne (legacy and compound): no ground drive while unsupported, gravity acts, drive resumes on landing', async () => {
    await checks([
      ['G1-F1 force stays capped; acceleration and braking take time; zero request does not freeze', async () => {
        const sim = await run(g1f1());
        const tr = sim.trace;
        const mass = sim.byId.get('P1')!.mass.massKg;
        expect(mass).toBeCloseTo(100, 3);
        let maxF = 0;
        let maxA = 0;
        for (let i = 1; i < tr.length; i++) {
          const r = tr[i].players.P1;
          maxF = Math.max(maxF, Math.hypot(r.drive[0], r.drive[2]));
          const dv = Math.hypot(r.v[0] - tr[i - 1].players.P1.v[0], r.v[2] - tr[i - 1].players.P1.v[2]);
          maxA = Math.max(maxA, dv / (tr[i].t - tr[i - 1].t));
        }
        expect(maxF).toBeLessThanOrEqual(1400 + 1e-3);
        // Away from other contact, acceleration attributable to the drive cannot exceed cap / mass.
        expect(maxA).toBeLessThanOrEqual(1400 / mass + 0.05);
        const at = (t: number) => tr.find((r) => r.t >= t - 1e-9)!;
        expect(speedH(at(0.1), 'P1')).toBeLessThan(2); // not instantaneous
        const t95 = tr.find((r) => speedH(r, 'P1') >= 3.8)!.t;
        expect(t95).toBeGreaterThan(0.25);
        expect(speedH(at(1.5 + 1 / 60), 'P1')).toBeGreaterThan(3.5); // zero request does not zero velocity
        const stopT = tr.find((r) => r.t > 1.5 && speedH(r, 'P1') < 0.1)!.t;
        expect(stopT - 1.5).toBeGreaterThan(0.25);
        const dist = tr.at(-1)!.players.P1.p[2] - tr[0].players.P1.p[2];
        expect(dist).toBeGreaterThan(5);
        expect(sim.result).toBe('duration');
      }],
      ...(['legacy', 'compound'] as const).map((kind): Check => [`G1-F6 airborne (${kind}): no ground drive while unsupported; gravity acts; drive resumes on landing`, async () => {
        const sim = await run(g1f6Airborne(kind));
        const tr = sim.trace;
        expect(tr[0].players.P1.g).toBe(0);
        expect(tr[0].players.P1.p[1]).toBeGreaterThan(1.2);
        const air = tr.filter((r) => r.players.P1.g === 0);
        expect(air.length).toBeGreaterThan(5);
        for (const r of nonEmpty(air.slice(1), 'airborne rows')) expect(Math.hypot(r.players.P1.drive[0], r.players.P1.drive[2])).toBe(0);
        // falling under gravity: height decreases while airborne
        expect(air.at(-1)!.players.P1.p[1]).toBeLessThan(air[0].players.P1.p[1]);
        const land = tr.findIndex((r) => r.players.P1.g === 1);
        expect(land).toBeGreaterThan(0);
        expect(Math.abs(tr[land].players.P1.p[2] - tr[0].players.P1.p[2])).toBeLessThan(0.01); // no air steering
        expect(tr.at(-1)!.players.P1.v[2]).toBeGreaterThan(3);
      }]),
    ]);
  });
});

describe('G1-B: two independently controlled bodies with contact', () => {
  it('G1-F2 to G1-F5: symmetric and off-center impact, both bodies keep trying, unequal masses act through mechanics (every check)', async () => {
    await checks([
      ['G1-F2 symmetric impact: no pass-through, both react, horizontal pair momentum preserved; order-independent', async () => {
        for (const kind of ['legacy', 'compound'] as const) {
          const sim = await shared.get(g1f2(kind));
          const ctl = await run(g1f2Control(kind));
          const tr = sim.trace;
          const contactT = sim.events.find((e) => e.type === 'contactBegin')!.t;
          expect(contactT).toBeGreaterThan(0.5);
          for (const r of tr) expect(r.players.D.p[0]).toBeLessThan(r.players.R.p[0]); // never pass through
          expect(sim.minPairGap).toBeGreaterThan(-0.03);
          const mD = sim.byId.get('D')!.mass.massKg;
          const mR = sim.byId.get('R')!.mass.massKg;
          let maxDp = 0;
          for (const r of tr) {
            const px = mD * r.players.D.v[0] + mR * r.players.R.v[0];
            const pz = mD * r.players.D.v[2] + mR * r.players.R.v[2];
            maxDp = Math.max(maxDp, Math.hypot(px, pz));
          }
          // Supported support shapes carry no engine floor friction (traction is the motor, here off), so floor
          // horizontal impulse is zero and the pair's horizontal momentum (initially 0) must stay ~0.
          expect(maxDp).toBeLessThan(0.05);
          // both react vs the no-contact control at matched time
          const after = tr.find((r) => r.t >= contactT + 0.3)!;
          const ctlAfter = ctl.trace.find((r) => r.t >= contactT + 0.3)!;
          expect(Math.abs(after.players.D.v[0] - ctlAfter.players.D.v[0])).toBeGreaterThan(1);
          expect(Math.abs(after.players.R.v[0] - ctlAfter.players.R.v[0])).toBeGreaterThan(1);
          // reversed insertion/iteration order
          const rev = await run(g1f2(kind), { reverseOrder: true });
          const d = traceDiff(tr, rev.trace, ['D', 'R']);
          expect(d.pos).toBeLessThanOrEqual(TOL.pos);
          expect(d.vel).toBeLessThanOrEqual(TOL.vel);
        }
      }],
      ['G1-F3 off-center impact differs from centered; compound torsos also yaw; no controller rotates the opponent', async () => {
        const centered = await shared.get(g1f2('legacy'));
        const off = await run(g1f3('legacy'));
        const fc = centered.trace.at(-1)!;
        const fo = off.trace.at(-1)!;
        expect(Math.abs(fo.players.D.v[2])).toBeGreaterThan(0.3); // deflected sideways
        expect(Math.abs(fc.players.D.v[2])).toBeLessThan(0.01);
        const offC = await run(g1f3('compound'));
        const maxW = Math.max(...offC.trace.map((r) => Math.abs(r.players.D.w[1])));
        expect(maxW).toBeGreaterThan(0.05); // box corners make a real yaw torque
        // yaw motor was disabled for both (yawEffort 0): all torque came from contact
        for (const r of offC.trace) expect(r.players.D.yawT).toBe(0);
      }],
      ['G1-F4 both continue trying: requests persist through contact, neither body is assigned its desired velocity', async () => {
        for (const kind of ['legacy', 'compound'] as const) {
          const sim = await run(g1f4({ kind }));
          const contactT = sim.events.find((e) => e.type === 'contactBegin')!.t;
          const during = sim.trace.filter((r) => r.t > contactT + 0.05 && r.t < contactT + 2);
          expect(during.length).toBeGreaterThan(100);
          for (const r of during) {
            expect(r.players.D.req[0]).toBeCloseTo(3, 6);
            expect(r.players.R.req[0]).toBeCloseTo(-3, 6);
            expect(Math.abs(r.players.D.v[0] - 3)).toBeGreaterThan(1);
            expect(Math.abs(r.players.R.v[0] + 3)).toBeGreaterThan(1);
            expect(Math.hypot(r.players.D.drive[0], r.players.D.drive[2])).toBeLessThanOrEqual(1400 + 1e-3);
          }
          expect(sim.trace.at(-1)!.t - contactT).toBeGreaterThanOrEqual(2);
        }
      }],
      ['G1-F5 unequal masses: engine masses match; response changes through mechanics when masses swap', async () => {
        const a = await run(g1f5(false));
        const b = await run(g1f5(true));
        expect(a.byId.get('D')!.mass.massKg).toBeCloseTo(120, 3);
        expect(a.byId.get('R')!.mass.massKg).toBeCloseTo(85, 3);
        expect(b.byId.get('D')!.mass.massKg).toBeCloseTo(85, 3);
        expect(b.byId.get('R')!.mass.massKg).toBeCloseTo(120, 3);
        const ea = a.trace.at(-1)!.players;
        const eb = b.trace.at(-1)!.players;
        // heavier side's velocity-error motor holds more force per m/s of error: the pair drifts toward the lighter.
        expect(ea.D.v[0]).toBeGreaterThan(0.2);
        expect(eb.D.v[0]).toBeLessThan(-0.2);
        expect(Math.abs(ea.D.p[0] - eb.D.p[0])).toBeGreaterThan(1);
      }],
    ]);
  });
});

describe('G1-C: reproducible, inspectable drill', () => {
  it('G1-F6 high-speed impact (8 m/s per body): no tunneling, finite, on both body kinds (legacy, compound)', async () => {
    await rows(['legacy', 'compound'] as const, (kind) => kind, async (kind) => {
      const sim = await run(g1f6Impact(kind, 8));
      expect(sim.result).toBe('duration');
      for (const r of sim.trace) expect(r.players.D.p[0]).toBeLessThan(r.players.R.p[0]);
      expect(sim.minPairGap).toBeGreaterThan(-0.02);
      expect(sim.events.some((e) => e.type === 'contactBegin')).toBe(true);
    });
  });

  it('G1-F7 render rate independence (30 vs 120 FPS), reset repeatability, cosmetic independence', async () => {
    const ticks = Math.round(g1f7().durationS / g1f7().solver.outerTickS);
    const drive = async (fps: number, palette: string) => {
      const sim = await create(g1f7(palette));
      const drv = new FixedStepDriver(sim.tickS, 1000);
      while (sim.tick < ticks && !sim.done) {
        const n = drv.frame(1 / fps);
        for (let i = 0; i < n && !sim.done; i++) {
          sim.stepTick();
          await pace();
        }
      }
      return sim;
    };
    const s30 = await drive(30, 'default');
    const s120 = await drive(120, 'default');
    let d = traceDiff(s30.trace, s120.trace, ['D', 'R']);
    expect(d).toEqual({ pos: 0, vel: 0, yaw: 0, ticks: 0 });
    const sim = await run(g1f7());
    const first = sim.trace;
    sim.reset();
    await runSim(sim);
    const second = sim.trace;
    sim.reset();
    await runSim(sim);
    const third = sim.trace;
    d = traceDiff(first, second, ['D', 'R']);
    expect(d.pos).toBeLessThanOrEqual(TOL.pos);
    expect(d.vel).toBeLessThanOrEqual(TOL.vel);
    expect(d.yaw).toBeLessThanOrEqual(TOL.yaw);
    expect(traceDiff(first, third, ['D', 'R']).pos).toBeLessThanOrEqual(TOL.pos);
    // a reset leaves nothing behind: every field of every row repeats (10a A5)
    expect(traceRowsDiff(first, second)).toBeNull();
    expect(traceRowsDiff(first, third)).toBeNull();
    const cosmetic = await drive(60, 'highContrast');
    expect(traceDiff(s30.trace, cosmetic.trace, ['D', 'R'])).toEqual({ pos: 0, vel: 0, yaw: 0, ticks: 0 });
    // slow motion consumes wall time slower; the tick sequence is unchanged
    const slow = new FixedStepDriver(1 / 60, 4);
    slow.speed = 0.25;
    let n = 0;
    for (let i = 0; i < 240; i++) n += slow.frame(1 / 60);
    expect(n).toBe(60);
    // a stalled frame never enlarges dt; excess wall time is discarded and reported
    const st = new FixedStepDriver(1 / 60, 4);
    expect(st.frame(1)).toBe(4);
    expect(st.discardedWallS).toBeGreaterThan(0.9);
  });
});

describe('G1-D: coached entry and contact profile', () => {
  it('G1-F8 to G1-F10: leverage shapes and mirrors, contact only from physics, fit vs glance vs poor, body-profile sensitivity (every check)', async () => {
    await checks([
      ['G1-F8 leverage/shoulder shape requests; mirrored scenes mirror; forces bounded; runner remains active', async () => {
        const cases = g1f8Cases();
        const byId = new Map<string, Simulation>();
        for (const def of cases) {
          const sim = await run(def);
          byId.set(def.id, sim);
          for (const r of sim.trace.slice(1)) {
            expect(Math.hypot(r.players.D.drive[0], r.players.D.drive[2])).toBeLessThanOrEqual(1400 + 1e-3);
            expect(Math.abs(r.players.D.yawT)).toBeLessThanOrEqual(180 + 1e-6);
            expect(Math.hypot(r.players.R.req[0], r.players.R.req[1])).toBeGreaterThan(2.9); // runner keeps trying
          }
          expect(sim.result).not.toBe('numericalFailure');
        }
        // Mirrors: Z mirrored, X equal. Requests and approach mirror exactly; after contact the solver's manifold
        // ordering is not mirror-symmetric, so post-contact divergence is measured and reported, not asserted to zero.
        const mirrorReport: Record<string, { preContact: number; post: number }> = {};
        for (const def of cases.filter((c) => c.id.includes('-mirror'))) {
          const base = byId.get(def.id.replace('-mirror', ''));
          if (!base) continue;
          const m = byId.get(def.id)!;
          const tc = Math.min(base.events.find((e) => e.type === 'contactBegin')?.t ?? 99, m.events.find((e) => e.type === 'contactBegin')?.t ?? 99);
          const n = Math.min(base.trace.length, m.trace.length);
          let pre = 0;
          let post = 0;
          for (let i = 0; i < n; i++)
            for (const id of ['D', 'R']) {
              const e = Math.max(
                Math.abs(base.trace[i].players[id].p[0] - m.trace[i].players[id].p[0]),
                Math.abs(base.trace[i].players[id].p[2] + m.trace[i].players[id].p[2]),
              );
              if (base.trace[i].t < tc) pre = Math.max(pre, e);
              else post = Math.max(post, e);
            }
          mirrorReport[def.id] = { preContact: pre, post };
          expect(pre, def.id).toBeLessThan(0.002);
        }
        console.log('G1-F8 mirror divergence (m):', JSON.stringify(mirrorReport));
        // Leverage changes the requests (inside-out vs outside-in differ beyond mirroring because the runner drifts).
        const io = byId.get('G1-F8-front-insideOut')!;
        const oi = byId.get('G1-F8-front-outsideIn')!;
        const k = Math.min(io.trace.length, oi.trace.length) - 1;
        expect(Math.abs(io.trace[30].players.D.req[1] - oi.trace[30].players.D.req[1])).toBeGreaterThan(0.2);
        expect(Math.abs(io.trace[k].players.D.p[2] + oi.trace[k].players.D.p[2])).toBeGreaterThan(0.05);
      }],
      ['G1-F8 contact comes only from physics: phases advance on observed contact; a late entry can miss/overrun', async () => {
        const late = await run(coachedFixture({ approach: 'late', leverage: 'insideOut', id: 'late' }));
        const phases = new Set(late.trace.map((r) => r.players.D.ph));
        // a fast, close, crossing entry cannot be rescued: finite braking overruns, forcing a recover phase,
        // or produces a non-selected-shoulder contact.
        const regions = late.events.filter((e) => e.type === 'contactRegion' && e.playerId === 'D').map((e) => e.data!.own);
        expect(phases.has('recover') || !regions.includes('shoulder:selected') || regions[0] !== 'shoulder:selected').toBe(true);
      }],
      ['G1-F9 fit vs glance vs poor: geometry classification, head contact logged, no shoulder bonus impulse', async () => {
        const fit = await run(g1f9Fit());
        const glance = await run(g1f9Glance());
        const poor = await run(g1f9Poor());
        const classes = (s: Simulation) =>
          s.events.filter((e) => e.type === 'contactRegion' && e.playerId === 'D').map((e) => String(e.data!.own));
        const firstTick = (s: Simulation) => {
          const t0 = s.events.find((e) => e.type === 'contactBegin')!.t;
          return s.events.filter((e) => e.type === 'contactRegion' && e.playerId === 'D' && e.t === t0).map((e) => String(e.data!.own));
        };
        expect(firstTick(fit)).toContain('shoulder:selected');
        expect(classes(fit)).not.toContain('head');
        expect(classes(poor)).toContain('head');
        expect(poor.events.some((e) => e.type === 'techniqueFailure' && e.playerId === 'D')).toBe(true);
        // The poor attempt's head contact is kept, not erased: it appears in the trace.
        expect(poor.trace.some((r) => r.players.D.c.some((c) => c.startsWith('head')))).toBe(true);
        expect(classes(glance).length).toBeGreaterThan(0);
        // No bonus: classification is read-only. Source check: no impulse/force API in the classifier.
        const src = readFileSync('src/sim/contact.ts', 'utf8');
        expect(src).not.toMatch(/addForce|applyImpulse|addTorque|setLinvel/);
      }],
      ['G1-F10 body-profile sensitivity: actual masses and dimensions change the fit geometry, no universal snap', async () => {
        const fits: Record<string, number> = {};
        for (const def of g1f10Cases()) {
          const sim = await create(def);
          await runSim(sim, 40); // into gather
          const D = sim.byId.get('D')!;
          expect(D.mass.massKg).toBeCloseTo(def.players[0].body.massKg, 3);
          fits[def.id] = Number(D.intent.debug!.shoulderLanding);
          await runSim(sim);
          expect(sim.events.some((e) => e.type === 'contactBegin'), def.id).toBe(true);
        }
        // Shoulder-landing geometry follows the actual torso/shoulder dimensions.
        expect(fits['G1-F10-defender-135kg-wide']).not.toBeCloseTo(fits['G1-F10-defender-80kg-narrow'], 2);
        expect(fits['G1-F10-runner-135kg-wide']).not.toBeCloseTo(fits['G1-F10-runner-80kg-narrow'], 2);
        // mass alone (same dimensions) does not change fit geometry
        expect(fits['G1-F10-defender-80kg-std']).toBeCloseTo(fits['G1-F10-defender-135kg-std'], 1);
      }],
    ]);
  });
});

describe('plan 10b: the coached entry aims with the phase it has just observed (opt-in)', () => {
  /** Each decision of the coached player D: the phase it returns and the prediction horizon its aim used (s). */
  const decisions = async (def: FixtureDef): Promise<{ phase: string; horizon: number }[]> => {
    const sim = await create(def);
    const ctl = sim.byId.get('D')!.controller;
    const decide = ctl.decide.bind(ctl);
    const out: { phase: string; horizon: number }[] = [];
    ctl.decide = (ctx) => {
      const r = decide(ctx);
      if (r.debug?.horizon !== undefined) out.push({ phase: String(r.debug.phase), horizon: Number(r.debug.horizon) });
      return r;
    };
    await runSim(sim);
    return out;
  };
  const phaseFirst = (def: FixtureDef): FixtureDef => ({ ...def, players: def.players.map((p) => (p.controller.kind === 'coachedEntry' ? { ...p, controller: { ...p.controller, phaseFirst: true } } : p)) });
  /** Connection and drive aim at most 0.1 s ahead: the decisions that do not. */
  const lagging = (ds: { phase: string; horizon: number }[]): number => ds.filter((d) => (d.phase === 'connect' || d.phase === 'drive') && d.horizon > 0.1 + 1e-12).length;

  it('opted in, a decision that enters connection aims as a connection; the gate 1 order, kept on G1, aims as the gather it left', async () => {
    // G1-F8-front-outsideIn enters connection at 1.35 s with a 0.245 s horizon from the gather it has just left
    const def = g1f8Cases().find((d) => d.id === 'G1-F8-front-outsideIn')!;
    const now = await decisions(phaseFirst(def));
    expect(now.some((d) => d.phase === 'connect')).toBe(true);
    expect(now.some((d) => d.phase === 'drive')).toBe(true);
    expect(lagging(now)).toBe(0);
    const old = await decisions(def);
    expect(lagging(old)).toBe(1);
    expect(Math.max(...old.filter((d) => d.phase === 'connect').map((d) => d.horizon))).toBeGreaterThan(0.2);
  });
});

// ============================================================================================= Gate 2
const P = ARM_G2;
const SURFACE_TOL = P.surfaceTolM;

/** Run a fixture, calling `each` after every outer tick (substeps = 1 in these profiles). */

const poseOf = (sim: Simulation, id: string) => {
  const b = sim.byId.get(id)!.proxy.body;
  return { p: { ...b.translation() }, q: { ...b.rotation() } };
};
const statuses = (sim: Simulation) => sim.trace.map((r) => r.players.D.wrap);

function commonArmChecks(sim: Simulation): void {
  expect(sim.result).toBe('duration');
  for (const e of evs(sim, 'gripBegin')) expect(e.data!.palmGap as number).toBeLessThanOrEqual(SURFACE_TOL + 1e-9);
  for (const e of evs(sim, 'clampBegin')) expect(e.data!.gap as number).toBeLessThanOrEqual(SURFACE_TOL + 1e-9);
  // plan 10c (C7): the ledger's pair sum (of the commanded pair, always 0) is gone; the owner's force is the target's
  // negated in the same call
  for (const l of sim.arms?.ledger ?? []) {
    expect(Number.isFinite(l.actual)).toBe(true);
    expect(l.actual).toBeLessThanOrEqual(P.hold.perArmCeilingN + 0.01);
  }
}

describe('G2-A reach (F1)', () => {
  it('bounded, collision-aware reach; impossible requests stay unmet; no grip through the body', async () => {
    const def = G2.g2f1();
    const dt = def.solver.outerTickS / def.solver.substeps;
    let prevLocal: Vec3 | null = null;
    let maxReach = 0;
    let maxSpeed = 0;
    let invalid = 0;
    let beyond = { minDist: Infinity, unmet: Infinity };
    let behind = 0;
    const sim = await runEach(def, (s) => {
      const o = s.arms!.obs('D')!.right!;
      const dp = poseOf(s, 'D');
      const sh = shoulderLocal(s.byId.get('D')!.body, 'right');
      const local = toLocal(dp, o.palmContactWorld);
      maxReach = Math.max(maxReach, len(sub(local, sh)));
      if (prevLocal && s.tick > 0) maxSpeed = Math.max(maxSpeed, len(sub(local, prevLocal)) / dt);
      prevLocal = local;
      if (!o.poseValid) invalid++;
      if (s.t > 1.15 && s.t < 1.4) {
        beyond.minDist = Math.min(beyond.minDist, len(sub(local, sh)));
        beyond.unmet = Math.min(beyond.unmet, len(sub(o.palmContactWorld, o.requestedWorld!)));
      }
      if (s.t > 1.4) {
        const rl = toLocal(poseOf(s, 'R'), o.palmContactWorld);
        if (rl.z < -0.16) behind++;
      }
    });
    commonArmChecks(sim);
    expect(maxReach).toBeLessThanOrEqual(P.maxReachM + 1e-6);
    expect(maxSpeed).toBeLessThanOrEqual(P.maxEndpointSpeedMps + 1e-6);
    expect(invalid).toBe(0);
    expect(beyond.minDist).toBeGreaterThan(P.maxReachM - 0.01);
    expect(beyond.unmet).toBeGreaterThan(0.5);
    expect(behind).toBe(0);
    expect(evs(sim, 'gripBegin')).toHaveLength(0);
    expect(evs(sim, 'gripRejected').length).toBeGreaterThan(0);
  });
});

describe('G2-B one breakable reciprocal hold (F2/F3)', () => {
  it('F2 and F3: a hold born from contact is bounded and reciprocal; it ends by reach loss, overload, geometry or release, with no stretch, launch or auto-regrip (every check)', async () => {
    await checks([
      ['F2: hold is born from contact, force is bounded and both bodies react; control differs only by the arm force', async () => {
        const a = await run(G2.g2f2(true));
        const c = await run(G2.g2f2(false));
        commonArmChecks(a);
        commonArmChecks(c);
        const birth = evs(a, 'gripBegin')[0];
        expect(birth).toBeDefined();
        expect(evs(c, 'gripBegin')).toHaveLength(0);
        expect(c.arms!.ledger).toHaveLength(0);
        // identical until the hold exists
        const before = traceDiff(a.trace.filter((r) => r.t < birth.t), c.trace.filter((r) => r.t < birth.t), ['D', 'R']);
        expect(before.pos).toBeLessThan(1e-9);
        const end = (s: Simulation, id: string) => s.trace[s.trace.length - 1].players[id];
        const dxD = end(a, 'D').p[0] - a.trace[0].players.D.p[0];
        const dxDc = end(c, 'D').p[0] - c.trace[0].players.D.p[0];
        expect(dxD).toBeGreaterThan(0.5); // runner drags the defender
        expect(Math.abs(dxDc)).toBeLessThan(0.02);
        expect(end(a, 'R').p[0]).toBeLessThan(end(c, 'R').p[0] - 0.5); // and is slowed
        const maxT = Math.max(...a.arms!.ledger.map((l) => l.actual));
        expect(maxT).toBeGreaterThan(100);
        expect(maxT).toBeLessThanOrEqual(P.hold.perArmCeilingN + 0.01);
      }],
      ['F3: reach loss, overload, geometric loss and voluntary release; no stretch, no launch, no auto-regrip', async () => {
        const reasons: Record<string, string[]> = {};
        for (const def of [G2.g2f3Separation(), G2.g2f3Overload(), G2.g2f3Turn(), G2.g2f3Reacquire()]) {
          const sim = await run(def);
          commonArmChecks(sim);
          reasons[def.id] = evs(sim, 'gripRelease').map((e) => e.data!.reason as string);
          // no hand stretch beyond tolerance while force is applied
          for (const l of sim.arms!.ledger.filter((x) => x.kind === 'hold'))
            expect(len(sub(l.pointOnTarget, l.pointOnOwner))).toBeLessThanOrEqual(P.maxReachM + P.hold.reachTolM + 1e-9);
          // force stops at release and no impulse is added: velocity change across the release tick stays small
          for (const e of evs(sim, 'gripRelease')) {
            const i = sim.trace.findIndex((r) => r.t >= e.t - 1e-9);
            if (i <= 0 || i + 1 >= sim.trace.length) continue;
            const dv = (k: number, id: string) => Math.hypot(sim.trace[k + 1].players[id].v[0] - sim.trace[k].players[id].v[0], sim.trace[k + 1].players[id].v[2] - sim.trace[k].players[id].v[2]);
            expect(dv(i, 'R')).toBeLessThan(0.25);
            expect(dv(i, 'D')).toBeLessThan(0.25);
            const grip = e.data!.grip as string;
            expect(sim.arms!.ledger.filter((l) => l.id === grip && l.step > Math.round(e.t / sim.dt) + 1)).toHaveLength(0);
          }
          if (def.id === 'G2-F3-reacquire') {
            const rel = evs(sim, 'gripRelease')[0];
            const rearm = evs(sim, 'armRearmed')[0];
            const begins = evs(sim, 'gripBegin');
            expect(rel.data!.reason).toBe('voluntary');
            expect(rearm.t).toBeGreaterThan(1.4); // only after the hand withdrew (re-close at 0.85 s refused)
            expect(begins.filter((b) => b.t > rel.t && b.t < rearm.t)).toHaveLength(0);
            expect(begins.some((b) => b.t >= 2.2)).toBe(true);
          }
        }
        expect(reasons['G2-F3-separation']).toEqual(['unreachable']);
        expect(reasons['G2-F3-overload']).toEqual(['overload']);
        expect(['invalidPose', 'invalidSurface', 'unreachable']).toContain(reasons['G2-F3-turn'][0]);
      }],
    ]);
  });
});

describe('G2-C two arms, wraps and forearm clamps (F4-F8, F10, F11)', () => {
  it('F4 to F8 and F11: holds and wraps classified from geometry, worse geometry never wraps, a wrap breaks one arm at a time, shared budget, friction cone (every check)', async () => {
    await checks([
      ['F4: two front palms are a twoArmHold, never a wrap; the second hand adds no special force', async () => {
        const sim = await run(G2.g2f4());
        commonArmChecks(sim);
        const st = statuses(sim);
        expect(st).toContain('twoArmHold');
        expect(st).not.toContain('wrapped');
        const w = evs(sim, 'wrapStatus').find((e) => e.data!.status === 'twoArmHold')!;
        const az = w.data!.azimuthDeg as Record<string, number>;
        expect(Math.abs(az.left)).toBeLessThan(25);
        expect(Math.abs(az.right)).toBeLessThan(25);
        // right-hand tension just before / after the left hand acquires
        const second = evs(sim, 'gripBegin')[1];
        const step = Math.round(second.t / sim.dt);
        const r = (k: number) => sim.arms!.ledger.find((l) => l.arm === 'right' && l.step === k)?.actual ?? 0;
        expect(Math.abs(r(step + 1) - r(step - 1))).toBeLessThan(5);
      }],
      ['F5/F10: forearms close around opposite sides; wrap is classified from geometry, palms are not attached', async () => {
        for (const def of [G2.g2f5(), G2.g2f10(1)]) {
          let invalid = 0;
          let wrappedBad = 0;
          const sim = await runEach(def, (s) => {
            const o = s.arms!.obs('D')!;
            if (!o.left!.poseValid || !o.right!.poseValid) invalid++;
            if (s.arms!.wrap.get('D')!.status === 'wrapped') {
              const cl = s.arms!.clampOf('D', 'left');
              const cr = s.arms!.clampOf('D', 'right');
              const az = s.arms!.wrap.get('D')!.azimuthDeg;
              if (!cl || !cr || cl.normalForceN <= 1 || cr.normalForceN <= 1) wrappedBad++;
              if (Math.sign(az.left!) === Math.sign(az.right!) || Math.abs(az.left!) < 55 || Math.abs(az.right!) < 55) wrappedBad++;
            }
          });
          commonArmChecks(sim);
          expect(invalid).toBe(0);
          expect(statuses(sim)).toContain('wrapped');
          expect(wrappedBad).toBe(0);
          expect(evs(sim, 'gripBegin')).toHaveLength(0);
          expect(nonEmpty(sim.arms!.ledger, 'ledger').every((l) => l.kind === 'clamp')).toBe(true);
        }
      }],
      ['F6: same controller, worse geometry: partial hold or miss, never a wrap', async () => {
        const part = await run(G2.g2f6Separation(0.35));
        const miss = await run(G2.g2f6Separation(0.45));
        commonArmChecks(part);
        commonArmChecks(miss);
        expect(statuses(part)).not.toContain('wrapped');
        expect(statuses(part).some((s) => s === 'oneArmHold' || s === 'twoArmHold')).toBe(true);
        expect(nonEmpty(statuses(miss), 'statuses').every((s) => s === 'noHold')).toBe(true);
      }],
      ['F7: a wrap breaks one arm at a time', async () => {
        const seq: { status: string; active: number }[] = [];
        const sim = await runEach(G2.g2f7(), (s) => {
          const w = s.arms!.wrap.get('D')!;
          const act = (['left', 'right'] as const).filter((side) => (s.arms!.clampOf('D', side)?.normalForceN ?? 0) > 1).length;
          seq.push({ status: w.status, active: act });
        });
        commonArmChecks(sim);
        const iw = seq.findIndex((x) => x.status === 'wrapped');
        expect(iw).toBeGreaterThan(0);
        const afterWrap = seq.slice(iw);
        const firstBreak = afterWrap.findIndex((x) => x.status !== 'wrapped');
        expect(firstBreak).toBeGreaterThan(0);
        // the wrap degrades to a one-arm hold (one clamp still pressing), never straight to nothing
        expect(afterWrap[firstBreak].status).toBe('oneArmHold');
        expect(afterWrap[firstBreak].active).toBe(1);
        for (const x of nonEmpty(seq.filter((y) => y.status === 'oneArmHold'), 'oneArmHold rows')) expect(x.active).toBe(1);
      }],
      ['F8: shared budget, reciprocal pairs and reverse-order evaluation', async () => {
        for (const def of [G2.g2f8(), G2.g2f8Mixed()]) {
          const sim = await run(def);
          commonArmChecks(sim);
          const perStep = new Map<number, number>();
          for (const l of sim.arms!.ledger) {
            perStep.set(l.step, (perStep.get(l.step) ?? 0) + l.actual);
            if (l.kind === 'hold') expect(l.actual).toBeLessThanOrEqual(l.allocated + 0.01);
            else expect(l.tangentActual).toBeLessThanOrEqual(P.clamp.mu * l.normalActual + 0.01);
          }
          for (const v of nonEmpty(perStep.values(), 'per-step allocations')) expect(v).toBeLessThanOrEqual(P.hold.ownerBudgetN + 0.01);
          if (def.id === 'G2-F8') expect(Math.min(...sim.arms!.ledger.map((l) => l.sharedScale))).toBeLessThan(0.99);
          if (def.id === 'G2-F8-mixed') expect(new Set(sim.arms!.ledger.map((l) => l.kind)).size).toBe(2);
          const rev = await run(def, { reverseOrder: true });
          const key = (l: { step: number; arm: string }) => `${l.step}:${l.arm}`;
          const m = new Map(rev.arms!.ledger.map((l) => [key(l), l]));
          let maxDiff = 0;
          for (const l of sim.arms!.ledger) {
            const r = m.get(key(l));
            expect(r).toBeDefined();
            maxDiff = Math.max(maxDiff, Math.abs(l.raw - r!.raw), Math.abs(l.actual - r!.actual), Math.abs(l.allocated - r!.allocated));
          }
          expect(maxDiff).toBeLessThan(0.5);
          const rel = (s: Simulation) => s.events.filter((e) => e.type === 'gripRelease').map((e) => `${e.t}:${e.data!.arm}:${e.data!.reason}`).sort();
          expect(rel(rev)).toEqual(rel(sim));
          console.log(`[G2-F8] ${def.id} reverse-order max |raw/actual/allocated| diff ${maxDiff.toExponential(2)} N`);
        }
      }],
      ['F11: friction cone, bounded elastic memory, zero pressure means zero friction; lower mu retains less', async () => {
        const hi = await run(G2.g2f11(false));
        const lo = await run(G2.g2f11(true));
        for (const [sim, mu] of [[hi, 0.8], [lo, 0.3]] as const) {
          commonArmChecks(sim);
          for (const l of sim.arms!.ledger) {
            expect(l.tangentActual).toBeLessThanOrEqual(mu * l.normalActual + 0.01);
            expect(l.xT).toBeLessThanOrEqual((mu * l.normalRequested) / P.clamp.tangentStiffness + 1e-9);
            if (l.normalActual === 0) expect(l.tangentActual).toBe(0);
          }
          expect(evs(sim, 'clampEnd').some((e) => e.data!.reason === 'contactLost')).toBe(true);
        }
        const lastClamp = (s: Simulation) => Math.max(...s.arms!.ledger.map((l) => l.step));
        expect(lastClamp(hi)).toBeGreaterThan(lastClamp(lo));
        const endZ = (s: Simulation) => s.trace[s.trace.length - 1].players.R.p[2];
        expect(endZ(hi)).toBeLessThan(endZ(lo) - 0.1);
      }],
    ]);
  });

  it('F10: closing effort off removes every clamp force; contact and movement remain', async () => {
    const on = await run(G2.g2f10(1));
    const off = await run(G2.g2f10(0));
    commonArmChecks(off);
    expect(off.arms!.ledger).toHaveLength(0);
    expect(evs(off, 'clampBegin')).toHaveLength(0);
    expect(nonEmpty(statuses(off), 'statuses').every((s) => s === 'noHold')).toBe(true);
    expect(evs(off, 'contactBegin').length).toBeGreaterThan(0);
    // the runner can still pull the tackler despite the wrap
    const zR = (s: Simulation, t: number) => s.trace.find((r) => r.t >= t)!.players.R.p[2];
    expect(zR(on, 2.5) - zR(on, 1.2)).toBeGreaterThan(0.3);
  });
});

describe('G2-D robustness and continued work (F9, F12)', () => {
  it('F9: resets reproduce contacts and IDs, render rate does not matter, fast bodies do not tunnel through a palm', async () => {
    const def = G2.g2f5();
    const sim = await create(def);
    await runSim(sim);
    const ref = { ev: JSON.stringify(sim.events), tr: sim.trace };
    for (let k = 0; k < 3; k++) {
      sim.reset();
      expect(sim.arms!.grips.size).toBe(0);
      expect(sim.arms!.ledger).toHaveLength(0);
      await runSim(sim);
      expect(JSON.stringify(sim.events)).toBe(ref.ev);
      expect(traceRowsDiff(sim.trace, ref.tr)).toBeNull();
    }
    expect(sim.physics.tags.size).toBe(1 + 4 * 2);
    // render rates: 30 vs 120 Hz display frames feeding the same fixed ticks
    const byRate = async (hz: number) => {
      const s = await create(def);
      const d = new FixedStepDriver(def.solver.outerTickS, 8);
      while (!s.done) {
        for (let i = d.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
        await pace();
      }
      return s;
    };
    const a = await byRate(30);
    const b = await byRate(120);
    expect(traceDiff(a.trace, b.trace, ['D', 'R']).pos).toBe(0);
    // relative-motion sweep at 8 m/s
    let inside = 0;
    let farSide = 0;
    const sw = await runEach(G2.g2f9Sweep(), (s) => {
      const o = s.arms!.obs('D')!.right!;
      if (!o.poseValid) inside++;
      const rl = toLocal(poseOf(s, 'R'), o.palmContactWorld);
      if (Math.abs(rl.z) < 0.16 && rl.x > 0.0 && rl.x < 0.2 && Math.abs(rl.y - 0.25) < 0.25) farSide++; // inside the torso box footprint
    });
    expect(sw.result).toBe('duration');
    expect(inside).toBe(0);
    expect(farSide).toBe(0);
  });

  it('F12: one arm slips while the other keeps working; re-closure only from fresh contact', async () => {
    const sim = await run(G2.g2f12());
    commonArmChecks(sim);
    const st = statuses(sim);
    expect(st).toContain('wrapped');
    const iw = st.indexOf('wrapped');
    const partial = st.slice(iw).some((s) => s === 'oneArmHold' || s === 'twoArmHold');
    expect(partial).toBe(true);
    // independent: some tick with exactly one pressing arm, and an arm that closes again later
    expect(sim.trace.some((r) => r.players.D.arm && [r.players.D.arm.left!.N > 1, r.players.D.arm.right!.N > 1].filter(Boolean).length === 1)).toBe(true);
    const begins = evs(sim, 'clampBegin');
    expect(begins.length).toBeGreaterThan(2);
    void toWorld;
  });
});

// ============================================================================================= Gate 3
const B = BALANCE_G3;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPS = 1e-6;

const leanOf = (sim: Simulation, id: string) => sim.trace.map((r) => ({ t: r.t, ...r.players[id].lean! }));
const finishOf = (sim: Simulation) => sim.trace.map((r) => (r.players.D.ph ?? '').split(' ')[0]);
const byId = (id: string): FixtureDef => allFixtures().find((f) => f.id === id)!;

/** Per-tick motor bounds for every balanced player: balance cap, combined ceiling, finite state. */
function motorBounds(sim: Simulation, bad: string[]): void {
  for (const pl of sim.players) {
    const a = pl.applied;
    if (len(a.balanceCapped) > a.balanceCap + EPS) bad.push(`${sim.t} ${pl.id} balance ${len(a.balanceCapped)} > ${a.balanceCap}`);
    if (len(a.supportTorque) > B.combinedCeilingNm + EPS) bad.push(`${sim.t} ${pl.id} support ${len(a.supportTorque)}`);
    if (pl.controlMode === 'falling' && (len(a.supportTorque) > 0 || len(a.drive) > 0)) bad.push(`${sim.t} ${pl.id} motor while falling`);
    const tr = pl.proxy.body.translation();
    const q = pl.proxy.body.rotation();
    if (![tr.x, tr.y, tr.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) bad.push(`${sim.t} ${pl.id} nonfinite`);
  }
}

// --------------------------------------------------------------------------------------------- G3-F4 unit checks
describe('G3-F4 envelope and yaw unit checks (balance.ts)', () => {
  // body tilted toward +X by theta = rotation about -Z; outward angular velocity is about -Z as well
  const tilt = (deg: number) => qFromAxisAngle(v3(0, 0, -1), deg * D2R);
  const last = v3(1, 0, 0);

  it('lean measure and axis, outward-rate projection, the 25/55/70 deg boundaries and confirmation counter, finite near-zero and pure-yaw cases (every check)', async () => {
    await checks([
      ['degrees/radians and the lean axis are correct', () => {
        for (const d of [5, 25, 30, 55, 70]) {
          const m = measureLean(tilt(d), v3(), last, B.zeroTiltRad);
          expect(m.theta * R2D).toBeCloseTo(d, 9);
          expect(m.axis.z).toBeCloseTo(1, 9); // normalize(cross(u, U)) for a +X lean
        }
        expect(B.minLeanRad * R2D).toBeCloseTo(25, 12);
        expect(B.envelopeRad * R2D).toBeCloseTo(55, 12);
        expect(B.hardLeanRad * R2D).toBeCloseTo(70, 12);
      }],
      ['outward rate inflates projected lean, inward rate does not', () => {
        const out = measureLean(tilt(40), v3(0, 0, -2), last, B.zeroTiltRad);
        const inn = measureLean(tilt(40), v3(0, 0, 2), last, B.zeroTiltRad);
        expect(out.outwardRate).toBeCloseTo(2, 9);
        expect(inn.outwardRate).toBeCloseTo(-2, 9);
        expect(projectedLean(out, B)).toBeCloseTo(40 * D2R + 2 * B.lookAheadS, 9);
        expect(projectedLean(inn, B)).toBeCloseTo(40 * D2R, 12);
        expect(envelopeStep(inn, 0, B)).toEqual({ loss: false, counter: 0 });
      }],
      ['25/55/70 deg boundaries and the confirmation counter', () => {
        const fast = v3(0, 0, -3); // projected = theta + 3 * 0.18 rad = theta + 30.9 deg
        // below the minimum lean: no counter even with a large projection
        expect(envelopeStep(measureLean(tilt(24.9), fast, last, B.zeroTiltRad), 0, B)).toEqual({ loss: false, counter: 0 });
        // above minimum with projection > 55: counter, loss on the second consecutive substep
        const m = measureLean(tilt(25.1), fast, last, B.zeroTiltRad);
        expect(projectedLean(m, B) * R2D).toBeGreaterThan(55);
        const s1 = envelopeStep(m, 0, B);
        expect(s1).toEqual({ loss: false, counter: 1 });
        expect(envelopeStep(m, s1.counter, B)).toEqual({ loss: true, counter: 2, reason: 'recoveryEnvelope' });
        // projection back under 55 resets the counter
        expect(envelopeStep(measureLean(tilt(30), v3(), last, B.zeroTiltRad), 1, B)).toEqual({ loss: false, counter: 0 });
        // static 54.9 vs 55.1 deg
        expect(envelopeStep(measureLean(tilt(54.9), v3(), last, B.zeroTiltRad), 0, B).counter).toBe(0);
        expect(envelopeStep(measureLean(tilt(55.1), v3(), last, B.zeroTiltRad), 0, B).counter).toBe(1);
        // hard limit: immediate
        expect(envelopeStep(measureLean(tilt(69.9), v3(0, 0, 3), last, B.zeroTiltRad), 0, B).loss).toBe(false);
        expect(envelopeStep(measureLean(tilt(70.1), v3(0, 0, 3), last, B.zeroTiltRad), 0, B)).toEqual({ loss: true, counter: 0, reason: 'hardLeanLimit' });
      }],
      ['near-zero lean, zero angular velocity and pure yaw are finite and never lose support', () => {
        const z = measureLean({ x: 0, y: 0, z: 0, w: 1 }, v3(3, 4, 5), last, B.zeroTiltRad);
        expect(z.theta).toBe(0);
        expect(z.outwardRate).toBe(0);
        expect(z.axis).toEqual(last);
        const yawQ = qFromAxisAngle(v3(0, 1, 0), 2.5);
        for (let k = 0; k < 10; k++) {
          const y = measureLean(yawQ, v3(0, 12, 0), last, B.zeroTiltRad);
          expect(y.theta).toBeLessThan(1e-7);
          expect(y.outwardRate).toBe(0);
          expect(envelopeStep(y, k, B)).toEqual({ loss: false, counter: 0 });
        }
        // yaw on top of a tilt does not change the tilt measure
        const t = measureLean(qMul(yawQ, tilt(20)), v3(0, 12, 0), last, B.zeroTiltRad);
        expect(t.theta * R2D).toBeCloseTo(20, 9);
        expect(Math.abs(t.outwardRate)).toBeLessThan(1e-9);
        // torque law near zero / at zero tilt is finite and bounded
        const cap = availableBalanceTorque(B, 100, -9.81, 0.25);
        expect(cap).toBe(240);
        expect(availableBalanceTorque(B, 100, -9.81, 0.16)).toBeCloseTo(156.96, 6);
        for (const q of [{ x: 0, y: 0, z: 0, w: 1 }, tilt(1e-6), tilt(80)]) {
          const r = computeBalanceTorque(measureLean(q, v3(), last, B.zeroTiltRad).bodyUp, UP, v3(0.3, 7, -0.2), B, cap);
          expect([r.requested.x, r.requested.y, r.requested.z, r.capped.x, r.capped.z].every(Number.isFinite)).toBe(true);
          expect(len(r.capped)).toBeLessThanOrEqual(cap + EPS);
          expect(Math.abs(r.capped.y)).toBeLessThan(1e-9); // yaw rate is never damped by the balance motor
        }
        // combined ceiling: balance + yaw scaled proportionally
        const c = combineSupportTorque(v3(240, 0, 0), 180, B.combinedCeilingNm);
        expect(len(c.torque)).toBeCloseTo(300, 6);
        expect(leanScale(0, B)).toBe(1);
        expect(leanScale(B.hardLeanRad, B)).toBe(0);
        expect(len(desiredUpFrom(12 * D2R, v3(0, 0, 0)))).toBeCloseTo(1, 12);
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G3-A
describe('G3-A finite upright authority (F1, F2)', () => {
  it('F1 unlocked rest, run and braking stay upright; F2 10 deg recovers below 5 deg within 1.5 s; with the spec 0.16 m support radius 14 deg exceeds the cap and falls (every check)', async () => {
    await checks([
      ['F1: unlocked rest, straight run and braking stay upright without overwrites', async () => {
        const bad: string[] = [];
        let ymax = -Infinity;
        let ymin = Infinity;
        const sim = await runEach(G3.g3f1(), (s) => {
          motorBounds(s, bad);
          const y = s.players[0].proxy.body.translation().y;
          ymax = Math.max(ymax, y);
          ymin = Math.min(ymin, y);
        });
        expect(bad).toEqual([]);
        expect(sim.result).toBe('duration');
        expect(evs(sim, 'lossOfSupport')).toHaveLength(0);
        const L = leanOf(sim, 'R');
        const rest = L.filter((r) => r.t > 0.5 && r.t < 5);
        expect(Math.max(...rest.map((r) => r.deg))).toBeLessThan(2);
        expect(Math.max(...L.map((r) => r.deg))).toBeLessThan(10);
        expect(ymax - ymin).toBeLessThan(0.05); // no vertical launch
        expect(sim.def.stance.rotation).toBe('free');
      }],
      ['F2: 10 deg initial lean recovers below 5 deg within 1.5 s with damping (rotation genuinely unlocked)', async () => {
        const bad: string[] = [];
        let tilt = 0;
        const sim = await runEach(G3.g3f2(), (s) => {
          motorBounds(s, bad);
          const w = s.players[0].proxy.body.angvel();
          tilt = Math.max(tilt, Math.hypot(w.x, w.z));
        });
        expect(bad).toEqual([]);
        expect(evs(sim, 'lossOfSupport')).toHaveLength(0);
        expect(evs(sim, 'initialLean')).toHaveLength(1);
        expect(tilt).toBeGreaterThan(0.1); // pitch/roll angular velocity exists: not locked
        const L = leanOf(sim, 'R');
        const below = L.find((r) => r.deg < 5)!;
        expect(below.t).toBeLessThan(1.5);
        expect(Math.max(...L.filter((r) => r.t > below.t).map((r) => r.deg))).toBeLessThan(5);
        // large finite torque at the start (209 N m, below the 240 cap), falling as the lean recovers
        expect(Math.max(...L.map((r) => r.tauB))).toBeGreaterThan(200);
        expect(L[L.length - 1].tauB).toBeLessThan(20);
      }],
      ['F2 (spec support radius 0.16 m): 10 deg recovers, 14 deg exceeds the 157 N m cap and falls', async () => {
        const ok = await run(G3.g3f2(10, G3.bodyG3sr16(), '-sr16'));
        expect(evs(ok, 'lossOfSupport')).toHaveLength(0);
        const fall = await run(G3.g3f2(14, G3.bodyG3sr16(), '-sr16-14deg'));
        expect(evs(fall, 'lossOfSupport', 'R')).toHaveLength(1);
        expect(Math.max(...leanOf(fall, 'R').map((r) => r.tauB))).toBeLessThanOrEqual(156.96 + 1e-3);
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G3-B
describe('G3-B loss of support (F3, F5)', () => {
  it('F3 runner speed alone separates recovery from loss and the falling proxy keeps moving; F5 only the balance cap differs and the applied torque follows it (every check)', async () => {
    await checks([
      ['F3: same code and profile, runner speed alone separates recovery from loss; the falling proxy keeps moving', async () => {
        const a = G3.g3f3Side(2, 'recover');
        const b = G3.g3f3Side(4, 'loss');
        expect(a.balance!.id).toBe(b.balance!.id);
        expect(a.players.map((p) => p.body.id)).toEqual(b.players.map((p) => p.body.id));
        const bad: string[] = [];
        const rec = await runEach(a, (s) => motorBounds(s, bad));
        const loss = await runEach(b, (s) => motorBounds(s, bad));
        expect(bad).toEqual([]);
        expect(evs(rec, 'lossOfSupport')).toHaveLength(0);
        expect(Math.max(...leanOf(rec, 'R').map((r) => r.deg))).toBeGreaterThan(8); // real disturbance
        const ev = evs(loss, 'lossOfSupport', 'R');
        expect(ev).toHaveLength(1);
        const d = ev[0].data!;
        expect(['recoveryEnvelope', 'hardLeanLimit']).toContain(d.reason);
        expect(d.leanDeg as number).toBeGreaterThanOrEqual(25);
        expect(d.projectedLeanDeg as number).toBeGreaterThan(55);
        // event fields reproduce the declared criterion from the logged motion
        expect(d.projectedLeanDeg as number).toBeCloseTo((d.leanDeg as number) + Math.max(0, d.outwardLeanRateRadPerS as number) * B.lookAheadS * R2D, 2); // event fields are rounded
        // after loss: falling mode, no motors (motorBounds), proxy continues and comes down
        const after = loss.trace.filter((r) => r.t > ev[0].t + 0.02);
        expect(nonEmpty(after, 'rows after the loss').every((r) => r.players.R.mode === 'falling')).toBe(true);
        const p0 = after[0].players.R.p;
        const p1 = after[after.length - 1].players.R.p;
        expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])).toBeGreaterThan(0.3);
        expect(Math.max(...after.map((r) => r.players.R.lean!.deg))).toBeGreaterThan(70);
      }],
      ['F5: only the balance cap differs (-30%); the applied torque follows the cap and the response differs', async () => {
        const a = G3.g3f5(false);
        const b = G3.g3f5(true);
        const strip = (d: FixtureDef) => JSON.stringify({ ...d, id: '', title: '', balance: { ...d.balance!, id: '', maxBalanceTorqueNm: 0 } });
        expect(strip(a)).toBe(strip(b));
        const full = await run(a);
        const cut = await run(b);
        const La = leanOf(full, 'R');
        const Lb = leanOf(cut, 'R');
        expect(Math.max(...Lb.map((r) => r.tauB))).toBeLessThanOrEqual(168 + 1e-3);
        expect(Math.max(...La.map((r) => r.tauB))).toBeGreaterThan(200);
        expect(nonEmpty(Lb.slice(1, 11), 'lean rows').every((r) => r.tauB > 167)).toBe(true); // the reduced cap binds (row 0 is the reset state)
        expect(evs(full, 'lossOfSupport')).toHaveLength(0);
        expect(evs(cut, 'lossOfSupport', 'R')).toHaveLength(1);
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G3-C
describe('G3-C integration, finish, defender failure, regression (F6-F10)', () => {
  it('F6, F7, F9, F10: a wrap alone never triggers loss, the defender can fall under the same mechanics, sustained vs removed requests, an imperfect one-arm start, bounded posture, wrap status grants no force (every check)', async () => {
    await checks([
      ['F6: a wrap alone does not trigger loss; an unwrapped collision can', async () => {
        const wrap = await run(G3.balancedVariant(G2.g2f5()));
        expect(wrap.trace.some((r) => r.players.D.wrap === 'wrapped')).toBe(true);
        expect(evs(wrap, 'lossOfSupport')).toHaveLength(0);
        const hit = await shared.get(G3.g3f3Side(4, 'loss'));
        expect(hit.arms).toBeFalsy(); // no arm system: nothing can be wrapped
        expect(evs(hit, 'lossOfSupport')).toHaveLength(1);
      }],
      ['F7: the defender can fall under the same mechanics; drive and pull stop, passive holds stay bounded or release', async () => {
        const def = G3.balancedVariant(G2.g2f8());
        const bad: string[] = [];
        let lossTick = -1;
        const lenAtLoss = new Map<string, number>();
        let shortened = 0;
        let runnerDrive = 0;
        const sim = await runEach(def, (s) => {
          motorBounds(s, bad);
          const D = s.byId.get('D')!;
          if (D.controlMode === 'falling') {
            if (lossTick < 0) {
              lossTick = s.tick; // the trace row of the tick that applied the falling mode (ledger and event tick numbering)
              for (const [id, g] of s.arms!.grips) lenAtLoss.set(id, g.desiredLengthM);
            }
            for (const [id, g] of s.arms!.grips) if (lenAtLoss.has(id) && g.desiredLengthM < lenAtLoss.get(id)! - 1e-9) shortened++;
            runnerDrive = Math.max(runnerDrive, len(s.byId.get('R')!.applied.drive));
          }
        });
        expect(bad).toEqual([]);
        const ev = evs(sim, 'lossOfSupport', 'D');
        expect(ev).toHaveLength(1);
        expect(evs(sim, 'controlMode', 'D')[0].data!.armBudgetFraction).toBe(B.fallingArmBudgetFraction);
        expect(lenAtLoss.size).toBeGreaterThan(0); // grips existed at the moment of loss
        expect(shortened).toBe(0);
        for (const l of nonEmpty(sim.arms!.ledger.filter((l) => l.owner === 'D' && l.tick >= lossTick), 'falling ledger entries')) expect(l.allocated).toBeLessThanOrEqual(1000 * B.fallingArmBudgetFraction + 1e-6);
        expect(sim.arms!.ledger.some((l) => l.owner === 'D' && l.tick >= lossTick && l.actual > 1)).toBe(true); // passive retention existed
        const rel = evs(sim, 'gripRelease').filter((e) => e.t > ev[0].t);
        for (const r of rel) expect(['unreachable', 'overload', 'invalidPose', 'invalidSurface', 'contactLost']).toContain(r.data!.reason);
        expect(runnerDrive).toBeGreaterThan(100); // the runner keeps working
        expect(sim.byId.get('R')!.controlMode).toBe('supported');
        // symmetric capability: the runner's loss (F3) and the defender's loss carry the same fields from the same code
        const rLoss = evs(await shared.get(G3.g3f3Side(4, 'loss')), 'lossOfSupport', 'R')[0];
        expect(Object.keys(rLoss.data!).sort()).toEqual(Object.keys(ev[0].data!).sort());
      }],
      ['F9: sustained drive/closure vs requests removed after connection (identical until connection)', async () => {
        const act = await run(G3.g3f9(false));
        const ctl = await run(G3.g3f9(true));
        const tc = evs(ctl, 'clampBegin')[0].t;
        expect(evs(act, 'clampBegin')[0].t).toBe(tc);
        const before = (s: Simulation) => s.trace.filter((r) => r.t < tc);
        expect(traceDiff(before(act), before(ctl), ['D', 'R']).pos).toBe(0);
        // control: no drive and no arm force after connection (a release may follow the first contact tick)
        const ctlAfter = ctl.trace.filter((r) => r.t > tc + 0.02);
        expect(nonEmpty(ctlAfter, 'controlled rows after').every((r) => r.players.D.cap === 0 && Math.hypot(r.players.D.drive[0], r.players.D.drive[2]) === 0)).toBe(true);
        const lastTick = ctl.trace.find((r) => r.t > tc + 0.02)!.tick;
        expect(ctl.arms!.ledger.filter((l) => l.tick > lastTick)).toHaveLength(0);
        // sustained: bounded drive and closure continue
        const actAfter = act.trace.filter((r) => r.t > tc + 0.02 && r.t < 1.2);
        expect(nonEmpty(actAfter, 'actual rows after').every((r) => Math.hypot(r.players.D.drive[0], r.players.D.drive[2]) <= r.players.D.cap + EPS)).toBe(true);
        expect(actAfter.some((r) => Math.hypot(r.players.D.drive[0], r.players.D.drive[2]) > 400)).toBe(true);
        expect(act.trace.some((r) => r.players.D.wrap === 'wrapped')).toBe(true);
        expect(Math.max(...act.trace.map((r) => r.players.D.req[0] ** 2 + r.players.D.req[1] ** 2))).toBeLessThanOrEqual(DEFAULT_MOTOR.maximumRequestedSpeedMps ** 2 + EPS);
        // explainable response difference along the chosen field direction (+Z); the runner still escapes in both
        const zEnd = (s: Simulation) => s.trace[s.trace.length - 1].players.R.p[2];
        expect(zEnd(act) - zEnd(ctl)).toBeGreaterThan(0.3);
        for (const s of [act, ctl]) expect(s.trace[s.trace.length - 1].players.R.p[0]).toBeGreaterThan(4);
        expect(evs(act, 'lossOfSupport')).toHaveLength(0);
      }],
      ['F9: imperfect one-arm start; bounded reposition improves one case and fails in another, no paired snap', async () => {
        const dt = 1 / 60;
        const palmSpeed = async (def: FixtureDef) => {
          let prev: Record<string, Vec3> = {};
          let max = 0;
          const sim = await runEach(def, (s) => {
            const b = s.byId.get('D')!.proxy.body;
            const pose = { p: { ...b.translation() }, q: { ...b.rotation() } };
            for (const side of ['left', 'right'] as const) {
              const o = s.arms!.obs('D')![side]!;
              const local = toLocal(pose, o.palmContactWorld);
              if (prev[side] && s.tick > 0) max = Math.max(max, len(sub(local, prev[side])) / dt);
              prev = { ...prev, [side]: local };
              expect(len(sub(local, shoulderLocal(s.byId.get('D')!.body, side)))).toBeLessThanOrEqual(ARM_G2.maxReachM + 1e-6);
            }
          });
          return { sim, max };
        };
        const imp = await palmSpeed(byId('G3-F9-partial-improve'));
        const fail = await palmSpeed(byId('G3-F9-partial-fail'));
        for (const r of [imp, fail]) {
          expect(r.max).toBeLessThanOrEqual(ARM_G2.maxEndpointSpeedMps * (1 + 1e-5)); // owner frame now includes pitch/roll
          const st = r.sim.trace.map((x) => x.players.D.wrap);
          expect(st[st.findIndex((s) => s && s !== 'noHold')]).toBe('oneArmHold'); // imperfect start
          expect(finishOf(r.sim)).toContain('reposition');
          expect(evs(r.sim, 'lossOfSupport')).toHaveLength(0);
        }
        expect(imp.sim.trace.some((x) => x.players.D.wrap === 'wrapped')).toBe(true);
        expect(fail.sim.trace.some((x) => x.players.D.wrap === 'wrapped')).toBe(false);
        const end = fail.sim.trace[fail.sim.trace.length - 1];
        expect(end.players.D.wrap ?? 'noHold').toBe('noHold');
      }],
      ['F10: posture 0/6/12 deg is bounded, can be opposed, and leaves world-lean loss logic and runner requests unchanged', async () => {
        const res: Record<number, Simulation> = {};
        for (const L of [0, 6, 12]) res[L] = await run(byId(`G3-F10-lean${L}`));
        for (const L of [0, 6, 12]) {
          const s = res[L];
          const D = leanOf(s, 'D');
          expect(Math.max(...D.map((r) => r.post))).toBeCloseTo(L, 3);
          expect(evs(s, 'lossOfSupport')).toHaveLength(0);
          // loss logic uses world lean only: projected = lean + max(0, rate) * lookAhead for every row
          for (const r of nonEmpty([...D, ...leanOf(s, 'R')], 'lean rows')) expect(Math.abs(r.proj - (r.deg + Math.max(0, r.rate) * B.lookAheadS * R2D))).toBeLessThan(2e-3);
          // runner requests stay active (scripted push-back and cut)
          const at = (t: number) => s.trace.find((r) => r.t >= t)!.players.R;
          expect(at(1.3).req).toEqual([1.2, -1.6]);
          expect(at(2.1).req).toEqual([3, 1]);
          expect(Math.hypot(at(1.3).drive[0], at(1.3).drive[2])).toBeGreaterThan(100);
        }
        // actual posture lags/is opposed: with a 12 deg request the defender stays far below it while in contact
        const D12 = leanOf(res[12], 'D').filter((r) => r.post > 11.9);
        expect(D12.length).toBeGreaterThan(10);
        expect(Math.max(...D12.map((r) => r.deg))).toBeLessThan(8);
        expect(Math.max(...D12.map((r) => r.dev))).toBeGreaterThan(8);
        // and the requests change the outcome only through the same mechanics (trajectories differ)
        expect(traceDiff(res[0].trace, res[12].trace, ['D']).pos).toBeGreaterThan(0.01);
      }],
      ['wrap status and visual feet grant no force: the finish controller never reads wrap status', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync('src/sim/controllers/wrap.ts', 'utf8');
        expect(/observed\.wrap/.test(src)).toBe(false);
        const sim = fs.readFileSync('src/sim/simulation.ts', 'utf8');
        expect(/wrap\.get\([^)]*\)\??\.status[^;]*(addForce|addTorque|applyImpulse)/.test(sim)).toBe(false);
      }],
    ]);
  });

  it('F8: resets clear loss, mode and grips; render rate does not matter; balanced reruns complete', async () => {
    for (const def of [G3.g3f3Side(4, 'loss'), G3.balancedVariant(G2.g2f8())]) {
      const sim = await create(def);
      await runSim(sim);
      const ref = { ev: JSON.stringify(sim.events), tr: sim.trace };
      for (let k = 0; k < 2; k++) {
        sim.reset();
        expect(sim.players.every((p) => p.controlMode === 'supported' && p.balance.counter === 0 && !p.balance.pendingLoss)).toBe(true);
        expect(evs(sim, 'lossOfSupport')).toHaveLength(0);
        if (sim.arms) expect(sim.arms.grips.size).toBe(0);
        await runSim(sim);
        expect(JSON.stringify(sim.events)).toBe(ref.ev);
        expect(traceRowsDiff(sim.trace, ref.tr)).toBeNull();
      }
    }
    const def = G3.g3f3Side(4, 'loss');
    const byRate = async (hz: number) => {
      const s = await create(def);
      const d = new FixedStepDriver(def.solver.outerTickS, 8);
      while (!s.done) {
        for (let i = d.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
        await pace();
      }
      return s;
    };
    const a = await byRate(30);
    const b = await byRate(120);
    expect(traceDiff(a.trace, b.trace, ['D', 'R']).pos).toBe(0);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    // balanced reruns of the Gate 2 wrap fixtures complete (outcomes reported separately in the handoff)
    for (const f of [G2.g2f5(), G2.g2f7(), G2.g2f10(), G2.g2f11(), G2.g2f12(), G2.g2f4()]) {
      const s = await run(G3.balancedVariant(f));
      expect(s.result).toBe('duration');
      expect(s.def.stance.rotation).toBe('free');
    }
  });
});
