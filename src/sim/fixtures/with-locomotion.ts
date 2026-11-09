// Plan 13e: the supplied locomotion set on a player-model fixture: the L3 foot planner, the locomotion composition with
// the played idle cycle (LOCOMOTION_L3_IDLE), and the walk and run clips. asL3 and the HC labels take it; L4 inherits it
// through its L3 sources. Two kinds of fixture are left as they are (the reason is in each one's notes): the authored
// body (the clips and the fitted idle are calibrated to the player model; those fixtures test physics on the test
// body) and a player converted before it can stand (lockedOutOfLocomotion). Kept apart from fixtures/transitions.ts,
// which imports the HC builders: the HC labels import this module.
import type { FixtureDef } from '../fixture';
import { FOOTWORK_L3 } from '../footwork';
import { LOCOMOTION_L3_IDLE } from '../locomotion';
import { runClipsBew, runClipsL3 } from '../model/run-clips';

/** Every player is on the supplied model's measured geometry. */
export const onModel = (def: FixtureDef): boolean => def.players.every((p) => p.body.measured !== undefined);

/** Every player is converted (a diagnostic conversion) before it could stand: under 0.5 s. */
export const lockedOutOfLocomotion = (def: FixtureDef): boolean => {
  const c = def.diagnostics?.conversions ?? [];
  return def.players.every((p) => c.some((x) => x.playerId === p.id && x.atS < 0.5));
};

/** The full set: foot planner, locomotion with the idle cycle, walk and run clips (a source's clips are kept). */
export function withLocomotion(def: FixtureDef): FixtureDef {
  return { ...def, footwork: FOOTWORK_L3, locomotion: LOCOMOTION_L3_IDLE, runClips: def.runClips?.walk ? def.runClips : runClipsL3(def.runClips ?? runClipsBew()) };
}
