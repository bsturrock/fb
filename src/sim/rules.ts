// Gate 4 rule observer (section 12). Observation only: it reads solved contacts, the sim-owned physical pose and
// arm relationships, and records referee events. It never applies a force, moves a body or selects a fall.
//
// Profiles:
//  - labCoreOnly: historical diagnostic. A solved runner torso/pelvis-ground contact after a valid handoff produces
//    runnerCoreDown. No influence, progress or sideline observation.
//  - footballTackleSubset: eligible-region ground contact with continuing defensive influence (groundDown), sustained
//    physically restrained progress (progressStopped) and a configured sideline plane (sidelineOut).
import type { ColliderTag, ContactRec, PlayerContactObs, PlayerId, SegmentId } from './contracts';
import type { PhysicalPose } from './pose';
import { LIMB } from './pose';
import type { RagdollProfile, RuleProfile } from './profiles';
import { type Pose, type Vec3, add, dot, horiz, len, round, rv, scale, toLocal, toWorld, v3 } from './vec';

export type EndingKind = 'groundDown' | 'runnerCoreDown' | 'progressStopped' | 'sidelineOut';

/** Ground-contact region labels. Hand/wrist and foot/ankle (and the virtual foot support) are never eligible. */
export type GroundRegion =
  | 'torso' | 'pelvis' | 'head' | 'upperArm' | 'elbow' | 'forearm' | 'wrist' | 'hand' | 'thigh' | 'knee' | 'shin' | 'ankle' | 'foot' | 'footSupport';
export const EXCLUDED_GROUND_REGIONS: GroundRegion[] = ['wrist', 'hand', 'ankle', 'foot', 'footSupport'];

export interface GroundTouch {
  label: GroundRegion;
  /** physical = solved runner-floor manifold point; poseQuery = achieved-pose limb probe (supported/falling proxy). */
  source: 'physical' | 'poseQuery';
  /** Collider/segment key (physical) or limb shape key (query). */
  key: string;
  point: Vec3;
}

export interface RuleEnding {
  kind: EndingKind;
  profile: string;
  tick: number;
  substep: number;
  t: number;
  /** Frozen ball reference (event spot); never moved afterwards. */
  ballSpot: Vec3;
  ids: string[];
  evidence: Record<string, unknown>;
}

export interface RetentionObs {
  id: string;
  owner: PlayerId;
  kind: 'grip' | 'clamp';
  /** Force applied to the runner by this relationship in the last substep (zero when none was applied). */
  forceOnRunner: Vec3;
  /** Clamp normal force (N), grips: |force|. */
  loadN: number;
}

export interface RuleFrame {
  t: number;
  tick: number;
  /** Physics substeps completed (the substep just solved). */
  substep: number;
  dt: number;
  runnerId: PlayerId;
  representation: 'proxy' | 'ragdoll';
  /** Handoff was accepted (ragdoll exists from a valid conversion). */
  validHandoff: boolean;
  controlMode: 'supported' | 'falling';
  grounded: boolean;
  /** Runner core frame (proxy body or ragdoll core body). */
  corePose: Pose;
  /** Sim-owned physical pose (the same pose Presentation shows). */
  pose: PhysicalPose | null;
  /** Bulk COM velocity. */
  velocity: Vec3;
  /** Requested horizontal velocity (current intent). */
  request: Vec3;
  contacts: ContactRec[];
  /** Runner contacts with opponents (solved this substep). */
  opponentContacts: PlayerContactObs[];
  retention: RetentionObs[];
  minClampNormalN: number;
}

export interface RuleTraceRow {
  /** Defensive influence active. */
  infl: 0 | 1;
  /** Ground-touch labels this substep (eligible ones first). */
  gnd: string[];
  /** Progress predicates: request (m/s), restraint (N), advance since window anchor (m), window time (s). */
  prog?: { req: number; res: number; adv: number; win: number };
  /** Ball reference (world). */
  ball: [number, number, number];
}

type Emit = (type: string, playerId: PlayerId | undefined, data: Record<string, unknown>) => void;

/** Restraint episodes are logged once they last this long (shorter brushes are counted, not logged); s. */
const EPISODE_LOG_S = 0.1;

