// Rapier 0.21 behaviour probe for Gate 4: disabled-body mass props, revolute limit sign, joint anchors.
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 60;
// (1) disabled body mass properties
const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).setEnabled(false));
w.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.05).setMass(4).setTranslation(0, -0.15, 0), b);
console.log('disabled mass', b.mass(), b.localCom(), b.principalInertia(), b.isEnabled());
b.recomputeMassPropertiesFromColliders();
console.log('after recompute', b.mass(), b.localCom(), b.principalInertia());
// (2) revolute limit sign: body A fixed, body B hangs along -Y; hinge axis X; give B angular velocity +X
for (const wsign of [1, -1]) {
  const W = new RAPIER.World({ x: 0, y: 0, z: 0 });
  W.timestep = 1 / 60;
  const A = W.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  W.createCollider(RAPIER.ColliderDesc.ball(0.05), A);
  const B = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -0.3, 0));
  W.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.04).setMass(1), B);
  const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.3, z: 0 }, { x: 1, y: 0, z: 0 });
  const j = W.createImpulseJoint(jd, A, B, true) as RAPIER.RevoluteImpulseJoint;
  j.setLimits(0, 1.0);
  // rigid rotation about the anchor: v = w x r, r = (0,-0.3,0)
  B.setAngvel({ x: 3 * wsign, y: 0, z: 0 }, true);
  B.setLinvel({ x: 0, y: 0, z: 3 * wsign * -0.3 * -1 * -1 }, true);
  for (let i = 0; i < 60; i++) W.step();
  const q = B.rotation();
  const ang = 2 * Math.atan2(q.x, q.w);
  console.log(`limits [0,1], spin ${wsign > 0 ? '+X' : '-X'}: B angle about X = ${ang.toFixed(3)} rad; limits`, j.limitsMin(), j.limitsMax());
}
// (3) frames: revolute with different body rotations via setLocalFrame
{
  const W = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const A = W.createRigidBody(RAPIER.RigidBodyDesc.fixed().setRotation({ x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) }));
  const B = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -0.3, 0).setRotation({ x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) }));
  W.createCollider(RAPIER.ColliderDesc.ball(0.05).setMass(1), B);
  const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.3, z: 0 }, { x: 1, y: 0, z: 0 });
  const j = W.createImpulseJoint(jd, A, B, true);
  W.step();
  console.log('same-rotation frames drift', B.translation(), B.rotation());
  void j;
}
