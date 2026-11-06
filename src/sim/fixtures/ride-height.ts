// RH (plan 06a): physical ride height and support. Every fixture uses the bew-v6 model geometry and the ground-probed
// suspension support (SUSPENSION_RH), opted in explicitly; requests and starting conditions only. RH-F6 re-runs legacy
// G4-M / L1 drills with the same requests under the suspension so their outcomes can be compared with the legacy
// capsule-floor support; RH-F3 is the suspension version of L1-F1 / L1-F2.
import type { FixtureDef, PlayerSetup } from '../fixture';
import type { ScriptSegment } from '../controllers/base';
import { SUSPENSION_RH, type SuspensionSupport } from '../profiles';
import { asModel } from './model';
import { asG4, base4, bodyG4, g4f10, g4f3Failed, g4f3OneArm, g4f3TwoArm } from './gate4';
import { g3f1, g3f3Side, g3f5 } from './gate3';
import { l1f1, l1f2, l1f3, withRunClips } from './locomotion';
import { v3, type Vec3 } from '../vec';

/** Opt a model-geometry fixture into the suspension support (only the support profile and identity change). */
export function withSuspension(def: FixtureDef, id: string, title: string, notes?: string, S: SuspensionSupport = SUSPENSION_RH): FixtureDef {
  return {
    ...def,
    id,
    milestone: 'RH',
    title: `${title} [bew-v6 + suspension]`,
    notes: [notes, `Support: ${S.id} (ground-probed suspension; the support capsule no longer touches static ground).`].filter(Boolean).join(' '),
    support: S,
  };
}

const player = (id: string, role: 'runner' | 'defender', initial: PlayerSetup['initial'], segments: ScriptSegment[]): PlayerSetup => ({
  id,
  role,
  body: bodyG4(),
  initial,
  controller: { kind: 'script', segments },
});
const R1 = (initial: PlayerSetup['initial'], segments: ScriptSegment[]): PlayerSetup => player('R', 'runner', initial, segments);
const stand = (fromS: number, facing: Vec3 = v3(0, 0, 1), heightM?: number, staggerM?: number): ScriptSegment => ({
  fromS,
  velocity: v3(),
  facing,
  effort: 1,
  ...(heightM !== undefined || staggerM !== undefined ? { stance: { heightM, staggerM } } : {}),
});

/** One-player model drill on the suspension (G4 solver, balanced stance, ragdoll handoff available). */
function solo(id: string, title: string, durationS: number, initial: PlayerSetup['initial'], segments: ScriptSegment[], over: Partial<FixtureDef> = {}, notes?: string): FixtureDef {
  return withSuspension(asModel(base4({ id, milestone: 'RH', title, durationS, players: [R1(initial, segments)], ...over })), id, title, notes);
}

// ------------------------------------------------------------------ RH-F1 standing
export const rhf1Stand = (): FixtureDef => solo('RH-F1-stand', 'Standing equilibrium: stand 3 s at the standing height', 3, { x: 0, z: 0, yawDeg: 0 }, [stand(0)]);
export const rhf1Drop = (): FixtureDef =>
  solo('RH-F1-drop', 'Settling: spawned 4 cm above the standing height, stand 3 s', 3, { x: 0, z: 0, yawDeg: 0, lift: 0.04 }, [stand(0)], {}, 'Reset placement 4 cm high (inside travel): the suspension settles it.');
export const rhf1Lean = (): FixtureDef =>
  solo(
    'RH-F1-lean',
    'Supported lean: initial 8 deg forward lean, posture request 8 deg forward, 3 s',
    3,
    { x: 0, z: 0, yawDeg: 0, leanDeg: 8 },
    [{ ...stand(0), posture: { leanDeg: 8, dir: 'facing' } }],
    {},
    'Initial lean placed about the support point (the ground point at probe depth along the body axis).',
  );

// ------------------------------------------------------------------ RH-F2 stances
export const rhf2Crouch = (): FixtureDef =>
  solo('RH-F2-crouch', 'Stand, crouch to 0.80 m at 0.5 s, stand again at 2.0 s', 3.5, { x: 0, z: 0, yawDeg: 0 }, [stand(0), stand(0.5, v3(0, 0, 1), 0.8), stand(2.0)]);
export const rhf2Stagger = (): FixtureDef =>
  solo('RH-F2-stagger', 'Stand, staggered crouch (0.82 m, left foot 0.30 m ahead) at 0.5 s, stand again at 2.0 s', 3.5, { x: 0, z: 0, yawDeg: 0 }, [
    stand(0),
    stand(0.5, v3(0, 0, 1), 0.82, 0.3),
    stand(2.0),
  ]);

