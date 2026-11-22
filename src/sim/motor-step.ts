// Plan 10f (F9): the motor step, moved out of simulation.ts: per substep, from one snapshot, each proxy player's
// bounded drive and yaw, the rate-limited posture target and (balanced profile) the finite upright support torque, all
// scaled by the suspension's traction authority. A ragdoll gets no motors.
import type { Snapshot } from './contracts';
import { computeDrive, computeYaw } from './motors';
import { availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, leanScale, postureGravityHold } from './balance';
import { add, v3, vc, len, cross, norm, qFromAxisAngle, qRot, upOf, dot, clamp, forwardOf, scale, sub, UP, levelForwardOf, qFromUnitVectors } from './vec';
import type { Simulation, AppliedRecord } from './simulation';
import { bracePosture } from './brace';
import { handsLeverage, openedBy } from './controllers/block';
import { shoulderLocal } from './profiles';
import { hingeBalanceTorque, hipTorque } from './hinge';
import { advanceContest, advanceGive, baseCeiling, baseMoments, contestCapacity, contestFeet, contestForce, copBounds, hitPair, limitToBase, nextBeaten, SOLE_TOUCH_M, soleContacts, type BaseMoments } from './block-base';

/** What the motor step reads from the simulation. */
export type MotorHost = Pick<
  Simulation,
  | 'arms'
  | 'balanceProfile'
  | 'balanced'
  | 'coreBody'
  | 'def'
  | 'opts'
  | 'physics'
  | 'players'
  | 'suspension'
  | 't'
>;

export const EMPTY_APPLIED = (): AppliedRecord => ({
  requestedVelocity: v3(),
  drive: v3(),
  driveCap: 0,
  driveSaturated: false,
  yawTorque: 0,
  yawCap: 0,
  yawError: 0,
  balanceRequested: v3(),
  balanceCapped: v3(),
  balanceCap: 0,
  balanceSaturated: false,
  supportTorque: v3(),
  supportScale: 1,
  leanScale: 1,
});

