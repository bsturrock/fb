// Contact motion polish 2.3, the drag-down (`WrapBind.linked`, `WrapBindLinked`, src/sim/controllers/wrap.ts; the rule in
// `Simulation.boundLegs`): a tackler who has left his feet holding on is clause (a)'s holder while his live fall links hold
// the carrier at or below the centre of his pelvis box; held so for `linked.confirmS` the carrier is bound. WRAP_V6 (the
// low strike, on WRAP_V10 since the drag-down; no fixture uses it). Each case is a constructed run from the start (the rear
// wrap under a flag-off profile; the long rear approach; the miss): a capture taken before the hold under the low strike
// on V8 cannot be resumed under it (its arm system has no fall link, its controller no fault object), and the half second
// before the hold costs little. Each has its fault twin: the profile without the field or with one of its numbers
// changed, or the rule's or the link's own test broken (`SimDebug.wrap`).
import { describe, expect, it } from 'vitest';
import { WRAP_V10, WRAP_V6, type WrapBindLinked, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import type { SimOptions, Simulation } from '../src/sim/simulation';
import { dot, horiz, norm, vc, type Vec3 } from '../src/sim/vec';
import { create, FIX } from './helpers';

const LK = WRAP_V6.bind!.linked!;

/** A variant of `w` whose `bind.linked` is `linked` (undefined: none), its own id. */
function withLinked(w: WrapProfile, linked: WrapBindLinked | undefined, tag: string): WrapProfile {
  const { linked: _l, ...bind } = w.bind!;
  return { ...w, id: `${w.id}-${tag}`, bind: linked ? { ...bind, linked } : bind };
}

interface DragRun {
  /** The carrier's 'boundLegs' loss (time, clause, the clock's age, the links counted), and his first loss of any kind. */
  bound: { t: number; clause: string; heldS: number; linked?: number; holder: string } | null;
  loss: { t: number; reason: string } | null;
  /** The tackler's switch, the fall links begun on the carrier and their ends (reason, time). */
  dSwitch: number | null;
  links: number;
  ends: { t: number; reason: string }[];
  /** The carrier supported at `checkAt` (absent: half a second after the tackler's switch); his speed along his travel at the tackler's switch and the most after it while up. */
  upAt: boolean | null;
  v0: number | null;
  vMax: number;
  /** His posture request at his last supported substep: lean (rad) and how far along his horizontal velocity. */
  lean: number;
  along: number;
}

type Make = (opts: SimOptions) => Promise<Simulation>;

async function dragRun(make: Make, checkAt?: number, untilS = Infinity): Promise<DragRun> {
  let hook: (() => void) | null = null;
  const sim = await make({ onSubstep: () => hook?.() });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out: DragRun = { bound: null, loss: null, dSwitch: null, links: 0, ends: [], upAt: null, v0: null, vMax: -Infinity, lean: 0, along: 0 };
  let u: Vec3 | null = null;
  const probe = (): void => {
    if (out.dSwitch === null && D.controlMode !== 'supported') out.dSwitch = sim.t;
    const at = checkAt ?? (out.dSwitch !== null ? out.dSwitch + 0.5 : Infinity);
    if (out.upAt === null && sim.t >= at - 1e-9) out.upAt = R.controlMode === 'supported';
    if (R.controlMode !== 'supported') return;
    const v = horiz(vc(R.proxy.body.linvel()));
    if (out.dSwitch !== null) {
      u ??= norm(v);
      out.v0 ??= dot(v, u);
      out.vMax = Math.max(out.vMax, dot(v, u));
    }
    const pr = R.intent.posture;
    out.lean = pr?.leanRad ?? 0;
    out.along = pr?.leanDirWorld ? dot(norm(horiz(pr.leanDirWorld)), norm(v)) : 0;
  };
  hook = probe;
  while (!sim.done && sim.t < untilS) sim.stepTick();
  for (const e of sim.events) {
    const d = e.data as { reason: string; ok?: boolean; target?: string; bind?: { clause: string; heldS: number; linked?: number; holder: string } };
    if (e.type === 'fallLinkBegin' && e.playerId === 'D' && d.ok && d.target === 'R') out.links++;
    if (e.type === 'fallLinkEnd' && e.playerId === 'D') out.ends.push({ t: e.t, reason: d.reason });
    if (e.type !== 'lossOfSupport' || e.playerId !== 'R') continue;
    out.loss ??= { t: e.t, reason: d.reason };
    if (d.reason === 'boundLegs' && !out.bound) out.bound = { t: e.t, ...d.bind! };
  }
  sim.dispose();
  return out;
}

/** L3-F19-rear (the registered rear wrap: the tackler from behind) under `wrap`, with fault switches. */
function rear(wrap: WrapProfile, faults?: WrapDebug): Make {
  return (opts) => create({ ...FIX('L3-F19-rear'), wrap }, { ...opts, ...(faults ? { debug: { wrap: faults } } : {}) });
}

/** L3-F19-rear with the wrapping defender starting `m` further back along his line (the long rear approach), reversed order. */
function longRear(wrap: WrapProfile, m: number): Make {
  const d0 = FIX('L3-F19-rear');
  const def: FixtureDef = {
    ...d0,
    wrap,
    players: d0.players.map((p) => {
      if (p.controller.kind !== 'wrapAttempt') return p;
      const v = p.initial.velocity!;
      const n = Math.hypot(v.x, v.z);
      return { ...p, initial: { ...p.initial, x: p.initial.x - (v.x / n) * m, z: p.initial.z - (v.z / n) * m } };
    }),
    area: { ...d0.area, halfX: d0.area.halfX + m, halfZ: d0.area.halfZ + m },
  };
  return (opts) => create(def, { ...opts, reverseOrder: true });
}

describe('contact motion polish 2.3, the drag-down (WRAP_V6, WrapBind.linked)', () => {
  it('(i) a tackler hanging on low from behind binds the carrier (the rear wrap under WRAP_V6): he leaves his feet as the hold is secure with both clamps under the carrier\'s pelvis, two fall links begin, and once they have held the confirm time the carrier goes down, boundLegs clause (a) with the hanging holder and two links, before any other loss, his speed along his travel never 0.3 m/s over what it was, his posture request leaning 12 deg along his travel meanwhile. The twin: WRAP_V6 without the field leaves him supported 0.5 s later', async () => {
    const on = await dragRun(rear(WRAP_V6), undefined, 1.5);
    expect(on.dSwitch).not.toBeNull();
    expect(on.links).toBe(2);
    expect(on.bound, JSON.stringify(on.loss)).not.toBeNull();
    expect(on.loss!.reason).toBe('boundLegs');
    expect(on.bound!).toMatchObject({ clause: 'a', linked: 2, holder: 'D' });
    expect(on.bound!.heldS).toBeGreaterThanOrEqual(LK.confirmS - 1e-6);
    expect(on.bound!.t - on.dSwitch!).toBeGreaterThanOrEqual(LK.confirmS - 1e-6);
    expect(on.bound!.t - on.dSwitch!).toBeLessThan(LK.confirmS + 0.02);
    expect(on.vMax - on.v0!).toBeLessThan(0.3);
    expect(on.lean).toBeCloseTo((WRAP_V6.bind!.leanDeg * Math.PI) / 180, 9);
    expect(on.along).toBeGreaterThan(0.99);
    const twin = await dragRun(rear(withLinked(WRAP_V6, undefined, 'unlinked')), on.bound!.t + 0.5, on.bound!.t + 0.55);
    expect(twin.links).toBe(2);
    expect(twin.bound).toBeNull();
    expect(twin.upAt).toBe(true);
  }, 120_000);

  it('(ii) a link above the pelvis never binds (the torso-height rear wrap, the field on with one link enough): the tackler hangs on one link at the carrier\'s torso and no boundLegs comes of it; WRAP_V10 as registered has no field. The fault twin: with the links\' point test off (bindLinkAnyHeight) the same hold binds him by it', async () => {
    expect(WRAP_V10.bind!.linked).toBeUndefined();
    const one = withLinked(WRAP_V10, { confirmS: LK.confirmS, minLinks: 1 }, 'linked1');
    const on = await dragRun(rear(one), undefined, 1.6);
    expect(on.links).toBeGreaterThan(0);
    expect(on.bound).toBeNull();
    const twin = await dragRun(rear(one, { bindLinkAnyHeight: true }), undefined, 1.6);
    expect(twin.bound).not.toBeNull();
    expect(twin.bound!).toMatchObject({ clause: 'a', linked: 1 });
  }, 120_000);

  it('(iii) a link that has ended never binds (the rear wrap under WRAP_V6, the confirm time made longer than the links last together): the left link breaks on overload before the clock reaches it and no boundLegs comes, then or later. The fault twin: with the link\'s break rules off (fallLinkNoBreak) both hold and he is bound once held that long', async () => {
    const long = withLinked(WRAP_V6, { confirmS: 0.5, minLinks: 2 }, 'confirm05');
    const on = await dragRun(rear(long), undefined, 2.5);
    expect(on.links).toBe(2);
    expect(on.ends.some((e) => e.reason === 'overload' && e.t < on.dSwitch! + 0.5), JSON.stringify(on.ends)).toBe(true);
    expect(on.bound).toBeNull();
    const twin = await dragRun(rear(long, { fallLinkNoBreak: true }), undefined, 2.5);
    expect(twin.ends).toEqual([]);
    expect(twin.bound).not.toBeNull();
    expect(twin.bound!).toMatchObject({ clause: 'a', linked: 2 });
    expect(twin.bound!.t - twin.dSwitch!).toBeGreaterThanOrEqual(0.5 - 1e-6);
  }, 120_000);

  it('(iv) a touch that is not a hold never binds: on the long rear approach (2 m further back, reversed order) the tackler commits with one arm clamped and the other only touching, so one link begins and the carrier is not bound (still up 0.5 s after); the miss under WRAP_V6 makes no link and no loss. The twin: with one link enough (minLinks 1) the long approach binds him by it', async () => {
    const on = await dragRun(longRear(WRAP_V6, 2), undefined, 3);
    expect(on.links).toBe(1);
    expect(on.bound).toBeNull();
    expect(on.upAt).toBe(true);
    const m = await dragRun((opts) => create({ ...FIX('L3-F19-miss'), wrap: WRAP_V6 }, opts));
    expect(m.links).toBe(0);
    expect(m.loss).toBeNull();
    const twin = await dragRun(longRear(withLinked(WRAP_V6, { confirmS: LK.confirmS, minLinks: 1 }, 'linked1'), 2), undefined, 3);
    expect(twin.bound).not.toBeNull();
    expect(twin.bound!).toMatchObject({ clause: 'a', linked: 1 });
  }, 180_000);
});
