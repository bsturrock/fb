// Plan 07a (HC): ragdoll handoff during player contact. The required natural-contact cases (RH-F6-simultaneous,
// RH-F5-playerBelow, L2-F14-oneArmFeet) become audited articulated falls under the unchanged boundary checks; the HC
// variants (mirrored, conversion phase, bob phase, drop height, low stance, both falling, clear space) hold the same;
// deliberately invalid candidates and strict transfer audits still fail safely; batch decisions are independent of
// player order and reproducible over reset, pause and render rates; the published poses stay continuous in contact.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { mirrorZ } from '../src/sim/fixtures/handoff-contact';
import { rhf6 } from '../src/sim/fixtures/ride-height';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import type { FixtureDef } from '../src/sim/fixture';
import { poseProbe } from '../src/sim/debug';
import { stableReach } from '../src/sim/pose';
import { anchorErrors, bulkOf, SEGMENTS } from '../src/sim/ragdoll';
import { POSE_GUARD_C6 } from '../src/sim/profiles';
import { add, dot, len, norm, qConj, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { breathe, FIX, pace, run, runSim, stepWhile, traceDiff } from './helpers';

const HC = (): FixtureDef[] => allFixtures().filter((d) => d.id.startsWith('HC-'));
/** Unchanged boundary tolerances (RagdollProfile validation): landmark 0.01 m, new external penetration 0.015 m. */
const LANDMARK_TOL = 0.01;
const PEN_TOL = 0.015;

/** Every accepted handoff passes the unchanged candidate and transfer checks. */
function expectAudited(pl: PlayerRuntime, fx: string): void {
  const h = pl.handoff!;
  const tag = `${fx} ${pl.id}`;
  expect(h.outcome, tag).toBe('accepted');
  const r = h.report;
  expect(r.ok, tag).toBe(true);
  expect(r.finite, tag).toBe(true);
  expect(r.hingeOk, tag).toBe(true);
  expect(r.lengthErrM, tag).toBeLessThanOrEqual(1e-3);
  expect(r.maxAnchorErrM, tag).toBeLessThanOrEqual(5e-3);
  expect(r.maxLandmarkErrM, tag).toBeLessThanOrEqual(LANDMARK_TOL);
  expect(r.maxNewExternalPenetrationM, tag).toBeLessThanOrEqual(PEN_TOL);
  expect(r.floorPenetrationM, tag).toBeLessThanOrEqual(PEN_TOL);
  for (const [k, deg] of Object.entries(r.hingeDeg)) expect(Number.isFinite(deg), `${tag} ${k}`).toBe(true);
  const a = h.audit!;
  expect(a.ok, tag).toBe(true);
  expect(Math.abs(a.massDiffKg), tag).toBeLessThan(1e-6);
  expect(a.linearRelErr, tag).toBeLessThan(1e-3);
  expect(a.angularRelErr, tag).toBeLessThan(1e-2);
  expect(a.energyDeltaJ, tag).toBeLessThanOrEqual(a.energyGainLimitJ);
  // the solved bulk velocity, vertical included, is what transfers
  expect(len(sub(vecOf(a.after.P), vecOf(a.before.P))), tag).toBeLessThan(1e-3 * Math.max(1, len(vecOf(a.before.P))));
  expect(h.activeBodies, tag).toEqual({ before: 1, after: 10, proxyRemoved: true });
}
const vecOf = (v: number[]): Vec3 => ({ x: v[0], y: v[1], z: v[2] });

/** Handoff outcome summary (player, outcome, step, reasons) for order / reproducibility comparisons. */
const handoffs = (sim: Simulation): string =>
  sim.players
    .map((p) => (p.handoff ? `${p.id}:${p.handoff.outcome}@${p.handoff.step}(${p.handoff.report.reasons.join(',')})` : `${p.id}:-`))
    .sort()
    .join(' ');

/**
 * Per substep after each accepted switch (first n substeps): player penetration, joint anchor separation, and the
 * external impulse on the assembly (dP - m g dt, body weights). Validating only the disabled candidate is not enough.
 */
async function postSwitch(def: FixtureDef, n = 24): Promise<Record<string, { pen: number; anchor: number; extBW: number }>> {
  const sim = await Simulation.create(def);
  const S = sim as unknown as { stepSubstep: (i: number) => void; physics: { dt: number } };
  const g = Math.abs(def.solver.gravityY);
  const out: Record<string, { pen: number; anchor: number; extBW: number; step0: number; prevP: Vec3 }> = {};
  const orig = S.stepSubstep.bind(sim);
  S.stepSubstep = (i: number) => {
    orig(i);
    for (const pl of sim.players) {
      const h = pl.handoff;
      if (!pl.rag || !h || h.outcome !== 'accepted') continue;
      const r = (out[pl.id] ??= { pen: 0, anchor: 0, extBW: 0, step0: h.step, prevP: vecOf(h.audit!.after.P) });
      if (sim.steps - r.step0 > n) continue;
      const bodies = SEGMENTS.map((s) => pl.rag!.bodies[s]);
      const m = bodies.reduce((a, b) => a + b.mass(), 0);
      for (const c of sim.contacts) {
        if (c.a.playerId !== pl.id && c.b.playerId !== pl.id) continue;
        const o = c.a.playerId === pl.id ? c.b : c.a;
        if (o.playerId === null || o.playerId === pl.id) continue;
        for (const p of c.points) r.pen = Math.max(r.pen, -p.dist);
      }
      r.anchor = Math.max(r.anchor, ...Object.values(anchorErrors(pl.rag)));
      const b = bulkOf(bodies);
      r.extBW = Math.max(r.extBW, len(add(sub(b.P, r.prevP), { x: 0, y: m * g * S.physics.dt, z: 0 })) / S.physics.dt / (m * g));
      r.prevP = b.P;
    }
  };
  await runSim(sim);
  sim.dispose();
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { pen: v.pen, anchor: v.anchor, extBW: v.extBW }]));
}

