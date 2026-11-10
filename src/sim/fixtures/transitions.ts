// L3 (plan 08): locomotion transitions and automatic tackle integration. L2 and HC fixtures keep FOOTWORK_L2 unchanged; each
// L3 fixture opts into the composed planner and the locomotion profile under its own id, so the old path stays available
// for A/B comparison.
import type { FixtureDef, PlayerSetup } from '../fixture';
import type { ScriptSegment } from '../controllers/base';
import { CARRY_L3 } from '../carry';
import { FOOTWORK_L3 } from '../footwork';
import { IDLE_POSE_RECORD, LOCOMOTION_L3 } from '../locomotion';
import { JOINT_RANGE_V2, LEG_GUARD_V1, ruleVariant, rulesRevision2, SELF_CLEARANCE_V1, withPoseGuard } from '../profiles';
import { v3 } from '../vec';
import { asL2, l2f1, l2f3, l2f11, l2f12, l2f14OneArmFeet, runStop } from './footwork';
import { defenderBob, defenderPhase, hcf5, LOW, mirrorZ, withStance } from './handoff-contact';
import { g4f4 } from './gate4';
import { rhf5PlayerBelow, rhf6, rhf6Defeat } from './ride-height';
import { runClipsBew, runClipsL3 } from '../model/run-clips';
import { onModel, withLocomotion } from './with-locomotion';
import type { RunClipProfile } from '../run-clip';

