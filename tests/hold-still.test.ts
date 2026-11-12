import { describe, expect, it } from 'vitest';
import type { ArmSide } from '../src/sim/contracts';
import { FOOTWORK_L3, HOLD_STILL_V1, holdStillAt, initFeet, newFootPlan, observeFeet, planFeet, withHoldStill, type FootEvent, type FootPlan, type FootPlanInput, type FootworkProfile } from '../src/sim/footwork';
import type { FootRequest, PhysicalPose } from '../src/sim/pose';
import type { Simulation } from '../src/sim/simulation';
import { add, qFromAxisAngle, v3, type Vec3 } from '../src/sim/vec';
import { FIX, preHoldStill } from './runs';
import { loadState, resumeState } from './state';

// Ladder 13b: a stationary hold keeps its feet planted (FootworkProfile.holdStill, HOLD_STILL_V1). The rule, as the
// planner and these checks read it (`holdStillAt`): a grip or clamp by or on the player held within lingerS, the body
// travelling under speedMps. In it a planted foot takes no step home, no settle step and no step to turn; a foot that
// cannot keep its plant (reach, a body turned past yawReleaseDeg, a leg that cannot stay clear) still steps.

// ------------------------------------------------------------------- planner substeps on constructed input (no physics)
// The L3 planner on an L3 fixture's ragdoll and shoe, a still body over its home; the solve is synthetic (flat shoes at
// the requested ankles), as in l3-contracts' constructed holds.
const R = FIX('L3-F6-hold').ragdoll!;
const SOLE = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
const TOE = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
const DT = 1 / 240;
const HOME: Record<ArmSide, Vec3> = { left: v3(-0.12, SOLE, 0), right: v3(0.12, SOLE, 0) };
type Ev = FootEvent & { t: number };
interface Case {
  /** The right foot's home moved this far to the side (m) from 0.5 s. */
  homeMoveM?: number;
  /** The body turned about the vertical (deg) from 0.5 s. */
  yawDeg?: number;
  /** Body travel (m/s, along +z; the stance itself stays put). */
  speedMps?: number;
  /** Whether a hold is engaged at substep k. */
  held?: (k: number) => boolean;
}
const input = (t: number, c: Case, moved: boolean): FootPlanInput => {
  const home = moved && c.homeMoveM ? { left: HOME.left, right: add(HOME.right, v3(c.homeMoveM, 0, 0)) } : HOME;
  const yaw = moved && c.yawDeg ? (c.yawDeg * Math.PI) / 180 : 0;
  return {
    t,
    dt: DT,
    core: { p: v3(0, SOLE + 0.85, 0), q: qFromAxisAngle(v3(0, 1, 0), yaw) },
    vel: v3(0, 0, c.speedMps ?? 0),
    yawRate: 0,
    supported: true,
    falling: false,
    ragdoll: false,
    groundY: 0,
    hips: { left: add(HOME.left, v3(0, 0.75, 0)), right: add(HOME.right, v3(0, 0.75, 0)) },
    home,
    request: { left: { ...home.left }, right: { ...home.right } },
    clip: null,
    soleM: SOLE,
    toeM: TOE,
    rightW: v3(Math.cos(yaw), 0, -Math.sin(yaw)),
    sideSign: { left: -1, right: 1 },
  };
};
const I = { x: 0, y: 0, z: 0, w: 1 };
const pose = (ankles: Record<ArmSide, Vec3>): PhysicalPose => {
  const seg = (id: string) => ({ segmentId: id, originWorld: v3(), rotationWorld: I });
  const li = (s: ArmSide) => ({ variant: 0, request: ankles[s], liftM: 0, softM: 0 });
  return {
    playerId: 'T',
    segments: { leftShin: seg('leftShin'), rightShin: seg('rightShin') } as unknown as PhysicalPose['segments'],
    jointLandmarksWorld: { leftAnkle: { ...ankles.left }, rightAnkle: { ...ankles.right } } as unknown as PhysicalPose['jointLandmarksWorld'],
    hingeDeg: {},
    straightFallback: [],
    limbClearance: {},
    legInfo: { left: li('left'), right: li('right') },
  } as unknown as PhysicalPose;
};
const exact = (out: Record<ArmSide, FootRequest>, inp: FootPlanInput): Record<ArmSide, Vec3> => {
  const a = {} as Record<ArmSide, Vec3>;
  for (const s of ['left', 'right'] as const) {
    const r = out[s];
    a[s] = r.kind === 'plant' ? add(r.heelW, v3(0, SOLE, 0)) : r.kind === 'target' ? { ...r.ankleW } : add(inp.request[s], r.offsetW);
  }
  return a;
};
/** The planner over 2.5 s of a still stance under `P`; the releases after the first planted half second. */
function releases(P: FootworkProfile, c: Case): string[] {
  const plan: FootPlan = newFootPlan(P, R);
  const all: Ev[] = [];
  initFeet(plan, pose({ ...HOME }), input(0, c, false), []);
  let t = 0;
  for (let k = 0; k < 240 * 2.5; k++) {
    t += DT;
    const inp = { ...input(t, c, t >= 0.5), held: c.held ? c.held(k) : true };
    const ev: FootEvent[] = [];
    const out = planFeet(plan, inp, ev);
    observeFeet(plan, pose(exact(out, inp)), SOLE, 0, ev, t);
    for (const e of ev) all.push({ ...e, t });
  }
  return all.filter((e) => e.type === 'footRelease' && e.t > 0.5).map((e) => `${e.side} ${(e.data as { reason?: string }).reason}`);
}
const ON = withHoldStill(FOOTWORK_L3);

