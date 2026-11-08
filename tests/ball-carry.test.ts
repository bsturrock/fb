// Plan 08a: the sim-6 carry ported into the L3 pose path. Donor fit, composition, authority, handoff and lifecycle.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { glbScene } from '../scripts/model/glb-scene';
import { capturePose, lerpPose } from '../src/lab/render-pose';
import { RigAdapter, cloneRig } from '../src/lab/rig-adapter';
import { CARRY_L3, carryArmSwing, carryRequest, seatBallLocal, seatBallQ, seatPalmLocal, type CarrySeat } from '../src/sim/carry';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { MODEL_CALIBRATION } from '../src/sim/model/profiles';
import { buildProxyPose, carriedBall, hingeChain, proceduralLocal, type PhysicalPose, type PoseClearance, type PoseShape, type ProxyPoseInput } from '../src/sim/pose';
import { shoulderLocal, sideSignX, type BodyProfile } from '../src/sim/profiles';
import { Simulation, type PlayerRuntime, type SimOptions } from '../src/sim/simulation';
import { add, addScaled, cross, dist, dot, len, lerp, norm, qFromAxisAngle, qIdentity, qInvRot, qRot, sub, toLocal, toWorld, v3, vc, type Pose, type Quat, type Vec3 } from '../src/sim/vec';
import { pace, runSim } from './helpers';

const tv = (p: Vec3): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);
const close = (a: THREE.Vector3, b: Vec3, tol = 1e-4): void => expect(a.distanceTo(tv(b))).toBeLessThan(tol);