/** The same fixture under a new L3 identity with the plan 08 transition composition. */
export function asL3(def: FixtureDef, id: string, title?: string, notes?: string): FixtureDef {
  // plan 13e: the player model takes the full locomotion set; the authored body keeps the plan 08 composition (static
  // fitted idle) and its source's clips, if any
  const model = onModel(def);
  const set = model
    ? withLocomotion(def)
    : { ...def, footwork: FOOTWORK_L3, locomotion: LOCOMOTION_L3, ...(def.runClips ? { runClips: runClipsL3(def.runClips) } : {}) };
  return {
    ...set,
    id,
    milestone: 'L3',
    title: title ?? def.title,
    carry: CARRY_L3,
    selfClearance: SELF_CLEARANCE_V1,
    jointRange: JOINT_RANGE_V2,
    legGuard: LEG_GUARD_V1,
    // contact motion M1: the plan 10c deep leg push (HC's pose guard) on the convertible L3 players as well
    ...(set.ragdoll && !set.ragdoll.poseGuard ? { ragdoll: withPoseGuard(set.ragdoll) } : {}),
    // plan 10e: L3 referees on the corrected rules revision
    ...(def.rules ? { rules: rulesRevision2(ruleVariant(def.rules, 'ballSource=carryPose', { ballSource: 'carryPose' })) } : {}),
    // plan 10b: a coached entry updates its phase before it aims (the gate 1 fixtures keep their order)
    players: def.players.map((p) => (p.controller.kind === 'coachedEntry' ? { ...p, controller: { ...p.controller, phaseFirst: true } } : p)),
    notes: [
      def.notes,
      notes,
      `Footwork: ${FOOTWORK_L3.id}; locomotion: ${set.locomotion!.id}; carry: ${CARRY_L3.id}.`,
      model ? '' : 'Authored body: no supplied clips or idle cycle (plan 13e: both are calibrated to the player model).',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

const pick = (defs: FixtureDef[], id: string): FixtureDef => defs.find((d) => d.id === id)!;
/** The fixture's first player with another role or scripted segments (evidence variants of the one-player drills). */
const playerOf = (def: FixtureDef, over: (p: PlayerSetup) => PlayerSetup): FixtureDef => ({ ...def, players: def.players.map((p, i) => (i === 0 ? over(p) : p)) });
const free = (def: FixtureDef): FixtureDef => playerOf(def, (p) => ({ ...p, role: 'defender' }));
const script = (def: FixtureDef, map: (segs: ScriptSegment[]) => ScriptSegment[]): FixtureDef =>
  playerOf(def, (p) => (p.controller.kind === 'script' ? { ...p, controller: { ...p.controller, segments: map(p.controller.segments) } } : p));
const ready = (def: FixtureDef): FixtureDef => script(def, (segs) => segs.map((g) => ({ ...g, readyHands: true })));

const stopTitle = (brakeS: number): string => `Run then stop: stand 0.5 s, accelerate +X to 6 m/s, brake at ${brakeS} s (5.5 m/s^2), settle, 5.5 s`;
const stop = (b: number): FixtureDef => runStop(`x${b}`, b, true);

// ------------------------------------------------------------------ L3-F13 idle, L3-F15 fitted posture
const stand = (): FixtureDef => pick(l2f1(), 'L2-F1-stand');
/** The walking stop on the supplied clips (its source has none). */
const walkStop = (): FixtureDef => ({ ...pick(l2f3(), 'L2-F3-walkStop'), runClips: runClipsBew() });
/** Stop into idle from a different gait phase (the stop time moves the last steps). */
const walkIdle = (b: number): FixtureDef => script(walkStop(), (segs) => segs.map((g) => (g.fromS === 2.5 ? { ...g, fromS: b } : g)));

export const l3f13 = (): FixtureDef[] => [
  asL3(stand(), 'L3-F13-carrier', 'Fitted idle, ball carrier: stand 3 s'),
  asL3(free(stand()), 'L3-F13-free', 'Fitted idle, no ball: stand 3 s'),
  asL3(ready(stand()), 'L3-F13-ready', 'Idle with ready hands: stand 3 s (ready assignment kept)'),
  ...[2.1, 2.3, 2.5, 2.7].map((b) => asL3(free(walkIdle(b)), `L3-F13-settle${b}`, `Walk 1.2 m/s +Z, stop at ${b} s into idle, no ball, 4.5 s`)),
];

export const l3f15 = (): FixtureDef[] => [
  asL3(script(stand(), (segs) => segs.map((g) => ({ ...g, stance: { staggerM: IDLE_POSE_RECORD.stance.leftForwardM * IDLE_POSE_RECORD.stance.legScale } }))), 'L3-F15-fitted', 'Supplied idle posture: fitted arms, width and left-foot stagger, stand 3 s', `Idle source ${IDLE_POSE_RECORD.sourceSha256}: frame ${IDLE_POSE_RECORD.frame} gives the stance, the ${IDLE_POSE_RECORD.cycle.periodS} s cycle plays.`),
  {
    ...asL3(free(stand()), 'L3-F15-handoff', 'Fitted idle with a labelled ragdoll conversion at 1.5 s, no ball, 2.5 s', 'Diagnostic conversion: the candidate takes the fitted idle pose and must pass the unchanged handoff audit.'),
    durationS: 2.5,
    diagnostics: { conversions: [{ playerId: 'R', atS: 1.5 }] },
  },
];

// ------------------------------------------------------------------ L3-F14 walking arms and transitions
const slow = (id: string): FixtureDef => pick(l2f12(), id);
/** Stand, walk, run on the supplied clips and stop along +X (the run-clip base keeps its room to stop). */
const walkRun = (arms: (d: FixtureDef) => FixtureDef): FixtureDef => {
  const X = v3(1, 0, 0);
  return arms(
    script({ ...runStop('x', 2.6, true), durationS: 6.5 }, () => [
      { fromS: 0, velocity: v3(), facing: X, effort: 1 },
      { fromS: 0.5, velocity: v3(1.2, 0, 0), facing: X, effort: 1 },
      { fromS: 2.0, velocity: v3(6, 0, 0), facing: X, effort: 1 },
      { fromS: 3.6, velocity: v3(), facing: X, effort: 1 },
    ]),
  );
};

export const l3f14 = (): FixtureDef[] => [
  asL3(free(walkStop()), 'L3-F14-forward', 'Walk forward 1.2 m/s on the supplied clip then stop, no ball, 4.5 s'),
  asL3(free(slow('L2-F12-slowBack')), 'L3-F14-backward', 'Procedural walk backward 0.8 m/s, no ball, 3 s'),
  asL3(free(slow('L2-F12-slowSide')), 'L3-F14-lateral', 'Procedural side walk 0.8 m/s, no ball, 3 s'),
  asL3(walkStop(), 'L3-F14-carrier', 'Walk forward on the supplied clip then stop, ball carrier (free left arm), 4.5 s'),
  asL3(ready(walkStop()), 'L3-F14-ready', 'Walk forward on the supplied clip then stop, ready hands, 4.5 s'),
  asL3(walkRun(free), 'L3-F14-walkRunStop', 'Idle, walk 1.2 m/s, run to 6 m/s at 2.0 s, stop at 3.6 s, settle, no ball, 6.5 s'),
  asL3(walkRun((d) => d), 'L3-F14-walkRunStopCarrier', 'Idle, walk, run, stop, settle, ball carrier, 6.5 s'),
  {
    ...asL3({ ...walkRun(free), durationS: 3 }, 'L3-F14-handoff', 'Walk then run, labelled ragdoll conversion at 2.2 s (walk-to-run blend), no ball', 'Diagnostic conversion from a walking arm pose inside the clip blend.'),
    diagnostics: { conversions: [{ playerId: 'R', atS: 2.2 }] },
  },
];

// ------------------------------------------------------------------ L3-F16 start, brake and settle
/** Interrupted braking and the audited variants, copied from the L2 evidence ids. */
const l2 = (id: string): FixtureDef => pick(l2f3(), id);
const variantBrake = (): number[] => [1.7, 1.9, 2.1, 2.3, 2.45, 2.75, 2.9, 3.05];

export const l3f16 = (): FixtureDef[] => [
  asL3(runStop('L2-F3-runStop', 2.6, true), 'L3-F16-runStop', stopTitle(2.6)),
  asL3(free(runStop('L2-F3-runStop', 2.6, true)), 'L3-F16-runStopFree', `${stopTitle(2.6)} (no ball: both arms free)`),
  asL3(ready(runStop('L2-F3-runStop', 2.6, true)), 'L3-F16-runStopReady', `${stopTitle(2.6)} (ready hands keep their assignment)`),
  asL3(runStop('L2-F3-runStopHard', 2.6, false), 'L3-F16-runStopHard', 'Run then stop with the original motor (hard stop comparison), 5.5 s'),
  asL3(stop(2.55), 'L3-F16-stop2.55', stopTitle(2.55), 'The plan 07 brake-phase variant (14.4 cm toe-off second difference).'),
  // a late brake runs on past the 8 m practice edge: the area is wider so the stop is seen to settle
  ...variantBrake().map((b) => asL3(b > 2.7 ? { ...stop(b), area: { ...stop(b).area, halfX: 12 } } : stop(b), `L3-F16-stop${b}`, stopTitle(b))),
  asL3(l2('L2-F3-runStopReaccel'), 'L3-F16-reaccel'),
  asL3(l2('L2-F3-runStopHandoff'), 'L3-F16-handoff'),
  asL3(l2('L2-F3-runStopKick'), 'L3-F16-kick'),
  asL3(pick(l2f11(), 'L2-F11-sprint'), 'L3-F16-sprint', 'Constant speed 6.6 m/s run +X from t = 0 through the composed path (the plan 06 top-speed self-overlap case)'),
  asL3(script(glance(0), (segs) => segs.map((g) => g).concat([{ fromS: 0.42, velocity: v3(), facing: v3(1, 0, 0), effort: 1 }])), 'L3-F16-contactStop', 'Braking interrupted by contact: the runner brakes from 0.42 s into the shoulder bump'),
];

// ------------------------------------------------------------------ contact composition (L3-F1..F12)
/** RH tackle copies on the repaired support; L3 takes them from there (their motors and winners are not fixture inputs). */
const rh = (id: string): FixtureDef => {
  const d = [...rhf6(), ...rhf6Defeat()].find((x) => x.id === id)!;
  return asL2(d, id, d.title);
};
const oneArm = (): FixtureDef => l2f14OneArmFeet();
const twoArm = (): FixtureDef => rh('RH-F6-twoArm');
const failed = (): FixtureDef => rh('RH-F6-failed');
const hold = (): FixtureDef => rh('RH-F6-simultaneous');
const collision = (): FixtureDef => rh('RH-F6-collision');
const setPlayer = (def: FixtureDef, id: string, over: Partial<PlayerSetup>): FixtureDef => ({ ...def, players: def.players.map((p) => (p.id === id ? { ...p, ...over } : p)) });

export const l3f1 = (): FixtureDef[] => [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => asL3(defenderPhase(oneArm(), i / 8), `L3-F1-phase${i}`, `Forced entry, one-arm tackle, defender clip phase ${i}/8`)),
  asL3(mirrorZ(defenderPhase(oneArm(), 0)), 'L3-F1-mirror0', 'Forced entry mirrored, defender clip phase 0'),
  asL3(mirrorZ(defenderPhase(oneArm(), 0.5)), 'L3-F1-mirror4', 'Forced entry mirrored, defender clip phase 4/8'),
  asL3(defenderBob(oneArm(), 'rising'), 'L3-F1-rising', 'Forced entry, defender labelled conversion on its rising bob'),
  asL3(defenderBob(oneArm(), 'falling'), 'L3-F1-falling', 'Forced entry, defender labelled conversion on its falling bob'),
  asL3(withStance(oneArm(), LOW, ['R']), 'L3-F1-low', 'Forced entry into a low runner (0.78 m stance)'),
];

/** A defender on a straight line that passes the runner at `missM` (no wrap request): it sees the runner and misses. */
const miss = (missM: number): FixtureDef => {
  const d = twoArm();
  const D = d.players.find((p) => p.id === 'D')!;
  const line = v3(0, 0, 1);
  return {
    ...setPlayer(d, 'D', { initial: { ...D.initial, x: D.initial.x + missM }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(0, 0, 7), facing: line, effort: 1, posture: { leanDeg: 12, dir: line } }] } }),
    rules: undefined,
    focus: undefined,
    durationS: 3,
    area: { ...d.area, halfZ: Math.max(d.area.halfZ, 18), halfX: Math.max(d.area.halfX, 12) },
  };
};
export const l3f2 = (): FixtureDef[] => [
  asL3(miss(1.3), 'L3-F2-miss', 'Anticipated entry that misses: a 7 m/s defender line passes 1.3 m ahead of the 4 m/s runner, 3 s'),
  asL3(mirrorZ(miss(1.3)), 'L3-F2-missMirror', 'Anticipated entry that misses, mirrored'),
];

