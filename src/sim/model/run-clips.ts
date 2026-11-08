// Supplied run clips for the calibrated player (models/animations/, plan 06): the committed intake record and the
// baked derivatives, decoded once into shared immutable clips, and the run-clip locomotion profile the L1 fixtures pass
// into simulation initialization. Headless: plain JSON imports, no loader, no DOM.
import RECORD from './run-clips.record.json';
import FAST_RUN from '../../../models/animations/fast-run.json';
import SPRINT from '../../../models/animations/sprint.json';
import WALK from '../../../models/animations/walk.json';
import { decodeRunClip, RunClipError, type RunClip, type RunClipProfile, type RunClipRecord } from '../run-clip';

/** Committed intake record (scripts/model/clip-intake.ts). */
export const RUN_CLIPS_RECORD = RECORD as unknown as { policy: unknown; calibrationSha256: string; clips: RunClipRecord[]; walk: RunClipRecord };

/** Baked derivative data by record `data` path. */
const SOURCES: Record<string, unknown> = {
  'models/animations/fast-run.json': FAST_RUN,
  'models/animations/sprint.json': SPRINT,
  'models/animations/walk.json': WALK,
};

/** Decode every clip of a record against its data (a missing data entry or a stale record is a RunClipError). */
export function decodeRunClips(records: readonly RunClipRecord[], sources: Record<string, unknown>): RunClip[] {
  return records.map((r) => {
    if (!(r.data in sources)) throw new RunClipError(r.id, `data ${r.data} missing`);
    return decodeRunClip(r, sources[r.data]);
  });
}

let cached: RunClip[] | null = null;
/** The supplied clips, decoded once and shared by every fixture and player. */
export function suppliedRunClips(): readonly RunClip[] {
  cached ??= decodeRunClips(RUN_CLIPS_RECORD.clips, SOURCES);
  return cached;
}

/**
 * Run-clip profile for the calibrated player: Fast Run and Sprint (ascending nominal speed). The clip weight ramps in
 * over [0.55, 0.70] x the slowest nominal speed (0.70 = its minimum playback rate); below it, and while airborne or
 * falling, the procedural gait is the explicit fallback. The weight changes at most 1 per 0.2 s.
 */
export function runClipsBew(over: Partial<RunClipProfile> = {}): RunClipProfile {
  const clips = suppliedRunClips();
  const v0 = clips[0].record.nominalSpeedMps;
  const minRate = clips[0].record.playback.minRate;
  return {
    id: `run-clips:${clips.map((c) => c.identity).join('+')}`,
    clips,
    fadeMps: [Math.round(0.55 * v0 * 1000) / 1000, Math.round(minRate * v0 * 1000) / 1000],
    headingMaxDeg: 30,
    headingFadeDeg: 30,
    weightRatePerS: 5,
    blendRatePerS: 2,
    armSwing: true,
    carrySwing: 0.6,
    ...over,
  };
}

let cachedWalk: RunClip | null = null;
/** The supplied walk cycle, decoded once. */
export function suppliedWalkClip(): RunClip {
  cachedWalk ??= decodeRunClips([RUN_CLIPS_RECORD.walk], SOURCES)[0]!;
  return cachedWalk;
}

/**
 * Plan 08: an L3 run-clip profile: the supplied walk first (the slowest clip), the run clips and their fade band as they
 * were, and the stance widths the user chose by eye (Fast Run lands both feet on one line under the hips). The walk plays
 * for a walking request only, so a run start and a stop from a run never pass through it; walking requests ramp at the
 * supplied Start Walking's speed curve (about 1.2 m/s^2), so a walk starts and stops over steps.
 */
/** Plan 10b: the L3 clip heading's follow rate (rad/s), the foot planner's own follow rate (FOOTWORK_L3 followRadPerS). */
const L3_HEADING_RAD_PER_S = 18;

export function runClipsL3(base: RunClipProfile = runClipsBew()): RunClipProfile {
  const walk = suppliedWalkClip();
  return {
    ...base,
    id: `${base.id}+${walk.identity}+l3+headingRadPerS=${L3_HEADING_RAD_PER_S}`,
    clips: [walk, ...base.clips],
    headingRadPerS: L3_HEADING_RAD_PER_S,
    walk: { requestMps: [0.05, 2.1], fadeMps: [0.15, 0.5], minStride: 0.5, dropM: 0.025, rampMps2: 1.2, brakeB: 0.3 },
    stanceWidthAddM: { walk: 0, 'fast-run': 0.065, sprint: 0.025 },
  };
}
