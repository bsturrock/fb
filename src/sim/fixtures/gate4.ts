// Gate 4 fixtures: ragdoll handoff, retained wraps through a fall, and drill completion. Starting conditions and
// requests only; diagnostic conversions are explicitly labelled and never used by contact-driven fixtures.
import type { FixtureDef, PlayerSetup } from '../fixture';
import { PRACTICE_AREA } from '../fixture';
import type { ScriptSegment } from '../controllers/base';
import type { ArmPlan, WrapSpec } from '../controllers/wrap';
import type { PlayerId } from '../contracts';
import type { CandidateEdit } from '../ragdoll';
import { ARM_G2, BALANCE_G3, DEFAULT_MOTOR, RAGDOLL_G4, RULES_FOOTBALL, RULES_LAB_CORE, SOLVER_G4, STANCE_G3_FREE, type BodyProfile } from '../profiles';
import { v3, type Vec3 } from '../vec';
import { bodyG3, balancedVariant } from './gate3';
import { armsSetup, g2f4, g2f5 } from './gate2';

/**
 * Gate 4 body: the Gate 3 balanced body (same mass, compound and support radius) with the shoulder pivot at
 * (+-0.20, 0.50, 0) instead of the spec placeholder (+-0.26, 0.50, 0). At 0.26 the pivot sits outside the proxy torso
 * face (half-width 0.25) and the 0.055 m upper-arm capsule reaches 0.315 m, so an opponent pressed against the
 * runner's side (allowed: the supported proxy has no arm colliders) leaves no arm pose within the 0.015 m handoff
 * tolerance (scripts/probe/shoulder.ts). Blueprint adjustment per section 5; used by every Gate 4 fixture.
 */
export const bodyG4 = (massKg = 100): BodyProfile => ({ ...bodyG3(massKg), id: `${bodyG3(massKg).id}-sh20`, shoulderRight: v3(0.2, 0.5, 0) });

export const base4 = (over: Partial<FixtureDef> & Pick<FixtureDef, 'id' | 'milestone' | 'title' | 'players' | 'durationS'>): FixtureDef => ({
  gate: 4,
  solver: SOLVER_G4,
  stance: STANCE_G3_FREE,
  motor: DEFAULT_MOTOR,
  balance: BALANCE_G3,
  ragdoll: RAGDOLL_G4,
  settleS: 0.1,
  area: PRACTICE_AREA,
  ...over,
});

function solo(id: 'R' | 'D', body: BodyProfile, initial: PlayerSetup['initial'], segments: ScriptSegment[]): PlayerSetup {
  return { id, role: id === 'R' ? 'runner' : 'defender', body, initial, controller: { kind: 'script', segments } };
}
const stand = (facing: Vec3): ScriptSegment[] => [{ fromS: 0, velocity: v3(), facing, effort: 1 }];

// ------------------------------------------------------------------ G4-A
/** G4-F1: diagnostic conversion of an upright stationary player in the standing reference pose, then settling. */
export function g4f1(): FixtureDef {
  return base4({
    id: 'G4-F1',
    milestone: 'G4-A',
    title: 'Stationary handoff and settling: diagnostic conversion of an upright standing player at 0.5 s',
    notes: 'Diagnostic conversion request (not a contact-caused fall). Passive ragdoll settles under gravity and contact only.',
    durationS: 3,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.5 }] },
    players: [solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 0 }, stand(v3(0, 0, 1)))],
  });
}

/**
 * G4-F2: moving and rotating conversion. Initial linear and angular velocity (and optional tilt) are set after
 * settling; the same request continues; a diagnostic conversion is requested at 0.05 s (a fixed boundary).
 */
