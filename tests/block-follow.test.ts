// Plan 16 (p45): the follow-through (`BlockProfile.followThrough`, `ContestHit.untilStraight`, `withFollowThrough`). A
// state captured in BL-F10-twoPointVsThree (the landing on a pitched chest on, p45) just before the contact, the defender
// B's palms about to land first and take the first collision, resumed with the follow-through on both men, without it
// (as before), and with either half alone. With its fault twins.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p45), the follow-through', () => {
  // (contact at 3.74 s, B's palms on at it)
  const CAPTURE_S = 3.7;
  const END_S = 4.6;
  function scene(follow: boolean, straight = follow): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    // (the p45 lanes off: the captured moment is from before them, A's under hands and B's over)
    const d = blockScene({ ...s, id: 'BL-T-follow', durationS: END_S + 0.1, aimThrough: true, stanceCone: true, followThrough: true, lanes: false }, FIX('L3-F6-hold'));
    // a twin keeps the capture's profile ids, its half off
    return {
      ...d,
      players: d.players.map((p) => {
        const P = p.controller?.kind === 'block' ? p.controller.profile! : undefined;
        if (!P || p.controller?.kind !== 'block') return p;
        const C = P.contest!;
        return { ...p, controller: { ...p.controller, profile: { ...P, followThrough: follow ? true : undefined, contest: { ...C, hit: { ...C.hit!, untilStraight: straight ? true : undefined } } } } };
      }),
    } as FixtureDef;
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(true));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    /** B's first palm push on A from the capture (s), and how long his palms stayed on A without a break from it, within 0.8 s (s) */
    born: number | null;
    onS: number;
    /** why the first of them ended (null: on to the end) */
    end: string | null;
    falls: string[];
  }
  async function run(follow: boolean, straight = follow): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(follow, straight) });
    const n0 = sim.events.length;
    let born: number | null = null;
    let off: number | null = null;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const on = (['left', 'right'] as const).some((s) => sim.arms!.pushOf('B', s)?.targetId === 'A');
      if (on && born === null) born = sim.t;
      if (!on && born !== null && off === null) off = sim.t;
    }
    const ev = sim.events.slice(n0);
    sim.dispose();
    const end = ev.find((e) => e.type === 'pushEnd' && e.playerId === 'B' && (e.data as { target?: string }).target !== 'B');
    return {
      born,
      onS: born === null ? 0 : Math.min(0.8, (off ?? END_S) - born),
      end: off === null ? null : ((end?.data as { reason?: string } | undefined)?.reason ?? '?'),
      falls: ev.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}:${(e.data as { reason?: string }).reason}`),
    };
  }

  it("the contact resumed with the follow-through: B's palms, first on, stay on A for 0.8 s as A is knocked back, nobody falls; fault twins: without it, or with either half alone, B's palms come off A within 0.5 s of landing", async () => {
    const on = await run(true);
    expect(on.born, 'on: B lands').not.toBeNull();
    expect(on.onS, 'on: on for 0.8 s').toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    // (neither and following alone: off out of reach 0.27 s after landing; the punch until straight alone: let go at
    // 0.47 s, and A falls overpowered)
    for (const [f, s, what] of [
      [false, false, 'neither'],
      [true, false, 'following alone'],
      [false, true, 'the punch until straight alone'],
    ] as const) {
      const off = await run(f, s);
      expect(off.born, `fault (${what}): B lands`).toBe(on.born);
      expect(off.onS, `fault (${what}): off within 0.5 s`).toBeLessThan(0.5);
    }
  }, 180_000);
});
