// Plan 07: persistent per-foot plant / swing state and a small step planner. Pose only: it reads the solved core, the
// solved travel, the support probe and control mode, and the clip playback; it writes foot requests for the existing
// leg solve (pose.ts buildProxyPose) and its own diagnostics. It never changes grounded state, drive, yaw or balance
// torque, friction, support force or completion rules, and never moves the root.
//
// Touchdown is a proposal (plan 07 review): a proposed plant is `tentative` while the leg solve of its substep runs
// with the plant request. `observeFeet` confirms it from the achieved pose only (primary candidate, no reach clamp
// beyond plantTolM, contact-feature error within plantTolM); only then is it a plant and `footPlant` is emitted. A
// failed proposal continues from the achieved foot with a `footPlantFailed` record (reason, errors), never a
// touchdown/liftoff pair, and the next proposal needs a fresh (non-plant) solve and a reachable anchor from the current
// hip. A confirmed plant that survives a later solve is a sustained interval.
//
// Per foot, one of:
// - planted: a world anchor of the contact feature (heel point = the sole point below the ankle, the planted heading and
//   the roll fraction along the sole, 0 heel .. 1 toe). Valid while the achieved feature stays on its anchor: its
//   horizontal error and the shoe's contact gap (lowest shoe-box corner above the ground) combine to at most plantTolM.
//   A shoe pivoting on its toe or edge (ankle pitch at its range, a tilted shin; the shoe is rigid on the shin) stays
//   planted while the touching sole neither slides nor separates. Released with a reason otherwise: a soft-reach clamp,
//   a clearance alternative, separation or sliding; no clamped target is reported as planted.
// - swing: either a planner step (bounded trajectory from the current target to a destination that is retargeted every
//   substep without restarting) or `follow`: the clip / procedural request plus an offset from where the foot was,
//   decaying at a bounded rate (a released foot rejoining the clip swing, never a jump).
// - airborne: no support (probe invalid, falling) or a ragdoll: no anchors, no new plants.
//
// Regimes: with clip weight > 0 the clip's stance annotations schedule plants (touchdown inside the clip stance
// interval once the clip contact is made and the shoe is on the ground; liftoff at the interval's end). With no clip
// weight and support, reactive steps: a planted foot steps when its anchor is far from its home under the hip (actual
// travel), when the body has yawed away from it, or when its reach is nearly used; one foot at a time unless the geometry
// releases both. A still body takes at most one settle step per foot (no marching).
import type { ArmSide } from './contracts';
import type { RagdollProfile } from './profiles';
import { plantReachM, type FootRequest, type PhysicalPose, footFrame } from './pose';
import { add, addScaled, clamp, dist, dot, headingOf, len, norm, qRot, rad, round, sub, v3, type Pose, type Vec3 } from './vec';

export interface FootworkProfile {
  id: string;
  /** A valid plant keeps its contact feature within this of the anchor (error and drift, m). */
  plantTolM: number;
  /** Reactive steps: a planted foot steps when its anchor is this far (horizontal, m) from its home. */
  stepTriggerM: number;
  /** A still body (speed below settleSpeedMps) takes one settle step per foot farther than settleTriggerM from home. */
  settleTriggerM: number;
  settleSpeedMps: number;
  /** A planted foot steps when the body has yawed this far from its heading (deg); released beyond yawReleaseDeg. */
  yawTriggerDeg: number;
  yawReleaseDeg: number;
  /** Step when the planted leg's hip-ankle distance is within this of the plant reach limit (m). */
  reachMarginM: number;
  /**
   * Planner swing: duration bounds (s); horizontal target speed cap maxSpeedMps + travelSpeedK x the actual travel speed
   * (m/s: a foot that keeps up with a moving body swings at about twice its speed); clearance at mid swing (m, scaled
   * down for short steps); vertical target speed cap (m/s); destination lead along the actual travel (s); foot heading
   * rate (deg/s).
   */
  swing: { minS: number; maxS: number; maxSpeedMps: number; travelSpeedK: number; clearanceM: number; maxLiftRateMps: number; leadS: number; maxYawRateDegPerS: number };
  /** Lateral ankle separation (body frame, m) a destination keeps from the other foot: legs never cross. */
  minSeparationM: number;
  /** Largest horizontal distance of a destination from the predicted hip (m); the reach at the stance height bounds it too. */
  maxStepFromHipM: number;
  /** A released foot's offset to the request it rejoins decays at this speed (m/s). */
  rejoinMps: number;
  /** Clip regime: a clip stance foot plants once the clip contact weight reaches this and the shoe is on the ground. */
  clipPlantWeight: number;
  /**
   * Sideways travel leads with the travel-side foot when the lateral travel speed (body frame) is at least
   * leadLateralMps and at least leadLateralFrac of the travel speed.
   */
  leadLateralMps: number;
  leadLateralFrac: number;
}

export const FOOTWORK_L2: FootworkProfile = {
  id: 'footwork-l2-v2',
  plantTolM: 0.01,
  stepTriggerM: 0.14,
  settleTriggerM: 0.06,
  settleSpeedMps: 0.15,
  yawTriggerDeg: 30,
  yawReleaseDeg: 55,
  reachMarginM: 0.02,
  swing: { minS: 0.2, maxS: 0.34, maxSpeedMps: 3.5, travelSpeedK: 2.5, clearanceM: 0.07, maxLiftRateMps: 1.5, leadS: 0.12, maxYawRateDegPerS: 360 },
  minSeparationM: 0.14,
  maxStepFromHipM: 0.3,
  rejoinMps: 1.5,
  clipPlantWeight: 0.95,
  leadLateralMps: 0.2,
  leadLateralFrac: 0.5,
};

export type FootMode = 'planted' | 'swing' | 'airborne';
/** Why a plant ended or a foot changed mode (traced and emitted). */
export type FootReason =
  | 'step'
  | 'settle'
  | 'yaw'
  | 'reach'
  | 'clearance'
  | 'separation'
  | 'slide'
  | 'liftoff'
  | 'clipSwing'
  | 'continue'
  | 'supportLost'
  | 'falling'
  | 'ragdoll';

