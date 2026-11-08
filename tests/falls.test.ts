// Plan 09 (L4): active falls, joint limits and role responses. The envelope works with muscles off and takes its own
// load, every effort is a capped equal and opposite internal torque pair, each arm's task follows role and retained
// holds, and a miss stays a miss. Power and work are audited from velocities across the solve, and nothing outside the
// fall changes: traces match the passive path to the conversion, and the rule observer never sees the response.
import { afterAll, describe, expect, it } from 'vitest';
import { FixedStepDriver } from '../src/sim/driver';
import { allFixtures } from '../src/sim/fixtures/index';
import { asL4, fallFixtures, LIMIT_TIMES } from '../src/sim/fixtures/falls';
import { transitionFixtures } from '../src/sim/fixtures/transitions';
import type { FixtureDef } from '../src/sim/fixture';
import { ENVELOPE_L4, FALL_L4, SOLVER_G4, SOLVER_G4_ZEROG, type JointEnvelope } from '../src/sim/profiles';
import { applyEnvelope, bulkOf, clampDirToEnvelope, envelopeMoments, initEnvelope, externalTwistRad, hingeAngles, limbDirWorld, swingExcess, swingExtentDeg, swingTwistOf, twistAxis, type Ragdoll } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { add, cross, dot, len, norm, qConj, qFromAxisAngle, qInvRot, qMul, rad, scale, sub, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { run, traceDiff } from './helpers';

const ALL = fallFixtures();
const FIX = (id: string): FixtureDef => {
  const f = ALL.find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};
const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const ran = new Map<string, Simulation>();
async function sim(id: string): Promise<Simulation> {
  if (!ran.has(id)) ran.set(id, await run(FIX(id)));
  await breathe();
  return ran.get(id)!;
}
afterAll(() => {
  for (const s of ran.values()) s.dispose();
});

const exp = (s: Simulation): any => s.exportFixture();
const evs = (s: Simulation, type: string): any[] => s.events.filter((e) => e.type === type);
const report = (s: Simulation, id: string): any => exp(s).fallEffort[id];
const envelopeOf = (s: Simulation, id: string): any[] => exp(s).jointLimits[id].envelope.joints;
const passive = (s: Simulation, id: string): { pos: number; neg: number } => ({ pos: envelopeOf(s, id).reduce((a, j) => a + j.passivePositiveJ, 0), neg: envelopeOf(s, id).reduce((a, j) => a + j.passiveNegativeJ, 0) });
const tasksOf = (s: Simulation, id: string): any => evs(s, 'fallResponse').find((e) => e.playerId === id)?.data.tasks;
const LIMIT_SIDES = ['left', 'right'] as const;

// ------------------------------------------------------------------ limits
describe('L4-F1 limits under stated loads, muscles off', () => {
  for (const [id, joint, expected] of [
    ['L4-F1-shoulderSwing', 'Shoulder', 1.15],
    ['L4-F1-shoulderTwist', 'Shoulder', 2.15],
    ['L4-F1-hipSwing', 'Hip', 0.98],
    ['L4-F1-hipTwist', 'Hip', 2.15],
  ] as const)
    it(`${id}: soft, the settled overshoot is the stiffness load, inside 5 degrees`, async () => {
      const d = FIX(id);
      const s = await Simulation.create(d, { trace: false });
      const [a, b] = [LIMIT_TIMES.loadS[1] - 0.4, LIMIT_TIMES.loadS[1]];
      const settled: Record<string, number> = {};
      const sum: Record<string, number> = {};
      let n = 0;
      while (!s.done) {
        s.stepTick();
        if (s.t < a || s.t >= b) continue;
        n++;
        for (const e of s.players[0].rag?.envelope ?? []) {
          settled[e.jointId] = Math.max(settled[e.jointId] ?? 0, e.overDeg);
          sum[e.jointId] = (sum[e.jointId] ?? 0) + e.overDeg;
        }
      }
      expect(s.fall).toBeNull();
      expect(exp(s).jointLimits.R.envelope.mode).toBe('soft');
      for (const side of LIMIT_SIDES) {
        // the largest excursion, lightly damped twist still ringing, stays inside the tolerance; its mean is the load
        // over the stiffness
        expect(settled[`${side}${joint}`]).toBeLessThan(ENVELOPE_L4.toleranceDeg);
        expect(Math.abs(sum[`${side}${joint}`] / n - expected), side).toBeLessThan(0.25);
      }
      for (const j of envelopeOf(s, 'R')) expect(j.maxOverRunS).toBeLessThan(ENVELOPE_L4.persistS);
      s.dispose();
    });

  for (const id of ['L4-F1-elbow', 'L4-F1-knee'])
    it(`${id}: native hinge holds under the load`, async () => {
      const s = await sim(id);
      const h = exp(s).jointLimits.R.hinges;
      expect(h.mode).toBe('native');
      expect(h.maxReverseDeg).toBeLessThan(ENVELOPE_L4.toleranceDeg);
      expect(h.maxOverDeg).toBeLessThan(ENVELOPE_L4.toleranceDeg);
    });

  it('the published extents are the declared cone, and a brace direction stays inside it', () => {
    const S = ENVELOPE_L4.shoulder;
    expect(swingExtentDeg(S, 0)).toBeGreaterThan(160);
    expect(swingExtentDeg(S, 90)).toBeGreaterThan(160);
    expect(swingExtentDeg(S, 180)).toBeLessThan(80);
    expect(swingExtentDeg(S, -90)).toBeLessThan(80);
    const H = ENVELOPE_L4.hip;
    expect(swingExtentDeg(H, 0)).toBeGreaterThan(120);
    expect(swingExtentDeg(H, 180)).toBeLessThan(45);
    for (const s of [1, -1]) for (const dir of [v3(0, 1, 0), v3(-s, 0, -1), v3(-s, -0.2, 0), v3(0, 0.3, -1)]) expect(swingExcess(S, clampDirToEnvelope(S, norm(dir), s, 0.14), s).rad).toBeLessThan(-0.1);
  });
});

/** Small seeded unit values, for directional derivative checks. */
const noise = (seed: number): (() => number) => {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
};

const NO_SLACK = { swingSlack: 0, twistSlackLo: 0, twistSlackHi: 0 };
const HANG = v3(0, -1, 0);

/** Relative rotation (parent frame) with the limb swung `swingDeg` toward azimuth `azDeg` and twisted `twistDeg` externally. */
function limbAt(E: JointEnvelope, side: number, swingDeg: number, azDeg: number, twistDeg: number): Quat {
  const toward = v3(side * Math.sin(rad(azDeg)), 0, Math.cos(rad(azDeg)));
  const swing = qFromAxisAngle(norm(cross(HANG, toward)), rad(swingDeg));
  return qMul(swing, qFromAxisAngle(v3(0, 1, 0), rad(E.neutralTwistDeg) + side * rad(twistDeg)));
}

const STEPS = 400;
const span = (a: number, b: number): number[] => Array.from({ length: STEPS }, (_, i) => a + ((b - a) * i) / STEPS);

/** A closed loop in swing and twist at a fixed azimuth, counter-clockwise from (swing0, twist0). */
function rectangle(E: JointEnvelope, side: number, azDeg: number, [s0, s1]: number[], [t0, t1]: number[]): Quat[] {
  return [
    ...span(s0, s1).map((s) => limbAt(E, side, s, azDeg, t0)),
    ...span(t0, t1).map((t) => limbAt(E, side, s1, azDeg, t)),
    ...span(s1, s0).map((s) => limbAt(E, side, s, azDeg, t1)),
    ...span(t1, t0).map((t) => limbAt(E, side, s0, azDeg, t)),
  ];
}

/** A closed loop in swing and azimuth at neutral twist. */
function patch(E: JointEnvelope, side: number, [s0, s1]: number[], [a0, a1]: number[]): Quat[] {
  return [
    ...span(s0, s1).map((s) => limbAt(E, side, s, a0, 0)),
    ...span(a0, a1).map((a) => limbAt(E, side, s1, a, 0)),
    ...span(s1, s0).map((s) => limbAt(E, side, s, a1, 0)),
    ...span(a1, a0).map((a) => limbAt(E, side, s0, a, 0)),
  ];
}

/** Work (J) the envelope's spring does on the limb along a path of relative rotations taken at rest (trapezoid rule). */
function loopWork(E: JointEnvelope, side: number, path: Quat[], closed = true): number {
  let work = 0;
  const torque = (q: Quat): Vec3 => envelopeMoments(E, q, side, NO_SLACK, v3()).torque;
  for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
    const [a, b] = [path[i], path[(i + 1) % path.length]];
    const d = qMul(b, qConj(a)); // the parent-frame turn taking a to b
    const sv = Math.hypot(d.x, d.y, d.z);
    const angle = 2 * Math.atan2(sv, Math.abs(d.w)) * Math.sign(d.w || 1);
    const turn = sv > 1e-12 ? scale(v3(d.x, d.y, d.z), angle / sv) : v3();
    work += dot(scale(add(torque(a), torque(b)), 0.5), turn);
  }
  return work;
}

