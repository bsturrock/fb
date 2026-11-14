// Wrap-attempt controller (Gate 2): approaches the runner and requests independent arm paths around the runner's
// opposite sides. Waypoints are requests generated from the runner's current observed geometry; phases advance on
// observed hand position / clamp contact. Timeouts only abandon or retry; they never create contact or a wrap.
import type { ArmIntent, ArmSide, PlayerIntent, StanceRequest } from '../contracts';
import { pairKey } from '../contracts';
import type { BodyProfile, FallLinkProfile, FallResponseProfile, MotorProfile, RideHoldProfile } from '../profiles';
import { FALL_HOLD_V1, sideSignX } from '../profiles';
import type { PlayerSetup } from '../fixture';
import type { Controller, ControllerContext } from './base';
import { add, addScaled, clamp, cross, dot, horiz, len, norm, qRot, scale, sub, upOf, v3, UP, type Vec3 } from '../vec';
import { hingeAxis, type HingeArrive, type HingeLimits } from '../hinge';

export type ArmPlan = 'wrap' | 'palmFlank' | 'none';
export type WrapArmPhase = 'ready' | 'open' | 'spread' | 'arc' | 'close' | 'sustain' | 'recover' | 'palmReach' | 'palmClose' | 'palmPull' | 'idle';

/**
 * Contact motion M3 (`FixtureDef.wrap`; absent: the Gate 2 progression unchanged): how a wrapping defender's arms open
 * and close. Requests only, through the same arm system (every acquisition guard, the shared budget and the break rules
 * stay). The hands ride in front of his chest until the carrier is about to arrive, then open into a cradle wider than
 * the carrier's torso; a valid touch closes them at once.
 */
export interface WrapProfile {
  id: string;
  /** Carriage while the carrier is far: each palm `forwardM` ahead of the chest, `lateralM` off the centre line, at the band. */
  ready: { forwardM: number; lateralM: number };
  /**
   * The cradle: each palm `forwardM` ahead of the chest and `marginM` outside the carrier's torso (its half width across
   * the approach), at the band. Opens once the predicted contact (gap over the observed closing speed) is `leadS` away
   * or the gap is below `gapM`; back to the carriage once both are more than doubled (a miss going by).
   */
  open: { leadS: number; gapM: number; forwardM: number; marginM: number };
  /**
   * A valid touch closes at once: the palm or forearm on the target at or past the torso's near corner (its azimuth from
   * the near face, less `slackDeg`), or the bodies meeting with the hand there. null: the Gate 2 arc thresholds.
   */
  closeOnTouch: { slackDeg: number } | null;
  /** The closing target: on the ring at `azDeg`, `depthM` inside the carrier's torso. null: the Gate 2 target. */
  close: { azDeg: number; depthM: number } | null;
  /**
   * The committed finish (absent: the supported finish as it was), on a defender with one (`WrapSpec.finish`). A secure
   * hold is both arms retaining (an observed clamp or grip) on his target (the arm touching the focus); one-arm holds
   * never commit, and the observational wrap status is not read (it grants nothing). Held secure for `secureS`, the finish lowers his stance to `heightM` and leans him `leanDeg` toward its
   * direction while it drives; `lowerS` later he asks to leave support (`PlayerIntent.leaveSupport`: the simulation's
   * validated conversion, reason 'takedown'). If the carrier he holds securely is off his support first, he asks at once.
   * A hold not secure for longer than `graceS` starts it over (a broken hold or a miss never commits); the carrier is never
   * converted by it.
   *
   * `hold` (absent: his arms go limp at the switch, the clamps ending with his proxy): the holds he has at the takedown
   * carry across it onto his ragdoll's arms. The simulation starts this fall response for a takedown conversion on a
   * fixture without one of its own (a fixture with one runs its own for every conversion, holds included): each arm
   * still holding keeps its shape and presses where it touches the carrier, under the response's bounded drive, while the
   * existing transfer carries the hold (a palm grip as its passive link, a forearm clamp as the forearm kept on by solved
   * contact), inside the shared falling arm budget; a hold breaks by the existing rules and frees that arm to brace.
   */
  commit?: { secureS: number; lowerS: number; heightM: number; leanDeg: number; graceS: number; hold?: FallResponseProfile };
  /** Contact motion polish 1.1 (absent: the upright approach as it was): the strike posture and wide arms. */
  strike?: WrapStrike;
  /**
   * Contact motion polish 1.2 (with `commit`; absent: the committed finish lowers him and takes him down on its timer): the
   * drive. A hold no longer lowers him and takes him down after `commit.lowerS`: he stays on his feet and drives through the
   * carrier until he has a reason to leave them (`WrapDrive`).
   */
  drive?: WrapDrive;
  /** Contact motion polish 1.4 (absent: the arms at the spec's band round the carrier's torso, as before): the low strike's arms. */
  low?: WrapLow;
  /**
   * Contact motion polish 1.2, the ride-down (with `drive`; absent: the drive's exits as they were): he stays on his feet
   * through the takedown and rides the carrier down (`WrapRide`).
   */
  ride?: WrapRide;
  /** Contact motion polish 1.4, the bound-legs fall (simulation; absent: nothing tells it a held man cannot run): `WrapBind`. */
  bind?: WrapBind;
  /**
   * Contact motion polish 2.1, the fall link (arm system; absent: his forearm holds go on after his switch only while
   * solved contact keeps them): each clamp he has at his switch becomes a breakable link to the carrier (`FallLinkProfile`).
   */
  fallLink?: FallLinkProfile;
}

/**
 * Contact motion polish 1.4, the bound-legs fall: a supported carrier whose legs a holder has bound goes down then, not
 * later (simulation, where the loss envelope queues a loss: a loss of support, reason 'boundLegs'). The holder is a
 * supported player whose focus he is with a secure hold on him (the drive's test: both arms retaining on him, or one with
 * the holder's body on him under `drive.oneArmBody`). He is bound once, held for `confirmS` (each clause's clock starts
 * over after the condition has been gone for longer than `commit.graceS`, a clamp's flicker):
 *  (a) both arms hold him at or below his pelvis (each hold's point under the centre of his pelvis box, in his frame):
 *      round his legs or hips;
 *  (b) his legs cannot step: a foot of his is in a swing the leg guard holds off its target or past its planned time
 *      (stranded), no foot of his has planted since the clock began, and he is still pushed or dragged (his legs lean
 *      `pushLeanDeg` or more, or his speed over the ground is `pushMps` or more).
 * Never from a touch that is not a secure hold, never without a holder, never for a carrier braced against a man without
 * his hold. While a clause's clock runs his posture request leans toward his travel (his horizontal velocity, his facing
 * when slow) at `leanDeg` (the balance's posture cap bounds it): the carrier tries to fall forward; his momentum and
 * the holder's drive do the rest (no force of its own).
 */
export interface WrapBind {
  confirmS: number;
  pushLeanDeg: number;
  pushMps: number;
  leanDeg: number;
}

/**
 * Contact motion polish 1.2, the ride-down: once the drive has begun he stays supported through the takedown. The carrier
 * going over or off his support is no exit; the extra speed is never eased; his trunk follows the carrier down on the
 * hinge and his hips sink. While an arm holds the carrier with the other or his body on him too (`PlayerIntent.ride`, the
 * simulation's own check of the hold and the contact), the carrier counts as his support: a lean past the loss envelope
 * against the man he holds does not convert him (the hard lean limit and the bump stop still do; the hold gone, the
 * envelope's verdict stands at once). He leaves his feet (the takedown) only:
 *  (h) his chest (the lowest point of his torso) is within `groundM` of the ground;
 *  (s) his centre sinks faster than `sinkMps` (no supported crouch does: he is falling);
 *  (g) the carrier is off his support with his core within `carrierDownM` of the ground, the drive `minS` old;
 *  (d) the drive's stall (after `drive.stallS`, the carrier not going over) or `maxS` in all;
 *  (l) his hold lost for longer than `commit.graceS` with the carrier off his support: he goes down after him (he does
 *      not stand up over him; the hold surviving the carrier's fall is the arm system's).
 * The simulation converts a riding tackler at the referee's ending too (he is mid-takedown; a takedown is otherwise
 * never asked after it). A hold lost with the carrier on his feet ends the ride with the drive: the ordinary envelope
 * again (a broken hold or a miss stays escapable).
 */