export interface FootState {
  mode: FootMode;
  /** Planted, proposed this substep (or at initialization) and not yet confirmed by an achieved solve. */
  tentative: boolean;
  /** Solves the confirmed plant has survived after its confirmation (0: confirmed in the last solve). */
  solves: number;
  /** The last observed solve was a failed proposal: no new proposal until a fresh (non-plant) solve is observed. */
  stale: boolean;
  /** Clip or reactive stance eligibility of this substep (coverage): see FootPlan.stats.cover. */
  eligible: boolean;
  /** Last failed proposal: reason and time; proposals and failures of this foot. */
  failReason: FootReason | null;
  failAtS: number;
  attempts: number;
  fails: number;
  /** Swing source: a planner step trajectory, or following the clip / procedural request with a decaying offset. */
  source: 'step' | 'follow';
  /** Planted: heel point (sole point below the ankle) on the ground, heading (rad) and roll fraction; sole length toeZ. */
  heelW: Vec3 | null;
  headingRad: number;
  rollF: number;
  toeZ: number;
  /** Lateral sole offset (shoe frame x, m) of a corner pivot (pose: the shoe rolled onto a sole corner); 0 on the centre line. */
  edgeX: number;
  /** World anchor of the contact feature at the plant (drift reference) and the time it was planted. */
  anchorW: Vec3 | null;
  plantedAtS: number;
  /** Ankle target of the last request (world) and the request before it (speed). */
  target: Vec3;
  /** Planner step: destination (ankle, world), its heading, elapsed and duration (s), start distance (m). */
  dest: Vec3 | null;
  destHeadingRad: number;
  elapsedS: number;
  durS: number;
  stepM: number;
  why: FootReason | null;
  /** Follow: offset of the foot from the request it rejoins (world). */
  offset: Vec3;
  /** Settle step taken since the body became still (cleared when it moves). */
  settled: boolean;
  /** The current step drags along the turf (no clearance): a reach release while the other foot is in the air. */
  drag: boolean;
  /** Clip swing progress of the last clip-regime substep (null in clip stance or outside the clip regime). */
  clipSwingP: number | null;
  /**
   * Reactive regime, a free foot carried over the clip-to-procedural crossing (or one whose touchdown proposal after the
   * crossing failed) waiting for its turn: it plants where it is when it is on the ground, a fresh solve and reachable
   * with the reach margin; else its target is held where it was (not a plant: no anchor, no plant request; the leg
   * reaches it or not, measured) until it may take an ordinary step (one at a time: no step in progress and the other
   * foot held).
   */
  wait: boolean;
  /**
   * A swing inherited at the crossing continues as a planner step from its clip swing progress p0 (no restart); the
   * height it had above the step arc at p0 (m, signed) fades out over the rest of the step.
   */
  p0: number;
  liftExcessM: number;
  /** The step was retimed to a stance window (fitStance): at its end it touches down where it is when reachable. */
  short: boolean;
  /**
   * Carried over the clip-to-procedural crossing: a confirmed clip plant (held while its achieved solve keeps it, the
   * contact-feature check in observeFeet, not released by the flat-heel reach estimate of reactive plants: a rolled clip
   * contact reaches further than its heel point suggests; cleared when released), or a free foot and its continued swing
   * (cleared by its first confirmed plant or ordinary step).
   */
  inherited: boolean;
  /** A confirmed plant its solve released (observeFeet): the next reactive plan steps it at once (a drag if the other foot is not planted). */
  released: boolean;
  /** Last release / mode change reason and time. */
  releaseReason: FootReason | null;
  releaseAtS: number;
  /**
   * Diagnostics of the last pose: contact-feature error to the anchor (horizontal error and contact gap combined), its
   * parts, drift since the plant (max error), IK residual, commanded target speeds (planner steps: the swing target;
   * following: the offset decay) and the follow target's speed (clip / procedural request motion, not commanded here).
   */
  featureErrM: number;
  featureHzM: number;
  gapM: number;
  driftM: number;
  residualM: number;
  speedMps: number;
  liftRateMps: number;
  followMps: number;
  /** Achieved ankle, shoe frame and contact feature (world) of the last pose. */
  ankleW: Vec3;
  footQ: { x: number; y: number; z: number; w: number };
  featureW: Vec3;
  /** Set when a plant was released after the pose: the next plan rejoins from the achieved ankle. */
  rejoin: boolean;
}

export interface FootPlan {
  profile: FootworkProfile;
  /** Shoe box (ragdoll profile): half extents and centre offset from the ankle in the shoe frame (contact gap). */
  shoe: { he: Vec3; centerFoot: Vec3 };
  feet: Record<ArmSide, FootState>;
  /** Plant reach limit (hip-ankle request distance whose soft-reach clamp stays within plantTolM), m. */
  reachM: number;
  /** Side last stepped (alternation). */
  lastStep: ArmSide | null;
  /** The last supported substep was in the clip regime (the next reactive substep is a clip-to-procedural crossing). */
  clipLast: boolean;
  initialized: boolean;
  /** Substep of the last plan (s): coverage accumulation in observeFeet. */
  dtS: number;
  /**
   * Running extremes and counts over every substep since reset (evidence): smallest margin of a planner step's
   * horizontal target speed below its cap (m/s; negative = over), largest step lift rate and follow-offset decay rate
   * (m/s), largest confirmed-plant contact-feature error (m) over samples that kept the plant (the sample that releases
   * it is in its footRelease event). Touchdown proposals, confirmed plants, failed proposals and the largest failed
   * proposal error (m, measured ones only), sustained intervals (confirmed plants that survived a later solve). Per foot
   * coverage: eligible stance time (clip regime: inside the clip stance interval at the plant contact weight; reactive:
   * supported and not in a planner step) and the part of it confirmed planted (s).
   */
  stats: {
    stepCapMarginMps: number;
    liftRateMps: number;
    offsetDecayMps: number;
    plantErrM: number;
    attempts: number;
    confirmed: number;
    failed: number;
    failedErrM: number;
    sustained: number;
    cover: Record<ArmSide, { eligibleS: number; plantedS: number }>;
  };
}

export interface FootEvent {
  type: 'footPlant' | 'footRelease' | 'footSwing' | 'footPlantFailed';
  side: ArmSide;
  data: Record<string, unknown>;
}

const SIDES: ArmSide[] = ['left', 'right'];
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const hz = (a: Vec3): Vec3 => v3(a.x, 0, a.z);
const dirOf = (h: number): Vec3 => v3(Math.sin(h), 0, Math.cos(h));

function newFoot(): FootState {
  return {
    mode: 'airborne',
    tentative: false,
    solves: 0,
    stale: false,
    eligible: false,
    failReason: null,
    failAtS: 0,
    attempts: 0,
    fails: 0,
    source: 'follow',
    heelW: null,
    headingRad: 0,
    rollF: 0,
    toeZ: 0,
    edgeX: 0,
    anchorW: null,
    plantedAtS: 0,
    target: v3(),
    dest: null,
    destHeadingRad: 0,
    elapsedS: 0,
    durS: 0,
    stepM: 0,
    why: null,
    offset: v3(),
    settled: false,
    drag: false,
    clipSwingP: null,
    wait: false,
    p0: 0,
    liftExcessM: 0,
    short: false,
    inherited: false,
    released: false,
    releaseReason: null,
    releaseAtS: 0,
    featureErrM: 0,
    featureHzM: 0,
    gapM: 0,
    driftM: 0,
    residualM: 0,
    speedMps: 0,
    liftRateMps: 0,
    followMps: 0,
    ankleW: v3(),
    footQ: { x: 0, y: 0, z: 0, w: 1 },
    featureW: v3(),
    rejoin: false,
  };
}

