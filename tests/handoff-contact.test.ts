// Plan 07a (HC): ragdoll handoff during player contact. The required natural-contact cases (RH-F6-simultaneous,
// RH-F5-playerBelow, L2-F14-oneArmFeet) become audited articulated falls under the unchanged boundary checks; the HC
// variants (mirrored, conversion phase, bob phase, drop height, low stance, both falling, clear space) hold the same;
// deliberately invalid candidates and strict transfer audits still fail safely; batch decisions are independent of
// player order and reproducible over reset, pause and render rates; the published poses stay continuous in contact.
//
// Plan 13b: each (fixture, player order) is simulated once for the whole file (`hcRun`) with every observer that reads
// it attached (the first solved steps after each accepted switch, the worst limb snap, RH-F5's support counters, the
// engine counts before the first tick); the checks read the finished runs. A table checks every row and lists each
// failing row. The reproducibility test and the pose-probe tests keep their own runs.
import { afterAll, describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { mirrorZ } from '../src/sim/fixtures/handoff-contact';
import { rhf6 } from '../src/sim/fixtures/ride-height';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import type { FixtureDef } from '../src/sim/fixture';
import { poseProbe } from '../src/sim/debug';
import { stableReach } from '../src/sim/pose';
import { anchorErrors, bulkOf, SEGMENTS } from '../src/sim/ragdoll';
import { POSE_GUARD_C6, withoutBornOverlap } from '../src/sim/profiles';
import { add, dot, len, norm, qConj, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { breathe, create, FIX, metArmStayed, pace, preBornSeparation, preWrap, rows, run, runSim, stepWhile, traceDiff, unflipped } from './helpers';
import { heldBornBar, limbAndTrunk, limbInBody, LIMB_DEEP_M, LIMB_HELD_M, LIMB_HELD_S } from './visible-bar';

const HC = (): FixtureDef[] => allFixtures().filter((d) => d.id.startsWith('HC-'));
/** Unchanged boundary tolerances (RagdollProfile validation): landmark 0.01 m, new external penetration 0.015 m. */
const LANDMARK_TOL = 0.01;
const PEN_TOL = 0.015;

/**
 * Ladder 15 (CLAUDE.md rule 6): a conversion the simulation accepted blocks a step only with a visible pass-through; the
 * candidate's anchor, landmark, new external and floor depths against the boundary tolerances (5 mm, 1 cm, 1.5 cm,
 * 1.5 cm) are printed per family (afterAll). The frozen families (G, L1, L2, RH) keep those assertions: their runs never
 * change. Ladder 18: the pass-through is the visible bar after the conversion (`heldBornBar`: a limb in another player's
 * trunk or head over 5 cm for 0.10 s, or over 10 cm at all, while their pair is held out of the solve), not the
 * candidate's depth when born (ladder 15's rule, a limb more than TORSO_M in a core: since ladder 17 such a limb is born
 * held out of the solve, and since 18c pushed out, HC-F1-at1.6's upper arm from 7.3 cm born in about 0.05 s). TORSO_M
 * stays the bound of the first solved steps' contacts (a pair in the solve).
 */
const TORSO_M = 0.05;
const FROZEN = /^(G|L1|L2|RH)-/;
const isLimb = (seg: string): boolean => seg !== 'core' && seg !== 'head';
/** A penetration record's two segments (`own` is `segment:region`, `other` is `player:segment:region`) are a limb and a torso. */
const limbAndTorso = (own: string, other: string): boolean => {
  const a = own.split(':')[0];
  const b = other.split(':')[1] ?? '';
  return (isLimb(a) && b === 'core') || (a === 'core' && isLimb(b));
};
/** Ladder 18: each player's held-born-pair tracker of its `hcRun` (`heldBornBar`), for `expectAudited`. */
const BORN_BAR = new WeakMap<PlayerRuntime, () => ReturnType<typeof limbInBody> | undefined>();
/** The fine measures of every accepted handoff, by family (printed). */
const FINE = new Map<string, { n: number; anchor: number; landmark: number; pen: number; floor: number; held: number; heldAt: string }>();
afterAll(() => {
  if (FINE.size)
    console.log(
      `accepted handoffs (ladder 15 meter; tolerances anchor 5 mm, landmark ${LANDMARK_TOL * 100} cm, new external and floor ${PEN_TOL * 100} cm; ladder 18, a held limb in a trunk or head after a solve): ${[...FINE]
        .map(([f, m]) => `${f} ${m.n}: anchor ${(m.anchor * 1000).toFixed(2)} mm, landmark ${(m.landmark * 100).toFixed(2)} cm, new external ${(m.pen * 100).toFixed(2)} cm, floor ${(m.floor * 100).toFixed(2)} cm, held ${(m.held * 100).toFixed(2)} cm${m.heldAt ? ` (${m.heldAt})` : ''}`)
        .join('; ')}`,
    );
});

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
  if (FROZEN.test(fx)) {
    expect(r.maxAnchorErrM, tag).toBeLessThanOrEqual(5e-3);
    expect(r.maxLandmarkErrM, tag).toBeLessThanOrEqual(LANDMARK_TOL);
    expect(r.maxNewExternalPenetrationM, tag).toBeLessThanOrEqual(PEN_TOL);
    expect(r.floorPenetrationM, tag).toBeLessThanOrEqual(PEN_TOL);
  } else {
    const fam = fx.split('-')[0];
    const bar = BORN_BAR.get(pl)?.();
    expect(bar, `${tag}: a run of hcRun`).toBeTruthy();
    const deep = bar!.deepest();
    const m = FINE.get(fam) ?? { n: 0, anchor: 0, landmark: 0, pen: 0, floor: 0, held: 0, heldAt: '' };
    const [held, heldAt] = deep.d > m.held ? [deep.d, deep.at] : [m.held, m.heldAt];
    FINE.set(fam, { n: m.n + 1, anchor: Math.max(m.anchor, r.maxAnchorErrM), landmark: Math.max(m.landmark, r.maxLandmarkErrM), pen: Math.max(m.pen, r.maxNewExternalPenetrationM), floor: Math.max(m.floor, r.floorPenetrationM), held, heldAt });
    expect(bar!.breaches(), tag).toEqual([]);
  }
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

type PostSwitch = Record<string, { pen: number; torso: number; anchor: number; extBW: number }>;

/**
 * Per substep after each accepted switch (first n substeps): player penetration, joint anchor separation, and the
 * external impulse on the assembly (dP - m g dt, body weights). Validating only the disabled candidate is not enough.
 * Attached to `sim` before its first tick; the result is read once the run has finished.
 */
function postSwitch(sim: Simulation, def: FixtureDef, n = 24): () => PostSwitch {
  const S = sim as unknown as { stepSubstep: (i: number) => void; physics: { dt: number } };
  const g = Math.abs(def.solver.gravityY);
  const out: Record<string, { pen: number; torso: number; anchor: number; extBW: number; step0: number; prevP: Vec3 }> = {};
  const orig = S.stepSubstep.bind(sim);
  S.stepSubstep = (i: number) => {
    orig(i);
    for (const pl of sim.players) {
      const h = pl.handoff;
      if (!pl.rag || !h || h.outcome !== 'accepted') continue;
      const r = (out[pl.id] ??= { pen: 0, torso: 0, anchor: 0, extBW: 0, step0: h.step, prevP: vecOf(h.audit!.after.P) });
      if (sim.steps - r.step0 > n) continue;
      const bodies = SEGMENTS.map((s) => pl.rag!.bodies[s]);
      const m = bodies.reduce((a, b) => a + b.mass(), 0);
      for (const c of sim.contacts) {
        if (c.a.playerId !== pl.id && c.b.playerId !== pl.id) continue;
        const o = c.a.playerId === pl.id ? c.b : c.a;
        if (o.playerId === null || o.playerId === pl.id) continue;
        for (const p of c.points) r.pen = Math.max(r.pen, -p.dist);
        // ladder 15: a limb in the other player's torso, or the other's limb in this one's
        if (limbAndTorso(c.a.part, `:${c.b.part}`)) for (const p of c.points) r.torso = Math.max(r.torso, -p.dist);
      }
      r.anchor = Math.max(r.anchor, ...Object.values(anchorErrors(pl.rag)));
      const b = bulkOf(bodies);
      r.extBW = Math.max(r.extBW, len(add(sub(b.P, r.prevP), { x: 0, y: m * g * S.physics.dt, z: 0 })) / S.physics.dt / (m * g));
      r.prevP = b.P;
    }
  };
  return () => Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { pen: v.pen, torso: v.torso, anchor: v.anchor, extBW: v.extBW }]));
}

