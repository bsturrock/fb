// Contact motion polish 1.4, the bound-legs fall (`WrapProfile.bind`, `WrapBind`, src/sim/controllers/wrap.ts; the rule,
// `Simulation.boundLegs`, where the loss envelope queues a loss): a supported carrier a holder has a secure hold on goes
// down once held round his hips or legs (a), or once his legs cannot step while he is pushed or dragged (b), each for
// `confirmS`. WRAP_V8 (WRAP_V7 with it; registered on L3, L4 and HC from the bound-legs flip to the hold flip, which puts WRAP_V9 on it, and WRAP_V10 from the behind flip, WRAP_V11 from the stay-on flip, WRAP_V12 from the hit flip, WRAP_V13 since the aim flip) and the low
// strike on V8 (tests/runs.ts WRAP_V6_PRE_V10: WRAP_V6 until the drag-down; tests/wrap-drag.test.ts has today's). Each case resumes a
// state capture shortly before the hold, and has its fault twin: the profile without `bind`, or the rule's own test
// broken (`SimDebug.wrap`), fails it for the reason it checks. Plan 15 step 5b: the captures, taken on the reactive
// planner, resume with the contact stepping model taking over the feet (`asCaptured`'s footwork variant); under it
// clause (b) reads the model's bound feet (`legsBound`).
import { describe, expect, it } from 'vitest';
import { WRAP_V13, WRAP_V6, WRAP_V7, WRAP_V8, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { labRun } from '../src/lab/lab-params';
import { legsBound } from '../src/sim/contact-steps';
import type { Simulation } from '../src/sim/simulation';
import { dot, horiz, norm, qInvRot, sub, vc } from '../src/sim/vec';
import { asCaptured, create, FIX, WRAP_V6_PRE_V10 } from './helpers';
import { loadState, resumeState } from './state';

const SIDES = ['left', 'right'] as const;
const BD = WRAP_V8.bind!;

/** A wrap profile without the bound-legs fall (its own id: a twin's profile). */
function unbound(w: WrapProfile): WrapProfile {
  const { bind: _bind, ...rest } = w;
  return { ...rest, id: `${w.id}-unbound` };
}

interface BindRun {
  /** The carrier's 'boundLegs' loss (time, clause, the clock's age), and his first loss of support of any kind. */
  bound: { t: number; clause: string; heldS: number } | null;
  loss: { t: number; reason: string } | null;
  /** The first substep both of the tackler's arms retain on the carrier with each hold under his pelvis box's centre. */
  lowAt: number | null;
  /** The carrier supported at `checkAt` (s). */
  upAt: boolean | null;
  /** The substeps (s) at which his feet were bound (`legsBound`) while supported. */
  legsBoundAt: number[];
}

/** The capture resumed under `wrap` (a profile twin of the one it was `captured` under), its feet on the contact stepping model. */
async function bindRun(capPath: string, captured: WrapProfile, wrap: WrapProfile, o: { checkAt?: number; untilS?: number } = {}): Promise<BindRun> {
  const cap = loadState(capPath);
  const def: FixtureDef = { ...asCaptured(cap, (d) => ({ ...d, wrap: captured }), ['footwork']), wrap };
  let probe: (() => void) | null = null;
  const sim: Simulation = await resumeState(cap, { def, variant: wrap === captured ? ['footwork'] : ['footwork', 'wrap'], opts: { onSubstep: () => probe?.() } });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out: BindRun = { bound: null, loss: null, lowAt: null, upAt: null, legsBoundAt: [] };
  const C = R.body.kind === 'legacyCapsule' ? null : R.body.compound;
  probe = () => {
    const t = sim.t;
    if (o.checkAt !== undefined && out.upAt === null && t >= o.checkAt - 1e-9) out.upAt = R.controlMode === 'supported';
    if (R.controlMode === 'supported' && R.feet && legsBound(R.feet)) out.legsBoundAt.push(t);
    if (R.controlMode !== 'supported' || D.controlMode !== 'supported' || !sim.arms) return;
    const ob = sim.arms.obs(D.id) ?? {};
    const b = R.proxy.body;
    const root = vc(b.translation());
    const q = { ...b.rotation() };
    const on = SIDES.filter((s) => (ob[s]?.clampContactId || ob[s]?.gripId) && ob[s]?.touchingTarget === R.id);
    const lowOf = (s: 'left' | 'right'): boolean => {
      const c = sim.arms!.clampOf(D.id, s);
      const p = c && c.targetId === R.id ? c.pointWorld : ob[s]!.palmContactWorld;
      return !!C && qInvRot(q, sub(p, root)).y <= C.pelvis.center.y;
    };
    if (out.lowAt === null && on.length === 2 && on.every(lowOf)) out.lowAt = t;
  };
  const until = o.untilS ?? Infinity;
  while (!sim.done && sim.t < until) sim.stepTick();
  for (const e of sim.events) {
    if (e.type !== 'lossOfSupport' || e.playerId !== 'R') continue;
    const d = e.data as { reason: string; bind?: { clause: string; heldS: number } };
    out.loss ??= { t: e.t, reason: d.reason };
    if (d.reason === 'boundLegs' && !out.bound) out.bound = { t: e.t, clause: d.bind!.clause, heldS: d.bind!.heldS };
  }
  return out;
}

/** L3-F19-rear under WRAP_V6_PRE_V10 (the lab's wrap=v6 then) at 0.50 s (tick 30), before the low strike's arms close round the carrier's hips (0.59 s). */
const LOW_CAP = 'tests/data/state/L3-F19-rear~wrapv6@30.json.gz';
/** L3-F5-drag under WRAP_V8 at 0.45 s (tick 27), before the tackler's hold is secure (0.48 s). */
const DRAG_CAP = 'tests/data/state/L3-F5-drag~wrapv8@27.json.gz';

describe('polish 1.4, the bound-legs fall (WRAP_V8, WRAP_V6_PRE_V10)', () => {
  it('(a) a secure hold of both arms under his pelvis converts the carrier once held for the confirm time (constructed: the low rear wrap, captured before the arms close): a loss of support, cause boundLegs, clause (a), within a substep and the grace of the confirm time after the hold, before any other loss. The twin: the low strike without bind leaves him supported well past it', async () => {
    const on = await bindRun(LOW_CAP, WRAP_V6_PRE_V10, WRAP_V6_PRE_V10, { untilS: 1.5 });
    expect(on.lowAt).not.toBeNull();
    expect(on.bound).not.toBeNull();
    expect(on.bound!.clause).toBe('a');
    expect(on.loss!.reason).toBe('boundLegs');
    const after = on.bound!.t - on.lowAt!;
    expect(after).toBeGreaterThanOrEqual(BD.confirmS - 1e-6);
    expect(after).toBeLessThanOrEqual(BD.confirmS + WRAP_V8.commit!.graceS + 0.01);
    const twin = await bindRun(LOW_CAP, WRAP_V6_PRE_V10, unbound(WRAP_V6_PRE_V10), { checkAt: on.bound!.t + 0.3, untilS: on.bound!.t + 0.35 });
    expect(twin.bound).toBeNull();
    expect(twin.upAt).toBe(true);
  }, 120_000);

  it('(c) clause (b): a held carrier dragged whose feet cannot follow his hips for the confirm time goes down (the drag wrap): boundLegs clause (b), its clock the confirm time old, his feet bound (`legsBound`) from its start to the bind. The twin: WRAP_V7 (no bind) has no bound-legs loss and leaves him supported past the bind (on the model the ordinary envelope takes him 0.05 s later)', async () => {
    const on = await bindRun(DRAG_CAP, WRAP_V8, WRAP_V8, { untilS: 1.5 });
    expect(on.bound).not.toBeNull();
    expect(on.bound!.clause).toBe('b');
    expect(on.loss!.reason).toBe('boundLegs');
    expect(on.bound!.heldS).toBeGreaterThanOrEqual(BD.confirmS - 1e-6);
    // his feet bound from the clock's start to the bind (the model's reading of clause (b): in the drag from 0.72 s, bound 0.92 s)
    const inClock = on.legsBoundAt.filter((t) => t >= on.bound!.t - on.bound!.heldS - 1e-9 && t <= on.bound!.t + 1e-9);
    expect(inClock.length).toBeGreaterThan(0);
    expect(Math.min(...inClock)).toBeLessThanOrEqual(on.bound!.t - on.bound!.heldS + 0.01);
    expect(Math.max(...inClock)).toBeGreaterThanOrEqual(on.bound!.t - 0.01);
    const twin = await bindRun(DRAG_CAP, WRAP_V8, WRAP_V7, { untilS: 1.5 });
    expect(twin.bound).toBeNull();
    expect(twin.loss === null || twin.loss.t > on.bound!.t + 1e-9, JSON.stringify({ on: on.bound, twin: twin.loss })).toBe(true);
  }, 120_000);

  it('(e) while a clause\'s clock runs the carrier\'s posture request leans toward his travel at the bind\'s lean (the low rear wrap): at his last supported substep the request is 12 deg along his horizontal velocity and his balance target has tipped further toward it. The twin: with no lean request (bindNoLean) the request is his controller\'s and the target tips less', async () => {
    const run = async (faults?: WrapDebug): Promise<{ lean: number; along: number; tip: number; bound: boolean }> => {
      let probe: (() => void) | null = null;
      const sim = await create({ ...FIX('L3-F19-rear'), wrap: WRAP_V6_PRE_V10 }, { ...(faults ? { debug: { wrap: faults } } : {}), onSubstep: () => probe?.() });
      const R = sim.players.find((p) => p.id === 'R')!;
      let last = { lean: 0, along: 0, tip: 0 };
      probe = () => {
        if (R.controlMode !== 'supported') return;
        const v = norm(horiz(vc(R.proxy.body.linvel())));
        const pr = R.intent.posture;
        last = { lean: pr?.leanRad ?? 0, along: pr ? dot(norm(horiz(pr.leanDirWorld)), v) : 0, tip: dot(horiz(R.balance.desiredUp), v) };
      };
      while (!sim.done && R.controlMode === 'supported' && sim.t < 1.2) sim.stepTick();
      const bound = sim.events.some((e) => e.type === 'lossOfSupport' && e.playerId === 'R' && (e.data as { reason: string }).reason === 'boundLegs');
      sim.dispose();
      return { ...last, bound };
    };
    const on = await run();
    expect(on.bound).toBe(true);
    expect(on.lean).toBeCloseTo((BD.leanDeg * Math.PI) / 180, 9);
    expect(on.along).toBeGreaterThan(0.99);
    const twin = await run({ bindNoLean: true });
    expect(twin.bound).toBe(true);
    expect(twin.lean).toBeLessThan((BD.leanDeg * Math.PI) / 180 - 1e-3);
    expect(on.tip).toBeGreaterThan(twin.tip + 0.02);
  }, 120_000);

  it('(d) the bound-legs flip: every L3, L4 and HC wrap fixture registers the bound-legs fall (WRAP_V13 since the aim flip, on WRAP_V12, WRAP_V11, WRAP_V10, WRAP_V9 and WRAP_V8, its own clause (c) added), wrap=v7 runs it with WRAP_V7 (the ride-down, before the flip) and wrap=v6 with WRAP_V6 (the low strike, on V10 since the drag-down, which no fixture registers); wrap=on takes either back to WRAP_V13; G, L1, L2 and RH register no wrap', () => {
    const on = FIX('L3-F19-rear');
    expect(on.wrap).toBe(WRAP_V13);
    expect({ ...on.wrap!.bind, behind: undefined }).toEqual({ ...WRAP_V8.bind, behind: undefined });
    const v7: FixtureDef = { ...on, wrap: WRAP_V7 };
    const v8: FixtureDef = { ...on, wrap: WRAP_V8 };
    expect(labRun(on, new URLSearchParams('wrap=v7'))).toEqual({ def: v7, opts: {}, label: 'wrap v7' });
    expect(labRun(v7, new URLSearchParams('wrap=V7'))).toEqual({ def: v7, opts: {}, label: 'wrap v7 (registered)' });
    expect(labRun(v7, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(v7, new URLSearchParams('wrap=v8'))).toEqual({ def: v8, opts: {}, label: 'wrap v8' });
    expect(labRun(v8, new URLSearchParams('wrap=v8'))).toEqual({ def: v8, opts: {}, label: 'wrap v8 (registered)' });
    expect(labRun(on, new URLSearchParams('wrap=v6')).def.wrap).toBe(WRAP_V6);
    expect(WRAP_V6_PRE_V10.bind).toBe(WRAP_V8.bind);
    expect({ ...WRAP_V6.bind, linked: undefined }).toEqual({ ...WRAP_V8.bind, linked: undefined });
    expect(WRAP_V6.ride).toBe(WRAP_V7.ride);
    const all = allFixtures();
    expect(all.filter((d) => d.wrap && d.wrap.id !== WRAP_V13.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap && !/^(L3|L4|HC)-/.test(d.id)).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.id === WRAP_V13.id).length).toBeGreaterThan(0);
  });
});