/** Worst body-local one-tick second difference of the shown knee/ankle/elbow/wrist while each player is a proxy. */
async function worstSnap(def: FixtureDef): Promise<{ worst: number; at: string }> {
  const J = ['leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle', 'leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'];
  const sim = await Simulation.create(def);
  const hist: Record<string, Record<string, Vec3>[]> = {};
  let worst = 0;
  let at = '';
  while (!sim.done) {
    sim.stepTick();
    await pace();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) {
        delete hist[pl.id];
        continue;
      }
      const o = pl.proxy.body.translation();
      const q = pl.proxy.body.rotation();
      const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      const cur: Record<string, Vec3> = {};
      for (const n of J) cur[n] = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
      const h = (hist[pl.id] ??= []);
      h.push(cur);
      if (h.length < 3) continue;
      const [a, m] = [h[h.length - 3], h[h.length - 2]];
      for (const n of J) {
        const d2 = len(add(sub(cur[n], scale(m[n], 2)), a[n]));
        if (d2 > worst) [worst, at] = [d2, `${pl.id} ${n} ${sim.t.toFixed(3)}`];
      }
    }
  }
  sim.dispose();
  return { worst, at };
}

// --------------------------------------------------------------------------------------------- required cases
describe('HC required natural-contact cases: audited articulated falls', () => {
  it('RH-F6-simultaneous: both players convert in one batch with every audit passing; no order dependence', async () => {
    const def = FIX('RH-F6-simultaneous');
    const a = await run(def);
    for (const pl of a.players) expectAudited(pl, def.id);
    const [r, d] = ['R', 'D'].map((id) => a.players.find((p) => p.id === id)!);
    expect(r.handoff!.step).toBe(d.handoff!.step);
    expect(a.players.every((p) => p.representation === 'ragdoll')).toBe(true);
    const b = await run(def, { reverseOrder: true });
    expect(handoffs(b)).toBe(handoffs(a));
    for (const pl of b.players) expectAudited(pl, `${def.id} reversed`);
    for (const s of [a, b]) s.dispose();
  });

  it('RH-F5-playerBelow: the upper falling player articulates without support on B; B carries within capacity', async () => {
    const def = FIX('RH-F5-playerBelow');
    const sim = await Simulation.create(def);
    const A = sim.players.find((p) => p.id === 'A')!;
    const B = sim.players.find((p) => p.id === 'B')!;
    let falseSupport = 0;
    let fallingSupported = 0;
    while (!sim.done) {
      sim.stepTick();
      await pace();
      // players are never ground: A's probe on B never gives A support
      if (!A.rag && A.sus && A.sus.probe.surface && A.sus.probe.surface !== 'turf' && A.sus.appliedN > 0) falseSupport++;
      for (const p of [A, B]) if (!p.rag && p.controlMode === 'falling' && p.sus && (p.sus.active || p.sus.appliedN !== 0)) fallingSupported++;
    }
    expect(falseSupport).toBe(0);
    expect(fallingSupported).toBe(0);
    expectAudited(A, def.id);
    expect(B.handoff).toBeNull();
    expect(B.controlMode).toBe('supported');
    sim.dispose();
  });

  it('L2-F14-oneArmFeet: the defender articulates at its support loss; the runner is already a ragdoll in its clearance', async () => {
    const def = FIX('L2-F14-oneArmFeet');
    const sim = await run(def);
    const R = sim.players.find((p) => p.id === 'R')!;
    const D = sim.players.find((p) => p.id === 'D')!;
    expectAudited(R, def.id);
    expectAudited(D, def.id);
    expect(D.handoff!.reason).toBe('lossOfSupport');
    expect(R.handoff!.step).toBeLessThan(D.handoff!.step);
    sim.dispose();
  });

  it('both falling (stack): B converted while A presses it down, then A lands on B as a ragdoll; every audit passes', async () => {
    for (const id of ['HC-F2-bothFall', 'HC-F2-bothFallL2']) {
      await breathe();
      const sim = await run(FIX(id));
      for (const pl of sim.players) expectAudited(pl, id);
      sim.dispose();
    }
  });

  it('first solved steps after acceptance: no penetration spike, anchor separation or launch impulse', async () => {
    for (const id of ['RH-F6-simultaneous', 'RH-F5-playerBelow', 'L2-F14-oneArmFeet', 'HC-F1-mirror', 'HC-F2-bothFall', 'HC-F3-mirror', 'L3-F4-twoArm', 'L3-F9-convert-contact', 'L3-F9-noProbe-contact', 'L3-F9-defenderRising', 'L3-F10-both', 'L3-F10-defender']) {
      await breathe();
      const post = await postSwitch(FIX(id));
      expect(Object.keys(post).length, id).toBeGreaterThan(0);
      for (const [pid, s] of Object.entries(post)) {
        expect(s.pen, `${id} ${pid} penetration`).toBeLessThanOrEqual(PEN_TOL + 0.005);
        expect(s.anchor, `${id} ${pid} anchor`).toBeLessThanOrEqual(5e-3);
        expect(s.extBW, `${id} ${pid} external impulse`).toBeLessThan(25);
      }
    }
  });

  it('the post-switch impulse check includes the very first solve', async () => {
    const post = await postSwitch(FIX('HC-F4-clear-falling'), 1);
    expect(post.R.extBW).toBeGreaterThan(1);
    expect(post.R.extBW).toBeLessThan(25);
  });
});

