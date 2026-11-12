import { describe, expect, it } from 'vitest';
import { JOINT_RANGE_V2 } from '../src/sim/profiles';
import { envelopeMoments, externalTwistRad, swingTwistOf, type Ragdoll } from '../src/sim/ragdoll';
import { add, qConj, qFromAxisAngle, qMul, qRot, sub, v3, vc, type Quat } from '../src/sim/vec';
import { FIX, preOwnLegs, preV3 } from './runs';
import { loadState, resumeState } from './state';
import { HUMAN_RANGES } from './visible';

// Ladder 8m, tracked defect (rule 7) SHOULDER_POLE_TWIST: a ragdoll arm at rest at its swing pole (straight overhead,
// swing near 180 deg from hanging) keeps whatever twist it has. The envelope's twist limit is scaled by cos(swing / 2) so
// that it fades at the pole (plan 09, its passivity), so there it neither corrects the twist nor sees it past its
// tolerance (the persistence clock and the loaded-limb rule read that faded excess); the visible matrix reads plan 09's
// twist itself, which at the pole is ill-conditioned (a small move of the arm turns the reading a long way). Seen under
// the visible flip on HC-F5-strictTransfer forward: R lies with its right arm overhead on the floor (the floor alone
// touches it, at about its own weight) and the twist reading drifts from 11 deg past the range at 2.75 s to 41 deg past
// from 3.0 s to the end. Not the flip's: from this state, and from 2.40 s, the twin with the flip's hip stops, PGS
// iterations and knee stop taken off keeps the arm there as long (the plan doc's open defects). Captured at the end of
// tick 165 (2.750 s) under the registered profile, 0.2 s before the reading passes the impossible margin. This test
// fails once the defect is gone from that state (a twist limit that holds at the pole, or a reading that is not taken
// there): then it is to be turned into that fix's test.
const CAPTURE = 'tests/data/state/HC-F5-strictTransfer@165.json.gz';
const DEG = 180 / Math.PI;
const ROT = HUMAN_RANGES.find((r) => r.joint === 'Shoulder' && r.dof === 'rotation')!;

interface Arm {
  /** Seconds past the visible impossible margin (plan 09 twist past the human range, read as tests/visible.ts does). */
  impossibleS: number;
  /** Seconds with the envelope's own twist excess past its tolerance, and its largest (deg). */
  envelopePastS: number;
  envelopeMaxDeg: number;
  /** Seconds at the pole: the fade leaves the envelope under its tolerance for an excess at the impossible margin; and
   *  seconds past the impossible margin away from it. */
  atPoleS: number;
  impossibleOffPoleS: number;
  /** The largest excess past the human range (deg) after the envelope's persistence limit from the start. */
  lateExcessDeg: number;
  /** The envelope's tolerance (deg) and persistence limit (s). */
  tolDeg: number;
  persistS: number;
}

