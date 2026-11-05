// Supplied run clips for the calibrated player (models/animations/, plan 06): the committed intake record and the
// baked derivatives, decoded once into shared immutable clips, and the run-clip locomotion profile the L1 fixtures pass
// into simulation initialization. Headless: plain JSON imports, no loader, no DOM.
import RECORD from './run-clips.record.json';
import FAST_RUN from '../../../models/animations/fast-run.json';
import SPRINT from '../../../models/animations/sprint.json';
import { decodeRunClip, RunClipError, type RunClip, type RunClipProfile, type RunClipRecord } from '../run-clip';

/** Committed intake record (scripts/model/clip-intake.ts). */
export const RUN_CLIPS_RECORD = RECORD as unknown as { policy: unknown; calibrationSha256: string; clips: RunClipRecord[] };

/** Baked derivative data by record `data` path. */
const SOURCES: Record<string, unknown> = {
  'models/animations/fast-run.json': FAST_RUN,
  'models/animations/sprint.json': SPRINT,
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
