// Plan 08a: the sim-6 carry ported into the L3 pose path. Donor fit, composition, authority, handoff and lifecycle.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CARRY_L3, carryArmSwing, carryRequest, lerpSeat, seatBallLocal, seatBallQ, seatBallWorld, seatPalmLocal, type CarrySeat } from '../src/sim/carry';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { buildProxyPose, carriedBall, hingeChain, type PhysicalPose } from '../src/sim/pose';
import { Simulation, type PlayerRuntime, type SimOptions } from '../src/sim/simulation';
import { addScaled, dist, dot, norm, qIdentity, qInvRot, qRot, sub, toLocal, toWorld, v3, vc, type Pose, type Vec3 } from '../src/sim/vec';

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
  sim.runToEnd();
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

  it('a blocked arm carries the ball where the arm went, not at the request', async () => {
    const { sim, rows } = await follow(FIX('L3-F7-phase0'));
    const moved = rows.filter((r) => (r.pose.targetResidualM?.rightArm ?? 0) > 0.05);
    expect(moved.length).toBeGreaterThan(5);
    for (const r of moved) expect(dist(r.pose.jointLandmarksWorld.carriedBall, r.ball.p)).toBeLessThan(1e-6);
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

  it('an achieved right arm keeps its solve: straight hand, the ball stays seated on it', async () => {
    const def = FIX('L3-F13-carrier');
    const sim = await Simulation.create(def);
    const R = carrier(sim);
    const inp = { playerId: R.id, body: R.body, ragdoll: def.ragdoll!, pose: { p: v3(0, 1, 0), q: qIdentity() }, gait: R.gait, speed: 0, carriesBall: true, carry: CARRY_L3 };
    const sh = v3(-0.2, 1.3, 0);
    const elbow = v3(-0.3, 1.1, 0.2);
    const wrist = addScaled(elbow, norm(v3(0.1, 0.2, 1)), def.ragdoll!.lengths.forearm);
    const palm = addScaled(wrist, norm(sub(wrist, elbow)), def.ragdoll!.lengths.palmExtension);
    const pose = buildProxyPose({ ...inp, arms: { right: { shoulder: sh, elbow, wrist, palm } } });
    expect(dist(pose.jointLandmarksWorld.rightPalm, palm)).toBeLessThan(1e-6);
    expect(pose.carry!.flexRad).toBe(0);
    expect(dist(pose.jointLandmarksWorld.carriedBall, carriedBall(pose)!.p)).toBeLessThan(1e-9);
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
        b.stepTick();
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
    b.runToEnd();
    const [p, q] = [carrier(a.sim), carrier(b)];
    expect(vc(p.proxy.body.translation())).toEqual(vc(q.proxy.body.translation()));
    const [r0, r1] = [a.rows[300], a.rows[301]];
    const f0 = r0.pose.segments.rightForearm;
    const f1 = r1.pose.segments.rightForearm;
    const mid = { p: addScaled(f0.originWorld, sub(f1.originWorld, f0.originWorld), 0.5), q: f1.rotationWorld };
    const seat = lerpSeat(r0.seat, r1.seat, 0.5);
    const ball = seatBallWorld(mid, seat);
    expect(dist(ball.p, mid.p)).toBeCloseTo(Math.hypot(seat.alongM, seat.outM), 9);
    a.sim.dispose();
    b.dispose();
  }, 30000);

  it('historical fixtures publish no carry data and keep their ball source', async () => {
    for (const def of allFixtures().filter((d) => d.milestone !== 'L3').slice(0, 40)) {
      expect(def.carry).toBeUndefined();
      expect(def.rules?.ballSource).not.toBe('carryPose');
    }
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

  it('reset reproduces a fresh run', async () => {
    const def = FIX('L3-F16-runStop');
    const a = await follow(def);
    const b = await follow(def);
    expect(b.rows.length).toBe(a.rows.length);
    for (let i = 0; i < a.rows.length; i += 37) expect(b.rows[i].seat).toEqual(a.rows[i].seat);
    a.sim.dispose();
    b.sim.dispose();
  }, 30000);
});