export function g4f2(tag: string, yawDeg: number, velocity: Vec3, angularVelocity: Vec3, leanDeg = 0): FixtureDef {
  const sp = Math.hypot(velocity.x, velocity.z);
  const facing = sp > 0.1 ? v3(velocity.x / sp, 0, velocity.z / sp) : v3(Math.sin((yawDeg * Math.PI) / 180), 0, Math.cos((yawDeg * Math.PI) / 180));
  return base4({
    id: `G4-F2-${tag}`,
    milestone: 'G4-A',
    title: `Moving/rotating conversion: yaw ${yawDeg} deg, v (${velocity.x}, ${velocity.z}) m/s, w (${angularVelocity.x}, ${angularVelocity.y}, ${angularVelocity.z}) rad/s${leanDeg ? `, lean ${leanDeg} deg` : ''}`,
    notes: 'Diagnostic conversion at 0.05 s; bulk P and L must carry over; no impact impulse is added.',
    durationS: 2,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.05 }] },
    players: [
      solo('R', bodyG4(), { x: -2, z: 0, yawDeg, velocity, angularVelocity, leanDeg: leanDeg || undefined, leanDirWorld: leanDeg ? facing : undefined }, [
        { fromS: 0, velocity: v3(velocity.x, 0, velocity.z), facing, effort: 1 },
      ]),
    ],
  });
}

/** G4-F6a: labelled diagnostic candidate edit (left forearm body offset 5 cm): joint mismatch, handoff rejected. */
export function g4f6Joint(): FixtureDef {
  return base4({
    id: 'G4-F6-jointMismatch',
    milestone: 'G4-A',
    title: 'Bad candidate: diagnostic 5 cm left-forearm offset (elbow/shoulder anchors mismatch) — handoff must be rejected',
    notes: 'Diagnostic edit of the candidate only. The player continues as the Gate 3 falling proxy; no completion claim.',
    durationS: 2.5,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.5, edit: { kind: 'jointMismatch', segment: 'leftForearm', offsetWorld: v3(0.05, 0, 0) } }] },
    players: [solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 0 }, stand(v3(0, 0, 1)))],
  });
}

/**
 * G4-F6b: crowded neighbour. A second player stands with its chest against the runner's right side (proxies do not
 * touch), so no right-arm pose fits: the articulated candidate would start deep inside the neighbour.
 */
export function g4f6Crowded(): FixtureDef {
  return base4({
    id: 'G4-F6-crowded',
    milestone: 'G4-A',
    title: 'Bad candidate: neighbour chest against the runner shoulder; articulated arm cannot fit — handoff must be rejected',
    notes: 'Diagnostic conversion of R at 0.5 s. Proxies are separated; the candidate right arm would start inside the neighbour torso (depth recorded in handoffRejected).',
    durationS: 2.5,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.5 }] },
    players: [
      solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 0 }, stand(v3(0, 0, 1))),
      solo('D', bodyG4(), { x: 0.42, z: 0, yawDeg: -90 }, stand(v3(-1, 0, 0))),
    ],
  });
}

// ------------------------------------------------------------------ G4-B
/** Re-profile an earlier-gate fixture for Gate 4 (solver, ragdoll, Gate 4 body); requests and placement unchanged. */
function asG4(def: FixtureDef, over: Partial<FixtureDef> & Pick<FixtureDef, 'id' | 'milestone' | 'title'>): FixtureDef {
  return {
    ...def,
    gate: 4,
    solver: SOLVER_G4,
    ragdoll: RAGDOLL_G4,
    ...over,
    players: def.players.map((p) => ({ ...p, body: bodyG4(p.body.massKg) })),
  };
}

/**
 * Line-run wrap tackle (G4-F3). Geometry of G3-F3-side: the runner runs +X at `vr`; the defender runs a committed +Z
 * line at `vd` with a 12 deg posture lean, meets the runner's right side, wraps with the planned forearms (no palm
 * acquisition) and, once an arm retains, keeps requesting +Z at `vd`. Requests only; support loss (if any) comes from
 * the contact itself. The football subset observer (forward +X, sideline plane z = +4 m) decides completion; the
 * trial otherwise runs the default 6 s.
 */