// --------------------------------------------------------------------------------------------- variants
describe('HC variants: mirrored, phase, height, stance and clear space', () => {
  it('mirrorZ reflects requests and starting conditions (an involution on a fixture without clip phases)', () => {
    const s = rhf6().find((d) => d.id === 'RH-F6-simultaneous')!;
    expect(JSON.stringify(mirrorZ(mirrorZ(s)))).toBe(JSON.stringify(s));
    const m = mirrorZ(s);
    for (const [p, q] of s.players.map((p, i) => [p, m.players[i]] as const)) {
      expect(q.initial.z).toBe(-p.initial.z);
      expect(q.initial.yawDeg).toBe(180 - p.initial.yawDeg);
      expect(q.arms?.mode).toEqual(p.arms ? { left: p.arms.mode.right, right: p.arms.mode.left } : undefined);
    }
  });

  it('every HC natural-contact variant, in both player orders: each fall that happens is an audited ragdoll; nobody ends as a rigid falling proxy', async () => {
    // plan 10c (C6, U7): the guarantee holds for either body order (reversed HC-F2-bothFallL2 rejected A as
    // externalPenetration before the convertible-pose guard: its shown thigh stood 8 cm in B's ragdoll forearm)
    const rows: string[] = [];
    for (const def of HC()) {
      if (def.id.startsWith('HC-F5')) continue;
      for (const reverseOrder of [false, true]) {
        await breathe();
        const sim = await run(def, { reverseOrder });
        const tag = `${def.id}${reverseOrder ? ' reversed' : ''}`;
        rows.push(`${tag.padEnd(29)} ${handoffs(sim)}`);
        for (const pl of sim.players) {
          if (pl.handoff) expectAudited(pl, tag);
          expect(pl.controlMode === 'falling' && !pl.rag, `${tag} ${pl.id} rigid falling proxy`).toBe(false);
        }
        sim.dispose();
      }
    }
    console.log(`[HC] handoffs per variant:\n  ${rows.join('\n  ')}`);
  });

  it('the convertible-pose guard is carried by the HC variants only; the base cases keep their historical profiles', () => {
    const guarded = allFixtures().filter((d) => d.ragdoll?.poseGuard).map((d) => d.id);
    expect(guarded.length).toBeGreaterThan(20);
    expect(guarded.every((id) => id.startsWith('HC-')), guarded.filter((id) => !id.startsWith('HC-')).join(' ')).toBe(true);
    expect(HC().filter((d) => d.ragdoll && !d.ragdoll.poseGuard).map((d) => d.id)).toEqual([]);
    for (const d of HC()) if (d.ragdoll) expect(d.ragdoll.id.endsWith(`+${POSE_GUARD_C6.id}`), d.id).toBe(true);
  });

  it('both sides, conversion phases and low stance of the simultaneous wrap: both players convert', async () => {
    for (const id of ['HC-F1-mirror', 'HC-F1-at0.9', 'HC-F1-at1.6', 'HC-F1-low', 'HC-F1-lowMirror']) {
      await breathe();
      const sim = await run(FIX(id));
      expect(sim.players.map((p) => p.handoff?.outcome), id).toEqual(['accepted', 'accepted']);
      sim.dispose();
    }
  });

  it('one-arm tackle from the other side, at other clip phases and on the rising / falling bob: every defender fall converts', async () => {
    for (const id of ['HC-F3-mirror', 'HC-F3-phase0', 'HC-F3-phase50', 'HC-F3-phase75', 'HC-F3-rising', 'HC-F3-falling']) {
      await breathe();
      const sim = await run(FIX(id));
      const D = sim.players.find((p) => p.id === 'D')!;
      if (D.controlMode === 'supported') expect(D.handoff, id).toBeNull();
      else expectAudited(D, id);
      expectAudited(sim.players.find((p) => p.id === 'R')!, id);
      sim.dispose();
    }
  });

  it('clear-space conversion on the adopted profile with planted feet stays audited (rising and falling bob)', async () => {
    for (const id of ['HC-F4-clear-rising', 'HC-F4-clear-falling']) {
      await breathe();
      const sim = await run(FIX(id));
      const R = sim.players[0];
      expectAudited(R, id);
      // the proxy's vertical velocity at the boundary is what transfers (non-zero on the bob)
      expect(Math.abs(R.handoff!.audit!.before.v[1]), id).toBeGreaterThan(0.05);
      sim.dispose();
    }
  });
});

