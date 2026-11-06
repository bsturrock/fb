// L2 (plan 07): support recovery and contact footwork. Every fixture uses the bew-v6 model geometry and the repaired
// suspension (SUSPENSION_L2: SUSPENSION_RH plus the bounded load-release recovery), opted in explicitly. L2-F13..F15 re-run
// the 06a RH repair cases under the repaired profile (their RH fixtures keep SUSPENSION_RH as the incoming baseline).
import type { FixtureDef, PlayerSetup } from '../fixture';
import type { ScriptSegment } from '../controllers/base';
import { SUSPENSION_L2, SUSPENSION_L2_BRAKE, withBrakingLimit } from '../profiles';
import { FOOTWORK_L2 } from '../footwork';
import { rhf2Stagger, rhf3, rhf4Kick, rhf4Load, rhf5NoRescue, rhf5OutOfRange, rhf5PlayerBelow, rhf6, rhf6Defeat } from './ride-height';
import { asModel } from './model';
import { base4, bodyG4 } from './gate4';
import { v3, type Vec3 } from '../vec';

/** Opt an RH fixture into the repaired support under a new L2 identity (only the support profile and labels change). */
export function asL2(def: FixtureDef, id: string, title: string, notes?: string): FixtureDef {
  return {
    ...def,
    id,
    milestone: 'L2',
    title: `${title} [bew-v6 + repaired suspension]`,
    notes: [notes, `Support: ${SUSPENSION_L2.id} (06a suspension plus the bounded load-release recovery).`].filter(Boolean).join(' '),
    support: SUSPENSION_L2,
  };
}

/** The same fixture with the plan 07 foot planner (pose only: the physical requests are unchanged). */
export const withFeet = (def: FixtureDef): FixtureDef => ({
  ...def,
  footwork: FOOTWORK_L2,
  notes: [def.notes, `Footwork: ${FOOTWORK_L2.id} (per-foot plants and short steps; pose only).`].filter(Boolean).join(' '),
});
const feetL2 = (def: FixtureDef, id: string, title: string, notes?: string): FixtureDef => withFeet(asL2(def, id, title, notes));

/**
 * Plan 07 locomotion fixtures brake at most at 5.5 m/s^2 (user, 2026-11-05): the motor's braking component is capped
 * (withBrakingLimit) for the fixture motor and every player's own motor. Tackle and support-repair copies keep theirs.
 * Closeout item 4: the repaired support adds the braking stance (SUSPENSION_L2_BRAKE: lower while the controlled-braking
 * motor brakes against the travel); `lowStance: false` keeps SUSPENSION_L2 (comparisons).
 */