export interface WrapRide {
  /** Exit (h): chest height (m). */
  groundM: number;
  /** Exit (s): downward speed of his centre of mass (m/s). */
  sinkMps: number;
  /** Exit (g): the carrier's core height (m), and the drive's least age for it (s). */
  carrierDownM: number;
  minS: number;
  /** The drive's limit (s), in place of `drive.maxS`. */
  maxS: number;
  /**
   * The follow: the trunk's pitch (hinge, deg) and the hips' drop (m) blended from the strike's toward these as the carrier
   * goes over: the larger of his lean from `fromLeanDeg` to `fullLeanDeg` and his core's drop since the drive began over
   * `fullDropM` (below `fromLeanDeg` the strike's: a trunk pitched lower pushes lower on him and tips him less).
   */
  pitchDeg: number;
  dropM: number;
  fromLeanDeg: number;
  fullLeanDeg: number;
  fullDropM: number;
  /**
   * The ride hold (absent: a clamp on the fallen carrier lasts while its forearm's nearest contact is an eligible surface
   * of his): the arm system keeps the riding tackler's clamp as a patch on the carrier's body (`RideHoldProfile`).
   */
  hold?: RideHoldProfile;
  /** The carrier counts as his support while his legs lean less than this (deg; beyond it the envelope's verdict stands). */
  leanDeg: number;
  /** The come-down (absent: exits (g) and (l) and the referee's ending convert him where he is): `WrapRideDown`. */
  down?: WrapRideDown;
}

/**
 * Contact motion polish 1.2, the ride-down's come-down: a riding tackler whose carrier has gone down comes down on him.
 * Once the carrier is off his support the trunk's request is the full fold (`pitchDeg`, `dropM`) at once, on the ride's
 * own bounds (`hinge`: a hard trunk fold, not the strike's), and his weight goes forward with it (`weightForward`: the
 * support acts under his body's own frame, as for any player without the hinge, so the pitch he has tips him on toward
 * the carrier). The carrier's core on the ground (g), the hold lost with the carrier down (l) and the referee's ending
 * no longer convert him: they begin the come-down, in which he keeps riding (the fold and sink go on, the drive goes on
 * toward the carrier's core) until his chest is low or his body has pitched to the full fold (h: past it he is falling,
 * not folding), he sinks faster than a supported crouch can (s), the envelope
 * finds him off his support (the hold gone), or `maxS` has passed since it began (t: he never stays posed and upright
 * over a man on the ground; within the referee's 0.5 s settle). In the come-down he converts too the moment his
 * support's probe finds no ground (f: his origin over the carrier, or off his feet), and (the simulation) riding with the
 * carrier off his support, once he has had no planted foot, no contact with the carrier and no hold of him for longer
 * than the drive's grace (`commit.graceS`: a stride's flight is not a fall): he never falls posed.
 */
export interface WrapRideDown {
  maxS: number;
  hinge: { rateDegPerS: number; accelDegPerS2: number; dropRateMps: number };
  weightForward: boolean;
  /**
   * The come-down arriving (absent: the fold at the hinge's bounds, the topple to the end, exit (h) at any pitch rate, the
   * drive's extra speed): he comes down on the carrier slowing down. With the carrier off his support the fold's path is
   * re-based on the pitch he has reached and brakes to the full fold (`HingeArrive`, hinge.ts), his weight-forward topple
   * ends as that braking begins, exit (h) for the full fold waits for his body's pitch rate to fall to
   * `foldedRateDegPerS` (his chest low still converts him at once), and the drive asks for the carrier's velocity without
   * its extra speed: a body still pitching fast at the switch hands its spin to a folded ragdoll of half the pitch
   * inertia (twice the rate, twice the rotational energy: the somersault over the carrier).
   */
  arrive?: HingeArrive & { foldedRateDegPerS: number };
}

/**
 * Contact motion polish 1.4, the deep crouch tackle's entry: the arms go round the carrier at pelvis height, where the
 * hands can meet. Every arm target sits at `bandYLocal` above the carrier's root (in place of `WrapSpec.bandYLocal`),
 * and the ring, the cradle's width and the near corner are the carrier's shape at that height (`shapeAt`: below his
 * pelvis box, the support capsule), not his torso box. The carriage and the cradle are measured ahead of the tackler's
 * shoulders, and the strike's line steers his head (not his centre) `strike.offsetM` to the carrier's side: his trunk
 * pitched deep carries both well ahead of his hips. Requests only.
 */
export interface WrapLow {
  bandYLocal: number;
  /**
   * Polish 1.4 (absent: the closing target is `close`, on the ring behind the carrier): the close path walks round the
   * carrier's shape. The closing target leads the palm's own azimuth (from the near corner) by `leadDeg`, up to `endDeg`
   * (behind him, beside the other hand), `extraM` outside the shape at the band: a straight pull from the palm runs along
   * the surface, not into it, and the forearm wraps the shape behind the palm.
   */
  walk?: { leadDeg: number; endDeg: number; extraM: number };
}

/**
 * Polish 1.4: the low wrap's closing target azimuth (deg from the carrier's near face, on the arm's own side) for a palm at
 * `palmAzDeg`: `walk.leadDeg` ahead of the palm (or of the near corner, the palm still in front of it), at most `walk.endDeg`.
 */
export function walkAzDeg(walk: NonNullable<WrapLow['walk']>, palmAzDeg: number, cornerDeg: number): number {
  return Math.min(walk.endDeg, Math.max(palmAzDeg, cornerDeg) + walk.leadDeg);
}

/**
 * The horizontal support distance along world direction `d` of the widest of a body's proxy shapes at height `y` above
 * its root (the torso and pelvis boxes, each at its own half extents, and the support capsule's radius), as if upright.
 */
export function shapeAt(body: BodyProfile, rq: { x: number; y: number; z: number; w: number }, d: Vec3, y: number): number {
  if (body.kind === 'legacyCapsule') return body.legacy.radius;
  const C = body.compound;
  const rx = qRot(rq, v3(1, 0, 0));
  const rz = qRot(rq, v3(0, 0, 1));
  const box = (b: { center: Vec3; halfExtents: Vec3 }): number => (Math.abs(y - b.center.y) <= b.halfExtents.y ? Math.abs(dot(d, rx)) * b.halfExtents.x + Math.abs(dot(d, rz)) * b.halfExtents.z : 0);
  const s = C.support;
  return Math.max(box(C.torso), box(C.pelvis), Math.abs(y - s.center.y) <= s.halfHeight + s.radius ? s.radius : 0);
}

/**
 * Contact motion polish 1.2: the tackler's drive. A hold he drives on, held for `commit.secureS`, starts it: he keeps the
 * strike's posture (its hinge and drop; the stance as asked), faces the carrier and asks, at full effort, for the
 * carrier's velocity plus `extraMps` along the line from his centre through the carrier's (a rear wrap pushes the carrier
 * forward, a front wrap back, a side wrap across), eased out as his own lean nears the loss (`ease`). The existing drive
 * motor turns that into force within its caps. He
 * leaves his feet only for a reason, through the validated conversion (`PlayerIntent.leaveSupport` 'takedown'):
 *  (a) the carrier is off his support: he goes down with him at once (as the committed finish did);
 *  (b) the carrier is going over: his observed lean is past `goLeanDeg`;
 *  (c) his own balance fails: the ordinary loss of support, his holds carried onto his ragdoll's arms by the fixture's
 *      fall response (under the takedown's hold, `commit.hold`, the loss starts it too while an arm holds);
 *  (d) a stall: he has driven `stallS` and the carrier is not going over (his lean under `progress.leanDeg` and grown
 *      less than `progress.riseDeg` over the last `progress.windowS`), or `maxS` in all: he commits his weight (the
 *      committed finish's takedown, the last resort).
 * A hold lost for longer than `commit.graceS` ends the drive and its clock: the finish's own modes again (one arm
 * repositions, none pursues).
 */
export interface WrapDrive {
  /** One arm retaining on the carrier with his body touching the carrier's is a hold he drives on (else both arms). */
  oneArmBody: boolean;
  /** Speed asked for beyond the carrier's, along the line through him (m/s). */
  extraMps: number;
  /** Exit (b): the carrier's lean (deg). */
  goLeanDeg: number;
  /** Exit (d): the drive's time (s) after which a carrier not going over is a stall (`progress`), and its limit. */
  stallS: number;
  progress: { leanDeg: number; riseDeg: number; windowS: number };
  maxS: number;
  /**
   * The extra speed eased out as his own lean (the legs', observed) goes from `fromDeg` to `toDeg`: a tackler knocked
   * off balance stops pushing before he falls (the drive motor's own lean scale leaves most of its cap near the loss).
   */
  ease: { fromDeg: number; toDeg: number };
}

