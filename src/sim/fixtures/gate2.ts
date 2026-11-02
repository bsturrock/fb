// Gate 2 fixtures: reach, palm surface holds, forearm clamps and wrap attempts. Requests and starting conditions
// only; holds, slips, releases and wrap status come from the simulation.
import type { ArmSide } from '../contracts';
import type { FixtureDef, PlayerSetup } from '../fixture';
import { PRACTICE_AREA } from '../fixture';
import type { ArmScriptSegment, ScriptSegment } from '../controllers/base';
import type { WrapSpec } from '../controllers/wrap';
import {
  ARM_G2, DEFAULT_MOTOR, SOLVER_G1, STANCE_G1_LOCKED, upperBodyCompound, type ArmProfile, type ArmSetup, type RetentionMode,
} from '../profiles';
import { v3, type Vec3 } from '../vec';

export const base2 = (over: Partial<FixtureDef> & Pick<FixtureDef, 'id' | 'milestone' | 'title' | 'players' | 'durationS'>): FixtureDef => ({
  gate: 2,
  solver: SOLVER_G1,
  stance: STANCE_G1_LOCKED,
  motor: DEFAULT_MOTOR,
  armProfile: ARM_G2,
  settleS: 0.1,
  area: PRACTICE_AREA,
  focus: { D: 'R' },
  ...over,
});

export const armsSetup = (
  left: RetentionMode | null,
  right: RetentionMode | null,
  extra: Partial<ArmSetup> = {},
): ArmSetup => ({
  enabled: { left: left !== null, right: right !== null },
  mode: { left: left ?? 'surfaceHold', right: right ?? 'surfaceHold' },
  acquisition: true,
  closeEffortScale: 1,
  ...extra,
});

const focusPt = (x: number, y: number, z: number) => ({ frame: 'focus' as const, point: v3(x, y, z) });
const selfPt = (x: number, y: number, z: number) => ({ frame: 'self' as const, point: v3(x, y, z) });

function defender(opts: { x: number; z: number; yawDeg: number; arms: ArmSetup; segments: ScriptSegment[]; armSegs: ArmScriptSegment[] }): PlayerSetup {
  return {
    id: 'D',
    role: 'defender',
    body: upperBodyCompound(),
    initial: { x: opts.x, z: opts.z, yawDeg: opts.yawDeg },
    arms: opts.arms,
    controller: { kind: 'script', segments: opts.segments, arms: opts.armSegs },
  };
}

function runner(opts: { x?: number; z?: number; yawDeg: number; segments: ScriptSegment[] }): PlayerSetup {
  return {
    id: 'R',
    role: 'runner',
    body: upperBodyCompound(),
    initial: { x: opts.x ?? 0, z: opts.z ?? 0, yawDeg: opts.yawDeg },
    controller: { kind: 'script', segments: opts.segments },
  };
}

const stand = (facing: Vec3, effort = 1): ScriptSegment[] => [{ fromS: 0, velocity: v3(), facing, effort }];

// ------------------------------------------------------------------ G2-A
/**
 * G2-F1: face-to-face, both standing. The right arm reaches a reachable chest point (target 6 cm inside the
 * surface), then closes on a point beyond reach, then reaches and closes on a point behind the runner's back.
 */
export function g2f1(): FixtureDef {
  return base2({
    id: 'G2-F1',
    milestone: 'G2-A',
    title: 'Reach and obstruction (right arm): chest, beyond reach, behind the back',
    notes: 'Runner faces -Z at the origin; defender faces +Z at z=-0.65. Runner local frame targets.',
    durationS: 3.0,
    players: [
      defender({
        x: 0,
        z: -0.65,
        yawDeg: 0,
        arms: armsSetup(null, 'surfaceHold'),
        segments: stand(v3(0, 0, 1)),
        armSegs: [
          { fromS: 0, side: 'right', action: 'reach', target: focusPt(-0.15, 0.25, 0.1) },
          { fromS: 0.6, side: 'right', action: 'reach', target: selfPt(1.6, 0.5, 0.6) },
          { fromS: 0.9, side: 'right', action: 'close', target: selfPt(1.6, 0.5, 0.6) },
          { fromS: 1.4, side: 'right', action: 'reach', target: focusPt(-0.15, 0.25, -0.3) },
          { fromS: 2.2, side: 'right', action: 'close', target: focusPt(-0.15, 0.25, -0.3) },
        ],
      }),
      runner({ yawDeg: 180, segments: stand(v3(0, 0, -1)) }),
    ],
  });
}