export function lineTackle(o: { id: string; title: string; notes?: string; plan: { left: ArmPlan; right: ArmPlan }; vd: number; vr: number; durationS?: number }): FixtureDef {
  const tMeet = Math.min(2 / o.vr, 0.6);
  const wrap: WrapSpec = {
    kind: 'wrapAttempt',
    plan: o.plan,
    approachSpeedMps: o.vd,
    closingGainPerS: 1000,
    matchRunnerVelocity: false,
    interceptLead: true,
    driveInMps: o.vd,
    approachLeanDeg: 12,
    approachVelocityWorld: v3(0, 0, o.vd),
    finish: { dirWorld: v3(0, 0, 1), speedMps: o.vd, leanDeg: 12, repositionMps: 0, minProgressMps: -100 },
  };
  const mode = (p: ArmPlan) => (p === 'wrap' ? ('forearmClamp' as const) : null);
  return base4({
    id: o.id,
    milestone: 'G4-B',
    title: o.title,
    notes: o.notes,
    durationS: o.durationS ?? 6,
    armProfile: ARM_G2,
    rules: RULES_FOOTBALL('R', { forwardAxis: v3(1, 0, 0), sidelineNormal: v3(0, 0, 1), sidelineOffsetM: 4 }),
    focus: { D: 'R' },
    players: [
      {
        id: 'D',
        role: 'defender',
        body: bodyG4(),
        initial: { x: 0, z: -o.vd * tMeet - 0.35, yawDeg: 0, velocity: v3(0, 0, o.vd), leanDeg: 12, leanDirWorld: v3(0, 0, 1) },
        arms: armsSetup(mode(o.plan.left), mode(o.plan.right), { acquisition: false }),
        controller: wrap,
      },
      solo('R', bodyG4(), { x: -o.vr * tMeet, z: 0, yawDeg: 90, velocity: v3(o.vr, 0, 0) }, [{ fromS: 0, velocity: v3(o.vr, 0, 0), facing: v3(1, 0, 0) }]),
    ],
  });
}

export const g4f3TwoArm = (): FixtureDef =>
  lineTackle({
    id: 'G4-F3-twoArm',
    title: 'Real two-arm wrap tackle: 7 m/s line, both forearms wrap the 4 m/s runner',
    plan: { left: 'wrap', right: 'wrap' },
    vd: 7,
    vr: 4,
  });
export const g4f3OneArm = (): FixtureDef =>
  lineTackle({
    id: 'G4-F3-oneArm',
    title: 'Real one-arm tackle: 7 m/s line, right forearm only, 4 m/s runner',
    plan: { left: 'none', right: 'wrap' },
    vd: 7,
    vr: 4,
  });
export const g4f3Failed = (): FixtureDef =>
  lineTackle({
    id: 'G4-F3-failed',
    title: 'Failed/partial attempt: same code at a 3 m/s line; the wrap forms but the 4 m/s runner stays up and keeps running',
    notes: 'Only the defender line speed differs from G4-F3-twoArm. Ends at the practice safety edge (non-success label).',
    plan: { left: 'wrap', right: 'wrap' },
    vd: 3,
    vr: 4,
  });

const conv = (ids: PlayerId[], atS: number, targetEdit?: CandidateEdit) =>
  ids.map((playerId) => ({ playerId, atS, ...(targetEdit && playerId === 'R' ? { edit: targetEdit } : {}) }));

/**
 * G4-F4: G2-F4 two-palm front holds (Gate 4 bodies; the runner stands instead of backing away) with labelled
 * diagnostic conversion requests at 0.9 s, after both holds exist: target only, owner only, both, and target with a
 * diagnostic surface edit that moves the held torso collider 3 cm back inside its segment (deliberately invalid
 * surface for both held anchors).
 */
export function g4f4(kind: 'targetOnly' | 'ownerOnly' | 'simultaneous' | 'invalidSurface'): FixtureDef {
  const ids: PlayerId[] = kind === 'targetOnly' || kind === 'invalidSurface' ? ['R'] : kind === 'ownerOnly' ? ['D'] : ['R', 'D'];
  const edit: CandidateEdit | undefined = kind === 'invalidSurface' ? { kind: 'surfaceShift', segment: 'core', region: 'torso', offsetLocal: v3(0, 0, -0.03) } : undefined;
  const def = asG4(balancedVariant(g2f4()), {
    id: `G4-F4-${kind}`,
    milestone: 'G4-B',
    title: `Grip remapping (${kind}): two front palm holds, diagnostic conversion of ${ids.join('+')} at 0.9 s`,
    notes:
      kind === 'invalidSurface'
        ? 'Diagnostic candidate edit: the runner torso collider is moved 3 cm away from the defender; the held anchors are then off any eligible surface.'
        : 'Diagnostic conversion requests (labelled). Holds and arms follow the unchanged Gate 2 law until the boundary.',
    durationS: 2.2,
    diagnostics: { conversions: conv(ids, 0.9, edit) },
  });
  return {
    ...def,
    players: def.players.map((p) => (p.id === 'R' ? { ...p, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1) }] } } : p)),
  };
}