export const l3f3 = (): FixtureDef[] => [
  asL3(rh('RH-F6-sideLoss'), 'L3-F3-side', 'Surprise lateral hit at speed: 7 m/s defender into the side of a 4 m/s runner'),
  asL3(mirrorZ(rh('RH-F6-sideLoss')), 'L3-F3-sideMirror', 'Surprise lateral hit at speed, mirrored'),
  asL3(rh('RH-F6-sideRecover'), 'L3-F3-recover', 'Lateral hit, recover case: 7 m/s defender into a 2 m/s runner'),
  asL3(collision(), 'L3-F3-collision', 'Head-on collision (the plan 06 contact-pop case)'),
];

/** The Gate 4 palm-hold drill under the composition: the contact fixtures above hold with forearm clamps alone. */
const grip = (kind: 'targetOnly' | 'ownerOnly' | 'simultaneous'): FixtureDef => {
  const d = g4f4(kind);
  return asL2(d, d.id, d.title);
};
export const l3f4 = (): FixtureDef[] => [
  asL3(twoArm(), 'L3-F4-twoArm', 'Shoulder plus two-arm wrap'),
  asL3(oneArm(), 'L3-F4-oneArm', 'Shoulder plus partial (one-arm) wrap'),
  asL3(grip('targetOnly'), 'L3-F4-gripTarget', 'Two palm holds through the composition, the held runner converts (labelled) at 0.9 s'),
  asL3(grip('ownerOnly'), 'L3-F4-gripOwner', 'Two palm holds through the composition, the holder converts (labelled) at 0.9 s'),
  asL3(grip('simultaneous'), 'L3-F4-gripBoth', 'Two palm holds through the composition, both convert (labelled) at 0.9 s'),
];