/** Step 5: bounded motors for every proxy player (ragdolls get none): drive, yaw and the finite upright support torque. */
export function applyMotors(host: MotorHost, snap: Snapshot): void {
  const B = host.balanceProfile;
  let hits = false;
  for (const pl of host.players) {
    if (pl.rag) {
      pl.applied = EMPTY_APPLIED(); // passive ragdoll: no locomotion, yaw, balance or pose-following motors
      continue;
    }
    const b = snap.bodies[pl.id];
    const supported = pl.controlMode === 'supported' && pl.grounded;
    const bal = pl.balance;
    let ls = 1;
    if (host.balanced) {
      ls = leanScale(bal.theta, B);
      // posture request: desired up, rate-limited toward the requested lean (<= max posture lean); contact motion M2: the
      // carrier's brace leans him toward his travel by its weight
      const braced = host.def.brace && pl.brace && pl.brace.w > 0 ? host.def.brace.pose : null;
      const pr = braced ? bracePosture(braced, pl.brace!.w, pl.intent.posture, b.linearVelocity, forwardOf(b.rotation)) : pl.intent.posture;
      const target = pr ? desiredUpFrom(clamp(pr.leanRad, 0, B.maxPostureLeanRad), pr.leanDirWorld) : { ...UP };
      const ang = Math.acos(clamp(dot(bal.desiredUp, target), -1, 1));
      const maxStep = (braced?.leanRateDegPerS !== undefined ? (braced.leanRateDegPerS * Math.PI) / 180 : B.postureRateRadPerS) * host.physics.dt;
      if (ang <= maxStep || ang < 1e-9) bal.desiredUp = target;
      else {
        const ax = cross(bal.desiredUp, target);
        bal.desiredUp = len(ax) > 1e-12 ? norm(qRot(qFromAxisAngle(norm(ax), maxStep), bal.desiredUp)) : target;
      }
    }
    // plan 06a: the applied suspension load bounds traction (drive and yaw scale with it, never above the legacy caps)
    const auth = pl.sus ? pl.sus.authority : 1;
    // plan 13e: the idle sway joins the drive's request only
    const loco = pl.sway ? { ...pl.intent.locomotion, desiredVelocityWorld: add(pl.intent.locomotion.desiredVelocityWorld, pl.sway) } : pl.intent.locomotion;
    const drive = computeDrive(loco, b.linearVelocity, b.massKg, pl.motor, supported, ls * auth);
    // plan 16 (p37, the contest): an engaged blocker's drive along the line to his man is his push and hold
    if (pl.block?.contest) contestDrive(host, pl, drive, b, supported);
    // (p42, the hit: the force pairs of the strikes between two men, once every player's motors are in)
    if (pl.block?.contest?.profile.hit) hits = true;
    // (p40, `FlatStance.level`: his yaw read from his level forward, the body's own vanishing near 90 deg of pitch)
    const yawRot = pl.sus?.flat?.level ? qFromUnitVectors(v3(0, 0, 1), levelForwardOf(b.rotation)) : b.rotation;
    const yaw = computeYaw(pl.intent.locomotion, yawRot, b.angularVelocity.y, pl.motor, supported, auth);
    if (drive.cap > 0) pl.proxy.body.addForce(drive.force, true);
    let balReq = v3();
    let balCapped = v3();
    let balCap = 0;
    let balSat = false;
    let support = v3(0, yaw.cap > 0 ? yaw.torqueY : 0, 0);
    let supportScale = 1;
    if (host.balanced) {
      if (supported) {
        // plan 06a: under the suspension the upright torque ceiling follows the profile's balanceCeiling rule (nominal
        // body weight by default, 0 without valid support); the posture hold uses the applied load and the solved lever
        const g = host.def.solver.gravityY;
        const Sb = host.suspension;
        balCap = !pl.sus
          ? availableBalanceTorque(B, b.massKg, g, pl.body.supportRadiusM)
          : !pl.sus.active
            ? 0
            : Sb?.balanceCeiling === 'appliedLoad'
              ? Math.min(B.maxBalanceTorqueNm, pl.sus.appliedN * pl.body.supportRadiusM)
              : availableBalanceTorque(B, b.massKg, g, pl.body.supportRadiusM);
        // plan 16 (the base): an engaged blocker whose base resists holds what his planted feet give (block-base.ts)
        const base = baseOf(host, pl, b.massKg * Math.abs(g));
        if (base) balCap = baseCeiling(base.m);
        // contact motion M2 follow-up: a braced carrier short of his desired lean holds the lean he has reached
        // (CarrierBracePose.leanHold)
        const up = upOf(b.rotation);
        const reached = host.def.brace?.pose.leanHold === 'reached' && pl.brace && pl.brace.w > 0 && up.y > bal.desiredUp.y;
        const holdUp = reached ? up : bal.desiredUp;
        const hold = pl.sus ? postureGravityHold(holdUp, pl.sus.pivotN / Math.abs(g), g, pl.sus.leverM) : postureGravityHold(holdUp, b.massKg, g, bal.leverM);
        // contact motion polish 1.1: under a hip hinge, the legs' balance first, then the trunk's pitch (hinge.ts)
        const hb = pl.hinge ? hingeBalanceTorque(pl.hinge, b.rotation, b.angularVelocity, bal.desiredUp, B, balCap, hold, holdUp) : null;
        const bt = hb ?? computeBalanceTorque(up, bal.desiredUp, b.angularVelocity, B, balCap, hold, holdUp);
        const held = base ? limitToBase(bt.capped, base.m, base.u) : null;
        // plan 16 (p36, giving ground): how far behind his base his balance asks the pressure (none without a base)
        const give = pl.block?.give;
        if (give) advanceGive(give, give.profile, base ? dot(bt.requested, cross(UP, base.u)) : 0, base ? base.m.back : 0, b.massKg * Math.abs(g), host.physics.dt);
        balReq = bt.requested;
        balCapped = held ? held.torque : bt.capped;
        balSat = bt.saturated || !!held?.saturated;
        // (the yaw keeps its room above the balance: the combined ceiling rises with a base past the fixed one)
        const ceiling = base ? B.combinedCeilingNm + Math.max(0, balCap - B.maxBalanceTorqueNm) : B.combinedCeilingNm;
        const c = combineSupportTorque(balCapped, yaw.cap > 0 ? yaw.torqueY : 0, ceiling);
        support = c.torque;
        supportScale = c.scale;
        // plan 16 (p41): the hips' own torque on the trunk's pitch, beyond the balance's cap (bounds with `hipNm`)
        if (hb && pl.hinge?.limits?.hipNm) support = add(support, hipTorque(pl.hinge.limits, b.rotation, hb));
      } else support = v3();
    }
    if (len(support) > 0) pl.proxy.body.addTorque(support, true);
    pl.applied = {
      requestedVelocity: drive.requestedVelocity,
      drive: drive.force,
      driveCap: drive.cap,
      driveSaturated: drive.saturated,
      yawTorque: yaw.torqueY,
      yawCap: yaw.cap,
      yawError: yaw.angleError,
      balanceRequested: balReq,
      balanceCapped: balCapped,
      balanceCap: balCap,
      balanceSaturated: balSat,
      supportTorque: support,
      supportScale,
      leanScale: ls,
    };
  }
  if (hits) blockHits(host, snap);
}

