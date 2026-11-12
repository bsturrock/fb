// Ladder 13c: the supported upper arm and elbow kept out of the own trunk (SelfClearanceProfile.upperArm,
// `withUpperArmClearance`, used by no fixture yet). Plan 11 kept the forearm, palm and fingers out of the measured trunk;
// the upper arm hung against it, and the visible meter reads it past 5 cm for about a fifth of L3's supported time
// (clip arms carried across the chest, arm-task arms reaching through it). Under the profile the self shapes take the
// upper arm's distal half at the elbow's thickness (the forearm's radius: at the drawn 9.9 cm the fitted idle arm is
// already 1.7 to 3.8 cm into its waist), in each candidate's depth, the arm task's validity and the continuity push; the
// pushed target stays within the arm's reach of its shoulder. The twins are the same state without the profile and, for
// the bound, with the profile and the bound off (`PoseDebug.noArmReachBound`).
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { armSelfShapes } from '../src/sim/pose';
import { poseProbe, type SimDebug } from '../src/sim/debug';
import { RAPIER, trunkContact, trunkPieces } from '../src/sim/physics';
import { SELF_CLEARANCE_V1, shoulderLocal, UPPER_ARM_SELF_ID, withoutUpperArmClearance, withUpperArmClearance } from '../src/sim/profiles';
import type { ArmSide } from '../src/sim/contracts';
import { add, addScaled, dist, len, lerp, norm, qFromUnitVectors, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { FIX } from './runs';
import { loadState, resumeState } from './state';

describe('ladder 13c: the upper arm in the arms\' self-clearance', () => {
  it('the profile: self-clearance-v1 with the upper arm, used by no fixture; its self shape is the distal half of the bone at the given radius, fitted inside the elbow; without it the shapes are plan 11\'s', () => {
    const on = withUpperArmClearance(SELF_CLEARANCE_V1);
    expect(on).toEqual({ ...SELF_CLEARANCE_V1, id: `${SELF_CLEARANCE_V1.id}+${UPPER_ARM_SELF_ID}`, upperArm: true });
    expect(withUpperArmClearance(on)).toBe(on);
    expect(withoutUpperArmClearance(on)).toEqual(SELF_CLEARANCE_V1);
    for (const d of allFixtures()) expect(d.selfClearance?.upperArm, d.id).toBeUndefined();
    const sh = v3(0.2, 1.4, 0);
    const el = v3(0.25, 1.1, 0.05);
    const wr = v3(0.3, 0.9, 0.2);
    const pa = v3(0.32, 0.85, 0.28);
    const radii = { forearm: 0.06, palm: 0.04 };
    const plain = armSelfShapes(radii, 0.2, 'left', el, wr, pa);
    expect(plain.map((s) => s.key)).toEqual(['leftForearmSelf', 'leftPalmSelf', 'leftHandSelf']);
    const withUpper = armSelfShapes(radii, 0.2, 'left', el, wr, pa, { shoulder: sh, r: 0.06 });
    expect(withUpper.slice(1)).toEqual(plain);
    const up = withUpper[0];
    if (up.kind !== 'capsule') throw new Error('the upper arm self shape is a capsule');
    expect(up.key).toBe('leftUpperArmSelf');
    expect(up.r).toBe(0.06);
    expect(dist(up.a, lerp(sh, el, 0.5))).toBeLessThan(1e-12);
    // its cap reaches the elbow
    expect(dist(add(up.b, scale(norm(sub(el, sh)), up.r)), el)).toBeLessThan(1e-12);
  });

  /** One arm from a capture to `untilS`: its upper arm self shape's depth past the tolerance in the own trunk per tick, and its continuity target's farthest distance from the shoulder. */
  async function upperArm(path: string, pid: string, side: ArmSide, untilS: number, on: boolean, faults: SimDebug = {}): Promise<{ depths: { t: number; d: number }[]; targetM: number; reachM: number; taskTicks: number }> {
    const cap = loadState(path);
    const d = FIX(cap.fixture);
    let tr: { palm0?: Vec3; shown?: Vec3 | null } | null = null;
    const sim = await resumeState(cap, {
      def: on ? { ...d, selfClearance: withUpperArmClearance(d.selfClearance!) } : d,
      variant: ['selfClearance'],
      faults: { ...faults, poseProbe: poseProbe({ trace: (k, r) => { if (k === `${pid}:${side}Arm`) tr = r as typeof tr; } }) },
    });
    const p = sim.players.find((x) => x.id === pid)!;
    const T = trunkPieces(p.body)!;
    const R = sim.def.ragdoll!;
    const shL = shoulderLocal(p.body, side);
    const out = { depths: [] as { t: number; d: number }[], targetM: 0, reachM: R.lengths.upperArm + R.lengths.forearm + R.lengths.palmExtension, taskTicks: 0 };
    while (!sim.done && sim.t < untilS) {
      tr = null;
      sim.stepTick();
      if (!p.pose || p.rag) continue;
      const lm = p.pose.jointLandmarksWorld;
      const [up] = armSelfShapes(R.radii, p.body.measured!.handTipM!, side, lm[`${side}Elbow`], lm[`${side}Wrist`], lm[`${side}Palm`], { shoulder: lm[`${side}Shoulder`], r: R.radii.forearm });
      if (up.kind !== 'capsule') throw new Error('capsule');
      const ax = sub(up.b, up.a);
      const l = len(ax);
      const mid = addScaled(up.a, ax, 0.5);
      const core = p.pose.segments.core;
      const h = trunkContact(T, { p: core.originWorld, q: core.rotationWorld }, new RAPIER.Capsule(l / 2, up.r), mid, qFromUnitVectors(v3(0, 1, 0), scale(ax, 1 / l)), mid, l / 2 + up.r, 0.02);
      out.depths.push({ t: sim.t, d: h ? Math.max(0, -h.distance - d.selfClearance!.toleranceM) : 0 });
      // an arm task's arm has no procedural trace
      const t = tr as { palm0?: Vec3; shown?: Vec3 | null } | null;
      if (!t) out.taskTicks++;
      else if (t.palm0 && t.shown) out.targetM = Math.max(out.targetM, dist(add(t.palm0, t.shown), shL));
    }
    sim.dispose();
    return out;
  }
  const past = (r: { depths: { t: number; d: number }[] }, m: number) => r.depths.filter((x) => x.d > m);

  it('L3-F16-contactStop from 0.50 s, the runner\'s right clip arm: as registered (the twin) its upper arm is carried across its chest, past 5 cm for 22 ticks and past 2 cm still at 1.05 s; with the profile never past 5 cm and out by 0.8 s, its target within reach; with the reach bound off the push walks the target past 3 m from the shoulder', async () => {
    const at = 'tests/data/state/L3-F16-contactStop@30.json.gz';
    const off = await upperArm(at, 'R', 'right', 1.2, false);
    expect(off.taskTicks).toBe(0);
    expect(past(off, 0.05).length).toBeGreaterThanOrEqual(15);
    expect(past(off, 0.02).at(-1)!.t).toBeGreaterThan(1.0);
    const on = await upperArm(at, 'R', 'right', 1.2, true);
    expect(past(on, 0.05)).toEqual([]);
    expect(past(on, 0.02).at(-1)!.t).toBeLessThan(0.8);
    expect(on.targetM).toBeLessThanOrEqual(on.reachM + 1e-9);
    const fault = await upperArm(at, 'R', 'right', 1.2, true, { pose: { noArmReachBound: true } });
    expect(fault.targetM).toBeGreaterThan(2 * fault.reachM);
  }, 120000);

  it('L3-F5-dragMirror from 0.10 s, the defender\'s right arm-task arm: as registered (the twin) its upper arm reaches through its chest, past 5 cm for 7 ticks; with the profile within the tolerance throughout', async () => {
    const at = 'tests/data/state/L3-F5-dragMirror@6.json.gz';
    const off = await upperArm(at, 'D', 'right', 0.6, false);
    expect(off.taskTicks).toBeGreaterThan(20);
    expect(past(off, 0.05).length).toBeGreaterThanOrEqual(5);
    const on = await upperArm(at, 'D', 'right', 0.6, true);
    expect(on.taskTicks).toBeGreaterThan(20);
    expect(past(on, 0.002)).toEqual([]);
  }, 120000);
});