/**
 * Contact motion polish 1.1: the tackler's strike. One authored pose, blended in by a weight and aimed by rules, as the
 * carrier's brace is: over the last part of the approach he lowers his hips and pitches his trunk well forward (a hip
 * hinge: hinge.ts, the legs keep the balance), leads with the near shoulder at the carrier's torso with his head to the
 * carrier's side, and throws his arms wide from the shoulders (the cradle wider, the elbows out); the wrap then closes
 * on the touch as before. Requests only.
 *
 * The head's side is decided as the strike starts, from the approach: behind the carrier's motion across the approach
 * (opposite his lateral velocity relative to the tackler, above `sideRuleMps`), never across his front; with no such
 * motion the side the tackler is already on (beyond 5 cm of the centre line); dead centre, the tackler's left (his
 * right shoulder strikes). Motion across the approach that develops before the bodies meet moves it behind.
 */
export interface WrapStrike {
  /**
   * On once the predicted contact (gap over the observed closing speed) is `leadS` away or the gap is under `gapM`;
   * off, a miss going by, once neither holds (the contact more than `2 leadS` away) with no contact for `lostS`; off
   * too once the carrier is down without the tackler's hold (he straightens up).
   */
  leadS: number;
  gapM: number;
  lostS: number;
  /** Off too, with no contact, once the carrier's bearing off the tackler's facing is above this (deg): he is going by. */
  offBearingDeg: number;
  /** While the weight is up the facing asked for stays within this of the body's own (deg): a pitched trunk cannot spin. */
  maxTurnDeg: number;
  /** The weight's response (1/s): critically damped toward 1 while on, 0 off. */
  rateHz: number;
  /**
   * The trunk's pitch at full weight (deg): `leanDeg` of whole-body posture lean (the legs', which the balance torque
   * holds against gravity: the approach's lean blends to it) plus the hinge's rest.
   */
  pitchDeg: number;
  leanDeg: number;
  /** The facing turned toward the head's side at full weight (deg; the trunk pitches along it): the strike shoulder leads. */
  yawDeg: number;
  /** The hips' drop at full weight (m). */
  dropM: number;
  /**
   * Before the first contact his line steers his centre `offsetM` to the head's side of the carrier's (gain
   * `offsetGainPerS` on the lateral error, at most `offsetMps` across), so the head passes beside the carrier's torso.
   */
  offsetM: number;
  offsetGainPerS: number;
  offsetMps: number;
  /** The relative lateral speed (m/s) above which the head's side is taken from the carrier's motion. */
  sideRuleMps: number;
  /**
   * The wide arms at full weight: the cradle's palms `forwardM` ahead of the chest and `marginM` outside the carrier's
   * torso, each elbow toward `pole` (owner-local, x on the arm's own side), blended from the cradle's by the weight.
   */
  arms: { forwardM: number; marginM: number; pole: Vec3 };
  /** The hip hinge's bounds. */
  hinge: HingeLimits;
}

/** Contact motion polish 1.1 fault switches (tests: negative controls). */
export interface WrapDebug {
  /** The head's side rule reversed: the head goes across the carrier's front. */
  headAcross?: boolean;
  /** The strike never ends once on (no recovery after a miss). */
  strikeHeld?: boolean;
  /** No elbow pole request (the cradle's palms wide, the elbows the arm's own). */
  noPole?: boolean;
  /** Polish 1.2: the drive asks for nothing (effort 0, no extra speed): he goes limp on the hold. */
  driveLimp?: boolean;
  /** Polish 1.2: exits (a) and (b) off: he does not go down with a carrier who is down or going over. */
  noFollow?: boolean;
  /** Polish 1.2: exit (d) off: a stalled drive never commits his weight. */
  noStall?: boolean;
  /** Polish 1.2 (simulation, conversion): under the takedown's hold a loss of support starts no fall response (he lets go). */
  noLossHold?: boolean;
  /** Polish 1.2, the ride-down: exits (h) and (s) off (he stays posed however low or fast he goes). */
  noRideGuard?: boolean;
  /** Polish 1.2, the ride-down (simulation): the carrier counts as his support without the hold and contact check. */
  rideNoHoldCheck?: boolean;
  /** Polish 1.2, the ride hold (arms): no break rule (contact memory, reach, separation, overload); only the ride's end ends it. */
  rideHoldNoBreak?: boolean;
  /** Polish 1.2, the ride hold (simulation): every supported owner counts as riding for it (a hold never secured gets it). */
  rideHoldUnridden?: boolean;
  /** Polish 1.2, the come-down (simulation): the no-support guard off (no planted foot, contact or hold converts nothing). */
  noRideLoose?: boolean;
  /** Polish 1.4, the bound-legs fall (simulation): the secure-hold test off (an arm touching him or the bodies meeting is a hold). */
  bindAnyTouch?: boolean;
  /** Polish 1.4, the bound-legs fall (simulation): clause (b) counts any swing as stranded (the guard's hold and the step's time not read). */
  bindAnySwing?: boolean;
  /** Polish 1.4, the bound-legs fall (simulation): no forward lean request while a clause's clock runs. */
  bindNoLean?: boolean;
  /** Polish 2.1, the fall link (arms): no break rule (overload, separation, reach); only its target gone ends it. */
  fallLinkNoBreak?: boolean;
  /**
   * The balance reads the pitched trunk, as with no hinge (simulation, support-runtime): the support pivot and the loss
   * envelope in the body's frame, so the trunk's pitch tips him as whole-body lean would.
   */
  trunkBalance?: boolean;
}

/**
 * M3 step 1: hands carried 20 cm ahead of the chest; the cradle opened 0.25 s ahead of contact (or inside 0.5 m), the
 * palms 35 cm ahead of the chest and 12 cm outside the carrier (elbows bent and out); closed on the first valid touch
 * toward the far corner (150 deg, 5 cm in), which draws the forearms along the flanks so the clamps can form. A nearer
 * closing target (the Gate 2 125 deg, 10 cm in) leaves the palm on the flank and the forearm off it (L3-F19-rear: no
 * clamp at all).
 */
export const WRAP_V1: WrapProfile = {
  id: 'wrap-open-v1',
  ready: { forwardM: 0.2, lateralM: 0.2 },
  open: { leadS: 0.25, gapM: 0.5, forwardM: 0.35, marginM: 0.12 },
  closeOnTouch: { slackDeg: 0 },
  close: { azDeg: 150, depthM: 0.05 },
};

/**
 * M3 step 3: WRAP_V1 with the committed finish. Secure for 50 ms (twelve substeps: past a clamp's flicker), then 0.2 s
 * lowering to 0.78 m (11 cm under the standing height at the stance's 0.6 m/s) leaning 12 deg (the balance profile's
 * cap), then down; a hold lost for over 50 ms starts it over.
 */
export const WRAP_V2: WrapProfile = { ...WRAP_V1, id: 'wrap-takedown-v2', commit: { secureS: 0.05, lowerS: 0.2, heightM: 0.78, leanDeg: 12, graceS: 0.05 } };

/**
 * Contact motion M3, the hold through the takedown: WRAP_V2 whose takedown carries the defender's holds onto his ragdoll
 * arms (`commit.hold` FALL_HOLD_V1: FALL_L4's arm tasks at once and stronger, pressing on the carrier, no knee or hip
 * effort), so they keep holding the carrier while he goes down, for as long as solved contact keeps the hold.
 */
export const WRAP_V3: WrapProfile = { ...WRAP_V2, id: 'wrap-hold-v3', commit: { ...WRAP_V2.commit!, hold: FALL_HOLD_V1 } };

/**
 * Contact motion polish 1.1: WRAP_V3 with the strike. On 0.6 s ahead of contact (or inside 0.8 m): 40 deg of trunk
 * pitch (12 of whole-body lean, the balance cap, and 28 of hinge), the hips 8 cm lower, pitch and facing turned 30 deg
 * toward the head's side, his centre steered 15 cm to that side; the palms 30 cm outside the carrier, elbows out and a
 * little up. Values and reasons: docs/handoff/contact-motion-m3.md.
 */
export const WRAP_V4: WrapProfile = {
  ...WRAP_V3,
  id: 'wrap-strike-v4',
  strike: {
    leadS: 0.6,
    gapM: 0.8,
    lostS: 0.3,
    offBearingDeg: 75,
    maxTurnDeg: 30,
    rateHz: 10,
    pitchDeg: 40,
    leanDeg: 0,
    yawDeg: 30,
    dropM: 0.08,
    offsetM: 0.3,
    offsetGainPerS: 6,
    offsetMps: 1.5,
    sideRuleMps: 0.5,
    arms: { forwardM: 0.3, marginM: 0.3, pole: v3(1, 0.3, -0.2) },
    hinge: { maxDeg: 40, rateDegPerS: 120, accelDegPerS2: 600, maxDropM: 0.12, dropRateMps: 0.4 },
  },
};

