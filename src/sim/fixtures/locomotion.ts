// L1 (plan 06): the supplied run clips (models/animations/, Fast Run and Sprint) sampled into the calibrated player's
// physical pose. Every fixture uses the bew-v6 model geometry (src/sim/model/profiles.ts) and the run-clip profile
// (src/sim/model/run-clips.ts); requests and starting conditions only. The prefix L1- is historical (plan 06's
// fixtures), not a document number. The procedural gait remains the fallback below the clip speed band, while airborne
// and while falling; tackle drills are the G4-M drills with the clip profile added (same requests).
import type { FixtureDef, PlayerSetup } from '../fixture';
import type { ScriptSegment } from '../controllers/base';
import { DEFAULT_MOTOR, ruleVariant, type MotorProfile } from '../profiles';
import { runClipsBew } from '../model/run-clips';
import { asModel } from './model';
import { base4, bodyG4, g4f3Failed, g4f3OneArm, g4f3TwoArm } from './gate4';
import { v3 } from '../vec';

/** Labelled sprint motor: the default motor with the requested-speed ceiling raised 6.0 -> 6.8 m/s (same force). */
export const MOTOR_L1_SPRINT: MotorProfile = { ...DEFAULT_MOTOR, id: 'motor-l1-sprint', maximumRequestedSpeedMps: 6.8 };

/** Add the supplied run clips to a model-geometry fixture (only the run-clip profile and identity change). */
export function withRunClips(def: FixtureDef, id: string, title: string, notes?: string): FixtureDef {
  return {
    ...def,
    id,
    milestone: 'L1',
    title: `${title} [bew-v6 + supplied run clips]`,
    notes: [notes, 'Run clips: Fast Run + Sprint sampled into the pose (legs, free-arm swing, moving carry arm; the ball stays in the carry hand); procedural gait below the clip speed band.'].filter(Boolean).join(' '),
    runClips: runClipsBew(),
    rules: def.rules ? ruleVariant(def.rules, 'ballSource=carryPalm', { ballSource: 'carryPalm' }) : undefined,
  };
}

const run = (id: 'R' | 'D', initial: PlayerSetup['initial'], segments: ScriptSegment[]): PlayerSetup => ({
  id,
  role: id === 'R' ? 'runner' : 'defender',
  body: bodyG4(),
  initial,
  controller: { kind: 'script', segments },
});

const model = (def: FixtureDef): FixtureDef => asModel(def);

/** L1-F1: constant speed from t = 0 (initial velocity = request): Fast Run near its nominal speed, Sprint above it. */
export function l1f1(kind: 'fastRun' | 'sprint'): FixtureDef {
  const v = kind === 'fastRun' ? 5.8 : 6.6;
  return withRunClips(
    model(
      base4({
        id: `L1-F1-${kind}`,
        milestone: 'L1',
        title: '',
        durationS: 2.2,
        motor: kind === 'sprint' ? MOTOR_L1_SPRINT : DEFAULT_MOTOR,
        players: [run('R', { x: -7.3, z: 0, yawDeg: 90, velocity: v3(v, 0, 0) }, [{ fromS: 0, velocity: v3(v, 0, 0), facing: v3(1, 0, 0) }])],
      }),
    ),
    `L1-F1-${kind}`,
    `Constant speed ${v} m/s run +X from t = 0`,
    kind === 'sprint' ? 'Labelled sprint motor (requested-speed ceiling 6.8 m/s, default force).' : undefined,
  );
}

/** L1-F2: stand, accelerate to the 6 m/s motor ceiling, brake to a stop (procedural -> clip -> procedural). */
export function l1f2(): FixtureDef {
  return withRunClips(
    model(
      base4({
        id: 'L1-F2',
        milestone: 'L1',
        title: '',
        durationS: 4.5,
        players: [
          run('R', { x: -7.3, z: 0, yawDeg: 90 }, [
            { fromS: 0, velocity: v3(), facing: v3(1, 0, 0) },
            { fromS: 0.5, velocity: v3(6, 0, 0), facing: v3(1, 0, 0) },
            { fromS: 2.6, velocity: v3(), facing: v3(1, 0, 0) },
          ]),
        ],
      }),
    ),
    'L1-F2-accelBrake',
    'Stand 0.5 s, accelerate +X to 6 m/s, brake to a stop at 2.6 s',
  );
}

/** L1-F3: collision slowdown: the runner keeps requesting 5.8 m/s into a bracing defender standing in its lane. */
export function l1f3(): FixtureDef {
  return withRunClips(
    model(
      base4({
        id: 'L1-F3',
        milestone: 'L1',
        title: '',
        durationS: 2,
        focus: { D: 'R' },
        players: [
          run('R', { x: -4, z: 0, yawDeg: 90, velocity: v3(5.8, 0, 0) }, [{ fromS: 0, velocity: v3(5.8, 0, 0), facing: v3(1, 0, 0) }]),
          run('D', { x: 0, z: 0.25, yawDeg: -90 }, [{ fromS: 0, velocity: v3(), facing: v3(-1, 0, 0), effort: 1 }]),
        ],
      }),
    ),
    'L1-F3-collision',
    'Collision slowdown: runner at 5.8 m/s into a bracing defender (0.25 m lateral offset)',
  );
}

/** L1-F4: two independent phases: two parallel runners at different speeds and initial phases. */
export function l1f4(): FixtureDef {
  return withRunClips(
    model(
      base4({
        id: 'L1-F4',
        milestone: 'L1',
        title: '',
        durationS: 2.4,
        players: [
          run('R', { x: -7.3, z: -1.5, yawDeg: 90, velocity: v3(4.6, 0, 0), runPhase: 0 }, [{ fromS: 0, velocity: v3(4.6, 0, 0), facing: v3(1, 0, 0) }]),
          run('D', { x: -7.3, z: 1.5, yawDeg: 90, velocity: v3(6, 0, 0), runPhase: 0.4 }, [{ fromS: 0, velocity: v3(6, 0, 0), facing: v3(1, 0, 0) }]),
        ],
      }),
    ),
    'L1-F4-twoPhases',
    'Two independent phases: parallel runners at 4.6 and 6.0 m/s, initial phases 0 and 0.4',
  );
}

/** L1-F5..F7: the real line tackles on the model geometry with the run clips (requests identical to G4-F3-*-M). */
export const l1f5 = (): FixtureDef => withRunClips(asModel(g4f3TwoArm()), 'L1-F5-twoArm', 'Two-arm line tackle (G4-F3-twoArm-M requests)', 'Held-arm precedence: the defender\'s arms are achieved query arms throughout; the runner\'s right arm carries.');
export const l1f6 = (): FixtureDef => withRunClips(asModel(g4f3OneArm()), 'L1-F6-oneArm', 'One-arm line tackle (G4-F3-oneArm-M requests)');
export const l1f7 = (): FixtureDef => withRunClips(asModel(g4f3Failed()), 'L1-F7-failed', 'Slow-line attempt (G4-F3-failed-M requests)');

export function locomotionFixtures(): FixtureDef[] {
  return [l1f1('fastRun'), l1f1('sprint'), l1f2(), l1f3(), l1f4(), l1f5(), l1f6(), l1f7()];
}
