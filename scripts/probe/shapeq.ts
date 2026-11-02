import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
const b = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(1, 0, 0));
const c = w.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.3, 0.16), b);
w.step();
const ball = new RAPIER.Ball(0.04);
for (const x of [0.6, 0.71, 0.75, 0.8]) {
  const r = c.contactShape(ball, { x, y: 0.1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 0.1);
  console.log('collider.contactShape x', x, r && { d: r.distance, p1: r.point1, p2: r.point2, n1: r.normal1, n2: r.normal2 });
  const s = c.shape.contactShape(c.translation(), c.rotation(), ball, { x, y: 0.1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 0.1);
  console.log('  shape.contactShape', s && { d: s.distance, p1: s.point1, n1: s.normal1 });
}
const cap = new RAPIER.Capsule(0.17, 0.045);
const r = c.contactShape(cap, { x: 0.7, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, 0.1);
console.log('capsule', r && { d: r.distance, p1: r.point1, p2: r.point2, n1: r.normal1 });