/** Limb capsules / end shapes in a segment frame (same geometry as the ragdoll colliders). */
function limbShapes(R: RagdollProfile): { seg: SegmentId; kind: 'capsule' | 'ball' | 'box'; region: string; L?: number; r?: number; c?: Vec3; he?: Vec3 }[] {
  const out: ReturnType<typeof limbShapes> = [];
  for (const s of ['left', 'right'] as const) {
    out.push({ seg: `${s}UpperArm`, kind: 'capsule', region: 'upperArm', L: LIMB.upperArm, r: R.radii.upperArm });
    out.push({ seg: `${s}Forearm`, kind: 'capsule', region: 'forearm', L: LIMB.forearm, r: R.radii.forearm });
    out.push({ seg: `${s}Forearm`, kind: 'ball', region: 'palm', r: R.radii.palm, c: v3(0, -(LIMB.forearm + LIMB.palmExtension - R.radii.palm), 0) });
    out.push({ seg: `${s}Thigh`, kind: 'capsule', region: 'thigh', L: LIMB.thigh, r: R.radii.thigh });
    out.push({ seg: `${s}Shin`, kind: 'capsule', region: 'shin', L: LIMB.shin, r: R.radii.shin });
    out.push({ seg: `${s}Shin`, kind: 'box', region: 'shoe', c: v3(0, -LIMB.shin - R.shoe.belowAnkleM, R.shoe.forwardM), he: R.shoe.halfExtents });
  }
  return out;
}

/**
 * Label a point on a limb collider. Forearm/shin points within `band` of the wrist/ankle landmark (distal end, local
 * y = -L) are wrist/ankle; points within `band` of the elbow/knee are labelled elbow/knee (eligible). The palm ball is
 * the hand and the shoe box is the foot. Only the endpoint band is excluded, never the whole forearm or shin.
 */
export function labelLimbPoint(region: string, seg: SegmentId, yLocal: number, band: number): GroundRegion {
  const L = seg.endsWith('Forearm') ? LIMB.forearm : seg.endsWith('Shin') ? LIMB.shin : seg.endsWith('UpperArm') ? LIMB.upperArm : seg.endsWith('Thigh') ? LIMB.thigh : 0;
  switch (region) {
    case 'palm':
      return 'hand';
    case 'shoe':
      return 'foot';
    case 'forearm':
      return yLocal <= -L + band ? 'wrist' : yLocal >= -band ? 'elbow' : 'forearm';
    case 'shin':
      return yLocal <= -L + band ? 'ankle' : yLocal >= -band ? 'knee' : 'shin';
    case 'upperArm':
      return yLocal <= -L + band ? 'elbow' : 'upperArm';
    case 'thigh':
      return yLocal <= -L + band ? 'knee' : 'thigh';
    case 'torso':
    case 'pelvis':
    case 'head':
      return region;
    case 'support':
    case 'capsule':
      return 'footSupport';
    default:
      return 'footSupport';
  }
}

export class RuleObserver {
  ending: RuleEnding | null = null;
  /** Set when the runner's handoff was rejected: no ending is issued (invalidHandoff is a non-success label). */
  disabledReason: string | null = null;
  lastRow: RuleTraceRow | null = null;
  private infl: { since: number; ids: Set<string>; lastT: number; freeS: number } | null = null;
  private touching = new Set<string>();
  /** Ground-touch labels already reported (each label is logged at its first touch; the trace has every substep). */
  private seen = new Set<string>();
  /**
   * Continuous restraint episode (request + restraint hold). `startT`/`anchor` is the current observation window; it
   * restarts whenever the ball advances more than maxAdvanceM from the anchor. `best` is the best forward ball
   * location within the current window.
   */
  private win: { episodeT: number; startT: number; startTick: number; anchor: number; best: number; bestPoint: Vec3; ids: Set<string>; resets: number; logged: boolean } | null = null;
  /** Restraint episodes shorter than EPISODE_LOG_S (logged as a count on the next logged episode). */
  private shortEpisodes = 0;
  private readonly fwd: Vec3;
  private readonly shapes: ReturnType<typeof limbShapes>;
  private untouchedReported = false;

  constructor(
    readonly profile: RuleProfile,
    readonly ragProfile: RagdollProfile,
    private readonly emit: Emit,
  ) {
    const f = horiz(profile.forwardAxis);
    this.fwd = scale(f, 1 / Math.max(1e-9, len(f)));
    this.shapes = limbShapes(ragProfile);
  }

  get runnerId(): PlayerId {
    return this.profile.runnerId;
  }

  /** Ball reference from the physical carry pose: a fixed offset in the runner's core frame (cosmetic ball). */
  ballRef(corePose: Pose): Vec3 {
    return toWorld(corePose, this.profile.ballLocal);
  }

