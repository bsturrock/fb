// HC (plan 07a): ragdoll handoff during player contact. Focused variants of the required natural-contact cases on their
// adopted profiles (RH-F6-simultaneous and RH-F5-playerBelow on SUSPENSION_RH, L2-F14-oneArmFeet on SUSPENSION_L2 with
// the foot planner): mirrored, conversion-phase, bob-phase, drop-height and low-stance variants, both players falling in
// the stack, clear-space conversion on the adopted profile, and deliberately invalid / strict-transfer diagnostics.
// Requests, starting conditions and labelled diagnostics only; the simulation reads no fixture-specific offset or time.
import type { ArmSide, SegmentId, StanceRequest } from '../contracts';
import type { ControllerSpec, FixtureDef, PlayerSetup } from '../fixture';
import type { ArmScriptSegment, ScriptSegment } from '../controllers/base';
import { JOINT_RANGE_V1, LEG_GUARD_V1, ruleVariant, SELF_CLEARANCE_V1, withPoseGuard, type RuleProfile } from '../profiles';
import { rhf5PlayerBelow, rhf6, rhf7 } from './ride-height';
import { asL2, l2f14OneArmFeet, l2f15PlayerBelow, withFeet } from './footwork';
import { v3, type Vec3 } from '../vec';
import { FOOTWORK_L3 } from '../footwork';
import { LOCOMOTION_L3_IDLE } from '../locomotion';
import { withLocomotion } from './with-locomotion';

// ------------------------------------------------------------------ mirror across the world XZ-plane normal Z
// Reflection z -> -z: positions, velocities and world directions flip Z; yaw (facing = (sin, cos)) becomes 180 - yaw;
// angular velocity (a pseudo-vector) becomes (-x, -y, z); body-local points flip the lateral X; left and right swap
// (arms, plans, segments, the clip phase: 0 = left touchdown becomes 0.5 = right touchdown).
const mz = (p: Vec3): Vec3 => v3(p.x, p.y, -p.z);
const mxl = (p: Vec3): Vec3 => v3(-p.x, p.y, p.z);
const flip = (s: ArmSide): ArmSide => (s === 'left' ? 'right' : 'left');
const swap = <T>(r: { left: T; right: T }): { left: T; right: T } => ({ left: r.right, right: r.left });
const flipSeg = (s: SegmentId): SegmentId => (s.startsWith('left') ? (`right${s.slice(4)}` as SegmentId) : s.startsWith('right') ? (`left${s.slice(5)}` as SegmentId) : s);

function mirrorController(c: ControllerSpec): ControllerSpec {
  if (c.kind === 'script') {
    const seg = (s: ScriptSegment): ScriptSegment => ({
      ...s,
      velocity: mz(s.velocity),
      ...(s.facing && typeof s.facing === 'object' ? { facing: mz(s.facing) } : {}),
      ...(s.posture ? { posture: { ...s.posture, ...(s.posture.dir && typeof s.posture.dir === 'object' ? { dir: mz(s.posture.dir) } : {}) } } : {}),
    });
    const arm = (a: ArmScriptSegment): ArmScriptSegment => ({
      ...a,
      side: flip(a.side),
      ...(a.target ? { target: { frame: a.target.frame, point: a.target.frame === 'world' ? mz(a.target.point) : mxl(a.target.point) } } : {}),
    });
    return { ...c, segments: c.segments.map(seg), ...(c.arms ? { arms: c.arms.map(arm) } : {}) };
  }
  if (c.kind === 'wrapAttempt')
    return {
      ...c,
      plan: swap(c.plan),
      ...(c.aimLateralM !== undefined ? { aimLateralM: -c.aimLateralM } : {}),
      ...(c.approachVelocityWorld ? { approachVelocityWorld: mz(c.approachVelocityWorld) } : {}),
      ...(c.finish ? { finish: { ...c.finish, dirWorld: mz(c.finish.dirWorld) } } : {}),
    };
  throw new Error(`mirrorZ: controller ${c.kind} has no mirror`);
}