export function newFootPlan(profile: FootworkProfile, R: RagdollProfile): FootPlan {
  return {
    profile,
    shoe: { he: { ...R.shoe.halfExtents }, centerFoot: v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM) },
    feet: { left: newFoot(), right: newFoot() },
    reachM: plantReachM(R, profile.plantTolM),
    lastStep: null,
    clipLast: false,
    initialized: false,
    dtS: 0,
    stats: {
      stepCapMarginMps: Infinity,
      liftRateMps: 0,
      offsetDecayMps: 0,
      plantErrM: 0,
      attempts: 0,
      confirmed: 0,
      failed: 0,
      failedErrM: 0,
      sustained: 0,
      cover: { left: { eligibleS: 0, plantedS: 0 }, right: { eligibleS: 0, plantedS: 0 } },
    },
  };
}

/** Everything the planner reads for one player and substep (all from the solved state or the pose path). */
export interface FootPlanInput {
  t: number;
  dt: number;
  core: Pose;
  /** Solved horizontal velocity of the core (world, m/s) and yaw rate (rad/s). */
  vel: Vec3;
  yawRate: number;
  /** Support control: supported mode with a valid probe. `falling`: control mode falling. `ragdoll`: articulated. */
  supported: boolean;
  falling: boolean;
  ragdoll: boolean;
  groundY: number;
  /** Achieved hips (world) and the standing home of each ankle (world, ground + sole height, stagger applied). */
  hips: Record<ArmSide, Vec3>;
  home: Record<ArmSide, Vec3>;
  /** Ordinary leg request of this substep (world ankle, before stance IK): what a following foot rejoins. */
  request: Record<ArmSide, Vec3>;
  /**
   * Clip regime (weight > 0): per foot inside its clip stance interval, its clip contact weight and roll fraction, and its
   * clip swing progress (0 at the clip liftoff, 1 at the next touchdown; null in stance).
   */
  clip: {
    weight: number;
    headingRad: number;
    stance: Record<ArmSide, boolean>;
    contact: Record<ArmSide, { weight: number; rollF: number; toeZ: number } | null>;
    swingP?: Record<ArmSide, number | null>;
  } | null;
  /** Sole height of the flat shoe (ankle above the ground), m; default shoe toe length (sole), m. */
  soleM: number;
  toeM: number;
  /** Body lateral axis sign (world right = +1 side), for the no-crossing rule: sideSign(s) * dot(p, right). */
  rightW: Vec3;
  sideSign: Record<ArmSide, number>;
}

/** Contact feature (world) of a planted foot at its roll fraction. */
export function plantFeature(f: FootState): Vec3 {
  return addScaled(addScaled(f.heelW!, dirOf(f.headingRad), f.toeZ * f.rollF), v3(Math.cos(f.headingRad), 0, -Math.sin(f.headingRad)), f.edgeX);
}

/**
 * End a plant. A confirmed plant emits footRelease (its drift includes the releasing sample; `solves` = later solves it
 * survived). A tentative one was never a plant: it is a failed proposal (footPlantFailed, counted), no touchdown/liftoff.
 */
function release(plan: FootPlan, f: FootState, why: FootReason, t: number, ev: FootEvent[], side: ArmSide, extra: Record<string, unknown> = {}): void {
  if (f.mode === 'planted' && f.tentative) {
    failProposal(plan, f, why, t, ev, side, extra);
    return;
  }
  if (f.mode === 'planted') {
    ev.push({ type: 'footRelease', side, data: { reason: why, driftM: round(f.driftM, 5), featureErrM: round(f.featureErrM, 5), plantedS: round(t - f.plantedAtS, 5), solves: f.solves, ...extra } });
    f.releaseReason = why;
    f.releaseAtS = t;
  }
  f.heelW = null;
  f.anchorW = null;
  f.inherited = false;
}

function failProposal(plan: FootPlan, f: FootState, why: FootReason, t: number, ev: FootEvent[], side: ArmSide, extra: Record<string, unknown>): void {
  const at = f.anchorW ? [round(f.anchorW.x, 4), round(f.anchorW.y, 4), round(f.anchorW.z, 4)] : null;
  ev.push({ type: 'footPlantFailed', side, data: { reason: why, at, rollF: round(f.rollF, 4), ...extra } });
  plan.stats.failed++;
  if (typeof extra.errM === 'number') plan.stats.failedErrM = Math.max(plan.stats.failedErrM, extra.errM);
  f.fails++;
  f.failReason = why;
  f.failAtS = t;
  f.tentative = false;
  f.heelW = null;
  f.anchorW = null;
}

function startFollow(f: FootState, request: Vec3): void {
  f.mode = f.mode === 'airborne' ? 'airborne' : 'swing';
  f.source = 'follow';
  f.offset = sub(f.target, request);
  f.dest = null;
}

/**
 * Plan one substep: mode transitions and the foot requests for the leg solve. `observeFeet` must follow the pose.
 * Deterministic: depends only on the plan state and the input.
 */
