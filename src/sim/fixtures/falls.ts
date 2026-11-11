// L4 (plan 09): active falls, joint limits and role responses. Starting conditions, requests and labelled diagnostics
// only; nothing here reads an outcome. Every fixture opts into the envelope ragdoll, and into the fall response unless it
// is the motor-off twin of a comparison.
import type { FixtureDef, PlayerSetup } from '../fixture';
import { modelArm } from '../model/profiles';
import { ARM_G2, DEFAULT_MOTOR, ENVELOPE_L4, FALL_L4, JOINT_RANGE_V2, LEG_GUARD_V1, RAGDOLL_G4, RAGDOLL_L4, RULES_FOOTBALL, RULES_LAB_CORE, SELF_CLEARANCE_V1, SOLVER_G4_ZEROG, rulesRevision2, withPoseGuard, withSolvedImpulses, type FallResponseProfile } from '../profiles';
import { scale, v3, type Vec3 } from '../vec';
import { armsSetup } from './gate2';
import { base4, bodyG4, g4f3TwoArm, g4f6Joint } from './gate4';
import { mirrorZ } from './handoff-contact';
import { asModel } from './model';
import { transitionFixtures } from './transitions';

/** The fixture under an L4 identity, its own ragdoll gaining the envelope; `response` null is the motor-off twin. */
export function asL4(def: FixtureDef, id: string, title: string, response: FallResponseProfile | null = FALL_L4, notes?: string): FixtureDef {
  const fitted = def.ragdoll !== undefined && def.ragdoll !== RAGDOLL_G4;
  const ragdoll0 = fitted ? { ...def.ragdoll!, id: `${def.ragdoll!.id}+${ENVELOPE_L4.id}`, envelope: ENVELOPE_L4 } : RAGDOLL_L4;
  // contact motion M1: the plan 10c deep leg push (HC's pose guard) on every L4 ragdoll
  const ragdoll = ragdoll0.poseGuard ? ragdoll0 : withPoseGuard(ragdoll0);
  // a fixture without arms never met the limb contract: the response's shared allocator needs its fitted lengths too
  const armProfile = fitted && !def.players.some((p) => p.arms) ? modelArm(def.armProfile ?? ARM_G2) : def.armProfile;
  // plan 10e: L4 referees on the corrected rules revision (an L3 fixture's rules are on it already)
  return { ...def, id, milestone: 'L4', title, ragdoll, armProfile, fallResponse: response ?? undefined, selfClearance: SELF_CLEARANCE_V1, jointRange: JOINT_RANGE_V2, legGuard: LEG_GUARD_V1, solver: withSolvedImpulses(def.solver), ...(def.rules ? { rules: rulesRevision2(def.rules) } : {}), notes: [def.notes, notes].filter(Boolean).join(' ') };
}

type Dir = 'forward' | 'back' | 'side' | 'sideLeft' | 'oblique' | 'obliqueLeft';
const DIRS: Record<Dir, Vec3> = {
  forward: v3(0, 0, 1),
  back: v3(0, 0, -1),
  side: v3(1, 0, 0),
  sideLeft: v3(-1, 0, 0),
  oblique: v3(Math.SQRT1_2, 0, Math.SQRT1_2),
  obliqueLeft: v3(-Math.SQRT1_2, 0, Math.SQRT1_2),
};

/**
 * A lone player already tipping: leaned `leanDeg` toward `dir`, rotating that way at `spinRad` rad/s and moving at
 * `speedMps`, converted (labelled) at 0.05 s. The stated direction is where the body goes; what the fall does is its own.
 */