/** Worst body-local one-tick second difference of the shown knee/ankle/elbow/wrist while each player is a proxy. */
function worstSnap(): { tick: (sim: Simulation) => void; result: () => { worst: number; at: string } } {
  const J = ['leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle', 'leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'];
  const hist: Record<string, Record<string, Vec3>[]> = {};
  let worst = 0;
  let at = '';
  const tick = (sim: Simulation): void => {
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
  };
  return { tick, result: () => ({ worst, at }) };
}

/** RH-F5-playerBelow, per tick: A's support from a player probe, and support while a player falls as a proxy. */
function supportCounters(sim: Simulation): { tick: () => void; result: () => { falseSupport: number; fallingSupported: number } } {
  const A = sim.players.find((p) => p.id === 'A')!;
  const B = sim.players.find((p) => p.id === 'B')!;
  let falseSupport = 0;
  let fallingSupported = 0;
  const tick = (): void => {
    // players are never ground: A's probe on B never gives A support
    if (!A.rag && A.sus && A.sus.probe.surface && A.sus.probe.surface !== 'turf' && A.sus.appliedN > 0) falseSupport++;
    for (const p of [A, B]) if (!p.rag && p.controlMode === 'falling' && p.sus && (p.sus.active || p.sus.appliedN !== 0)) fallingSupported++;
  };
  return { tick, result: () => ({ falseSupport, fallingSupported }) };
}

