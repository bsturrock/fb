import { afterEach, describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import * as G2 from '../src/sim/fixtures/gate2';
import { ARM_G2, shoulderLocal } from '../src/sim/profiles';
import { len, sub, toLocal, toWorld, type Vec3 } from '../src/sim/vec';
import { create, disposeTracked, evs, nonEmpty, pace, run, runEach, runSim, traceDiff, traceRowsDiff } from './helpers';

// free every engine world a test created (gate tests do not dispose their simulations themselves)
afterEach(() => disposeTracked());

const P = ARM_G2;
const TOL = P.surfaceTolM;

/** Run a fixture, calling `each` after every outer tick (substeps = 1 in these profiles). */

const poseOf = (sim: Simulation, id: string) => {
  const b = sim.byId.get(id)!.proxy.body;
  return { p: { ...b.translation() }, q: { ...b.rotation() } };
};
const statuses = (sim: Simulation) => sim.trace.map((r) => r.players.D.wrap);

function commonArmChecks(sim: Simulation): void {
  expect(sim.result).toBe('duration');
  for (const e of evs(sim, 'gripBegin')) expect(e.data!.palmGap as number).toBeLessThanOrEqual(TOL + 1e-9);
  for (const e of evs(sim, 'clampBegin')) expect(e.data!.gap as number).toBeLessThanOrEqual(TOL + 1e-9);
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
  it('F2: hold is born from contact, force is bounded and both bodies react; control differs only by the arm force', async () => {
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
  });

  it('F3: reach loss, overload, geometric loss and voluntary release; no stretch, no launch, no auto-regrip', async () => {
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
  });
});

describe('G2-C two arms, wraps and forearm clamps (F4-F8, F10, F11)', () => {
  it('F4: two front palms are a twoArmHold, never a wrap; the second hand adds no special force', async () => {
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
  });

  it('F5/F10: forearms close around opposite sides; wrap is classified from geometry, palms are not attached', async () => {
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

  it('F6: same controller, worse geometry: partial hold or miss, never a wrap', async () => {
    const part = await run(G2.g2f6Separation(0.35));
    const miss = await run(G2.g2f6Separation(0.45));
    commonArmChecks(part);
    commonArmChecks(miss);
    expect(statuses(part)).not.toContain('wrapped');
    expect(statuses(part).some((s) => s === 'oneArmHold' || s === 'twoArmHold')).toBe(true);
    expect(nonEmpty(statuses(miss), 'statuses').every((s) => s === 'noHold')).toBe(true);
  });

  it('F7: a wrap breaks one arm at a time', async () => {
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
  });

  it('F8: shared budget, reciprocal pairs and reverse-order evaluation', async () => {
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
  });

  it('F11: friction cone, bounded elastic memory, zero pressure means zero friction; lower mu retains less', async () => {
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
