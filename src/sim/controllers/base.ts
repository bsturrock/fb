// PlayerController contract: read a prior-state snapshot, emit intentions. Never touches physics.
import type { BodyProfile } from '../profiles';
import type { ArmIntent, ArmSide, PlayerId, PlayerIntent, Snapshot } from '../contracts';
import { norm, horiz, v3, type Vec3, dirFromHeading, rad, toWorld } from '../vec';
import type { PostureIntent, StanceRequest } from '../contracts';

export interface ControllerContext {
  self: PlayerId;
  /** Fixture focus target; guidance only, never filters physical contact. */
  focus: PlayerId | null;
  /** Snapshot as observed (possibly delayed). */
  observed: Snapshot;
  t: number;
  tick: number;
  substep: number;
  dt: number;
  bodies: Record<PlayerId, BodyProfile>;
}

export interface Controller {
  readonly kind: string;
  /** Observation delay (s) and decision interval (s); 0 = every substep, undelayed. */
  readonly observationDelayS: number;
  readonly decisionIntervalS: number;
  decide(ctx: ControllerContext): PlayerIntent;
  /** Parameters for the exported fixture JSON. */
  exportParams(tickS: number): unknown;
}

export const idleIntent = (facing: Vec3 = v3(0, 0, 1)): PlayerIntent => ({
  locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: norm(horiz(facing), v3(0, 0, 1)), effort: 1 },
});

// ------------------------------------------------------------------ scripted fixture input
export interface ScriptSegment {
  fromS: number;
  /** Requested horizontal velocity (m/s). */
  velocity: Vec3;
  /** Facing: explicit direction, 'velocity' (face request direction), or 'hold' (keep current facing request). */
  facing?: Vec3 | 'velocity' | 'hold';
  effort?: number;
  yawEffort?: number;
  /** Gate 3 posture request: lean (deg, bounded by the balance profile) toward a direction or the facing. */
  posture?: { leanDeg: number; dir?: Vec3 | 'facing' | 'velocity' };
  /** Plan 06a stance request (root height, stagger); suspension support only. */
  stance?: StanceRequest;
  /** Plan 08 evidence: free hands in the ready assignment during this segment (pose only). */
  readyHands?: boolean;
}

/** Scripted arm request. The target is a point in the focus player's frame, the own frame, or the world. */
export interface ArmScriptSegment {
  fromS: number;
  side: ArmSide;
  action: ArmIntent['action'];
  target?: { frame: 'focus' | 'self' | 'world'; point: Vec3 };
  closeEffort?: number;
}

export interface ScriptSpec {
  kind: 'script';
  segments: ScriptSegment[];
  arms?: ArmScriptSegment[];
}

/** Resolve a scripted arm target against the observed snapshot. */
export function resolveArmTarget(ctx: ControllerContext, t: ArmScriptSegment['target']): Vec3 {
  if (!t) return v3();
  if (t.frame === 'world') return { ...t.point };
  const id = t.frame === 'self' ? ctx.self : ctx.focus;
  const b = id ? ctx.observed.bodies[id] : undefined;
  if (!b) return { ...t.point };
  return toWorld({ p: b.position, q: b.rotation }, t.point);
}

export function scriptedArms(ctx: ControllerContext, segs: ArmScriptSegment[] | undefined): Partial<Record<ArmSide, ArmIntent>> | undefined {
  if (!segs || segs.length === 0) return undefined;
  const out: Partial<Record<ArmSide, ArmIntent>> = {};
  for (const side of ['left', 'right'] as ArmSide[]) {
    let seg: ArmScriptSegment | null = null;
    for (const s of segs) if (s.side === side && ctx.t + 1e-9 >= s.fromS) seg = s;
    if (!seg) continue;
    out[side] = { action: seg.action, targetWorld: resolveArmTarget(ctx, seg.target), closeEffort: seg.closeEffort };
  }
  return out;
}

/** Deterministic, tick-indexed movement requests. Segments apply from `fromS` until the next segment. */
export class ScriptController implements Controller {
  readonly kind = 'script';
  readonly observationDelayS = 0;
  readonly decisionIntervalS = 0;
  private lastFacing: Vec3;
  constructor(readonly spec: ScriptSpec, initialFacing: Vec3) {
    this.lastFacing = norm(horiz(initialFacing), v3(0, 0, 1));
  }
  decide(ctx: ControllerContext): PlayerIntent {
    let seg: ScriptSegment | null = null;
    for (const s of this.spec.segments) if (ctx.t + 1e-9 >= s.fromS) seg = s;
    if (!seg) return { ...idleIntent(this.lastFacing), arms: scriptedArms(ctx, this.spec.arms) };
    const vel = horiz(seg.velocity);
    let facing = this.lastFacing;
    if (seg.facing === 'velocity' || seg.facing === undefined) {
      if (Math.hypot(vel.x, vel.z) > 1e-6) facing = norm(vel);
    } else if (seg.facing !== 'hold') facing = norm(horiz(seg.facing), this.lastFacing);
    this.lastFacing = facing;
    let posture: PostureIntent | undefined;
    if (seg.posture) {
      const d = seg.posture.dir;
      const dir = d === undefined || d === 'facing' ? facing : d === 'velocity' ? norm(vel, facing) : norm(horiz(d), facing);
      posture = { leanDirWorld: dir, leanRad: rad(seg.posture.leanDeg) };
    }
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: facing, effort: seg.effort ?? 1, yawEffort: seg.yawEffort ?? 1, ...(seg.stance ? { stance: { ...seg.stance } } : {}) },
      arms: scriptedArms(ctx, this.spec.arms),
      posture,
      debug: { phase: 'script', ...(seg.readyHands ? { readyHands: true } : {}) },
    };
  }
  exportParams(tickS: number): unknown {
    return {
      kind: 'script',
      segments: this.spec.segments.map((s) => ({ ...s, fromTick: Math.round(s.fromS / tickS) })),
      arms: this.spec.arms?.map((s) => ({ ...s, fromTick: Math.round(s.fromS / tickS) })),
    };
  }
}

/** Velocity along a heading in degrees (0 = +Z, 90 = +X). */
export const vHeading = (speed: number, headingDeg: number): Vec3 => {
  const d = dirFromHeading(rad(headingDeg));
  return v3(d.x * speed, 0, d.z * speed);
};
