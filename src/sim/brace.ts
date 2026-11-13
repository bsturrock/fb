// Contact motion M2 (rough-first slice): the ball carrier's brace for a hit he sees coming. The intent is ported from
// sim-6 src/logic/brace.ts as the milestone file describes it (that source was not available to read: the sibling
// repository holds only a cache): a visible, closing opponent whose predicted contact is near acquires the brace, the
// same threat holds it with hysteresis, a miss releases it, and an unseen or rear approach never starts one.
//
// Decision only reads observations: the carrier's observed snapshot (its controller's delay), the opponents' centres of
// mass and velocities there, the carrier's achieved body facing, and the solved contacts of that snapshot. No fixture
// time, no future collision. The weight it produces is read by the posture, stance and pose consumers (simulation.ts).
import type { CarryKey } from './carry';
import type { PlayerId, PostureIntent } from './contracts';
import { add, addScaled, clamp, closestOnSegment, deg, dot, horiz, len, norm, scale, sub, v3, type Vec3 } from './vec';

export interface CarrierBraceProfile {
  id: string;
  /** A seen opponent closing at `minClosingMps` or more whose predicted contact is this near (s) acquires the brace. */
  acquireS: number;
  /** The same threat holds it while its predicted contact stays this near (s): the hysteresis. */
  holdS: number;
  /** Contact distance: the horizontal centre distance at which the two bodies meet, both torso half widths plus this (m). */
  marginM: number;
  /** A held threat is released once its closest approach passes the contact distance by more than this (m). */
  holdMarginM: number;
  /** Visible: within this angle of the body's achieved facing (deg, half the field of view). */
  fovHalfDeg: number;
  /** Below this closing speed (m/s) nothing threatens. */
  minClosingMps: number;
  /** A third player whose centre is this near the sight line, between the two, hides the threat (m). */
  occluderRadiusM: number;
  /** The weight's critically damped approach to its target (natural frequency, rad/s): no velocity step at a reversal. */
  rampRadPerS: number;
  /** What the weight does to the carrier (each at full weight, blended by it). */
  pose: CarrierBracePose;
}

/**
 * The brace pose: one authored pose blended by the weight, composed with locomotion. The trunk is the proxy's rigid
 * body, so the chest comes forward by leaning the body (the posture request, which the balance profile bounds and rate
 * limits); the hips drop through the support's height target (the legs keep stepping on the ground and bend to it).
 */
export interface CarrierBracePose {
  /** Hip drop (m) taken from the support's height target, on top of locomotion's own preparation drop. */
  dropM: number;
  /** Forward lean (deg) toward the travel, added to the controller's posture request (the balance profile bounds the sum). */
  leanDeg: number;
  /** Below this speed (m/s) the lean turns from the travel toward the body's facing (continuously, from 0 at rest). */
  travelMps: number;
  /**
   * While braced, the rate (deg/s) the desired up turns toward the posture request; absent: the balance profile's
   * (`postureRateRadPerS`, 30 deg/s, which takes 0.4 s to form the 12 deg lean).
   */
  leanRateDegPerS?: number;
  /**
   * While braced, the posture gravity hold for the lean the body has reached while it is short of the desired lean
   * (`reached`: about the body's own lean axis, m g L sin of its lean); absent, or once the body leans as far as the
   * desired up or further: the desired lean's, as for every other player. The desired lean's hold already holds the full
   * lean while the body is still near upright, so it cancels most of the position term and the lean forms with a time
   * constant of about kd / (kp - m g L) = 1 s.
   */
  leanHold?: 'reached';
  /** The carry arm's high-and-tight key (chest frame, anatomical left +X, as the carry's keys). */
  carryKey: CarryKey;
  /** Share of the clip's carry-arm swing the braced carry keeps. */
  swingKeep: number;
  /**
   * The free palm on the ball as the pose shows it: on its exposed side (chest frame, anatomical left +X, as the keys),
   * off its surface by the palm's radius and this gap (m).
   */
  coverDir: Vec3;
  coverGapM: number;
  /** Without a carry profile (no drawn ball): the radius of the ball the key's seat would hold on the shown forearm (m). */
  holdBallRadiusM: number;
  /** The covering arm's elbow pole (chest frame, x signed for the left arm). */
  coverPole: Vec3;
}

