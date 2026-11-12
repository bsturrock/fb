import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { legPointMove, syncPhysicalLegs } from '../src/sim/pose-runtime';
import { FIX, pace } from './runs';
import { add, cross, dot, len, norm, qInvRot, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';

// Contact motion, physical legs: the leg ledger's animated move of a leg point (legPointMove over the placements the pose
// step left, `PhysicalLegs.ledger`) is what its injected work reads. A capsule leg is the same shape at any twist about
// its axis, so the move of a point on its surface along the surface normal is how far the surface itself advanced there.
// L3-F1-phase6 D (forward), 1.300-1.317 s: the right thigh, under its hip, swung 0.5-2.3 degrees a substep against R's
// thigh and pelvis while its placement frame (from the world up axis, singular for a leg pointing down) turned 18-90
// degrees about the thigh axis; the ledger read up to 0.10 m along the contact normal and 1.82 J injected, where the
// surface advanced 0.008 J worth over the whole run.

/** Distance of `p` from the line through `o` along `d` (unit). */
const lineDist = (p: Vec3, o: Vec3, d: Vec3): number => len(cross(sub(p, o), d));

async function legsLive(id: string, P: string): Promise<{ sim: any; pl: any }> {
  const sim: any = await Simulation.create(FIX(id), { trace: false });
  const pl = sim.byId.get(P);
  while (!sim.done && !(pl.legs?.enabled && pl.legs.on[pl.legs.keys.indexOf('rightThigh')])) sim.stepTick();
  return { sim, pl };
}

/** The pose with its right thigh from the hip along world direction `d` (the knee moved; the rest as it is). */
function thighAlong(pose: any, d: Vec3, L: number): any {
  const out = JSON.parse(JSON.stringify(pose));
  const hip = pose.jointLandmarksWorld.rightHip;
  out.jointLandmarksWorld.rightKnee = add(hip, scale(norm(d), L));
  return out;
}

describe('physical legs: the animated move of a capsule leg is its surface move (L3-F1-phase6 D right thigh)', () => {
  it('a thigh swinging through straight down under its hip: the move along the surface normal is the surface advance, all round the thigh', async () => {
    const { sim, pl } = await legsLive('L3-F1-phase6', 'D');
    const L = pl.legs;
    const i = L.keys.indexOf('rightThigh');
    expect(L.enabled && L.on[i]).toBe(true);
    const pose = pl.pose;
    const hip: Vec3 = pose.jointLandmarksWorld.rightHip;
    const thighL = len(sub(pose.jointLandmarksWorld.rightKnee, hip));
    // two substeps of a thigh pointing down, carried 2.4 degrees from behind to in front of the vertical beside it
    const dA = norm(v3(0.03, -1, -0.03));
    const dB = norm(v3(0.03, -1, 0.03));
    pl.pose = thighAlong(pose, dA, thighL);
    syncPhysicalLegs(sim, pl);
    pl.pose = thighAlong(pose, dB, thighL);
    syncPhysicalLegs(sim, pl);
    expect(L.on[i]).toBe(true);
    const b = pl.proxy.body;
    const bp = b.translation();
    const bq = b.rotation();
    const r = sim.def.ragdoll.radii.thigh;
    const mid = add(hip, scale(dB, 0.5 * thighL));
    const ref = norm(cross(dB, v3(1, 0, 0)));
    let worst = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      // outward normal of the thigh surface at this point (world)
      const n = add(scale(ref, Math.cos(a)), scale(cross(dB, ref), Math.sin(a)));
      const p = add(mid, scale(n, r));
      // (before the ledger had its own frames it read the placements themselves)
      const move = qRot(bq, legPointMove(L.ledger ?? L, i, qInvRot(bq, sub(p, bp))));
      // how far the thigh surface advanced at p: its distance from the last axis less its distance from the current one
      const advance = lineDist(p, hip, dA) - lineDist(p, hip, dB);
      worst = Math.max(worst, Math.abs(dot(n, move) - advance));
    }
    sim.dispose();
    // the swing moves the surface by at most 1 cm here (half the thigh at 2.4 degrees); the frame twist read up to the
    // thigh's diameter
    expect(worst).toBeLessThan(0.001);
  }, 60000);

  it('L3-F1-phase6 forward: D injects what its legs move into R, not the twist of the thigh frame', async () => {
    const sim: any = await Simulation.create(FIX('L3-F1-phase6'), { trace: false });
    while (!sim.done) {
      sim.stepTick();
      await pace();
    }
    const led = sim.legLedger.get('D');
    sim.dispose();
    expect(led.impulseNs).toBeGreaterThan(100);
    // (s14: 1.82 J, 1.79 J of it in 1.300-1.317 s; the frame-free surface advance over the run: 0.008 J)
    expect(led.injectedJ).toBeLessThan(0.1);
  }, 120000);
});