/**
 * Plan 16 (p42, block-base.ts `ContestHit`): the hit between two supported men engaged in a block with each other, from
 * the snapshot, once per pair (by the first of the two in id order whose contest has a hit, on its profile): while either
 * man's punch strikes (or is into its drive by less than his contest's `burst.s`) and a palm push is on between them,
 * the pair's reduced mass times their closing speed along the line (with the punch's parting) over `tauS`, at most `maxN`,
 * as a force pair at their centres of mass, less the part the winner's legs hold (none while they do not close). Each
 * man's contest records it (`hitN`).
 */
function blockHits(host: MotorHost, snap: Snapshot): void {
  const ps = host.players;
  for (const pl of ps) if (pl.block?.contest?.profile.hit) pl.block.contest.hitN = 0;
  const striking = (p: (typeof ps)[number]): boolean => {
    const pu = p.block?.punch;
    const K = p.block?.contest?.profile;
    return !!pu && (pu.phase === 'strike' || (pu.phase === 'drive' && !!K && host.t - pu.since < K.burst.s));
  };
  for (const pl of ps) {
    const st = pl.block?.contest;
    const H = st?.profile.hit;
    if (!st || !H || pl.rag || pl.controlMode !== 'supported' || pl.block!.phase !== 'engaged') continue;
    const him = ps.find((o) => o.id === pl.block!.target);
    if (!him || him.rag || him.controlMode !== 'supported' || him.block?.target !== pl.id || him.block.phase !== 'engaged') continue;
    if (him.block.contest?.profile.hit && him.id < pl.id) continue;
    if (!striking(pl) && !striking(him)) continue;
    const A = host.arms;
    const on = (p: (typeof ps)[number], o: (typeof ps)[number]): boolean => !!A && (['left', 'right'] as const).some((s) => A.pushOf(p.id, s)?.targetId === o.id);
    if (!on(pl, him) && !on(him, pl)) continue;
    // the punch: a man striking with his palms on his man drives them apart at up to `punchMps` times his effort
    // (p45, `untilStraight`: times the share of their extension his arms still have)
    const punch = (p: (typeof ps)[number], o: (typeof ps)[number]): number => (H.punchMps && striking(p) && on(p, o) ? H.punchMps * clamp(p.intent.block?.request.effort ?? p.intent.locomotion.effort, 0, 1) * (H.untilStraight ? extensionLeft(host, p, o) : 1) : 0);
    const a = snap.bodies[pl.id];
    const b = snap.bodies[him.id];
    const d = v3(b.position.x - a.position.x, 0, b.position.z - a.position.z);
    if (len(d) < 1e-9) continue;
    const u = norm(d);
    const hc = him.block.contest;
    const { F, onA, onB } = hitPair(H, (a.massKg * b.massKg) / (a.massKg + b.massKg), dot(sub(a.linearVelocity, b.linearVelocity), u), Math.max(punch(pl, him), punch(him, pl)), st.pushN, hc?.pushN);
    if (F <= 0) continue;
    pl.proxy.body.addForce(scale(u, onA), true);
    him.proxy.body.addForce(scale(u, onB), true);
    st.hitN = F;
    if (him.block.contest) him.block.contest.hitN = F;
  }
}

/**
 * Plan 16 (p45, `ContestHit.untilStraight`): the share of their extension p's arms still have on o (0..1): of each of his
 * palm pushes on o, from the length it landed at to the arm's reach, what is left (shoulder to patch now); the least of
 * them (1 with none, or no arms).
 */