// ------------------------------------------------------------------ RH-F3 running (suspension versions of L1-F1 / L1-F2)
export const rhf3 = (kind: 'fastRun' | 'sprint' | 'accelBrake'): FixtureDef => {
  const id = `RH-F3-${kind}`;
  if (kind === 'accelBrake') return withSuspension(l1f2(), id, 'Stand 0.5 s, accelerate +X to 6 m/s, brake to a stop at 2.6 s (L1-F2 requests)');
  const v = kind === 'fastRun' ? 5.8 : 6.6;
  return withSuspension(l1f1(kind), id, `Constant speed ${v} m/s run +X from t = 0 (L1-F1-${kind} requests)`, kind === 'sprint' ? 'Labelled sprint motor (requested-speed ceiling 6.8 m/s, default force).' : undefined);
};

// ------------------------------------------------------------------ RH-F4 limits
export const rhf4Range = (): FixtureDef =>
  solo('RH-F4-range', 'Requests outside the target range: 0.60 m at 0.5 s, 1.10 m at 1.5 s, standing at 2.5 s', 3.5, { x: 0, z: 0, yawDeg: 0 }, [
    stand(0),
    stand(0.5, v3(0, 0, 1), 0.6),
    stand(1.5, v3(0, 0, 1), 1.1),
    stand(2.5),
  ]);
export const rhf4Load = (): FixtureDef =>
  solo(
    'RH-F4-load',
    'Excessive load: labelled 3000 N downward force at the COM from 0.5 to 1.0 s on a standing player',
    3,
    { x: 0, z: 0, yawDeg: 0 },
    [stand(0)],
    { diagnostics: { forces: [{ playerId: 'R', fromS: 0.5, toS: 1.0, forceWorld: v3(0, -3000, 0) }] } },
    'Labelled diagnostic load (not a contact): body weight plus 3000 N exceeds the 3.5 BW support ceiling, so the suspension is overcome and the guard bottoms out.',
  );
export const rhf4Kick = (dir: 'down' | 'up'): FixtureDef =>
  solo(
    `RH-F4-kick${dir === 'down' ? 'Down' : 'Up'}`,
    `Abrupt disturbance: labelled ${dir === 'down' ? '250 N s downward' : '200 N s upward'} impulse at the COM at t = 0, stand 3 s`,
    3,
    { x: 0, z: 0, yawDeg: 0, diagnosticImpulse: { impulse: v3(0, dir === 'down' ? -250 : 200, 0), pointLocal: v3(0, 0.221, 0.008) } },
    [stand(0)],
    {},
    'Labelled diagnostic impulse (not a contact).',
  );

// ------------------------------------------------------------------ RH-F5 no false support
export const rhf5OutOfRange = (): FixtureDef =>
  solo(
    'RH-F5-outOfRange',
    'Ground out of range: spawned 0.35 m above the standing height requesting 2 m/s +Z; support only once back inside travel',
    2.5,
    { x: 0, z: 0, yawDeg: 0, lift: 0.35 },
    [{ fromS: 0, velocity: v3(0, 0, 2), facing: v3(0, 0, 1), effort: 1 }],
  );
export const rhf5InvalidNormal = (): FixtureDef =>
  solo(
    'RH-F5-invalidNormal',
    'Invalid normal: the player stands over a 30 deg turf slope patch (outside the 20 deg normal limit)',
    2.5,
    { x: 0, z: 0, yawDeg: 0 },
    [stand(0)],
    { obstacles: [{ id: 'slope30', center: v3(0, 0, 0), halfExtents: v3(1.2, 0.05, 1.2), rollDeg: 30, surface: 'turf' }] },
    'Diagnostic turf patch tilted 30 deg about Z.',
  );
export const rhf5Obstacle = (): FixtureDef =>
  solo(
    'RH-F5-obstacle',
    'Invalid surface: the player stands over a static non-turf box (top 0.10 m)',
    2.5,
    { x: 0, z: 0, yawDeg: 0 },
    [stand(0)],
    { obstacles: [{ id: 'box', center: v3(0, 0.05, 0), halfExtents: v3(0.4, 0.05, 0.4) }] },
    'Diagnostic static box under the probe: not turf, so it gives no support.',
  );
export const rhf5PlayerBelow = (): FixtureDef =>
  withSuspension(
    asModel(
      base4({
        id: 'RH-F5-playerBelow',
        milestone: 'RH',
        title: '',
        durationS: 2.5,
        // no settling: the lift is applied after settling, so both players would overlap at the same spot while settling
        settleS: 0,
        players: [
          player('A', 'runner', { x: 0.03, z: 0, yawDeg: 0, lift: 2.2 }, [stand(0)]),
          player('B', 'defender', { x: 0, z: 0, yawDeg: 0 }, [stand(0)]),
        ],
      }),
    ),
    'RH-F5-playerBelow',
    "Other player below: A is spawned 2.2 m above its standing height directly over B; B obstructs A's probe (players are never ground), so A gets no support on B",
  );
