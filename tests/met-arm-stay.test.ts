import { describe, expect, it } from 'vitest';
import type { PoseDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { MET_ARM_STAY_ID, withClipArmSwing, withMetArmStay, withoutMetArmStay } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { armProbe, firstDifference, watch, type Seen, type Watched } from './arm-watch';
import { asCaptured, FIX } from './runs';
import { captureState, loadState, resumeState, type StateCapture } from './state';
import { DEEP_M, SNAP_RADPS } from './visible';

// Ladder 16b: a composed arm another body has met keeps its natural pose (SelfClearanceProfile.metArmStay,
// MET_ARM_FIXED_ALTERNATIVE). As registered, a met arm whose swing-out found nothing clear of the other body took the
// first clear of eight body-fixed alternatives (ARM_ALTS: 1-6 raised, forward or back; 7 and 8 hanging at the side) and
// travelled there; each push-out was kept as the next step's start (L3-F5-drag, the user's report: the carrier's left
// hand, natural at its side when the wrap lands, travels to its facemask and goes haywire). With metArmStay it keeps its
// request while it presses at most HARD_OK into the other body, swings out continuously past that, else hangs at its
// side; only 0, 7 and 8 are ever shown.

const stay = (d: FixtureDef): FixtureDef => ({ ...d, selfClearance: withMetArmStay(d.selfClearance!) });
const RAISED = [1, 2, 3, 4, 5, 6];
const shown = (w: Watched, arm: string): number[] => Object.keys(w.arms[arm].variants).map(Number);

/** A capture resumed to its fixture's end (or `untilT`) under `def` (default: as captured), `variant` its self-clearance. */
async function resume(cap: StateCapture, variant?: (d: FixtureDef) => FixtureDef, pose?: PoseDebug, untilT?: number, def = asCaptured(cap)): Promise<Watched> {
  const seen: Seen = {};
  const sim = await resumeState(cap, { def: variant ? variant(def) : def, ...(variant ? { variant: ['selfClearance'] } : {}), faults: { poseProbe: armProbe(seen), ...(pose ? { pose } : {}) } });
  const w = await watch(sim, seen, untilT);
  sim.dispose();
  return w;
}
/** Fixture `id` run under `stay` to `tick`, captured in memory (resumed under `stay(FIX(id))`). */
async function stayCapture(id: string, tick: number): Promise<StateCapture> {
  const sim = await Simulation.create(stay(FIX(id)), {});
  while (sim.tick < tick) sim.stepTick();
  const cap = captureState(sim);
  sim.dispose();
  return cap;
}

describe('ladder 16b: a composed arm another body has met keeps its natural pose (metArmStay)', () => {
  it('the profile: the id part, the round trip, used by no fixture', () => {
    for (const d of allFixtures()) expect(d.selfClearance?.metArmStay, d.id).toBeUndefined();
    const s = FIX('L3-F5-drag').selfClearance!;
    const on = withMetArmStay(s);
    expect(on).toEqual({ ...s, id: `${s.id}+${MET_ARM_STAY_ID}`, metArmStay: true });
    expect(withMetArmStay(on)).toBe(on);
    expect(withoutMetArmStay(on)).toEqual(s);
  });

  it('L3-F5-drag from 0.35 s, the user\'s report: as registered (the fault twin) the carrier\'s left arm, met by the wrap at 0.40 s, takes the raised alternatives, its palm 0.98 m above its core, its hand through its own head (5 cm, 0.97 s) and its shoulder snapping (116 rad/s at 1.27 s); with metArmStay it stays low (its request, else hanging at its side), its hand never in its head, no snap', async () => {
    const cap = loadState('tests/data/state/L3-F5-drag@21.json.gz');
    const reg = await resume(cap);
    expect(reg.firstContact).toBeCloseTo(0.4, 3);
    const rl = reg.arms['R:left'];
    expect(shown(reg, 'R:left').some((v) => RAISED.includes(v))).toBe(true);
    expect(rl.palmUp).toBeGreaterThan(0.5);
    expect(rl.head).toBeGreaterThan(0.03);
    expect(reg.snap.w).toBeGreaterThan(SNAP_RADPS);
    expect(reg.snap.at).toBe('R leftShoulder 1.267');
    const on = await resume(cap, stay);
    for (const [k, a] of Object.entries(on.arms)) {
      for (const v of Object.keys(a.variants).map(Number)) expect([0, 7, 8], `${k} variant ${v}`).toContain(v);
      expect(a.head, k).toBe(0);
      expect(a.peak, k).toBeLessThan(DEEP_M);
      expect(a.jump, k).toBeLessThan(0.2);
    }
    expect(on.arms['R:left'].palmUp).toBeLessThan(0.1);
    expect(on.snap.w).toBeLessThanOrEqual(SNAP_RADPS);
  }, 120000);

  it('L3-F16-contactStop from 0.30 s: as registered (the fault twin) the defender\'s left forearm, in a raised alternative 0.67 m off its request, passes 10 cm into its own trunk at 0.567 s, its bone axis inside it, and the runner\'s carry arm leaves its tuck for the raised alternatives; with metArmStay no forearm or palm passes through its own trunk (none past DEEP_M, no bone axis more than 2 cm inside it), the defender\'s left only on its request or hanging, the carry arm on its tuck', async () => {
    const cap = loadState('tests/data/state/L3-F16-contactStop@18.json.gz');
    const reg = await resume(cap);
    const dl = reg.arms['D:left'];
    expect(dl.peak).toBeGreaterThan(DEEP_M);
    expect(dl.peakT).toBeCloseTo(0.5667, 3);
    expect(RAISED).toContain(dl.variant);
    expect(dl.axis).toBeGreaterThan(0.03);
    expect(shown(reg, 'R:right').some((v) => RAISED.includes(v))).toBe(true);
    const on = await resume(cap, stay);
    for (const [k, a] of Object.entries(on.arms)) {
      expect(a.peak, k).toBeLessThan(DEEP_M);
      expect(a.axis, k).toBeLessThanOrEqual(0.02);
      for (const v of Object.keys(a.variants).map(Number)) expect([0, 7, 8], `${k} variant ${v}`).toContain(v);
    }
    expect(shown(on, 'R:right')).toEqual([0]);
    expect(on.snap.w).toBeLessThanOrEqual(SNAP_RADPS);
  }, 120000);

  it('no jump: in L3-F7-mirror50 from 0.60 s (the runner\'s left arm let go of the defender, given up toward its trunk and pushed in one substep) no supported elbow, wrist or palm moves 20 cm in a frame, the shown departure moving at most CONT_FAST_MPS; the fault twin, unbounded, jumps (the runner\'s left palm at 0.633 s)', async () => {
    const cap = await stayCapture('L3-F7-mirror50', 36);
    const run = (pose?: PoseDebug) => resume(cap, undefined, pose, 0.8, stay(FIX('L3-F7-mirror50')));
    for (const [k, a] of Object.entries((await run()).arms)) expect(a.jump, k).toBeLessThan(0.2);
    const twin = await run({ metArmUnbounded: true });
    expect(twin.arms['R:left'].jump).toBeGreaterThan(0.2);
    expect(twin.arms['R:left'].jumpAt).toBe('Palm 0.633');
  }, 120000);

  it('no stiff player: in L3-F4-gripBoth from 0.80 s both handoffs, deferred at 0.90 s for overlapping the other body, convert, the met arms pushed out as registered while the handoff is deferred; the fault twin, the arms kept on their rules then, rejects both at the window\'s end and the players stand stiff', async () => {
    const cap = await stayCapture('L3-F4-gripBoth', 48);
    const outcome = async (pose?: PoseDebug): Promise<string[]> => {
      const sim = await resumeState(cap, { def: stay(FIX('L3-F4-gripBoth')), ...(pose ? { faults: { pose } } : {}) });
      while (!sim.done) sim.stepTick();
      const out = sim.players.map((p) => `${p.id}:${p.handoff?.outcome ?? p.controlMode}`);
      expect(sim.events.some((e) => e.type === 'handoffDeferred'), 'deferred').toBe(true);
      sim.dispose();
      return out;
    };
    expect(await outcome()).toEqual(['D:accepted', 'R:accepted']);
    expect(await outcome({ metArmStayDeferred: true })).toEqual(['D:rejected', 'R:rejected']);
  }, 120000);

  it('what nothing has met is unchanged: the free run (L3-F18-runLab) runs identically; in the grips (L3-F4-gripBoth), the two-palm hold (L4-F5-twoPalm-on), the wrap (L4-F10-wrap-on) and the hold (L3-F6-hold) the first difference is a composed arm, not an arm task; with it clipArmSwing changes nothing (L3-F5-drag). The fault twins: the rules on for every composed arm change the free run\'s carry tuck; without it clipArmSwing changes L3-F5-drag', async () => {
    expect(await firstDifference(FIX('L3-F18-runLab'), stay(FIX('L3-F18-runLab')))).toBeNull();
    for (const id of ['L3-F4-gripBoth', 'L4-F5-twoPalm-on', 'L4-F10-wrap-on', 'L3-F6-hold']) {
      const d = await firstDifference(FIX(id), stay(FIX(id)));
      expect(d, id).not.toBeNull();
      expect(d!.task, id).toBe(false);
    }
    const twin = await firstDifference(FIX('L3-F18-runLab'), stay(FIX('L3-F18-runLab')), { clipArmSwingUngated: true });
    expect(twin).toMatchObject({ player: 'R', arm: 'right', task: false });
    const swing = (d: FixtureDef): FixtureDef => ({ ...d, selfClearance: withClipArmSwing(d.selfClearance!) });
    const drag = FIX('L3-F5-drag');
    expect(await firstDifference(stay(drag), stay(swing(drag)))).toBeNull();
    expect(await firstDifference(drag, swing(drag))).not.toBeNull();
  }, 240000);
});