// --------------------------------------------------------------------------------------------- diagnostics
describe('HC diagnostics: invalid candidates and strict transfer fail safely', () => {
  it('invalid candidate in a simultaneous batch: D rejected (jointAnchor), R revalidated against D\'s proxy and accepted', async () => {
    const def = FIX('HC-F5-invalidOne');
    const sim = await Simulation.create(def);
    const base = sim.counts();
    await runSim(sim);
    const R = sim.players.find((p) => p.id === 'R')!;
    const D = sim.players.find((p) => p.id === 'D')!;
    expect(D.handoff!.outcome).toBe('rejected');
    expect(D.handoff!.report.reasons).toContain('jointAnchor');
    expect(D.representation).toBe('proxy');
    expect(D.controlMode).toBe('falling');
    expect(D.sus!.active).toBe(false);
    expectAudited(R, def.id);
    expect(R.handoff!.step).toBe(D.handoff!.step);
    // no leaked candidate bodies or colliders: R's proxy replaced by its ten bodies (nine joints), D unchanged
    const c = sim.counts();
    expect(c.bodies).toBe(base.bodies - 1 + 10);
    expect(c.tags).toBe(c.colliders);
    sim.dispose();
  });

  it('strict transfer audit: transferFailed, invalidTransfer result, never a completion', async () => {
    const sim = await run(FIX('HC-F5-strictTransfer'));
    const failed = sim.players.filter((p) => p.handoff?.outcome === 'transferFailed');
    expect(failed.length).toBeGreaterThan(0);
    for (const p of failed) {
      expect(p.handoff!.accepted).toBe(false);
      expect(p.handoff!.audit!.reasons).toContain('energyGain');
    }
    expect(sim.result).toBe('invalidTransfer');
    expect(sim.ending).toBeNull();
    sim.dispose();
  });

  it('intentionally invalid noRescue conversions stay safe rejections', async () => {
    for (const id of ['RH-F5-noRescue', 'L2-F8-noRescue']) {
      await breathe();
      const sim = await run(FIX(id));
      const h = sim.players.find((p) => p.handoff)!.handoff!;
      expect(h.outcome, id).toBe('rejected');
      expect(h.report.reasons, id).toContain('jointAnchor');
      sim.dispose();
    }
  });
});

