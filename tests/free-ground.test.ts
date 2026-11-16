import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyParts, footprintOf, groundFor, groundOf, isFree, legHit, nearestFree, outlineDist, type FootQuery, type FreeGround, type Part, type PartsPlayer } from '../src/sim/free-ground';
import { initPhysics } from '../src/sim/physics';
import { plannedLeg } from '../src/sim/pose';
import type { Simulation } from '../src/sim/simulation';
import { qFromAxisAngle, qRot, v3, vc, type Vec3 } from '../src/sim/vec';
import { asCaptured, FIX } from './runs';
import { loadState, resumeState } from './state';

// Plan 15 step 1: free ground, "may a foot or shin be here". Constructed scenes on the ground plane, each check with its
// fault twin: the same check on the answer a faulty rule gives (the footprint not moved, a part not cut at the shin,
// no wall, one footprint at a time, the stepping player's own body counted, the legs left out, the whole leg not judged),
// which must fail it.

const FOOT: FootQuery = { clearM: 0.12 };
const V0 = v3();
const still = (shape: Part['shape'], key = 'p'): Part => ({ shape, v: V0, key });
/** A standing shin: a vertical capsule from the ground to 0.5 m at (x, z). */
const shin = (x: number, z: number, v: Vec3 = V0): Part => ({ shape: { kind: 'capsule', a: v3(x, 0.07, z), b: v3(x, 0.5, z), r: 0.065 }, v, key: `shin${x},${z}` });
const CEIL = 0.46;
/** Clear of every footprint by its radius and the foot's, on the wall's side, within reach. */
const holds = (g: FreeGround, p: Vec3 | null, hip: Vec3, reachM: number, h: number, q: FootQuery): boolean => !!p && isFree(g, p, h, q) && Math.hypot(p.x - hip.x, p.z - hip.z) <= reachM + 1e-6;