/**
 * Contact motion polish 1.2: WRAP_V4 with the drive. A hold of one arm with his body on the carrier counts (the rear and
 * drag wraps rarely close both clamps); 3 m/s beyond the carrier's speed (the velocity error that saturates the 1400 N
 * drive over its 0.25 s response), eased out between 12 deg of his own lean (the posture cap) and 25 (the loss); he goes
 * with a carrier leaning past 30 deg; a stall after 0.9 s with the carrier under 15 deg and his lean grown under 2 deg
 * in the last 0.3 s, 1.6 s at most. Values and reasons: docs/handoff/contact-motion-m3.md.
 */
export const WRAP_V5: WrapProfile = { ...WRAP_V4, id: 'wrap-drive-v5', drive: { oneArmBody: true, extraMps: 3, goLeanDeg: 30, stallS: 0.9, progress: { leanDeg: 15, riseDeg: 2, windowS: 0.3 }, maxS: 1.6, ease: { fromDeg: 12, toDeg: 25 } } };

/**
 * Contact motion polish 1.2, the ride-down: WRAP_V5 whose tackler stays on his feet through the takedown. The hinge's
 * bounds open to 85 deg and 0.2 m of drop (the strike asks what it asked: its approach is WRAP_V5's); riding, the trunk
 * follows the carrier to 85 deg and the hips to the stance floor as his lean goes from 15 to 45 deg or his core drops 0.4 m. He
 * converts with his chest 0.5 m off the ground, sinking faster than 1.6 m/s, or the carrier's core within 0.35 m of the
 * ground (the drive 0.3 s old), a stall, 2.5 s, or the hold lost on a carrier off his support. The carrier counts as his
 * support while his legs lean under 45 deg. The come-down arrives (`WrapRideDown.arrive`): the fold leads his pitch by at
 * most 8 deg (1 deg braking) and brakes at 350 deg/s^2 to reach the full fold at 10 deg/s, exit (h) for the fold waits
 * for 50 deg/s, the drive asks for the carrier's velocity (rear, front and drag-mirror wraps: 20-90 deg/s at the switch
 * in place of 180-310, no roll over the carrier).
 */
export const WRAP_V7: WrapProfile = {
  ...WRAP_V5,
  id: 'wrap-ride-v7',
  strike: { ...WRAP_V5.strike!, hinge: { ...WRAP_V5.strike!.hinge, maxDeg: 85, maxDropM: 0.2 } },
  ride: {
    groundM: 0.5,
    sinkMps: 1.6,
    carrierDownM: 0.35,
    minS: 0.3,
    maxS: 2.5,
    pitchDeg: 85,
    dropM: 0.2,
    fromLeanDeg: 15,
    fullLeanDeg: 45,
    fullDropM: 0.4,
    leanDeg: 45,
    hold: { memoryS: 0.2, separationM: 0.15, remapM: 0.05 },
    down: { maxS: 0.4, hinge: { rateDegPerS: 300, accelDegPerS2: 2500, dropRateMps: 1 }, weightForward: true, arrive: { leadDeg: 8, brakeLeadDeg: 1, brakeDegPerS2: 350, endDegPerS: 10, foldedRateDegPerS: 50 } },
  },
};

/**
 * Contact motion polish 1.4, the bound-legs fall: WRAP_V7 whose secure hold binds the carrier's legs (`WrapBind`): held
 * 0.2 s round his hips or legs, or with a foot stranded and no plant while he leans 5 deg or moves at 0.5 m/s, he goes
 * down (a loss of support, 'boundLegs'), his lean request toward his travel at the 12 deg posture cap meanwhile.
 */
export const WRAP_V8: WrapProfile = { ...WRAP_V7, id: 'wrap-bind-v8', bind: { confirmS: 0.2, pushLeanDeg: 5, pushMps: 0.5, leanDeg: 12 } };

/**
 * Contact motion polish 1.4, the low strike of the deep crouch tackle, on WRAP_V8 (the ride-down and the bound-legs fall):
 * the trunk pitched 75 deg on the hinge at his lowest stance (the hinge's drop, 0.2 m, takes the root to the stance
 * floor), on 1.0 s ahead of contact (or inside 1.4 m: the hinge's unchanged rate bounds need about 0.85 s to fold it), so
 * the shoulder meets the carrier's hip; his line steers his head 0.35 m to the carrier's side (the pelvis box's half width
 * and the head's radius: beside the hip, never across his front, at whatever pitch the hinge has reached); the arms round
 * him 5 cm below his root, under his pelvis box, on the support capsule. The hinge's bound is the ride's 85 deg (the strike
 * asks 75; riding, the trunk follows the carrier on to 85). Values and reasons: docs/handoff/contact-motion-m3.md.
 */
export const WRAP_V6: WrapProfile = {
  ...WRAP_V8,
  id: 'wrap-low-bind-v6',
  strike: {
    ...WRAP_V8.strike!,
    leadS: 1.0,
    gapM: 1.4,
    pitchDeg: 75,
    dropM: 0.2,
    offsetM: 0.35,
    hinge: { ...WRAP_V8.strike!.hinge, maxDeg: 85, maxDropM: 0.2 },
  },
  low: { bandYLocal: -0.05, walk: { leadDeg: 30, endDeg: 170, extraM: 0.02 } },
};

/**
 * Contact motion polish 2.1, the fall link: WRAP_V8 whose tackler keeps each forearm clamp he has at his own switch as a
 * breakable link to the carrier (`FallLinkProfile`) through his fall and the landing. No fixture uses it (the lab's
 * `wrap=v9`). The owner budget at full strength (700 N per arm, 1000 N in all, as a supported clamp has); 10 kN/m puts
 * the 700 N ceiling at 7 cm of stretch, the damping (150 N s/m) under the forearm's critical damping at the substep
 * (a few kg behind the point), and a stretch past 25 cm or the patch out of reach lets go. Riding the carrier down at
 * the referee's ending, he keeps the holds he has then to his switch (`throughEnding`): the whistle mostly comes first.
 * The link's end on him is on his forearm or hand, the gap to the patch as slack it takes in (`onArm`). It gives way to
 * the born separation (`bornYield`): while a born pair between the two is not parting it pulls nothing and lets out its
 * slack, so it never holds a limb in the other body, and lives on to hold from the length the separation left.
 */
export const WRAP_V9: WrapProfile = { ...WRAP_V8, id: 'wrap-link-v9', fallLink: { stiffness: 10000, damping: 150, maxSeparationM: 0.25, budgetFraction: 1, remapM: 0.05, throughEnding: true, onArm: true, bornYield: true } };

export interface WrapSpec {
  kind: 'wrapAttempt';
  plan: { left: ArmPlan; right: ArmPlan };
  approachSpeedMps?: number;
  /**
   * Closing-speed gain (1/s) on the remaining body gap: closing = min(gain * gap, approachSpeedMps). The default eases
   * in; a large gain keeps the approach speed until contact (a tackle that runs through). Request only.
   */
  closingGainPerS?: number;
  /**
   * true (default): request the runner's velocity plus the closing speed (pursue and ease in). false: request only the
   * closing speed toward the runner (run at the runner; the relative speed at contact is the closing speed).
   */
  matchRunnerVelocity?: boolean;
  /**
   * Straight-line run: until the first retained arm contact, request this fixed field velocity instead of pursuing
   * (a defender running a committed line through the runner's path). Request only.
   */
  approachVelocityWorld?: Vec3;
  /** Aim at the runner's predicted position (current + velocity x time to close at the approach speed, <= 1 s). */
  interceptLead?: boolean;
  /** Desired surface gap while engaged (negative presses in). */
  contactGapM?: number;
  /** Extra closing speed requested once in contact (drives through the runner). */
  driveInMps?: number;
  /** Lateral offset of the approach aim along the defender's right (m). */
  aimLateralM?: number;
  /** Arms start spreading below this body gap. */
  engageGapM?: number;
  /** Wrap band height in the runner's core frame. */
  bandYLocal?: number;
  marginM?: number;
  spreadAzDeg?: number;
  arcLeadDeg?: number;
  wrapAzDeg?: number;
  closeDepthM?: number;
  stuckS?: number;
  recoverS?: number;
  effort?: number;
  /** Stop all arm work after this time (fixtures that test release behaviour). */
  armsOffAfterS?: number;
  /** Stop pursuing after this time: request zero velocity at `standEffort` (arms keep working). */
  standAfterS?: number;
  standEffort?: number;
  /**
   * Gate 3 supported finish (section 9.1). Requests only, through the same bounded actuators:
   *  - both arms retaining: drive along `dirWorld` (explicit field direction) at `speedMps` while matching the runner's
   *    velocity across it, posture lean toward it;
   *  - one arm retaining: limited lateral reposition toward the free arm's side; the free arm keeps its own reach;
   *  - contact but little progress along `dirWorld`: adjust facing toward `dirWorld`;
   *  - all useful contact lost: pursue again (approach behaviour).
   */
  finish?: { dirWorld: Vec3; speedMps: number; leanDeg?: number; repositionMps?: number; progressWindowS?: number; minProgressMps?: number; adjustDeg?: number };
  /** F9 control: once connected, remove drive and closure requests (locomotion effort 0, arms release). */
  removeAfterConnect?: boolean;
  /** Forward posture lean (deg) toward the runner while approaching/engaged (bounded by the balance profile). */
  approachLeanDeg?: number;
  /** Plan 07a stance request held throughout (root height, stagger; suspension support only). Request only. */
  stance?: StanceRequest;
}

