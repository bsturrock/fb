// What a run does with its supported arms, for the met-arm tests (ladder 14b, tests/clip-arm-swing.test.ts; 16b,
// tests/met-arm-stay.test.ts): per arm, how deep its forearm and palm go into its own trunk, its bone axes inside its
// own trunk and head, the variant it shows, its largest one-frame move and how high its palm goes; and the first
// difference between two runs.
import { poseProbe, type PoseDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { dist, len, lerp, qInvRot, sub, type Vec3 } from '../src/sim/vec';
import { FIX } from './runs';
import { depth, drawnShapes, idleBaseline, jointQuats, qAngle, segDist, selfPairs } from './visible';

const baseline = idleBaseline(FIX('L3-F13-free'));

export interface ArmPeak {
  peak: number;
  peakT: number;
  /** The arm's layer at the peak: a composed arm's variant (0 its request) and its shown departure (m). */
  variant: number | null;
  departure: number;
  /** Seconds past 2 cm, and of those after the player's first inter-player contact. */
  over2S: number;
  over2AfterS: number;
  /** The deepest the forearm's or hand's bone axis (elbow-wrist, wrist-palm) goes inside the own trunk (m). */
  axis: number;
  /** The deepest the forearm's or hand's bone axis goes inside the own head (m), and when. */
  head: number;
  headT: number;
  /** Frames the composed arm showed each variant (0 its request, 1-8 the body-fixed alternatives). */
  variants: Record<number, number>;
  /** The largest move of its elbow, wrist or palm between consecutive supported frames, in the core's frame (m). */
  jump: number;
  jumpAt: string;
  /** The highest its palm goes above the core, in the core's frame (m), and when. */
  palmUp: number;
  palmUpT: number;
}
export interface Watched {
  arms: Record<string, ArmPeak>;
  firstContact: number;
  /** The fastest shoulder or elbow turn between consecutive supported frames (rad/s), where. */
  snap: { w: number; at: string };
}
export type Seen = Record<string, { v: number; shown: { x: number; y: number; z: number } | null }>;
/** A pose probe that keeps each arm's last trace in `seen`. */
export const armProbe = (seen: Seen) => poseProbe({ trace: (k, r) => void (seen[k] = r as unknown as Seen[string]) });

type Drawn = ReturnType<typeof drawnShapes>[number];
const I = { x: 0, y: 0, z: 0, w: 1 };
/** A bone axis as a drawn capsule of 1 mm radius. */
const axisShape = (a: Vec3, b: Vec3): Drawn => ({ key: 'axis', cls: 'forearm', seg: { a, b, r: 1e-3 }, p: lerp(a, b, 0.5), q: I, c: lerp(a, b, 0.5), r: len(sub(b, a)) / 2 + 1e-3 }) as Drawn;
type Pose = NonNullable<Simulation['players'][number]['pose']>;
/** How deep the forearm's or hand's bone axis of `side` goes inside the drawn trunk pieces (m). */
function axisIn(pose: Pose, trunk: Drawn[], side: 'left' | 'right'): number {
  const lm = pose.jointLandmarksWorld as Record<string, Vec3>;
  let d = 0;
  for (const ax of [axisShape(lm[`${side}Elbow`], lm[`${side}Wrist`]), axisShape(lm[`${side}Wrist`], lm[`${side}Palm`])]) for (const t of trunk) d = Math.max(d, depth(ax, t));
  return d;
}
/** How deep the forearm's or hand's bone axis of `side` goes inside the head ball (m). */
function headIn(pose: Pose, headR: number, side: 'left' | 'right'): number {
  const lm = pose.jointLandmarksWorld as Record<string, Vec3>;
  if (!lm.headCenter) return 0;
  const d = Math.min(segDist(lm[`${side}Elbow`], lm[`${side}Wrist`], lm.headCenter, lm.headCenter), segDist(lm[`${side}Wrist`], lm[`${side}Palm`], lm.headCenter, lm.headCenter));
  return Math.max(0, headR - d);
}
const coreFrame = (pose: Pose, side: 'left' | 'right'): Record<string, Vec3> => {
  const core = pose.segments.core;
  const lm = pose.jointLandmarksWorld as Record<string, Vec3>;
  const out: Record<string, Vec3> = {};
  for (const n of ['Elbow', 'Wrist', 'Palm']) out[n] = qInvRot(core.rotationWorld, sub(lm[`${side}${n}`], core.originWorld));
  return out;
};

/** Steps `sim` to the end (or `untilT`): per supported arm what ArmPeak records; `seen` is filled by `armProbe(seen)`. */
export async function watch(sim: Simulation, seen: Seen, untilT = Infinity): Promise<Watched> {
  const base = (await baseline).fat;
  const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
  const dt = sim.def.solver.outerTickS;
  const arms: Record<string, ArmPeak> = {};
  const over: { key: string; t: number }[] = [];
  const prevQ = new Map<string, ReturnType<typeof jointQuats>>();
  const prevL = new Map<string, Record<string, Vec3>>();
  let snap = { w: 0, at: '' };
  while (!sim.done && sim.t < untilT - 1e-9) {
    for (const k of Object.keys(seen)) delete seen[k];
    sim.stepTick();
    for (const p of sim.players) {
      if (!p.pose || p.representation === 'ragdoll' || !p.body.measured?.trunkHull) {
        prevQ.delete(p.id);
        for (const side of ['left', 'right']) prevL.delete(`${p.id}:${side}`);
        continue;
      }
      const Q = jointQuats(p.pose);
      const pq = prevQ.get(p.id);
      if (pq)
        for (const j of ['leftShoulder', 'leftElbow', 'rightShoulder', 'rightElbow']) {
          const w = qAngle(pq[j], Q[j]) / dt;
          if (w > snap.w) snap = { w, at: `${p.id} ${j} ${sim.t.toFixed(3)}` };
        }
      prevQ.set(p.id, Q);
      const per: Record<string, number> = {};
      const drawn = drawnShapes(p.pose, p.body, R);
      const trunk = drawn.filter((x) => x.cls === 'trunk');
      for (const pr of selfPairs(drawn)) {
        if (pr.cls !== 'armTrunk') continue;
        const a = pr.a.cls === 'trunk' ? pr.b : pr.a;
        if (a.cls !== 'forearm' && a.cls !== 'palm') continue;
        per[a.side!] = Math.max(per[a.side!] ?? 0, depth(pr.a, pr.b) - (base[`${pr.a.key}~${pr.b.key}`] ?? 0));
      }
      for (const side of ['left', 'right'] as const) {
        const v = per[side] ?? 0;
        const key = `${p.id}:${side}`;
        const tr = seen[`${p.id}:${side}Arm`];
        const a = (arms[key] ??= { peak: 0, peakT: 0, variant: null, departure: 0, over2S: 0, over2AfterS: 0, axis: 0, head: 0, headT: 0, variants: {}, jump: 0, jumpAt: '', palmUp: -Infinity, palmUpT: 0 });
        a.axis = Math.max(a.axis, axisIn(p.pose, trunk, side));
        const h = headIn(p.pose, R.radii.head, side);
        if (h > a.head) Object.assign(a, { head: h, headT: sim.t });
        if (tr) a.variants[tr.v] = (a.variants[tr.v] ?? 0) + 1;
        const L = coreFrame(p.pose, side);
        const pl = prevL.get(key);
        if (pl)
          for (const n of Object.keys(L)) {
            const j = dist(pl[n], L[n]);
            if (j > a.jump) Object.assign(a, { jump: j, jumpAt: `${n} ${sim.t.toFixed(3)}` });
          }
        prevL.set(key, L);
        if (L.Palm.y > a.palmUp) Object.assign(a, { palmUp: L.Palm.y, palmUpT: sim.t });
        if (v > a.peak) Object.assign(a, { peak: v, peakT: sim.t, variant: tr ? tr.v : null, departure: tr?.shown ? len(tr.shown) : 0 });
        if (v > 0.02) over.push({ key, t: sim.t });
      }
    }
  }
  const contact = sim.events.find((e) => e.type === 'contactBegin');
  const firstContact = contact ? contact.t : Infinity;
  for (const o of over) {
    arms[o.key].over2S += dt;
    if (o.t >= firstContact) arms[o.key].over2AfterS += dt;
  }
  return { arms, firstContact, snap };
}

/** Each drawn landmark of every player, every tick, of `a` and `b` in lockstep: the first difference (null: none). */
export async function firstDifference(a: FixtureDef, b: FixtureDef, pose?: PoseDebug): Promise<{ t: number; player: string; arm: string; task: boolean } | null> {
  const seen: Record<string, unknown> = {};
  const A = await Simulation.create(a, {});
  const B = await Simulation.create(b, { debug: { poseProbe: poseProbe({ trace: (k) => void (seen[k] = true) }), ...(pose ? { pose } : {}) } });
  let out: { t: number; player: string; arm: string; task: boolean } | null = null;
  while (!A.done && !B.done && !out) {
    for (const k of Object.keys(seen)) delete seen[k];
    A.stepTick();
    B.stepTick();
    for (let i = 0; i < A.players.length && !out; i++) {
      const pa = A.players[i].pose;
      const pb = B.players[i].pose;
      if (!pa || !pb) continue;
      for (const [k, v] of Object.entries(pa.jointLandmarksWorld)) {
        const w = (pb.jointLandmarksWorld as Record<string, typeof v>)[k];
        if (w && v.x === w.x && v.y === w.y && v.z === w.z) continue;
        const side = /^left/.test(k) ? 'left' : 'right';
        out = { t: Number(A.t.toFixed(4)), player: A.players[i].id, arm: `${side}`, task: !seen[`${A.players[i].id}:${side}Arm`] };
        break;
      }
    }
  }
  A.dispose();
  B.dispose();
  return out;
}