function mirrorPlayer(p: PlayerSetup, runClips: boolean): PlayerSetup {
  const i = p.initial;
  const phase = i.runPhase ?? (p.role === 'runner' ? 0 : 0.25);
  return {
    ...p,
    initial: {
      ...i,
      z: -i.z,
      yawDeg: 180 - i.yawDeg,
      ...(i.velocity ? { velocity: mz(i.velocity) } : {}),
      ...(i.angularVelocity ? { angularVelocity: v3(-i.angularVelocity.x, -i.angularVelocity.y, i.angularVelocity.z) } : {}),
      ...(i.leanDirWorld ? { leanDirWorld: mz(i.leanDirWorld) } : {}),
      ...(i.diagnosticImpulse ? { diagnosticImpulse: { impulse: mz(i.diagnosticImpulse.impulse), pointLocal: mxl(i.diagnosticImpulse.pointLocal) } } : {}),
      ...(runClips || i.runPhase !== undefined ? { runPhase: (phase + 0.5) % 1 } : {}),
    },
    ...(p.selectedShoulder ? { selectedShoulder: flip(p.selectedShoulder) } : {}),
    ...(p.arms ? { arms: { ...p.arms, enabled: swap(p.arms.enabled), mode: swap(p.arms.mode) } } : {}),
    controller: mirrorController(p.controller),
  };
}

const mirrorRules = (r: RuleProfile): RuleProfile => ruleVariant(r, 'mirror', { forwardAxis: mz(r.forwardAxis), ballLocal: mxl(r.ballLocal), sideline: { ...r.sideline, outwardNormal: mz(r.sideline.outwardNormal) } });

/** The same fixture reflected across the world z = 0 plane (the contact arrives on the other side of each body). */
export function mirrorZ(def: FixtureDef): FixtureDef {
  if (def.obstacles?.length) throw new Error(`mirrorZ: ${def.id} has obstacles`);
  const conv = def.diagnostics?.conversions?.map((c) => {
    if (c.edit && c.edit.kind !== 'jointMismatch') throw new Error(`mirrorZ: ${def.id} edit ${c.edit.kind} has no mirror`);
    return c.edit ? { ...c, edit: { ...c.edit, segment: flipSeg(c.edit.segment), offsetWorld: mz(c.edit.offsetWorld) } } : c;
  });
  return {
    ...def,
    players: def.players.map((p) => mirrorPlayer(p, !!def.runClips)),
    ...(def.rules ? { rules: mirrorRules(def.rules) } : {}),
    ...(def.diagnostics
      ? { diagnostics: { ...def.diagnostics, ...(conv ? { conversions: conv } : {}), ...(def.diagnostics.forces ? { forces: def.diagnostics.forces.map((f) => ({ ...f, forceWorld: mz(f.forceWorld) })) } : {}) } }
      : {}),
  };
}

// ------------------------------------------------------------------ helpers
// plan 13e: every HC fixture is on the player model and takes the full locomotion set (the L3 foot planner, the idle
// cycle, the walk and run clips); the support, carry, rules and diagnostics are its own. The title keeps the source's
// planner (the plan 07a identity it was built from)
const label = (def: FixtureDef, id: string, title: string, notes?: string): FixtureDef => ({
  ...withLocomotion(def),
  id,
  milestone: 'HC',
  selfClearance: SELF_CLEARANCE_V1,
  jointRange: JOINT_RANGE_V1,
  legGuard: LEG_GUARD_V1,
  title: `${title} [${def.support?.id ?? 'legacy'}${def.footwork ? ' + feet' : ''}]`,
  notes: [def.notes, notes, `Locomotion (plan 13e): ${FOOTWORK_L3.id}, ${LOCOMOTION_L3_IDLE.id}${def.footwork ? ` (was ${def.footwork.id})` : ' (was legacy legs)'}.`].filter(Boolean).join(' '),
});

/** Every player requests (and starts in) the stance, whatever its controller. */
export function withStance(def: FixtureDef, stance: StanceRequest, ids?: string[]): FixtureDef {
  return {
    ...def,
    players: def.players.map((p) => {
      if (ids && !ids.includes(p.id)) return p;
      const c = p.controller;
      const controller: ControllerSpec =
        c.kind === 'script' ? { ...c, segments: c.segments.map((s) => ({ ...s, stance: { ...stance } })) } : c.kind === 'wrapAttempt' ? { ...c, stance: { ...stance } } : c;
      if (controller === c) throw new Error(`withStance: controller ${c.kind} takes no stance`);
      return { ...p, initial: { ...p.initial, stance: { ...stance } }, controller };
    }),
  };
}