export const l3f5 = (): FixtureDef[] => [
  asL3(failed(), 'L3-F5-drag', 'Runner drives while the 3 m/s wrapping defender is dragged'),
  asL3(mirrorZ(failed()), 'L3-F5-dragMirror', 'Runner drives while the defender is dragged, mirrored'),
];

/** A labelled downward load on the COM of one player. */
const load = (playerId: string, fromS: number, toS: number): NonNullable<NonNullable<FixtureDef['diagnostics']>['forces']>[number] => ({ playerId, fromS, toS, forceWorld: v3(0, -3000, 0) });

/** The wrap of a standing runner without a finish drive: nobody moves anybody, the hold just lasts. */
const stillHold = (): FixtureDef => {
  const d = hold();
  const D = d.players.find((p) => p.id === 'D')!;
  return setPlayer(setPlayer(d, 'D', { controller: { ...D.controller, finish: undefined, standAfterS: 1, standEffort: 1 } as PlayerSetup['controller'] }), 'R', { controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(1, 0, 0), effort: 0.5 }] } });
};
export const l3f6 = (): FixtureDef[] => [
  { ...asL3(stillHold(), 'L3-F6-hold', 'Stationary contested hold: a standing runner wrapped, no finish drive, no conversion, 5 s'), diagnostics: undefined, durationS: 5, rules: undefined },
  { ...asL3(mirrorZ(stillHold()), 'L3-F6-holdMirror', 'Stationary contested hold, mirrored'), diagnostics: undefined, durationS: 5, rules: undefined },
  { ...asL3(stillHold(), 'L3-F6-saturated', 'Support saturation during a wrap: a labelled 3 kN downward load on the runner from 2 to 3 s, released in the hold, 5 s', 'The compression-release launch must not return when the load goes.'), diagnostics: { forces: [load('R', 2, 3)] }, durationS: 5, rules: undefined },
];