/** The required cases checked over the first solved steps after acceptance (24 substeps). */
/** Plan 13e: the substep after A's acceptance at which HC-F2-bothFall's A first touches B again, and A's part that does
 * (pinned below; 18 at 13e, 19 under the plan 13f leg guard, the right upper arm; 17 under the visible flip, the right
 * forearm; 18 with own-leg contact, ladder 9). */
const HC_F2_IMPACT = { k: 18, part: 'rightForearm' } as const;
const HC_F2_IMPACT_K = HC_F2_IMPACT.k;
const POST_SWITCH = ['RH-F6-simultaneous', 'RH-F5-playerBelow', 'L2-F14-oneArmFeet', 'HC-F1-mirror', 'HC-F2-bothFall', 'HC-F3-mirror', 'L3-F4-twoArm', 'L3-F9-convert-contact', 'L3-F9-noProbe-contact', 'L3-F9-defenderRising', 'L3-F10-both', 'L3-F10-defender'];
/**
 * Substeps observed after acceptance, per fixture: 24, or only the very first solve for HC-F2-lift1.4 (plan 13e: before,
 * HC-F4-clear-falling, whose falling feet now leave the turf on the L3 planner, so its first solve has no impulse; plan
 * 13f: HC-F3-rising, whose defender converts out of contact under the leg guard; plan 14: HC-F3-phase75, whose
 * defender converts out of contact once the clip arms swing as the clip shows them).
 * Plan 13e (user ruling): HC-F2-bothFall's window ends at A's first new contact (pinned below): on the L3 locomotion A's
 * falling right upper arm meets B's head, a fall impact, not the switch. Plan 13f: the window is the substeps before
 * that contact, 18 (at 13e the contact substep, +18, was itself clean and the impact came on the next solve; under the
 * leg guard the contact comes at +19 and its own solve takes the impact; 16 under the visible flip, contact at +17; 17
 * with own-leg contact, contact at +18).
 */
const POST_N: Record<string, number> = { ...Object.fromEntries(POST_SWITCH.map((id) => [id, 24])), 'HC-F2-lift1.4': 1, 'HC-F2-bothFall': HC_F2_IMPACT_K - 1 };
/** Limb-snap bounds of the required cases (the HC variants: 0.3 m, or a known case's bound). */
const SNAP_REQUIRED: [string, number][] = [
  ['RH-F5-playerBelow', 0.15],
  ['RH-F6-simultaneous', 0.15],
  // the repaired-support stack: A's ankle pushed by B's head while A lands (contact motion, 0.150 m)
  ['L2-F15-playerBelow', 0.2],
];