export function planFeet(plan: FootPlan, inp: FootPlanInput, ev: FootEvent[]): Record<ArmSide, FootRequest> {
  const P = plan.profile;
  const out = {} as Record<ArmSide, FootRequest>;
  const bodyHeading = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  const speed = len(hz(inp.vel));
  plan.dtS = inp.dt;
  // ---------------- no support: no anchors, no new plants (airborne feet follow the request with a decaying offset)
  if (!inp.supported || inp.ragdoll) {
    const why: FootReason = inp.ragdoll ? 'ragdoll' : inp.falling ? 'falling' : 'supportLost';
    for (const s of SIDES) {
      const f = plan.feet[s];
      f.rejoin = false;
      f.eligible = false;
      f.wait = false;
      f.inherited = false;
      f.clipSwingP = null;
      if (f.mode !== 'airborne') {
        release(plan, f, why, inp.t, ev, s);
        ev.push({ type: 'footSwing', side: s, data: { mode: 'airborne', reason: why } });
        f.mode = 'airborne';
        f.source = 'follow';
        f.offset = sub(f.target, inp.request[s]);
        f.dest = null;
      }
      decayOffset(f, P, inp.dt);
      f.target = add(inp.request[s], f.offset);
      out[s] = { kind: 'offset', offsetW: f.offset };
    }
    plan.clipLast = false;
    return out;
  }
  const clip = inp.clip;
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.rejoin) {
      // a plant released after the last pose continues from the achieved ankle
      f.rejoin = false;
      f.source = 'follow';
      f.offset = sub(f.target, inp.request[s]);
    }
    // support regained: an airborne foot does not snap down; it swings to its home (reactive) or follows the clip
    if (f.mode === 'airborne') {
      f.mode = 'swing';
      if (clip) startFollow(f, inp.request[s]);
      else startStep(plan, s, inp, 'settle', ev);
      ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: f.source, reason: 'supportRegained' } });
    }
  }
  if (clip) {
    // ---------------- clip regime: plants follow the clip stance annotations
    plan.clipLast = true;
    for (const s of SIDES) {
      const f = plan.feet[s];
      const c = clip.contact[s];
      f.clipSwingP = clip.swingP?.[s] ?? null;
      f.wait = false;
      f.inherited = false;
      f.released = false;
      if (f.mode === 'planted') {
        if (!clip.stance[s]) {
          release(plan, f, 'liftoff', inp.t, ev, s);
          f.mode = 'swing';
          startFollow(f, inp.request[s]);
        } else if (c) {
          f.rollF = clamp(c.rollF, 0, 1);
          f.edgeX = 0;
        }
      } else {
        if (f.source === 'step') startFollow(f, inp.request[s]);
        // touchdown proposal: inside the stance interval, the clip contact made, the shoe on the ground where it is now
        // (a fresh achieved solve, not the failed proposal's), and the anchor reachable from the current hip with the
        // reach margin; the solve of this substep confirms it or not (observeFeet)
        if (clip.stance[s] && c && c.weight >= P.clipPlantWeight && len(f.offset) <= P.plantTolM && !f.stale && f.gapM <= P.plantTolM) {
          const rollF = clamp(c.rollF, 0, 1);
          const feat = add(f.ankleW, qRot(f.footQ, v3(0, -inp.soleM, c.toeZ * rollF)));
          const ankleAt = add(f.ankleW, v3(0, inp.groundY - feat.y, 0));
          if (FOOT_DEBUG.noReachCheck || dist(ankleAt, inp.hips[s]) <= plan.reachM) {
            f.featureW = feat;
            proposePlant(plan, f, inp, clip.headingRad, rollF, c.toeZ);
          }
        }
      }
    }
  } else {
    // ---------------- reactive steps (no clip weight)
    const still = speed < P.settleSpeedMps && Math.abs(inp.yawRate) < 0.3;
    // clip-to-procedural crossing: every following foot is inherited, with its clip phase, achieved foot and contacts
    // (plants carry over unchanged and stay only while valid, below)
    const crossing = plan.clipLast;
    plan.clipLast = false;
    for (const s of SIDES) {
      const f = plan.feet[s];
      if (!still) f.settled = false;
      if (FOOT_DEBUG.legacyEntry) {
        if (f.mode === 'swing' && f.source === 'follow') startStep(plan, s, inp, 'step', ev);
        continue;
      }
      if (f.mode !== 'swing' || f.source !== 'follow') {
        f.wait = false;
        if (crossing && f.mode === 'planted' && !f.tentative) f.inherited = true;
        continue;
      }
      if (crossing) {
        f.wait = true;
        f.inherited = true;
        f.headingRad = headingOf(norm(hz(qRot(f.footQ, v3(0, 0, 1))), v3(0, 0, 1)));
      }
      if (!f.wait) {
        // outside the crossing a following foot (initialization, a failed touchdown, a released plant) steps now; a plant
        // its solve released while the other foot is not planted drags (a stumble), like a reach release
        const drag = f.released && plan.feet[other(s)].mode !== 'planted';
        f.released = false;
        startStep(plan, s, inp, 'step', ev, drag);
        continue;
      }
      // inherited / failed-proposal foot: an honest touchdown where it is (on the ground, a fresh solve, reachable from the
      // current hip); else, crossing in the air, its own clip swing continues as a planner step (no new lift); else it
      // waits for its turn (one ordinary step at a time, below)
      const ankleAt = add(f.ankleW, v3(0, inp.groundY - f.featureW.y, 0));
      if (f.gapM <= P.plantTolM && !f.stale && dist(ankleAt, inp.hips[s]) <= plan.reachM - P.reachMarginM) {
        f.wait = false;
        proposePlant(plan, f, inp, headingOf(norm(hz(qRot(f.footQ, v3(0, 0, 1))), v3(0, 0, 1))), 0, inp.toeM);
      } else if (crossing && f.gapM > P.plantTolM) {
        f.wait = false;
        continueSwing(plan, s, inp, ev);
      }
    }
    for (const s of SIDES) plan.feet[s].clipSwingP = null;
    const swinging = SIDES.filter((s) => plan.feet[s].mode === 'swing');
    // planted feet: hard releases (reach, yaw) and step triggers
    const want: { s: ArmSide; why: FootReason; urgency: number }[] = [];
    for (const s of SIDES) {
      const f = plan.feet[s];
      // a proposal (initialization) is confirmed or failed by this substep's solve, not stepped from
      if (f.mode !== 'planted' || f.tentative) continue;
      const ankleAt = add(f.heelW!, v3(0, inp.soleM, 0));
      const reach = dist(ankleAt, inp.hips[s]);
      const yawErr = Math.abs(wrapPi(bodyHeading - f.headingRad));
      const err = len(hz(sub(ankleAt, inp.home[s])));
      if ((reach > plan.reachM && !f.inherited) || yawErr > rad(P.yawReleaseDeg)) {
        // the anchor is no longer valid: released now, swinging from where it is (no teleport)
        const why: FootReason = reach > plan.reachM ? 'reach' : 'yaw';
        release(plan, f, why, inp.t, ev, s, { reachM: round(reach, 4), yawErrDeg: round((yawErr * 180) / Math.PI, 2) });
        // with the other foot in the air the released foot drags on the turf (a stumble), not a second foot lifting
        const o = plan.feet[s === 'left' ? 'right' : 'left'];
        startStep(plan, s, inp, why, ev, o.mode !== 'planted');
        continue;
      }
      if (err > P.stepTriggerM) want.push({ s, why: 'step', urgency: err - P.stepTriggerM });
      else if (yawErr > rad(P.yawTriggerDeg)) want.push({ s, why: 'yaw', urgency: yawErr - rad(P.yawTriggerDeg) });
      else if (reach > plan.reachM - P.reachMarginM) want.push({ s, why: 'reach', urgency: reach - plan.reachM + P.reachMarginM });
      else if (still && !f.settled && err > P.settleTriggerM) want.push({ s, why: 'settle', urgency: (err - P.settleTriggerM) * 0.1 });
    }
    const held = (s: ArmSide): boolean => plan.feet[s].mode === 'planted' && !plan.feet[s].tentative;
    // a waiting foot takes the next ordinary step: when no step is in progress and the other foot is held (or both wait:
    // the one farther from its home goes first)
    const stepping = SIDES.some((s) => plan.feet[s].mode === 'swing' && plan.feet[s].source === 'step');
    const waiting = SIDES.filter((s) => plan.feet[s].mode === 'swing' && plan.feet[s].source === 'follow' && plan.feet[s].wait);
    if (!stepping && waiting.length) {
      const far = (s: ArmSide): number => len(hz(sub(plan.feet[s].target, inp.home[s])));
      const ready = waiting.filter((s) => held(other(s)));
      const pickS = ready.length ? ready[0] : waiting.length === 2 ? (far('right') > far('left') ? 'right' : 'left') : null;
      if (pickS) {
        plan.feet[pickS].wait = false;
        startStep(plan, pickS, inp, 'step', ev);
      }
    } else if (swinging.length === 0 && held('left') && held('right') && want.length) {
      // one foot at a time: the most urgent, then the foot that did not step last (alternation). Sideways travel is a
      // shuffle that leads with the foot on the travel side: when the lateral component dominates, a trigger on either
      // foot steps the lead foot out after a trailing step (or first) and closes the trailing foot after a lead step,
      // so a side step never starts by swinging the inside foot into the other leg
      want.sort((a, b) => b.urgency - a.urgency || (a.s === plan.lastStep ? 1 : -1));
      let pickS = want[0].s;
      let why = want[0].why;
      const lateral = dot(hz(inp.vel), inp.rightW);
      if (Math.abs(lateral) >= P.leadLateralMps && Math.abs(lateral) >= P.leadLateralFrac * speed) {
        const lead: ArmSide = inp.sideSign.right * lateral > 0 ? 'right' : 'left';
        const trail: ArmSide = lead === 'left' ? 'right' : 'left';
        pickS = plan.lastStep === lead ? trail : lead;
        why = want.find((w) => w.s === pickS)?.why ?? 'step';
      }
      release(plan, plan.feet[pickS], why, inp.t, ev, pickS);
      startStep(plan, pickS, inp, why, ev);
    }
  }
  // ---------------- requests
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode === 'planted') {
      out[s] = { kind: 'plant', heelW: f.heelW!, headingRad: f.headingRad, rollF: f.rollF, toeZ: f.toeZ, edgeX: f.edgeX };
      f.target = add(f.heelW!, v3(0, inp.soleM, 0));
      continue;
    }
    if (f.source === 'follow' && f.wait) {
      // waiting: the target held (no offset decay, not the request's procedural swing)
      f.speedMps = 0;
      f.liftRateMps = 0;
      f.followMps = 0;
      f.offset = sub(f.target, inp.request[s]);
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
      continue;
    }
    if (f.source === 'follow') {
      const o0 = f.offset;
      decayOffset(f, P, inp.dt);
      const prev = f.target;
      f.target = add(inp.request[s], f.offset);
      f.speedMps = inp.dt > 0 ? len(hz(sub(f.offset, o0))) / inp.dt : 0;
      f.liftRateMps = inp.dt > 0 ? Math.abs(f.offset.y - o0.y) / inp.dt : 0;
      f.followMps = inp.dt > 0 ? len(hz(sub(f.target, prev))) / inp.dt : 0;
      plan.stats.offsetDecayMps = Math.max(plan.stats.offsetDecayMps, inp.dt > 0 ? len(sub(f.offset, o0)) / inp.dt : 0);
      out[s] = { kind: 'offset', offsetW: f.offset };
      continue;
    }
    if (advanceStep(plan, s, inp)) out[s] = { kind: 'plant', heelW: f.heelW!, headingRad: f.headingRad, rollF: f.rollF, toeZ: f.toeZ, edgeX: f.edgeX };
    else out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
  }
  // stance eligibility (coverage): clip stance at the plant contact weight; reactive: supported, not in a planner step
  for (const s of SIDES) {
    const f = plan.feet[s];
    const c = clip?.contact[s];
    f.eligible = clip ? !!(clip.stance[s] && c && c.weight >= P.clipPlantWeight) : !(f.mode === 'swing' && f.source === 'step');
  }
  return out;
}