/**
 * G4-F10: canonical G2-F5 forearm wrap (no palm grips; Gate 4 bodies) with labelled diagnostic conversions at 1.2 s
 * while wrapped: target only, owner only, both.
 */
export function g4f10(kind: 'targetOnly' | 'ownerOnly' | 'simultaneous'): FixtureDef {
  const ids: PlayerId[] = kind === 'targetOnly' ? ['R'] : kind === 'ownerOnly' ? ['D'] : ['R', 'D'];
  return asG4(balancedVariant(g2f5()), {
    id: `G4-F10-${kind}`,
    milestone: 'G4-B',
    title: `Forearm-clamp handoff (${kind}): canonical wrap, diagnostic conversion of ${ids.join('+')} at 1.2 s`,
    notes: 'Diagnostic conversion requests (labelled). No palm grips exist; acquisition is disabled.',
    durationS: 2.6,
    diagnostics: { conversions: conv(ids, 1.2) },
  });
}

// ------------------------------------------------------------------ G4-C
const X = v3(1, 0, 0);
const NX = v3(-1, 0, 0);
const seg = (fromS: number, velocity: Vec3, facing: Vec3, effort = 1): ScriptSegment => ({ fromS, velocity, facing, effort });

/**
 * G4-F5a: a ragdoll falls into a still-standing opponent and the ground. The runner runs +X at 3 m/s toward a
 * defender who stands (finite motors, bounded drive) facing him; a labelled diagnostic conversion at 0.3 s turns the
 * runner into a ragdoll 0.6 m before contact. No rule observer (isolated mechanics).
 */
export const g4f5Standing = (): FixtureDef =>
  base4({
    id: 'G4-F5-standingOpponent',
    milestone: 'G4-C',
    title: 'Ragdoll runner (diagnostic conversion at 0.3 s, 3 m/s) tumbles into a still-standing defender and the ground',
    notes: 'Diagnostic conversion (labelled). The defender keeps executing its stand request with its own finite motors.',
    durationS: 3,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.3 }] },
    players: [solo('R', bodyG4(), { x: -1.6, z: 0, yawDeg: 90, velocity: v3(3, 0, 0) }, [seg(0, v3(3, 0, 0), X)]), solo('D', bodyG4(), { x: 0, z: 0, yawDeg: -90 }, [seg(0, v3(), NX)])],
  });

/** G4-F5b: two ragdolls from different owners collide (both converted diagnostically at 0.15 s, closing at 6 m/s). */
export const g4f5TwoRagdolls = (): FixtureDef =>
  base4({
    id: 'G4-F5-twoRagdolls',
    milestone: 'G4-C',
    title: 'Two ragdolls from different owners collide: both converted at 0.15 s while running at each other (3 m/s each)',
    notes: 'Diagnostic conversions (labelled). Inter-player contact is never filtered; only same-owner pairs are.',
    durationS: 3,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.15 }, { playerId: 'D', atS: 0.15 }] },
    players: [solo('R', bodyG4(), { x: -1.2, z: 0.1, yawDeg: 90, velocity: v3(3, 0, 0) }, [seg(0, v3(3, 0, 0), X)]), solo('D', bodyG4(), { x: 1.2, z: -0.1, yawDeg: -90, velocity: v3(-3, 0, 0) }, [seg(0, v3(-3, 0, 0), NX)])],
  });

const football = (o: Parameters<typeof RULES_FOOTBALL>[1] = {}) => RULES_FOOTBALL('R', { sideline: false, ...o });

/** G4-F7 completion semantics. Each fixture is one row of the section 14 matrix (see the title). */
export const g4f7LabCore = (): FixtureDef => ({
  ...g4f1(),
  id: 'G4-F7-labCore',
  milestone: 'G4-C',
  title: 'labCoreOnly: untouched diagnostic fall of a standing runner; solved torso/pelvis-ground contact gives runnerCoreDown',
  rules: RULES_LAB_CORE('R'),
});
export const g4f7Untouched = (): FixtureDef => ({
  ...g4f1(),
  id: 'G4-F7-untouched',
  milestone: 'G4-C',
  title: 'footballTackleSubset: the same untouched fall (no influence history or touch) gives no contacted-runner ending',
  rules: football(),
});
/**
 * Foot brace only: G2-F4 two-palm front holds on a standing runner (no conversion). The held runner stays on his feet
 * (virtual support + achieved-pose shoe probes) with continuing influence from the holds and body contact.
 */
