import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  g1f1, g1f2, g1f2Control, g1f3, g1f4, g1f5, g1f6Airborne, g1f6Impact, g1f7, g1f8Cases, g1f9Fit, g1f9Glance, g1f9Poor,
  g1f10Cases, coachedFixture,
} from '../src/sim/fixtures/gate1';
import { Simulation } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import { computeDrive, computeYaw } from '../src/sim/motors';
import { DEFAULT_MOTOR } from '../src/sim/profiles';
import { qFromYaw, v3 } from '../src/sim/vec';
import { run, speedH, traceDiff } from './helpers';

const TOL = { pos: 0.001, vel: 0.001, yaw: 0.001 };

describe('G1 motor laws (unit)', () => {
  it('drive is one combined horizontal budget, capped, zero when unsupported', () => {
    const intent = { desiredVelocityWorld: v3(6, 0, 6), desiredFacingWorld: v3(0, 0, 1), effort: 1 };
    const d = computeDrive(intent, v3(), 100, DEFAULT_MOTOR, true);
    expect(Math.hypot(d.force.x, d.force.z)).toBeCloseTo(1400, 6);
    expect(Math.hypot(d.requestedVelocity.x, d.requestedVelocity.z)).toBeCloseTo(6, 6);
    expect(computeDrive(intent, v3(), 100, DEFAULT_MOTOR, false).force).toEqual(v3());
    const half = computeDrive({ ...intent, effort: 0.5 }, v3(), 100, DEFAULT_MOTOR, true);
    expect(Math.hypot(half.force.x, half.force.z)).toBeCloseTo(700, 6);
  });
  it('yaw torque is damped, proportional, capped at 180 N m', () => {
    const y = computeYaw({ desiredVelocityWorld: v3(), desiredFacingWorld: v3(1, 0, 0), effort: 1 }, qFromYaw(0), 0, DEFAULT_MOTOR, true);
    expect(y.angleError).toBeCloseTo(Math.PI / 2, 6);
    expect(y.torqueY).toBeCloseTo(180, 6);
    const small = computeYaw({ desiredVelocityWorld: v3(), desiredFacingWorld: v3(Math.sin(0.1), 0, Math.cos(0.1)), effort: 1 }, qFromYaw(0), 0.5, DEFAULT_MOTOR, true);
    expect(small.torqueY).toBeCloseTo(300 * 0.1 - 80 * 0.5, 6);
  });
});

describe('G1-A: one bounded motor (F1) and unsupported movement (F6 airborne)', () => {
  it('G1-F1 force stays capped; acceleration and braking take time; zero request does not freeze', async () => {
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
  });

  for (const kind of ['legacy', 'compound'] as const)
    it(`G1-F6 airborne (${kind}): no ground drive while unsupported; gravity acts; drive resumes on landing`, async () => {
      const sim = await run(g1f6Airborne(kind));
      const tr = sim.trace;
      expect(tr[0].players.P1.g).toBe(0);
      expect(tr[0].players.P1.p[1]).toBeGreaterThan(1.2);
      const air = tr.filter((r) => r.players.P1.g === 0);
      expect(air.length).toBeGreaterThan(5);
      for (const r of air.slice(1)) expect(Math.hypot(r.players.P1.drive[0], r.players.P1.drive[2])).toBe(0);
      // falling under gravity: height decreases while airborne
      expect(air.at(-1)!.players.P1.p[1]).toBeLessThan(air[0].players.P1.p[1]);
      const land = tr.findIndex((r) => r.players.P1.g === 1);
      expect(land).toBeGreaterThan(0);
      expect(Math.abs(tr[land].players.P1.p[2] - tr[0].players.P1.p[2])).toBeLessThan(0.01); // no air steering
      expect(tr.at(-1)!.players.P1.v[2]).toBeGreaterThan(3);
    });
});