// --------------------------------------------------------------------------------------------- reproducibility
describe('HC reproducibility: reset, pause, render rates and batch ordering', () => {
  const CASES = ['RH-F6-simultaneous', 'L2-F14-oneArmFeet', 'HC-F2-bothFall', 'HC-F5-invalidOne'];
  it('fresh, reset, paused and 30 / 144 Hz runs give identical decisions, traces and counts', async () => {
    for (const id of CASES) {
      await breathe();
      const def = FIX(id);
      const ref = await run(def);
      const refEv = JSON.stringify(ref.events);
      const refCounts = ref.counts();
      const ids = def.players.map((p) => p.id);
      const check = (s: Simulation, tag: string) => {
        expect(handoffs(s), `${id} ${tag}`).toBe(handoffs(ref));
        expect(JSON.stringify(s.events), `${id} ${tag}`).toBe(refEv);
        expect(traceDiff(s.trace, ref.trace, ids).pos, `${id} ${tag}`).toBe(0);
        expect(s.counts(), `${id} ${tag}`).toEqual(refCounts);
      };
      // reset after a conversion, then run again
      const r = await Simulation.create(def);
      await stepWhile(r, () => !r.players.some((p) => p.rag));
      r.stepTick();
      await pace();
      r.reset();
      await runSim(r);
      check(r, 'reset');
      // render rates and pauses (fixed-step driver)
      for (const [hz, pauseEvery] of [
        [30, 0],
        [144, 0],
        [60, 7],
      ] as const) {
        await breathe();
        const s = await Simulation.create(def);
        const drv = new FixedStepDriver(def.solver.outerTickS, 8);
        let frame = 0;
        while (!s.done) {
          drv.paused = pauseEvery > 0 && frame % pauseEvery === 3;
          frame++;
          for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) {
            s.stepTick();
            await pace();
          }
        }
        check(s, `${hz} Hz${pauseEvery ? ' paused' : ''}`);
        s.dispose();
      }
      r.dispose();
      ref.dispose();
    }
  });

  it('reversed player order: batch decisions identical; natural-fall timing deviations recorded', async () => {
    // A batch decided at one substep (the diagnostic simultaneous conversions, the invalid one in a batch, clear-space)
    // must not depend on the player order. The solver's contact order follows the body order, so natural falls can move
    // (RH-F5-playerBelow: A at step 156 or 295; identical at the 07 checkpoint, the pose never feeds the solver): those
    // deviations are recorded, as in G4-F8.
    const batch = (id: string) => id.startsWith('HC-F1') || id.startsWith('HC-F4') || id === 'HC-F5-invalidOne' || id === 'RH-F6-simultaneous';
    const rows: string[] = [];
    for (const def of [FIX('RH-F6-simultaneous'), ...HC()]) {
      await breathe();
      const a = await run(def);
      const b = await run(def, { reverseOrder: true });
      if (batch(def.id)) expect(handoffs(b), def.id).toBe(handoffs(a));
      else if (handoffs(b) !== handoffs(a)) rows.push(`${def.id}: ${handoffs(a)} | reversed ${handoffs(b)}`);
      a.dispose();
      b.dispose();
    }
    console.log(`[HC] reversed-order deviations of natural falls:\n  ${rows.join('\n  ') || 'none'}`);
  });
});