export function tippedFall(o: { id: string; dir: Dir; role?: 'runner' | 'defender'; speedMps?: number; leanDeg?: number; spinRad?: number; durationS?: number; arms?: PlayerSetup['arms'] }): FixtureDef {
  const d = DIRS[o.dir];
  const sp = o.speedMps ?? 2;
  const axis = v3(d.z, 0, -d.x); // up x dir
  const w = o.spinRad ?? 1.5;
  return base4({
    id: o.id,
    milestone: 'L4',
    title: `Tipped ${o.dir} fall`,
    notes: 'Diagnostic conversion at 0.05 s of a leaning, tipping player. Starting state only. No locomotion set (plan 13e): converted before it can stand.',
    durationS: o.durationS ?? 3,
    motor: DEFAULT_MOTOR,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.05 }] },
    players: [
      {
        id: 'R',
        role: o.role ?? 'runner',
        body: bodyG4(),
        initial: { x: 0, z: 0, yawDeg: 0, velocity: v3(d.x * sp, 0, d.z * sp), angularVelocity: v3(axis.x * w, 0, axis.z * w), leanDeg: o.leanDeg ?? 25, leanDirWorld: d },
        ...(o.arms ? { arms: o.arms } : {}),
        controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, 1), effort: 0 }] },
      },
    ],
  });
}

const l3 = (id: string): FixtureDef => {
  const d = transitionFixtures().find((x) => x.id === id);
  if (!d) throw new Error(`falls: no L3 fixture ${id}`);
  return d;
};
const setPlayer = (def: FixtureDef, id: string, over: (p: PlayerSetup) => PlayerSetup): FixtureDef => ({ ...def, players: def.players.map((p) => (p.id === id ? over(p) : p)) });

/** On and motor-off twins of one fall, `<id>-on` and `<id>-off`. */
const twins = (def: FixtureDef, id: string, title: string, response: FallResponseProfile = FALL_L4, notes?: string): FixtureDef[] => [asL4(def, `${id}-on`, `${title} (response on)`, response, notes), asL4(def, `${id}-off`, `${title} (motor-off twin)`, null, notes)];

// ------------------------------------------------------------------ L4-F1 limits under stated loads
export const LIMIT_TIMES = { approachS: [0.05, 1.9], loadS: [1.9, 3.3] } as const;

type LoadDef = { joint: string; axis: Vec3 } | { joint: string; limit: 'swing' | 'twist' };

/**
 * A lone ragdoll in labelled zero gravity, no contact, no muscle: a small labelled torque pair walks each joint up to its
 * limit, then the stated load holds it there. Shoulders and hips are pressed along their limit's own gradient; a hinge
 * along `axis` (on the child, parent frame).
 */
function limitLoad(o: { id: string; title: string; joints: LoadDef[]; approachNm: number; loadNm: number }): FixtureDef {
  const hinge = (fromS: number, toS: number, nm: number) => o.joints.flatMap((j) => ('axis' in j ? [{ playerId: 'R', joint: j.joint, fromS, toS, torqueParentNm: scale(j.axis, nm) }] : []));
  const limit = (fromS: number, toS: number, nm: number) => o.joints.flatMap((j) => ('limit' in j ? [{ playerId: 'R', joint: j.joint, fromS, toS, limit: j.limit, torqueNm: nm }] : []));
  const [a0, a1] = LIMIT_TIMES.approachS;
  const [l0, l1] = LIMIT_TIMES.loadS;
  // the load rises in steps over 0.4 s, so a stated load measures the limit and not the ring of a suddenly applied load
  const steps = Array.from({ length: 8 }, (_, i) => ({ fromS: l0 + i * 0.05, toS: i === 7 ? l1 : l0 + (i + 1) * 0.05, nm: o.approachNm + ((i + 1) / 8) * (o.loadNm - o.approachNm) }));
  return asL4(
    base4({
      id: o.id,
      milestone: 'L4',
      title: o.title,
      solver: SOLVER_G4_ZEROG,
      settleS: 0,
      durationS: 3.4,
      motor: DEFAULT_MOTOR,
      diagnostics: { conversions: [{ playerId: 'R', atS: 0.02 }], jointLoads: [...hinge(a0, a1, o.approachNm), ...steps.flatMap((t) => hinge(t.fromS, t.toS, t.nm))], limitLoads: [...limit(a0, a1, o.approachNm), ...steps.flatMap((t) => limit(t.fromS, t.toS, t.nm))] },
      players: [{ id: 'R', role: 'runner', body: bodyG4(), initial: { x: 0, z: 0, yawDeg: 0, lift: 2 }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, 1), effort: 0 }] } }],
    }),
    o.id,
    o.title,
    null,
    `Stated load: ${o.approachNm} N m walks the joint to its limit, then the load rises to ${o.loadNm} N m by ${l0 + 0.4} s and holds to ${l1} s.`,
  );
}