describe('G1-B: two independently controlled bodies with contact', () => {
  it('G1-F2 symmetric impact: no pass-through, both react, horizontal pair momentum preserved; order-independent', async () => {
    for (const kind of ['legacy', 'compound'] as const) {
      const sim = await run(g1f2(kind));
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
  });

  it('G1-F3 off-center impact differs from centered; compound torsos also yaw; no controller rotates the opponent', async () => {
    const centered = await run(g1f2('legacy'));
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
  });

  it('G1-F4 both continue trying: requests persist through contact, neither body is assigned its desired velocity', async () => {
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
  });

  it('G1-F5 unequal masses: engine masses match; response changes through mechanics when masses swap', async () => {
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
  });
});

describe('G1-C: reproducible, inspectable drill', () => {
  for (const kind of ['legacy', 'compound'] as const)
    it(`G1-F6 high-speed impact (${kind}, 8 m/s per body): no tunneling, finite`, async () => {
      const sim = await run(g1f6Impact(kind, 8));
      expect(sim.result).toBe('duration');
      for (const r of sim.trace) expect(r.players.D.p[0]).toBeLessThan(r.players.R.p[0]);
      expect(sim.minPairGap).toBeGreaterThan(-0.02);
      expect(sim.events.some((e) => e.type === 'contactBegin')).toBe(true);
    });

  it('G1-F7 render rate independence (30 vs 120 FPS), reset repeatability, cosmetic independence', async () => {
    const ticks = Math.round(g1f7().durationS / g1f7().solver.outerTickS);
    const drive = async (fps: number, palette: string) => {
      const sim = await Simulation.create(g1f7(palette));
      const drv = new FixedStepDriver(sim.tickS, 1000);
      while (sim.tick < ticks && !sim.done) {
        const n = drv.frame(1 / fps);
        for (let i = 0; i < n && !sim.done; i++) sim.stepTick();
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
    sim.runToEnd();
    const second = sim.trace;
    sim.reset();
    sim.runToEnd();
    const third = sim.trace;
    d = traceDiff(first, second, ['D', 'R']);
    expect(d.pos).toBeLessThanOrEqual(TOL.pos);
    expect(d.vel).toBeLessThanOrEqual(TOL.vel);
    expect(d.yaw).toBeLessThanOrEqual(TOL.yaw);
    expect(traceDiff(first, third, ['D', 'R']).pos).toBeLessThanOrEqual(TOL.pos);
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

  it('exported fixture JSON carries schema, profiles, solver settings, tick-indexed inputs and measured mass', async () => {
    const sim = await run(g1f4({ kind: 'compound' }));
    const ex = sim.exportFixture() as any;
    expect(ex.schemaVersion).toBe('tackling-v1.1');
    expect(ex.profileIds.solver).toBe('solver-g1-1x60');
    expect(ex.profileIds.stance).toBe('stance-g1-pitchRollLocked');
    expect(ex.players[0].controller.segments[0].fromTick).toBe(0);
    expect(ex.players[0].measuredMass.massKg).toBeCloseTo(100, 3);
    expect(ex.profiles.solver.passiveFriction).toBe(0.7);
    expect(ex.randomSeed).toBeNull();
    expect(JSON.parse(JSON.stringify(ex))).toEqual(ex);
  });
});

describe('G1-D: coached entry and contact profile', () => {
  it('G1-F8 leverage/shoulder shape requests; mirrored scenes mirror; forces bounded; runner remains active', async () => {
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
  });

  it('G1-F8 contact comes only from physics: phases advance on observed contact; a late entry can miss/overrun', async () => {
    const late = await run(coachedFixture({ approach: 'late', leverage: 'insideOut', id: 'late' }));
    const phases = new Set(late.trace.map((r) => r.players.D.ph));
    // a fast, close, crossing entry cannot be rescued: finite braking overruns, forcing a recover phase,
    // or produces a non-selected-shoulder contact.
    const regions = late.events.filter((e) => e.type === 'contactRegion' && e.playerId === 'D').map((e) => e.data!.own);
    expect(phases.has('recover') || !regions.includes('shoulder:selected') || regions[0] !== 'shoulder:selected').toBe(true);
  });

  it('G1-F9 fit vs glance vs poor: geometry classification, head contact logged, no shoulder bonus impulse', async () => {
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
  });

  it('G1-F10 body-profile sensitivity: actual masses and dimensions change the fit geometry, no universal snap', async () => {
    const fits: Record<string, number> = {};
    for (const def of g1f10Cases()) {
      const sim = await Simulation.create(def);
      sim.runToEnd(40); // into gather
      const D = sim.byId.get('D')!;
      expect(D.mass.massKg).toBeCloseTo(def.players[0].body.massKg, 3);
      fits[def.id] = Number(D.intent.debug!.shoulderLanding);
      sim.runToEnd();
      expect(sim.events.some((e) => e.type === 'contactBegin'), def.id).toBe(true);
    }
    // Shoulder-landing geometry follows the actual torso/shoulder dimensions.
    expect(fits['G1-F10-defender-135kg-wide']).not.toBeCloseTo(fits['G1-F10-defender-80kg-narrow'], 2);
    expect(fits['G1-F10-runner-135kg-wide']).not.toBeCloseTo(fits['G1-F10-runner-80kg-narrow'], 2);
    // mass alone (same dimensions) does not change fit geometry
    expect(fits['G1-F10-defender-80kg-std']).toBeCloseTo(fits['G1-F10-defender-135kg-std'], 1);
  });
});