function extensionLeft(host: MotorHost, p: MotorHost['players'][number], o: MotorHost['players'][number]): number {
  const A = host.arms;
  if (!A) return 1;
  const reach = A.profile.maxReachM;
  const t = vc(p.proxy.body.translation());
  const q = p.proxy.body.rotation();
  let share = 1;
  for (const s of ['left', 'right'] as const) {
    const pu = A.pushOf(p.id, s);
    if (!pu || pu.targetId !== o.id) continue;
    const L = len(sub(pu.pointWorld, add(t, qRot(q, shoulderLocal(p.body, s)))));
    share = Math.min(share, clamp((reach - L) / Math.max(1e-3, reach - pu.bornM), 0, 1));
  }
  return share;
}

/**
 * Plan 16 (p37, block-base.ts `BlockContest`): the contest of a supported man engaged in a block, from the solved state
 * before this substep. His state first (stood up, the fall clauses: his speed along the line to his man, his centre of
 * mass against his feet's rearmost sole corner, his man's push against what he pushes and holds with, his legs' lean);
 * then his capacity and his contest force, which takes the place of the drive's part along the line (the servo keeps
 * the part across it). Not engaged (closing, or lost), the level only releases and nothing is changed.
 */
function contestDrive(host: MotorHost, pl: MotorHost['players'][number], drive: ReturnType<typeof computeDrive>, b: Snapshot['bodies'][string], supported: boolean): void {
  const blk = pl.block!;
  const st = blk.contest!;
  const K = st.profile;
  const him = host.players.find((o) => o.id === blk.target);
  const dt = host.physics.dt;
  if (blk.phase !== 'engaged' || !supported || !pl.sus?.active || !pl.feet || !him || him.rag) {
    st.level *= Math.exp(-dt / K.stood.releaseS);
    // (p46, `beaten`: released with it)
    if (K.beaten && st.beaten !== undefined) st.beaten = nextBeaten(st.beaten, st.level, 0, false, dt, K.stood.releaseS);
    st.vPrev = null;
    st.outrunT = st.overT = st.leanT = null;
    st.forceN = st.pushF = st.holdF = 0;
    return;
  }
  const me = pl.proxy.body.translation();
  const to = host.coreBody(him).translation();
  const d = v3(to.x - me.x, 0, to.z - me.z);
  const u = len(d) > 1e-9 ? norm(d) : v3(0, 0, 1);
  const v = dot(b.linearVelocity, u);
  // his centre of mass behind his feet: their rearmost sole corner along the line, as shown
  const com = b.centerOfMassWorld;
  const { he, centerFoot } = pl.feet.shoe;
  let rear = Infinity;
  for (const s of ['left', 'right'] as const) {
    const f = pl.feet.feet[s];
    for (const z of [centerFoot.z - he.z, centerFoot.z + he.z]) for (const x of [-he.x, he.x]) rear = Math.min(rear, dot(add(f.ankleW, qRot(f.footQ, v3(x, 0, z))), u));
  }
  const H = him.block?.contest;
  const margin = H ? H.pushN / Math.max(1e-6, st.pushN + st.holdN) - 1 : -1;
  advanceContest(st, K, { v, behindM: rear - dot(com, u), margin, leanRad: pl.balance.theta }, host.t, dt);
  // (p46, `beaten`: how far the hit has him past his man, held while his man's palms are on him; p48, `heldByPush`: while
  // they push, not folded past their collapse)
  if (K.beaten) st.beaten = nextBeaten(st.beaten, st.level, H?.level ?? 0, !!host.arms && (['left', 'right'] as const).some((s) => host.arms!.pushOf(him.id, s)?.targetId === pl.id && !(K.heldByPush && host.arms!.pushFolded(him.id, s))), dt, K.stood.releaseS);
  // his capacity: effort (the fault: 1 for every man), how low he is against his man (the posed hips), his feet, stood up
  const hipY = (p: typeof pl): number => (p.pose ? (p.pose.jointLandmarksWorld.leftHip.y + p.pose.jointLandmarksWorld.rightHip.y) / 2 : p.proxy.body.translation().y);
  const feet = contestFeet(pl.feet, K);
  st.anchored = feet.setFeet > 0 && pl.balance.theta <= (K.anchorLeanDeg * Math.PI) / 180;
  const dbg = host.opts.debug?.block;
  // (striking, from the throw to `burst.s` into the drive after it: what his palms put on his man last substep)
  const pu = blk.punch;
  // (p50, the hand fight's `knock.opens`: his swipe has his man's hand knocked off him, and he drives into the opening)
  const opening = !!blk.hands && !dbg?.knockFree && openedBy(pl.id, him.block?.hands, pl.intent.block?.profile.handFight);
  const striking = opening || (!!pu && (pu.phase === 'strike' || (pu.phase === 'drive' && host.t - pu.since < K.burst.s)));
  let burstN = 0;
  let palmOn = false;
  if (striking && host.arms) for (const side of ['left', 'right'] as const) {
    const e = host.arms.lastForce.get(`${pl.id}:${side}`);
    if (e && e.kind === 'push' && e.target === him.id) burstN += e.actual;
    if (host.arms.pushOf(pl.id, side)?.targetId === him.id) palmOn = true;
  }
  // (p42, the hit: with the hit taking the closing, his hands carry his burst while his palms are on his man)
  if ((K.hit && palmOn) || opening) burstN = Infinity;
  const effort = dbg?.contestEffortBlind ? 1 : (pl.intent.block?.request.effort ?? pl.intent.locomotion.effort);
  // (p45, `inside`: the outside man's part lost)
  if (K.inside) st.leverage = blk.lane === 'outside' ? 1 / K.inside.leverage : 1;
  // (p50, the hand fight: what his hands off his man cost him)
  if (blk.hands && !dbg?.knockFree) {
    st.leverage = (K.inside ? st.leverage : 1) * handsLeverage(blk.hands, pl.intent.block?.profile.handFight);
  }
  // (p46, `burstTaper`: his man beaten, his burst run down over his drive's window)
  const taper = !opening && K.burstTaper !== undefined && (H?.beaten ?? 0) >= K.burstTaper && pu?.phase === 'drive' ? { burstShare: clamp(1 - (host.t - pu.since) / K.burst.s, 0, 1) } : {};
  // (p46, `lowUnheld`: each man's hips less the lift his posture holds past his stood level)
  const held = (p: typeof pl): number => {
    const c = p.block?.contest;
    const U = p.intent.block?.profile.under;
    return c && U ? Math.max(0, U.lift * (c.beaten ?? 0) - c.level) * c.profile.stood.riseM : 0;
  };
  const lowM = K.lowUnheld ? hipY(him) - held(him) - (hipY(pl) - held(pl)) : hipY(him) - hipY(pl);
  const cap = contestCapacity(K, { effort, lowM, feet: feet.share, level: st.level, anchored: st.anchored, leverage: st.leverage, driveCapN: drive.cap, burstN, ...taper });
  st.pushN = cap.pushN;
  st.holdN = cap.holdN;
  // (p42, `burst.mps`: bursting through his man, his push runs on to at least that speed times his effort)
  const want = dot(drive.requestedVelocity, u);
  const f = contestForce(K, cap, v, K.burst.mps !== undefined && striking && burstN > 0 ? Math.max(want, K.burst.mps * clamp(effort, 0, 1)) : want, !!dbg?.contestHoldPushes);
  st.forceN = f.F;
  st.pushF = f.push;
  st.holdF = f.hold;
  drive.force = add(sub(drive.force, scale(u, dot(drive.force, u))), scale(u, f.F));
}

