// Follow-camera target (plan 06 pass 3). Players are drawn interpolated between the last two ticks with the driver's
// alpha; the camera follows the same interpolated state, so a smoothly drawn runner holds still against the camera
// instead of stepping once per tick against it.
import { v3, type Vec3 } from '../sim/vec';

/** Mean player COM interpolated at `alpha` between the previous and the current tick, at a fixed height. */
export function followCenter(players: { prev: Vec3; cur: Vec3 }[], alpha: number, height = 0.9): Vec3 {
  let x = 0;
  let z = 0;
  for (const p of players) {
    x += p.prev.x + (p.cur.x - p.prev.x) * alpha;
    z += p.prev.z + (p.cur.z - p.prev.z) * alpha;
  }
  const n = Math.max(1, players.length);
  return v3(x / n, height, z / n);
}