/** Low stance request: the bottom quarter of the support's target range (both players' requests). */
export const LOW: StanceRequest = { heightM: 0.78 };

const simultaneous = (): FixtureDef => rhf6().find((d) => d.id === 'RH-F6-simultaneous')!;

// ------------------------------------------------------------------ HC-F1 simultaneous conversion while wrapped
/** RH-F6-simultaneous with both conversions at `atS` (the wrap's clamp phase moves on; the standing wrap has no bob). */
const simAt = (atS: number): FixtureDef => {
  const d = simultaneous();
  return { ...d, diagnostics: { ...d.diagnostics, conversions: d.diagnostics!.conversions!.map((c) => ({ ...c, atS })) } };
};
export const hcf1 = (): FixtureDef[] => [
  label(mirrorZ(simultaneous()), 'HC-F1-mirror', 'Simultaneous conversions, mirrored: the canonical wrap from the other side (RH-F6-simultaneous reflected)'),
  label(simAt(0.9), 'HC-F1-at0.9', 'Simultaneous conversions earlier in the wrap: both converted at 0.9 s (RH-F6-simultaneous requests)'),
  label(simAt(1.6), 'HC-F1-at1.6', 'Simultaneous conversions later in the wrap: both converted at 1.6 s (RH-F6-simultaneous requests)'),
  label(withStance(simultaneous(), LOW), 'HC-F1-low', 'Simultaneous conversions from a low stance: both players request a 0.78 m root height throughout'),
  label(mirrorZ(withStance(simultaneous(), LOW)), 'HC-F1-lowMirror', 'Simultaneous conversions from a low stance, mirrored'),
];

// ------------------------------------------------------------------ HC-F2 stacked players
/** RH-F5-playerBelow with A spawned `lift` m above its standing height (and an optional lateral offset). */
const stack = (base: FixtureDef, lift: number, dx?: number): FixtureDef => ({
  ...base,
  players: base.players.map((p) => (p.id === 'A' ? { ...p, initial: { ...p.initial, lift, ...(dx !== undefined ? { x: dx } : {}) } } : p)),
});
/** Both players fall: a labelled diagnostic conversion of B at its first falling substep from `atS` (A pressing it down). */
const bothFall = (def: FixtureDef, atS: number): FixtureDef => ({
  ...def,
  diagnostics: { ...def.diagnostics, conversions: [...(def.diagnostics?.conversions ?? []), { playerId: 'B', atS, when: 'falling' }] },
  notes: [def.notes, 'Diagnostic conversion of B (labelled): both players fall.'].filter(Boolean).join(' '),
});
export const hcf2 = (): FixtureDef[] => [
  label(stack(rhf5PlayerBelow(), 1.4), 'HC-F2-lift1.4', 'Other player below, lower drop: A spawned 1.4 m above its standing height over B'),
  label(stack(rhf5PlayerBelow(), 3.0), 'HC-F2-lift3.0', 'Other player below, higher drop: A spawned 3.0 m above its standing height over B'),
  label(stack(rhf5PlayerBelow(), 2.2, 0.18), 'HC-F2-offset', "Other player below, off-centre: A spawned 2.2 m up, 0.18 m to B's side"),
  label(withStance(rhf5PlayerBelow(), LOW, ['B']), 'HC-F2-lowCarrier', 'Other player below, low carrier: B requests a 0.78 m root height throughout'),
  label(bothFall(rhf5PlayerBelow(), 0.45), 'HC-F2-bothFall', 'Both falling: RH-F5-playerBelow plus a labelled conversion of B at its first falling substep from 0.45 s'),
  label(bothFall(l2f15PlayerBelow(), 0.45), 'HC-F2-bothFallL2', 'Both falling on the repaired support: L2-F15-playerBelow plus a labelled conversion of B at its first falling substep from 0.45 s'),
];