describe('the limit torque follows a potential', () => {
  it('swing: near the boundary the axis is the gradient of the excess, on either side, on an elliptical cone too', () => {
    let tested = 0;
    for (const E of [ENVELOPE_L4.shoulder, ENVELOPE_L4.hip])
      for (const side of [1, -1]) {
        const r = noise(11);
        for (let i = 0; i < 4000; i++) {
          const dir = norm(v3(r(), r(), r()));
          const a = swingExcess(E, dir, side);
          if (Math.abs(a.rad) > 0.03) continue;
          tested++;
          const h = 1e-4;
          const up = norm(add(dir, scale(cross(a.axis, dir), h)));
          const across = norm(add(dir, scale(cross(dir, cross(a.axis, dir)), h)));
          expect((swingExcess(E, up, side).rad - a.rad) / h).toBeCloseTo(1, 0);
          expect(Math.abs(swingExcess(E, across, side).rad - a.rad) / h).toBeLessThan(0.15);
        }
      }
    expect(tested).toBeGreaterThan(20);
  });

  it('twist: the rate is the child axis plus the tan(swing / 2) azimuth term', () => {
    const r = noise(5);
    for (let i = 0; i < 500; i++) {
      const raw = { x: r(), y: r(), z: r(), w: r() };
      const n = Math.hypot(raw.x, raw.y, raw.z, raw.w);
      const q: Quat = { x: raw.x / n, y: raw.y / n, z: raw.z / n, w: raw.w / n };
      const st = swingTwistOf(q);
      if (st.swingRad > 2.9 || st.swingRad < 0.05) continue;
      const w = v3(r(), r(), r());
      const h = 1e-5;
      const st2 = swingTwistOf(qMul(qFromAxisAngle(norm(w), h * len(w)), q));
      const dTw = st2.twistRad - st.twistRad;
      if (Math.abs(dTw) > 1) continue;
      const g = twistAxis(q, st);
      expect(len(g)).toBeCloseTo(1, 6);
      expect(dot(w, g) / Math.cos(st.swingRad / 2)).toBeCloseTo(dTw / h, 2);
    }
    // the neutral and side of the external twist
    const E = ENVELOPE_L4.shoulder;
    expect(externalTwistRad(E, Math.PI, 1)).toBeCloseTo(0, 9);
    expect(externalTwistRad(E, Math.PI - 0.1, 1)).toBeCloseTo(-0.1, 9);
    expect(externalTwistRad(E, Math.PI - 0.1, -1)).toBeCloseTo(0.1, 9);
  });

  // the review regression: the twist spring faded with swing but had no swing torque, so a twisted shoulder swung up
  // and down around a closed path gained 26.3 J with muscles off
  it('a closed path at rest returns exactly the work it took: twist fading, an elliptical swing cone, both limits, the cap', () => {
    const S = ENVELOPE_L4.shoulder;
    const H = ENVELOPE_L4.hip;
    // past the shoulder twist limit by 5 to 25 deg while swinging 20 to 120 deg toward the cone centre (swing inside)
    for (const side of [1, -1]) expect(Math.abs(loopWork(S, side, rectangle(S, side, 45, [20, 120], [105, 125])))).toBeLessThan(0.01);
    // the hip swung backward past its elliptical boundary, around a patch in swing and azimuth, twist at neutral
    for (const side of [1, -1]) expect(Math.abs(loopWork(H, side, patch(H, side, [50, 75], [150, 215])))).toBeLessThan(0.01);
    // both hip limits at once, deep enough that the swing spring reaches its cap on the far edge
    expect(H.swing.stiffnessNmPerRad * rad(30)).toBeGreaterThan(H.maxTorqueNm);
    for (const side of [1, -1]) expect(Math.abs(loopWork(H, side, rectangle(H, side, 180, [55, 75], [55, 80])))).toBeLessThan(0.01);
    // the same loop does real work if it is not closed: the check measures something
    expect(Math.abs(loopWork(S, 1, rectangle(S, 1, 45, [20, 120], [105, 125]).slice(0, 3 * STEPS), false))).toBeGreaterThan(5);
  });

  it('each limit torque is minus the exact gradient of its own excess, and damping never adds power', () => {
    const r = noise(17);
    let tested = 0;
    for (const E of [ENVELOPE_L4.shoulder, ENVELOPE_L4.hip])
      for (const side of [1, -1])
        for (let i = 0; i < 400; i++) {
          const raw = { x: r(), y: r(), z: r(), w: r() };
          const n = Math.hypot(raw.x, raw.y, raw.z, raw.w);
          const q: Quat = { x: raw.x / n, y: raw.y / n, z: raw.z / n, w: raw.w / n };
          if (swingTwistOf(q).swingRad > 2.8) continue;
          const at = (x: Quat) => envelopeMoments(E, x, side, NO_SLACK, v3());
          const M = at(q);
          const w = v3(r(), r(), r());
          const h = 1e-5;
          const [up, down] = [at(qMul(qFromAxisAngle(norm(w), h * len(w)), q)), at(qMul(qFromAxisAngle(norm(w), -h * len(w)), q))];
          for (const k of ['swing', 'hi', 'lo'] as const) {
            // where the limit acts or is about to (deep inside, the cone's centre leaves the azimuth undefined), and
            // not across the half turn where twist wraps
            if (M[k].excess < -0.05 || Math.abs(up[k].excess - down[k].excess) > 0.1) continue;
            const rate = (up[k].excess - down[k].excess) / (2 * h);
            expect(Math.abs(dot(w, M[k].grad) - rate), k).toBeLessThan(1e-3 * Math.max(1, Math.abs(rate)));
          }
          // the damped moment, for any relative speed, never does more work than the spring alone
          const spin = scale(w, 20);
          const damped = envelopeMoments(E, q, side, NO_SLACK, spin);
          expect(dot(damped.torque, spin)).toBeLessThanOrEqual(dot(M.torque, spin) + 1e-9);
          if (len(M.torque) > 0) tested++;
        }
    expect(tested).toBeGreaterThan(200);
  });

  it('no joint stays past the tolerance longer than the persistence limit, in any fall, on or off', async () => {
    for (const d of ALL.filter((x) => !x.id.startsWith('L4-F1-'))) {
      const s = await sim(d.id);
      for (const p of s.players) for (const e of p.rag?.envelope ?? []) expect(e.maxOverRunS, `${d.id} ${p.id} ${e.jointId}`).toBeLessThan(ENVELOPE_L4.persistS);
    }
  });

  // the regression behind the cone: limits per quadrant fell under a limb sliding sideways, and paid 320 J to leave
  it('a limit returns less than it absorbs and launches nothing, in every natural fall', async () => {
    for (const id of ['L4-F4-late', 'L4-F4-tooFar', 'L4-F3-oblique-on', 'L4-F3-oblique-off', 'L4-F3-side-on', 'L4-F12-base']) {
      const s = await sim(id);
      for (const p of s.players.filter((x) => x.rag)) {
        const { pos, neg } = passive(s, p.id);
        expect(pos, id).toBeLessThan(Math.max(neg, 40));
        expect(p.ragStats!.maxSpeed, id).toBeLessThan(9);
      }
    }
  });

  it('a joint that starts outside keeps slack, so conversion adds no kick, and the slack only tightens', async () => {
    const s = await Simulation.create(FIX('L4-F9-crowded'), { trace: false });
    let seen = false;
    const prev = new Map<string, number>();
    while (!s.done) {
      s.stepTick();
      for (const p of s.players)
        for (const e of p.rag?.envelope ?? []) {
          if (e.startOutsideDeg > 20) seen = true;
          const k = `${p.id}${e.jointId}`;
          const slack = e.swingSlack + e.twistSlackLo + e.twistSlackHi;
          if (prev.has(k)) expect(slack).toBeLessThanOrEqual(prev.get(k)! + 1e-12);
          prev.set(k, slack);
        }
    }
    expect(seen).toBe(true);
    s.dispose();
  });

  it('slack takes up a start outside the range, follows the limb inward at once and never refills', async () => {
    const s = await Simulation.create(FIX('L4-F8-passive'), { trace: false });
    while (!s.players[0].rag) s.stepTick();
    const rag = s.players[0].rag!;
    const j = rag.joints.find((x) => x.id === 'leftShoulder')!;
    const E = ENVELOPE_L4.shoulder;
    const dt = 1 / 240;
    const decay = rad(ENVELOPE_L4.slackDecayDegPerS) * dt;
    const parent = rag.bodies[j.parent].rotation();
    let relative: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const place = (q: Quat): void => {
      relative = q;
      rag.bodies[j.child].setRotation(qMul(parent, q), true);
    };
    const twisted = qFromAxisAngle(v3(0, 1, 0), rad(E.neutralTwistDeg));
    const back = (deg: number): Quat => qMul(qFromAxisAngle(v3(1, 0, 0), rad(deg)), twisted); // a positive turn about X swings backward
    const excess = (): number => swingExcess(E, swingTwistOf(relative).dir, j.sideSign ?? 1).rad;

    place(back(110));
    initEnvelope(rag);
    const e = rag.envelope!.find((x) => x.jointId === j.id)!;
    const start = excess();
    expect(start).toBeGreaterThan(0.3);
    expect(e.swingSlack).toBeCloseTo(start, 5); // the engine keeps rotations in 32-bit floats
    // no kick: only one substep of decay reaches the torque
    applyEnvelope(rag, dt);
    expect(e.swingSlack).toBeCloseTo(start - decay, 5);
    expect(len(e.torque)).toBeLessThan(E.swing.stiffnessNmPerRad * decay * 1.1); // plus the damping on the same small excess
    // the limb moves inward: the slack comes with it
    place(back(95));
    const inward = excess();
    expect(inward).toBeLessThan(start - 0.1);
    expect(inward).toBeGreaterThan(0);
    applyEnvelope(rag, dt);
    expect(e.swingSlack).toBeCloseTo(inward - decay, 5);
    // back outward: what was given up stays given up, and the limit pushes
    place(back(110));
    applyEnvelope(rag, dt);
    expect(e.swingSlack).toBeCloseTo(inward - 2 * decay, 5);
    expect(len(e.torque)).toBeGreaterThan(50);
    // inside the range: gone
    place(back(20));
    applyEnvelope(rag, dt);
    expect(e.swingSlack).toBe(0);

    // the same for twist, past either limit by 30 deg, then back to neutral
    const taken: number[][] = [];
    for (const sign of [1, -1]) {
      place(qFromAxisAngle(v3(0, 1, 0), rad(E.neutralTwistDeg + sign * (E.twistDeg[1] + 30))));
      initEnvelope(rag);
      const t = rag.envelope!.find((x) => x.jointId === j.id)!;
      taken.push([t.twistSlackLo, t.twistSlackHi]);
      place(twisted);
      applyEnvelope(rag, dt);
      expect([t.twistSlackLo, t.twistSlackHi]).toEqual([0, 0]);
    }
    expect(Math.max(...taken.map((x) => x[0]))).toBeGreaterThan(0.4);
    expect(Math.max(...taken.map((x) => x[1]))).toBeGreaterThan(0.4);
    s.dispose();
  });
});