export const g4f7FootBrace = (): FixtureDef => {
  const def = asG4(balancedVariant(g2f4()), {
    id: 'G4-F7-footBrace',
    milestone: 'G4-C',
    title: 'Foot brace only: runner held by two front palm holds stays on his feet; continuing influence, no groundDown',
    durationS: 2.5,
    rules: football({ forwardAxis: v3(0, 0, -1) }),
  });
  return { ...def, players: def.players.map((p) => (p.id === 'R' ? { ...p, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1) }] } } : p)) };
};
export const g4f7LimbFirst = (): FixtureDef => ({
  ...g4f10('targetOnly'),
  id: 'G4-F7-limbFirst',
  milestone: 'G4-C',
  title: 'Eligible limb before core: wrapped runner (diagnostic conversion) lands shin-first with the clamps still on',
  durationS: 4,
  rules: football(),
});
export const g4f7GroundedThenTouched = (): FixtureDef =>
  base4({
    id: 'G4-F7-groundedThenTouched',
    milestone: 'G4-C',
    title: 'Opponent touches an already-grounded runner: untouched diagnostic fall, then the defender walks into him',
    notes: 'Diagnostic conversion at 0.3 s (labelled). The defender starts 2.6 m away and walks at 1.2 m/s from 1.6 s.',
    durationS: 6,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.3 }] },
    rules: football(),
    players: [solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 90 }, [seg(0, v3(), X)]), solo('D', bodyG4(), { x: 2.6, z: 0, yawDeg: -90 }, [seg(0, v3(), NX), seg(1.6, v3(-1.2, 0, 0), NX, 0.6)])],
  });
export const g4f7DefenderFallsAlone = (): FixtureDef =>
  base4({
    id: 'G4-F7-defenderFallsAlone',
    milestone: 'G4-C',
    title: 'Contact only with the other player; the defender falls alone (diagnostic defender conversion into the runner)',
    notes: 'Diagnostic conversion of D at 0.3 s (labelled). The runner keeps its own support and request.',
    durationS: 3,
    diagnostics: { conversions: [{ playerId: 'D', atS: 0.3 }] },
    rules: football(),
    players: [
      solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 90, velocity: v3(1, 0, 0) }, [seg(0, v3(1, 0, 0), X)]),
      solo('D', bodyG4(), { x: 0.4, z: -1.6, yawDeg: 0, velocity: v3(0, 0, 3) }, [seg(0, v3(0, 0, 3), v3(0, 0, 1))]),
    ],
  });
export const g4f7Stationary = (): FixtureDef =>
  base4({
    id: 'G4-F7-unopposedStationary',
    milestone: 'G4-C',
    title: 'Unopposed stationary runner: no request, no opponent; no progressStopped',
    durationS: 3,
    rules: football(),
    players: [solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 90 }, [seg(0, v3(), X)])],
  });
export const g4f7Wall = (): FixtureDef =>
  base4({
    id: 'G4-F7-wallNoOpponent',
    milestone: 'G4-C',
    title: 'Runner requests 3 m/s forward into a diagnostic wall (no opponent): stopped, but no progressStopped',
    notes: 'Diagnostic static obstacle; low speed or an obstacle is not physical restraint by an opponent.',
    durationS: 3,
    rules: football(),
    obstacles: [{ id: 'wall', center: v3(0.6, 1, 0), halfExtents: v3(0.1, 1, 1.5) }],
    players: [solo('R', bodyG4(), { x: 0, z: 0, yawDeg: 90 }, [seg(0, v3(3, 0, 0), X)])],
  });
export const g4f7FreeRun = (): FixtureDef =>
  base4({
    id: 'G4-F7-freeRun',
    milestone: 'G4-C',
    title: 'Freely advancing runner (4 m/s, no opponent): no progressStopped',
    durationS: 2.5,
    rules: football(),
    players: [solo('R', bodyG4(), { x: -5, z: 0, yawDeg: 90 }, [seg(0, v3(4, 0, 0), X)])],
  });

