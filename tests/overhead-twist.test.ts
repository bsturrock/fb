// Ladder 11d (ii): the M1 twist measured so that it is regular through an upper arm pointing straight up
// (`ShoulderTwistProfile.anatomical`, JOINT_RANGE_V4, used by no fixture yet). Re-derived from contact motion's overhead
// twist (s17 arm.patch). M1 measures the upper arm's twist as the ragdoll envelope does: the swing is the shortest arc
// from the hanging arm, the twist what is left about the arm. Straight up that arc is a half turn about an axis that turns
// with the arm's azimuth, so near vertical a small rotation of the arm changes the reading by up to tan(swing / 2) times
// as much: a rate window in it holds a number while the arm turns over. The anatomical measure is the envelope's at and
// below horizontal and blends above it into the twist after the swing from a reference 35 deg forward of hanging, whose
// one singular direction is outside the shoulder cone. The visible meter reads it (ladder 13a), and the ragdoll's twist
// limit takes it under SHOULDER_TWIST_ANAT_V1 (tests/shoulder-twist.test.ts).
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { armAnatomicalTwistRad, armTwistRad, clampDirToEnvelope, fitElbowTwist, limbAnatomicalTwistRad, limbTwistRad, swingExcess } from '../src/sim/joint-cone';
import { JOINT_RANGE_V2, JOINT_RANGE_V4 } from '../src/sim/profiles';
import { add, cross, norm, qFromAxisAngle, qRot, scale, v3, wrapPi, type Vec3 } from '../src/sim/vec';

const E = JOINT_RANGE_V2.shoulder;
const I = { x: 0, y: 0, z: 0, w: 1 };
let seed = 11;
const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const rdir = (): Vec3 => norm(v3(rnd(), rnd(), rnd()), v3(0, -1, 0));
const perp = (d: Vec3): Vec3 => norm(cross(d, rdir()), norm(cross(d, v3(1, 0, 0))));

/** Largest change of a twist measure per radian of a small rigid rotation of the limb (direction and hinge together). */
function sensitivity(f: (d: Vec3, h: Vec3, sx: number) => number, d: Vec3, h: Vec3, sx: number): number {
  let worst = 0;
  for (const ax of [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)]) {
    const q = qFromAxisAngle(ax, 1e-5);
    worst = Math.max(worst, Math.abs(wrapPi(f(qRot(q, d), qRot(q, h), sx) - f(d, h, sx))) / 1e-5);
  }
  return worst;
}
const env = (d: Vec3, h: Vec3, sx: number) => limbTwistRad(E, d, h, sx);
const anat = (d: Vec3, h: Vec3, sx: number) => limbAnatomicalTwistRad(E, d, h, sx);

describe('ladder 11d: the M1 twist through an overhead upper arm', () => {
  it('the profile: joint-range-v2 with the anatomical measure, used by no fixture', () => {
    expect({ ...JOINT_RANGE_V4, id: JOINT_RANGE_V2.id, shoulderTwist: { ...JOINT_RANGE_V4.shoulderTwist!, anatomical: undefined } }).toEqual({ ...JOINT_RANGE_V2, shoulderTwist: { ...JOINT_RANGE_V2.shoulderTwist!, anatomical: undefined } });
    expect(JOINT_RANGE_V4.shoulderTwist!.anatomical).toBe(true);
    for (const d of allFixtures()) expect(d.jointRange?.shoulderTwist?.anatomical, d.id).toBeUndefined();
  });

  it('is the envelope\'s measure at and below horizontal; inside the shoulder cone it is regular through vertical, where the envelope\'s is not', () => {
    let below = 0;
    let worstAnat = 0;
    let worstEnvNearUp = 0;
    for (let i = 0; i < 4000; i++) {
      const sx = i % 2 ? 1 : -1;
      const d = rdir();
      const h = perp(d);
      if (d.y <= 0) {
        below++;
        expect(Math.abs(wrapPi(anat(d, h, sx) - env(d, h, sx)))).toBeLessThan(1e-12);
        continue;
      }
      // the shoulder cone (plan 12): directions it keeps
      if (swingExcess(E, d, sx).rad > 1e-9) continue;
      worstAnat = Math.max(worstAnat, sensitivity(anat, d, h, sx));
      if (d.y > 0.995) worstEnvNearUp = Math.max(worstEnvNearUp, sensitivity(env, d, h, sx));
    }
    expect(below).toBeGreaterThan(1000);
    // a twist about the limb changes either by the same angle (1 rad/rad); the direction's share stays bounded
    expect(worstAnat).toBeLessThan(4);
    // fault twin: the envelope's measure within 6 deg of vertical
    expect(worstEnvNearUp).toBeGreaterThan(15);
  });

  it('an elbow fitted to a window in the anatomical measure moves continuously as the upper arm passes over vertical; in the envelope\'s it turns over', () => {
    // the upper arm swept forward over the top (cone-clamped), the forearm bent 90 deg, the window the range alone; the
    // elbow fitted at each 0.5 deg step, the largest elbow move between steps. Measured: 0.26 cm; the twin 30.1 cm
    const sh = v3(0.2, 1.4, 0);
    const largestMove = (anatomical: boolean): number => {
      const win = { mid: 0, lo: -0.3, hi: 0.3 };
      let prev: Vec3 | null = null;
      let worst = 0;
      for (let a = 60; a <= 120; a += 0.5) {
        const r = (a * Math.PI) / 180;
        const d = clampDirToEnvelope(E, norm(v3(0.05, Math.sin(r), Math.cos(r)), v3(0, 1, 0)), 1, 0);
        const elbow = add(sh, scale(d, 0.3));
        const end = add(elbow, scale(norm(cross(d, v3(1, 0, 0)), v3(0, 0, 1)), 0.3));
        const f = fitElbowTwist(E, I, sh, elbow, end, 1, win, anatomical ? armAnatomicalTwistRad : armTwistRad);
        if (prev) worst = Math.max(worst, Math.hypot(f.elbow.x - prev.x, f.elbow.y - prev.y, f.elbow.z - prev.z));
        prev = f.elbow;
      }
      return worst;
    };
    const on = largestMove(true);
    const twin = largestMove(false);
    expect(on).toBeLessThan(0.02);
    expect(twin).toBeGreaterThan(0.1);
  });
});