const both = (name: 'Shoulder' | 'Hip', limit: 'swing' | 'twist'): LoadDef[] => [{ joint: `left${name}`, limit }, { joint: `right${name}`, limit }];
export const l4f1 = (): FixtureDef[] => [
  limitLoad({ id: 'L4-F1-shoulderSwing', title: 'Shoulder swing limit under 30 N m, muscles off', joints: both('Shoulder', 'swing'), approachNm: 4, loadNm: 30 }),
  limitLoad({ id: 'L4-F1-shoulderTwist', title: 'Shoulder twist limit under 15 N m, muscles off', joints: both('Shoulder', 'twist'), approachNm: 0.3, loadNm: 15 }),
  limitLoad({ id: 'L4-F1-hipSwing', title: 'Hip swing limit under 60 N m, muscles off', joints: both('Hip', 'swing'), approachNm: 10, loadNm: 60 }),
  limitLoad({ id: 'L4-F1-hipTwist', title: 'Hip twist limit under 30 N m, muscles off', joints: both('Hip', 'twist'), approachNm: 1.5, loadNm: 30 }),
  limitLoad({ id: 'L4-F1-elbow', title: 'Native elbow limit under 30 N m, muscles off', joints: [{ joint: 'leftElbow', axis: v3(-1, 0, 0) }, { joint: 'rightElbow', axis: v3(-1, 0, 0) }], approachNm: 3, loadNm: 30 }),
  limitLoad({ id: 'L4-F1-knee', title: 'Native knee limit under 40 N m, muscles off', joints: [{ joint: 'leftKnee', axis: v3(-1, 0, 0) }, { joint: 'rightKnee', axis: v3(-1, 0, 0) }], approachNm: 5, loadNm: 40 }),
];