// ------------------------------------------------------------------ every response, whatever the fixture
describe('L4 audits on every fixture', () => {
  const withResponse = (): FixtureDef[] => ALL.filter((d) => d.fallResponse);

  it('every actuated joint is a capped equal and opposite pair, inside the effort window, on accepted ragdolls only', async () => {
    for (const d of withResponse()) {
      const s = await sim(d.id);
      const P = d.fallResponse!;
      for (const e of s.fall!.ledger) {
        const pl = s.players.find((p) => p.id === e.owner)!;
        expect(pl.handoff?.accepted, d.id).toBe(true);
        expect(e.t, d.id).toBeGreaterThanOrEqual(pl.handoff!.t);
        expect(e.appliedNm, `${d.id} ${e.joint}`).toBeLessThanOrEqual(e.capNm * (1 + 1e-6));
        expect(e.capNm).toBeLessThanOrEqual(P.ceilingsNm[pl.rag!.joints.find((j) => j.id === e.joint)!.kind as 'knee'] + 1e-9);
        expect(e.pairSum).toBe(0);
        expect(e.budgetScale).toBeLessThanOrEqual(1 + 1e-9);
        expect(e.powerScale).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('power and work: predicted before the solve, audited after it, within the 5% tolerance', async () => {
    for (const d of withResponse()) {
      const s = await sim(d.id);
      const P = d.fallResponse!.power;
      for (const [id, r] of Object.entries(exp(s).fallEffort ?? {}) as [string, any][]) {
        const label = `${d.id} ${id}`;
        expect(r.overPowerSubsteps, label).toBe(0);
        expect(r.overWork, label).toBe(false);
        expect(r.positiveWorkJ, label).toBeLessThanOrEqual(P.maxPositiveWorkJ * (1 + P.toleranceFraction));
        expect(r.peakPredictedW, label).toBeLessThanOrEqual(P.maxPositiveW * P.planFraction * (1 + 1e-3));
        // an impact is no excuse: any substep over the tolerance counts, and the impact tag only says why
        expect(r.impactPowerSubsteps, label).toBe(0);
        expect(r.peakImpactW, label).toBe(0);
        expect(evs(s, 'fallEffortOver').filter((e) => e.playerId === id).length, label).toBe(0);
      }
      // the same audit, again from the ledger: every substep's realized positive power, each player apart
      const bySubstep = new Map<string, number>();
      for (const e of s.fall!.ledger) bySubstep.set(`${e.owner}@${e.step}`, (bySubstep.get(`${e.owner}@${e.step}`) ?? 0) + Math.max(0, e.realizedW));
      for (const [k, w] of bySubstep) expect(w, `${d.id} ${k}`).toBeLessThanOrEqual(P.maxPositiveW * (1 + P.toleranceFraction));
    }
  });

  it('an impact holds effort off the limb it reaches, or the whole body through the core, for that substep only', async () => {
    let held = 0;
    let body = 0;
    for (const d of withResponse()) {
      const s = await sim(d.id);
      for (const r of Object.values(exp(s).fallEffort ?? {}) as any[]) {
        held += r.heldSubsteps;
        body += r.heldBodySubsteps;
        expect(r.heldBodySubsteps, d.id).toBeLessThanOrEqual(r.heldSubsteps);
        expect(r.heldSubsteps, d.id).toBeLessThan(r.activeSubsteps);
      }
    }
    expect(held).toBeGreaterThan(body);
    expect(body).toBeGreaterThan(0);
  });

  it('accounted arm effort stays under the shared budget, combined with grasp tension', async () => {
    let shared = 0;
    let grasp = 0;
    for (const d of withResponse()) {
      const s = await sim(d.id);
      const byStep = new Map<string, number>();
      for (const e of s.arms?.effortLedger ?? []) {
        expect(e.allocatedN, d.id).toBeLessThanOrEqual(e.perArmN + 1e-6);
        const k = `${e.owner}:${e.step}`;
        byStep.set(k, (byStep.get(k) ?? 0) + e.allocatedN);
        expect(byStep.get(k)!, d.id).toBeLessThanOrEqual(e.ownerBudgetN + 1e-6);
        if (e.graspN > 0) grasp++;
        // the torque actually applied carries the same scale as the grasp it shares a budget with
        const torque = s.fall!.ledger.find((x) => x.owner === e.owner && x.step === e.step && x.joint === `${e.arm}Shoulder`);
        if (torque) expect(torque.budgetScale, d.id).toBeCloseTo(e.armFactor * e.sharedScale, 9);
        if (torque && e.armFactor * e.sharedScale < 1 - 1e-9) shared++;
      }
    }
    expect(grasp).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(0);
  });

  it('no effort after the window, and the window is about a second', async () => {
    for (const d of withResponse()) {
      const s = await sim(d.id);
      const T = d.fallResponse!.timing;
      for (const r of Object.values(exp(s).fallEffort ?? {}) as any[]) expect(r.lastEffortS).toBeLessThanOrEqual(T.fadeStartS + T.fadeS + 1e-6);
    }
  });

  it('a held arm never takes a brace target while its hold stands', async () => {
    for (const d of withResponse()) {
      const s = await sim(d.id);
      const lost = new Map<string, number>();
      for (const e of s.events) {
        const data = e.data!;
        if (e.type === 'fallTask' && data.from === 'hold') lost.set(`${e.playerId}:${data.arm}`, e.t);
        if (e.type !== 'braceTarget' && e.type !== 'braceContact') continue;
        const begin = tasksOf(s, e.playerId!);
        if (begin?.[data.arm as string] !== 'hold') continue;
        expect(lost.has(`${e.playerId}:${data.arm}`), d.id).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------------------ knee and hip
describe('L4-F2 knee flexion, on and off', () => {
  for (const dir of ['forward', 'back', 'side', 'model-forward', 'model-back', 'model-side'])
    it(`${dir}: the active case attempts finite flexion from the accepted angle`, async () => {
      const at = async (id: string): Promise<number> => {
        const s = await Simulation.create(FIX(id), { trace: false });
        while (!s.done && s.t < 0.3) s.stepTick();
        const h = hingeAngles(s.players[0].rag!);
        s.dispose();
        return (h.leftKnee + h.rightKnee) / 2;
      };
      const [on, off] = [await at(`L4-F2-${dir}-on`), await at(`L4-F2-${dir}-off`)];
      // a forward fall folds the knees past the target on its own, so the flexor stops; it never holds them straighter
      if (dir.endsWith('forward')) expect(on).toBeGreaterThan(off - 3);
      else expect(on).toBeGreaterThan(off + 2);
      const s = await sim(`L4-F2-${dir}-on`);
      expect(report(s, 'R').positiveWorkJ).toBeGreaterThan(0);
      const joints = new Set(s.fall!.ledger.map((e) => e.joint));
      expect([...joints].sort()).toEqual(['leftKnee', 'rightKnee']);
      expect(report(s, 'R').peakNm.knee).toBeLessThanOrEqual(FALL_L4.ceilingsNm.knee + 1e-9);
      expect(evs(s, 'fallResponse')[0].data.kneeDeg.left).toBeCloseTo((s.players[0].fall!.knee0.left * 180) / Math.PI, 1);
    });
});

// ------------------------------------------------------------------ arms
describe('L4-F3 carrier with a free arm', () => {
  it('the installed player falling sideways is too late to brace, and that stays a miss', async () => {
    const s = await sim('L4-F3-model-side-on');
    expect(tasksOf(s, 'R')).toEqual({ left: 'brace', right: 'protect' });
    expect(evs(s, 'braceContact')).toEqual([]);
    expect(evs(s, 'braceMiss').map((e) => e.data.reason)).toEqual(['late']);
  });

  for (const id of ['L4-F3-forward-on', 'L4-F3-oblique-on', 'L4-F3-side-on', 'L4-F3-run-on', 'L4-F3-model-forward-on', 'L4-F3-model-oblique-on'])
    it(`${id}: the free arm reaches the floor through a real collider, the carry arm stays on protect`, async () => {
      const s = await sim(id);
      expect(tasksOf(s, 'R')).toEqual({ left: 'brace', right: 'protect' });
      const c = evs(s, 'braceContact').filter((e) => e.playerId === 'R');
      expect(c.length).toBe(1);
      expect(c[0].data.arm).toBe('left');
      expect(['palm', 'forearm']).toContain(c[0].data.part);
      expect(evs(s, 'fallTask').filter((e) => e.playerId === 'R' && e.data.arm === 'right').map((e) => e.data.reason)).toEqual(['windowEnded']);
      const right = s.fall!.ledger.filter((e) => e.owner === 'R' && e.joint.startsWith('right') && /Shoulder|Elbow/.test(e.joint));
      expect(right.length).toBeGreaterThan(0);
      for (const e of right) expect(e.task).toBe('protect');
    });

  it('the arm yields once it lands: no sticky anchor, no extra joint, the hand can still move', async () => {
    const s = await Simulation.create(FIX('L4-F3-forward-on'), { trace: false });
    let joints = -1;
    let palm0: Vec3 | null = null;
    let moved = 0;
    while (!s.done) {
      s.stepTick();
      const rag: Ragdoll | null = s.players[0].rag;
      if (rag && joints < 0) joints = s.physics.world.impulseJoints.len();
      const c = evs(s, 'braceContact')[0];
      if (rag && c) {
        const p = rag.bodies.leftForearm.translation();
        palm0 ??= { x: p.x, y: p.y, z: p.z };
        moved = Math.max(moved, len(sub({ x: p.x, y: p.y, z: p.z }, palm0)));
      }
    }
    expect(s.physics.world.impulseJoints.len()).toBe(joints);
    expect(moved).toBeGreaterThan(0.01);
    s.dispose();
  });

  it('the motor-off twin has no response evidence', async () => {
    const s = await sim('L4-F3-forward-off');
    expect(s.fall).toBeNull();
    expect(exp(s).fallEffort).toEqual({});
    expect(evs(s, 'fallResponse').length).toBe(0);
    expect(exp(s).jointLimits.R.envelope.joints.length).toBe(4);
  });
});

describe('L4-F4 braces that fail stay failures', () => {
  for (const [id, reason] of [
    ['L4-F4-tooFar', 'tooFar'],
    ['L4-F4-late', 'late'],
    ['L4-F4-obstructed', 'obstructed'],
  ] as const)
    it(`${id}: ${reason}, no contact claimed, the arm goes passive`, async () => {
      const s = await sim(id);
      expect(evs(s, 'braceContact').length).toBe(0);
      const m = evs(s, 'braceMiss');
      expect(m.length).toBe(1);
      expect(m[0].data).toMatchObject({ arm: 'left', reason });
      expect(evs(s, 'fallTask').find((e) => e.data.arm === 'left')!.data).toMatchObject({ from: 'brace', to: 'passive', reason: 'braceMiss' });
      const after = s.fall!.ledger.filter((e) => e.joint === 'leftShoulder' && e.t > m[0].t + 1e-9);
      expect(after.length).toBe(0);
    });

  it('a fast fall lands before the arm: no time to brace', async () => {
    const s = await sim('L4-F4-fast');
    expect(evs(s, 'braceContact').length).toBe(0);
    expect(evs(s, 'braceMiss').length).toBe(1);
    expect(s.players[0].fall!.coreDown).toBe(true);
  });

  it('a carrier with no free arm: one protects, one holds, nothing braces', async () => {
    const s = await sim('L4-F4-occupied');
    expect(tasksOf(s, 'D')).toEqual({ left: 'hold', right: 'protect' });
    expect(evs(s, 'braceTarget').length + evs(s, 'braceContact').length + evs(s, 'braceMiss').length).toBe(0);
    for (const e of s.fall!.ledger) if (e.task) expect(['hold', 'protect']).toContain(e.task);
  });
});

describe('L4-F5 holds, L4-F6 the last hold breaks', () => {
  it('two palm holds suppress bracing on both arms', async () => {
    const s = await sim('L4-F5-twoPalm-on');
    expect(tasksOf(s, 'D')).toEqual({ left: 'hold', right: 'hold' });
    expect(evs(s, 'braceTarget').length).toBe(0);
  });

  it('one palm hold: that arm holds, the free arm may brace', async () => {
    const s = await sim('L4-F5-onePalm-on');
    expect(tasksOf(s, 'D')).toEqual({ left: 'hold', right: 'brace' });
    expect(evs(s, 'braceMiss').concat(evs(s, 'braceContact')).map((e) => e.data.arm)).toEqual(['right']);
    expect(evs(s, 'gripRelease').length).toBe(0);
  });

  it('forearm clamps carried into the fall count as holds', async () => {
    const s = await sim('L4-F5-twoClamp-on');
    expect(Object.values(tasksOf(s, 'D'))).toContain('hold');
  });

  it('a hold ends on its load, never on a decision: no reflexive drop', async () => {
    for (const id of ['L4-F5-twoPalm-on', 'L4-F5-onePalm-on', 'L4-F4-occupied', 'L4-F6-break']) {
      const s = await sim(id);
      for (const e of evs(s, 'gripRelease')) expect(['voluntary', 'playEnded'], id).not.toContain(e.data.reason);
      const lost = evs(s, 'fallTask').filter((e) => e.data.from === 'hold' && e.data.reason !== 'windowEnded');
      for (const e of lost) expect(e.data.reason).toBe('holdLost');
    }
  });

  it('the broken hold may brace from its achieved pose, and no new hold forms', async () => {
    const s = await sim('L4-F6-break');
    const live = await Simulation.create(FIX('L4-F6-break'), { trace: false });
    let gapRad = Infinity;
    while (!live.done && gapRad === Infinity) {
      live.stepTick();
      const ep = live.players.find((p) => p.fall)?.fall;
      if (ep?.arms.left.task === 'brace') gapRad = Math.acos(Math.min(1, dot(ep.arms.left.targetDirCore, qInvRot(ep.rag.bodies.core.rotation(), limbDirWorld(ep.rag, 'leftUpperArm')))));
    }
    live.dispose();
    expect(gapRad).toBeLessThan(0.3);
    const conv = evs(s, 'fallResponse')[0].t;
    const change = evs(s, 'fallTask').find((e) => e.data.arm === 'left' && e.data.from === 'hold')!;
    expect(change.data).toMatchObject({ to: 'brace', reason: 'holdLost' });
    expect(evs(s, 'gripBegin').filter((e) => e.t > conv).length).toBe(0);
    expect(evs(s, 'clampBegin').filter((e) => e.playerId === 'D' && e.t > conv).length).toBe(0);
  });
});

// ------------------------------------------------------------------ saturation and momentum
describe('L4-F7 saturation and zero caps', () => {
  it('zero ceilings give exactly the motor-off trace', async () => {
    const a = await sim('L4-F7-zeroCap');
    const b = await sim('L4-F7-passive');
    expect(traceDiff(a.trace, b.trace, ['R'])).toEqual({ pos: 0, vel: 0, yaw: 0, ticks: 0 });
    expect(report(a, 'R').positiveWorkJ).toBe(0);
    expect(report(a, 'R').peakNm).toEqual({ shoulder: 0, elbow: 0, hip: 0, knee: 0 });
    for (const e of a.fall!.ledger) expect(e.appliedNm).toBe(0);
    expect(a.players[0].ragStats).toEqual(b.players[0].ragStats);
  });

  it('a load past the ceiling overcomes the motor: torque saturates, the knee extends anyway', async () => {
    const s = await sim('L4-F7-overcome');
    const knees = s.fall!.ledger.filter((e) => /Knee/.test(e.joint) && e.t > 0.3 && e.t < 0.85);
    expect(knees.filter((e) => e.requestedNm >= e.capNm - 1e-9).length).toBeGreaterThan(20);
    for (const e of knees) expect(e.appliedNm).toBeLessThanOrEqual(e.capNm * (1 + 1e-6));
    const at = async (id: string): Promise<number> => {
      const r = await Simulation.create(FIX(id), { trace: false });
      while (!r.done && r.t < 0.5) r.stepTick();
      const h = hingeAngles(r.players[0].rag!);
      r.dispose();
      return h.leftKnee;
    };
    expect(await at('L4-F7-overcome')).toBeLessThan((await at('L4-F3-forward-on')) - 5);
  });
});

describe('L4-F8 airborne torque pairs', () => {
  const sample = async (id: string): Promise<{ P: Vec3[]; L: Vec3[]; ke: number[]; s: Simulation }> => {
    const s = await Simulation.create(FIX(id), { trace: false });
    const out = { P: [] as Vec3[], L: [] as Vec3[], ke: [] as number[], s };
    while (!s.done) {
      s.stepTick();
      const rag = s.players[0].rag;
      if (!rag) continue;
      const b = bulkOf(Object.values(rag.bodies));
      out.P.push(b.P);
      out.L.push(add(b.L, cross(b.com, b.P)));
      out.ke.push(b.ke);
    }
    return out;
  };

  it('joint actuation adds no external momentum, and energy change is explained by the work', async () => {
    const r = await sample('L4-F8-airborne');
    expect(FIX('L4-F8-airborne').solver).toBe(SOLVER_G4_ZEROG);
    expect(SOLVER_G4.gravityY).toBeLessThan(-9);
    const f = report(r.s, 'R');
    expect(f.positiveWorkJ).toBeGreaterThan(5);
    for (let i = 1; i < r.P.length; i++) {
      expect(len(sub(r.P[i], r.P[0]))).toBeLessThan(0.05);
      expect(len(sub(r.L[i], r.L[0]))).toBeLessThan(0.3);
    }
    const lim = passive(r.s, 'R');
    const work = f.positiveWorkJ - f.negativeWorkJ + lim.pos - lim.neg;
    expect(Math.abs(r.ke.at(-1)! - r.ke[0] - work)).toBeLessThan(1.5);
    r.s.dispose();
  });

  it('the airborne motor-off twin keeps its energy', async () => {
    const r = await sample('L4-F8-passive');
    expect(Math.abs(r.ke.at(-1)! - r.ke[0])).toBeLessThan(0.3);
    r.s.dispose();
  });
});

// ------------------------------------------------------------------ boundaries
describe('L4-F9 fall boundaries', () => {
  it('a rejected conversion stays a passive falling proxy: no response starts', async () => {
    const s = await sim('L4-F9-rejected');
    const pl = s.players.find((p) => p.id === 'R')!;
    expect(pl.representation).toBe('proxy');
    expect(pl.fall).toBeNull();
    expect(evs(s, 'fallResponse')).toEqual([]);
    expect(s.fall!.ledger).toEqual([]);
  });

  it('a transfer that failed its audit gets no response: limits stay, effort never starts', async () => {
    const s = await sim('L4-F9-transferFailed');
    const failed = s.players.filter((p) => p.handoff?.outcome === 'transferFailed');
    expect(failed.length).toBeGreaterThan(0);
    for (const p of failed) {
      expect(p.rag?.envelope?.length).toBe(4);
      expect(p.fall).toBeNull();
      expect(evs(s, 'fallResponse').filter((e) => e.playerId === p.id)).toEqual([]);
      expect(s.fall!.ledger.filter((e) => e.owner === p.id)).toEqual([]);
    }
  });

  const pairs: [string, string, string[]][] = [
    ['L4-F9-free', 'L3-F9-convert-free', ['R', 'D']],
    ['L4-F9-prep', 'L3-F9-convert-prep', ['R', 'D']],
    ['L4-F9-contact', 'L3-F9-convert-contact', ['R', 'D']],
    ['L4-F9-exit', 'L3-F9-convert-exit', ['R', 'D']],
    ['L4-F9-low', 'L3-F9-low', ['R', 'D']],
    ['L4-F9-defenderRising', 'L3-F9-defenderRising', ['R', 'D']],
    ['L4-F9-defenderFalling', 'L3-F9-defenderFalling', ['R', 'D']],
    ['L4-F9-both', 'L3-F10-both', ['R', 'D']],
  ];
  const L3 = (id: string): FixtureDef => transitionFixtures().find((d) => d.id === id)!;

  for (const [id, base, ids] of pairs)
    it(`${id}: identical to its passive source up to the conversion, whose audits pass`, async () => {
      const a = await sim(id);
      const b = await run(L3(base));
      const conv = Math.min(...a.players.filter((p) => p.handoff).map((p) => p.handoff!.t));
      const n = a.trace.filter((r) => r.t < conv - 1e-9).length;
      expect(n).toBeGreaterThan(5);
      expect(traceDiff(a.trace.slice(0, n), b.trace.slice(0, n), ids)).toEqual({ pos: 0, vel: 0, yaw: 0, ticks: 0 });
      for (const p of a.players.filter((x) => x.handoff)) {
        expect(p.handoff!.outcome, `${id} ${p.id}`).toBe('accepted');
        expect(p.fall).not.toBeNull();
        const q = b.players.find((x) => x.id === p.id)!;
        if (q.handoff && Math.abs(q.handoff.t - p.handoff!.t) < 1e-9) expect(p.handoff!.audit).toEqual(q.handoff.audit);
      }
      b.dispose();
    });

  it('a rejected conversion stays a passive proxy: no episode, no effort', async () => {
    const def = asL4(L3('L3-F11-invalid'), 'L4-x', 'rejected');
    const s = await run(def);
    const rej = s.players.filter((p) => p.handoff && !p.handoff.accepted);
    expect(rej.length).toBeGreaterThan(0);
    for (const p of rej) {
      expect(p.fall).toBeNull();
      expect(s.fall!.ledger.some((e) => e.owner === p.id)).toBe(false);
    }
    s.dispose();
  });

  it('nothing here starts a gait: the planner has no feet after the handoff', async () => {
    const s = await sim('L4-F9-free');
    const conv = s.players[0].handoff!.t;
    const later = s.events.filter((e) => /^foot/.test(e.type) && e.playerId === 'R' && e.t > conv + 1e-9);
    expect(later.length).toBeGreaterThan(0);
    for (const e of later) expect(e.data).toMatchObject({ mode: 'airborne', reason: 'ragdoll' });
  });
});

describe('L4-F10 official endings', () => {
  const ending = (s: Simulation): any => exp(s).ruleEnding;

  it('natural endings fall in the eligible subset, knee and elbow included', async () => {
    expect(ending(await sim('L4-F10-knee-on')).evidence.region).toBe('knee');
    expect(ending(await sim('L4-F10-elbow-off')).evidence.region).toBe('elbow');
    for (const id of ['L4-F10-knee-off', 'L4-F10-elbow-on', 'L4-F10-wrap-on', 'L4-F10-wrap-off']) {
      const e = ending(await sim(id));
      expect(e.kind).toBe('groundDown');
      expect(['hand', 'wrist', 'foot', 'ankle', 'footSupport']).not.toContain(e.evidence.region);
    }
  });

  it('a palm brace ends nothing: the core contact does', async () => {
    const s = await sim('L4-F10-palm-on');
    const palm = evs(s, 'braceContact').find((e) => e.data.part === 'palm')!;
    const e = ending(s);
    expect(e.kind).toBe('runnerCoreDown');
    expect(e.t).toBeGreaterThan(palm.t);
  });

  it('the spot freezes at the event and the settle window changes nothing', async () => {
    for (const id of ['L4-F10-knee-on', 'L4-F10-wrap-on', 'L4-F10-palm-on']) {
      const s = await Simulation.create(FIX(id), { trace: false });
      let first: string | null = null;
      while (!s.done) {
        s.stepTick();
        const e = s.rules?.ending;
        if (e) first ??= JSON.stringify(e);
        if (e) expect(JSON.stringify(e)).toBe(first);
      }
      expect(first).not.toBeNull();
      s.dispose();
    }
  });
});

describe('L4-F11 settling, exhausted work, repeated disturbance', () => {
  it('effort ends, the body settles, and the limits stay on', async () => {
    const s = await sim('L4-F11-settle');
    expect(report(s, 'R').done).toBe(true);
    expect(evs(s, 'fallResponseEnd').length).toBe(1);
    const b = bulkOf(Object.values(s.players[0].rag!.bodies));
    expect(b.ke).toBeLessThan(1);
    expect(s.result).toBe('duration');
    expect(s.players[0].rag!.envelope!.length).toBe(4);
  });

  it('repeated impacts cannot refill the work, and later ones meet only the limits', async () => {
    const quiet = await sim('L4-F11-settle');
    const s = await sim('L4-F11-disturbed');
    expect(report(s, 'R').lastEffortS).toBeLessThanOrEqual(1 + 1e-9);
    expect(report(s, 'R').positiveWorkJ).toBeLessThan(FALL_L4.power.maxPositiveWorkJ);
    expect(passive(s, 'R').neg).toBeGreaterThan(passive(quiet, 'R').neg);
    expect(evs(s, 'fallResponse').length).toBe(1);
  });

  it('exhausted work stays exhausted', async () => {
    const s = await sim('L4-F11-exhausted');
    const cap = FIX('L4-F11-exhausted').fallResponse!.power.maxPositiveWorkJ;
    const ex = evs(s, 'fallExhausted');
    expect(ex.length).toBe(1);
    expect(report(s, 'R').exhausted).toBe(true);
    expect(report(s, 'R').positiveWorkJ).toBeLessThanOrEqual(cap);
    // nothing at all after exhaustion: contact could turn even an absorbing command positive
    expect(s.fall!.ledger.filter((x) => x.owner === 'R' && x.t >= ex[0].t)).toEqual([]);
  });

  // the review regression: absorbing commands stayed on after exhaustion, and contact turned them positive (0.91 J with
  // no work allowed, 1.55 J with 1 J)
  it('a zero or small work cap holds through contact: no torque with none, never past the cap', async () => {
    const base = FIX('L4-F3-forward-on');
    for (const cap of [0, 0.5, 1, 2, 5, 20]) {
      const def: FixtureDef = { ...base, id: `${base.id}-cap${cap}`, fallResponse: { ...base.fallResponse!, power: { ...base.fallResponse!.power, maxPositiveWorkJ: cap } } };
      const s = await run(def);
      const r = report(s, 'R');
      const mine = s.fall!.ledger.filter((x) => x.owner === 'R');
      expect(r.positiveWorkJ, `${cap} J`).toBeLessThanOrEqual(cap);
      expect(r.overPowerSubsteps, `${cap} J`).toBe(0);
      expect(r.exhausted, `${cap} J`).toBe(true);
      if (cap < 1) expect(mine, `${cap} J`).toEqual([]);
      else expect(r.positiveWorkJ, `${cap} J`).toBeGreaterThan(cap / 3);
      expect(evs(s, 'braceContact').length + evs(s, 'braceMiss').length, `${cap} J`).toBeGreaterThan(0);
      s.dispose();
    }
  });
});

describe('L4-F12 mirror, rates and resets', () => {
  it('a mirrored fall mirrors the decisions', async () => {
    const a = await sim('L4-F12-base');
    const b = await sim('L4-F12-mirror');
    expect(tasksOf(a, 'R')).toEqual({ left: 'brace', right: 'brace' });
    expect(tasksOf(b, 'R')).toEqual({ left: 'brace', right: 'brace' });
    expect(evs(a, 'braceContact')[0].data.arm).toBe('right');
    expect(evs(b, 'braceContact')[0].data.arm).toBe('left');
    expect(evs(a, 'braceMiss')[0].data.arm).toBe('left');
    expect(evs(b, 'braceMiss')[0].data.arm).toBe('right');
    expect(Math.abs(evs(a, 'braceContact')[0].data.tS - evs(b, 'braceContact')[0].data.tS)).toBeLessThan(0.03);
    expect(Math.abs(report(a, 'R').positiveWorkJ - report(b, 'R').positiveWorkJ)).toBeLessThan(8);
  });

  it('a declared left-arm carry protects the left arm', async () => {
    const s = await sim('L4-F12-carryLeft');
    expect(tasksOf(s, 'R')).toEqual({ left: 'protect', right: 'brace' });
  });

  const fingerprint = (s: Simulation): string => JSON.stringify({ t: s.trace, e: s.events, l: s.fall?.ledger, f: exp(s).fallEffort, j: exp(s).jointLimits });

  it('same policy and effort over render rates and pause', async () => {
    const def = FIX('L4-F9-contact');
    const ref = await run(def);
    const want = fingerprint(ref);
    ref.dispose();
    for (const [hz, pauseEvery] of [
      [30, 0],
      [144, 0],
      [240, 7],
    ]) {
      const s = await Simulation.create(def);
      const drv = new FixedStepDriver(def.solver.outerTickS, 8);
      let frame = 0;
      while (!s.done) {
        drv.paused = pauseEvery > 0 && frame % pauseEvery === 3;
        frame++;
        for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
      }
      expect(fingerprint(s), `${hz} Hz`).toBe(want);
      s.dispose();
      await breathe();
    }
  });

  it('20 resets: the same run, nothing stale, no growing counts', async () => {
    const def = FIX('L4-F11-exhausted');
    const s = await Simulation.create(def);
    s.runToEnd();
    const want = fingerprint(s);
    const bodies = s.physics.world.bodies.len();
    const joints = s.physics.world.impulseJoints.len();
    for (let i = 0; i < 20; i++) {
      s.reset();
      expect(s.fall?.episodes.size ?? 0).toBe(0);
      expect(s.fall?.ledger.length ?? 0).toBe(0);
      s.runToEnd();
      expect(fingerprint(s)).toBe(want);
      expect(s.physics.world.bodies.len()).toBe(bodies);
      expect(s.physics.world.impulseJoints.len()).toBe(joints);
      await breathe();
    }
    s.dispose();
  });
});

describe('L4 is opt in', () => {
  it('only L4 fixtures carry a response or an envelope', () => {
    for (const d of allFixtures().filter((x) => x.milestone !== 'L4')) {
      expect(d.fallResponse, d.id).toBeUndefined();
      expect(d.ragdoll?.envelope, d.id).toBeUndefined();
    }
  });

  it('exports report solver, profiles, effort and limit error', async () => {
    const s = await sim('L4-F3-forward-on');
    const e = exp(s);
    expect(e.profiles.fallResponse.id).toBe(FALL_L4.id);
    expect(e.profileIds.fallResponse).toBe(FALL_L4.id);
    expect(e.solver?.id ?? e.profileIds.solver).toBeDefined();
    expect(e.jointLimits.R.envelope.mode).toBe('soft');
    const row = s.trace.find((r) => r.players.R.fall)!;
    expect(row).toBeDefined();
  });
});