const DEF = {
  approachSpeedMps: 3,
  closingGainPerS: 2.5,
  matchRunnerVelocity: true,
  interceptLead: false,
  contactGapM: 0.0,
  driveInMps: 0.3,
  aimLateralM: 0,
  engageGapM: 0.35,
  bandYLocal: 0.22,
  marginM: 0.09,
  spreadAzDeg: 60,
  arcLeadDeg: 30,
  wrapAzDeg: 115,
  closeDepthM: 0.1,
  stuckS: 0.6,
  recoverS: 0.3,
  effort: 1,
  armsOffAfterS: Infinity,
  standAfterS: Infinity,
  standEffort: 1,
  removeAfterConnect: false,
  approachLeanDeg: 0,
};

interface ArmCtl {
  phase: WrapArmPhase;
  since: number;
  bestAz: number;
  lastProgressT: number;
  lastClampT: number;
}

const SIDES: ArmSide[] = ['left', 'right'];

export class WrapAttemptController implements Controller {
  readonly kind = 'wrapAttempt';
  readonly observationDelayS = 0;
  readonly decisionIntervalS = 0;
  readonly p: Required<Omit<WrapSpec, 'kind' | 'plan' | 'finish' | 'stance'>>;
  private connectedAt: number | null = null;
  private lastContactT = -Infinity;
  private progress: { t: number; along: number }[] = [];
  private finishMode = 'approach';
  private arm: Record<ArmSide, ArmCtl>;
  private near: Vec3 = v3(0, 0, -1);
  private lastFacing: Vec3;
  /** Contact motion M3 (set only when the fixture has one: a state capture's layout stays the one it was taken with). */
  declare private readonly wp?: WrapProfile;
  /** The committed finish's hold clock (set at the first finish decision under a profile with one). */
  declare private tk?: { since: number | null; lastT: number };
  /** Contact motion polish 1.1: the strike's state (set at the first decision under a profile with one). */
  declare private sk?: { on: boolean; w: number; v: number; head: number; hd: Vec3 };
  /** Contact motion polish 1.1 fault switches (set only when given). */
  declare private readonly fault?: WrapDebug;
  /** Contact motion polish 1.2: the drive's start (s; set at the first finish decision under a profile with one). */
  declare private dv?: { at: number | null; holdT: number; leans: { t: number; deg: number }[]; y0?: number; down?: number };

  constructor(
    readonly spec: WrapSpec,
    readonly setup: PlayerSetup,
    readonly motor: MotorProfile,
    profile?: WrapProfile,
    fault?: WrapDebug,
  ) {
    if (profile) this.wp = profile;
    if (fault) this.fault = fault;
    this.p = { ...DEF, ...stripUndef(spec) } as Required<Omit<WrapSpec, 'kind' | 'plan' | 'finish' | 'stance'>>;
    const mk = (s: ArmSide): ArmCtl => ({ phase: spec.plan[s] === 'none' ? 'idle' : spec.plan[s] === 'wrap' ? 'ready' : 'palmReach', since: 0, bestAz: -180, lastProgressT: 0, lastClampT: -1 });
    this.arm = { left: mk('left'), right: mk('right') };
    const y = (setup.initial.yawDeg * Math.PI) / 180;
    this.lastFacing = v3(Math.sin(y), 0, Math.cos(y));
  }

  /** Horizontal support distance of the runner's torso box along world direction d. */
  private support(body: BodyProfile, rq: { x: number; y: number; z: number; w: number }, d: Vec3): number {
    const rx = qRot(rq, v3(1, 0, 0));
    const rz = qRot(rq, v3(0, 0, 1));
    if (body.kind === 'legacyCapsule') return body.legacy.radius;
    const h = body.compound.torso.halfExtents;
    return Math.abs(dot(d, rx)) * h.x + Math.abs(dot(d, rz)) * h.z;
  }

  private stanceReq(): { stance?: StanceRequest } {
    return this.spec.stance ? { stance: { ...this.spec.stance } } : {};
  }