/**
 * Plan 16: the base of a supported man engaged in a block whose profile's base resists (`BlockBase.resist`): what his
 * planted soles give about his support's ground point, along the line to his man (null otherwise: the ordinary ceiling).
 */
function baseOf(host: MotorHost, pl: MotorHost['players'][number], weightN: number): { m: BaseMoments; u: ReturnType<typeof v3> } | null {
  const blk = pl.block;
  if (!blk?.base?.resist || blk.phase !== 'engaged' || !pl.sus?.active || !pl.feet) return null;
  const him = host.players.find((o) => o.id === blk.target);
  if (!him) return null;
  const me = pl.proxy.body.translation();
  const to = host.coreBody(him).translation();
  const d = v3(to.x - me.x, 0, to.z - me.z);
  const u = len(d) > 1e-9 ? norm(d) : v3(0, 0, 1);
  // (p35, BASE_V3: read from the soles and his centre of mass, a heel within the limit bearing weight)
  const S = blk.base.soles;
  if (S) return { m: copBounds(soleContacts(pl.feet, SOLE_TOUCH_M, S), pl.sus.pivotPointWorld, vc(pl.proxy.body.worldCom()), u, weightN), u };
  return { m: baseMoments(soleContacts(pl.feet, SOLE_TOUCH_M), pl.sus.pivotPointWorld, u, weightN), u };
}
