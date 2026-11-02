import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import * as G3 from '../src/sim/fixtures/gate3';
import * as G2 from '../src/sim/fixtures/gate2';
import { allFixtures } from '../src/sim/fixtures/index';
import {
  availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, envelopeStep, leanScale, measureLean, projectedLean,
} from '../src/sim/balance';
import { ARM_G2, BALANCE_G3, DEFAULT_MOTOR, shoulderLocal } from '../src/sim/profiles';
import type { FixtureDef } from '../src/sim/fixture';
import { len, qFromAxisAngle, qMul, sub, toLocal, UP, v3, type Vec3 } from '../src/sim/vec';
import { run, traceDiff } from './helpers';

const B = BALANCE_G3;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const EPS = 1e-6;

async function runEach(def: FixtureDef, each: (sim: Simulation) => void): Promise<Simulation> {
  const sim = await Simulation.create(def);
  each(sim);
  while (!sim.done) {
    sim.stepTick();
    each(sim);
  }
  return sim;
}
const evs = (sim: Simulation, type: string, id?: string) => sim.events.filter((e) => e.type === type && (!id || e.playerId === id));
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

  it('degrees/radians and the lean axis are correct', () => {
    for (const d of [5, 25, 30, 55, 70]) {
      const m = measureLean(tilt(d), v3(), last, B.zeroTiltRad);
      expect(m.theta * R2D).toBeCloseTo(d, 9);
      expect(m.axis.z).toBeCloseTo(1, 9); // normalize(cross(u, U)) for a +X lean
    }
    expect(B.minLeanRad * R2D).toBeCloseTo(25, 12);
    expect(B.envelopeRad * R2D).toBeCloseTo(55, 12);
    expect(B.hardLeanRad * R2D).toBeCloseTo(70, 12);
  });

  it('outward rate inflates projected lean, inward rate does not', () => {
    const out = measureLean(tilt(40), v3(0, 0, -2), last, B.zeroTiltRad);
    const inn = measureLean(tilt(40), v3(0, 0, 2), last, B.zeroTiltRad);
    expect(out.outwardRate).toBeCloseTo(2, 9);
    expect(inn.outwardRate).toBeCloseTo(-2, 9);
    expect(projectedLean(out, B)).toBeCloseTo(40 * D2R + 2 * B.lookAheadS, 9);
    expect(projectedLean(inn, B)).toBeCloseTo(40 * D2R, 12);
    expect(envelopeStep(inn, 0, B)).toEqual({ loss: false, counter: 0 });
  });

  it('25/55/70 deg boundaries and the confirmation counter', () => {
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
  });

  it('near-zero lean, zero angular velocity and pure yaw are finite and never lose support', () => {
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
  });
});

// --------------------------------------------------------------------------------------------- G3-A
describe('G3-A finite upright authority (F1, F2)', () => {
  it('F1: unlocked rest, straight run and braking stay upright without overwrites', async () => {
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
  });

  it('F2: 10 deg initial lean recovers below 5 deg within 1.5 s with damping (rotation genuinely unlocked)', async () => {
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
  });

  it('F2 (spec support radius 0.16 m): 10 deg recovers, 14 deg exceeds the 157 N m cap and falls', async () => {
    const ok = await run(G3.g3f2(10, G3.bodyG3sr16(), '-sr16'));
    expect(evs(ok, 'lossOfSupport')).toHaveLength(0);
    const fall = await run(G3.g3f2(14, G3.bodyG3sr16(), '-sr16-14deg'));
    expect(evs(fall, 'lossOfSupport', 'R')).toHaveLength(1);
    expect(Math.max(...leanOf(fall, 'R').map((r) => r.tauB))).toBeLessThanOrEqual(156.96 + 1e-3);
  });
});