// ------------------------------------------------------------------ L4-F2 knee response
export const KNEE_ONLY: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-kneeOnly`, enable: { knee: true, hip: false, arms: false } };
export const l4f2 = (): FixtureDef[] =>
  (['forward', 'back', 'side'] as const).flatMap((dir) => [
    ...twins(tippedFall({ id: 'x', dir }), `L4-F2-${dir}`, `Knee flexion only, ${dir} fall`, KNEE_ONLY),
    ...twins(asModel(tippedFall({ id: 'x', dir })), `L4-F2-model-${dir}`, `Knee flexion only, ${dir} fall, installed player`, KNEE_ONLY),
  ]);

// ------------------------------------------------------------------ L4-F3 carrier with a free arm
export const l4f3 = (): FixtureDef[] => [
  ...twins(tippedFall({ id: 'x', dir: 'forward' }), 'L4-F3-forward', 'Carrier forward fall, free left arm'),
  ...twins(tippedFall({ id: 'x', dir: 'obliqueLeft' }), 'L4-F3-oblique', 'Carrier oblique fall toward the free left arm'),
  ...twins(tippedFall({ id: 'x', dir: 'sideLeft' }), 'L4-F3-side', 'Carrier sideways fall toward the free left arm'),
  ...twins(l3('L3-F9-convert-free'), 'L4-F3-run', 'Carrier converted in the free run, composed carry seat'),
  // the installed player's anatomical right is on -X, so +X falls go toward its free left arm
  ...twins(asModel(tippedFall({ id: 'x', dir: 'forward' })), 'L4-F3-model-forward', 'Carrier forward fall, installed player'),
  ...twins(asModel(tippedFall({ id: 'x', dir: 'oblique' })), 'L4-F3-model-oblique', 'Carrier oblique fall toward the free left arm, installed player'),
  ...twins(asModel(tippedFall({ id: 'x', dir: 'side' })), 'L4-F3-model-side', 'Carrier sideways fall toward the free left arm, installed player'),
];

// ------------------------------------------------------------------ L4-F4 braces that fail
/** A low box where the free hand would land: the arm meets it, not the floor. */
const obstructed = (): FixtureDef => ({ ...tippedFall({ id: 'x', dir: 'forward' }), obstacles: [{ id: 'box', center: v3(-0.42, 0.14, 0.75), halfExtents: v3(0.2, 0.14, 0.45) }] });
/** The holder of the two-palm drill as a ball carrier: right arm carrying, left palm holding, so no arm is free. */
const occupied = (): FixtureDef => {
  return setPlayer(setPlayer(l3('L3-F4-gripOwner'), 'D', (p) => ({ ...p, role: 'runner', arms: armsSetup('surfaceHold', null) })), 'R', (p) => ({ ...p, role: 'defender' }));
};
export const l4f4 = (): FixtureDef[] => [
  asL4(tippedFall({ id: 'x', dir: 'side' }), 'L4-F4-tooFar', 'Fall toward the carry arm: the free arm is on the far side'),
  asL4(tippedFall({ id: 'x', dir: 'oblique' }), 'L4-F4-late', 'Oblique fall toward the carry arm: the reach comes too late'),
  asL4(tippedFall({ id: 'x', dir: 'forward', speedMps: 6, leanDeg: 70, spinRad: 7 }), 'L4-F4-fast', 'Fast fall: too little time to brace'),
  asL4(obstructed(), 'L4-F4-obstructed', 'A box under the reaching hand'),
  asL4(occupied(), 'L4-F4-occupied', 'Carrier with no free arm: right carrying, left palm holding'),
];

// ------------------------------------------------------------------ L4-F5 holds, L4-F6 the last hold breaks
const onePalm = (): FixtureDef => setPlayer(l3('L3-F4-gripOwner'), 'D', (p) => ({ ...p, arms: armsSetup('surfaceHold', null) }));
export const l4f5 = (): FixtureDef[] => [
  ...twins(l3('L3-F4-gripOwner'), 'L4-F5-twoPalm', 'Holder with two palm holds converts'),
  ...twins(onePalm(), 'L4-F5-onePalm', 'Holder with one palm hold converts'),
  ...twins(l3('L3-F10-both'), 'L4-F5-twoClamp', 'Standing wrap, both convert with forearm clamps'),
  ...twins(l3('L3-F10-defender'), 'L4-F5-oneClamp', 'One-arm tackler converts in contact'),
];

/** The held player walks away from the falling holder: the hold ends on its own load, then the arm may brace. */
const breaking = (speed: number): FixtureDef => setPlayer(onePalm(), 'R', (p) => ({ ...p, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1) }, { fromS: 0.92, velocity: v3(0, 0, speed), facing: v3(0, 0, -1), effort: 1 }] } }));
export const l4f6 = (): FixtureDef[] => [asL4(breaking(5), 'L4-F6-break', 'The last hold breaks during the fall: the held player escapes at 5 m/s')];

// ------------------------------------------------------------------ L4-F7 saturation and zero caps
export const ZERO_CAP: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-zeroCap`, ceilingsNm: { shoulder: 0, elbow: 0, hip: 0, knee: 0 } };
const overcome = (): FixtureDef => {
  const d = tippedFall({ id: 'x', dir: 'forward' });
  const jointLoads = ['leftKnee', 'rightKnee'].map((joint) => ({ playerId: 'R', joint, fromS: 0.15, toS: 0.9, torqueParentNm: v3(-60, 0, 0) }));
  return { ...d, diagnostics: { ...d.diagnostics, jointLoads } };
};
export const l4f7 = (): FixtureDef[] => [
  asL4(tippedFall({ id: 'x', dir: 'forward' }), 'L4-F7-zeroCap', 'Every ceiling zero: the passive baseline', ZERO_CAP),
  asL4(tippedFall({ id: 'x', dir: 'forward' }), 'L4-F7-passive', 'Motor-off baseline of the zero-cap case', null),
  asL4(overcome(), 'L4-F7-overcome', 'A labelled 60 N m extension load overcomes the 22 N m knee ceiling'),
];

