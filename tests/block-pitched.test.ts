// Plan 16 (p45): the palms landing on a pitched man's chest (`BlockProfile.aimThrough`, `PalmPushProfile.stanceCone`). A
// state captured in BL-F10-twoPointVsThree at the snap (3.3 s; both rules on), the two-point man A firing out pitched
// 40-46 deg, resumed with the rules and without them (the defender B's over hands aimed 8 cm into A's chest along its
// normal and the arm line judged against it as it stands, as before p45), and with each alone. With its fault twins.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p45), the palms landing on a pitched chest', () => {
  // (the snap; B's palms first meet A's chest at 3.73-3.74 s)
  const CAPTURE_S = 3.3;
  const END_S = 4.0;
  function scene(cone: boolean, through: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    // (the p45 lanes and leverage off: the captured moment is from before them, A's under hands and B's over)
    const d = blockScene({ ...s, id: 'BL-T-pitched', durationS: 4.4, aimThrough: true, stanceCone: true, lanes: false, insideLeverage: false }, FIX('L3-F6-hold'));
    // a twin keeps the capture's profile ids, its rule off
    return {
      ...d,
      armProfile: cone ? d.armProfile : { ...d.armProfile!, palmPush: { ...d.armProfile!.palmPush!, stanceCone: undefined } },
      players: through ? d.players : d.players.map((p) => (p.controller?.kind === 'block' ? { ...p, controller: { ...p.controller, profile: { ...p.controller.profile!, aimThrough: undefined } } } : p)),
    } as FixtureDef;
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(true, true));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Landing {
    /** B's first touch on A (his first palm refused or born), and his first palm push born on A (s; null: none by END_S) */
    touch: number | null;
    born: number | null;
    /** the arms born then, and their height up A's frame (m) */
    arms: string[];
    yLocal: number[];
    /** why his palms were refused before it */
    refused: string[];
  }
  async function run(cone: boolean, through: boolean): Promise<Landing> {
    const sim = await resumeState(await captured(), { def: scene(cone, through) });
    const n0 = sim.events.length;
    while (!sim.done && sim.t < END_S - 1e-9) sim.stepTick();
    const ev = sim.events.slice(n0).filter((e) => e.playerId === 'B' && (e.data as { target?: string }).target === 'A');
    sim.dispose();
    const begins = ev.filter((e) => e.type === 'pushBegin');
    const born = begins[0]?.t ?? null;
    const first = begins.filter((e) => e.t === born);
    const refusals = ev.filter((e) => e.type === 'pushRejected' && (born === null || e.t < born));
    const touch = Math.min(born ?? Infinity, ...refusals.map((e) => e.t));
    return {
      touch: Number.isFinite(touch) ? touch : null,
      born,
      arms: first.map((e) => (e.data as { arm: string }).arm).sort(),
      yLocal: first.map((e) => (e.data as { yLocal: number }).yLocal),
      refused: [...new Set(refusals.flatMap((e) => (e.data as { reasons: string }).reasons.split(',')))].sort(),
    };
  }

  it("the fire-out resumed from the snap with both rules: both of B's palms land on A's pitched chest at his first touch, in the band, none refused; fault twins: with neither, or with either alone, his palms are refused at the first touch and land 0.1 s or more later", async () => {
    const on = await run(true, true);
    expect(on.touch, 'on: B touches A').not.toBeNull();
    expect(on.born, 'on: landed at the first touch').toBe(on.touch);
    expect(on.arms, 'on: both palms').toEqual(['left', 'right']);
    for (const y of on.yLocal) expect(y >= 0.3 && y <= 0.58, `on: in the band (${y})`).toBe(true);
    expect(on.refused, 'on: none refused').toEqual([]);
    for (const [cone, through, what] of [
      [false, false, 'neither'],
      [true, false, 'the stance cone alone'],
      [false, true, 'the aim through alone'],
    ] as const) {
      const off = await run(cone, through);
      expect(off.touch, `fault (${what}): B touches A`).not.toBeNull();
      expect(off.touch!, `fault (${what}): no sooner than with both`).toBeGreaterThanOrEqual(on.touch! - 0.02);
      expect(off.refused, `fault (${what}): refused facing away`).toContain('notFacing');
      expect((off.born ?? END_S) - off.touch!, `fault (${what}): refused 0.1 s or more`).toBeGreaterThanOrEqual(0.1);
    }
  }, 180_000);
});
