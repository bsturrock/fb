import { describe, expect, it } from 'vitest';
import { poseProbe, type PoseDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { DEFAULT_POSE_PROFILE, withClipArmSwing } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { len, lerp, sub, type Vec3 } from '../src/sim/vec';
import { asCaptured, FIX } from './runs';
import { loadState, resumeState } from './state';
import { DEEP_M, depth, drawnShapes, idleBaseline, jointQuats, qAngle, selfPairs, SNAP_RADPS } from './visible';

// Ladder 14b: a composed arm another body has met keeps its swing (SelfClearanceProfile.clipArmSwing,
// CLIP_ARM_HELD_DEPARTURE). As registered, a clip arm whose swing-out found nothing clear took a body-fixed
// alternative, and the continuity step toward it was a departure from the swinging clip target, carried with that target
// across the chest (L3-F16-contactStop D's left forearm through its own trunk at 0.55 s, the user's screenshot), then kept
// for the rest of the run as pushes it could not follow walked the target on (past 1 m). Judged by gross pass-through
// (the user's bar: an arm through the body, not a shallow brush): the drawn forearm or palm past the meter's DEEP_M in the
// player's own measured trunk (past the idle baseline), or the forearm's or hand's bone axis inside the trunk.

const withSwing = (d: FixtureDef): FixtureDef => ({ ...d, selfClearance: withClipArmSwing(d.selfClearance!) });
const baseline = idleBaseline(FIX('L3-F13-free'));

interface ArmPeak {
  peak: number;
  peakT: number;
  /** The arm's layer at the peak: a clip arm's variant (0 primary) and its shown departure (m). */
  variant: number | null;
  departure: number;
  /** Seconds past 2 cm, and of those after the player's first inter-player contact. */
  over2S: number;
  over2AfterS: number;
  /** The deepest the forearm's or hand's bone axis (elbow-wrist, wrist-palm) goes inside the own trunk (m). */
  axis: number;
}
interface Watched {
  arms: Record<string, ArmPeak>;
  firstContact: number;
  /** The fastest shoulder or elbow turn between consecutive supported frames (rad/s), where. */
  snap: { w: number; at: string };
}

type Drawn = ReturnType<typeof drawnShapes>[number];
const I = { x: 0, y: 0, z: 0, w: 1 };
/** A bone axis as a drawn capsule of 1 mm radius. */
const axisShape = (a: Vec3, b: Vec3): Drawn => ({ key: 'axis', cls: 'forearm', seg: { a, b, r: 1e-3 }, p: lerp(a, b, 0.5), q: I, c: lerp(a, b, 0.5), r: len(sub(b, a)) / 2 + 1e-3 }) as Drawn;
/** How deep the forearm's or hand's bone axis of `side` goes inside the drawn trunk pieces (m). */
function axisIn(pose: NonNullable<Simulation['players'][number]['pose']>, trunk: Drawn[], side: 'left' | 'right'): number {
  const lm = pose.jointLandmarksWorld as Record<string, Vec3>;
  let d = 0;
  for (const ax of [axisShape(lm[`${side}Elbow`], lm[`${side}Wrist`]), axisShape(lm[`${side}Wrist`], lm[`${side}Palm`])]) for (const t of trunk) d = Math.max(d, depth(ax, t));
  return d;
}

/** Steps `sim` to the end: per supported arm its forearm / palm depth in its own trunk past the idle baseline. */
async function watch(sim: Simulation, seen: Record<string, { v: number; shown: { x: number; y: number; z: number } | null }>): Promise<Watched> {
  const base = (await baseline).fat;
  const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
  const dt = sim.def.solver.outerTickS;
  const arms: Record<string, ArmPeak> = {};
  const over: { key: string; t: number }[] = [];
  const prevQ = new Map<string, ReturnType<typeof jointQuats>>();
  let snap = { w: 0, at: '' };
  while (!sim.done) {
    for (const k of Object.keys(seen)) delete seen[k];
    sim.stepTick();
    for (const p of sim.players) {
      if (!p.pose || p.representation === 'ragdoll' || !p.body.measured?.trunkHull) {
        prevQ.delete(p.id);
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
        const a = (arms[key] ??= { peak: 0, peakT: 0, variant: null, departure: 0, over2S: 0, over2AfterS: 0, axis: 0 });
        a.axis = Math.max(a.axis, axisIn(p.pose, trunk, side));
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

/** L3-F16-contactStop resumed from 0.30 s (before D's left arm meets the runner's carry arm and ball at 0.35 s), as captured or with `variant` applied to its self-clearance. */
async function contactStop(variant?: (d: FixtureDef) => FixtureDef, pose?: PoseDebug): Promise<Watched> {
  const seen: Record<string, { v: number; shown: { x: number; y: number; z: number } | null }> = {};
  const probe = poseProbe({ trace: (k, r) => void (seen[k] = r as unknown as (typeof seen)[string]) });
  const cap = loadState('tests/data/state/L3-F16-contactStop@18.json.gz');
  const d0 = asCaptured(cap);
  const sim = await resumeState(cap, { def: variant ? variant(d0) : d0, ...(variant ? { variant: ['selfClearance'] } : {}), faults: { poseProbe: probe, ...(pose ? { pose } : {}) } });
  const w = await watch(sim, seen);
  sim.dispose();
  return w;
}

/** Each drawn landmark of every player, every tick, of `a` and `b` in lockstep: the first difference (null: none). */
async function firstDifference(a: FixtureDef, b: FixtureDef, pose?: PoseDebug): Promise<{ t: number; player: string; arm: string; task: boolean } | null> {
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

describe('ladder 14b: a composed arm another body has met keeps its swing (clipArmSwing)', () => {
  it('L3-F16-contactStop from 0.30 s, the user\'s screenshot (0.55 s): as registered (the fault twin) the defender\'s left forearm, in a body-fixed alternative 0.67 m off its clip target, passes 10 cm into its own trunk at 0.567 s (4 ms before the first contact), its bone axis inside the trunk; with clipArmSwing no forearm or palm of either player passes through its own trunk (none past DEEP_M, no forearm or hand axis inside it), the defender\'s left not past 2 cm', async () => {
    const reg = await contactStop();
    expect(reg.firstContact).toBeCloseTo(0.5708, 3);
    const dl = reg.arms['D:left'];
    expect(dl.peak).toBeGreaterThan(DEEP_M);
    expect(dl.peakT).toBeCloseTo(0.5667, 3);
    expect(dl.peakT).toBeLessThan(reg.firstContact);
    expect(dl.variant).toBeGreaterThan(0);
    expect(dl.departure).toBeGreaterThan(0.5);
    expect(dl.axis).toBeGreaterThan(0.03);
    const on = await contactStop(withSwing);
    for (const a of Object.values(on.arms)) {
      expect(a.peak).toBeLessThan(DEEP_M);
      expect(a.axis).toBeLessThanOrEqual(0.01);
    }
    expect(on.arms['D:left'].peak).toBeLessThanOrEqual(0.02);
    expect(on.arms['D:left'].axis).toBe(0);
  }, 120000);

  it('no snap: with clipArmSwing, in L3-F7-mirror0 (the defender\'s right arm let go of the runner from 0.55 s) no supported shoulder or elbow turns faster than 60 rad/s between frames, the departure let go as fast as the clip moves; the fault twin, the departure let go at once, snaps (the defender\'s right shoulder at 0.567 s)', async () => {
    const run = async (pose?: PoseDebug): Promise<Watched> => {
      const seen: Record<string, { v: number; shown: { x: number; y: number; z: number } | null }> = {};
      const probe = poseProbe({ trace: (k, r) => void (seen[k] = r as unknown as (typeof seen)[string]) });
      const sim = await Simulation.create(withSwing(FIX('L3-F7-mirror0')), { debug: { poseProbe: probe, ...(pose ? { pose } : {}) } });
      const w = await watch(sim, seen);
      sim.dispose();
      return w;
    };
    expect((await run()).snap.w).toBeLessThanOrEqual(SNAP_RADPS);
    const twin = await run({ clipArmSwingAtOnce: true });
    expect(twin.snap.w).toBeGreaterThan(SNAP_RADPS);
    expect(twin.snap.at).toBe('D rightShoulder 0.567');
  }, 120000);

  it('what nothing has met is unchanged: the free run\'s carry tuck (L3-F18-runLab), the grips (L3-F4-gripBoth) and the two-palm hold (L4-F5-twoPalm-on) run identically with clipArmSwing; in the wrap (L4-F10-wrap-on) and the hold (L3-F6-hold) the first difference is a composed arm, not an arm task. The fault twin, the rules on for every composed arm (not only one another body has met), changes the carry tuck', async () => {
    for (const id of ['L3-F18-runLab', 'L3-F4-gripBoth', 'L4-F5-twoPalm-on']) expect(await firstDifference(FIX(id), withSwing(FIX(id)))).toBeNull();
    for (const id of ['L4-F10-wrap-on', 'L3-F6-hold']) {
      const d = await firstDifference(FIX(id), withSwing(FIX(id)));
      expect(d).not.toBeNull();
      expect(d!.task).toBe(false);
    }
    const twin = await firstDifference(FIX('L3-F18-runLab'), withSwing(FIX('L3-F18-runLab')), { clipArmSwingUngated: true });
    expect(twin).toMatchObject({ player: 'R', arm: 'right', task: false });
  }, 240000);
});