// ------------------------------------------------------------------ L4-F8 airborne torque pairs
const airborne = (id: string): FixtureDef =>
  base4({
    id,
    milestone: 'L4',
    title: 'Airborne response in labelled zero gravity, no contact',
    solver: SOLVER_G4_ZEROG,
    settleS: 0,
    durationS: 1.3,
    motor: DEFAULT_MOTOR,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.02 }] },
    players: [{ id: 'R', role: 'runner', body: bodyG4(), initial: { x: 0, z: 0, yawDeg: 0, lift: 3, velocity: v3(1, 0, 0.5), angularVelocity: v3(0.8, 0.3, -0.5) }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, 1), effort: 0 }] } }],
  });
export const l4f8 = (): FixtureDef[] => [asL4(airborne('x'), 'L4-F8-airborne', 'Airborne response, labelled zero gravity: internal torque pairs only'), asL4(airborne('x'), 'L4-F8-passive', 'Airborne motor-off twin, labelled zero gravity', null)];

// ------------------------------------------------------------------ L4-F9 boundaries
/** A standing player close enough that the handoff must choose an arm pose clear of it. */
const crowded = (): FixtureDef => {
  const d = tippedFall({ id: 'x', dir: 'forward' });
  return { ...d, players: [...d.players, { id: 'D', role: 'defender', body: bodyG4(), initial: { x: 0.1, z: 0.95, yawDeg: 180 }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1), effort: 1 }] } }] };
};
/** A copied validation profile whose 1 % energy allowance fails the transfer audit: the assembly stays as diagnostic state. */
const transferFailed = (): FixtureDef => {
  const d = asL4(g4f3TwoArm(), 'L4-F9-transferFailed', 'Failed transfer audit: no response on a ragdoll that was not accepted');
  return { ...d, ragdoll: { ...d.ragdoll!, id: `${d.ragdoll!.id}+energyGainFraction=0.01`, validation: { ...d.ragdoll!.validation, energyGainFraction: 0.01 } } };
};
export const l4f9 = (): FixtureDef[] => [
  ...['free', 'prep', 'contact', 'exit'].map((m) => asL4(l3(`L3-F9-convert-${m}`), `L4-F9-${m}`, `Conversion in ${m} with the response`)),
  asL4(l3('L3-F9-low'), 'L4-F9-low', 'Conversion in contact from a low runner with the response'),
  asL4(l3('L3-F9-defenderRising'), 'L4-F9-defenderRising', 'Defender converts on its rising bob with the response'),
  asL4(l3('L3-F9-defenderFalling'), 'L4-F9-defenderFalling', 'Defender converts on its falling bob with the response'),
  asL4(l3('L3-F10-both'), 'L4-F9-both', 'Both players convert with retention, with the response'),
  asL4(crowded(), 'L4-F9-crowded', 'Conversion against a standing player: the contact-safe arm pose starts outside the swing range'),
  asL4(g4f6Joint(), 'L4-F9-rejected', 'Rejected candidate: the passive falling proxy stays, with no response'),
  transferFailed(),
];

