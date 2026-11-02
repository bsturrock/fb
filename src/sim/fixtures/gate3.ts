// Gate 3 fixtures: free pitch/roll with the finite upright motor, recovery envelope and loss of support.
// Requests and starting conditions only; recovery or loss comes from the simulation.
import type { FixtureDef, PlayerSetup } from '../fixture';
import { PRACTICE_AREA } from '../fixture';
import type { ScriptSegment } from '../controllers/base';
import { BALANCE_G3, DEFAULT_MOTOR, SOLVER_G1, STANCE_G3_FREE, upperBodyCompound, type BalanceProfile, type BodyProfile } from '../profiles';
import { v3, type Vec3 } from '../vec';
import { g2f2, g2f4, g2f5, g2f7, g2f8, g2f10, g2f11, g2f12, wrapFixture } from './gate2';
import type { WrapSpec } from '../controllers/wrap';

export const base3 = (over: Partial<FixtureDef> & Pick<FixtureDef, 'id' | 'milestone' | 'title' | 'players' | 'durationS'>): FixtureDef => ({
  gate: 3,
  solver: SOLVER_G1,
  stance: STANCE_G3_FREE,
  motor: DEFAULT_MOTOR,
  balance: BALANCE_G3,
  settleS: 0.1,
  area: PRACTICE_AREA,
  ...over,
});

/**
 * Canonical Gate 3 body: the Gate 1 compound with the virtual support radius retuned 0.16 -> 0.25 m (declared).
 * At 0.16 m the cap min(240, m g r) = 157 N m holds at most ~10.3 deg of static lean (gravity torque 875 sin(theta) N m
 * from the engine COM, 0.89 m above the support hemisphere centre), below the spec's own 12 deg posture bound, and the
 * configured 240 N m maximum never binds. At 0.25 m the cap is 240 N m (configured maximum binds), static limit ~15.9 deg.
 */
export const bodyG3 = (massKg = 100): BodyProfile => upperBodyCompound({ massKg, supportRadiusM: 0.25, tag: 'std-sr25' });
/** Spec-default support radius (0.16 m) for comparison fixtures. */
export const bodyG3sr16 = (massKg = 100): BodyProfile => upperBodyCompound({ massKg, tag: 'std' });

const stand = (facing: Vec3, effort = 1): ScriptSegment[] => [{ fromS: 0, velocity: v3(), facing, effort }];

function solo(id: 'R' | 'D', body: BodyProfile, initial: PlayerSetup['initial'], segments: ScriptSegment[]): PlayerSetup {
  return { id, role: id === 'R' ? 'runner' : 'defender', body, initial, controller: { kind: 'script', segments } };
}

// ------------------------------------------------------------------ G3-A
/** G3-F1: rest 5 s, then straight run and finite braking under the balanced profile. */
export function g3f1(body: BodyProfile = bodyG3()): FixtureDef {
  return base3({
    id: body.kind === 'legacyCapsule' ? 'G3-F1-legacy' : 'G3-F1',
    milestone: 'G3-A',
    title: 'Unlock and stable support: rest 5 s, run +X at 5 m/s, brake',
    durationS: 8.5,
    players: [
      solo('R', body, { x: -5, z: 0, yawDeg: 90 }, [
        { fromS: 0, velocity: v3(), facing: v3(1, 0, 0) },
        { fromS: 5, velocity: v3(5, 0, 0), facing: v3(1, 0, 0) },
        { fromS: 7, velocity: v3(), facing: v3(1, 0, 0) },
      ]),
    ],
  });
}

/** G3-F2: start at a 10-degree lean (no angular velocity, valid floor contact) and recover with the same motor. */
export function g3f2(leanDeg = 10, body: BodyProfile = bodyG3(), tag = ''): FixtureDef {
  return base3({
    id: `G3-F2${tag}`,
    milestone: 'G3-A',
    title: `Small disturbance and recovery: initial ${leanDeg} deg lean toward +X, standing request`,
    durationS: 3,
    players: [solo('R', body, { x: 0, z: 0, yawDeg: 0, leanDeg, leanDirWorld: v3(1, 0, 0) }, stand(v3(0, 0, 1)))],
  });
}

// ------------------------------------------------------------------ G3-B
/**
 * G3-F3 (collision): the runner stands bracing (effort 1) facing -Z; the defender starts 2.5 m away and runs into
 * the runner's chest at `speed`, continuing the same request after contact. Only the approach speed differs.
 */