// --------------------------------------------------------------------------------------------- G3-B
describe('G3-B loss of support (F3, F5)', () => {
  it('F3: same code and profile, runner speed alone separates recovery from loss; the falling proxy keeps moving', async () => {
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
    expect(after.every((r) => r.players.R.mode === 'falling')).toBe(true);
    const p0 = after[0].players.R.p;
    const p1 = after[after.length - 1].players.R.p;
    expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])).toBeGreaterThan(0.3);
    expect(Math.max(...after.map((r) => r.players.R.lean!.deg))).toBeGreaterThan(70);
  });

  it('F5: only the balance cap differs (-30%); the applied torque follows the cap and the response differs', async () => {
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
    expect(Lb.slice(1, 11).every((r) => r.tauB > 167)).toBe(true); // the reduced cap binds (row 0 is the reset state)
    expect(evs(full, 'lossOfSupport')).toHaveLength(0);
    expect(evs(cut, 'lossOfSupport', 'R')).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------------------------- G3-C
describe('G3-C integration, finish, defender failure, regression (F6-F10)', () => {
  it('F6: a wrap alone does not trigger loss; an unwrapped collision can', async () => {
    const wrap = await run(G3.balancedVariant(G2.g2f5()));
    expect(wrap.trace.some((r) => r.players.D.wrap === 'wrapped')).toBe(true);
    expect(evs(wrap, 'lossOfSupport')).toHaveLength(0);
    const hit = await run(G3.g3f3Side(4, 'loss'));
    expect(hit.arms).toBeFalsy(); // no arm system: nothing can be wrapped
    expect(evs(hit, 'lossOfSupport')).toHaveLength(1);
  });

  it('F7: the defender can fall under the same mechanics; drive and pull stop, passive holds stay bounded or release', async () => {
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
          lossTick = s.tick - 1; // index of the step that applied the falling mode (ledger tick numbering)
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
    for (const l of sim.arms!.ledger.filter((l) => l.owner === 'D' && l.tick >= lossTick)) expect(l.allocated).toBeLessThanOrEqual(1000 * B.fallingArmBudgetFraction + 1e-6);
    expect(sim.arms!.ledger.some((l) => l.owner === 'D' && l.tick >= lossTick && l.actual > 1)).toBe(true); // passive retention existed
    const rel = evs(sim, 'gripRelease').filter((e) => e.t > ev[0].t);
    for (const r of rel) expect(['unreachable', 'overload', 'invalidPose', 'invalidSurface', 'contactLost']).toContain(r.data!.reason);
    expect(runnerDrive).toBeGreaterThan(100); // the runner keeps working
    expect(sim.byId.get('R')!.controlMode).toBe('supported');
    // symmetric capability: the runner's loss (F3) and the defender's loss carry the same fields from the same code
    const rLoss = evs(await run(G3.g3f3Side(4, 'loss')), 'lossOfSupport', 'R')[0];
    expect(Object.keys(rLoss.data!).sort()).toEqual(Object.keys(ev[0].data!).sort());
  });

  it('F8: resets clear loss, mode and grips; render rate does not matter; balanced reruns complete', async () => {
    for (const def of [G3.g3f3Side(4, 'loss'), G3.balancedVariant(G2.g2f8())]) {
      const sim = await Simulation.create(def);
      sim.runToEnd();
      const ref = { ev: JSON.stringify(sim.events), tr: sim.trace };
      for (let k = 0; k < 2; k++) {
        sim.reset();
        expect(sim.players.every((p) => p.controlMode === 'supported' && p.balance.counter === 0 && !p.balance.pendingLoss)).toBe(true);
        expect(evs(sim, 'lossOfSupport')).toHaveLength(0);
        if (sim.arms) expect(sim.arms.grips.size).toBe(0);
        sim.runToEnd();
        expect(JSON.stringify(sim.events)).toBe(ref.ev);
        expect(traceDiff(sim.trace, ref.tr, sim.players.map((p) => p.id)).pos).toBe(0);
      }
    }
    const def = G3.g3f3Side(4, 'loss');
    const byRate = async (hz: number) => {
      const s = await Simulation.create(def);
      const d = new FixedStepDriver(def.solver.outerTickS, 8);
      while (!s.done) for (let i = d.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
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

  it('F9: sustained drive/closure vs requests removed after connection (identical until connection)', async () => {
    const act = await run(G3.g3f9(false));
    const ctl = await run(G3.g3f9(true));
    const tc = evs(ctl, 'clampBegin')[0].t;
    expect(evs(act, 'clampBegin')[0].t).toBe(tc);
    const before = (s: Simulation) => s.trace.filter((r) => r.t < tc);
    expect(traceDiff(before(act), before(ctl), ['D', 'R']).pos).toBe(0);
    // control: no drive and no arm force after connection (a release may follow the first contact tick)
    const ctlAfter = ctl.trace.filter((r) => r.t > tc + 0.02);
    expect(ctlAfter.every((r) => r.players.D.cap === 0 && Math.hypot(r.players.D.drive[0], r.players.D.drive[2]) === 0)).toBe(true);
    const lastTick = ctl.trace.find((r) => r.t > tc + 0.02)!.tick;
    expect(ctl.arms!.ledger.filter((l) => l.tick > lastTick)).toHaveLength(0);
    // sustained: bounded drive and closure continue
    const actAfter = act.trace.filter((r) => r.t > tc + 0.02 && r.t < 1.2);
    expect(actAfter.every((r) => Math.hypot(r.players.D.drive[0], r.players.D.drive[2]) <= r.players.D.cap + EPS)).toBe(true);
    expect(actAfter.some((r) => Math.hypot(r.players.D.drive[0], r.players.D.drive[2]) > 400)).toBe(true);
    expect(act.trace.some((r) => r.players.D.wrap === 'wrapped')).toBe(true);
    expect(Math.max(...act.trace.map((r) => r.players.D.req[0] ** 2 + r.players.D.req[1] ** 2))).toBeLessThanOrEqual(DEFAULT_MOTOR.maximumRequestedSpeedMps ** 2 + EPS);
    // explainable response difference along the chosen field direction (+Z); the runner still escapes in both
    const zEnd = (s: Simulation) => s.trace[s.trace.length - 1].players.R.p[2];
    expect(zEnd(act) - zEnd(ctl)).toBeGreaterThan(0.3);
    for (const s of [act, ctl]) expect(s.trace[s.trace.length - 1].players.R.p[0]).toBeGreaterThan(4);
    expect(evs(act, 'lossOfSupport')).toHaveLength(0);
  });

  it('F9: imperfect one-arm start; bounded reposition improves one case and fails in another, no paired snap', async () => {
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
  });

  it('F10: posture 0/6/12 deg is bounded, can be opposed, and leaves world-lean loss logic and runner requests unchanged', async () => {
    const res: Record<number, Simulation> = {};
    for (const L of [0, 6, 12]) res[L] = await run(byId(`G3-F10-lean${L}`));
    for (const L of [0, 6, 12]) {
      const s = res[L];
      const D = leanOf(s, 'D');
      expect(Math.max(...D.map((r) => r.post))).toBeCloseTo(L, 3);
      expect(evs(s, 'lossOfSupport')).toHaveLength(0);
      // loss logic uses world lean only: projected = lean + max(0, rate) * lookAhead for every row
      for (const r of [...D, ...leanOf(s, 'R')]) expect(Math.abs(r.proj - (r.deg + Math.max(0, r.rate) * B.lookAheadS * R2D))).toBeLessThan(2e-3);
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
  });

  it('wrap status and visual feet grant no force: the finish controller never reads wrap status', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/sim/controllers/wrap.ts', 'utf8');
    expect(/observed\.wrap/.test(src)).toBe(false);
    const sim = fs.readFileSync('src/sim/simulation.ts', 'utf8');
    expect(/wrap\.get\([^)]*\)\??\.status[^;]*(addForce|addTorque|applyImpulse)/.test(sim)).toBe(false);
  });
});