export function braked(def: FixtureDef, lowStance = true): FixtureDef {
  const low = lowStance && def.support === SUSPENSION_L2;
  return {
    ...def,
    motor: withBrakingLimit(def.motor),
    players: def.players.map((p) => (p.motor ? { ...p, motor: withBrakingLimit(p.motor) } : p)),
    ...(low ? { support: SUSPENSION_L2_BRAKE } : {}),
    notes: [
      def.notes,
      'Motor: braking limited to 5.5 m/s^2 against the actual travel.',
      low ? `Support: ${SUSPENSION_L2_BRAKE.id} (braking stance: toward ${SUSPENSION_L2_BRAKE.brakingStance!.heightM} m while braking).` : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}

const R1 = (initial: PlayerSetup['initial'], segments: ScriptSegment[]): PlayerSetup => ({ id: 'R', role: 'runner', body: bodyG4(), initial, controller: { kind: 'script', segments } });
const seg = (fromS: number, velocity: Vec3 = v3(), facing: Vec3 = v3(0, 0, 1), stance?: ScriptSegment['stance']): ScriptSegment => ({ fromS, velocity, facing, effort: 1, ...(stance ? { stance } : {}) });
const O = { x: 0, z: 0, yawDeg: 0 };

/** One-player model drill on the repaired suspension with the foot planner (G4 solver, balanced stance, ragdoll handoff). */
function solo(id: string, title: string, durationS: number, initial: PlayerSetup['initial'], segments: ScriptSegment[], over: Partial<FixtureDef> = {}, notes?: string): FixtureDef {
  return braked(feetL2(asModel(base4({ id, milestone: 'L2', title, durationS, players: [R1(initial, segments)], ...over })), id, title, notes));
}
const load = (fromS: number, toS: number, forceWorld: Vec3): Partial<FixtureDef> => ({ diagnostics: { forces: [{ playerId: 'R', fromS, toS, forceWorld }] } });

// ------------------------------------------------------------------ L2-F1 stance feasibility
export const l2f1 = (): FixtureDef[] => [
  solo('L2-F1-stand', 'Neutral stance: stand 3 s at the standing height', 3, O, [seg(0)]),
  braked(feetL2(rhf2Stagger(), 'L2-F1-stagger', 'Staggered stance: staggered crouch (0.82 m, left foot 0.30 m ahead) at 0.5 s, stand at 2.0 s (RH-F2-stagger requests)')),
  // stance levels (user, 2026-11-05): ready 0.89 m, intermediate 0.80 m, crouch 0.72 m (deeper lineman stances deferred)
  solo('L2-F1-crouch', 'Stance levels: ready 0.89 m, intermediate 0.80 m at 0.5 s, crouch 0.72 m at 1.5 s, ready again at 3.0 s', 4.0, O, [
    seg(0),
    seg(0.5, v3(), v3(0, 0, 1), { heightM: 0.8 }),
    seg(1.5, v3(), v3(0, 0, 1), { heightM: 0.72 }),
    seg(3.0, v3(), v3(0, 0, 1), { heightM: 0.89 }),
  ]),
  solo(
    'L2-F1-crouchHandoff',
    'Crouch handoff: crouch to 0.72 m at 0.5 s, labelled ragdoll conversion while holding it at 1.5 s',
    2.5,
    O,
    [seg(0), seg(0.5, v3(), v3(0, 0, 1), { heightM: 0.72 })],
    { diagnostics: { conversions: [{ playerId: 'R', atS: 1.5 }] } },
    'Diagnostic conversion (not a contact-caused fall): the candidate takes the achieved 0.72 m crouch pose and must pass the unchanged handoff audit.',
  ),
];

// ------------------------------------------------------------------ L2-F2 stationary loaded contact
export const l2f2 = (): FixtureDef =>
  solo(
    'L2-F2-loaded',
    'Stationary loaded contact: stand, labelled 700 N downward load at the COM from 0.5 to 3.5 s, 4 s',
    4,
    O,
    [seg(0)],
    load(0.5, 3.5, v3(0, -700, 0)),
    'Labelled diagnostic load (not a contact) inside the support capacity: the suspension compresses under it and recovers.',
  );

// ------------------------------------------------------------------ L2-F3 travel then stop
/**
 * Supplied run then stop (RH-F3-accelBrake requests) with the zero request at `brakeS` (2.6 s: the evidence fixture; other
 * times cross from the clip at other run phases): `controlled` uses the 5.5 m/s^2 braking motor, otherwise the original
 * (unbraked) motor's hard stop. 5.5 s.
 */
export function runStop(id: string, brakeS: number, controlled: boolean, title?: string): FixtureDef {
  const base = rhf3('accelBrake');
  const players = base.players.map((p) =>
    p.controller.kind === 'script' ? { ...p, controller: { ...p.controller, segments: p.controller.segments.map((g) => (g.fromS === 2.6 ? { ...g, fromS: brakeS } : g)) } } : p,
  );
  const how = controlled ? 'controlled braking (5.5 m/s^2 limit)' : 'original motor (hard stop)';
  const def = feetL2({ ...base, players }, id, title ?? `Supplied run then stop: stand 0.5 s, accelerate +X to 6 m/s, brake to a stop at ${brakeS} s, ${how} (L1-F2 / RH-F3-accelBrake requests), 5.5 s`);
  return { ...(controlled ? braked(def) : def), durationS: 5.5 };
}

/**
 * Closeout item 4 variants of the controlled run stop (braking stance): interrupted braking (zero request at 1.6 s,
 * 6 m/s again at 2.0 s while lowered, zero again at 2.8 s); and, braking at 2.0 s (room to land and settle before the
 * x = 8 m boundary), a labelled diagnostic conversion at 2.6 s in the lowered stance and a labelled 3 kN upward kick at
 * the COM over [2.6, 2.7) s in the lowered stance (genuine airborne recovery). 5.5 s.
 */
function runStopVariant(kind: 'reaccel' | 'handoff' | 'kick'): FixtureDef {
  if (kind === 'reaccel') {
    const base = rhf3('accelBrake');
    const players = base.players.map((p) =>
      p.controller.kind === 'script'
        ? {
            ...p,
            controller: {
              ...p.controller,
              segments: [...p.controller.segments.filter((g) => g.fromS < 1.6), { ...p.controller.segments[0], fromS: 1.6 }, { ...p.controller.segments[1], fromS: 2.0 }, { ...p.controller.segments[0], fromS: 2.8 }],
            },
          }
        : p,
    );
    const def = feetL2({ ...base, players }, 'L2-F3-runStopReaccel', 'Interrupted braking: accelerate +X to 6 m/s from 0.5 s, brake at 1.6 s, request 6 m/s again at 2.0 s (lowered), brake to a stop at 2.8 s, controlled braking, 5.5 s');
    return { ...braked(def), durationS: 5.5 };
  }
  const id = kind === 'handoff' ? 'L2-F3-runStopHandoff' : 'L2-F3-runStopKick';
  const title =
    kind === 'handoff'
      ? 'Run stop (brake at 2.0 s) with a labelled ragdoll conversion at 2.6 s in the lowered braking stance, controlled braking, 5.5 s'
      : 'Run stop (brake at 2.0 s) with a labelled 3 kN upward kick at the COM over 2.6-2.7 s in the lowered braking stance, controlled braking, 5.5 s';
  const def = runStop(id, 2.0, true, title);
  return {
    ...def,
    diagnostics: kind === 'handoff' ? { conversions: [{ playerId: 'R', atS: 2.6 }] } : { forces: [{ playerId: 'R', fromS: 2.6, toS: 2.7, forceWorld: v3(0, 3000, 0) }] },
    notes: [def.notes, kind === 'handoff' ? 'Diagnostic conversion (not a contact-caused fall): the candidate takes the achieved lowered braking pose and must pass the unchanged handoff audit.' : 'Labelled diagnostic kick: the support has zero authority outside its travel.'].join(' '),
  };
}

export const l2f3 = (): FixtureDef[] => [
  solo('L2-F3-walkStop', 'Slow forward travel then stop: request 1.2 m/s +Z from 0.5 to 2.5 s, then zero (braking), 4.5 s', 4.5, O, [seg(0), seg(0.5, v3(0, 0, 1.2)), seg(2.5)]),
  // 5.5 s (RH-F3 copy runs 4 s): the 5.5 m/s^2 braking limit stops a 6 m/s run in about 1.65 s, then the settle steps
  runStop('L2-F3-runStop', 2.6, true, 'Supplied run then stop: stand 0.5 s, accelerate +X to 6 m/s, brake to a stop at 2.6 s (L1-F2 / RH-F3-accelBrake requests), 5.5 s'),
  // plan 07 closeout item 3: the same run stopped by the original motor (no braking limit)
  runStop('L2-F3-runStopHard', 2.6, false),
  // closeout item 4: braking stance variants
  runStopVariant('reaccel'),
  runStopVariant('handoff'),
  runStopVariant('kick'),
];

// ------------------------------------------------------------------ L2-F4 backward drag
export const l2f4 = (): FixtureDef =>
  solo(
    'L2-F4-drag',
    'Backward drag: request 0.3 m/s forward (+Z) throughout; labelled 400 N backward (-Z) pull at the COM from 0.5 to 2.5 s, 3.5 s',
    3.5,
    O,
    [seg(0, v3(0, 0, 0.3))],
    load(0.5, 2.5, v3(0, 0, -400)),
    'Labelled diagnostic pull (not a contact): against the velocity drive (0.25 s response) it leaves the body moving backward at about 0.7 m/s while it requests 0.3 m/s forward.',
  );

// ------------------------------------------------------------------ L2-F5 side displacement and yaw
export const l2f5 = (): FixtureDef[] => [
  solo('L2-F5-sidePosX', 'Side travel toward +X (facing +Z): 0.8 m/s from 0.5 to 2.0 s, then stop, 3.5 s', 3.5, O, [seg(0), seg(0.5, v3(0.8, 0, 0)), seg(2.0)]),
  solo('L2-F5-sideNegX', 'Side travel toward -X (facing +Z): 0.8 m/s from 0.5 to 2.0 s, then stop, 3.5 s (mirror)', 3.5, O, [seg(0), seg(0.5, v3(-0.8, 0, 0)), seg(2.0)]),
  solo('L2-F5-yawPosX', 'Turn in place: facing +Z to +X at 0.5 s, stand, 3 s', 3, O, [seg(0), seg(0.5, v3(), v3(1, 0, 0))]),
  solo('L2-F5-yawNegX', 'Turn in place: facing +Z to -X at 0.5 s, stand, 3 s (mirror)', 3, O, [seg(0), seg(0.5, v3(), v3(-1, 0, 0))]),
];

// ------------------------------------------------------------------ L2-F6 swing then airborne
export const l2f6 = (): FixtureDef =>
  solo(
    'L2-F6-hop',
    'One planted / one swinging, then both airborne: walk 1.0 m/s +Z from 0.3 s; labelled 2600 N upward at the COM from 1.0 to 1.15 s; 3 s',
    3,
    O,
    [seg(0), seg(0.3, v3(0, 0, 1.0))],
    load(1.0, 1.15, v3(0, 2600, 0)),
    'Labelled diagnostic lift (not a contact) that takes the root out of probe travel during a step; support returns on landing.',
  );

// ------------------------------------------------------------------ L2-F7 sudden hip displacement
export const l2f7 = (): FixtureDef =>
  solo(
    'L2-F7-shove',
    'Sudden hip displacement: stand; labelled 3000 N sideways (+X) at the COM from 1.0 to 1.1 s (300 N s), 3 s',
    3,
    O,
    [seg(0)],
    load(1.0, 1.1, v3(3000, 0, 0)),
    'Labelled diagnostic shove (not a contact): the hips leave the planted feet faster than a step can follow.',
  );

// ------------------------------------------------------------------ L2-F8 support loss and falling
export const l2f8 = (): FixtureDef[] => [
  feetL2(rhf6Defeat().find((d) => d.id === 'RH-F6-sideLoss')!, 'L2-F8-sideLoss', 'Side hit, loss case: 7 m/s 12 deg defender into a 4 m/s runner (RH-F6-sideLoss requests)'),
  feetL2(rhf5NoRescue(), 'L2-F8-noRescue', 'No recovery after loss: labelled rejected conversion at 0.5 s leaves a falling proxy over valid turf (RH-F5-noRescue requests)'),
  feetL2(rhf5OutOfRange(), 'L2-F8-outOfRange', 'Ground out of range: spawned 0.35 m above standing, requesting 2 m/s +Z (RH-F5-outOfRange requests)'),
];

// ------------------------------------------------------------------ L2-F11 supplied running
export const l2f11 = (): FixtureDef[] => [
  braked(feetL2(rhf3('fastRun'), 'L2-F11-fastRun', 'Constant speed 5.8 m/s run +X from t = 0 (RH-F3-fastRun requests)')),
  braked(feetL2(rhf3('sprint'), 'L2-F11-sprint', 'Constant speed 6.6 m/s run +X from t = 0 (RH-F3-sprint requests)', 'Labelled sprint motor (requested-speed ceiling 6.8 m/s, default force).')),
];

// ------------------------------------------------------------------ L2-F12 slow procedural fallback
export const l2f12 = (): FixtureDef[] => [
  solo('L2-F12-slowForward', 'Slow forward: 1.0 m/s +Z (facing +Z) from 0.3 s, 3 s', 3, O, [seg(0), seg(0.3, v3(0, 0, 1.0))]),
  solo('L2-F12-slowSide', 'Slow side: 0.8 m/s +X (facing +Z) from 0.3 s, 3 s', 3, O, [seg(0), seg(0.3, v3(0.8, 0, 0))]),
  solo('L2-F12-slowBack', 'Slow backward: 0.8 m/s -Z (facing +Z) from 0.3 s, 3 s', 3, O, [seg(0), seg(0.3, v3(0, 0, -0.8))]),
];

// ------------------------------------------------------------------ L2-F13 load release
/** A labelled downward COM load on the standing RH-F4-load player (magnitude N, window s). */
const loadCase = (id: string, title: string, loadN: number, fromS: number, toS: number, durationS = 3): FixtureDef => {
  const b = rhf4Load();
  return asL2(
    { ...b, durationS, diagnostics: { forces: [{ playerId: 'R', fromS, toS, forceWorld: v3(0, -loadN, 0) }] } },
    id,
    title,
    `Labelled diagnostic load (not a contact) of ${loadN} N at the COM from ${fromS} to ${toS} s; the support ceiling is 3.5 BW (body weight plus 2452 N).`,
  );
};

/** RH-F4-load under the repaired support, plus shorter/longer compression and nearby magnitudes (L2-F13). */
export const loadReleaseFixtures = (): FixtureDef[] => [
  loadCase('L2-F13-load', 'Load release: labelled 3000 N downward at the COM from 0.5 to 1.0 s (RH-F4-load requests)', 3000, 0.5, 1.0),
  loadCase('L2-F13-loadShort', 'Load release, short compression: 3000 N from 0.5 to 0.7 s (released mid-descent)', 3000, 0.5, 0.7),
  loadCase('L2-F13-loadLong', 'Load release, long compression: 3000 N from 0.5 to 1.5 s', 3000, 0.5, 1.5, 3.5),
  loadCase('L2-F13-load2600', 'Load release, nearby magnitude: 2600 N from 0.5 to 1.0 s (just above the ceiling)', 2600, 0.5, 1.0),
  loadCase('L2-F13-load3400', 'Load release, nearby magnitude: 3400 N from 0.5 to 1.0 s', 3400, 0.5, 1.0),
  asL2(rhf4Kick('down'), 'L2-F13-kickDown', 'Abrupt disturbance: labelled 250 N s downward impulse at the COM at t = 0 (RH-F4-kickDown requests)'),
  asL2(rhf4Kick('up'), 'L2-F13-kickUp', 'Abrupt disturbance: labelled 200 N s upward impulse at the COM at t = 0 (RH-F4-kickUp requests); may leave travel, zero authority outside it'),
];

// ------------------------------------------------------------------ L2-F14 one-arm defender
export const l2f14OneArm = (): FixtureDef =>
  asL2(rhf6().find((d) => d.id === 'RH-F6-oneArm')!, 'L2-F14-oneArm', 'One-arm line tackle (L1-F6 / RH-F6-oneArm requests)');
/** The same requests with the foot planner: the handoff candidate is built from the planted-feet pose. */
export const l2f14OneArmFeet = (): FixtureDef => ({ ...withFeet(l2f14OneArm()), id: 'L2-F14-oneArmFeet', title: 'One-arm line tackle with the foot planner (L1-F6 / RH-F6-oneArm requests) [bew-v6 + repaired suspension]' });

// ------------------------------------------------------------------ L2-F15 loaded player
export const l2f15PlayerBelow = (): FixtureDef =>
  asL2(rhf5PlayerBelow(), 'L2-F15-playerBelow', "Other player below: A spawned 2.2 m above its standing height over B (RH-F5-playerBelow requests); B's probe stays valid and B may carry A within its finite support");

/**
 * Above-capacity carrier: the L2-F15 drop plus a labelled 2500 N downward load on B's COM from 0.6 to 1.0 s, while A is
 * on B (second impact): B's own weight, the passenger's contact load and the diagnostic load together exceed the 3.5 BW
 * ceiling, so the support is overcome (saturated, compressed onto the bump stop) without any automatic collapse rule.
 */
export const l2f15Overload = (): FixtureDef => {
  const b = l2f15PlayerBelow();
  return {
    ...b,
    id: 'L2-F15-overload',
    title: "Above-capacity carrier: the L2-F15 drop plus a labelled 2500 N downward load on B's COM from 0.6 to 1.0 s [bew-v6 + repaired suspension]",
    notes: `${b.notes} Labelled diagnostic load on B (not a contact).`,
    diagnostics: { forces: [{ playerId: 'B', fromS: 0.6, toS: 1.0, forceWorld: v3(0, -2500, 0) }] },
  };
};

export function footworkFixtures(): FixtureDef[] {
  return [
    ...l2f1(),
    l2f2(),
    ...l2f3(),
    l2f4(),
    ...l2f5(),
    l2f6(),
    l2f7(),
    ...l2f8(),
    ...l2f11(),
    ...l2f12(),
    ...loadReleaseFixtures(),
    l2f14OneArm(),
    l2f14OneArmFeet(),
    l2f15PlayerBelow(),
    l2f15Overload(),
  ];
}