/**
 * The rough-first slice's values. Acquisition 0.45 s and hold 0.65 s are sim-6's seeds (the milestone file's 0.15-0.3 s
 * proposal leaves the pose no time to develop before a 7 m/s defender arrives); margin 0.2 m is sim-6's. The field of
 * view and the ramp are this slice's starting values (docs/handoff/contact-motion-m2.md).
 */
export const CARRIER_BRACE_V1: CarrierBraceProfile = {
  id: 'carrier-brace-v1',
  acquireS: 0.45,
  holdS: 0.65,
  marginM: 0.2,
  holdMarginM: 0.1,
  fovHalfDeg: 70,
  minClosingMps: 0.5,
  occluderRadiusM: 0.3,
  rampRadPerS: 20,
  pose: {
    dropM: 0.05,
    leanDeg: 12,
    travelMps: 1,
    // the carry's forward key with the elbow down at the ribs (upper arm near vertical) and the ball further up the
    // forearm: on the L3 model, from the shoulder, the ball centre 2 cm higher and 3 cm closer to the chest than the
    // rest carry's, at the front of the ribs below the pec, the hand over its nose; with a quarter of the swing kept it
    // moves 8 cm over a stride where the run swings it 26 cm (L3-F3-collision)
    carryKey: { upper: norm(v3(-0.09, -0.95, 0.3)), fore: norm(v3(0.13, 0.395, 0.903)), inside: v3(0.42, 0.82, -0.39), along: 0.2, out: 0.117, tilt: -0.314, wristFlex: 1.065 },
    swingKeep: 0.25,
    // on the ball's inner side toward the front (the free arm reaches no further across: the model's upper arm is 10 cm
    // thick, and further in it passes through the chest), the elbow low and out in front, so the upper arm passes down
    // the side of the chest and the forearm rises across its front
    coverDir: norm(v3(0.9, -0.1, 0.42)),
    coverGapM: 0.03,
    holdBallRadiusM: 0.085,
    coverPole: norm(v3(0.61, -0.78, 0.16)),
  },
};

/**
 * Contact motion M2 follow-up: CARRIER_BRACE_V1 with the lean formed in time for the hit: the desired up turns at
 * 60 deg/s while braced (the 12 deg in 0.2 s, the weight's ramp), and the hold is the reached lean's while short of it.
 * On a head-on hit (L3-F3-collision) the chest is 10-11 deg forward at contact, where V1 reaches 4.
 */
export const CARRIER_BRACE_V2: CarrierBraceProfile = {
  ...CARRIER_BRACE_V1,
  id: 'carrier-brace-v2',
  pose: { ...CARRIER_BRACE_V1.pose, leanRateDegPerS: 60, leanHold: 'reached' },
};

/** Per-carrier brace state (pose and request consumers read `w`). */
export interface CarrierBraceState {
  /** Weight 0..1 and its rate (1/s). */
  w: number;
  v: number;
  /** The threat holding the brace, or null. */
  threat: PlayerId | null;
  /** Why the threat last changed (trace, lab). */
  reason: string;
  /** The held threat's last prediction (s; null without a threat). */
  tcS: number | null;
}

export const newCarrierBrace = (): CarrierBraceState => ({ w: 0, v: 0, threat: null, reason: 'reset', tcS: null });

/** A body as the carrier observes it: horizontal centre of mass, velocity, and its torso half width. */
export interface BraceBody {
  id: PlayerId;
  com: Vec3;
  v: Vec3;
  halfWidthM: number;
}

/** The carrier: as a body, with its achieved facing (the proxy's forward, not travel or an animated head turn). */
export interface BraceSelf extends BraceBody {
  forward: Vec3;
}