// ------------------------------------------------------------------ G2-B
/**
 * Side-hold layout: the runner faces +X at the origin; the defender stands at z=-0.7 facing +Z, beside the
 * runner's right flank, and grips the flank with the right palm.
 */
interface HoldOpts {
  id: string;
  title: string;
  milestone?: string;
  notes?: string;
  acquisition?: boolean;
  runner: ScriptSegment[];
  defender?: ScriptSegment[];
  armSegs?: ArmScriptSegment[];
  durationS?: number;
  arms?: ArmSetup;
  armProfile?: ArmProfile;
}

export const flankTarget = (dz = 0): { frame: 'focus'; point: Vec3 } => focusPt(0.18, 0.25, dz); // runner right flank (surface at +0.25 local x), 7 cm inside

export function sideHold(o: HoldOpts): FixtureDef {
  return base2({
    id: o.id,
    milestone: o.milestone ?? 'G2-B',
    title: o.title,
    notes: o.notes,
    durationS: o.durationS ?? 3.0,
    armProfile: o.armProfile ?? ARM_G2,
    players: [
      defender({
        x: -0.1,
        z: -0.7,
        yawDeg: 0,
        arms: o.arms ?? armsSetup(null, 'surfaceHold', { acquisition: o.acquisition ?? true }),
        segments: o.defender ?? stand(v3(0, 0, 1), 0.25),
        armSegs: o.armSegs ?? [
          { fromS: 0, side: 'right', action: 'reach', target: flankTarget() },
          { fromS: 0.3, side: 'right', action: 'close', target: flankTarget() },
          { fromS: 0.5, side: 'right', action: 'pull', target: flankTarget() },
        ],
      }),
      runner({ yawDeg: 90, segments: o.runner }),
    ],
  });
}

/** G2-F2: one palm hold, runner keeps requesting travel along +X. */
export const g2f2 = (acquisition = true): FixtureDef =>
  sideHold({
    id: acquisition ? 'G2-F2' : 'G2-F2-control',
    title: acquisition ? 'One-arm palm hold and mutual drag' : 'Control: same requests, palm acquisition disabled',
    notes: 'Defender stands (effort 0.25), closes at 0.3 s and pulls from 0.5 s; runner requests +X 2 m/s at effort 0.6 from 0.6 s.',
    acquisition,
    runner: [
      { fromS: 0, velocity: v3(), facing: v3(1, 0, 0) },
      { fromS: 0.6, velocity: v3(2, 0, 0), facing: v3(1, 0, 0), effort: 0.6 },
    ],
  });

/** G2-F3 variants: separation (reach loss / overload), unfavorable turn, voluntary release and re-close. */
export const g2f3Separation = (): FixtureDef =>
  sideHold({
    id: 'G2-F3-separation',
    title: 'Escape by separation: runner moves away from the defender at full effort',
    durationS: 2.2,
    runner: [
      { fromS: 0, velocity: v3(), facing: v3(1, 0, 0) },
      { fromS: 0.6, velocity: v3(0, 0, 4), facing: v3(1, 0, 0), effort: 1 },
    ],
    defender: stand(v3(0, 0, 1), 1),
  });

/** Declared profile variant: lower per-arm ceiling so overload can accumulate inside reach (700 N cannot, see notes). */
export const ARM_G2_CAP350: ArmProfile = { ...ARM_G2, id: 'arm-g2-v1-cap350', hold: { ...ARM_G2.hold, perArmCeilingN: 350 } };

export const g2f3Overload = (): FixtureDef =>
  sideHold({
    id: 'G2-F3-overload',
    title: 'Overload: per-arm ceiling 350 N (declared variant); runner drives along +X at effort 0.6',
    notes: 'With the 700 N default, raw tension exceeds the ceiling only within ~0.1 m of max reach, so reach loss always comes first.',
    armProfile: ARM_G2_CAP350,
    runner: [
      { fromS: 0, velocity: v3(), facing: v3(1, 0, 0) },
      { fromS: 0.6, velocity: v3(2, 0, 0), facing: v3(1, 0, 0), effort: 0.6 },
    ],
  });