  disable(reason: string, data: Record<string, unknown>): void {
    if (this.disabledReason || this.ending) return;
    this.disabledReason = reason;
    this.emit('ruleObserverDisabled', this.runnerId, { reason, ...data });
  }

  // ------------------------------------------------------------------ ground contact
  /** Runner ground touches this substep: solved floor manifolds plus achieved-pose limb probes for a proxy. */
  groundTouches(f: RuleFrame): GroundTouch[] {
    const out: GroundTouch[] = [];
    const band = this.profile.endBandM;
    for (const c of f.contacts) {
      const own: ColliderTag | null = c.a.playerId === f.runnerId ? c.a : c.b.playerId === f.runnerId ? c.b : null;
      const other = own === c.a ? c.b : c.a;
      if (!own || other.playerId !== null || other.key !== 'floor') continue;
      for (const p of c.points) {
        if (!(p.dist <= 0 || p.impulse >= this.profile.groundImpulseMinNs)) continue;
        let label: GroundRegion;
        if (f.representation === 'ragdoll' && f.pose && own.part !== 'floor' && own.part in f.pose.segments) {
          const seg = own.part as SegmentId;
          const sp = f.pose.segments[seg];
          const yl = toLocal({ p: sp.originWorld, q: sp.rotationWorld }, p.pointWorld).y;
          label = labelLimbPoint(own.region, seg, yl, band);
        } else label = labelLimbPoint(own.region, 'core', 0, band);
        out.push({ label, source: 'physical', key: own.key, point: p.pointWorld });
      }
    }
    // proxy limbs have no colliders: probe the achieved pose (the pose Presentation shows) against the ground plane
    if (f.representation === 'proxy' && f.pose) {
      const tol = this.profile.poseGroundTolM;
      for (const s of this.shapes) {
        const sp = f.pose.segments[s.seg];
        const P: Pose = { p: sp.originWorld, q: sp.rotationWorld };
        if (s.kind === 'capsule') {
          const n = 12;
          for (let i = 0; i <= n; i++) {
            const y = -(s.L! * i) / n;
            // capsule cap centres sit r inside the ends; sample the axis between them and the end caps
            const yc = Math.min(-s.r!, Math.max(-s.L! + s.r!, y));
            const c = toWorld(P, v3(0, yc, 0));
            if (c.y - s.r! <= tol) {
              const pt = v3(c.x, 0, c.z);
              out.push({ label: labelLimbPoint(s.region, s.seg, y, band), source: 'poseQuery', key: `${s.seg}:${s.region}`, point: pt });
            }
          }
        } else if (s.kind === 'ball') {
          const c = toWorld(P, s.c!);
          if (c.y - s.r! <= tol) out.push({ label: 'hand', source: 'poseQuery', key: `${s.seg}:palm`, point: v3(c.x, 0, c.z) });
        } else {
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            const c = toWorld(P, add(s.c!, v3(sx * s.he!.x, sy * s.he!.y, sz * s.he!.z)));
            if (c.y <= tol) out.push({ label: 'foot', source: 'poseQuery', key: `${s.seg}:shoe`, point: v3(c.x, 0, c.z) });
          }
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ influence
  private influenceSources(f: RuleFrame): string[] {
    const ids: string[] = [];
    for (const o of f.opponentContacts) if (o.impulse >= this.profile.influence.minContactImpulseNs) ids.push(`contact:${o.other}:${o.otherClass}>${o.ownClass}`);
    for (const r of f.retention) if (r.kind === 'grip' || r.loadN > f.minClampNormalN) ids.push(r.id);
    return ids;
  }

  private updateInfluence(f: RuleFrame): void {
    const src = this.influenceSources(f);
    if (src.length) {
      if (!this.infl) {
        this.infl = { since: f.t, ids: new Set(), lastT: f.t, freeS: 0 };
        this.emit('influenceBegin', this.runnerId, { sources: src, substep: f.substep });
      }
      for (const s of src) this.infl.ids.add(s);
      this.infl.lastT = f.t;
      this.infl.freeS = 0;
      return;
    }
    if (!this.infl) return;
    // retained through an uninterrupted fall/hold; cleared only after regained supported, unrestrained movement
    const req = horiz(f.request);
    const rq = len(req);
    const along = rq > 1e-6 ? dot(horiz(f.velocity), scale(req, 1 / rq)) : rq;
    const free = f.representation === 'proxy' && f.controlMode === 'supported' && f.grounded && along >= this.profile.influence.unrestrainedFraction * rq;
    this.infl.freeS = free ? this.infl.freeS + f.dt : 0;
    if (this.infl.freeS >= this.profile.influence.clearAfterSupportedS - 1e-9) {
      this.emit('influenceCleared', this.runnerId, { since: round(this.infl.since, 5), lastSourceT: round(this.infl.lastT, 5), freeS: round(this.infl.freeS, 4), substep: f.substep });
      this.infl = null;
    }
  }

  // ------------------------------------------------------------------ main
  observe(f: RuleFrame): RuleEnding | null {
    const P = this.profile;
    const ball = this.ballRef(f.corePose);
    if (this.ending) {
      // after the event: trace only (the bodies keep settling; the stored event and spot never change)
      const gnd = [...new Set(this.groundTouches(f).map((g) => `${g.label}${g.source === 'poseQuery' ? '?' : ''}`))];
      this.lastRow = { infl: this.infl ? 1 : 0, gnd, ball: rv(ball) as [number, number, number] };
      return this.ending;
    }
    this.updateInfluence(f);
    const touches = this.groundTouches(f);
    const eligible = touches.filter((g) => P.eligibleRegions.includes(g.label));
    const labels = [...new Set(touches.map((g) => `${g.label}${g.source === 'poseQuery' ? '?' : ''}`))];
    // ground-touch observations (begin of each label), with the influence state at that moment
    const now = new Set(labels);
    for (const l of now) if (!this.touching.has(l) && !this.seen.has(l)) {
      this.seen.add(l);
      const g = touches.find((x) => `${x.label}${x.source === 'poseQuery' ? '?' : ''}` === l)!;
      if (g.label !== 'footSupport' && g.label !== 'foot')
        this.emit('groundTouch', this.runnerId, { region: g.label, eligible: P.eligibleRegions.includes(g.label), source: g.source, key: g.key, point: rv(g.point), influence: !!this.infl, representation: f.representation });
    }
    this.touching = now;
    const row: RuleTraceRow = { infl: this.infl ? 1 : 0, gnd: labels, ball: rv(ball) as [number, number, number] };
    this.lastRow = row;
    if (this.disabledReason) return null;

    // ---- labCoreOnly: solved torso/pelvis-ground contact after a valid handoff
    if (P.kind === 'labCoreOnly') {
      const core = touches.find((g) => g.source === 'physical' && (g.label === 'torso' || g.label === 'pelvis'));
      if (core && f.representation === 'ragdoll' && f.validHandoff) return this.end(f, 'runnerCoreDown', ball, [core.key], { region: core.label, point: rv(core.point) });
      return null;
    }

    // ---- groundDown: eligible region touching the ground while defensive influence is active
    if (eligible.length && this.infl) {
      const g = eligible[0];
      return this.end(f, 'groundDown', ball, [g.key, ...this.infl.ids], {
        region: g.label,
        source: g.source,
        point: rv(g.point),
        touching: labels,
        influence: { since: round(this.infl.since, 5), lastSourceT: round(this.infl.lastT, 5), sources: [...this.infl.ids] },
        representation: f.representation,
      });
    }
    if (eligible.length && !this.infl && !this.untouchedReported) {
      this.untouchedReported = true;
      this.emit('groundWithoutInfluence', this.runnerId, { region: eligible[0].label, source: eligible[0].source, note: 'no contacted-runner ending without continuing defensive influence' });
    }

    // ---- sidelineOut: an actual ground touch point (solved contact or verified foot-pose probe) on/over the plane
    if (P.sideline.enabled) {
      const n = P.sideline.outwardNormal;
      for (const g of touches) {
        if (g.label === 'footSupport') continue; // virtual support hemisphere is not a body part
        const s = dot(g.point, n);
        if (s >= P.sideline.offsetM - P.sideline.touchTolM)
          return this.end(f, 'sidelineOut', ball, [g.key], { region: g.label, source: g.source, point: rv(g.point), planeValue: round(s, 5), plane: { outwardNormal: rv(n), offsetM: P.sideline.offsetM, touchTolM: P.sideline.touchTolM } });
      }
    }

    // ---- progressStopped: requested forward movement, physical restraint, no advancement over a continuous window
    if (P.progress.enabled) {
      const pr = P.progress;
      const req = f.controlMode === 'supported' && f.representation === 'proxy' ? dot(horiz(f.request), this.fwd) : 0;
      let ret = v3();
      const retIds: string[] = [];
      for (const r of f.retention) if (len(r.forceOnRunner) > 0) {
        ret = add(ret, r.forceOnRunner);
        retIds.push(r.id);
      }
      const retN = len(ret);
      let bodyOppose = 0;
      const bodyIds: string[] = [];
      for (const o of f.opponentContacts) {
        const F = scale(o.normalFromOther, o.impulse / f.dt);
        const opp = -dot(F, this.fwd);
        if (opp > 0) {
          bodyOppose += opp;
          bodyIds.push(`contact:${o.other}:${o.otherClass}>${o.ownClass}`);
        }
      }
      const restrained = retN >= pr.minRestraintN || bodyOppose >= pr.minRestraintN;
      const fb = dot(ball, this.fwd);
      const predicates = { requestMps: round(req, 4), retentionN: round(retN, 2), bodyOpposeN: round(bodyOppose, 2) };
      if (req >= pr.minRequestMps && restrained) {
        if (!this.win) this.win = { episodeT: f.t, startT: f.t, startTick: f.tick, anchor: fb, best: fb, bestPoint: ball, ids: new Set(), resets: 0, logged: false };
        if (!this.win.logged && f.t - this.win.episodeT >= EPISODE_LOG_S - 1e-9) {
          this.win.logged = true;
          this.emit('progressWindow', this.runnerId, { phase: 'start', episodeStartT: round(this.win.episodeT, 5), ...predicates, ballForwardM: round(fb, 5), shortEpisodesBefore: this.shortEpisodes });
          this.shortEpisodes = 0;
        }
        for (const id of [...retIds, ...bodyIds]) this.win.ids.add(id);
        if (fb > this.win.best) {
          this.win.best = fb;
          this.win.bestPoint = ball;
        }
        const adv = this.win.best - this.win.anchor;
        row.prog = { req: round(req, 3), res: round(Math.max(retN, bodyOppose), 1), adv: round(adv, 4), win: round(f.t - this.win.startT, 4) };
        if (adv > pr.maxAdvanceM) {
          // meaningful advancement: the observation window restarts from here (logged when a window had built up)
          const w = f.t - this.win.startT;
          if (w >= 0.1) this.emit('progressWindow', this.runnerId, { phase: 'reset', reason: 'advanced', advanceM: round(adv, 4), windowS: round(w, 4), ...predicates });
          this.win = { ...this.win, startT: f.t, startTick: f.tick, anchor: fb, best: fb, bestPoint: ball, ids: new Set([...retIds, ...bodyIds]), resets: this.win.resets + 1 };
        } else if (f.t - this.win.startT >= pr.windowS - 1e-9) {
          return this.end(f, 'progressStopped', this.win.bestPoint, [...this.win.ids], {
            windowS: round(f.t - this.win.startT, 5),
            windowStartT: round(this.win.startT, 5),
            advanceM: round(adv, 5),
            bestForwardM: round(this.win.best, 5),
            ...predicates,
            thresholds: { windowS: pr.windowS, maxAdvanceM: pr.maxAdvanceM, minRestraintN: pr.minRestraintN, minRequestMps: pr.minRequestMps },
          });
        }
      } else if (this.win && !this.win.logged) {
        this.shortEpisodes++;
        this.win = null;
      } else if (this.win) {
        this.emit('progressWindow', this.runnerId, {
          phase: 'end',
          reason: req < pr.minRequestMps ? 'noForwardRequest' : 'restraintLost',
          episodeS: round(f.t - this.win.episodeT, 4),
          windowS: round(f.t - this.win.startT, 4),
          advanceResets: this.win.resets,
          ...predicates,
        });
        this.win = null;
      }
    }
    return null;
  }

  private end(f: RuleFrame, kind: EndingKind, spot: Vec3, ids: string[], evidence: Record<string, unknown>): RuleEnding {
    this.ending = { kind, profile: this.profile.id, tick: f.tick, substep: f.substep, t: round(f.t, 5), ballSpot: { ...spot }, ids: [...new Set(ids)], evidence };
    this.emit('ruleEnding', this.runnerId, { kind, profile: this.profile.id, ballSpot: rv(spot), ids: this.ending.ids, substep: f.substep, ...evidence });
    return this.ending;
  }
}

/** Exported rule configuration (fixture JSON). */
export function ruleProfileExport(p: RuleProfile): Record<string, unknown> {
  return { ...p, forwardAxis: rv(p.forwardAxis), ballLocal: rv(p.ballLocal), sideline: { ...p.sideline, outwardNormal: rv(p.sideline.outwardNormal) } };
}

