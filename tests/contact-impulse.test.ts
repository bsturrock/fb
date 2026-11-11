import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, RAPIER, solvedImpulses } from '../src/sim/physics';
import { allFixtures } from '../src/sim/fixtures';
import { vc, type Pose } from '../src/sim/vec';

// Ladder rung 7c: contact impulses read as solved. Rapier solves at most four points of a manifold and writes the solved
// impulse back to those only; a point it leaves out keeps the impulse of the last solve that included it, and every
// manifold point's `contactImpulse` read as applied counted it again (`solvedImpulses`, physics.ts).
beforeAll(async () => {
  await initPhysics();
});

const poseOf = (c: RAPIER.Collider): Pose => ({ p: vc(c.translation()), q: { ...c.rotation() } });

/**
 * A hexagonal prism (10 kg, a convex hull: its face contact on the slab is a five-point manifold) rocking on a fixed
 * slab, both frictionless, so the slab's contact impulse is along +y alone. Per step: the prism's momentum change less
 * gravity (what the contact applied) and the manifold's summed normal impulse, read as solved and as every point reads.
 */
function rockingPrism(steps: number): { applied: number; solved: number; every: number; points: number }[] {
  const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 4;
  const slab = w.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.5, 5).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0)));
  const pts: number[] = [];
  for (let k = 0; k < 6; k++) for (const y of [-0.05, 0.05]) pts.push(0.15 * Math.cos((Math.PI * k) / 3), y, 0.15 * Math.sin((Math.PI * k) / 3));
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.049, 0).setAngvel({ x: 2, y: 0.3, z: 1.4 }));
  const prism = w.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts))!.setMass(10).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), body);
  const out: { applied: number; solved: number; every: number; points: number }[] = [];
  let py = 10 * body.linvel().y;
  for (let i = 0; i < steps; i++) {
    w.step();
    const p = 10 * body.linvel().y;
    const applied = p - py + 10 * 9.81 * w.timestep;
    py = p;
    let solved = 0;
    let every = 0;
    let points = 0;
    w.contactPair(slab, prism, (m, flipped) => {
      const J = solvedImpulses(m, poseOf(flipped ? prism : slab), poseOf(flipped ? slab : prism));
      points = Math.max(points, m.numContacts());
      for (let k = 0; k < m.numContacts(); k++) {
        solved += J[k];
        every += m.contactImpulse(k);
      }
    });
    out.push({ applied, solved, every, points });
  }
  w.free();
  return out;
}

describe('rung 7c: contact impulses read as solved', () => {
  it('a rocking hull on a slab: the solved reading is the momentum the contact applied, every step; every point read as applied is not (the stale points)', () => {
    const run = rockingPrism(480).slice(1);
    const off = (x: number, y: number): boolean => Math.abs(x - y) > 1e-3 * Math.max(1, Math.abs(y));
    // the case: five-point manifolds, more than Rapier solves
    expect(Math.max(...run.map((r) => r.points))).toBeGreaterThan(4);
    expect(run.filter((r) => off(r.solved, r.applied)).length).toBe(0);
    // fault twin: the old reading, every manifold point's impulse
    expect(run.filter((r) => off(r.every, r.applied)).length).toBeGreaterThan(run.length / 2);
    expect(run.reduce((a, r) => a + r.every - r.applied, 0)).toBeGreaterThan(10);
  });

  it('the solved reading is on for the L3, L4 and HC families only; the older families keep the reading their evidence was made with', () => {
    const fams = new Map<string, boolean[]>();
    for (const d of allFixtures()) {
      const f = /^(G\d|L\d|RH|HC)/.exec(d.milestone)![1];
      fams.set(f, [...(fams.get(f) ?? []), !!d.solver.solvedImpulses]);
    }
    for (const [f, on] of fams) expect([f, new Set(on)], f).toEqual([f, new Set([['L3', 'L4', 'HC'].includes(f)])]);
  });
});