export const g2f3Turn = (): FixtureDef =>
  sideHold({
    id: 'G2-F3-turn',
    title: 'Unfavorable turn: runner spins away (yaw request) while drifting',
    runner: [
      { fromS: 0, velocity: v3(), facing: v3(1, 0, 0) },
      { fromS: 0.6, velocity: v3(1, 0, 0.5), facing: v3(-1, 0, 0.3), effort: 1 },
    ],
    defender: stand(v3(0, 0, 1), 0.5),
  });

export const g2f3Reacquire = (): FixtureDef =>
  sideHold({
    id: 'G2-F3-reacquire',
    title: 'Voluntary release with the hand still touching, re-close refused, withdraw, fresh close',
    runner: stand(v3(1, 0, 0)),
    armSegs: [
      { fromS: 0, side: 'right', action: 'reach', target: flankTarget() },
      { fromS: 0.3, side: 'right', action: 'close', target: flankTarget() },
      { fromS: 0.8, side: 'right', action: 'reach', target: flankTarget() },
      { fromS: 0.85, side: 'right', action: 'close', target: flankTarget() },
      { fromS: 1.4, side: 'right', action: 'reach', target: focusPt(0.6, 0.25, 0) },
      { fromS: 1.8, side: 'right', action: 'reach', target: flankTarget() },
      { fromS: 2.2, side: 'right', action: 'close', target: flankTarget() },
    ],
  });

export const sideOf = (s: ArmSide): number => (s === 'right' ? 1 : -1);

// ------------------------------------------------------------------ G2-C wrap attempts
interface WrapOpts {
  id: string;
  title: string;
  milestone?: string;
  notes?: string;
  wrap?: Partial<WrapSpec>;
  arms?: ArmSetup;
  armProfile?: ArmProfile;
  runner: ScriptSegment[];
  runnerYawDeg?: number;
  defenderStart?: { x: number; z: number; yawDeg: number };
  durationS?: number;
}

/** Runner at the origin facing +X; the defender approaches the runner's right flank (-Z side). */
export function wrapFixture(o: WrapOpts): FixtureDef {
  const ds = o.defenderStart ?? { x: -0.2, z: -1.4, yawDeg: 0 };
  return base2({
    id: o.id,
    milestone: o.milestone ?? 'G2-C',
    title: o.title,
    notes: o.notes,
    durationS: o.durationS ?? 3.0,
    armProfile: o.armProfile ?? ARM_G2,
    players: [
      {
        id: 'D',
        role: 'defender',
        body: upperBodyCompound(),
        initial: ds,
        arms: o.arms ?? armsSetup('forearmClamp', 'forearmClamp', { acquisition: false }),
        controller: { kind: 'wrapAttempt', plan: { left: 'wrap', right: 'wrap' }, ...o.wrap },
      },
      runner({ yawDeg: o.runnerYawDeg ?? 90, segments: o.runner }),
    ],
  });
}

const jog = (speed: number, effort = 0.5): ScriptSegment[] => [{ fromS: 0, velocity: v3(speed, 0, 0), facing: v3(1, 0, 0), effort }];

/** G2-F5: canonical forearm wrap from a near-side approach (palm acquisition disabled). */
export const g2f5 = (): FixtureDef =>
  wrapFixture({
    id: 'G2-F5',
    title: 'Circumferential forearm wrap, near-side approach, runner jogging 1 m/s',
    runner: jog(1.0),
  });