/** One opponent's prediction at the present relative velocity. */
export interface BraceThreat {
  /** Time until the centres come within the contact distance (s); 0 within it; Infinity for a miss or no closing. */
  tcS: number;
  /** Closest horizontal approach of the centres, ahead (m). */
  missM: number;
  /** Contact distance (m). */
  reachM: number;
  /** Present horizontal centre distance (m). */
  rangeM: number;
  /** Closing speed along the line between the centres (m/s, positive closing). */
  closingMps: number;
  /** Angle of the opponent from the carrier's facing (deg: 0 ahead, 180 behind). */
  bearingDeg: number;
}

/** Ladder-style fault switches (SimOptions.debug.brace): each is off by default and breaks one rule when on. */
export interface BraceDebug {
  /** Fault: visibility is not checked (no field of view, no occlusion): a rear approach braces. */
  unseen?: boolean;
  /** Fault: an acquired threat is never released (its brace persists after a miss). */
  holdForever?: boolean;
  /** Fault: the prediction and the hold ignore the miss distance (time to the closest approach, however far): a passing line braces. */
  noMissTest?: boolean;
  /** Fault: no anticipation: a threat is acquired only once it touches the carrier. */
  contactOnly?: boolean;
  /** Fault: no ramp: the weight steps to its target in one substep (the pose jumps). */
  noRamp?: boolean;
}

export function threatOf(P: CarrierBraceProfile, self: BraceSelf, o: BraceBody, faults?: BraceDebug): BraceThreat {
  const d = horiz(sub(o.com, self.com));
  const r = len(d);
  const vr = horiz(sub(o.v, self.v));
  const reach = self.halfWidthM + o.halfWidthM + P.marginM;
  const closing = r > 1e-9 ? -dot(vr, d) / r : 0;
  const vv = dot(vr, vr);
  const tStar = vv > 1e-12 ? Math.max(0, -dot(d, vr) / vv) : 0;
  const miss = len(addScaled(d, vr, tStar));
  let tc: number;
  if (r <= reach) tc = 0;
  else if (vv <= 1e-12 || closing <= 0) tc = Infinity;
  else if (faults?.noMissTest) tc = tStar;
  else if (miss > reach) tc = Infinity;
  else tc = Math.max(0, tStar - Math.sqrt(reach * reach - miss * miss) / Math.sqrt(vv));
  const f = norm(horiz(self.forward), v3(0, 0, 1));
  const bearing = r > 1e-9 ? deg(Math.acos(clamp(dot(f, scale(d, 1 / r)), -1, 1))) : 0;
  return { tcS: tc, missM: miss, reachM: reach, rangeM: r, closingMps: closing, bearingDeg: bearing };
}

/** A third body whose centre lies within the occluder radius of the sight line, strictly between the two, hides it. */
export function occluded(P: CarrierBraceProfile, self: BraceBody, o: BraceBody, thirds: readonly BraceBody[]): boolean {
  const a = horiz(self.com);
  const b = horiz(o.com);
  for (const q of thirds) {
    if (q.id === self.id || q.id === o.id) continue;
    const c = closestOnSegment(horiz(q.com), a, b);
    if (c.t > 0 && c.t < 1 && len(sub(horiz(q.com), c.point)) < P.occluderRadiusM) return true;
  }
  return false;
}

/** Whether the carrier sees `o`: within the field of view of his facing, and not hidden by a third body. */
export function visible(P: CarrierBraceProfile, self: BraceSelf, o: BraceBody, th: BraceThreat, thirds: readonly BraceBody[], faults?: BraceDebug): boolean {
  if (faults?.unseen) return true;
  return th.bearingDeg <= P.fovHalfDeg && !occluded(P, self, o, thirds);
}

export interface BraceChange {
  from: PlayerId | null;
  to: PlayerId | null;
  reason: string;
  tcS: number | null;
  bearingDeg: number | null;
}

/**
 * One substep of the decision and the weight. `opponents`: the bodies that can threaten (the other side); `thirds`:
 * every other body (occluders); `touching`: the opponents in solved contact with the carrier; `active`: supported, and no
 * referee ending (otherwise the target is 0 and any threat is dropped). Returns the threat change, or null.
 */