/**
 * G4-F11 held-up stop: runner and defender drive chest to chest (each requests 2.5 m/s at full effort toward the
 * other). The runner keeps requesting forward; the defender's body resists; forward progress stops while both stay up.
 */
export const g4f11HeldUp = (): FixtureDef =>
  base4({
    id: 'G4-F11-heldUp',
    milestone: 'G4-C',
    title: 'Held-up upright stop: chest-to-chest drive; runner keeps requesting 2.5 m/s forward, progress stops',
    durationS: 6,
    rules: football(),
    players: [solo('R', bodyG4(), { x: -0.45, z: 0, yawDeg: 90 }, [seg(0, v3(2.5, 0, 0), X)]), solo('D', bodyG4(), { x: 0.45, z: 0, yawDeg: -90 }, [seg(0, v3(-2.5, 0, 0), NX)])],
  });
/**
 * G4-F11 resumed progress: same drive, but the defender steps aside (+Z at 3 m/s from 0.6 s, then stands from 1.2 s),
 * before the observation window can complete. The runner advances and reaches the practice safety edge.
 */
export const g4f11Resumed = (): FixtureDef =>
  base4({
    id: 'G4-F11-resumed',
    milestone: 'G4-C',
    title: 'Resumed progress: same chest-to-chest drive; the defender steps aside at 0.6 s and the runner advances',
    notes: 'Only the defender request from 0.6 s differs from G4-F11-heldUp.',
    durationS: 6,
    rules: football(),
    players: [
      solo('R', bodyG4(), { x: -0.45, z: 0, yawDeg: 90 }, [seg(0, v3(2.5, 0, 0), X)]),
      solo('D', bodyG4(), { x: 0.45, z: 0, yawDeg: -90 }, [seg(0, v3(-2.5, 0, 0), NX), seg(0.6, v3(0, 0, 3), NX), seg(1.2, v3(), NX)]),
    ],
  });
/**
 * G4-F11 sideline: the runner runs +X at 4 m/s parallel to the configured sideline plane z = +4 m (outward +Z) with
 * its COM at z = `z`. Ground touches come from the achieved-pose foot probes (the supported proxy has no foot
 * colliders); the virtual support hemisphere never counts.
 */
export function g4f11Sideline(z: number): FixtureDef {
  return base4({
    id: z >= 3.8 ? 'G4-F11-sidelineFoot' : 'G4-F11-sidelineClear',
    milestone: 'G4-C',
    title: `Sideline: runner at 4 m/s along the line with COM at z = ${z} m (plane z = 4 m, outward +Z)`,
    durationS: 2.5,
    rules: RULES_FOOTBALL('R', { forwardAxis: X, sidelineNormal: v3(0, 0, 1), sidelineOffsetM: 4, progress: false }),
    players: [solo('R', bodyG4(), { x: -5, z, yawDeg: 90, velocity: v3(4, 0, 0) }, [seg(0, v3(4, 0, 0), X)])],
  });
}

export function gate4Fixtures(): FixtureDef[] {
  return [
    g4f1(),
    g4f2('yaw90-spin', 90, v3(4, 0, 0), v3(0, 2, 0)),
    g4f2('yaw225-tumble', 225, v3(-2, 0, -2), v3(1.5, 0, -1)),
    g4f2('yaw0-tilt20', 0, v3(0, 0, 2.5), v3(1.2, 0.5, 0), 20),
    g4f6Joint(),
    g4f6Crowded(),
    g4f3TwoArm(),
    g4f3OneArm(),
    g4f3Failed(),
    g4f4('targetOnly'),
    g4f4('ownerOnly'),
    g4f4('simultaneous'),
    g4f4('invalidSurface'),
    g4f10('targetOnly'),
    g4f10('ownerOnly'),
    g4f10('simultaneous'),
    g4f5Standing(),
    g4f5TwoRagdolls(),
    g4f7LabCore(),
    g4f7Untouched(),
    g4f7FootBrace(),
    g4f7LimbFirst(),
    g4f7GroundedThenTouched(),
    g4f7DefenderFallsAlone(),
    g4f7Stationary(),
    g4f7Wall(),
    g4f7FreeRun(),
    g4f11HeldUp(),
    g4f11Resumed(),
    g4f11Sideline(3.85),
    g4f11Sideline(3.75),
  ];
}