// ------------------------------------------------------------------ G2-C/D fixtures
/** Face-to-face front layout (runner faces -Z at the origin, defender faces +Z). */
function frontHolds(o: { id: string; title: string; notes?: string; runner: ScriptSegment[]; secondAtS?: number; pullAtS?: number; durationS?: number; defender?: ScriptSegment[] }): FixtureDef {
  const second = o.secondAtS ?? 0.6;
  return base2({
    id: o.id,
    milestone: 'G2-C',
    title: o.title,
    notes: o.notes,
    durationS: o.durationS ?? 2.5,
    players: [
      defender({
        x: 0,
        z: -0.6,
        yawDeg: 0,
        arms: armsSetup('surfaceHold', 'surfaceHold'),
        segments: o.defender ?? stand(v3(0, 0, 1), 0.5),
        armSegs: [
          { fromS: 0, side: 'right', action: 'reach', target: focusPt(-0.05, 0.25, 0.1) },
          { fromS: 0, side: 'left', action: 'reach', target: focusPt(0.05, 0.25, 0.1) },
          { fromS: 0.3, side: 'right', action: 'close', target: focusPt(-0.05, 0.25, 0.1) },
          { fromS: second, side: 'left', action: 'close', target: focusPt(0.05, 0.25, 0.1) },
          ...(o.pullAtS !== undefined
            ? [
                { fromS: o.pullAtS, side: 'right' as const, action: 'pull' as const, target: focusPt(-0.05, 0.25, 0.1) },
                { fromS: o.pullAtS, side: 'left' as const, action: 'pull' as const, target: focusPt(0.05, 0.25, 0.1) },
              ]
            : []),
        ],
      }),
      runner({ yawDeg: 180, segments: o.runner }),
    ],
  });
}

/** G2-F4: two palms on the runner's chest (azimuths near +/-17 deg); the runner then backs away slowly. */
export const g2f4 = (): FixtureDef =>
  frontHolds({
    id: 'G2-F4',
    title: 'Two hands on the front: twoArmHold, never wrapped',
    notes: 'Right palm closes at 0.3 s, left at 0.6 s; runner backs away (+Z) at 1 m/s, effort 0.5 from 1.0 s.',
    runner: [
      { fromS: 0, velocity: v3(), facing: v3(0, 0, -1) },
      { fromS: 1.0, velocity: v3(0, 0, 1), facing: v3(0, 0, -1), effort: 0.5 },
    ],
  });

/** G2-F8: both palms loaded above the shared 1000 N budget (runner escapes at full effort). */
export const g2f8 = (): FixtureDef =>
  frontHolds({
    id: 'G2-F8',
    title: 'Shared budget: two palm holds loaded above 1000 N',
    notes: 'Both palms pull from 0.7 s; defender holds ground (requests -Z 1 m/s, effort 1); runner backs away (+Z) at 3 m/s, effort 1, from 0.8 s.',
    pullAtS: 0.7,
    defender: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, 1), effort: 0.5 }, { fromS: 0.7, velocity: v3(0, 0, -1), facing: v3(0, 0, 1), effort: 1 }],
    runner: [
      { fromS: 0, velocity: v3(), facing: v3(0, 0, -1) },
      { fromS: 0.8, velocity: v3(0, 0, 3), facing: v3(0, 0, -1), effort: 1 },
    ],
  });