/** The donor's arithmetic (sim-6 src/anim/ballCarry.ts rightCarry) on three.js types, chest frame, elbow at the origin. */
function donor(raw: number) {
  const C = CARRY_L3;
  const [b0, b1] = C.swingRange;
  const blend = Math.min(1, Math.max(0, (raw - b0) / (b1 - b0)));
  const dir = (a: Vec3, b: Vec3): THREE.Vector3 => tv(a).normalize().lerp(tv(b).normalize(), blend).normalize();
  const swing = C.swing * raw;
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const arc = (a: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(Y, C.swingIn * a).multiply(new THREE.Quaternion().setFromAxisAngle(X, -a));
  const qU = arc(swing);
  const qF = arc(swing * C.foreSwing);
  const l = (a: number, b: number): number => a + (b - a) * blend;
  const upper = dir(C.back.upper, C.fwd.upper).applyQuaternion(qU);
  const fore = dir(C.back.fore, C.fwd.fore).applyQuaternion(qF);
  const inside = tv(C.back.inside).lerp(tv(C.fwd.inside), blend).applyQuaternion(qF);
  inside.addScaledVector(fore, -inside.dot(fore)).normalize();
  const flex = l(C.back.wristFlex, C.fwd.wristFlex);
  const tilt = l(C.back.tilt, C.fwd.tilt);
  const fingers = fore.clone().applyAxisAngle(fore.clone().cross(inside).normalize(), flex);
  const position = fore.clone().multiplyScalar(l(C.back.along, C.fwd.along)).addScaledVector(inside, l(C.back.out, C.fwd.out));
  const axis = fore.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(inside, -Math.sin(tilt));
  const laces = inside.clone().addScaledVector(axis, -inside.dot(axis)).normalize().negate();
  return { upper, fore, inside, fingers, position, axis, laces };
}

describe('plan 08a donor arithmetic', () => {
  const swings = [-1.4, -1.1, -0.6, -0.2, 0, 0.3, 0.8, 1.1];
  it('reproduces the donor arm, ball and hand directions through the seat numbers', () => {
    for (const raw of swings) {
      const d = donor(raw);
      const r = carryRequest(CARRY_L3, raw);
      close(d.upper, r.upper);
      close(d.fore, r.fore);
      // the seat numbers live in the frame hingeChain builds for this arm
      const sh = v3(0, 0, 0);
      const elbow = addScaled(sh, r.upper, 0.36);
      const chain = hingeChain(sh, elbow, [addScaled(elbow, r.fore, 0.23)], [v3(0, 0, 1)], 0.05);
      const fa = { p: elbow, q: chain.frameB };
      close(d.position, toWorld({ p: v3(), q: fa.q }, seatBallLocal(r.seat)));
      const qb = chain.frameB;
      const ballQ = (l: Vec3): Vec3 => qRot(qb, qRot(seatBallQ(r.seat), l));
      close(d.axis, ballQ(v3(0, 1, 0)));
      close(d.laces, ballQ(v3(0, 0, 1)));
      close(d.axis.clone().cross(d.laces), ballQ(v3(1, 0, 0)));
      const wrist = seatPalmLocal({ ...r.seat, flexRad: 0 }, 0.23, 0);
      const palm = seatPalmLocal(r.seat, 0.23, 0.1);
      const fingers = toWorld({ p: v3(), q: qb }, { x: (palm.x - wrist.x) / 0.1, y: (palm.y - wrist.y) / 0.1, z: (palm.z - wrist.z) / 0.1 });
      close(d.fingers, fingers);
    }
  });

  it('reaches both keys at the swing range and keeps the elbow inside the hinge limit', () => {
    const lo = carryRequest(CARRY_L3, -1.1);
    const hi = carryRequest(CARRY_L3, 0.8);
    expect(lo.blend).toBe(0);
    expect(hi.blend).toBe(1);
    expect(carryRequest(CARRY_L3, 0).blend).toBeCloseTo(1.1 / 1.9, 9);
    for (const raw of swings) {
      const r = carryRequest(CARRY_L3, raw);
      const flex = (Math.acos(dot(r.upper, r.fore)) * 180) / Math.PI;
      expect(flex).toBeGreaterThan(30);
      expect(flex).toBeLessThan(140);
    }
  });

  it('mirrors for a body with anatomical left on -X without changing the seat numbers', () => {
    const m = (p: Vec3): Vec3 => v3(-p.x, p.y, p.z);
    for (const raw of swings) {
      const a = carryRequest(CARRY_L3, raw);
      const b = carryRequest(CARRY_L3, raw, undefined, m);
      expect(dist(b.upper, m(a.upper))).toBeLessThan(1e-12);
      expect(dist(b.fore, m(a.fore))).toBeLessThan(1e-12);
    }
  });

  it('reads the swing as the donor does: + right arm forward', () => {
    const fwd = v3(0, -0.8, 0.6);
    const back = v3(0, -0.8, -0.6);
    expect(carryArmSwing(fwd, back)).toBeGreaterThan(0);
    expect(carryArmSwing(back, fwd)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------- through the simulation
const FIX = (id: string): FixtureDef => allFixtures().find((d) => d.id === id)!;
/** The same fixture on the earlier hold: no carry profile, the ball on the palm. */
const held = (d: FixtureDef): FixtureDef => ({ ...d, carry: undefined, ...(d.rules ? { rules: { ...d.rules, ballSource: 'carryPalm' as const } } : {}) });
const carrier = (s: Simulation): PlayerRuntime => s.players.find((p) => p.setup.role === 'runner')!;

type Row = { t: number; pose: PhysicalPose; seat: CarrySeat; ball: Pose; rag: boolean; bodyBall: Vec3; bodyPalm: Vec3 };
/** Every substep of the carrier. */
async function follow(def: FixtureDef, opts: SimOptions = {}): Promise<{ sim: Simulation; rows: Row[] }> {
  const rows: Row[] = [];
  const sim = await Simulation.create(def, {
    ...opts,
    onSubstep: (s) => {
      const R = carrier(s);
      if (!R.pose?.carry) return;
      const ball = carriedBall(R.pose)!;
      const c = R.rag ? null : { p: vc(R.proxy.body.translation()), q: { ...R.proxy.body.rotation() } };
      rows.push({ t: s.t, pose: structuredClone(R.pose), seat: { ...R.pose.carry }, ball, rag: !!R.rag, bodyBall: c ? toLocal(c, ball.p) : ball.p, bodyPalm: c ? toLocal(c, R.pose.jointLandmarksWorld.rightPalm) : R.pose.jointLandmarksWorld.rightPalm });
    },
  });
  await runSim(sim);
  return { sim, rows };
}

const corr = (a: number[], b: number[]): number => {
  const m = (x: number[]): number => x.reduce((p, q) => p + q, 0) / x.length;
  const [ma, mb] = [m(a), m(b)];
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
};

/** The supplied model on the rig adapter (one clone for the file): world positions and rotations of its bones for a pose. */
let rigOnce: { apply: (pose: PhysicalPose) => (bone: string) => { p: Vec3; q: Quat } } | null = null;
function rig(): NonNullable<typeof rigOnce> {
  if (rigOnce) return rigOnce;
  const c = cloneRig(glbScene().scene);
  const adapter = new RigAdapter(c.bones, MODEL_CALIBRATION);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  rigOnce = {
    apply: (pose) => {
      adapter.apply(pose);
      c.root.updateMatrixWorld(true);
      return (bone) => {
        c.bones[bone].matrixWorld.decompose(p, q, sc);
        return { p: v3(p.x, p.y, p.z), q: { x: q.x, y: q.y, z: q.z, w: q.w } };
      };
    },
  };
  return rigOnce;
}
/** Angle between two rotations (rad). */
const qAngleBetween = (a: Quat, b: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));
/** The carry's chest-frame side convention for a body (carry.ts `M`). */
const mirrorOf = (body: BodyProfile) => (p: Vec3): Vec3 => v3(p.x * (sideSignX(body, 'left') > 0 ? 1 : -1), p.y, p.z);

describe('plan 08a donor fit through the simulation', () => {
  // a settled run on each supplied run clip: Fast Run (the stop's run-up) and Sprint
  for (const [id, from, to] of [['L3-F16-runStop', 1.6, 2.5], ['L3-F16-sprint', 1.6, 2.5]] as const) {
    it(`${id}: the arm reaches both keys, swings opposite the free arm, keeps its lengths; the ball stays along the forearm`, async () => {
      const def = FIX(id);
      const { sim, rows } = await follow(def);
      const R = carrier(sim);
      const L = def.ragdoll!.lengths;
      const win = rows.filter((r) => r.t >= from && r.t <= to);
      expect(win.length).toBeGreaterThan(100);
      const blend = win.map((r) => r.seat.tiltRad / CARRY_L3.fwd.tilt);
      expect(Math.min(...blend)).toBeLessThan(0.05);
      expect(Math.max(...blend)).toBeGreaterThan(0.95);
      const local = (r: Row, n: string): Vec3 => qInvRot(r.pose.segments.core.rotationWorld, r.pose.jointLandmarksWorld[n]);
      const pitch = (r: Row, s: string): number => {
        const u = norm(sub(local(r, `${s}Elbow`), local(r, `${s}Shoulder`)));
        return Math.atan2(u.z, -u.y);
      };
      const right = win.map((r) => pitch(r, 'right'));
      const left = win.map((r) => pitch(r, 'left'));
      expect((Math.max(...right) - Math.min(...right)) * (180 / Math.PI)).toBeGreaterThan(25);
      expect(corr(right, left)).toBeLessThan(-0.7);
      const ez = win.map((r) => sub(local(r, 'rightElbow'), local(r, 'rightShoulder')).z);
      expect(Math.max(...ez) - Math.min(...ez)).toBeGreaterThan(0.04);
      for (const r of win) {
        const lm = r.pose.jointLandmarksWorld;
        expect(Math.abs(dist(lm.rightShoulder, lm.rightElbow) - L.upperArm)).toBeLessThan(1e-6);
        expect(Math.abs(dist(lm.rightElbow, lm.rightWrist) - L.forearm)).toBeLessThan(1e-6);
        expect(Math.abs(dist(lm.rightWrist, lm.rightPalm) - L.palmExtension)).toBeLessThan(1e-6);
        // the ball axis along the forearm within the authored tilt
        const fore = norm(sub(lm.rightWrist, lm.rightElbow));
        const axis = qRot(r.ball.q, v3(0, 1, 0));
        expect(Math.acos(Math.min(1, dot(fore, axis)))).toBeLessThan(Math.abs(r.seat.tiltRad) + 0.02);
        // the forearm stays up off the hip: forward in the chest frame
        expect(norm(sub(local(r, 'rightWrist'), local(r, 'rightElbow'))).z).toBeGreaterThan(0.15);
      }
      expect(R.pose!.limbClearance.rightArm).toBeLessThanOrEqual(0.001);
      sim.dispose();
    }, 30000);
  }

  it('standing and walking: the settled static carry, between the keys', async () => {
    for (const [id, from, to] of [['L3-F13-carrier', 0.5, 3], ['L3-F14-carrier', 1.4, 2.5]] as const) {
      const { sim, rows } = await follow(FIX(id));
      const win = rows.filter((r) => r.t >= from && r.t <= to);
      const still = carryRequest(CARRY_L3, 0).seat;
      for (const r of win) expect(Math.abs(r.seat.tiltRad - still.tiltRad), id).toBeLessThan(1e-9);
      const z = win.map((r) => r.bodyBall.z);
      expect(Math.max(...z) - Math.min(...z), id).toBeLessThan(0.03);
      sim.dispose();
    }
  }, 30000);
});

describe('plan 08a composition and continuity', () => {
  it('the walk-run transition and the stop move the seat continuously with the shown weight', async () => {
    const { sim, rows } = await follow(FIX('L3-F14-walkRunStopCarrier'));
    let peak = 0;
    for (let i = 1; i < rows.length; i++) peak = Math.max(peak, dist(rows[i].bodyBall, rows[i - 1].bodyBall));
    // the arm swings between its keys (about 4 m/s at the ball), no step in between
    expect(peak).toBeLessThan(0.03);
    const tilt = rows.map((r) => r.seat.tiltRad);
    expect(Math.min(...tilt)).toBeLessThan(0.9 * CARRY_L3.fwd.tilt);
    sim.dispose();
  }, 30000);

  it('contact and recontact: ownership changes under the 1 cm same-time limit, the ball included, on the achieved arm', async () => {
    let boundaries = 0;
    let ball = 0;
    let moved = 0;
    for (const id of ['L3-F7-phase0', 'L3-F8-recontact', 'L3-F16-contactStop', 'L3-F14-carrier', 'L3-F14-walkRunStopCarrier', 'L3-F16-kick']) {
      const { sim, rows } = await follow(FIX(id), { transitionAudit: true });
      const R = carrier(sim);
      const own = sim.transitionDeltas.filter((x) => x.playerId === R.id);
      for (const x of own) {
        if (x.by.carriedBall === undefined) continue;
        boundaries++;
        ball = Math.max(ball, x.by.carriedBall);
      }
      // the ball stays seated on the achieved forearm at every substep, clearance corrections included
      for (const r of rows) {
        const lm = r.pose.jointLandmarksWorld;
        moved = Math.max(moved, dist(lm.carriedBall, r.ball.p), Math.abs(dist(lm.carriedBall, lm.rightElbow) - Math.hypot(r.seat.alongM, r.seat.outM)));
      }
      sim.dispose();
    }
    expect(boundaries).toBeGreaterThan(30);
    expect(ball).toBeLessThanOrEqual(0.01);
    expect(moved).toBeLessThan(1e-6);
  }, 60000);

  it('a blocked arm carries the ball where the arm went, not at the request (plan 10d D1 b)', async () => {
    const def = FIX('L3-F7-phase0');
    const { sim, rows } = await follow(def);
    const R = carrier(sim);
    const L = def.ragdoll!.lengths;
    const C = CARRY_L3;
    const [b0, b1] = C.swingRange;
    let n = 0;
    let worstFit = 0;
    for (const r of rows) {
      const res = r.pose.targetResidualM?.rightArm ?? 0;
      // the blend (tilt is 0 at the back key) gives the swing back while it is inside the swing range
      const blend = r.seat.tiltRad / C.fwd.tilt;
      if (r.rag || res <= 0.05 || blend <= 1e-6 || blend >= 1 - 1e-6) continue;
      n++;
      // the request, rebuilt from the carry's chest-frame arm, the published shoulder and the body's segment lengths
      const req = carryRequest(C, b0 + blend * (b1 - b0), L.forearm, mirrorOf(R.body));
      const cq = r.pose.segments.core.rotationWorld;
      const lm = r.pose.jointLandmarksWorld;
      const elbowR = addScaled(lm.rightShoulder, qRot(cq, req.upper), L.upperArm);
      const foreR = qRot(cq, req.fore);
      const palmR = addScaled(elbowR, foreR, L.forearm + L.palmExtension);
      const asked = addScaled(addScaled(elbowR, foreR, r.seat.alongM), qRot(cq, req.inside), r.seat.outM);
      // it is the request the residual is measured from: the achieved (straight) chain end is that far from its palm
      const u = norm(sub(lm.rightWrist, lm.rightElbow));
      const reach = addScaled(lm.rightWrist, u, L.palmExtension);
      expect(Math.abs(dist(reach, palmR) - res), `t=${r.t}`).toBeLessThan(1e-6);
      // the drawn ball moved with the arm: about the residual (scaled to where the ball sits on the arm) away from it
      const off = dist(r.ball.p, asked);
      expect(off, `t=${r.t}`).toBeGreaterThan(0.3 * res);
      expect(off, `t=${r.t}`).toBeLessThan(1.3 * res);
      // and it sits on the achieved forearm, measured on the landmarks: along it from the elbow, out of it toward the
      // request's chest-frame seat side (plan 10d D4)
      const rel = sub(r.ball.p, lm.rightElbow);
      const along = dot(rel, u);
      const out = sub(rel, addScaled(v3(), u, along));
      const side = norm(addScaled(qRot(cq, req.inside), u, -dot(qRot(cq, req.inside), u)));
      worstFit = Math.max(worstFit, Math.abs(along - r.seat.alongM), Math.abs(len(out) - r.seat.outM), dist(norm(out), side) * r.seat.outM);
    }
    expect(n).toBeGreaterThan(5);
    expect(worstFit).toBeLessThan(1e-6);
    sim.dispose();
  }, 30000);

  it('ready hands: the left arm takes the ready assignment, the ball arm keeps the carry', async () => {
    const { sim, rows } = await follow(FIX('L3-F14-ready'));
    const free = await follow(FIX('L3-F14-carrier'));
    expect(rows.length).toBeGreaterThan(500);
    const at = (x: Row[], t: number): Row => x.find((r) => r.t >= t)!;
    const a = at(rows, 2);
    const b = at(free.rows, 2);
    expect(dist(a.bodyBall, b.bodyBall)).toBeLessThan(1e-6);
    expect(dist(a.pose.jointLandmarksWorld.leftPalm, b.pose.jointLandmarksWorld.leftPalm)).toBeGreaterThan(0.1);
    sim.dispose();
    free.sim.dispose();
  }, 30000);

  it('an achieved right arm keeps its solve and its own hand; the ball stays seated on it (plan 10d D3)', async () => {
    const def = FIX('L3-F13-carrier');
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const inp = { playerId: R.id, body: R.body, ragdoll: def.ragdoll!, pose: { p: v3(0, 1, 0), q: qIdentity() }, gait: R.gait, speed: 0, carriesBall: true, carry: CARRY_L3 };
    const sh = toWorld(inp.pose, shoulderLocal(R.body, 'right'));
    const elbow = addScaled(sh, norm(v3(-0.1, -0.8, 0.3)), def.ragdoll!.lengths.upperArm);
    const wrist = addScaled(elbow, norm(v3(0.1, 0.2, 1)), def.ragdoll!.lengths.forearm);
    const palm = addScaled(wrist, norm(sub(wrist, elbow)), def.ragdoll!.lengths.palmExtension);
    const pose = buildProxyPose({ ...inp, arms: { right: { shoulder: sh, elbow, wrist, palm } } });
    expect(dist(pose.jointLandmarksWorld.rightPalm, palm)).toBeLessThan(1e-6);
    // the hand is the arm task's: no share of the carry roll or flex, and the model draws it as without a carry
    expect(pose.carry!.handW).toBe(0);
    expect(pose.carry!.flexRad).toBeCloseTo(CARRY_L3.fwd.wristFlex * (1.1 / 1.9) + CARRY_L3.back.wristFlex * (0.8 / 1.9), 12);
    const withSeat = rig().apply(pose);
    const a = { ForeArm: withSeat('RightForeArm'), Hand: withSeat('RightHand') };
    const bare = rig().apply({ ...pose, carry: undefined });
    for (const [k, b] of [['ForeArm', bare('RightForeArm')], ['Hand', bare('RightHand')]] as const) {
      expect(qAngleBetween(a[k].q, b.q), k).toBeLessThan(1e-6);
      expect(dist(a[k].p, b.p), k).toBeLessThan(1e-6);
    }
    expect(dist(pose.jointLandmarksWorld.carriedBall, carriedBall(pose)!.p)).toBeLessThan(1e-9);
    sim.dispose();
  });

  it('an owner change moves the hand continuously, on the published landmarks and on the rig (plan 10d D3)', async () => {
    const def = FIX('L3-F13-carrier');
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const dtS = def.solver.outerTickS / def.solver.substeps;
    const memory: Record<string, number> = {};
    const inp: ProxyPoseInput = { playerId: R.id, body: R.body, ragdoll: def.ragdoll!, pose: { p: v3(0, 1, 0), q: qIdentity() }, gait: R.gait, speed: 0, carriesBall: true, carry: CARRY_L3, memory, dtS };
    const L = def.ragdoll!.lengths;
    let pose = buildProxyPose(inp);
    // the arm task takes the carry's own achieved chain, so only the hand's owner changes
    const lm = pose.jointLandmarksWorld;
    const given = { shoulder: lm.rightShoulder, elbow: lm.rightElbow, wrist: lm.rightWrist, palm: addScaled(lm.rightWrist, norm(sub(lm.rightWrist, lm.rightElbow)), L.palmExtension) };
    const steps = Math.round(0.4 / dtS);
    const seq = [...Array(steps).fill(true), ...Array(steps).fill(false), ...Array(steps).fill(true)];
    let palmStep = 0;
    let handStep = 0;
    let foreStep = 0;
    let prev = { palm: pose.jointLandmarksWorld.rightPalm, bones: (() => { const b = rig().apply(pose); return { f: b('RightForeArm').q, h: b('RightHand').q }; })() };
    const shares: number[] = [];
    for (const g of seq) {
      pose = buildProxyPose({ ...inp, ...(g ? { arms: { right: given } } : {}) });
      const b = rig().apply(pose);
      const cur = { palm: pose.jointLandmarksWorld.rightPalm, bones: { f: b('RightForeArm').q, h: b('RightHand').q } };
      palmStep = Math.max(palmStep, dist(cur.palm, prev.palm));
      foreStep = Math.max(foreStep, qAngleBetween(cur.bones.f, prev.bones.f));
      handStep = Math.max(handStep, qAngleBetween(cur.bones.h, prev.bones.h));
      shares.push(pose.carry!.handW);
      prev = cur;
    }
    // the hand passes over the declared interval (0.15 s) at each of the three changes, and arrives
    expect(shares[steps - 1]).toBe(0);
    expect(shares[2 * steps - 1]).toBe(1);
    expect(shares[3 * steps - 1]).toBe(0);
    // per substep: the published palm inside the transition audit's 1 cm same-time limit (an instant change moves it about
    // 12 cm), the model's forearm and hand turn a few degrees
    expect(palmStep).toBeLessThan(0.01);
    expect(foreStep).toBeLessThan((3 * Math.PI) / 180);
    expect(handStep).toBeLessThan((3 * Math.PI) / 180);
    expect(shares.filter((w) => w > 0 && w < 1).length).toBe(3 * (Math.round(CARRY_L3.handBlendS / dtS) - 1));
    sim.dispose();
  });
});

describe('plan 10d D4: the seat on whatever arm is achieved', () => {
  const def = FIX('L3-F13-carrier');
  const L = def.ragdoll!.lengths;
  const core: Pose = { p: v3(0, 1, 0), q: qIdentity() };
  const base = (R: PlayerRuntime): ProxyPoseInput => ({ playerId: R.id, body: R.body, ragdoll: def.ragdoll!, pose: core, gait: R.gait, speed: 0, carriesBall: true, carry: CARRY_L3 });
  /** The static carry's chest-frame seat side, world. */
  const chestInside = (R: PlayerRuntime): Vec3 => qRot(core.q, carryRequest(CARRY_L3, 0, L.forearm, mirrorOf(R.body)).inside);
  /** Where the ball sits about a pose's achieved forearm, measured on its landmarks, and the chest side there. */
  const sides = (R: PlayerRuntime, pose: PhysicalPose): { ball: Vec3; chest: Vec3 } => {
    const lm = pose.jointLandmarksWorld;
    const f = norm(sub(lm.rightWrist, lm.rightElbow));
    const rel = sub(carriedBall(pose)!.p, lm.rightElbow);
    const i = chestInside(R);
    return { ball: norm(addScaled(rel, f, -dot(rel, f))), chest: norm(addScaled(i, f, -dot(i, f))) };
  };
  /** Depth (m, > 0 inside) of a point in the body's own torso or pelvis box. */
  const inTorso = (body: BodyProfile, p: Vec3): number => {
    const l = toLocal(core, p);
    const box = (b: { center: Vec3; halfExtents: Vec3 }): number => Math.min(b.halfExtents.x - Math.abs(l.x - b.center.x), b.halfExtents.y - Math.abs(l.y - b.center.y), b.halfExtents.z - Math.abs(l.z - b.center.z));
    return Math.max(0, box(body.compound.torso), box(body.compound.pelvis));
  };

  it('near-straight arms: the ball keeps the chest side through the hinge fallback and through straight', async () => {
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const sh = toWorld(core, shoulderLocal(R.body, 'right'));
    let fallback = 0;
    let worstSide = 0;
    let step = 0;
    let n = 0;
    for (const [up, plane] of [[v3(0, -1, 0.2), v3(1, 0, 0)], [v3(-0.3, -0.7, 0.6), v3(0.2, 1, 0.1)], [v3(-1, -0.2, 0.3), v3(0, 0.3, 1)]] as const) {
      const u = norm(up);
      const axis = norm(cross(u, plane));
      const elbow = addScaled(sh, u, L.upperArm);
      let last: Vec3 | null = null;
      // bend from +2 degrees through straight to -2 degrees (the hinge axis flips; inside 0.5 degrees it is the fallback's)
      for (let d = 2; d >= -2 - 1e-9; d -= 0.02) {
        const f = qRot(qFromAxisAngle(axis, (d * Math.PI) / 180), u);
        const wrist = addScaled(elbow, f, L.forearm);
        const pose = buildProxyPose({ ...base(R), arms: { right: { shoulder: sh, elbow, wrist, palm: addScaled(wrist, f, L.palmExtension) } } });
        if (pose.straightFallback.includes('rightElbow')) fallback++;
        const sd = sides(R, pose);
        worstSide = Math.max(worstSide, dist(sd.ball, sd.chest));
        const b = carriedBall(pose)!.p;
        if (last) step = Math.max(step, dist(b, last));
        last = b;
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(fallback).toBeGreaterThan(100);
    expect(worstSide).toBeLessThan(1e-6);
    // the forearm itself moves 0.02 degrees a step (and up to the 0.5 degree fallback band once): no seat flip
    expect(step).toBeLessThan(0.005);
    sim.dispose();
  });

  it('every arm alternative carries the ball on the chest side', async () => {
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const sh = toWorld(core, shoulderLocal(R.body, 'right'));
    const sx = sideSignX(R.body, 'right');
    // the procedural alternatives' palm targets and poles (pose.ts ARM_ALTS)
    const alts = [[0.13, 0.3, 0.3, 0.7, -0.5, -0.3], [0.18, 0.55, 0.42, 0.6, -0.7, 0], [0.3, -0.12, -0.12, 0.5, 0, 0.8], [0.2, -0.02, 0.36, 0.7, -0.3, -0.5], [0.32, 0.95, 0.12, 0.8, 0.2, -0.4], [0.12, 0.1, -0.3, 0.6, 0, 0.6], [0.24, -0.2, 0.06, 0.3, 0, -1], [0.24, -0.2, -0.08, 0.3, 0, -1]];
    for (const [px, py, pz, qx, qy, qz] of alts) {
      const tgt = toWorld(core, proceduralLocal(R.body, 'right', v3(px * sx, py, pz)));
      const pole = norm(v3(qx * sx, qy, qz));
      // the elbow off the shoulder-palm line toward the pole (law of cosines)
      const d = Math.min(dist(sh, tgt), L.upperArm + L.forearm + L.palmExtension - 1e-3);
      const ax = norm(sub(tgt, sh));
      const c = (L.upperArm ** 2 + d * d - (L.forearm + L.palmExtension) ** 2) / (2 * L.upperArm * d);
      const perp = norm(addScaled(pole, ax, -dot(pole, ax)));
      const elbow = add(sh, add(addScaled(v3(), ax, L.upperArm * c), addScaled(v3(), perp, L.upperArm * Math.sqrt(Math.max(0, 1 - c * c)))));
      const f = norm(sub(addScaled(sh, ax, d), elbow));
      const wrist = addScaled(elbow, f, L.forearm);
      const pose = buildProxyPose({ ...base(R), arms: { right: { shoulder: sh, elbow, wrist, palm: addScaled(wrist, f, L.palmExtension) } } });
      const sd = sides(R, pose);
      expect(dist(sd.ball, sd.chest), `alt ${px},${py},${pz}`).toBeLessThan(1e-6);
    }
    sim.dispose();
  });

  it('a blocked carry arm takes the alternative that keeps the ball out of its own torso', async () => {
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const mid = (sh: PoseShape): Vec3 => (sh.kind === 'capsule' ? toLocal(core, lerp(sh.a, sh.b, 0.5)) : v3());
    // an obstacle over the front and the top of the arm's reach: the carry, the raised alternatives and the side ones
    const clearance: PoseClearance = {
      external: (shapes) => (shapes.some((x) => x.key === 'rightForearm' && (mid(x).z > -0.03 || mid(x).y > 0.5)) ? 0.05 : 0),
      self: (shapes) => Math.max(0, ...shapes.map((x) => (x.key === 'carriedBall' && x.kind === 'ball' ? inTorso(R.body, x.c) : 0))),
    };
    const pose = buildProxyPose({ ...base(R), clearance });
    // an alternative behind the body, valid, with the ball's centre out of the torso
    const free = buildProxyPose(base(R));
    expect(dist(pose.jointLandmarksWorld.rightWrist, free.jointLandmarksWorld.rightWrist)).toBeGreaterThan(0.1);
    expect(mid({ kind: 'capsule', a: pose.jointLandmarksWorld.rightElbow, b: pose.jointLandmarksWorld.rightWrist, r: 0, key: '' }).z).toBeLessThan(-0.03);
    expect(pose.limbClearance.rightArm).toBeLessThanOrEqual(0.004);
    expect(pose.limbClearance.carriedBallTorso).toBe(0);
    expect(inTorso(R.body, carriedBall(pose)!.p)).toBe(0);
    // the choice was real: an earlier valid alternative had the ball's centre in the torso
    const first = buildProxyPose({ ...base(R), clearance: { external: clearance.external } });
    expect(inTorso(R.body, carriedBall(first)!.p)).toBeGreaterThan(0.01);
    sim.dispose();
  });

  it('a ball that cannot fit is reported, not hidden in the residual', async () => {
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const pose = buildProxyPose({ ...base(R), clearance: { external: (shapes) => (shapes.some((x) => x.key === 'carriedBall') ? 0.03 : 0) } });
    expect(pose.limbClearance.carriedBall).toBeCloseTo(0.03, 9);
    expect(pose.limbClearance.rightArm).toBeCloseTo(0.03, 9);
    sim.dispose();
  });
});

describe('plan 08a authority and rules', () => {
  it('no drive, support or left-arm request changes before a pose-dependent conversion or rule ending', async () => {
    for (const id of ['L3-F16-runStop', 'L3-F16-sprint', 'L3-F14-walkRunStopCarrier', 'L3-F13-carrier', 'L3-F8-recontact', 'L3-F7-phase0']) {
      const def = FIX(id);
      const a = await Simulation.create(def);
      const b = await Simulation.create(held(def));
      const left = ['leftShoulder', 'leftElbow', 'leftWrist', 'leftPalm', 'leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle'];
      let n = 0;
      let leftD = 0;
      let bodyD = 0;
      while (!a.done && !b.done && !a.ending && !b.ending && !a.players.some((p) => p.rag) && !b.players.some((p) => p.rag)) {
        a.stepTick();
        await pace();
        b.stepTick();
        await pace();
        n++;
        for (let i = 0; i < a.players.length; i++) {
          const [p, q] = [a.players[i], b.players[i]];
          if (p.rag || q.rag) continue;
          bodyD = Math.max(bodyD, dist(vc(p.proxy.body.translation()), vc(q.proxy.body.translation())), dist(vc(p.proxy.body.linvel()), vc(q.proxy.body.linvel())));
          // (the carrier's own requests; an opponent's free limbs clear the carrier's published arm, as they always have)
          if (p.setup.role === 'runner' && p.pose && q.pose) for (const k of left) leftD = Math.max(leftD, dist(p.pose.jointLandmarksWorld[k], q.pose.jointLandmarksWorld[k]));
        }
      }
      expect(n, id).toBeGreaterThan(20);
      expect(bodyD, id).toBe(0);
      expect(leftD, id).toBe(0);
      a.dispose();
      b.dispose();
    }
  }, 120000);

  it('the rule reference, the drawn ball and the official spot agree; the spot stays frozen', async () => {
    const withEnding = allFixtures().filter((d) => d.milestone === 'L3' && d.rules);
    expect(withEnding.length).toBeGreaterThan(10);
    let endings = 0;
    for (const def of withEnding.slice(0, 12)) {
      expect(def.rules!.ballSource, def.id).toBe('carryPose');
      const sim = await Simulation.create(def);
      let spot: string | null = null;
      while (!sim.done) {
        sim.stepTick();
        await pace();
        const R = sim.players.find((p) => p.id === sim.rules!.runnerId)!;
        const drawn = carriedBall(R.pose);
        if (!drawn) continue;
        const ref = sim.rules!.ballRef(sim.poseOf(R), R.pose);
        expect(dist(ref, drawn.p), def.id).toBeLessThan(1e-6);
        if (sim.ending && !spot) {
          spot = JSON.stringify(sim.ending.ballSpot);
        }
        if (spot) expect(JSON.stringify(sim.ending!.ballSpot)).toBe(spot);
      }
      if (spot) endings++;
      sim.dispose();
    }
    expect(endings).toBeGreaterThan(0);
  }, 120000);

  it('reading the carry at any rate changes nothing; a render blend stays seated on the blended forearm', async () => {
    const def = FIX('L3-F16-runStop');
    const a = await follow(def);
    const b = await Simulation.create(def);
    await runSim(b);
    const [p, q] = [carrier(a.sim), carrier(b)];
    expect(vc(p.proxy.body.translation())).toEqual(vc(q.proxy.body.translation()));
    // plan 10d D1(c): the lab's own blend between two drawn ticks (one tick apart), where the forearm turns fastest
    const fa = (r: Row): Pose => ({ p: r.pose.segments.rightForearm.originWorld, q: r.pose.segments.rightForearm.rotationWorld });
    const tick = def.solver.substeps;
    let i0 = 0;
    for (let i = 0; i + tick < a.rows.length; i++) if (!a.rows[i].rag && !a.rows[i + tick].rag && qAngleBetween(fa(a.rows[i]).q, fa(a.rows[i + tick]).q) > qAngleBetween(fa(a.rows[i0]).q, fa(a.rows[i0 + tick]).q)) i0 = i;
    const [r0, r1] = [a.rows[i0], a.rows[i0 + tick]];
    const k0 = capturePose(null, r0.pose)!;
    const draw = rig();
    const hand = (pose: PhysicalPose): Vec3 => draw.apply(pose)('RightHand').p;
    const at = (pose: PhysicalPose) => {
      const f = { p: pose.segments.rightForearm.originWorld, q: pose.segments.rightForearm.rotationWorld };
      const lm = pose.jointLandmarksWorld;
      return { wrist: toLocal(f, lm.rightWrist), palm: toLocal(f, lm.rightPalm), ball: toLocal(f, carriedBall(pose)!.p), hand: toLocal(f, hand(pose)) };
    };
    const [e0, e1] = [at(r0.pose), at(r1.pose)];
    for (const t of [0.25, 0.5, 0.75]) {
      const P = lerpPose(k0, r1.pose, t);
      const m = at(P);
      // the drawn joints ride the blended forearm (as the model does): the wrist and the model's hand stay rigid on it
      expect(dist(m.wrist, e1.wrist), `t=${t}`).toBeLessThan(1e-9);
      expect(dist(m.hand, e1.hand), `t=${t}`).toBeLessThan(1e-6);
      // the drawn palm and ball keep their blended places on it (the seat blends; the palm blends where it sits)
      expect(dist(m.palm, lerp(e0.palm, e1.palm, t)), `t=${t}`).toBeLessThan(1e-9);
      expect(dist(m.ball, lerp(e0.ball, e1.ball, t)), `t=${t}`).toBeLessThan(1e-3);
      expect(dist(m.palm, m.ball) - Math.min(dist(e0.palm, e0.ball), dist(e1.palm, e1.ball)), `t=${t}`).toBeGreaterThan(-1e-3);
      expect(dist(m.palm, m.ball) - Math.max(dist(e0.palm, e0.ball), dist(e1.palm, e1.ball)), `t=${t}`).toBeLessThan(1e-3);
      // the case is live: a straight-line blend of the world wrist would leave the blended forearm
      const w = lerp(r0.pose.jointLandmarksWorld.rightWrist, r1.pose.jointLandmarksWorld.rightWrist, t);
      if (t === 0.5) expect(dist(w, P.jointLandmarksWorld.rightWrist)).toBeGreaterThan(1e-4);
    }
    // at the end of the blend: the solved pose itself
    expect(lerpPose(k0, r1.pose, 1)).toBe(r1.pose);
    a.sim.dispose();
    b.dispose();
  }, 30000);

  it('historical fixtures publish no carry data and keep their ball source; L4 inherits the carry on purpose', async () => {
    // plan 10d D1(e): every fixture of the historical milestones (gates 1-4, L1, L2, ride height, handoff contact)
    const hist = allFixtures().filter((d) => !/^L[34]$/.test(d.milestone));
    expect(new Set(hist.map((d) => d.milestone.replace(/-.*$/, '').replace(/\d+$/, '')))).toEqual(new Set(['G', 'L', 'RH', 'HC']));
    expect(hist.length).toBeGreaterThan(200);
    for (const def of hist) {
      expect(def.carry, def.id).toBeUndefined();
      expect(def.rules?.ballSource, def.id).not.toBe('carryPose');
    }
    // L4 falls built from an L3 fixture keep its carry (the ball stays on the runner's arm through the fall); the rest
    // (zero-gravity limits, tipped falls) have no ball carrier
    const l4 = allFixtures().filter((d) => d.milestone === 'L4');
    const carried = l4.filter((d) => d.carry);
    expect(carried.length).toBeGreaterThanOrEqual(20);
    for (const def of carried) {
      expect(def.carry, def.id).toBe(CARRY_L3);
      expect(def.notes, def.id).toContain(`carry: ${CARRY_L3.id}`);
      expect(def.rules?.ballSource ?? 'carryPose', def.id).toBe('carryPose');
    }
    for (const def of l4.filter((d) => !d.carry)) expect(def.notes ?? '', def.id).not.toContain('carry: ');
    const def = allFixtures().find((d) => d.id === 'L2-F3-runStop')!;
    const { sim, rows } = await follow(def);
    expect(rows.length).toBe(0);
    expect(carrier(sim).pose!.jointLandmarksWorld.carriedBall).toBeUndefined();
    sim.dispose();
  }, 30000);
});

describe('plan 08a handoff and lifecycle', () => {
  async function convert(def: FixtureDef): Promise<void> {
    const { sim, rows } = await follow(def, { transitionAudit: true });
    const R = carrier(sim);
    expect(R.handoff?.outcome, def.id).toBe('accepted');
    expect(R.handoff?.report.ok, def.id).toBe(true);
    expect(R.handoff?.audit?.ok, def.id).toBe(true);
    const i = rows.findIndex((r) => r.rag);
    expect(i, def.id).toBeGreaterThan(0);
    const [a, b] = [rows[i - 1], rows[i]];
    // the seat is the last supported one, the hand and ball continue across the switch
    expect(b.seat, def.id).toEqual(a.seat);
    expect(dist(a.ball.p, b.ball.p), def.id).toBeLessThan(0.06);
    expect(dist(a.pose.jointLandmarksWorld.rightPalm, b.pose.jointLandmarksWorld.rightPalm), def.id).toBeLessThan(0.06);
    // no fresh carry motion after falling, the ball stays where the forearm takes it
    for (const r of rows.slice(i)) {
      expect(r.seat, def.id).toEqual(b.seat);
      expect(dist(r.pose.jointLandmarksWorld.carriedBall, r.ball.p), def.id).toBeLessThan(1e-6);
    }
    expect(R.rag!.landmarks.rightPalm.local).toEqual(seatPalmLocal(b.seat, def.ragdoll!.lengths.forearm, def.ragdoll!.lengths.palmExtension));
    sim.dispose();
  }

  it('contact conversions keep hand, palm and ball through the candidate, transfer and first solve', async () => {
    for (const id of ['L3-F9-convert-contact', 'L3-F9-convert-exit', 'L3-F1-mirror0', 'L3-F4-gripTarget']) await convert(FIX(id));
  }, 120000);

  it('labelled conversions during idle and at both run extremes', async () => {
    const at = (d: FixtureDef, t: number, tag: string): FixtureDef => ({ ...d, id: `${d.id}-${tag}`, diagnostics: { conversions: [{ playerId: 'R', atS: t }] } });
    await convert(at(FIX('L3-F13-carrier'), 2, 'idle'));
    const run = FIX('L3-F16-sprint');
    const { sim, rows } = await follow(run);
    sim.dispose();
    const win = rows.filter((r) => r.t > 1.8 && r.t < 2.3);
    const back = win.reduce((a, b) => (b.seat.tiltRad > a.seat.tiltRad ? b : a));
    const fwd = win.reduce((a, b) => (b.seat.tiltRad < a.seat.tiltRad ? b : a));
    expect(back.seat.tiltRad).toBeGreaterThan(0.9 * CARRY_L3.back.tilt - 0.02);
    expect(fwd.seat.tiltRad).toBeLessThan(0.9 * CARRY_L3.fwd.tilt);
    await convert(at(run, back.t, 'back'));
    await convert(at(run, fwd.t, 'fwd'));
  }, 120000);

  it('reset reproduces a fresh run (plan 10d D1 d)', async () => {
    const def = FIX('L3-F16-runStop');
    const { sim, rows } = await follow(def);
    const n = rows.length;
    expect(n).toBeGreaterThan(500);
    sim.reset();
    await runSim(sim);
    expect(rows.length).toBe(2 * n);
    for (let i = 0; i < n; i++) {
      const [a, b] = [rows[i], rows[n + i]];
      expect(b.t, `row ${i}`).toBe(a.t);
      expect(b.seat, `row ${i}`).toEqual(a.seat);
      expect(b.ball, `row ${i}`).toEqual(a.ball);
    }
    sim.dispose();
  }, 30000);
});