// ------------------------------------------------------------------ L4-F10 official endings
/** A tipped runner shoved from behind by a defender running through it: real influence, then the fall's own first touch. */
export function shoved(o: { dir: Dir; leanDeg: number; spinRad: number; speedMps: number; atS: number }): FixtureDef {
  const d = tippedFall({ id: 'x', dir: o.dir, leanDeg: o.leanDeg, spinRad: o.spinRad, speedMps: o.speedMps, durationS: 2.5 });
  const u = DIRS[o.dir];
  const sp = o.speedMps + 1.5;
  const yawDeg = (Math.atan2(u.x, u.z) * 180) / Math.PI;
  const D: PlayerSetup = {
    id: 'D',
    role: 'defender',
    body: bodyG4(),
    initial: { x: -u.x * 0.75, z: -u.z * 0.75, yawDeg, velocity: scale(u, sp) },
    controller: { kind: 'script', segments: [{ fromS: 0, velocity: scale(u, sp), facing: u, effort: 1 }] },
  };
  return { ...d, players: [...d.players, D], focus: { D: 'R' }, rules: RULES_FOOTBALL('R', { sideline: false, forwardAxis: u }), diagnostics: { conversions: [{ playerId: 'R', atS: o.atS }] }, area: { ...d.area, halfX: 14, halfZ: 14 } };
}

export const l4f10 = (): FixtureDef[] => [
  ...twins(shoved({ dir: 'forward', leanDeg: 50, spinRad: 1.5, speedMps: 4, atS: 0.15 }), 'L4-F10-knee', 'Shoved forward onto flexed knees'),
  ...twins(shoved({ dir: 'side', leanDeg: 30, spinRad: 4, speedMps: 2, atS: 0.15 }), 'L4-F10-elbow', 'Shoved sideways, the arm under the body'),
  ...twins(l3('L3-F4-twoArm'), 'L4-F10-wrap', 'Two-arm wrap to its ending'),
  ...twins({ ...tippedFall({ id: 'x', dir: 'forward' }), rules: RULES_LAB_CORE('R') }, 'L4-F10-palm', 'Palm brace before the core lands, core-down rule'),
];

// ------------------------------------------------------------------ L4-F11 settling and exhaustion
export const LOW_WORK: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-lowWork`, power: { ...FALL_L4.power, maxPositiveWorkJ: 8 } };
const disturbed = (): FixtureDef => {
  const d = tippedFall({ id: 'x', dir: 'forward', durationS: 4 });
  const forces = [0.45, 0.8, 1.15, 1.5, 2].map((fromS, i) => ({ playerId: 'R', fromS, toS: fromS + 0.08, forceWorld: v3(i % 2 ? 900 : -900, 2500, 0) }));
  return { ...d, diagnostics: { ...d.diagnostics, forces } };
};
export const l4f11 = (): FixtureDef[] => [
  asL4(tippedFall({ id: 'x', dir: 'forward', durationS: 5 }), 'L4-F11-settle', 'Fall and settle, 5 s: effort ends, the limits stay'),
  asL4(disturbed(), 'L4-F11-disturbed', 'Repeated labelled disturbances after the impact: no refill'),
  asL4(disturbed(), 'L4-F11-exhausted', 'Repeated disturbances on an 8 J work cap: exhausts and stays exhausted', LOW_WORK),
];

// ------------------------------------------------------------------ L4-F12 mirror
// (plan 10c C2: L4-F12-carryLeft is gone: it declared a left carry arm on a body that carries on the right, so the empty
// arm protected while the ball arm braced. A mirrored carry would be its own plan.)
export const l4f12 = (): FixtureDef[] => [
  asL4(tippedFall({ id: 'x', dir: 'oblique', role: 'defender' }), 'L4-F12-base', 'Oblique fall without a ball, base of the mirror pair'),
  asL4(mirrorZ(tippedFall({ id: 'x', dir: 'oblique', role: 'defender' })), 'L4-F12-mirror', 'Oblique fall without a ball, mirrored'),
];

export const fallFixtures = (): FixtureDef[] => [...l4f1(), ...l4f2(), ...l4f3(), ...l4f4(), ...l4f5(), ...l4f6(), ...l4f7(), ...l4f8(), ...l4f9(), ...l4f10(), ...l4f11(), ...l4f12()];