function decayOffset(f: FootState, P: FootworkProfile, dt: number): void {
  const L = len(f.offset);
  if (L <= 0) return;
  const step = P.rejoinMps * dt;
  f.offset = L <= step ? v3() : addScaled(v3(), f.offset, (L - step) / L);
}

/**
 * Propose a plant where the foot's contact feature is now (on the ground below it): no jump to a plausible stance. The
 * proposal is tentative: this substep's solve runs with the plant request and observeFeet confirms it (footPlant) or
 * fails it (footPlantFailed).
 */
function proposePlant(plan: FootPlan, f: FootState, inp: FootPlanInput, headingRad: number, rollF: number, toeZ: number): void {
  const feat = v3(f.featureW.x, inp.groundY, f.featureW.z);
  plan.stats.attempts++;
  f.attempts++;
  f.mode = 'planted';
  f.tentative = true;
  f.solves = 0;
  f.source = 'step';
  f.headingRad = headingRad;
  f.rollF = rollF;
  f.toeZ = toeZ;
  f.edgeX = 0;
  f.heelW = addScaled(feat, dirOf(headingRad), -toeZ * rollF);
  f.anchorW = feat;
  f.plantedAtS = inp.t;
  f.dest = null;
  f.offset = v3();
  f.driftM = 0;
  f.featureErrM = 0;
}

/** Destination of a reactive step: under the hip predicted at touchdown, led along the actual travel, reach-bounded. */
function destination(plan: FootPlan, s: ArmSide, inp: FootPlanInput, remainS: number): Vec3 {
  const P = plan.profile;
  const v = hz(inp.vel);
  const hipTd = add(hz(inp.hips[s]), scale3(v, remainS));
  const homeOff = hz(sub(inp.home[s], inp.hips[s]));
  let d = add(add(hipTd, homeOff), scale3(v, P.swing.leadS));
  // reach at the stance height: the horizontal radius whose plant request stays inside the plant reach (less margin)
  const vert = inp.hips[s].y - (inp.groundY + inp.soleM);
  const rReach = Math.sqrt(Math.max(0, (plan.reachM - 2 * P.reachMarginM) ** 2 - vert * vert));
  const rMax = Math.min(P.maxStepFromHipM, rReach);
  const off = sub(d, hipTd);
  const L = len(off);
  if (L > rMax) d = addScaled(hipTd, off, rMax / L);
  // no crossing: keep the destination on its own side of the other foot by the minimum separation (body frame)
  const o = s === 'left' ? 'right' : 'left';
  const of = plan.feet[o];
  const other = of.mode === 'planted' ? add(of.heelW!, v3(0, inp.soleM, 0)) : of.target;
  const lat = (p: Vec3): number => dot(hz(p), inp.rightW) * inp.sideSign[s];
  const gap = lat(d) - lat(other);
  if (gap < P.minSeparationM) d = addScaled(d, inp.rightW, inp.sideSign[s] * (P.minSeparationM - gap));
  return v3(d.x, inp.groundY + inp.soleM, d.z);
}