  decide(ctx: ControllerContext): PlayerIntent {
    const P = this.p;
    const me = ctx.observed.bodies[ctx.self];
    const tid = ctx.focus;
    const tb = tid ? ctx.observed.bodies[tid] : undefined;
    if (!me || !tb || !tid) return { locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: this.lastFacing, effort: 1, ...this.stanceReq() } };
    const tBody = ctx.bodies[tid];
    const R = tb.position;
    const nearRaw = horiz(sub(me.position, R));
    if (len(nearRaw) > 1e-3) this.near = norm(nearRaw);
    const near = this.near;
    const side = norm(cross(near, UP));
    const gap = ctx.observed.pairGap[pairKey(ctx.self, tid)] ?? 10;
    // ---------------- locomotion: approach the (optionally offset) runner and keep pressing once engaged
    const vR = horiz(tb.linearVelocity);
    const lead = P.interceptLead ? clamp(len(horiz(sub(R, me.position))) / Math.max(P.approachSpeedMps, 0.5), 0, 1) : 0;
    const aim = addScaled(addScaled(R, vR, lead), side, P.aimLateralM);
    const toAim = horiz(sub(aim, me.position));
    const dir = norm(toAim, scale(near, -1));
    const closing = gap > P.contactGapM ? clamp(P.closingGainPerS * (gap - P.contactGapM), 0, P.approachSpeedMps) : 0;
    const desired = add(P.matchRunnerVelocity ? vR : v3(), scale(dir, closing + (gap < 0.05 ? P.driveInMps : 0)));
    const maxV = this.motor.maximumRequestedSpeedMps;
    const standing = ctx.t >= P.standAfterS;
    const line = this.spec.approachVelocityWorld;
    const want = line && this.connectedAt === null ? horiz(line) : desired;
    let vel = standing ? v3() : len(want) > maxV ? scale(want, maxV / len(want)) : want;
    this.lastFacing = norm(horiz(sub(R, me.position)), this.lastFacing);
    let effortOut = standing ? P.standEffort : P.effort;
    let stanceOut = this.stanceReq();
    let leave = false;
    let driveDebug: { s: number; leanDeg: number; exit: string | null; driving: boolean; chestM?: number; follow?: number; downS?: number } | undefined;
    // polish 1.2, the ride-down: riding (the drive begun under a profile with `ride`), the follow's weight
    let riding = false;
    let follow = 0;
    let posture: PlayerIntent['posture'] = P.approachLeanDeg > 0 ? { leanDirWorld: this.lastFacing, leanRad: (P.approachLeanDeg * Math.PI) / 180 } : undefined;
    // ---------------- connection bookkeeping (observed arm retention or body contact with the runner)
    const armsObs = ctx.observed.arms[ctx.self] ?? {};
    const retaining = SIDES.filter((s) => !!(armsObs[s]?.clampContactId || armsObs[s]?.gripId));
    const bodyContact = (ctx.observed.contacts[ctx.self] ?? []).some((c) => c.other === tid);
    if (retaining.length > 0 || bodyContact) {
      this.lastContactT = ctx.t;
      if (this.connectedAt === null && retaining.length > 0) this.connectedAt = ctx.t;
    }
    const removed = P.removeAfterConnect && this.connectedAt !== null;
    const F = this.spec.finish;
    if (removed) {
      vel = v3();
      effortOut = 0;
      posture = undefined;
      this.finishMode = 'removed';
    } else if (F && this.connectedAt !== null && ctx.observed.bodies[ctx.self].controlMode === 'supported') {
      const fdir = norm(horiz(F.dirWorld), v3(1, 0, 0));
      const along = dot(R, fdir);
      this.progress.push({ t: ctx.t, along });
      const win = F.progressWindowS ?? 0.5;
      while (this.progress.length > 1 && this.progress[0].t < ctx.t - win) this.progress.shift();
      const rate = this.progress.length > 1 ? (along - this.progress[0].along) / Math.max(1e-6, ctx.t - this.progress[0].t) : Infinity;
      const lean = F.leanDeg ? { leanDirWorld: fdir, leanRad: (F.leanDeg * Math.PI) / 180 } : undefined;
      if (retaining.length === 2) {
        // drive along the chosen field direction while matching the runner's motion across it (stay on the runner)
        this.finishMode = 'drive';
        vel = add(sub(vR, scale(fdir, dot(vR, fdir))), scale(fdir, F.speedMps));
        posture = lean;
        if (ctx.t - this.connectedAt > win && rate < (F.minProgressMps ?? 0.3)) {
          // stable contact, little progress: turn the requested facing toward the finish direction (bounded yaw motor)
          this.finishMode = 'adjust';
          const a = ((F.adjustDeg ?? 25) * Math.PI) / 180;
          const toR = this.lastFacing;
          const turn = Math.sign(dot(cross(toR, fdir), UP)) || 1;
          this.lastFacing = norm(add(scale(toR, Math.cos(a)), scale(cross(UP, toR), turn * Math.sin(a))), toR);
        }
      } else if (retaining.length === 1) {
        // limited lateral reposition toward the free arm's side, keeping pace with the runner
        this.finishMode = 'reposition';
        const free: ArmSide = retaining[0] === 'left' ? 'right' : 'left';
        vel = add(horiz(tb.linearVelocity), scale(side, sideSignX(this.setup.body, free) * -(F.repositionMps ?? 0.8)));
        posture = lean;
      } else if (ctx.t - this.lastContactT > 0.3) {
        this.finishMode = 'recover';
      } else this.finishMode = 'contact';
      const C = this.wp?.commit;
      const DV = this.wp?.drive;
      const RD = this.wp?.ride;
      if (C && DV) {
        // polish 1.2, the drive: a hold keeps him on his feet driving through the carrier until a reason to leave them
        const tk = (this.tk ??= { since: null, lastT: -Infinity });
        const dv = (this.dv ??= { at: null, holdT: -Infinity, leans: [] });
        const onTarget = retaining.filter((s) => armsObs[s]?.touchingTarget === tid).length;
        const secure = onTarget === 2 || (DV.oneArmBody && onTarget === 1 && bodyContact);
        if (secure) {
          tk.lastT = ctx.t;
          tk.since ??= ctx.t;
        } else if (tk.since !== null && ctx.t - tk.lastT > C.graceS) tk.since = null;
        // the drive, once begun, lasts while an arm still holds him (its clock with it)
        const DN = RD?.down;
        // (the come-down arriving: with the carrier off his support the drive asks for the carrier's velocity, no more)
        const AR = DN?.arrive;
        const extraMps = AR && tb.controlMode !== 'supported' ? 0 : DV.extraMps;
        if (onTarget > 0) dv.holdT = ctx.t;
        else if (DN && dv.at !== null && ctx.t - dv.holdT > C.graceS && tb.controlMode !== 'supported') {
          // (the come-down: the hold lost with the carrier off his support begins it; he goes on down after him)
          dv.down ??= ctx.t;
        } else if (dv.at !== null && ctx.t - dv.holdT > C.graceS) {
          // (the ride-down: the hold lost with the carrier off his support, exit (l): he goes down after him)
          if (RD && tb.controlMode !== 'supported') {
            this.finishMode = 'takedown';
            leave = true;
            driveDebug = { s: ctx.t - dv.at, leanDeg: ((ctx.observed.balance[tid]?.leanAngleRad ?? 0) * 180) / Math.PI, exit: 'l', driving: false };
          }
          dv.at = null;
          dv.leans = [];
          if (RD) dv.y0 = undefined;
        }
        const held = tk.since !== null && ctx.t - tk.lastT <= C.graceS;
        const carrierDown = tb.controlMode !== 'supported';
        if (held && (carrierDown || ctx.t - tk.since! >= C.secureS - 1e-9)) {
          dv.at ??= ctx.t;
          if (RD) dv.y0 ??= R.y;
          this.finishMode = 'drive+';
          const d = norm(horiz(sub(R, me.position)), this.lastFacing);
          // (he eases the push as his own lean nears the loss; riding, never: the carrier he holds is his support)
          const own = ((ctx.observed.balance[ctx.self]?.leanAngleRad ?? 0) * 180) / Math.PI;
          const ease = RD ? 1 : clamp((DV.ease.toDeg - own) / (DV.ease.toDeg - DV.ease.fromDeg), 0, 1);
          vel = addScaled(vR, d, this.fault?.driveLimp ? 0 : extraMps * ease);
          effortOut = this.fault?.driveLimp ? 0 : 1;
          posture = { leanDirWorld: d, leanRad: 0 };
        }
        // the come-down begins with the carrier's core on the ground or the referee's ending (or the hold lost, above)
        if (DN && dv.at !== null && ((carrierDown && R.y <= RD!.carrierDownM) || ctx.ended)) dv.down ??= ctx.t;
        if (DN && dv.at !== null && dv.down !== undefined) {
          // the come-down: the drive goes on toward the carrier's core, held or not (his weight is committed to him)
          this.finishMode = 'down';
          const d = norm(horiz(sub(R, me.position)), this.lastFacing);
          vel = addScaled(vR, d, this.fault?.driveLimp ? 0 : extraMps);
          effortOut = this.fault?.driveLimp ? 0 : 1;
          posture = { leanDirWorld: d, leanRad: 0 };
        }
        if (dv.at !== null) {
          // the exits: (a) the carrier is down, (b) going over, with an arm still holding him; (d) a stall, while the hold
          // drives; (c), his own loss, is the simulation's
          const leanDeg = ((ctx.observed.balance[tid]?.leanAngleRad ?? 0) * 180) / Math.PI;
          const s = ctx.t - dv.at;
          const Q = DV.progress;
          dv.leans.push({ t: ctx.t, deg: leanDeg });
          while (dv.leans.length > 1 && dv.leans[1]!.t <= ctx.t - Q.windowS + 1e-9) dv.leans.shift();
          const going = leanDeg >= Q.leanDeg || leanDeg - dv.leans[0]!.deg >= Q.riseDeg;
          const goes = onTarget > 0 && !this.fault?.noFollow;
          let exit: string | null;
          if (RD) {
            // the ride-down: no exit for the carrier going over; (h) his chest near the ground, (s) sinking faster than a
            // supported crouch can, (g) the carrier's core on the ground, (d) the stall or the ride's limit
            const chestM = lowestY(ctx.bodies[ctx.self], me.position, me.rotation);
            const guard = !this.fault?.noRideGuard;
            const coreDown = goes && carrierDown && R.y <= RD.carrierDownM && s >= RD.minS - 1e-9;
            // (the come-down: (g) begins it, (d) gives way to its own bound (t))
            // (and with the come-down, (f) his support gone: the suspension's probe finds no ground under him, he is on the
            // carrier or off his feet; a posed body without it would fall stiff)
            // (with the come-down, (h) too once his body has pitched to the full fold: past it he is falling, not folding)
            // (arriving, only once his pitch rate has fallen: a body pitching fast at the switch rolls over the carrier)
            const pitchRate = (dot(me.angularVelocity, hingeAxis(me.rotation)) * 180) / Math.PI;
            const folded = !!DN && (Math.acos(clamp(upOf(me.rotation).y, -1, 1)) * 180) / Math.PI >= RD.pitchDeg - 1e-9 && (!AR || Math.abs(pitchRate) <= AR.foldedRateDegPerS);
            const lowOrFast = guard && (chestM <= RD.groundM || folded) ? 'h' : guard && -me.linearVelocity.y >= RD.sinkMps ? 's' : guard && DN && dv.down !== undefined && !me.grounded ? 'f' : null;
            exit = lowOrFast ?? (DN && dv.down !== undefined ? (ctx.t - dv.down >= DN.maxS - 1e-9 ? 't' : null) : DN ? null : coreDown ? 'g' : null);
            if (!exit && dv.down === undefined) exit = held && !this.fault?.noStall && ((s >= DV.stallS - 1e-9 && !going) || s >= RD.maxS - 1e-9) ? 'd' : null;
            // (the come-down's request: the full fold once the carrier is off his support)
            follow = DN && carrierDown ? 1 : clamp(Math.max((leanDeg - RD.fromLeanDeg) / (RD.fullLeanDeg - RD.fromLeanDeg), ((dv.y0 ?? R.y) - R.y) / RD.fullDropM), 0, 1);
            riding = !exit;
            driveDebug = { s, leanDeg, exit, driving: this.finishMode === 'drive+', chestM, follow, ...(dv.down !== undefined ? { downS: ctx.t - dv.down } : {}) };
          } else {
            exit = goes && carrierDown ? 'a' : goes && leanDeg >= DV.goLeanDeg ? 'b' : held && !this.fault?.noStall && ((s >= DV.stallS - 1e-9 && !going) || s >= DV.maxS - 1e-9) ? 'd' : null;
            driveDebug = { s, leanDeg, exit, driving: this.finishMode === 'drive+' };
          }
          if (exit) {
            this.finishMode = 'takedown';
            leave = true;
          }
        }
      } else if (C) {
        // the committed finish: a secure hold lowers and leans him in, then takes him down with the carrier
        const tk = (this.tk ??= { since: null, lastT: -Infinity });
        const secure = retaining.length === 2 && retaining.every((s) => armsObs[s]?.touchingTarget === tid);
        if (secure) {
          tk.lastT = ctx.t;
          tk.since ??= ctx.t;
        } else if (tk.since !== null && ctx.t - tk.lastT > C.graceS) tk.since = null;
        const held = tk.since !== null && ctx.t - tk.lastT <= C.graceS;
        const carrierDown = tb.controlMode !== 'supported';
        if (held && (carrierDown || ctx.t - tk.since! >= C.secureS - 1e-9)) {
          this.finishMode = 'lower';
          stanceOut = { stance: { ...this.spec.stance, heightM: C.heightM } };
          posture = { leanDirWorld: fdir, leanRad: (Math.max(C.leanDeg, F.leanDeg ?? 0) * Math.PI) / 180 };
          if (carrierDown || ctx.t - tk.since! >= C.secureS + C.lowerS - 1e-9) {
            this.finishMode = 'takedown';
            leave = true;
          }
        }
      }
      if (len(vel) > maxV) vel = scale(vel, maxV / len(vel));
    } else this.finishMode = this.connectedAt === null ? 'approach' : 'engaged';
    // ---------------- contact motion polish 1.1: the strike (lower, pitch in, shoulder leading, head to the side)
    const SK = this.wp?.strike;
    const toCarrier = norm(horiz(sub(R, me.position)), this.lastFacing);
    const closingNow = dot(sub(horiz(me.linearVelocity), vR), toCarrier);
    const ttcNow = closingNow > 1e-3 ? gap / closingNow : Infinity;
    let sk: { on: boolean; w: number; v: number; head: number; hd: Vec3 } | undefined;
    if (SK && !removed) {
      sk = this.sk ??= { on: false, w: 0, v: 0, head: 0, hd: v3() };
      const supported = me.controlMode === 'supported';
      const near2 = ttcNow <= SK.leadS || gap < SK.gapM;
      const engaged = ctx.t - this.lastContactT <= SK.lostS;
      // the carrier's bearing off his facing: one going by beside or behind him ends the strike (a miss)
      const myFwd = norm(horiz(qRot(me.rotation, v3(0, 0, 1))), toCarrier);
      const bearing = (Math.acos(clamp(dot(myFwd, toCarrier), -1, 1)) * 180) / Math.PI;
      // the head's side (world, across the approach): behind the carrier's motion across it, never across his front;
      // without such motion the side he is on, else his left (`side`, his local +X). Decided as the strike starts; motion
      // that develops before the bodies meet moves it behind
      const vl = dot(sub(vR, horiz(me.linearVelocity)), side);
      const behind = (this.fault?.headAcross ? 1 : -1) * Math.sign(vl);
      if (!sk.on && supported && near2) {
        sk.on = true;
        const off = dot(sub(me.position, R), side);
        sk.head = Math.abs(vl) > SK.sideRuleMps ? behind : Math.abs(off) > 0.05 ? Math.sign(off) : 1;
        sk.hd = scale(side, sk.head);
      } else if (sk.on && this.connectedAt === null && !engaged && Math.abs(vl) > SK.sideRuleMps && Math.sign(dot(sk.hd, side)) !== behind) {
        sk.head = behind;
        sk.hd = scale(side, sk.head);
      } else if (sk.on && !this.fault?.strikeHeld && (!supported || (tb.controlMode !== 'supported' && retaining.length === 0) || (!engaged && ((ttcNow > 2 * SK.leadS && gap >= SK.gapM) || bearing > SK.offBearingDeg)))) sk.on = false;
      const k = SK.rateHz;
      sk.v += (k * k * ((sk.on ? 1 : 0) - sk.w) - 2 * k * sk.v) * ctx.dt;
      sk.w = clamp(sk.w + sk.v * ctx.dt, 0, 1);
      if (sk.w <= 1e-3 && !sk.on) {
        sk.w = 0;
        sk.v = 0;
      }
      if (sk.w > 0) {
        const w = sk.w;
        // the head's side as decided (world): the facing turns toward it, the line steers to it
        const hd = sk.hd;
        const turn = (d: Vec3, deg: number): Vec3 => {
          const across = horiz(sub(hd, scale(d, dot(hd, d))));
          if (len(across) < 1e-3) return d;
          const a = (deg * w * Math.PI) / 180;
          return norm(add(scale(d, Math.cos(a)), scale(norm(across), Math.sin(a))), d);
        };
        // the legs' lean blends to the strike's (the balance holds it), the hinge pitches the trunk the rest of the way
        const base = posture ?? { leanDirWorld: toCarrier, leanRad: 0 };
        posture = {
          // (unwinding after a miss, toward his own travel, as he faces)
          leanDirWorld: sk.on ? base.leanDirWorld : norm(horiz(me.linearVelocity), myFwd),
          leanRad: base.leanRad + ((SK.leanDeg * Math.PI) / 180 - base.leanRad) * w,
          hinge: { rad: (Math.max(0, SK.pitchDeg - SK.leanDeg) * w * Math.PI) / 180, dropM: SK.dropM * w },
        };
        // on: the carrier, turned toward the head's side; unwinding after a miss: his own travel (no spin while pitched)
        // (the turn only before the bodies meet: pressed into the carrier, a twist of the pitched trunk would roll him)
        this.lastFacing = !sk.on ? norm(horiz(me.linearVelocity), myFwd) : this.connectedAt === null && !engaged ? turn(this.lastFacing, SK.yawDeg) : this.lastFacing;
        // a pitched trunk cannot spin: the facing asked for stays within `maxTurnDeg` of the body's (bounds the yaw rate)
        const off = Math.acos(clamp(dot(myFwd, this.lastFacing), -1, 1));
        const lim = (SK.maxTurnDeg * Math.PI) / 180;
        if (off > lim) {
          const across = horiz(sub(this.lastFacing, scale(myFwd, dot(this.lastFacing, myFwd))));
          if (len(across) > 1e-6) this.lastFacing = norm(add(scale(myFwd, Math.cos(lim)), scale(norm(across), Math.sin(lim))), myFwd);
        }
        if (this.connectedAt === null && !standing) {
          // steer the line so his centre (polish 1.4, the low strike: his head) passes `offsetM` to the head's side of the
          // carrier's
          const pt = this.wp?.low ? add(me.position, qRot(me.rotation, ctx.bodies[ctx.self].compound.head.center)) : me.position;
          const e = dot(sub(addScaled(R, hd, SK.offsetM), pt), hd);
          vel = addScaled(vel, hd, w * clamp(SK.offsetGainPerS * e, -SK.offsetMps, SK.offsetMps));
          if (len(vel) > maxV) vel = scale(vel, maxV / len(vel));
        }
      }
    }
    // ---------------- polish 1.2, the ride-down: the trunk follows the carrier down on the hinge, the hips sink
    const RDp = this.wp?.ride;
    if (riding && RDp && SK) {
      const base = SK.pitchDeg - SK.leanDeg;
      posture = {
        leanDirWorld: posture?.leanDirWorld ?? toCarrier,
        leanRad: posture?.leanRad ?? 0,
        hinge: { rad: ((base + (RDp.pitchDeg - base) * follow) * Math.PI) / 180, dropM: SK.dropM + (RDp.dropM - SK.dropM) * follow },
      };
    }
    // ---------------- arms
    const arms: Partial<Record<ArmSide, ArmIntent>> = {};
    // polish 1.4: the low strike's band, and the carrier's shape there (absent: his torso box at the spec's band)
    const LOW = this.wp?.low;
    const band = R.y + (LOW ? LOW.bandYLocal : P.bandYLocal);
    const shape = (d: Vec3): number => (LOW ? shapeAt(tBody, tb.rotation, d, LOW.bandYLocal) : this.support(tBody, tb.rotation, d));
    const myArms = ctx.observed.arms[ctx.self] ?? {};
    const azOf = (pt: Vec3, sgn: number): number => {
      const r = horiz(sub(pt, R));
      return (Math.atan2(sgn * dot(r, side), dot(r, near)) * 180) / Math.PI;
    };
    const ring = (azDeg: number, sgn: number, extra: number): Vec3 => {
      const a = (azDeg * Math.PI) / 180;
      const d = norm(add(scale(near, Math.cos(a)), scale(side, sgn * Math.sin(a))));
      const r = shape(d) + extra;
      return v3(R.x + d.x * r, band, R.z + d.z * r);
    };
    const debugArms: Record<string, unknown> = {};
    // contact motion M3: the defender's chest and the carrier's torso across the approach (`near` points from the
    // carrier to him: the carrier is on his forward line)
    const W = this.wp;
    const fwd = scale(near, -1);
    // (polish 1.4: under the low strike, his shoulders' line along the approach where it is further ahead)
    const shoulders = LOW && myArms.left && myArms.right ? dot(sub(scale(add(myArms.left.shoulderWorld, myArms.right.shoulderWorld), 0.5), me.position), fwd) : -Infinity;
    const chest = W ? addScaled(me.position, fwd, Math.max(this.support(ctx.bodies[ctx.self], me.rotation, fwd), shoulders)) : me.position;
    const halfW = W ? shape(side) : 0;
    const cornerDeg = W ? (Math.atan2(halfW, shape(near)) * 180) / Math.PI : 0;
    const closingMps = dot(sub(horiz(me.linearVelocity), vR), fwd);
    const ttc = closingMps > 1e-3 ? gap / closingMps : Infinity;
    const carriage = (forwardM: number, lateral: number, sgn: number): Vec3 => {
      const p = addScaled(addScaled(chest, fwd, forwardM), side, sgn * lateral);
      return v3(p.x, band, p.z);
    };
    for (const s of SIDES) {
      const plan = this.spec.plan[s];
      const st = this.arm[s];
      const ob = myArms[s];
      if (plan === 'none' || !ob) continue;
      // `side` is the defender's local +X (cross(near, UP) with the defender facing the runner): the arm's sign on it
      const sgn = sideSignX(this.setup.body, s);
      const az = azOf(ob.palmContactWorld, sgn);
      const t = ctx.t;
      const go = (ph: WrapArmPhase): void => {
        st.phase = ph;
        st.since = t;
        st.bestAz = az;
        st.lastProgressT = t;
      };
      if (az > st.bestAz + 3) {
        st.bestAz = az;
        st.lastProgressT = t;
      }
      if (ob.clampContactId) st.lastClampT = t;
      if (t >= P.armsOffAfterS || removed) {
        arms[s] = { action: 'release', targetWorld: ob.palmContactWorld };
        debugArms[s] = { phase: 'off', az };
        continue;
      }
      let action: ArmIntent['action'] = 'reach';
      let target: Vec3;
      let pole: Vec3 | undefined;
      if (plan === 'palmFlank') {
        const flank = addScaled(addScaled(R, near, shape(near) - 0.07), side, sgn * 0.1);
        target = v3(flank.x, band, flank.z);
        if (st.phase === 'palmReach' && gap < P.engageGapM && t - st.since > 0.2) go('palmClose');
        if (st.phase === 'palmClose' && ob.gripId && t - st.since > 0.2) go('palmPull');
        if (st.phase === 'palmPull' && !ob.gripId) go('palmReach');
        action = st.phase === 'palmReach' ? 'reach' : st.phase === 'palmClose' ? 'close' : 'pull';
      } else {
        const touchClose = !!W?.closeOnTouch && az >= cornerDeg - W.closeOnTouch.slackDeg && (ob.touchingTarget === tid || (bodyContact && gap <= 0.02));
        switch (st.phase) {
          case 'ready':
            if (W) {
              target = carriage(W.ready.forwardM, W.ready.lateralM, sgn);
              if (ttc <= W.open.leadS || gap < W.open.gapM || sk?.on) go('open');
              break;
            }
            target = addScaled(ring(0, sgn, 0.12), side, sgn * 0.18);
            if (gap < P.engageGapM) go('spread');
            break;
          case 'open':
            // the cradle: wide of the carrier, ahead of the chest; the carrier's torso arrives between the hands
            if (sk && sk.w > 0 && SK) {
              // polish 1.1: the strike's wide arms, blended in by its weight, the elbows out from the shoulders
              const w = sk.w;
              target = carriage(W!.open.forwardM + (SK.arms.forwardM - W!.open.forwardM) * w, halfW + W!.open.marginM + (SK.arms.marginM - W!.open.marginM) * w, sgn);
              const sx = Math.sign(sgn) || 1;
              if (!this.fault?.noPole) pole = add(scale(v3(sx, -0.6, -0.4), 1 - w), scale(v3(sx * SK.arms.pole.x, SK.arms.pole.y, SK.arms.pole.z), w));
            } else target = carriage(W!.open.forwardM, halfW + W!.open.marginM, sgn);
            if (touchClose || az >= P.wrapAzDeg - 25) go('close');
            else if (gap <= 0.02 && t - st.since > 0.1) go('arc');
            else if (ttc > 2 * W!.open.leadS && gap > 2 * W!.open.gapM && !sk?.on) go('ready');
            break;
          case 'spread':
            target = ring(P.spreadAzDeg, sgn, P.marginM + 0.06);
            if (az >= P.spreadAzDeg - 10 || len(sub(ob.palmContactWorld, target)) < 0.08 || t - st.lastProgressT > P.stuckS) go('arc');
            break;
          case 'arc':
            target = ring(Math.min(P.wrapAzDeg, Math.max(az, P.spreadAzDeg - 10) + P.arcLeadDeg), sgn, P.marginM);
            if (az >= P.wrapAzDeg - 25 || ob.touchingTarget === tid && az >= 70 || touchClose) go('close');
            else if (t - st.lastProgressT > P.stuckS) go('recover');
            break;
          case 'close':
            // (polish 1.4, the walk: ahead of the palm round the carrier's shape)
            target = LOW?.walk ? ring(walkAzDeg(LOW.walk, az, cornerDeg), sgn, LOW.walk.extraM) : W?.close ? ring(W.close.azDeg, sgn, -W.close.depthM) : ring(P.wrapAzDeg + 10, sgn, -P.closeDepthM);
            action = 'close';
            if (ob.clampContactId || ob.gripId) go('sustain');
            else if (t - st.since > P.stuckS) go('arc');
            break;
          case 'sustain':
            target = LOW?.walk ? ring(walkAzDeg(LOW.walk, az, cornerDeg), sgn, LOW.walk.extraM) : W?.close ? ring(W.close.azDeg, sgn, -W.close.depthM) : ring(P.wrapAzDeg + 10, sgn, -P.closeDepthM);
            action = 'close';
            if (!ob.clampContactId && !ob.gripId && t - st.lastClampT > 0.15) go(az < 50 ? 'arc' : 'close');
            break;
          case 'recover':
            target = ring(20, sgn, 0.2);
            if (t - st.since > P.recoverS) go(W ? 'open' : 'spread');
            break;
          default:
            target = ob.palmContactWorld;
        }
      }
      arms[s] = pole ? { action, targetWorld: target, poleLocal: pole } : { action, targetWorld: target };
      debugArms[s] = { phase: st.phase, az: Math.round(az), target };
    }
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: this.lastFacing, effort: effortOut, ...stanceOut },
      arms,
      posture,
      ...(leave ? { leaveSupport: 'takedown' as const } : {}),
      ...(riding ? { ride: true as const } : {}),
      debug: { phase: `${this.finishMode} L:${this.arm.left.phase} R:${this.arm.right.phase}`, finish: this.finishMode, arms: debugArms, gap, near, side, readyHands: true, ...(sk ? { strike: { on: sk.on, w: sk.w, head: sk.head } } : {}), ...(driveDebug ? { drive: driveDebug } : {}) },
    };
  }

  exportParams(): unknown {
    return { ...this.spec, resolved: this.p };
  }
}

/**
 * Polish 1.2, the ride-down: the height (world y; the field is the plane y = 0) of the lowest corner of a body's torso
 * box at the proxy pose (`p`, `q`): his chest, pitched forward.
 */
export function lowestY(body: BodyProfile, p: Vec3, q: { x: number; y: number; z: number; w: number }): number {
  if (body.kind === 'legacyCapsule') return p.y - body.legacy.halfHeight;
  const t = body.compound.torso;
  let lo = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) lo = Math.min(lo, p.y + qRot(q, v3(t.center.x + sx * t.halfExtents.x, t.center.y + sy * t.halfExtents.y, t.center.z + sz * t.halfExtents.z)).y);
  return lo;
}

function stripUndef<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined && k !== 'kind' && k !== 'plan' && k !== 'finish' && k !== 'stance') r[k] = o[k];
  return r;
}
