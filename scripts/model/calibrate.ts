// Asset calibration for the supplied player (models/bew-v6.glb). Every number is measured from the committed GLB:
// rest joints from the node hierarchy (bind = rest, checked), regions from the embedded texture key colours
// (models/rig.md), limb radii from bone-dominant vertices. Output: the one calibration record the sim profiles,
// candidate construction, rules and the render adapter share (src/sim/model/bew-v6.calibration.json).
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { accessor, imagePng, nodeWorld, readGlb, texel, type GlbFile } from './glb';
import type { ModelCalibration, Tuple3, Tuple4 } from '../../src/sim/model/calibration-types';

const KEY = { jersey: '081573', pants: 'DCDCDC', gloves: 'E6E6E6', socks: '081F73', shoes: '030303', skin: 'F29E5A', helmetShell: '081F73', facemask: 'FFFFFF' };
/** Proxy origin height above the floor (the support shape geometry is the Gate 1-4 upper-body compound's). */
const REST_ORIGIN_Y = 0.95;

/** 1e-5 rounding; -0 is written as 0 (the record round-trips through JSON). */
const r5 = (x: number): number => Math.round(x * 1e5) / 1e5 || 0;
const t3 = (v: THREE.Vector3): Tuple3 => [r5(v.x), r5(v.y), r5(v.z)];
const t4 = (q: THREE.Quaternion): Tuple4 => [r5(q.x), r5(q.y), r5(q.z), r5(q.w)];
const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN;
};
const pct = (a: number[], q: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

interface Vert {
  p: THREE.Vector3;
  bone: string;
  color: string;
}

function vertices(g: GlbFile, mesh: number, image: number, jointNames: string[]): Vert[] {
  const prim = g.json.meshes[mesh].primitives[0];
  const P = accessor(g, prim.attributes.POSITION);
  const UV = accessor(g, prim.attributes.TEXCOORD_0);
  const J = accessor(g, prim.attributes.JOINTS_0);
  const W = accessor(g, prim.attributes.WEIGHTS_0);
  const png = imagePng(g, image);
  const out: Vert[] = [];
  for (let i = 0; i < P.count; i++) {
    let bi = 0;
    for (let k = 1; k < 4; k++) if (W.data[i * 4 + k] > W.data[i * 4 + bi]) bi = k;
    out.push({
      p: new THREE.Vector3(P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]),
      bone: jointNames[J.data[i * 4 + bi]],
      color: texel(png, UV.data[i * 2], UV.data[i * 2 + 1]),
    });
  }
  return out;
}