// --------------------------------------------------------------------------------------------- continuity
describe('HC contact continuity of the published pose', () => {
  it('reach direction stays bounded through the minimum-reach band and its exit, then catches up', () => {
    const root = v3();
    const minReach = 0.23;
    const move = 6 / 240;
    let held = v3(0, -1, 0);
    let recovering = false;
    for (const radius of [0.18, 0.23, 0.29, 0.44, 0.50, ...Array(120).fill(0.65)]) {
      const prev = held;
      const wasRecovering = recovering;
      const r = stableReach(root, v3(0, radius, 0), held, minReach, move, recovering);
      const shown = norm(r.target);
      if (radius < 2 * minReach || wasRecovering) {
        const angle = Math.acos(Math.min(1, Math.max(-1, dot(prev, shown))));
        expect(angle * Math.max(radius, minReach)).toBeLessThanOrEqual(move + 1e-9);
      }
      expect(len(sub(r.held, shown))).toBeLessThan(1e-9);
      if (radius === 0.50) expect(r.limited).toBe(true);
      held = r.held;
      recovering = r.limited;
    }
    expect(recovering).toBe(false);
    expect(len(sub(held, v3(0, 1, 0)))).toBeLessThan(1e-9);
    // A target exactly at the hip keeps the shown direction at the flexion limit, rather than twoBone's fallback.
    const zero = stableReach(root, root, held, minReach, move);
    expect(len(sub(zero.target, v3(0, minReach, 0)))).toBeLessThan(1e-9);
  });

  it('HC-F2-offset: actual knee and ankle displacement stays bounded at each physics substep', async () => {
    const def = FIX('HC-F2-offset');
    const prev: Record<string, Vec3> = {};
    const dt = def.solver.outerTickS / def.solver.substeps;
    // Contact push-out (5 cm), ordinary departure and the fast direction correction, over one substep.
    const budget = 0.05 + (2.5 + 6) * dt;
    let worst = 0;
    const trace = (key: string, r: Record<string, unknown>): void => {
      if (key !== 'A:rightLeg') return;
      for (const n of ['knee', 'ankle']) {
        const p = r[n] as Vec3;
        if (prev[n]) worst = Math.max(worst, len(sub(p, prev[n])));
        prev[n] = p;
      }
    };
    const sim = await Simulation.create(def, { debug: { poseProbe: poseProbe({ trace }) } });
    try {
      await runSim(sim);
    } finally {
      sim.dispose();
    }
    expect(worst).toBeLessThanOrEqual(budget);
  });

  it('required cases: no limb jump over 0.15 m in one tick (was 0.66 m ankle / 0.61 m wrist / 0.26 m grip arm)', async () => {
    for (const [id, bound] of [
      ['RH-F5-playerBelow', 0.15],
      ['RH-F6-simultaneous', 0.15],
      // the repaired-support stack: A's ankle pushed by B's head while A lands (contact motion, 0.150 m)
      ['L2-F15-playerBelow', 0.2],
    ] as const) {
      await breathe();
      const r = await worstSnap(FIX(id));
      expect(r.worst, `${id} ${r.at}`).toBeLessThanOrEqual(bound);
    }
  });

  it('every HC variant: no limb jump over 0.3 m in one tick', async () => {
    // plan 12 known case (docs/handoff/plan12.md): D, left a rigid falling proxy by its intentionally invalid conversion,
    // clamps R with its right forearm. At 2.10 s every arm-task pole but one puts the arm 0.6-13 cm into R, and the one
    // clear pole has the elbow 0.50 m away (the twin's arm, on another path since the shoulder range, never gets there).
    // Bounded here, not let go
    const known: Record<string, number> = { 'HC-F5-invalidOne': 0.5 };
    for (const def of HC()) {
      await breathe();
      const r = await worstSnap(def);
      expect(r.worst, `${def.id} ${r.at}`).toBeLessThanOrEqual(known[def.id] ?? 0.3);
    }
  });

  it('the continuity guard never advances more than 2 cm past the rate-limited step in the required cases', async () => {
    for (const id of ['RH-F5-playerBelow', 'RH-F6-simultaneous', 'L2-F14-oneArmFeet']) {
      await breathe();
      let worst = 0;
      let at = '';
      const probe = poseProbe({
        on: true,
        trace: (k, r) => {
          const c = r.cont as { a0: number; al: number; dd: number } | null;
          if (c && c.al > c.a0) {
            const adv = (c.al - c.a0) * c.dd;
            if (adv > worst) [worst, at] = [adv, `${k} ${sim.t.toFixed(3)}`];
          }
        },
      });
      const sim = await Simulation.create(FIX(id), { debug: { poseProbe: probe } });
      await runSim(sim);
      expect(worst, `${id} ${at}`).toBeLessThanOrEqual(0.02);
      sim.dispose();
    }
  });
});
