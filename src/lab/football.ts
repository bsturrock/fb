// The cosmetic football (one prop for the player view and the rule overlay), ported from sim-6 src/movement/football.ts:
// long axis +Y, half-length 0.14 m, radius 0.085 m, laces on +Z. No collider, mass or rule authority (the pose keeps the
// carry arm's ball clear of other bodies as a clearance capsule, plan 10d D4).
import * as THREE from 'three';
import { CARRY_L3 } from '../sim/carry';

/** The carry profile's football (plan 10d: the seat's clearance capsule is this ball). */
export const FOOTBALL = { ...CARRY_L3.ball };

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