/** Orthonormal rotation from basis columns (X, Y, Z = X x Y). */
function basis(X: THREE.Vector3, Y: THREE.Vector3): THREE.Quaternion {
  const y = Y.clone().normalize();
  const x = X.clone().sub(y.clone().multiplyScalar(X.dot(y))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function calibrate(path = 'models/bew-v6.glb'): ModelCalibration {
  const g = readGlb(path);
  const { world, names } = nodeWorld(g);
  const skin = g.json.skins[0];
  const strip = (n: string): string => n.replace(/^mixamorig:/, '');
  const jointNames: string[] = skin.joints.map((i: number) => strip(names[i]));
  // bind = rest check: world(joint) * inverseBind = I
  const ibm = accessor(g, skin.inverseBindMatrices);
  let bindErr = 0;
  skin.joints.forEach((j: number, k: number) => {
    const m = world[j].clone().multiply(new THREE.Matrix4().fromArray(ibm.data.slice(k * 16, k * 16 + 16)));
    const e = m.elements;
    const id = new THREE.Matrix4().elements;
    for (let i = 0; i < 16; i++) bindErr = Math.max(bindErr, Math.abs(e[i] - id[i]));
  });
  const joint = (name: string): { p: THREE.Vector3; q: THREE.Quaternion } => {
    const i = names.indexOf(`mixamorig:${name}`);
    if (i < 0) throw new Error(`missing bone ${name}`);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    world[i].decompose(p, q, new THREE.Vector3());
    return { p, q };
  };
  const hips = joint('Hips').p;
  const origin = new THREE.Vector3(0, REST_ORIGIN_Y, hips.z);
  const L = (v: THREE.Vector3): THREE.Vector3 => v.clone().sub(origin);
  const parents: Record<string, string | null> = {};
  const restJoints: ModelCalibration['restJoints'] = {};
  for (const j of skin.joints as number[]) {
    const name = strip(names[j]);
    const pi = (g.json.nodes as any[]).findIndex((n) => (n.children ?? []).includes(j));
    parents[name] = pi >= 0 && skin.joints.includes(pi) ? strip(names[pi]) : null;
    const { p, q } = joint(name);
    restJoints[name] = { p: t3(L(p)), q: t4(q) };
  }
  // anatomical side basis: the GLB's Right* bones lie on -X with the character facing +Z
  const rightSignX = Math.sign(joint('RightArm').p.x) as 1 | -1;
  const body = vertices(g, 0, 0, jointNames);
  const helmet = vertices(g, 1, 1, jointNames);
  // ---------------- limb lengths (both sides averaged; asymmetry recorded)
  const seg = (a: string, b: string): number => joint(a).p.distanceTo(joint(b).p);
  const both = (a: string, b: string): { m: number; asym: number } => {
    const l = seg(`Left${a}`, `Left${b}`);
    const r = seg(`Right${a}`, `Right${b}`);
    return { m: 0.5 * (l + r), asym: Math.abs(l - r) };
  };
  const upperArm = both('Arm', 'ForeArm');
  const forearm = both('ForeArm', 'Hand');
  const thigh = both('UpLeg', 'Leg');
  const shin = both('Leg', 'Foot');
  // ---------------- limb radii: median distance of a bone's dominant vertices from its axis (segment interior)
  const radius = (bone: string, child: string): number => {
    const d: number[] = [];
    for (const s of ['Left', 'Right']) {
      const a = joint(`${s}${bone}`).p;
      const b = joint(`${s}${child}`).p;
      const ab = b.clone().sub(a);
      const l2 = ab.lengthSq();
      for (const v of body) {
        if (v.bone !== `${s}${bone}`) continue;
        const u = v.p.clone().sub(a).dot(ab) / l2;
        if (u < 0.15 || u > 0.85) continue;
        d.push(v.p.clone().sub(a.clone().addScaledVector(ab, u)).length());
      }
    }
    return median(d);
  };
  // ---------------- glove (palm contact): glove-coloured vertices in the forearm axis frame from the wrist
  const glove = (s: 'Left' | 'Right') => {
    const wrist = joint(`${s}Hand`).p;
    const axis = wrist.clone().sub(joint(`${s}ForeArm`).p).normalize();
    const along: number[] = [];
    const radial: number[] = [];
    for (const v of body) {
      if (v.color !== KEY.gloves || !v.bone.startsWith(`${s}Hand`)) continue;
      const d = v.p.clone().sub(wrist);
      const a = d.dot(axis);
      along.push(a);
      radial.push(d.sub(axis.clone().multiplyScalar(a)).length());
    }
    return { n: along.length, centerAlong: along.reduce((x, y) => x + y, 0) / along.length, radius: median(radial), tipAlong: Math.max(...along), baseAlong: Math.min(...along) };
  };
  const gl = glove('Left');
  const gr = glove('Right');
  const palmRadius = 0.5 * (gl.radius + gr.radius);
  const palmCenter = 0.5 * (gl.centerAlong + gr.centerAlong);
  // ---------------- shoe: shoe-coloured vertices in the shin rest frame (origin ankle, Y up the shin, X knee axis)
  const shoe = (s: 'Left' | 'Right') => {
    const ankle = joint(`${s}Foot`).p;
    const frame = basis(new THREE.Vector3(1, 0, 0), joint(`${s}Leg`).p.clone().sub(ankle));
    const inv = frame.clone().invert();
    const pts: THREE.Vector3[] = [];
    let soleY = Infinity;
    for (const v of body) {
      if (v.color !== KEY.shoes || !(v.bone.startsWith(`${s}Foot`) || v.bone.startsWith(`${s}Toe`) || v.bone === `${s}Leg`)) continue;
      pts.push(v.p.clone().sub(ankle).applyQuaternion(inv));
      soleY = Math.min(soleY, v.p.y);
    }
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      lo.min(p);
      hi.max(p);
    }
    return { n: pts.length, lo, hi, soleY, ankleY: ankle.y };
  };
  const sl = shoe('Left');
  const sr = shoe('Right');
  const shoeLo = sl.lo.clone().add(new THREE.Vector3(-sr.hi.x, sr.lo.y, sr.lo.z)).multiplyScalar(0.5);
  const shoeHi = sl.hi.clone().add(new THREE.Vector3(-sr.lo.x, sr.hi.y, sr.hi.z)).multiplyScalar(0.5);
  const shoeC = shoeLo.clone().add(shoeHi).multiplyScalar(0.5);
  const shoeHe = shoeHi.clone().sub(shoeLo).multiplyScalar(0.5);
  // ---------------- torso / pelvis boxes (body-local), robust percentile bounds of bone-dominant vertices
  const box = (pred: (v: Vert) => boolean, qLo = 0.02, qHi = 0.98) => {
    const vs = body.filter(pred).map((v) => L(v.p));
    const ax = (k: 'x' | 'y' | 'z') => [pct(vs.map((p) => p[k]), qLo), pct(vs.map((p) => p[k]), qHi)];
    const [x0, x1] = ax('x');
    const [y0, y1] = ax('y');
    const [z0, z1] = ax('z');
    // symmetric about the body plane (the art is mirrored)
    const hx = 0.5 * (Math.abs(x0) + Math.abs(x1));
    return { n: vs.length, center: new THREE.Vector3(0, 0.5 * (y0 + y1), 0.5 * (z0 + z1)), half: new THREE.Vector3(hx, 0.5 * (y1 - y0), 0.5 * (z1 - z0)) };
  };
  // Trunk = hips, spine and clavicle-dominant vertices, split at the Spine joint height so the two boxes meet (a
  // bone-dominance split leaves a waist gap); the torso box starts TRUNK_OVERLAP_M below the split.
  const TRUNK_OVERLAP_M = 0.03;
  const trunk = (v: Vert): boolean => /^(Hips|Spine|Spine1|Spine2|LeftShoulder|RightShoulder)$/.test(v.bone);
  const splitY = joint('Spine').p.y;
  const torso = box((v) => trunk(v) && v.p.y >= splitY - TRUNK_OVERLAP_M);
  const pelvis = box((v) => trunk(v) && v.p.y < splitY);
  // ---------------- trunk hull (arm self-clearance): the spine and hips skin as stacked convex slabs (body-local). The
  // clavicle (shoulder pad) vertices are left out so no slab fills the armpit; slabs overlap by SLAB_OVERLAP_M.
  const SLAB_OVERLAP_M = 0.01;
  const trunkSkin = body.filter((v) => /^(Hips|Spine|Spine1|Spine2)$/.test(v.bone)).map((v) => L(v.p));
  const topY = Math.max(...trunkSkin.map((p) => p.y));
  const lowY = Math.min(...trunkSkin.map((p) => p.y));
  const slabs = (y0: number, y1: number, n: number): { yRange: [number, number]; points: Tuple3[] }[] =>
    Array.from({ length: n }, (_, k) => {
      const a = y0 + ((y1 - y0) * k) / n;
      const b = y0 + ((y1 - y0) * (k + 1)) / n;
      const pts = trunkSkin.filter((p) => p.y >= a - SLAB_OVERLAP_M && p.y <= b + SLAB_OVERLAP_M);
      const hull = new ConvexHull().setFromPoints(pts);
      const verts = new Map<string, Tuple3>();
      for (const f of hull.faces) {
        let e = f.edge;
        do {
          const t = t3(e.head().point);
          verts.set(t.join(','), t);
          e = e.next;
        } while (e !== f.edge);
      }
      return { yRange: [r5(a), r5(b)] as [number, number], points: [...verts.values()].sort((u, w) => u[1] - w[1] || u[0] - w[0] || u[2] - w[2]) };
    });
  const splitL = L(joint('Spine').p).y;
  const trunkHull = { vertices: trunkSkin.length, pieces: [...slabs(lowY, splitL, 2), ...slabs(splitL, topY, 5)] };
  // ---------------- helmet: shell-coloured helmet vertices -> head sphere; full helmet bounds recorded
  const shell = helmet.filter((v) => v.color === KEY.helmetShell).map((v) => L(v.p));
  const hc = shell.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / shell.length);
  hc.x = 0;
  const headR = median(shell.map((p) => p.distanceTo(hc)));
  const hLo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hHi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const v of helmet) {
    hLo.min(L(v.p));
    hHi.max(L(v.p));
  }
  // ---------------- rest segment frames (body-local): limb frames per the pose/ragdoll convention (+Y toward the
  // proximal joint, X = hinge axis with positive flexion = elbow forward from the T-pose, knee backward)
  const segFrames: ModelCalibration['segmentRest'] = { core: [0, 0, 0, 1], head: [0, 0, 0, 1] };
  for (const s of ['Left', 'Right'] as const) {
    const side = s.toLowerCase();
    const sh = joint(`${s}Arm`).p;
    const el = joint(`${s}ForeArm`).p;
    const wr = joint(`${s}Hand`).p;
    const dA = el.clone().sub(sh).normalize();
    const dB = wr.clone().sub(el).normalize();
    // elbow axis: forward flexion of a T-pose arm along +-X turns about the vertical, sign from dA x forward
    const elbowAxis = new THREE.Vector3().crossVectors(dA, new THREE.Vector3(0, 0, 1)).normalize();
    segFrames[`${side}UpperArm`] = t4(basis(elbowAxis, dA.clone().negate()));
    segFrames[`${side}Forearm`] = t4(basis(elbowAxis, dB.clone().negate()));
    const hp = joint(`${s}UpLeg`).p;
    const kn = joint(`${s}Leg`).p;
    const an = joint(`${s}Foot`).p;
    // knee axis: backward flexion of a straight leg turns about +X (thigh down x backward)
    const kneeAxis = new THREE.Vector3(1, 0, 0);
    segFrames[`${side}Thigh`] = t4(basis(kneeAxis, hp.clone().sub(kn)));
    segFrames[`${side}Shin`] = t4(basis(kneeAxis, kn.clone().sub(an)));
  }
  const lm = (name: string): Tuple3 => t3(L(joint(name).p));
  return {
    asset: {
      file: path.split('/').pop()!,
      bytes: g.bytes,
      sha256: g.sha256,
      joints: skin.joints.length,
      triangles: (g.json.meshes as any[]).reduce((n, m) => n + m.primitives.reduce((k: number, p: any) => k + g.json.accessors[p.indices].count / 3, 0), 0),
      meshes: (g.json.meshes as any[]).map((m) => m.name),
      morphTargets: g.json.meshes[0].extras?.targetNames ?? [],
      animations: g.json.animations?.length ?? 0,
      bindRestMaxErr: Number(bindErr.toExponential(3)),
    },
    frame: {
      note: 'body-local = GLB world rest - origin; axes unchanged (Y up, Z forward); anatomical Right on rightSignX',
      origin: t3(origin),
      restOriginY: REST_ORIGIN_Y,
      rightSignX,
    },
    parents,
    restJoints,
    landmarks: {
      pelvisMid: lm('Hips'),
      neck: lm('Neck'),
      head: lm('Head'),
      leftShoulder: lm('LeftArm'),
      rightShoulder: lm('RightArm'),
      leftElbow: lm('LeftForeArm'),
      rightElbow: lm('RightForeArm'),
      leftWrist: lm('LeftHand'),
      rightWrist: lm('RightHand'),
      leftHip: lm('LeftUpLeg'),
      rightHip: lm('RightUpLeg'),
      leftKnee: lm('LeftLeg'),
      rightKnee: lm('RightLeg'),
      leftAnkle: lm('LeftFoot'),
      rightAnkle: lm('RightFoot'),
      leftToe: lm('LeftToeBase'),
      rightToe: lm('RightToeBase'),
    },
    lengths: {
      upperArm: r5(upperArm.m),
      forearm: r5(forearm.m),
      palmExtension: r5(palmCenter + palmRadius),
      thigh: r5(thigh.m),
      shin: r5(shin.m),
      asymmetryM: r5(Math.max(upperArm.asym, forearm.asym, thigh.asym, shin.asym)),
    },
    radii: {
      upperArm: r5(radius('Arm', 'ForeArm')),
      forearm: r5(radius('ForeArm', 'Hand')),
      thigh: r5(radius('UpLeg', 'Leg')),
      shin: r5(radius('Leg', 'Foot')),
      palm: r5(palmRadius),
      head: r5(headR),
    },
    glove: {
      vertices: gl.n + gr.n,
      palmCenterAlongM: r5(palmCenter),
      tipAlongM: r5(0.5 * (gl.tipAlong + gr.tipAlong)),
      baseAlongM: r5(0.5 * (gl.baseAlong + gr.baseAlong)),
    },
    shoe: {
      vertices: sl.n + sr.n,
      centerShin: t3(shoeC),
      halfExtents: t3(shoeHe),
      soleAboveFloorM: r5(Math.min(sl.soleY, sr.soleY)),
      ankleAboveFloorM: r5(0.5 * (sl.ankleY + sr.ankleY)),
    },
    torso: { vertices: torso.n, center: t3(torso.center), halfExtents: t3(torso.half) },
    pelvis: { vertices: pelvis.n, center: t3(pelvis.center), halfExtents: t3(pelvis.half) },
    trunkHull,
    helmet: { shellVertices: shell.length, center: t3(hc), boundsMin: t3(hLo), boundsMax: t3(hHi) },
    segmentRest: segFrames,
    keyColors: KEY,
  };
}