/**
 * A running shoulder bump that ends (the run goes on): a defender alongside the 5.8 m/s runner drifts in at 1.9 m/s from
 * `fromS`, touches and veers away. `side` is the runner's side.
 */
const bumpScript = (fromS: number, side: number): ScriptSegment[] => {
  const X = v3(1, 0, 0);
  const along = 4.6;
  return [
    { fromS: 0, velocity: v3(along, 0, 0), facing: X, effort: 1 },
    { fromS, velocity: v3(along, 0, -1.9 * side), facing: X, effort: 1 },
    { fromS: fromS + 0.6, velocity: v3(along, 0, 2.2 * side), facing: X, effort: 1 },
  ];
};
const glance = (runPhase: number): FixtureDef => {
  const d = collision();
  const R = d.players.find((p) => p.id === 'R')!;
  const D = d.players.find((p) => p.id === 'D')!;
  return {
    ...setPlayer(setPlayer(d, 'R', { initial: { ...R.initial, runPhase } }), 'D', {
      initial: { ...D.initial, x: R.initial.x + 0.5, z: 1.1, yawDeg: 90, velocity: v3(4.6, 0, 0) },
      controller: { kind: 'script', segments: bumpScript(0.01, 1) },
    }),
    durationS: 2.4,
    area: { ...d.area, halfX: Math.max(d.area.halfX, 14) },
  };
};
export const l3f7 = (): FixtureDef[] => [
  ...[0, 0.25, 0.5, 0.75].map((u) => asL3(glance(u), `L3-F7-phase${Math.round(u * 100)}`, `Contact releases: a running shoulder bump that ends, runner clip phase ${u}`)),
  ...[0, 0.5].map((u) => asL3(mirrorZ(glance(u)), `L3-F7-mirror${Math.round(u * 100)}`, `Contact releases, mirrored, runner clip phase ${u}`)),
  asL3({ ...glance(0), diagnostics: { forces: [load('R', 0.5, 0.95)] } }, 'L3-F7-loadRelease', 'A labelled 3 kN downward load through contact, released during exit', 'The compression-release launch must not return in the exit.'),
];