// ------------------------------------------------------------------ HC-F3 one-arm defender with planted feet
const oneArm = (): FixtureDef => l2f14OneArmFeet();
export const defenderPhase = (def: FixtureDef, phase: number): FixtureDef => ({
  ...def,
  players: def.players.map((p) => (p.id === 'D' ? { ...p, initial: { ...p.initial, runPhase: phase } } : p)),
});
/** The running defender converted (labelled) at its first rising / falling substep from 0.7 s, in contact with the runner. */
export const defenderBob = (def: FixtureDef, when: 'rising' | 'falling'): FixtureDef => ({
  ...def,
  diagnostics: { ...def.diagnostics, conversions: [...(def.diagnostics?.conversions ?? []), { playerId: 'D', atS: 0.7, when }] },
  notes: [def.notes, `Diagnostic conversion of D (labelled) at the first ${when} substep from 0.7 s.`].filter(Boolean).join(' '),
});
export const hcf3 = (): FixtureDef[] => [
  label(mirrorZ(oneArm()), 'HC-F3-mirror', "One-arm tackle with planted feet, mirrored: the defender's line from the other side (L2-F14-oneArmFeet reflected)"),
  label(defenderPhase(oneArm(), 0), 'HC-F3-phase0', 'One-arm tackle with planted feet, defender clip phase 0.00 (L2-F14-oneArmFeet requests)'),
  label(defenderPhase(oneArm(), 0.5), 'HC-F3-phase50', 'One-arm tackle with planted feet, defender clip phase 0.50 (L2-F14-oneArmFeet requests)'),
  label(defenderPhase(oneArm(), 0.75), 'HC-F3-phase75', 'One-arm tackle with planted feet, defender clip phase 0.75 (L2-F14-oneArmFeet requests)'),
  label(defenderBob(oneArm(), 'rising'), 'HC-F3-rising', 'One-arm tackle with planted feet, defender converted in contact on its rising bob (labelled, first rising substep from 0.7 s)'),
  label(defenderBob(oneArm(), 'falling'), 'HC-F3-falling', 'One-arm tackle with planted feet, defender converted in contact on its falling bob (labelled, first falling substep from 0.7 s)'),
  label(withStance(oneArm(), LOW, ['R']), 'HC-F3-lowRunner', 'One-arm tackle with planted feet, low runner: the runner requests a 0.78 m root height throughout'),
];

// ------------------------------------------------------------------ HC-F4 clear-space conversion on the adopted profile
export const hcf4 = (): FixtureDef[] =>
  (['rising', 'falling'] as const).map((w) => {
    const f = rhf7(w);
    return label(withFeet(asL2(f, f.id, f.title)), `HC-F4-clear-${w}`, `Clear-space conversion on the repaired support with planted feet: Fast Run, labelled conversion from 0.6 s at the first ${w} substep`);
  });

// ------------------------------------------------------------------ HC-F5 invalid candidate / strict transfer
export const hcf5 = (): FixtureDef[] => {
  const s = simultaneous();
  const invalid: FixtureDef = {
    ...s,
    diagnostics: { ...s.diagnostics, conversions: s.diagnostics!.conversions!.map((c) => (c.playerId === 'D' ? { ...c, edit: { kind: 'jointMismatch' as const, segment: 'leftForearm' as const, offsetWorld: v3(0.05, 0, 0) } } : c)) },
  };
  const strict = (def: FixtureDef): FixtureDef => {
    const r = structuredClone(def.ragdoll!);
    r.validation.energyGainFraction = 0;
    r.validation.energyGainAbsJ = 0;
    r.id = `${r.id}+energyGain=0`;
    return { ...def, ragdoll: r };
  };
  return [
    label(invalid, 'HC-F5-invalidOne', "Invalid candidate in a simultaneous batch: D's candidate carries a labelled 5 cm forearm joint offset; R is revalidated against D's surviving proxy", 'Diagnostic candidate edit (labelled).'),
    label(strict(oneArm()), 'HC-F5-strictTransfer', 'Strict transfer audit: L2-F14-oneArmFeet with a copied validation profile allowing no energy gain', 'Diagnostic validation profile (labelled): any transfer energy gain fails the audit.'),
  ];
};

/**
 * Plan 10c (C6): every registered HC variant carries the convertible-pose guard, so its no-rigid-proxy guarantee holds
 * in both player orders. The base cases (RH-F5-playerBelow, L2-F15-playerBelow, ...) and fixtures derived from the
 * builders (L3-F11-invalid) keep their historical profiles.
 */
export function handoffContactFixtures(): FixtureDef[] {
  return [...hcf1(), ...hcf2(), ...hcf3(), ...hcf4(), ...hcf5()].map((d) => (d.ragdoll ? { ...d, ragdoll: withPoseGuard(d.ragdoll) } : d));
}