export function g3f3Collision(speed: number, tag: string, leanDeg = 12, startZ = -2.5): FixtureDef {
  return base3({
    id: `G3-F3-collision-${tag}`,
    milestone: 'G3-B',
    title: `Contact-caused recovery vs loss: defender (posture lean ${leanDeg} deg) runs into a bracing runner at ${speed} m/s`,
    notes: 'Same profiles and code; only the defender approach speed (initial momentum) differs between cases.',
    durationS: 1.5,
    focus: { D: 'R' },
    players: [
      solo('D', bodyG3(), { x: 0, z: startZ, yawDeg: 0, velocity: v3(0, 0, speed) }, [
        { fromS: 0, velocity: v3(0, 0, speed), facing: v3(0, 0, 1), posture: { leanDeg, dir: 'facing' } },
      ]),
      solo('R', bodyG3(), { x: 0, z: 0, yawDeg: 180 }, stand(v3(0, 0, -1))),
    ],
  });
}

/**
 * G3-F3 (side hit): the runner runs +X; a defender leaning 12 deg into contact (posture request + matching initial
 * lean) runs +Z at 7 m/s and meets the runner's right side at shoulder height. Only the runner's speed (initial
 * momentum) differs between the recover and loss cases; placement keeps the meeting point at x ~ 0.
 */
export function g3f3Side(vr: number, tag: string, vd = 7, leanDeg = 12): FixtureDef {
  const tMeet = Math.min(2 / vr, 0.6);
  return base3({
    id: `G3-F3-side-${tag}`,
    milestone: 'G3-B',
    title: `Contact-caused recovery vs loss: 12 deg-leaning defender (${vd} m/s) hits a runner moving ${vr} m/s at the shoulder`,
    notes: 'Same profiles, controllers and placement rule; only the runner speed differs. No outcome switch.',
    durationS: 1.75,
    focus: { D: 'R' },
    players: [
      solo('D', bodyG3(), { x: 0, z: -vd * tMeet - 0.35, yawDeg: 0, velocity: v3(0, 0, vd), leanDeg, leanDirWorld: v3(0, 0, 1) }, [
        { fromS: 0, velocity: v3(0, 0, vd), facing: v3(0, 0, 1), posture: { leanDeg } },
      ]),
      solo('R', bodyG3(), { x: -vr * tMeet, z: 0, yawDeg: 90, velocity: v3(vr, 0, 0) }, [{ fromS: 0, velocity: v3(vr, 0, 0), facing: v3(1, 0, 0) }]),
    ],
  });
}

/** G3-F5: near-threshold initial lean (14 deg) with the configured maximum balance torque 240 vs 168 N m (-30%). */
export const BALANCE_G3_CAP70: BalanceProfile = { ...BALANCE_G3, id: 'balance-g3-v1-cap70', maxBalanceTorqueNm: 168 };
export function g3f5(reduced: boolean): FixtureDef {
  return base3({
    id: reduced ? 'G3-F5-cap168' : 'G3-F5-cap240',
    milestone: 'G3-B',
    title: `Capacity intervention: 14 deg initial lean, maximum balance torque ${reduced ? 168 : 240} N m`,
    notes: 'Only BalanceProfile.maxBalanceTorqueNm differs (-30%). Body, initial state and envelope are identical.',
    balance: reduced ? BALANCE_G3_CAP70 : BALANCE_G3,
    durationS: 3,
    players: [solo('R', bodyG3(), { x: 0, z: 0, yawDeg: 0, leanDeg: 14, leanDirWorld: v3(1, 0, 0) }, stand(v3(0, 0, 1)))],
  });
}

// ------------------------------------------------------------------ G3-C
/**
 * Re-run an earlier fixture under the balanced profile: free rotation stance, balance profile, Gate 3 body (same
 * mass/geometry, retuned virtual support radius). Requests, placement and arms are unchanged. Reported separately;
 * never compared to the locked run as if unchanged.
 */
export function balancedVariant(def: FixtureDef, milestone = 'G3-C'): FixtureDef {
  return {
    ...def,
    id: `${def.id}-balanced`,
    gate: 3,
    milestone,
    title: `${def.title} [balanced profile]`,
    stance: STANCE_G3_FREE,
    balance: BALANCE_G3,
    players: def.players.map((p) => ({ ...p, body: bodyG3(p.body.massKg) })),
  };
}

/** Convert a fixture built with Gate 2 helpers into a native Gate 3 fixture (balanced profile, Gate 3 body). */
function asG3(def: FixtureDef, milestone = 'G3-C'): FixtureDef {
  const b = balancedVariant(def, milestone);
  return { ...b, id: def.id, title: def.title };
}