/** A second bump from the other side, its drift starting at `fromS`. */
const second = (def: FixtureDef, fromS: number): FixtureDef => {
  const R = def.players.find((p) => p.id === 'R')!;
  const D = def.players.find((p) => p.id === 'D')!;
  const lead = 1.2 * (fromS + 0.56) - 0.18;
  return { ...def, players: [...def.players, { ...D, id: 'D2', initial: { ...D.initial, x: R.initial.x + lead, z: -1.1 }, controller: { kind: 'script', segments: bumpScript(fromS, -1) } }] };
};
export const l3f8 = (): FixtureDef[] => [asL3(second(glance(0), 0.34), 'L3-F8-recontact', 'New contact during exit: a second bump from the other side while the first is unwinding')];

const up = (fromS: number): FixtureDef['diagnostics'] => ({ forces: [{ playerId: 'R', fromS, toS: fromS + 0.1, forceWorld: v3(0, 3000, 0) }] });
const conversionAt = (atS: number): FixtureDef['diagnostics'] => ({ conversions: [{ playerId: 'R', atS }] });
/** Times of the modes in the bump (free run, preparation, contact, exit), measured from L3-F7-phase0. */
const MODES: [string, number][] = [
  ['free', 0.2],
  ['prep', 0.45],
  ['contact', 0.65],
  ['exit', 0.82],
];
/** When the upward load starts so that the probe loses its support inside the mode: about 0.11-0.14 s later (measured). */
const LIFTS: [string, number][] = [
  ['free', 0.2],
  ['prep', 0.3],
  ['contact', 0.5],
  ['exit', 0.64],
];
/** A non-turf box the runner reaches at `t`: the probe finds no support on it. */
const noProbe = (def: FixtureDef, t: number): FixtureDef => {
  const R = def.players.find((p) => p.id === 'R')!;
  const x = R.initial.x + 5.8 * t + 2;
  return { ...def, obstacles: [{ id: 'noTurf', center: v3(x, 0.02, -0.2), halfExtents: v3(2, 0.02, 0.7) }] };
};
export const l3f9 = (): FixtureDef[] => [
  ...LIFTS.map(([m, t]) => asL3({ ...glance(0), diagnostics: up(t) }, `L3-F9-lift-${m}`, `Temporary airborne recovery in ${m}: a labelled 3 kN upward load at the runner's COM from ${t} s for 0.1 s lifts the probe off its support, the runner lands and runs on`, 'No conversion: this is not an irreversible fall (those are L3-F9-convert-* and L3-F9-noProbe-*).')),
  ...MODES.map(([m, t]) => asL3({ ...glance(0), diagnostics: conversionAt(t) }, `L3-F9-convert-${m}`, `Conversion in ${m}: labelled ragdoll conversion of the runner at ${t} s`)),
  ...MODES.map(([m, t]) => asL3(noProbe(glance(0), Math.max(0, t - 0.19)), `L3-F9-noProbe-${m}`, `Loss of probe support in ${m}: a non-turf strip under the runner, reached 0.19 s (the supported grace) before ${t} s`)),
  asL3(withStance({ ...glance(0), diagnostics: conversionAt(MODES[2][1]) }, LOW, ['R']), 'L3-F9-low', 'Conversion in contact from a low runner (0.78 m stance)'),
  asL3(defenderBob(oneArm(), 'rising'), 'L3-F9-defenderRising', 'The formerly hinge-invalid one-arm defender converts on its rising bob'),
  asL3(defenderBob(oneArm(), 'falling'), 'L3-F9-defenderFalling', 'The formerly hinge-invalid one-arm defender converts on its falling bob'),
  asL3(rhf5PlayerBelow(), 'L3-F9-playerBelow', 'Player-below load: a support-budget regression, the carrier need not fall'),
];

export const l3f10 = (): FixtureDef[] => [
  asL3(hold(), 'L3-F10-both', 'Both players convert with retention (standing wrap)'),
  asL3(mirrorZ(hold()), 'L3-F10-bothMirror', 'Both players convert with retention, mirrored'),
  asL3(withStance(hold(), LOW), 'L3-F10-bothLow', 'Both players convert with retention from a low stance'),
  asL3(defenderBob(hold(), 'rising'), 'L3-F10-rising', 'Both convert with retention, defender on its rising bob'),
  asL3(defenderBob(hold(), 'falling'), 'L3-F10-falling', 'Both convert with retention, defender on its falling bob'),
  asL3(defenderBob(oneArm(), 'rising'), 'L3-F10-defender', 'The formerly hinge-invalid one-arm defender converts in contact'),
];