const scale3 = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const other = (s: ArmSide): ArmSide => (s === 'left' ? 'right' : 'left');

function startStep(plan: FootPlan, s: ArmSide, inp: FootPlanInput, why: FootReason, ev: FootEvent[], drag = false): void {
  const P = plan.profile;
  const f = plan.feet[s];
  f.mode = 'swing';
  f.source = 'step';
  f.why = why;
  f.elapsedS = 0;
  f.drag = drag;
  f.wait = false;
  f.inherited = false;
  f.p0 = 0;
  f.liftExcessM = 0;
  f.short = false;
  const d0 = destination(plan, s, inp, P.swing.minS);
  const L = len(hz(sub(d0, f.target)));
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(hz(inp.vel));
  f.durS = clamp(1.6 * (L / vCap) + P.swing.minS * 0.5, P.swing.minS, P.swing.maxS);
  fitStance(plan, s, inp);
  f.dest = destination(plan, s, inp, f.durS);
  f.stepM = len(hz(sub(f.dest, f.target)));
  f.destHeadingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  if (why === 'settle') f.settled = true;
  plan.lastStep = s;
  ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'step', reason: why, durS: round(f.durS, 4), stepM: round(f.stepM, 4), ...(drag ? { drag: true } : {}) } });
}

/**
 * Clip-to-procedural crossing, a foot in the air in its clip swing: the swing continues as a planner step from its clip
 * swing progress p0 (no new liftoff, no restart, no snap): the step starts at p0 from the current target, its remaining
 * time from the remaining distance, and the height it has above the step arc at p0 fades out over the rest of the step
 * (it lands at the step's touchdown, a proposal like any other).
 */
function continueSwing(plan: FootPlan, s: ArmSide, inp: FootPlanInput, ev: FootEvent[]): void {
  const P = plan.profile;
  const f = plan.feet[s];
  const p0 = clamp(f.clipSwingP ?? 0.5, 0, 0.9);
  f.mode = 'swing';
  f.source = 'step';
  f.why = 'continue';
  f.drag = false;
  f.wait = false;
  f.short = false;
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(hz(inp.vel));
  // remaining time: what is left to do, the remaining distance to the (touchdown-time) destination and the descent from
  // the current height within the lift rate (smooth: peak rate 1.5 x mean), not a nominal fraction of a new step
  const h0 = Math.max(0, f.target.y - (inp.groundY + inp.soleM));
  let remS = P.swing.minS * (1 - p0);
  for (let i = 0; i < 3; i++) {
    const L = len(hz(sub(destination(plan, s, inp, remS), f.target)));
    remS = clamp(Math.max(1.6 * (L / vCap), (1.5 * h0) / P.swing.maxLiftRateMps), inp.dt, P.swing.maxS);
  }
  f.durS = remS / (1 - p0);
  f.elapsedS = p0 * f.durS;
  f.p0 = p0;
  f.dest = destination(plan, s, inp, remS);
  f.stepM = len(hz(sub(f.dest, f.target)));
  f.destHeadingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  f.liftExcessM = f.target.y - (inp.groundY + inp.soleM) - stepClearance(P, f) * Math.sin(Math.PI * p0) ** 2;
  plan.lastStep = s;
  ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'step', reason: 'continue', durS: round(remS, 4), stepM: round(f.stepM, 4), p0: round(p0, 4) } });
}

/** Step clearance: by step length (short steps lift less), within what the lift rate allows over the step (quick steps). */
const stepClearance = (P: FootworkProfile, f: FootState): number =>
  f.drag ? 0 : Math.min(P.swing.clearanceM * clamp(f.stepM / 0.25, 0.35, 1), (P.swing.maxLiftRateMps * f.durS) / Math.PI);

/**
 * Quick steps: when the held other foot would leave its reach before this step ends (fast travel), the rest of the step
 * is retimed to the time that foot has left, as far as the remaining distance allows within the speed cap. The progress
 * is kept (no restart, no jump); only its rate changes. Smaller, quicker steps instead of a stance foot released while
 * this one is still in the air.
 */
function fitStance(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const f = plan.feet[s];
  const os = other(s);
  const o = plan.feet[os];
  if (FOOT_DEBUG.noQuick || o.mode !== 'planted' || o.tentative || f.durS <= 0) return;
  const p = clamp(f.elapsedS / f.durS, 0, 1);
  const remain = (1 - p) * f.durS;
  const left = reachTimeLeft(plan, o, inp.hips[os], hz(inp.vel), inp.soleM);
  if (p >= 1 || !(left < remain)) return;
  // not below a quarter of the shortest nominal step (no vanishing shuffles): a window shorter than that releases the
  // stance foot (its hard reach release) while this one finishes
  const rem = Math.min(remain, Math.max(left, 0.25 * plan.profile.swing.minS, inp.dt));
  f.short = true;
  f.durS = rem / (1 - p);
  f.elapsedS = p * f.durS;
}

/** Time (s) until a planted foot's anchor leaves the plant reach of a hip moving at `vel` (0: already out; Infinity: still). */
function reachTimeLeft(plan: FootPlan, f: FootState, hip: Vec3, vel: Vec3, soleM: number): number {
  const a = sub(add(f.heelW!, v3(0, soleM, 0)), hip);
  const c = dot(a, a) - plan.reachM * plan.reachM;
  if (c >= 0) return 0;
  const vv = dot(vel, vel);
  if (vv < 1e-12) return Infinity;
  const b = dot(a, vel);
  return (b + Math.sqrt(b * b - vv * c)) / vv;
}

