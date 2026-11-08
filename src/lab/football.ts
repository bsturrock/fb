// The cosmetic football (one prop for the player view and the rule overlay), ported from sim-6 src/movement/football.ts:
// long axis +Y, half-length 0.14 m, radius 0.085 m, laces on +Z. No collider, mass or rule authority.
import * as THREE from 'three';
import type { Quat } from '../sim/vec';

export const FOOTBALL = { halfM: 0.14, radiusM: 0.085 };

export function createFootball(): THREE.Group {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = (Math.PI * i) / 16;
    pts.push(new THREE.Vector2(FOOTBALL.radiusM * Math.sin(t) ** 1.3, -FOOTBALL.halfM * Math.cos(t)));
  }
  const g = new THREE.Group();
  const skin = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), new THREE.MeshStandardMaterial({ color: 0x713b20, roughness: 0.9, flatShading: true }));
  skin.castShadow = true;
  g.add(skin);
  const white = new THREE.MeshStandardMaterial({ color: 0xeee5d2 });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.09, 0.004), white);
  seam.position.z = 0.085;
  g.add(seam);
  for (let i = 0; i < 6; i++) {
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.004, 0.004), white);
    lace.position.set(0, (i - 2.5) * 0.013, 0.086 - Math.abs(i - 2.5) * 0.0015);
    g.add(lace);
  }
  return g;
}

/** A ball without a carry seat lies along the runner's forward axis (the earlier ellipsoids' look). */
const FORWARD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
export function forwardBallQ(core: Quat): Quat {
  const q = new THREE.Quaternion(core.x, core.y, core.z, core.w).multiply(FORWARD);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