interface HcRun {
  sim: Simulation;
  /** Engine counts before the first tick. */
  base: ReturnType<Simulation['counts']>;
  post: PostSwitch | null;
  snap: { worst: number; at: string } | null;
  support: { falseSupport: number; fallingSupported: number } | null;
}
const RUNS = new Map<string, { json: string; run: Promise<HcRun> }>();
/** The finished run of `def` in the given player order, simulated once per file; every observer only reads. */
function hcRun(def: FixtureDef, reverseOrder = false): Promise<HcRun> {
  const key = `${def.id}|${reverseOrder}`;
  const json = JSON.stringify(def);
  const hit = RUNS.get(key);
  if (hit) {
    if (hit.json !== json) throw new Error(`hcRun: ${def.id} requested with another definition`);
    return hit.run;
  }
  const p = (async (): Promise<HcRun> => {
    const bar = heldBornBar();
    const sim = await create(def, { ...(reverseOrder ? { reverseOrder } : {}), onSubstep: bar.substep });
    for (const pl of sim.players) BORN_BAR.set(pl, () => bar.of(pl.id));
    const base = sim.counts();
    const n = reverseOrder ? undefined : POST_N[def.id];
    const post = n === undefined ? null : postSwitch(sim, def, n);
    const snap = !reverseOrder && (def.id.startsWith('HC-') || SNAP_REQUIRED.some(([id]) => id === def.id)) ? worstSnap() : null;
    const support = !reverseOrder && def.id === 'RH-F5-playerBelow' ? supportCounters(sim) : null;
    while (!sim.done) {
      sim.stepTick();
      await pace();
      snap?.tick(sim);
      support?.tick();
    }
    return { sim, base, post: post?.() ?? null, snap: snap?.result() ?? null, support: support?.result() ?? null };
  })();
  RUNS.set(key, { json, run: p });
  return p;
}
afterAll(async () => {
  for (const { run: p } of RUNS.values()) (await p).sim.dispose();
  RUNS.clear();
});