/** Advance a planner step one substep: retargeted destination, bounded horizontal and vertical target speeds. */
function advanceStep(plan: FootPlan, s: ArmSide, inp: FootPlanInput): boolean {
  const P = plan.profile;
  const f = plan.feet[s];
  const dt = inp.dt;
  const prev = f.target;
  // a drag (the other foot was in the air) lifts for the rest of its step once the other foot is held
  const o = plan.feet[other(s)];
  if (f.drag && o.mode === 'planted' && !o.tentative && !FOOT_DEBUG.noQuick) f.drag = false;
  fitStance(plan, s, inp);
  f.elapsedS += dt;
  const remainS = Math.max(0, f.durS - f.elapsedS);
  f.dest = destination(plan, s, inp, remainS);
  f.destHeadingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  const p0 = f.durS > 0 ? clamp((f.elapsedS - dt) / f.durS, 0, 1) : 1;
  const p = f.durS > 0 ? clamp(f.elapsedS / f.durS, 0, 1) : 1;
  // horizontal: the remaining distance to the (retargeted) destination is covered along the remainder of a minimum-jerk
  // schedule in the step progress (the progress never restarts), capped in speed
  const mj = (x: number): number => x * x * x * (10 - 15 * x + 6 * x * x);
  const rem = hz(sub(f.dest, prev));
  const rl = len(rem);
  const frac = p0 >= 1 || 1 - mj(p0) < 1e-12 ? 1 : (mj(p) - mj(p0)) / (1 - mj(p0));
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(hz(inp.vel));
  const step = Math.min(rl * frac, rl, vCap * dt);
  const h = rl > 1e-12 ? addScaled(hz(prev), rem, step / rl) : hz(prev);
  // vertical: clearance arc over the step progress (sin^2: no vertical speed at liftoff and touchdown; short steps lift
  // less), rate-capped; a continued clip swing adds its inherited height above the arc, faded out by touchdown
  const clr = stepClearance(P, f);
  let yWant = inp.groundY + inp.soleM + clr * Math.sin(Math.PI * p) ** 2;
  if (f.liftExcessM !== 0) {
    const u = clamp((p - f.p0) / (1 - f.p0), 0, 1);
    yWant = Math.max(inp.groundY + inp.soleM, yWant + f.liftExcessM * (1 - u * u * (3 - 2 * u)));
  }
  const y = prev.y + clamp(yWant - prev.y, -P.swing.maxLiftRateMps * dt, P.swing.maxLiftRateMps * dt);
  f.target = v3(h.x, y, h.z);
  f.headingRad += clamp(wrapPi(f.destHeadingRad - f.headingRad), -rad(P.swing.maxYawRateDegPerS) * dt, rad(P.swing.maxYawRateDegPerS) * dt);
  f.speedMps = dt > 0 ? step / dt : 0;
  f.liftRateMps = dt > 0 ? Math.abs(y - prev.y) / dt : 0;
  if (dt > 0) {
    plan.stats.stepCapMarginMps = Math.min(plan.stats.stepCapMarginMps, vCap - f.speedMps);
    plan.stats.liftRateMps = Math.max(plan.stats.liftRateMps, f.liftRateMps);
  }
  // touchdown: progress complete, at the destination, the sole down; a step retimed to a stance window (a little step)
  // touches down where it is at the end of its time when that is within reach (else it continues to the destination)
  const down = f.target.y - (inp.groundY + inp.soleM) < 1e-4;
  const little = f.short && dist(f.target, inp.hips[s]) <= plan.reachM - P.reachMarginM;
  if (p >= 1 && down && (len(hz(sub(f.dest, f.target))) < 1e-3 || little)) {
    f.featureW = sub(f.target, v3(0, inp.soleM, 0));
    proposePlant(plan, f, inp, f.headingRad, 0, inp.toeM);
    return true;
  }
  return false;
}

/** Height of the lowest shoe-box corner above the ground (negative: penetration). */
function contactGap(plan: FootPlan, ankle: Vec3, q: { x: number; y: number; z: number; w: number }, groundY: number): number {
  const { he, centerFoot } = plan.shoe;
  const c = add(ankle, qRot(q, centerFoot));
  let low = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) low = Math.min(low, c.y + qRot(q, v3(sx * he.x, sy * he.y, sz * he.z)).y);
  return low - groundY;
}

/** Why a plant's achieved solve is not (or no longer) a valid plant: clearance alternative, reach clamp, separation, slide. */
function invalidWhy(f: FootState, info: NonNullable<PhysicalPose['legInfo']>[ArmSide]): FootReason {
  return info && info.variant !== 0 ? 'clearance' : info && info.softM > 0.5 * f.featureErrM ? 'reach' : Math.abs(f.gapM) >= f.featureHzM ? 'separation' : 'slide';
}

/**
 * After the pose: achieved contact feature, its error to the anchor and its drift, the leg residual.
 * - A proposal (tentative plant) is confirmed when its solve used the primary candidate, the request's reach clamp is
 *   within plantTolM and the contact-feature error is within plantTolM: footPlant (with the achieved error). Otherwise it
 *   fails (footPlantFailed: reason, errors) and the foot continues from the achieved ankle; the next proposal waits for
 *   a fresh solve.
 * - A confirmed plant whose feature left the anchor by more than plantTolM (reach clamp, floor lift, a clearance
 *   alternative) is released now with that reason (footRelease; its drift includes this sample); the foot then
 *   continues from the achieved ankle (no jump back to the anchor). One that holds counts a survived solve.
 * Coverage: eligible stance time and its confirmed-planted part accumulate per foot.
 */
export function observeFeet(plan: FootPlan, pose: PhysicalPose, soleM: number, groundY: number, ev: FootEvent[], t: number): void {
  for (const s of SIDES) {
    observeFoot(plan, s, pose, soleM, groundY, ev, t);
    const f = plan.feet[s];
    if (f.eligible && plan.dtS > 0) {
      plan.stats.cover[s].eligibleS += plan.dtS;
      if (f.mode === 'planted' && !f.tentative) plan.stats.cover[s].plantedS += plan.dtS;
    }
  }
}

function observeFoot(plan: FootPlan, s: ArmSide, pose: PhysicalPose, soleM: number, groundY: number, ev: FootEvent[], t: number): void {
  const P = plan.profile;
  const f = plan.feet[s];
  const ankle = pose.jointLandmarksWorld[`${s}Ankle`];
  const q = footFrame(pose, s);
  const info = pose.legInfo?.[s];
  f.ankleW = ankle;
  f.footQ = q;
  f.residualM = pose.targetResidualM?.[`${s}Leg`] ?? 0;
  f.gapM = contactGap(plan, ankle, q, groundY);
  // a plant pivoted on the other end of its footprint (pose: heel or toe on the anchor) is measured at that end
  if (f.mode === 'planted' && info?.rollF !== undefined) {
    f.rollF = info.rollF;
    f.edgeX = info.edgeX ?? 0;
  }
  const roll = f.mode === 'planted' ? f.rollF : 0;
  const toe = f.mode === 'planted' ? f.toeZ : 0;
  const ex = f.mode === 'planted' ? f.edgeX : 0;
  f.featureW = add(ankle, qRot(q, v3(ex, -soleM, toe * roll)));
  if (f.mode !== 'planted') {
    f.featureErrM = 0;
    f.featureHzM = 0;
    // a fresh achieved solve of a free foot: a new proposal may use it
    f.stale = false;
    return;
  }
  const anchor = plantFeature(f);
  f.featureHzM = len(hz(sub(f.featureW, anchor)));
  f.featureErrM = Math.hypot(f.featureHzM, f.gapM);
  f.driftM = Math.max(f.driftM, f.featureErrM);
  const detail = (): Record<string, unknown> => ({ softM: round(info?.softM ?? 0, 5), liftM: round(info?.liftM ?? 0, 5), gapM: round(f.gapM, 5), hzM: round(f.featureHzM, 5), variant: info?.variant ?? 0 });
  if (f.tentative) {
    const ok = f.featureErrM <= P.plantTolM && (!info || (info.variant === 0 && info.softM <= P.plantTolM));
    if (ok) {
      // the plant interval starts at its confirmation (an initialization proposal is confirmed one substep later)
      f.tentative = false;
      f.inherited = false;
      f.solves = 0;
      f.plantedAtS = t;
      plan.stats.confirmed++;
      plan.stats.plantErrM = Math.max(plan.stats.plantErrM, f.featureErrM);
      const a = f.anchorW!;
      ev.push({ type: 'footPlant', side: s, data: { at: [round(a.x, 4), round(a.y, 4), round(a.z, 4)], headingDeg: round((f.headingRad * 180) / Math.PI, 2), rollF: round(f.rollF, 4), errM: round(f.featureErrM, 5) } });
      return;
    }
    const why: FootReason = info && info.variant !== 0 ? 'clearance' : info && info.softM > P.plantTolM ? 'reach' : invalidWhy(f, info);
    failProposal(plan, f, why, t, ev, s, { errM: round(f.featureErrM, 5), ...detail() });
    f.stale = true;
    toFollow(f, ankle, why);
    // a foot carried over the crossing waits again (one step at a time); others step at once, as before
    f.wait = f.inherited;
    ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'rejoin', reason: why, failed: true } });
    return;
  }
  if (f.featureErrM > P.plantTolM) {
    const why = invalidWhy(f, info);
    release(plan, f, why, t, ev, s, detail());
    toFollow(f, ankle, why);
    f.released = true;
    ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'rejoin', reason: why } });
    return;
  }
  plan.stats.plantErrM = Math.max(plan.stats.plantErrM, f.featureErrM);
  f.solves++;
  if (f.solves === 1) plan.stats.sustained++;
}