export const rhf5NoRescue = (): FixtureDef =>
  solo(
    'RH-F5-noRescue',
    'No recovery after loss: labelled rejected conversion at 0.5 s (5 cm forearm offset) leaves a falling proxy over valid turf',
    2.5,
    { x: 0, z: 0, yawDeg: 0 },
    [stand(0)],
    { diagnostics: { conversions: [{ playerId: 'R', atS: 0.5, edit: { kind: 'jointMismatch', segment: 'leftForearm', offsetWorld: v3(0.05, 0, 0) } }] } },
    'Diagnostic candidate edit (G4-F6-jointMismatch): the handoff is rejected, the player continues as the falling proxy; the probe stays valid but must not support it.',
  );

// ------------------------------------------------------------------ RH-F6 legacy vs suspension (same requests)
/** RH-F6 fixtures and the legacy fixture each one repeats under the suspension support. */
export const RH_F6_PAIRS: Record<string, string> = {
  'RH-F6-idleRunBrake': 'G3-F1-M',
  'RH-F6-collision': 'L1-F3-collision',
  'RH-F6-twoArm': 'L1-F5-twoArm',
  'RH-F6-oneArm': 'L1-F6-oneArm',
  'RH-F6-failed': 'L1-F7-failed',
  'RH-F6-simultaneous': 'G4-F10-simultaneous-M',
  'RH-F3-fastRun': 'L1-F1-fastRun',
  'RH-F3-sprint': 'L1-F1-sprint',
  'RH-F3-accelBrake': 'L1-F2-accelBrake',
};
export const rhf6 = (): FixtureDef[] => [
  withSuspension(asModel(asG4(g3f1(), { id: 'G3-F1', milestone: 'G4-M', title: 'Idle, run and brake: rest 5 s, run +X at 5 m/s, brake' })), 'RH-F6-idleRunBrake', 'Idle, run and brake (G3-F1-M requests)'),
  withSuspension(l1f3(), 'RH-F6-collision', 'Collision slowdown (L1-F3 requests)'),
  withSuspension(withRunClips(asModel(g4f3TwoArm()), 'L1-F5-twoArm', 'Two-arm line tackle'), 'RH-F6-twoArm', 'Two-arm line tackle (L1-F5 requests)'),
  withSuspension(withRunClips(asModel(g4f3OneArm()), 'L1-F6-oneArm', 'One-arm line tackle'), 'RH-F6-oneArm', 'One-arm line tackle (L1-F6 requests)'),
  withSuspension(withRunClips(asModel(g4f3Failed()), 'L1-F7-failed', 'Slow-line attempt'), 'RH-F6-failed', 'Slow-line attempt (L1-F7 requests)'),
  withSuspension(asModel(g4f10('simultaneous')), 'RH-F6-simultaneous', 'Simultaneous conversions (G4-F10-simultaneous-M requests)'),
];

/**
 * Balance-defeat cases on the model geometry (user request 2026-11-05: the revised balance must stay defeatable). No
 * registered legacy -M fixture exists for these; the legacy comparison runs the same definition without `support`.
 * - side hits (G3-F3-side): a 7 m/s defender leaning 12 deg meets the runner's right side; only the runner's speed
 *   differs (2 m/s recover case, 4 m/s loss case in Gate 3);
 * - lean capacity (G3-F5): a 14 deg initial lean held with the 240 N m balance maximum or the -30 % (168 N m) one.
 */
export const rhf6Defeat = (): FixtureDef[] => {
  const m = (def: FixtureDef, id: string, title: string): FixtureDef => withSuspension(asModel(asG4(def, { id, milestone: 'RH', title })), id, title);
  return [
    m(g3f3Side(2, 'recover'), 'RH-F6-sideRecover', 'Side hit, recover case: 7 m/s 12 deg defender into a 2 m/s runner (G3-F3-side-recover requests)'),
    m(g3f3Side(4, 'loss'), 'RH-F6-sideLoss', 'Side hit, loss case: 7 m/s 12 deg defender into a 4 m/s runner (G3-F3-side-loss requests)'),
    m(g3f5(false), 'RH-F6-lean14-cap240', 'Lean capacity: 14 deg initial lean, maximum balance torque 240 N m (G3-F5-cap240 requests)'),
    m(g3f5(true), 'RH-F6-lean14-cap168', 'Lean capacity: 14 deg initial lean, maximum balance torque 168 N m (G3-F5-cap168 requests)'),
  ];
};