export const l3f11 = (): FixtureDef[] => [asL3(hcf5()[0], 'L3-F11-invalid', 'Candidate rejected for a genuine bad pose: a labelled 5 cm forearm joint offset in a simultaneous batch')];

// ------------------------------------------------------------------ L3-F17 run start over steps
/**
 * The request rises at the supplied Idle To Sprint's speed curve (about 6 m/s^2 up to speed), so a start from rest goes
 * through the walk into the run. Opt-in: the contact and stop copies keep the timing of the fixtures they copy.
 */
const startRamp = (d: FixtureDef): FixtureDef => ({ ...d, runClips: { ...d.runClips!, id: `${d.runClips!.id}+start6`, walk: { ...d.runClips!.walk!, startMps2: 6 } } });

export const l3f17 = (): FixtureDef[] => [
  startRamp(asL3(runStop('L2-F3-runStop', 2.6, true), 'L3-F17-runStart', 'Stand, start foot by foot at 6 m/s^2 into the run, stop at 2.6 s, ball carrier, 5.5 s')),
  startRamp(asL3(free(runStop('L2-F3-runStop', 2.6, true)), 'L3-F17-runStartFree', 'Stand, start foot by foot at 6 m/s^2 into the run, stop at 2.6 s, no ball, 5.5 s')),
];

// ------------------------------------------------------------------ L3-F18 run lab (plan 14)
/** Plan 14: the run lab's fixture; the lab opens its speed and keyframe panel on this id (src/lab/run-lab.ts). */
export const RUN_LAB_ID = 'L3-F18-runLab';

export interface RunLabOptions {
  /** Constant requested speed +X from t = 0, and the initial velocity (m/s). */
  speedMps: number;
  durationS: number;
  /** Start position on x (m); the practice area's half length (m). */
  startX: number;
  halfX: number;
  /** Ball carrier (the carry pose holds one arm) or no ball (both arms swing from the clip). */
  ball: boolean;
  /** Run-clip profile in place of the fixture's (the lab's edited Fast Run). */
  runClips?: RunClipProfile;
}

/** The registered run lab: 5 m/s, no ball, 6 s. */
export const RUN_LAB_DEFAULT: RunLabOptions = { speedMps: 5, durationS: 6, startX: -30, halfX: 40, ball: false };

/**
 * Plan 14: one player on the model running +X at a constant request on the full L3 set (the L3-F16-sprint source: the
 * sprint motor, ceiling 6.8 m/s). The lab builds its own copies (a long area, the live speed, the edited clip); the
 * registered one is the default.
 */
export function runLab(o: RunLabOptions = RUN_LAB_DEFAULT): FixtureDef {
  const v = v3(o.speedMps, 0, 0);
  const base = asL3(
    pick(l2f11(), 'L2-F11-sprint'),
    RUN_LAB_ID,
    `Run lab: constant ${o.speedMps} m/s run +X from t = 0, ${o.ball ? 'ball carrier' : 'no ball'}, ${o.durationS} s`,
    'The lab drives the speed live and plays edited Fast Run keyframes on this fixture (plan 14).',
  );
  return {
    ...base,
    durationS: o.durationS,
    area: { ...base.area, halfX: o.halfX },
    ...(o.runClips ? { runClips: o.runClips } : {}),
    players: base.players.map((p) => ({
      ...p,
      role: o.ball ? 'runner' : 'defender',
      initial: { ...p.initial, x: o.startX, velocity: v },
      controller: { kind: 'script', segments: [{ fromS: 0, velocity: v, facing: v3(1, 0, 0), effort: 1 }] },
    })),
  };
}

export const transitionFixtures = (): FixtureDef[] => [...l3f1(), ...l3f2(), ...l3f3(), ...l3f4(), ...l3f5(), ...l3f6(), ...l3f7(), ...l3f8(), ...l3f9(), ...l3f10(), ...l3f11(), ...l3f13(), ...l3f14(), ...l3f15(), ...l3f16(), ...l3f17(), runLab()];