// --------------------------------------------------------------------------------------------- required cases
describe('HC required natural-contact cases: audited articulated falls', () => {
  it('RH-F6-simultaneous, RH-F5-playerBelow, L2-F14-oneArmFeet and the both-falling stacks: audited articulated falls, every row', async () => {
    const CHECKS: [string, () => Promise<void>][] = [
      [
        'RH-F6-simultaneous: both players convert in one batch with every audit passing; no order dependence',
        async () => {
          const def = FIX('RH-F6-simultaneous');
          const a = (await hcRun(def)).sim;
          for (const pl of a.players) expectAudited(pl, def.id);
          const [r, d] = ['R', 'D'].map((id) => a.players.find((p) => p.id === id)!);
          expect(r.handoff!.step).toBe(d.handoff!.step);
          expect(a.players.every((p) => p.representation === 'ragdoll')).toBe(true);
          const b = (await hcRun(def, true)).sim;
          expect(handoffs(b)).toBe(handoffs(a));
          for (const pl of b.players) expectAudited(pl, `${def.id} reversed`);
        },
      ],
      [
        'RH-F5-playerBelow: the upper falling player articulates without support on B; B carries within capacity',
        async () => {
          const def = FIX('RH-F5-playerBelow');
          const o = await hcRun(def);
          const sim = o.sim;
          const A = sim.players.find((p) => p.id === 'A')!;
          const B = sim.players.find((p) => p.id === 'B')!;
          const { falseSupport, fallingSupported } = o.support!;
          expect(falseSupport).toBe(0);
          expect(fallingSupported).toBe(0);
          expectAudited(A, def.id);
          expect(B.handoff).toBeNull();
          expect(B.controlMode).toBe('supported');
        },
      ],
      [
        'L2-F14-oneArmFeet: the defender articulates at its support loss; the runner is already a ragdoll in its clearance',
        async () => {
          const def = FIX('L2-F14-oneArmFeet');
          const sim = (await hcRun(def)).sim;
          const R = sim.players.find((p) => p.id === 'R')!;
          const D = sim.players.find((p) => p.id === 'D')!;
          expectAudited(R, def.id);
          expectAudited(D, def.id);
          expect(D.handoff!.reason).toBe('lossOfSupport');
          expect(R.handoff!.step).toBeLessThan(D.handoff!.step);
        },
      ],
      ...['HC-F2-bothFall', 'HC-F2-bothFallL2'].map((id): [string, () => Promise<void>] => [
        `both falling (stack), ${id}: B converted while A presses it down, then A lands on B as a ragdoll; every audit passes`,
        async () => {
          const sim = (await hcRun(FIX(id))).sim;
          for (const pl of sim.players) expectAudited(pl, id);
        },
      ]),
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });

  it('first solved steps after acceptance: no penetration spike, anchor separation or launch impulse, on every required, HC and L3 contact case listed', async () => {
    const said: string[] = [];
    await rows(POST_SWITCH, (id) => id, async (id) => {
      const post = (await hcRun(FIX(id))).post!;
      expect(Object.keys(post).length, id).toBeGreaterThan(0);
      for (const [pid, s] of Object.entries(post)) {
        if (FROZEN.test(id)) {
          expect(s.pen, `${id} ${pid} penetration`).toBeLessThanOrEqual(PEN_TOL + 0.005);
          expect(s.anchor, `${id} ${pid} anchor`).toBeLessThanOrEqual(5e-3);
        } else {
          // ladder 15: a limb through a torso blocks (TORSO_M); the penetration (was PEN_TOL + 5 mm) and the anchor (was
          // 5 mm) are printed
          said.push(`${id} ${pid} ${(s.pen * 100).toFixed(2)} cm, anchor ${(s.anchor * 1000).toFixed(2)} mm`);
          expect(s.torso, `${id} ${pid} a limb through a torso`).toBeLessThanOrEqual(TORSO_M);
        }
        expect(s.extBW, `${id} ${pid} external impulse`).toBeLessThan(25);
      }
    });
    console.log(`first solved steps after acceptance (ladder 15 meter): ${said.join('; ')}`);
  });

  it('ladder 18, constructed: a held limb over 5 cm in another player\'s trunk or head for 0.10 s after the conversion, or over 10 cm at all, fails the accepted-conversion rule, either way round; 0.095 s, 4.9 cm, a limb in a limb or a trunk in a trunk does not', () => {
    // the rule's fault twin on samples the test makes (the rule reads each held pair's depth after each solve)
    const dt = 1 / 240;
    const fed = (depthM: number, s: number): string[] => {
      const b = limbInBody();
      for (let t = 0; t < s - 1e-9; t += dt) b.sample('k', t, dt, depthM, false, `t ${t.toFixed(4)}`);
      return b.breaches();
    };
    expect(fed(LIMB_HELD_M + 0.001, LIMB_HELD_S + dt)).toHaveLength(1);
    expect(fed(LIMB_HELD_M + 0.001, LIMB_HELD_S - 2 * dt)).toEqual([]);
    expect(fed(LIMB_HELD_M - 0.001, 1)).toEqual([]);
    expect(fed(LIMB_DEEP_M + 0.001, dt)).toHaveLength(1);
    expect(limbAndTrunk('leftForearm:forearm', 'D:core:torso')).toBe(true);
    expect(limbAndTrunk('leftUpperArm:upperArm', 'D:torso')).toBe(true);
    expect(limbAndTrunk('rightForearm:forearm', 'B:head')).toBe(true);
    expect(limbAndTrunk('core:torso', 'D:rightThigh:thigh')).toBe(true);
    expect(limbAndTrunk('leftThigh:thigh', 'R:rightShin:shin')).toBe(false);
    expect(limbAndTrunk('core:torso', 'D:core:torso')).toBe(false);
    // and the contact form the first solved steps read (part against part)
    expect(limbAndTorso('rightUpperArm', ':core')).toBe(true);
    expect(limbAndTorso('core', ':leftShin')).toBe(true);
    expect(limbAndTorso('core', ':core')).toBe(false);
  });

  it('ladder 18, the rule\'s twin on a run: HC-F1-at1.6 reversed under the met-arm flip, R converted with his left upper arm 8 cm in D\'s torso; left to part (V1, the born pairs held, not pushed) the arm stays over 5 cm in D for over 0.4 s and fails the rule; pushed apart (V2, the registered born overlap) it passes', async () => {
    const said: string[] = [];
    // (contact motion M3: a natural sample, before the wrap flip: under it R converts with that arm 4 cm in D)
    const at16 = preWrap(FIX('HC-F1-at1.6'));
    for (const [def, fails] of [[metArmStayed(preBornSeparation(at16)), true], [metArmStayed(at16), false]] as const) {
      const bar = heldBornBar();
      const sim = await runSim(await create(def, { reverseOrder: true, onSubstep: bar.substep }));
      const R = sim.players.find((p) => p.id === 'R')!;
      const tag = `${def.ragdoll!.bornOverlap!.id}`;
      expect(R.handoff!.outcome, tag).toBe('accepted');
      expect(R.handoff!.report.worstExternal!.newDepthM, tag).toBeGreaterThan(0.07);
      const br = bar.of('R')!.breaches();
      said.push(`${tag}: deepest ${(bar.of('R')!.deepest().d * 100).toFixed(2)} cm, ${br.length ? br.join('; ') : 'no breach'}`);
      if (fails) expect(br.some((b) => /for 0\.(4|5|6|7)\d+ s/.test(b)), `${tag} ${br.join('; ')}`).toBe(true);
      else expect(br, tag).toEqual([]);
      sim.dispose();
    }
    console.log(`ladder 18 held born pair, HC-F1-at1.6 reversed under the met-arm flip: ${said.join(' | ')}`);
  }, 120000);

  it('HC-F2-bothFall: the post-switch window ends where A first touches B again, its right arm closing on B\'s head', async () => {
    // plan 13e (user ruling): A's switch is clean until its first new contact with B (checked above). Plan 13f: at +19
    // its right upper arm comes into contact with B's head, closing on it at 3.6 m/s along the contact normal before
    // that solve, which takes the impact (5.4 mm at the elbow, 13.1 body weights; through +18: 0.66 mm, 3.7). Pinned
    // here, so the window is re-measured when the fall changes. Re-measured at the visible flip (ladder 8l): its right
    // forearm meets B's head first, at +17, closing at 3.65 m/s (the hip stops, PGS and the knee stop each move it:
    // +15, +18 and +20 with one of them off). Re-measured at own-leg contact (ladder 9): the right forearm first at +18,
    // closing at 3.66 m/s
    const sim = await create(FIX('HC-F2-bothFall'));
    const S = sim as unknown as { stepSubstep: (i: number) => void };
    const orig = S.stepSubstep.bind(sim);
    const firstWith: Record<string, number> = {};
    let closing = 0;
    let step0 = -1;
    // the arm's velocity relative to the head before this substep's solve
    let rel: Vec3 | null = null;
    S.stepSubstep = (i: number) => {
      orig(i);
      const A = sim.byId.get('A')!;
      const B = sim.byId.get('B')!;
      if (!A.rag || A.handoff?.outcome !== 'accepted' || !B.rag) return;
      const before = rel;
      rel = sub(A.rag.bodies[HC_F2_IMPACT.part].linvel(), B.rag.bodies.head.linvel());
      if (step0 < 0) step0 = A.handoff.step;
      const k = sim.steps - step0;
      if (k > 24) return;
      for (const c of sim.contacts)
        for (const [m, o, n] of [[c.a, c.b, c.normalAB], [c.b, c.a, scale(c.normalAB, -1)]] as const) {
          if (m.playerId !== 'A' || o.playerId !== 'B') continue;
          const pair = `${m.part}:${m.side ?? ''}>${o.part}`;
          firstWith[pair] ??= k;
          // closing speed along the contact normal (from A's part to B's)
          if (k === HC_F2_IMPACT_K && pair === `${HC_F2_IMPACT.part}:right>head` && before) closing = dot(before, n);
        }
    };
    while (!sim.done) sim.stepTick();
    sim.dispose();
    const late = Object.entries(firstWith).filter(([, k]) => k > 1);
    expect(late.map(([pair, k]) => `${pair} +${k}`)).toEqual([`${HC_F2_IMPACT.part}:right>head +${HC_F2_IMPACT_K}`]);
    expect(closing).toBeGreaterThan(2);
  });

  it('the post-switch impulse check includes the very first solve', async () => {
    // HC-F2-lift1.4's B converts as A lands on it: its first solve takes A's load (1.76 body weights)
    const post = (await hcRun(FIX('HC-F2-lift1.4'))).post!;
    expect(post.B.extBW).toBeGreaterThan(1);
    expect(post.B.extBW).toBeLessThan(25);
  });
});

// --------------------------------------------------------------------------------------------- variants
describe('HC variants: mirrored, phase, height, stance and clear space', () => {
  it('mirrorZ is an involution that reflects requests and starting conditions; only the HC variants carry the convertible-pose guard, every row', async () => {
    const CHECKS: [string, () => void][] = [
      [
        'mirrorZ reflects requests and starting conditions (an involution on a fixture without clip phases)',
        () => {
          const s = rhf6().find((d) => d.id === 'RH-F6-simultaneous')!;
          expect(JSON.stringify(mirrorZ(mirrorZ(s)))).toBe(JSON.stringify(s));
          const m = mirrorZ(s);
          for (const [p, q] of s.players.map((p, i) => [p, m.players[i]] as const)) {
            expect(q.initial.z).toBe(-p.initial.z);
            expect(q.initial.yawDeg).toBe(180 - p.initial.yawDeg);
            expect(q.arms?.mode).toEqual(p.arms ? { left: p.arms.mode.right, right: p.arms.mode.left } : undefined);
          }
        },
      ],
      [
        'the convertible-pose guard is carried by the HC variants and (contact motion M1) the L3 and L4 fixtures only; the base cases keep their historical profiles',
        () => {
          const ON = (d: FixtureDef) => d.milestone === 'HC' || d.milestone === 'L3' || d.milestone === 'L4';
          const guarded = allFixtures().filter((d) => d.ragdoll?.poseGuard);
          expect(guarded.length).toBeGreaterThan(20);
          expect(guarded.filter((d) => !ON(d)).map((d) => d.id)).toEqual([]);
          expect(allFixtures().filter((d) => ON(d) && d.ragdoll && !d.ragdoll.poseGuard).map((d) => d.id)).toEqual([]);
          // (the profile before the visible and born-overlap flips, which add their parts after the guard)
          for (const d of HC()) if (d.ragdoll) expect(unflipped(withoutBornOverlap(d.ragdoll)).id.endsWith(`+${POSE_GUARD_C6.id}`), d.id).toBe(true);
        },
      ],
    ];
    await rows(CHECKS, ([n]) => n, ([, f]) => f());
  });

  it('every HC natural-contact variant, in both player orders: each fall that happens is an audited ragdoll; nobody ends as a rigid falling proxy', async () => {
    // plan 10c (C6, U7): the guarantee holds for either body order (reversed HC-F2-bothFallL2 rejected A as
    // externalPenetration before the convertible-pose guard: its shown thigh stood 8 cm in B's ragdoll forearm)
    const lines: string[] = [];
    const cases = HC()
      .filter((def) => !def.id.startsWith('HC-F5'))
      .flatMap((def) => [false, true].map((reverseOrder) => ({ def, reverseOrder })));
    await rows(
      cases,
      ({ def, reverseOrder }) => `${def.id}${reverseOrder ? ' reversed' : ''}`,
      async ({ def, reverseOrder }) => {
        const sim = (await hcRun(def, reverseOrder)).sim;
        const tag = `${def.id}${reverseOrder ? ' reversed' : ''}`;
        lines.push(`${tag.padEnd(29)} ${handoffs(sim)}`);
        for (const pl of sim.players) {
          // plan 14: the 13f known limit (HC-F3-falling D rejected, 1.68 cm) is gone: with the clip arm's elbow shown
          // where the clip puts it, the defender converts and is checked as audited like every other variant
          if (pl.handoff) expectAudited(pl, tag);
          expect(pl.controlMode === 'falling' && !pl.rag, `${tag} ${pl.id} rigid falling proxy`).toBe(false);
        }
      },
    );
    console.log(`[HC] handoffs per variant:\n  ${lines.join('\n  ')}`);
  });

  it('the simultaneous wrap, the one-arm tackle and clear space convert as each family requires, on every variant of each', async () => {
    const FAMILIES: [string, string[], (id: string) => Promise<void>][] = [
      [
        'both sides, conversion phases and low stance of the simultaneous wrap: both players convert',
        ['HC-F1-mirror', 'HC-F1-at0.9', 'HC-F1-at1.6', 'HC-F1-low', 'HC-F1-lowMirror'],
        async (id) => {
          const sim = (await hcRun(FIX(id))).sim;
          expect(sim.players.map((p) => p.handoff?.outcome), id).toEqual(['accepted', 'accepted']);
        },
      ],
      [
        'one-arm tackle from the other side, at other clip phases and on the rising / falling bob: every defender fall converts',
        ['HC-F3-mirror', 'HC-F3-phase0', 'HC-F3-phase50', 'HC-F3-phase75', 'HC-F3-rising', 'HC-F3-falling'],
        async (id) => {
          const sim = (await hcRun(FIX(id))).sim;
          const D = sim.players.find((p) => p.id === 'D')!;
          if (D.controlMode === 'supported') expect(D.handoff, id).toBeNull();
          else expectAudited(D, id);
          expectAudited(sim.players.find((p) => p.id === 'R')!, id);
        },
      ],
      [
        'clear-space conversion on the adopted profile with planted feet stays audited (rising and falling bob)',
        ['HC-F4-clear-rising', 'HC-F4-clear-falling'],
        async (id) => {
          const sim = (await hcRun(FIX(id))).sim;
          const R = sim.players[0];
          expectAudited(R, id);
          // the proxy's vertical velocity at the boundary is what transfers (non-zero on the bob)
          expect(Math.abs(R.handoff!.audit!.before.v[1]), id).toBeGreaterThan(0.05);
        },
      ],
    ];
    const cases = FAMILIES.flatMap(([name, ids, check]) => ids.map((id) => ({ name, id, check })));
    await rows(cases, ({ name, id }) => `${id}: ${name}`, ({ id, check }) => check(id));
  });
});

// --------------------------------------------------------------------------------------------- diagnostics
describe('HC diagnostics: invalid candidates and strict transfer fail safely', () => {
  it('invalid candidate in a simultaneous batch: D rejected (jointAnchor), R revalidated against D\'s proxy and accepted', async () => {
    const def = FIX('HC-F5-invalidOne');
    const o = await hcRun(def);
    const sim = o.sim;
    const base = o.base;
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
  });

  it('strict transfer audit: transferFailed, invalidTransfer result, never a completion', async () => {
    const sim = (await hcRun(FIX('HC-F5-strictTransfer'))).sim;
    const failed = sim.players.filter((p) => p.handoff?.outcome === 'transferFailed');
    expect(failed.length).toBeGreaterThan(0);
    for (const p of failed) {
      expect(p.handoff!.accepted).toBe(false);
      expect(p.handoff!.audit!.reasons).toContain('energyGain');
    }
    expect(sim.result).toBe('invalidTransfer');
    expect(sim.ending).toBeNull();
  });

  it('intentionally invalid noRescue conversions stay safe rejections', async () => {
    for (const id of ['RH-F5-noRescue', 'L2-F8-noRescue']) {
      await breathe();
      const sim = (await hcRun(FIX(id))).sim;
      const h = sim.players.find((p) => p.handoff)!.handoff!;
      expect(h.outcome, id).toBe('rejected');
      expect(h.report.reasons, id).toContain('jointAnchor');
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
});

describe('HC player order: batch decisions and natural-fall timing', () => {
  it('reversed player order: batch decisions identical; natural-fall timing deviations recorded', async () => {
    // A batch decided at one substep (the diagnostic simultaneous conversions, the invalid one in a batch, clear-space)
    // must not depend on the player order. The solver's contact order follows the body order, so natural falls can move
    // (RH-F5-playerBelow: A at step 156 or 295; identical at the 07 checkpoint, the pose never feeds the solver): those
    // deviations are recorded, as in G4-F8.
    const batch = (id: string) => id.startsWith('HC-F1') || id.startsWith('HC-F4') || id === 'HC-F5-invalidOne' || id === 'RH-F6-simultaneous';
    const lines: string[] = [];
    await rows([FIX('RH-F6-simultaneous'), ...HC()], (def) => def.id, async (def) => {
      const a = (await hcRun(def)).sim;
      const b = (await hcRun(def, true)).sim;
      if (batch(def.id)) expect(handoffs(b), def.id).toBe(handoffs(a));
      else if (handoffs(b) !== handoffs(a)) lines.push(`${def.id}: ${handoffs(a)} | reversed ${handoffs(b)}`);
    });
    console.log(`[HC] reversed-order deviations of natural falls:\n  ${lines.join('\n  ') || 'none'}`);
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

  it('no limb jump in one tick over 0.15 m in the required cases (was 0.66 m ankle / 0.61 m wrist / 0.26 m grip arm) or over 0.3 m in every HC variant, every row', async () => {
    const CASES: { name: string; id: string; check: (r: { worst: number; at: string }) => void }[] = [
      ...SNAP_REQUIRED.map(([id, bound]) => ({
        name: 'required cases: no limb jump over 0.15 m in one tick (was 0.66 m ankle / 0.61 m wrist / 0.26 m grip arm)',
        id,
        check: (r: { worst: number; at: string }) => expect(r.worst, `${id} ${r.at}`).toBeLessThanOrEqual(bound),
      })),
      // plan 12 known case (docs/handoff/plan12.md): D, left a rigid falling proxy by its intentionally invalid conversion,
      // clamps R with its right forearm. At 2.10 s every arm-task pole but one puts the arm 0.6-13 cm into R, and the one
      // clear pole has the elbow 0.50 m away (the twin's arm, on another path since the shoulder range, never gets there).
      // Bounded here, not let go
      ...HC().map((def) => {
        const known: Record<string, number> = { 'HC-F5-invalidOne': 0.5 };
        return {
          name: 'every HC variant: no limb jump over 0.3 m in one tick',
          id: def.id,
          check: (r: { worst: number; at: string }) => expect(r.worst, `${def.id} ${r.at}`).toBeLessThanOrEqual(known[def.id] ?? 0.3),
        };
      }),
    ];
    await rows(CASES, ({ name, id }) => `${id}: ${name}`, async ({ id, check }) => check((await hcRun(FIX(id))).snap!));
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
