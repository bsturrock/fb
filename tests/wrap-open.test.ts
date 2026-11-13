// Contact motion M3 step 1: the wrapping defender's arms open and close (WRAP_V1, `FixtureDef.wrap`,
// src/sim/controllers/wrap.ts). Measured on the side, front and rear wraps and the wrap that misses, run with the
// profile; each case has its fault twin: the same run with the rule it checks broken (or without the profile) fails for
// that reason.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../src/sim/contracts';
import { WRAP_V1, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { torsoHalf } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { cross, dot, horiz, norm, qRot, sub, v3, UP } from '../src/sim/vec';
import { FIX } from './helpers';

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

const withWrap = (d: FixtureDef, w?: WrapProfile): FixtureDef => {
  const o: FixtureDef = { ...d, wrap: w };
  if (!w) delete o.wrap;
  return o;
};
/** `d` with the defender's line moved `dx` along x (the miss's line is the side wrap's, 0.7 m behind the runner). */
const lineAt = (d: FixtureDef, dx: number): FixtureDef => ({ ...d, players: d.players.map((p) => (p.id === 'D' ? { ...p, initial: { ...p.initial, x: p.initial.x + dx } } : p)) });

interface ArmRun {
  /** The palm's lateral distance outside the carrier's torso (across the approach, m) at the first substep the gap is 0.3 m or less. */
  outsideAtGap: number | null;
  /** First substep the palm or forearm touches the carrier on his flank or back (the palm at or past his torso's near corner) while not closing, and the first close request after it (s). */
  flankTouchS: number | null;
  closeAfterS: number | null;
  /** First touch of the carrier, and first retention (clamp or grip) of him (s). */
  touchS: number | null;
  heldS: number | null;
  phases: string[];
}
interface WrapRun {
  bodyContactS: number | null;
  arms: Record<Side, ArmRun>;
  /** The runner was supported on every substep. */
  runnerUp: boolean;
}

async function wrapRun(def: FixtureDef, untilS: number): Promise<WrapRun> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.() });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const arm = (): ArmRun => ({ outsideAtGap: null, flankTouchS: null, closeAfterS: null, touchS: null, heldS: null, phases: [] });
  const out: WrapRun = { bodyContactS: null, arms: { left: arm(), right: arm() }, runnerUp: true };
  probe = () => {
    if (R.controlMode !== 'supported') out.runnerUp = false;
    // the measures are of the supported defender and the carrier's proxy (a ragdoll's proxy body is out of the world)
    if (D.controlMode !== 'supported' || D.rag || R.rag) return;
    const ob = sim.arms!.obs('D')!;
    const dbg = (D.intent.debug as { arms?: Record<string, { phase: string }> } | undefined)?.arms ?? {};
    const Rc = R.proxy.body.translation();
    const near = norm(horiz(sub(D.proxy.body.translation(), Rc)));
    const side = norm(cross(near, UP));
    const rq = R.proxy.body.rotation();
    const h = torsoHalf(R.body);
    const across = (d: typeof side): number => Math.abs(dot(d, qRot(rq, v3(1, 0, 0)))) * h.x + Math.abs(dot(d, qRot(rq, v3(0, 0, 1)))) * h.z;
    const halfW = across(side);
    // the torso's near corner seen from his centre: a hand at or past it is on the flank (or the back)
    const cornerDeg = (Math.atan2(halfW, across(near)) * 180) / Math.PI;
    const gap = sim.pairGap[pairKey('D', 'R')] ?? 10;
    for (const s of SIDES) {
      const a = out.arms[s];
      const o = ob[s]!;
      const ph = dbg[s]?.phase ?? '';
      if (ph && a.phases[a.phases.length - 1] !== ph) a.phases.push(ph);
      if (out.bodyContactS === null && gap <= 0.3 && a.outsideAtGap === null) a.outsideAtGap = Math.abs(dot(sub(o.palmContactWorld, Rc), side)) - halfW;
      const touching = o.touchingTarget === 'R';
      if (touching && a.touchS === null) a.touchS = sim.t;
      if ((o.clampContactId || o.gripId) && a.heldS === null) a.heldS = sim.t;
      const r = sub(o.palmContactWorld, Rc);
      const azDeg = (Math.atan2(Math.abs(dot(r, side)), dot(r, near)) * 180) / Math.PI;
      if (a.flankTouchS === null && touching && azDeg >= cornerDeg && ph !== 'close' && ph !== 'sustain') a.flankTouchS = sim.t;
      if (a.flankTouchS !== null && a.closeAfterS === null && ph === 'close') a.closeAfterS = sim.t;
    }
    if (out.bodyContactS === null && (sim.contactObs.D ?? []).some((c) => c.other === 'R')) out.bodyContactS = sim.t;
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  sim.dispose();
  return out;
}