describe('ladder 13b: a stationary hold keeps its feet planted (HOLD_STILL_V1)', () => {
  it('constructed: in a stationary hold no step home, no settle step and no step to turn (each the fault twin, the planner without it, steps); past the yaw release both release; a travelling or unheld stance steps; the hold lingers over a dropped substep (the twin without the linger steps on it)', () => {
    // a home 0.2 m off (past stepTriggerM 0.14): the fault twin steps toward it
    expect(releases(ON, { homeMoveM: 0.2 })).toEqual([]);
    expect(releases(FOOTWORK_L3, { homeMoveM: 0.2 })).toContain('right step');
    // 0.11 m off (past settleTriggerM 0.09, short of the step trigger): the fault twin settles
    expect(releases(ON, { homeMoveM: 0.11 })).toEqual([]);
    expect(releases(FOOTWORK_L3, { homeMoveM: 0.11 })).toContain('right settle');
    // the body turned 40 deg (past yawTriggerDeg 30, short of yawReleaseDeg 55): the fault twin steps to turn
    expect(releases(ON, { yawDeg: 40 })).toEqual([]);
    expect(releases(FOOTWORK_L3, { yawDeg: 40 }).some((r) => r.endsWith('yaw'))).toBe(true);
    // turned 60 deg: a plant that cannot be kept is released, in a hold too
    expect(releases(ON, { yawDeg: 60 }).some((r) => r.endsWith('yaw'))).toBe(true);
    // a hold travelling at 0.4 m/s (over speedMps 0.3), or a stance not held, steps home as before
    expect(releases(ON, { homeMoveM: 0.2, speedMps: 0.4 }).length).toBeGreaterThan(0);
    expect(releases(ON, { homeMoveM: 0.2, held: () => false })).toContain('right step');
    // a clamp dropped for one substep every 0.1 s and taken again (L3-F6-hold's defender from 1.76 s): the hold lingers
    // over it; the twin without the linger steps on a dropped substep
    const flicker = { homeMoveM: 0.2, held: (k: number) => k % 24 !== 23 };
    expect(releases(ON, flicker)).toEqual([]);
    expect(releases(withHoldStill(FOOTWORK_L3, { ...HOLD_STILL_V1, id: 'no-linger', lingerS: 0 }), flicker)).toContain('right step');
  });

  // ----------------------------------------------------------------- the hold in L3-F6-hold, from a state capture
  /** Every foot release and plant to the end, with whether its player was in a stationary hold at the tick it fell in. */
  async function feet(sim: Simulation): Promise<{ id: string; t: number; type: string; side: string; reason: string; still: boolean }[]> {
    const heldAt: Record<string, number> = {};
    const out: { id: string; t: number; type: string; side: string; reason: string; still: boolean }[] = [];
    let seen = sim.events.length;
    while (!sim.done) {
      sim.stepTick();
      const still: Record<string, boolean> = {};
      for (const p of sim.players) {
        if ((sim as unknown as { retained(p: unknown): boolean }).retained(p)) heldAt[p.id] = sim.t;
        const v = p.proxy.body.linvel();
        still[p.id] = holdStillAt(HOLD_STILL_V1, heldAt[p.id], sim.t, Math.hypot(v.x, v.z));
      }
      for (; seen < sim.events.length; seen++) {
        const e = sim.events[seen];
        if (e.type !== 'footRelease' && e.type !== 'footPlant') continue;
        const d = e.data as { side: string; reason?: string };
        out.push({ id: e.playerId!, t: e.t, type: e.type, side: d.side, reason: d.reason ?? '', still: still[e.playerId!] });
      }
    }
    return out;
  }
  const VOLUNTARY = ['step', 'settle', 'yaw'];

  it('L3-F6-hold from 2.10 s: before the flip (the fault twin) the defender steps in the stationary hold at 2.15 s, its step held off its home sweeps the runner\'s planted left leg off at 3.18 s and that foot plants by the midline at 3.70 s; with the still feet neither player steps home, settles or turns in the hold to the end and the defender\'s left foot keeps its plant', async () => {
    const cap = loadState('tests/data/state/L3-F6-hold@126.json.gz');
    const d = preHoldStill(FIX('L3-F6-hold'));
    const off = await resumeState(cap, { def: d });
    const before = await feet(off);
    off.dispose();
    const at = (l: typeof before, id: string, type: string, side: string) => l.filter((e) => e.id === id && e.type === type && e.side === side).map((e) => `${e.t.toFixed(3)} ${e.reason}`.trim());
    expect(before.filter((e) => e.still && e.type === 'footRelease' && VOLUNTARY.includes(e.reason)).map((e) => `${e.id} ${e.side} ${e.t.toFixed(3)} ${e.reason}`)).toEqual(['D left 2.146 step']);
    expect(at(before, 'R', 'footRelease', 'left')).toEqual(['3.179 clearance']);
    expect(at(before, 'R', 'footPlant', 'left')).toContain('3.696');
    const on = await resumeState(cap, { def: { ...d, footwork: withHoldStill(d.footwork!) }, variant: ['footwork'] });
    const after = await feet(on);
    on.dispose();
    expect(after.filter((e) => e.still && e.type === 'footRelease' && VOLUNTARY.includes(e.reason))).toEqual([]);
    expect(at(after, 'D', 'footRelease', 'left')).toEqual([]);
    expect(at(after, 'D', 'footPlant', 'left')).toEqual([]);
    // what is left is tracked (HOLD_LEG_CLEARANCE, docs/handoff/contact-motion-prerequisites.md): the runner's planted left
    // leg, met by the defender's swaying leg, is released by its clearance solve (forced, not a step the rule holds back)
    expect(after.filter((e) => e.type === 'footRelease').map((e) => `${e.id} ${e.side} ${e.reason}`)).toEqual(['R left clearance']);
  }, 120000);
});