describe('free ground (plan 15)', () => {
  beforeAll(initPhysics);
  it('a foot asked for inside a standing leg lands beside it, clear by both radii, and the nearest such place', () => {
    const g = groundOf([shin(0.3, 0)], CEIL);
    const hip = v3(0, 0.9, 0);
    const want = v3(0.28, 0, 0.02);
    const p = nearestFree(g, want, hip, 0.45, 0, FOOT);
    expect(holds(g, p, hip, 0.45, 0, FOOT)).toBe(true);
    // (exactly on the boundary: the shin's radius plus the foot's, from the shin's axis)
    expect(Math.hypot(p!.x - 0.3, p!.z)).toBeCloseTo(0.065 + 0.12, 6);
    // fault twin: the wanted point itself is inside the leg
    expect(holds(g, want, hip, 0.45, 0, FOOT)).toBe(false);
  });

  it('a leg coming at the foot is avoided where it will be, not where it is', () => {
    // a shin 0.5 m ahead closing at 2 m/s: over 0.2 s it comes 0.4 m nearer
    const g = groundOf([shin(0, 0.5, v3(0, 0, -2))], CEIL);
    const hip = v3(0, 0.9, 0);
    const want = v3(0, 0, 0.15);
    const p = nearestFree(g, want, hip, 0.45, 0.2, FOOT);
    expect(holds(g, p, hip, 0.45, 0.2, FOOT)).toBe(true);
    // fault twin: the footprint not moved (horizon 0), the wanted point is taken; there the leg will be
    const unmoved = nearestFree(g, want, hip, 0.45, 0, FOOT);
    expect(unmoved).toEqual(want);
    expect(holds(g, unmoved, hip, 0.45, 0.2, FOOT)).toBe(false);
    // a foot lands on a place on the ground, so a leg's own velocity moves it: a leg standing still is avoided where it
    // stands, however the stepping player moves (fault twin: moved by its velocity relative to a player coming at 2 m/s,
    // it moves out of the way of the wanted point)
    const stand = groundOf([shin(0, 0.15)], CEIL);
    expect(nearestFree(stand, want, hip, 0.45, 0.2, FOOT)).not.toEqual(want);
    const relative = groundOf([shin(0, 0.15, v3(0, 0, -2))], CEIL);
    expect(nearestFree(relative, want, hip, 0.45, 0.2, FOOT)).toEqual(want);
    expect(isFree(stand, want, 0.2, FOOT)).toBe(false);
  });

  it('the foot keeps to its own side of its other foot (the legs never cross)', () => {
    // the right foot (its side +x) asks for a place across the planted left foot at x = -0.1
    const q: FootQuery = { clearM: 0.12, wall: { p: { x: -0.1, z: 0 }, n: { x: 1, z: 0 }, sepM: 0.14 } };
    const g = groundOf([], CEIL);
    const hip = v3(0.1, 0.9, 0);
    const want = v3(-0.2, 0, 0.1);
    const p = nearestFree(g, want, hip, 0.45, 0, q);
    expect(holds(g, p, hip, 0.45, 0, q)).toBe(true);
    expect(p!.x).toBeCloseTo(0.04, 6);
    // fault twin: no wall, the foot crosses
    expect(holds(g, nearestFree(g, want, hip, 0.45, 0, FOOT), hip, 0.45, 0, q)).toBe(false);
  });

  it('two bodies side by side leave the gap only where both allow it (every footprint at once)', () => {
    // two shins 0.35 m apart; the wanted point between them is inside both clearances
    const g = groundOf([shin(-0.175, 0.3), shin(0.175, 0.3)], CEIL);
    const hip = v3(0, 0.9, 0);
    const want = v3(0.02, 0, 0.3);
    const p = nearestFree(g, want, hip, 0.45, 0, FOOT);
    expect(holds(g, p, hip, 0.45, 0, FOOT)).toBe(true);
    // fault twin: out of the nearer leg alone, the foot is pushed into the other
    const one = nearestFree(groundOf([shin(0.175, 0.3)], CEIL), want, hip, 0.45, 0, FOOT);
    expect(holds(g, one, hip, 0.45, 0, FOOT)).toBe(false);
  });

  it('is the nearest free point within reach, against a dense search, over constructed scenes', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const r = (lo: number, hi: number): number => lo + (hi - lo) * rnd();
    let none = 0;
    let faulty = 0;
    const dPart = (p: Part, x: Vec3): number => { const f = footprintOf(p, CEIL); return f ? outlineDist(f.pts, { x: x.x, z: x.z }) - f.r : Infinity; };
    for (let n = 0; n < 24; n++) {
      const parts: Part[] = [];
      const k = 1 + Math.floor(r(0, 4));
      for (let i = 0; i < k; i++) {
        const c = v3(r(-0.5, 0.5), 0, r(-0.5, 0.5));
        const kind = i % 3;
        if (kind === 0) parts.push(shin(c.x, c.z));
        else if (kind === 1) parts.push(still({ kind: 'capsule', a: v3(c.x, 0.1, c.z), b: v3(c.x + r(-0.4, 0.4), 0.15, c.z + r(-0.4, 0.4)), r: 0.08 }, `c${i}`));
        else parts.push(still({ kind: 'box', c: v3(c.x, 0.15, c.z), he: v3(0.2, 0.12, 0.1), q: qFromAxisAngle(v3(0, 1, 0), r(0, Math.PI)) }, `b${i}`));
      }
      const g = groundOf(parts, CEIL);
      const hip = v3(r(-0.2, 0.2), 0.9, r(-0.2, 0.2));
      const reach = r(0.3, 0.5);
      const want = v3(r(-0.6, 0.6), 0, r(-0.6, 0.6));
      const q: FootQuery = n % 2 ? FOOT : { clearM: 0.12, wall: { p: { x: hip.x - 0.12, z: hip.z }, n: { x: 1, z: 0 }, sepM: 0.14 } };
      const p = nearestFree(g, want, hip, reach, 0, q);
      // the dense search: every 4 mm of the reach disc
      let best = Infinity;
      for (let x = -reach; x <= reach; x += 0.004)
        for (let z = -reach; z <= reach; z += 0.004) {
          if (x * x + z * z > reach * reach) continue;
          const s = v3(hip.x + x, 0, hip.z + z);
          if (isFree(g, s, 0, q)) best = Math.min(best, Math.hypot(s.x - want.x, s.z - want.z));
        }
      if (!p) {
        none++;
        expect(best).toBe(Infinity);
        continue;
      }
      expect(holds(g, p, hip, reach, 0, q)).toBe(true);
      expect(Math.hypot(p.x - want.x, p.z - want.z)).toBeLessThanOrEqual(best + 1e-9);
      // fault twin: out of the footprint nearest the wanted point alone (one footprint at a time)
      const nearest = [...parts].sort((u, w) => dPart(u, want) - dPart(w, want))[0];
      const one = nearestFree(groundOf([nearest], CEIL), want, hip, reach, 0, q);
      if (!(holds(g, one, hip, reach, 0, q) && Math.hypot(one!.x - want.x, one!.z - want.z) <= best + 1e-9)) faulty++;
    }
    expect(none).toBeLessThan(24);
    expect(faulty).toBeGreaterThan(0);
  });

  it('the whole leg: a place in front of another player\'s knee is free ground but not for the leg standing on it', () => {
    const R = FIX('L3-F6-hold').ragdoll!;
    const sole = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
    // his thigh reaching in at the height of the stepping player's thighs, his knee 0.72 m up, 0.33 m ahead of the hip
    const g = groundOf([still({ kind: 'capsule', a: v3(0.12, 0.95, 0.8), b: v3(0.12, 0.72, 0.33), r: R.radii.thigh }, 'B:thigh')], sole + R.lengths.shin);
    const hip = v3(0.12, sole + 0.75, 0);
    const leg = { at: (p: Vec3) => plannedLeg(R, 'right', hip, v3(p.x, sole, p.z), 0), skinM: 0.01 };
    const want = v3(0.12, 0, 0.35);
    const q: FootQuery = { clearM: 0.1, leg };
    // (on the ground he is no footprint: the place itself is free ground)
    expect(isFree(g, want, 0, { clearM: 0.1 })).toBe(true);
    const p = nearestFree(g, want, hip, 0.4, 0, q);
    expect(p).not.toBeNull();
    expect(legHit(g, leg.at(p!), 0, 0.01)).toBeNull();
    expect(isFree(g, p!, 0, q)).toBe(true);
    // fault twin: the leg not judged: the wanted place is taken, and the leg standing there is in his thigh
    const blind = nearestFree(g, want, hip, 0.4, 0, { clearM: 0.1 });
    expect(blind).toEqual(want);
    expect(legHit(g, leg.at(blind!), 0, 0)).not.toBeNull();
  });

  it('the leg\'s range: the nearest place where the leg is in range, against a dense search; none where it is in range nowhere', () => {
    // a leg in range only within a wedge ahead of a line 0.1 m behind the hip turned 30 degrees (as a hip's extension range
    // bounds a trailing foot), with a shin standing ahead: the wanted place is behind the line
    const hip = v3(0, 0.9, 0);
    const n = { x: Math.sin(Math.PI / 6), z: Math.cos(Math.PI / 6) };
    const inRange = (p: Vec3): boolean => (p.x - hip.x) * n.x + (p.z - hip.z) * n.z >= -0.1;
    const g = groundOf([shin(0.1, 0.25)], CEIL);
    const leg = { at: (): never[] => [], skinM: 0, inRange };
    const q: FootQuery = { clearM: 0.1, leg };
    for (const want of [v3(0, 0, -0.35), v3(0.3, 0, -0.35), v3(-0.3, 0, -0.2), v3(0.1, 0, 0.2)]) {
      const p = nearestFree(g, want, hip, 0.4, 0, q);
      expect(p).not.toBeNull();
      expect(isFree(g, p!, 0, q)).toBe(true);
      let best = Infinity;
      for (let x = -0.4; x <= 0.4; x += 0.004)
        for (let z = -0.4; z <= 0.4; z += 0.004) {
          const s = v3(hip.x + x, 0, hip.z + z);
          if (x * x + z * z <= 0.16 && isFree(g, s, 0, q)) best = Math.min(best, Math.hypot(s.x - want.x, s.z - want.z));
        }
      expect(Math.hypot(p!.x - want.x, p!.z - want.z)).toBeLessThanOrEqual(best + 1e-3);
      // fault twin: the range not asked: a place where the leg is out of its range
      if (!inRange(want)) expect(inRange(nearestFree(g, want, hip, 0.4, 0, { clearM: 0.1 })!)).toBe(false);
    }
    // out of range under the hip, it is out of range everywhere: nowhere to stand
    expect(nearestFree(g, v3(0, 0, 0.1), hip, 0.4, 0, { clearM: 0.1, leg: { ...leg, inRange: () => false } })).toBeNull();
  });

  it('only what comes down to the shin is ground: a leg below it, a body above it not, a box cut where it passes it', () => {
    // a thigh from the hip (0.9 m) to the knee (0.45 m) a little ahead: only its lowest part, near the knee
    const thigh = footprintOf(still({ kind: 'capsule', a: v3(0, 0.9, 0), b: v3(0, 0.45, 0.4), r: 0.085 }), CEIL)!;
    expect(thigh.pts.length).toBe(2);
    expect(Math.min(...thigh.pts.map((p) => p.z))).toBeGreaterThan(0.3);
    // fault twin: the whole thigh down to the hip would block the ground under the stepping player's own hip
    expect(outlineDist(thigh.pts, { x: 0, z: 0 })).toBeGreaterThan(0.3);
    // an upright torso over the hips is no footprint; the same torso lying on the ground is
    const torso = (c: Vec3, q = qFromAxisAngle(v3(1, 0, 0), 0)): Part => still({ kind: 'box', c, he: v3(0.25, 0.29, 0.16), q });
    expect(footprintOf(torso(v3(0, 1.15, 0)), CEIL)).toBeNull();
    expect(footprintOf(torso(v3(0, 0.16, 0), qFromAxisAngle(v3(1, 0, 0), Math.PI / 2)), CEIL)).not.toBeNull();
    // a torso pitched 60 deg forward, its lower edge down at 0.3 m: cut at the shin, it covers less than its whole outline
    const q = qFromAxisAngle(v3(1, 0, 0), Math.PI / 3);
    const drop = Math.max(...[-1, 1].flatMap((y) => [-1, 1].map((z) => -qRot(q, v3(0, 0.29 * y, 0.16 * z)).y)));
    const pitched = torso(v3(0, 0.3 + drop, 0.3), q);
    const cut = footprintOf(pitched, CEIL)!;
    const whole = footprintOf(pitched, 10)!;
    const area = (ps: { x: number; z: number }[]): number => Math.abs(ps.reduce((s, p, i) => s + p.x * ps[(i + 1) % ps.length].z - ps[(i + 1) % ps.length].x * p.z, 0)) / 2;
    expect(area(cut.pts)).toBeGreaterThan(0);
    expect(area(cut.pts)).toBeLessThan(0.6 * area(whole.pts));
  });

  it('reads the other players in a scene: their legs and bodies, never the stepping player himself', async () => {
    const THIN: FootQuery = { clearM: 0.02 };
    /** A supported player's ankles; a ragdoll's shoe boxes. */
    const feetOf = (pl: Simulation['players'][number]): Vec3[] =>
      pl.rag ? pl.rag.colliders.filter((c) => /Shin$/.test(c.segment) && c.collider.shape.type === RAPIER.ShapeType.Cuboid).map((c) => vc(c.collider.translation())) : (['left', 'right'] as const).map((s) => pl.pose!.jointLandmarksWorld[`${s}Ankle`]);
    const check = (sim: Simulation): void => {
      const parts = bodyParts(sim.players as unknown as PartsPlayer[], sim.def.ragdoll!);
      for (const me of sim.players) {
        if (me.rag || !me.pose) continue;
        const g = groundFor(parts, me.id, CEIL);
        for (const o of sim.players) {
          if (o === me) continue;
          // a foot on the other man's foot is not free ...
          expect(feetOf(o).length).toBe(2);
          for (const p of feetOf(o)) expect(isFree(g, p, 0, THIN)).toBe(false);
          // fault twin: his legs (a ragdoll: all of him) left out, the proxy alone; a foot of his reads free
          const body = groundOf(parts.get(o.id)!.filter((p) => p.key.endsWith(':proxy')), CEIL);
          expect(feetOf(o).some((p) => isFree(body, p, 0, THIN))).toBe(true);
        }
        // the stepping player's own feet stand on free ground (he is not his own obstacle) ...
        for (const p of feetOf(me)) expect(isFree(g, p, 0, THIN)).toBe(true);
        // fault twin: counted among the others, they do not
        const self = groundOf(parts.get(me.id)!, CEIL);
        for (const p of feetOf(me)) expect(isFree(self, p, 0, THIN)).toBe(false);
      }
    };
    // two supported players in a hold, 0.5 m apart
    const hold = loadState('tests/data/state/L3-F6-hold@216.json.gz');
    const a = await resumeState(hold, { def: asCaptured(hold) });
    expect(a.players.every((p) => !p.rag)).toBe(true);
    check(a);
    // a ragdoll and a supported player, 8 ticks after the capture
    const fall = loadState('tests/data/state/L3-F1-falling@40.json.gz');
    const b = await resumeState(fall, { def: asCaptured(fall) });
    for (let k = 0; k < 8; k++) b.stepTick();
    expect(b.players.map((p) => !!p.rag).sort()).toEqual([false, true]);
    check(b);
  });
});