/** R's right shoulder from the capture to the end, every drawn frame; `twin` changes the state at the capture first. */
async function rightShoulder(twin?: (rag: Ragdoll) => void): Promise<Arm> {
  // (captured under rung 8m's registration, before own-leg contact and the ladder 10 leg-guard flip: resumed under the
  // profile it ran under)
  const sim = await resumeState(loadState(CAPTURE), { def: preV3(preOwnLegs(FIX('HC-F5-strictTransfer'))) });
  const rag = sim.players.find((p) => p.id === 'R')!.rag!;
  twin?.(rag);
  const P = rag.profile.envelope!;
  const j = rag.joints.find((x) => x.id === 'rightShoulder')!;
  const side = j.sideSign ?? 1;
  const e = rag.envelope!.find((x) => x.jointId === 'rightShoulder')!;
  // the swing past which cos(swing / 2) scales the impossible margin under the tolerance
  const poleRad = 2 * Math.acos(P.toleranceDeg / ROT.impossible);
  const out: Arm = { impossibleS: 0, envelopePastS: 0, envelopeMaxDeg: -Infinity, atPoleS: 0, impossibleOffPoleS: 0, lateExcessDeg: -Infinity, tolDeg: P.toleranceDeg, persistS: P.persistS };
  const t0 = sim.t;
  let last = sim.t;
  while (!sim.done) {
    sim.stepTick();
    const dt = sim.t - last;
    last = sim.t;
    const q = qMul(qConj(rag.bodies.core.rotation()), rag.bodies.rightUpperArm.rotation());
    const st = swingTwistOf(q);
    const excess = ROT.excess({ swing: st.swingRad * DEG, coneEx: 0, rot: externalTwistRad(JOINT_RANGE_V2.shoulder, st.twistRad, side) * DEG });
    const qj = qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation());
    const M = envelopeMoments(P.shoulder, qj, side, e, v3());
    const env = Math.max(M.hi.excess, M.lo.excess) * DEG;
    if (excess > ROT.impossible) out.impossibleS += dt;
    if (excess > ROT.impossible && st.swingRad <= poleRad) out.impossibleOffPoleS += dt;
    if (env > P.toleranceDeg) out.envelopePastS += dt;
    out.envelopeMaxDeg = Math.max(out.envelopeMaxDeg, env);
    if (st.swingRad > poleRad) out.atPoleS += dt;
    if (sim.t - t0 > P.persistS) out.lateExcessDeg = Math.max(out.lateExcessDeg, excess);
  }
  sim.dispose();
  return out;
}

/** The twin: R's right arm moved off the pole to a swing of `swingDeg` with the same twist (about the shoulder, at rest). */
const offPole =
  (swingDeg: number) =>
  (rag: Ragdoll): void => {
    const j = rag.joints.find((x) => x.id === 'rightShoulder')!;
    const parent = rag.bodies[j.parent];
    const st = swingTwistOf(qMul(qConj(parent.rotation()), rag.bodies.rightUpperArm.rotation()));
    const h = swingDeg / DEG / 2;
    const swing: Quat = { x: st.axis.x * Math.sin(h), y: st.axis.y * Math.sin(h), z: st.axis.z * Math.sin(h), w: Math.cos(h) };
    const upper = qMul(parent.rotation(), qMul(swing, qFromAxisAngle(v3(0, 1, 0), st.twistRad)));
    const turn = qMul(upper, qConj(rag.bodies.rightUpperArm.rotation()));
    const anchor = add(vc(parent.translation()), qRot(parent.rotation(), j.anchorParentLocal));
    for (const b of [rag.bodies.rightUpperArm, rag.bodies.rightForearm]) {
      b.setTranslation(add(anchor, qRot(turn, sub(vc(b.translation()), anchor))), true);
      b.setRotation(qMul(turn, b.rotation()), true);
      b.setLinvel(v3(), true);
      b.setAngvel(v3(), true);
    }
  };

describe('ladder tracked defect SHOULDER_POLE_TWIST (rule 7): an arm at rest at its swing pole keeps its twist', () => {
  it("HC-F5-strictTransfer from 2.75 s: R's right arm lies overhead past the impossible twist longer than the persistence limit, unseen by its envelope; moved off the pole with the same twist (fault twin), the envelope brings it back", async () => {
    const base = await rightShoulder();
    // past the impossible margin longer than the persistence limit (3.07 s), only at the pole (3.25 s there), the
    // envelope's own (faded) reading never past its tolerance
    expect(base.impossibleS).toBeGreaterThan(base.persistS);
    expect(base.impossibleOffPoleS).toBe(0);
    expect(base.envelopePastS).toBe(0);
    // the twin: the same arm and twist at a swing of 120 deg, where the envelope reads half the excess: it is back inside
    // the range (to the envelope's tolerance) within the persistence limit and never reaches the impossible margin
    const off = await rightShoulder(offPole(120));
    expect(off.atPoleS).toBe(0);
    expect(off.impossibleS).toBe(0);
    expect(off.lateExcessDeg).toBeLessThan(off.tolDeg);
  }, 120000);
});