const WRAPS = ['L3-F4-twoArm', 'L3-F19-front', 'L3-F19-rear'];
const pre = (id: string): FixtureDef => withWrap(FIX(id));
const v1 = (id: string, w: WrapProfile = WRAP_V1): FixtureDef => withWrap(FIX(id), w);

describe('contact motion M3: the wrapping defender opens a cradle and closes it on a valid touch (WRAP_V1)', () => {
  it('the cradle opens wide of the carrier before contact: at 0.3 m both palms are at least 10 cm outside his torso (the profile\'s 12 cm less 2) in the side, front and rear wraps. The fault twins: the Gate 2 hands (without the profile), and the cradle opened only at contact (leadS 0.02 s, gap 5 cm), are not', async () => {
    const late: WrapProfile = { ...WRAP_V1, open: { ...WRAP_V1.open, leadS: 0.02, gapM: 0.05 } };
    for (const id of WRAPS) {
      const r = await wrapRun(v1(id), 1);
      for (const s of SIDES) expect(r.arms[s].outsideAtGap, `${id} ${s}`).toBeGreaterThanOrEqual(0.1);
      for (const twin of [pre(id), v1(id, late)]) {
        const t = await wrapRun(twin, 1);
        expect(Math.min(...SIDES.map((s) => t.arms[s].outsideAtGap!)), `${id} twin`).toBeLessThan(0.1);
      }
    }
  });

  it('a valid touch closes at once: a palm or forearm meeting the carrier\'s flank or back is answered by the close request on the next substep (constructed: the cradle tight to his flanks, so the hands meet them before they are round); both arms then retain within 30 ms of their first touch in the side, front and rear wraps. The fault twins: without closeOnTouch the tight cradle waits 10 ms or more; without the profile the side wrap\'s right arm does not retain him within 100 ms', async () => {
    const tight: WrapProfile = { ...WRAP_V1, open: { ...WRAP_V1.open, marginM: -0.02 } };
    const r = await wrapRun(v1('L3-F4-twoArm', tight), 1);
    const twin = await wrapRun(v1('L3-F4-twoArm', { ...tight, closeOnTouch: null }), 1);
    const lat = (x: WrapRun): number[] => SIDES.filter((s) => x.arms[s].flankTouchS !== null).map((s) => (x.arms[s].closeAfterS ?? Infinity) - x.arms[s].flankTouchS!);
    expect(lat(r).length).toBeGreaterThan(0);
    for (const l of lat(r)) expect(l).toBeLessThanOrEqual(1 / 240 + 1e-9);
    expect(Math.max(...lat(twin))).toBeGreaterThanOrEqual(0.01);
    for (const id of WRAPS) {
      const w = await wrapRun(v1(id), 1);
      for (const s of SIDES) expect((w.arms[s].heldS ?? Infinity) - w.arms[s].touchS!, `${id} ${s}`).toBeLessThanOrEqual(0.03);
    }
    const g2 = await wrapRun(pre('L3-F4-twoArm'), 1);
    // (it holds him only after he has gone down: not while he is up)
    expect((g2.arms.right.heldS ?? Infinity) - g2.arms.right.touchS!).toBeGreaterThan(0.1);
  });

  it('a miss stays a miss: the side wrap\'s line 0.7 m behind the runner opens the cradle as he goes by, never touches or holds him, and carries the hands again after; the runner stays up. The fault twin: the line 0.4 m nearer meets him, holds him and takes him off his feet', async () => {
    const r = await wrapRun(v1('L3-F19-miss'), 1.25);
    expect(r.runnerUp).toBe(true);
    expect(r.bodyContactS).toBeNull();
    for (const s of SIDES) {
      expect(r.arms[s].touchS, s).toBeNull();
      expect(r.arms[s].heldS, s).toBeNull();
      expect(r.arms[s].phases, s).toEqual(['ready', 'open', 'ready']);
    }
    const hit = await wrapRun(lineAt(v1('L3-F19-miss'), 0.4), 1.25);
    expect(hit.runnerUp).toBe(false);
    expect(SIDES.some((s) => hit.arms[s].heldS !== null)).toBe(true);
  });
});