/**
 * G3-F9 finish: canonical G2-F5 wrap layout (runner jogs +X at 1 m/s, effort 0.5, then from 1.2 s drives +X at
 * 3 m/s, effort 0.8). The defender's finish request (section 9.1) is an explicit field direction +Z (through the
 * runner, toward the sideline) at 3 m/s with a 12 deg posture lean; the control removes drive and closure requests at
 * the first retained arm contact. Geometry, collision and the runner's requests are identical.
 */
const FINISH_Z: WrapSpec['finish'] = { dirWorld: v3(0, 0, 1), speedMps: 3, leanDeg: 12, repositionMps: 0.8 };
const runnerDrive = (): ScriptSegment[] => [
  { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
  { fromS: 1.2, velocity: v3(3, 0, 0), facing: v3(1, 0, 0), effort: 0.8 },
];
export function g3f9(removed: boolean): FixtureDef {
  return asG3(
    wrapFixture({
      id: removed ? 'G3-F9-removed' : 'G3-F9-sustained',
      milestone: 'G3-C',
      title: removed ? 'Finish control: drive and closure requests removed at connection' : 'Sustained finish: drive +Z and closure after connection',
      notes: 'Only the defender requests differ after the first retained arm contact.',
      wrap: removed ? { removeAfterConnect: true } : { finish: FINISH_Z },
      runner: runnerDrive(),
    }),
  );
}

/**
 * G3-F9 imperfect start: the defender keeps 0.35 m body separation (G2-F6 geometry), so only one forearm connects.
 * The finish request then repositions laterally toward the free arm's side (bounded locomotion request) while the
 * free arm keeps reaching. `runnerEffort` is the only difference between the improvement and the failure cases.
 */
export function g3f9Partial(tag: string, runner: ScriptSegment[]): FixtureDef {
  return asG3(
    wrapFixture({
      id: `G3-F9-partial-${tag}`,
      milestone: 'G3-C',
      title: `Imperfect one-arm connection with bounded improvement attempt (${tag})`,
      wrap: { contactGapM: 0.35, driveInMps: 0, engageGapM: 0.5, finish: FINISH_Z },
      runner,
    }),
  );
}

/** Runner input for F9-partial: jog, then optionally drive away at 3 m/s from `escapeAtS`. */
export const partialRunner = (escapeAtS?: number): ScriptSegment[] => [
  { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
  ...(escapeAtS !== undefined ? [{ fromS: escapeAtS, velocity: v3(3, 0, 0), facing: v3(1, 0, 0), effort: 0.8 }] : []),
];

/**
 * G3-F10: canonical wrap + sustained finish (+Z, 3 m/s) with the defender's posture request varied 0/6/12 deg.
 * The runner pushes back into the defender (heading toward -Z) from 1.2 s, then cuts away (+X, +Z) at 2.0 s.
 * Only FinishSpec.leanDeg differs between cases.
 */
export function g3f10(leanDeg: number): FixtureDef {
  return asG3(
    wrapFixture({
      id: `G3-F10-lean${leanDeg}`,
      milestone: 'G3-C',
      title: `Posture request ${leanDeg} deg vs runner resistance and heading changes`,
      notes: 'Only the defender posture request differs. Runner: jog, push back toward -Z at 1.2 s, cut away at 2.0 s.',
      wrap: { finish: { ...FINISH_Z!, leanDeg } },
      runner: [
        { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
        { fromS: 1.2, velocity: v3(1.2, 0, -1.6), facing: v3(0.6, 0, -0.8), effort: 0.9 },
        { fromS: 2.0, velocity: v3(3, 0, 1), facing: v3(0.95, 0, 0.3), effort: 0.9 },
      ],
      durationS: 3,
    }),
  );
}

export function gate3Fixtures(): FixtureDef[] {
  return [
    g3f1(),
    g3f2(),
    g3f2(10, bodyG3sr16(), '-sr16'),
    g3f2(14, bodyG3sr16(), '-sr16-14deg'),
    g3f3Side(2, 'recover'),
    g3f3Side(4, 'loss'),
    g3f3Collision(5, 'headOn'),
    g3f5(false),
    g3f5(true),
    g3f9(false),
    g3f9(true),
    g3f9Partial('improve', partialRunner()),
    g3f9Partial('fail', partialRunner(1.1)),
    g3f10(0),
    g3f10(6),
    g3f10(12),
    // F6 (wrap without loss), F7 (defender falls with two palm holds) and F8 balanced reruns of Gate 2 fixtures
    ...[g2f5(), g2f8(), g2f2(), g2f4(), g2f7(), g2f10(), g2f11(), g2f12()].map((f) => balancedVariant(f)),
  ];
}