/** A plant that ended after the pose continues from the achieved ankle (the next plan rejoins the request from it). */
function toFollow(f: FootState, ankle: Vec3, why: FootReason): void {
  f.mode = 'swing';
  f.source = 'follow';
  f.target = { ...ankle };
  f.dest = null;
  f.why = why;
  f.rejoin = true;
  f.wait = false;
}

/**
 * Initialize from the achieved pose (reset): a supported foot on the ground within reach proposes a plant where it is
 * (confirmed or failed by the next solve, like any touchdown); others follow. Emits nothing itself (`_ev` kept for the
 * call site's event buffer).
 */
export function initFeet(plan: FootPlan, pose: PhysicalPose, inp: FootPlanInput, _ev: FootEvent[]): void {
  for (const s of SIDES) {
    const f = plan.feet[s];
    const ankle = pose.jointLandmarksWorld[`${s}Ankle`];
    const q = footFrame(pose, s);
    f.ankleW = ankle;
    f.footQ = q;
    f.target = { ...ankle };
    const c0 = inp.clip?.contact[s];
    f.featureW = add(ankle, qRot(q, v3(0, -inp.soleM, c0 ? c0.toeZ * clamp(c0.rollF, 0, 1) : 0)));
    f.mode = inp.supported ? 'swing' : 'airborne';
    f.source = 'follow';
    // the ankle offset of the achieved pose from the ordinary request (0 unless clamped): followed, then decayed
    f.offset = sub(ankle, inp.request[s]);
    f.gapM = contactGap(plan, ankle, q, inp.groundY);
    const onGround = f.gapM <= plan.profile.plantTolM;
    const clipStance = inp.clip ? inp.clip.stance[s] && (inp.clip.contact[s]?.weight ?? 0) >= plan.profile.clipPlantWeight : true;
    const reachable = dist(ankle, inp.hips[s]) <= plan.reachM - plan.profile.reachMarginM;
    // a proposal: the first solve with the plant request confirms or fails it (observeFeet)
    if (inp.supported && onGround && clipStance && reachable) {
      const c = inp.clip?.contact[s];
      const heading = inp.clip ? inp.clip.headingRad : headingOf(norm(hz(qRot(q, v3(0, 0, 1))), v3(0, 0, 1)));
      proposePlant(plan, f, inp, heading, c ? clamp(c.rollF, 0, 1) : 0, c ? c.toeZ : inp.toeM);
    }
  }
  plan.initialized = true;
}

/** Articulated (ragdoll) or removed: every anchor released with the reason; the plan stays airborne (no new plants). */
export function releaseFeet(plan: FootPlan, why: FootReason, t: number, ev: FootEvent[]): void {
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode === 'airborne') continue;
    release(plan, f, why, t, ev, s);
    ev.push({ type: 'footSwing', side: s, data: { mode: 'airborne', reason: why } });
    f.mode = 'airborne';
    f.source = 'follow';
    f.dest = null;
    f.rejoin = false;
    f.eligible = false;
  }
}

/**
 * Compact per-foot trace (mode, source, anchor, feature error, drift, residual, swing progress, target speeds; tn: a
 * proposal not yet confirmed, only before the first solve).
 */
export function footTrace(plan: FootPlan): Record<'l' | 'r', Record<string, unknown>> {
  const one = (f: FootState): Record<string, unknown> => ({
    m: f.mode === 'planted' ? 'P' : f.mode === 'swing' ? (f.source === 'step' ? 'S' : 'F') : 'A',
    a: f.anchorW ? [round(f.anchorW.x, 4), round(f.anchorW.z, 4)] : null,
    e: round(f.featureErrM, 5),
    eh: round(f.featureHzM, 5),
    gap: round(f.gapM, 5),
    d: round(f.driftM, 5),
    res: round(f.residualM, 4),
    p: f.mode === 'swing' && f.source === 'step' && f.durS > 0 ? round(Math.min(1, f.elapsedS / f.durS), 3) : null,
    v: round(f.speedMps, 3),
    vy: round(f.liftRateMps, 3),
    vf: round(f.followMps, 3),
    tg: [round(f.target.x, 4), round(f.target.y, 4), round(f.target.z, 4)],
    fy: round(f.featureW.y, 4),
    ...(f.mode === 'swing' && f.drag ? { dr: 1 } : {}),
    ...(f.mode === 'swing' && f.wait ? { wt: 1 } : {}),
    ...(f.mode === 'planted' && f.tentative ? { tn: 1 } : {}),
    ...(f.releaseReason ? { why: f.releaseReason } : {}),
  });
  return { l: one(plan.feet.left), r: one(plan.feet.right) };
}

/**
 * Probe-only switches: `noReachCheck` skips the clip touchdown reach pre-check (proposals then rely on confirmation);
 * `legacyEntry` restores the reactive entry before plan 07 item 3 (every following foot starts a step at once);
 * `noQuick` disables the quick-step rules of item 3 (stance-window retiming, little-step touchdown, drag lift).
 */
export const FOOT_DEBUG = { noReachCheck: false, legacyEntry: false, noQuick: false };