export function stepBrace(
  P: CarrierBraceProfile,
  st: CarrierBraceState,
  self: BraceSelf,
  opponents: readonly BraceBody[],
  thirds: readonly BraceBody[],
  touching: ReadonlySet<PlayerId>,
  active: boolean,
  dt: number,
  faults?: BraceDebug,
): BraceChange | null {
  const from = st.threat;
  let change: BraceChange | null = null;
  const set = (to: PlayerId | null, reason: string, th: BraceThreat | null): void => {
    st.threat = to;
    st.reason = reason;
    change = { from, to, reason, tcS: th && Number.isFinite(th.tcS) ? th.tcS : null, bearingDeg: th ? th.bearingDeg : null };
  };
  st.tcS = null;
  if (!active) {
    if (st.threat !== null) set(null, 'inactive', null);
  } else {
    if (st.threat !== null) {
      const o = opponents.find((b) => b.id === st.threat);
      const th = o ? threatOf(P, self, o, faults) : null;
      const hold = th ? th.reachM + P.holdMarginM : 0;
      if (faults?.holdForever && o) st.tcS = th!.tcS;
      else if (!o || !th) set(null, 'gone', null);
      // engaged: touching, or within the contact distance and its hold margin (the bodies part a little after a hit)
      else if (touching.has(o.id) || th.rangeM <= hold) st.tcS = 0;
      else if (th.closingMps > 0 && th.tcS <= P.holdS && (th.missM <= hold || faults?.noMissTest)) st.tcS = th.tcS;
      else set(null, th.closingMps <= 0 ? 'opening' : th.missM > hold ? 'miss' : 'far', th);
    }
    if (st.threat === null) {
      let best: { o: BraceBody; th: BraceThreat } | null = null;
      for (const o of opponents) {
        const th = threatOf(P, self, o, faults);
        const near = faults?.contactOnly ? touching.has(o.id) : th.tcS <= P.acquireS && th.closingMps >= P.minClosingMps;
        if (!near || !visible(P, self, o, th, thirds, faults)) continue;
        if (!best || th.tcS < best.th.tcS) best = { o, th };
      }
      if (best) {
        set(best.o.id, 'seen', best.th);
        st.tcS = best.th.tcS;
      }
    }
  }
  // the weight: critically damped toward its target, stopped at its bounds (a clamped rate is not integrated on)
  const target = st.threat !== null ? 1 : 0;
  if (faults?.noRamp) {
    st.w = target;
    st.v = 0;
    return change;
  }
  const k = P.rampRadPerS;
  st.v += (k * k * (target - st.w) - 2 * k * st.v) * dt;
  const w = st.w + st.v * dt;
  st.w = clamp(w, 0, 1);
  if (st.w !== w) st.v = 0;
  return change;
}

/**
 * The carrier's posture request under the brace: the controller's request plus `w` of the brace lean toward the travel
 * (toward the facing as the speed falls below `travelMps`), as a lean vector sum. `w` 0: the request unchanged.
 */
export function bracePosture(P: CarrierBracePose, w: number, req: PostureIntent | undefined, velocity: Vec3, forward: Vec3): PostureIntent | undefined {
  if (!(w > 0)) return req;
  const hv = horiz(velocity);
  const sp = len(hv);
  const t = clamp(sp / P.travelMps, 0, 1);
  const f = norm(horiz(forward), v3(0, 0, 1));
  const dir = norm(add(scale(sp > 1e-9 ? scale(hv, 1 / sp) : f, t), scale(f, 1 - t)), f);
  const lean = add(req ? scale(norm(horiz(req.leanDirWorld), dir), req.leanRad) : v3(), scale(dir, (w * P.leanDeg * Math.PI) / 180));
  const r = len(lean);
  return r > 1e-12 ? { leanDirWorld: scale(lean, 1 / r), leanRad: r } : req;
}