/** G2-F8 mixed: right palm on the near flank (surfaceHold) + left forearm wrap (clamp), runner escapes. */
export const g2f8Mixed = (): FixtureDef =>
  wrapFixture({
    id: 'G2-F8-mixed',
    title: 'Shared vector budget with mixed modes: right palm hold + left forearm clamp',
    arms: armsSetup('forearmClamp', 'surfaceHold'),
    wrap: { plan: { left: 'wrap', right: 'palmFlank' } },
    runner: [
      { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
      { fromS: 1.2, velocity: v3(1, 0, 3), facing: v3(1, 0, 0), effort: 1 },
    ],
  });

/** G2-F6: same controller and arm profile, worse geometry. */
export const g2f6Separation = (gapM = 0.35): FixtureDef =>
  wrapFixture({
    id: gapM < 0.4 ? 'G2-F6-separation' : 'G2-F6-far',
    title: `Failed/partial wrap: defender keeps ${gapM.toFixed(2)} m body separation`,
    wrap: { contactGapM: gapM, driveInMps: 0, engageGapM: gapM + 0.15 },
    runner: jog(1.0),
  });

/** G2-F7: from a wrap, the runner drives out and turns away; arms load unevenly. */
export const g2f7 = (): FixtureDef =>
  wrapFixture({
    id: 'G2-F7',
    title: 'Wrap breaks one arm at a time: runner accelerates and turns away at 1.2 s',
    runner: [
      { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
      { fromS: 1.2, velocity: v3(3.5, 0, 2.5), facing: v3(0.4, 0, 1), effort: 1 },
    ],
  });

/** G2-F10: forearm wrap without palms (= canonical F5 layout) and the closing-effort-off comparison. */
export const g2f10 = (closeEffort = 1): FixtureDef =>
  wrapFixture({
    id: closeEffort > 0 ? 'G2-F10' : 'G2-F10-noClose',
    milestone: 'G2-C',
    title: closeEffort > 0 ? 'Forearm wrap, palm acquisition disabled; runner pulls away at 1.2 s' : 'Control: closing effort 0 (same requests, contact and movement)',
    arms: armsSetup('forearmClamp', 'forearmClamp', { acquisition: false, closeEffortScale: closeEffort }),
    runner: [
      { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
      { fromS: 1.2, velocity: v3(1, 0, 2.5), facing: v3(1, 0, 0), effort: 0.8 },
    ],
  });

/** Declared variant for F11: lower friction coefficient, same geometry and requests. */
export const ARM_G2_MU03: ArmProfile = { ...ARM_G2, id: 'arm-g2-v1-mu0.3', clamp: { ...ARM_G2.clamp, mu: 0.3 } };

/** G2-F11: tangential loading of the wrap (runner escapes along the forearms, +Z). */
export const g2f11 = (lowMu = false): FixtureDef =>
  wrapFixture({
    id: lowMu ? 'G2-F11-mu0.3' : 'G2-F11',
    title: lowMu ? 'Tangential escape, friction coefficient 0.3 (declared variant)' : 'Tangential escape along the forearms, mu 0.8',
    armProfile: lowMu ? ARM_G2_MU03 : ARM_G2,
    notes: 'Defender stops pursuing at 1.2 s (requests zero velocity, effort 0.3) so the escape loads the clamps tangentially.',
    wrap: { standAfterS: 1.2, standEffort: 0.3 },
    runner: [
      { fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 },
      { fromS: 1.2, velocity: v3(0.5, 0, 3), facing: v3(1, 0, 0), effort: 0.25 },
    ],
  });

/** G2-F12: offset approach, runner keeps moving and changes facing; arms keep working independently. */
export const g2f12 = (): FixtureDef =>
  wrapFixture({
    id: 'G2-F12',
    milestone: 'G2-D',
    title: 'Continued arm work: offset approach, runner turns 40 deg at 1.0 s',
    wrap: { aimLateralM: 0.2 },
    runner: [
      { fromS: 0, velocity: v3(1.5, 0, 0), facing: v3(1, 0, 0), effort: 0.6 },
      { fromS: 1.0, velocity: v3(1.6, 0, 1.3), facing: v3(0.77, 0, 0.64), effort: 0.8 },
    ],
    durationS: 3.5,
  });

/** G2-F9 sweep: runner passes an outstretched hand at 8 m/s (relative-motion query subdivision). */
export const g2f9Sweep = (): FixtureDef =>
  base2({
    id: 'G2-F9-sweep',
    milestone: 'G2-D',
    title: 'Query robustness: runner sprints through an outstretched (open) hand at 8 m/s',
    notes: 'Palm held at self (0.2, 0.15, 0.55), inside the runner path (runner spans z -0.20..0.30).',
    durationS: 1.0,
    players: [
      defender({
        x: 0,
        z: -0.65,
        yawDeg: 0,
        arms: armsSetup(null, 'surfaceHold'),
        segments: stand(v3(0, 0, 1), 1),
        armSegs: [{ fromS: 0, side: 'right', action: 'reach', target: selfPt(0.2, 0.15, 0.55) }],
      }),
      {
        ...runner({ yawDeg: 90, segments: [{ fromS: 0, velocity: v3(8, 0, 0), facing: v3(1, 0, 0), effort: 1 }] }),
        initial: { x: -3, z: 0.05, yawDeg: 90, velocity: v3(8, 0, 0) },
      },
    ],
  });

export function gate2Fixtures(): FixtureDef[] {
  return [
    g2f1(),
    g2f2(true),
    g2f2(false),
    g2f3Separation(),
    g2f3Overload(),
    g2f3Turn(),
    g2f3Reacquire(),
    g2f4(),
    g2f5(),
    g2f6Separation(0.35),
    g2f6Separation(0.45),
    g2f7(),
    g2f8(),
    g2f8Mixed(),
    g2f10(1),
    g2f10(0),
    g2f11(false),
    g2f11(true),
    g2f12(),
    g2f9Sweep(),
  ];
}