/** Starting clip phases (percent of a cycle; 0 = left touchdown) of the isolated defender runs. */
export const RH_F6_DEFENDER_PHASES = [0, 25, 50, 75] as const;
/**
 * Isolated defender run (control case for the RH-F6 tackle deltas, user request 2026-11-05): the L1-F5/F6 defender
 * without the runner. Same body, arms, motor and start (7 m/s +Z, 12 deg forward lean); the wrap controller's
 * pre-contact requests as a script (the 7 m/s +Z line, capped at the 6.0 m/s motor ceiling as in the tackle, facing
 * and 12 deg posture lean along the line). Starting clip phase varied; 3 s (about six strides). Nothing to touch, so the
 * defender must stay supported. Practice area 16 x 28 m (the line needs about 18 m).
 */
export const rhf6DefenderRun = (phasePct: number): FixtureDef => {
  const t = withRunClips(asModel(g4f3TwoArm()), 'L1-F5-twoArm', 'Two-arm line tackle');
  const d = t.players.find((p) => p.id === 'D')!;
  const id = `RH-F6-defenderRun-${phasePct}`;
  const line = v3(0, 0, 1);
  return withSuspension(
    {
      ...t,
      durationS: 3,
      // about 18 m of travel in 3 s: a longer practice area along the line (the turf extends to +-40 m)
      area: { halfX: 8, halfZ: 14 },
      rules: undefined,
      focus: undefined,
      players: [
        {
          ...d,
          initial: { ...d.initial, x: 0, z: -12, runPhase: phasePct / 100 },
          controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(0, 0, 7), facing: line, effort: 1, posture: { leanDeg: 12, dir: line } }] },
        },
      ],
    },
    id,
    `Isolated defender run: the L1-F5/F6 defender's 7 m/s line with a 12 deg lean and no runner, starting clip phase ${(phasePct / 100).toFixed(2)}, 3 s`,
    'Control case: same body, arms, motor, start and pre-contact requests as the tackle defender; no contact, so it must stay supported.',
  );
};

// ------------------------------------------------------------------ RH-F7 handoff while moving vertically
export const rhf7 = (when: 'rising' | 'falling' | 'top' | 'bottom'): FixtureDef => {
  const f = rhf3('fastRun');
  return {
    ...f,
    id: `RH-F7-${when}`,
    title: `Fast Run handoff ${when === 'top' || when === 'bottom' ? `at a height ${when === 'top' ? 'maximum' : 'minimum'}` : `while ${when}`}: labelled conversion from 0.6 s at the first ${when} substep [bew-v6 + suspension]`,
    notes: `${f.notes} Diagnostic conversion (not a contact-caused fall): the candidate takes the achieved pose and the proxy's actual bulk velocity, vertical included.`,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.6, when }] },
    durationS: 1.6,
  };
};
export const rhf7Both = (): FixtureDef =>
  withSuspension(
    withRunClips(
      asModel(
        base4({
          id: 'RH-F7-both',
          milestone: 'RH',
          title: '',
          durationS: 1.6,
          diagnostics: { conversions: [{ playerId: 'R', atS: 0.6 }, { playerId: 'D', atS: 0.6 }] },
          players: [
            player('R', 'runner', { x: -7.3, z: -1.5, yawDeg: 90, velocity: v3(5.8, 0, 0), runPhase: 0 }, [{ fromS: 0, velocity: v3(5.8, 0, 0), facing: v3(1, 0, 0) }]),
            player('D', 'defender', { x: -7.3, z: 1.5, yawDeg: 90, velocity: v3(5.8, 0, 0), runPhase: 0.4 }, [{ fromS: 0, velocity: v3(5.8, 0, 0), facing: v3(1, 0, 0) }]),
          ],
        }),
      ),
      'RH-F7-both',
      'Both runners converted at the same boundary',
    ),
    'RH-F7-both',
    'Both players: two parallel Fast Run runners (phases 0 and 0.4) converted at the same boundary at 0.6 s',
    'Diagnostic conversions (labelled).',
  );

export function rideHeightFixtures(): FixtureDef[] {
  return [
    rhf1Stand(),
    rhf1Drop(),
    rhf1Lean(),
    rhf2Crouch(),
    rhf2Stagger(),
    rhf3('fastRun'),
    rhf3('sprint'),
    rhf3('accelBrake'),
    rhf4Range(),
    rhf4Load(),
    rhf4Kick('down'),
    rhf4Kick('up'),
    rhf5OutOfRange(),
    rhf5InvalidNormal(),
    rhf5Obstacle(),
    rhf5PlayerBelow(),
    rhf5NoRescue(),
    ...rhf6(),
    ...rhf6Defeat(),
    ...RH_F6_DEFENDER_PHASES.map(rhf6DefenderRun),
    rhf7('rising'),
    rhf7('falling'),
    rhf7('top'),
    rhf7('bottom'),
    rhf7Both(),
  ];
}
