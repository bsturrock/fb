// Plan 16 (p51), the swiper's elbow (`SwipeArc.twistRadPs`; the arms' `ArmIntent.twistRadPs`): through the swipe his
// upper arm may turn about itself at the swipe's own rate. The arc brings the hand close in front of his shoulder (by his
// ear, then down past it onto his man's forearm), which turns the upper arm about itself fast; held to the everyday twist
// rate the arm's twist window turned the elbow about the shoulder-to-palm line instead, over or under it in one frame. BL-F12-passRush with its first swipe only (B's right hand at A's left arm at
// 4.25 s), resumed from a capture shortly before it, under HANDS_V5: no shoulder of B's turns faster between drawn frames
// than the visible meter's snap (tests/visible.ts) until his hand is back on A. Fault twin: the swipe at the everyday
// twist rate (12 rad/s): his swinging shoulder snaps.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V5, type BlockHandFight } from '../src/sim/controllers/block';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';
import { jointQuats, qAngle, SNAP_RADPS } from './visible';

const F = HANDS_V5;
const A = F.swipe!.arc!;

describe("plan 16 (p51), the swiper's elbow", () => {
  const SWIPE_S = 4.25;
  const CAPTURE_S = 4.15;
  const END_S = 4.85;
  const DT = 1 / 60;
  const scene = (H: BlockHandFight): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F12-passRush')!;
    return blockScene({ ...s, id: 'BL-T-swipeElbow', durationS: END_S + 0.1, B: { ...s.B, swipes: [{ atS: SWIPE_S, hand: 'right' }] }, handFight: H }, FIX('L3-F6-hold'));
  };
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(F));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  /** B's shoulders: the fastest turn between drawn frames (rad/s) from the swipe's start until his hand is back on A; whether it got back on */
  async function run(H: BlockHandFight): Promise<{ maxRadPs: number; backOn: boolean }> {
    const sim = await resumeState(await captured(), { def: scene(H), ...(H === F ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }) });
    const b = sim.players.find((p) => p.id === 'B')!;
    let t0: number | null = null;
    let backOn = false;
    let prev: ReturnType<typeof jointQuats> | null = null;
    let maxRadPs = 0;
    let ev = sim.events.length;
    while (!sim.done && sim.t < END_S - 1e-9 && !backOn) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        if (e.type === 'handSwipe' && e.playerId === 'B') t0 = e.t;
        if (e.type === 'pushBegin' && e.playerId === 'B' && (e.data as { arm?: string }).arm === 'right' && t0 !== null) backOn = true;
      }
      const Q = jointQuats(b.pose!);
      if (t0 !== null && prev) for (const j of ['leftShoulder', 'rightShoulder'] as const) maxRadPs = Math.max(maxRadPs, qAngle(prev[j], Q[j]) / DT);
      prev = Q;
    }
    sim.dispose();
    return { maxRadPs, backOn };
  }

  it('the pass rush: no snap of his shoulder through the swipe; fault twin: the everyday twist rate snaps it', async () => {
    const on = await run(F);
    expect(on.backOn).toBe(true);
    expect(on.maxRadPs).toBeLessThan(SNAP_RADPS);
    const everyday = await run({ ...F, swipe: { ...F.swipe!, arc: { ...A, twistRadPs: 12 } } });
    expect(everyday.maxRadPs).toBeGreaterThan(SNAP_RADPS);
  }, 120_000);
});
