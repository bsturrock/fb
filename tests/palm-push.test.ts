// Plan 16, the palm push (`PalmPushProfile`, `ArmIntent` action `push`; src/sim/arms.ts): a palm on another player's chest
// or the fronts of his shoulders that pushes along the arm as a held patch. No registered fixture uses it. Constructed
// runs: two model-body men (the L3-F6-hold defender's setup: body, motor, profiles) facing each other,
// script controllers, an arm profile with PALM_PUSH_V1. Each case has its fault twin (`SimDebug.arm`, a wider band, the
// forearm clamp in its place, or the recorded pair with the owner's half dropped).
import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmScriptSegment, ScriptSegment } from '../src/sim/controllers/base';
import type { ArmSide } from '../src/sim/contracts';
import type { ArmDebug } from '../src/sim/debug';
import type { FixtureDef, PlayerSetup } from '../src/sim/fixture';
import type { ForceLedgerEntry } from '../src/sim/arms';
import { DEFAULT_POSE_PROFILE, PALM_PUSH_V1, shoulderLocal, type ArmProfile, type PalmPushProfile } from '../src/sim/profiles';
import { poseOfRb } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { add, dot, len, scale, sub, toLocal, toWorld, v3, type Pose, type Vec3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';
import { drawnShapes } from './visible';
import { LIMB_HELD_M } from './visible-bar';

const SIDES: ArmSide[] = ['left', 'right'];
/** Model body: the torso box's front is 0.215 m ahead of the origin. */
const CHEST_FRONT_M = 0.215;

interface Man {
  /** Push request speed toward the other (m/s) from `fromS` (default 1.2), and drive effort (default 1). */
  push: number;
  fromS?: number;
  effort?: number;
  /** Later request speed toward the other (m/s, negative: away) from `thenS`. */
  then?: { fromS: number; mps: number };
  /** Arm request: `push` (default), the forearm clamp's `close` (the probe's clamp), or none. */
  arms?: 'push' | 'clamp' | 'none';
  /** Palm aim in the other's frame (height above his origin, half spread, depth). */
  aim?: { y: number; x: number; z: number };
}

interface PairOpts {
  A: Man;
  B: Man;
  /** Origin-to-origin distance at t = 0 (m; default 0.9) and B's lateral offset (m, world x). */
  sep?: number;
  offsetX?: number;
  /** B faces away from A (A pushes his back). */
  bTurned?: boolean;
  durationS: number;
  palmPush?: PalmPushProfile;
  /** The arm profile's force budgets in place of the defender's. */
  hold?: ArmProfile['hold'];
}

const AIM = { y: 0.45, x: 0.12, z: 0.12 };

/** Two men from the L3-F6-hold defender (as the plan 16 probe built them): A at -z facing +z, B at +z facing -z. */
function pair(o: PairOpts): FixtureDef {
  const d = FIX('L3-F6-hold');
  const D = d.players.find((p) => p.id === 'D')!;
  const sep = o.sep ?? 0.9;
  const man = (id: 'A' | 'B', m: Man): PlayerSetup => {
    const sign = id === 'A' ? 1 : -1;
    const turned = id === 'B' && o.bTurned;
    const facing = v3(0, 0, turned ? -sign : sign);
    const toward = (mps: number) => v3(0, 0, sign * mps);
    const e = m.effort ?? 1;
    const segments: ScriptSegment[] = [
      { fromS: 0, velocity: v3(), facing, effort: 0.5 },
      { fromS: 0.2, velocity: toward(0.3), facing, effort: e },
      { fromS: m.fromS ?? 1.2, velocity: toward(m.push), facing, effort: e },
      ...(m.then ? [{ fromS: m.then.fromS, velocity: toward(m.then.mps), facing, effort: e }] : []),
    ];
    const A = m.aim ?? AIM;
    const kind = m.arms ?? 'push';
    const arms: ArmScriptSegment[] =
      kind === 'none'
        ? []
        : SIDES.flatMap((side): ArmScriptSegment[] => {
            const pt = (z: number) => ({ frame: 'focus' as const, point: v3(side === 'right' ? A.x : -A.x, A.y, z) });
            return kind === 'push'
              ? [{ fromS: 0.2, side, action: 'push' }].map((s) => ({ ...s, target: pt(A.z) }) as ArmScriptSegment)
              : [
                  { fromS: 0.2, side, action: 'reach', target: pt(0.2) },
                  { fromS: 0.8, side, action: 'close', target: pt(0.02) },
                ];
          });
    return {
      ...D,
      id,
      role: 'defender',
      initial: { x: id === 'B' ? (o.offsetX ?? 0) : 0, z: (-sign * sep) / 2, yawDeg: id === 'A' ? 0 : turned ? 0 : 180 },
      arms: { enabled: { left: true, right: true }, mode: { left: 'forearmClamp', right: 'forearmClamp' }, acquisition: true, closeEffortScale: 1 },
      controller: { kind: 'script', segments, ...(arms.length ? { arms } : {}) },
    };
  };
  const { brace: _b, ...rest } = d;
  return {
    ...rest,
    id: 'L3-T16-palmPush',
    title: 'plan 16 palm push (test)',
    durationS: o.durationS,
    area: { halfX: 8, halfZ: 8 },
    focus: { A: 'B', B: 'A' },
    armProfile: { ...d.armProfile!, palmPush: o.palmPush ?? PALM_PUSH_V1, ...(o.hold ? { hold: o.hold } : {}) },
    players: [man('A', o.A), man('B', o.B)],
  };
}

interface Run {
  sim: Simulation;
  t: number[];
  /** Per substep: each arm's push force (N, 0 without a push) and whether it held one. */
  force: Record<string, number[]>;
  held: Record<string, boolean[]>;
  /** Chest-to-chest gap (m: origin distance less the two torso fronts) and relative yaw (deg, 0 facing square). */
  gap: number[];
  yaw: number[];
  /** Push ledger entries, each with the pair's work over its solve (J) and the arm's rest and shoulder-to-patch lengths. */
  pushes: (ForceLedgerEntry & { t: number; workJ: number; restM: number; armM: number })[];
  /** Owner budget bookkeeping per substep (A): the push forces' sum and the allocator's demand. */
  ownerSum: number[];
  ownerDemand: number[];
  /**
   * Per tick, per pushing arm: the shown palm contact landmark's distance from the patch (m) and its depth inside the
   * patch's surface (m, along its normal), and the drawn palm ball's signed distance to the pushed man's drawn trunk (m,
   * negative inside).
   */
  palmGap: { t: number; key: string; off: number; inside: number; d: number }[];
  supportedTo: Record<string, number>;
  events: { t: number; type: string; id: string; data: Record<string, unknown> }[];
}

const yawOf = (q: { x: number; y: number; z: number; w: number }): number => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));

/** The signed distance (m) from a ball to the nearest of some drawn trunk pieces. */
function ballGap(c: Vec3, r: number, trunk: ReturnType<typeof drawnShapes>): number {
  const ball = new RAPIER.Ball(r);
  let best = Infinity;
  for (const t of trunk) {
    if (!t.shape) continue;
    const h = t.shape.contactShape(t.p, t.q, ball, c, { x: 0, y: 0, z: 0, w: 1 }, 0.5);
    if (h && h.distance < best) best = h.distance;
  }
  return best;
}

async function run(def: FixtureDef, arm?: ArmDebug, opts: { ledger?: boolean; palms?: boolean } = {}): Promise<Run> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.(), ...(arm ? { debug: { arm } } : {}) });
  const A = (sim as unknown as { arms: { keepLedger: boolean; ledger: ForceLedgerEntry[] } }).arms;
  if (opts.ledger) A.keepLedger = true;
  const out: Run = { sim, t: [], force: {}, held: {}, gap: [], yaw: [], pushes: [], ownerSum: [], ownerDemand: [], palmGap: [], supportedTo: {}, events: [] };
  for (const p of sim.players) for (const s of SIDES) {
    out.force[`${p.id}:${s}`] = [];
    out.held[`${p.id}:${s}`] = [];
  }
  const body = (id: string) => {
    const p = sim.players.find((x) => x.id === id)!;
    return p.rag ? p.rag.bodies.core : p.proxy.body;
  };
  // body poses after the last substep (the next one's start) for the pair's work
  let prev = new Map<number, Pose>();
  probe = () => {
    out.t.push(sim.t);
    const a = body('A').translation();
    const b = body('B').translation();
    out.gap.push(Math.hypot(a.x - b.x, a.z - b.z) - 2 * CHEST_FRONT_M);
    let dy = ((yawOf(body('A').rotation()) - yawOf(body('B').rotation())) * 180) / Math.PI - (def.players[1].initial.yawDeg === 0 ? 0 : 180);
    while (dy > 180) dy -= 360;
    while (dy < -180) dy += 360;
    out.yaw.push(dy);
    let sum = 0;
    for (const p of sim.players) for (const s of SIDES) {
      const k = `${p.id}:${s}`;
      const f = sim.arms!.lastForce.get(k);
      const F = f && f.kind === 'push' ? f.actual : 0;
      out.force[k].push(F);
      out.held[k].push(!!sim.arms!.pushOf(p.id, s));
      if (p.id === 'A') sum += F;
    }
    out.ownerSum.push(sum);
    out.ownerDemand.push(sim.arms!.lastAllocation.get('A')?.sumDemand ?? 0);
    if (opts.ledger) {
      for (const e of A.ledger) {
        if (e.kind !== 'push') continue;
        const own = sim.players.find((p) => p.id === e.owner)!;
        const tgt = sim.players.find((p) => p.id === e.target)!;
        const rbO = own.proxy.body;
        const rbT = tgt.proxy.body;
        const moved = (rb: typeof rbO, pt: Vec3): Vec3 => {
          const pre = prev.get(rb.handle) ?? poseOfRb(rb);
          return sub(toWorld(poseOfRb(rb), toLocal(pre, pt)), pt);
        };
        const workJ = dot(e.forceOnTarget, moved(rbT, e.pointOnTarget)) + dot(e.forceOnOwner, moved(rbO, e.pointOnOwner));
        // the strut's rest length and its shoulder-to-patch length (at the substep's start: the force's)
        const pu = sim.arms!.pushOf(e.owner, e.arm);
        const sh = toWorld(prev.get(rbO.handle) ?? poseOfRb(rbO), shoulderLocal(own.body, e.arm));
        out.pushes.push({ ...e, t: sim.t, workJ, restM: pu?.restM ?? NaN, armM: len(sub(e.pointOnOwner, sh)) });
      }
      A.ledger.length = 0;
    }
    prev = new Map(sim.players.filter((p) => !p.rag).map((p) => [p.proxy.body.handle, poseOfRb(p.proxy.body)]));
    for (const p of sim.players) if (p.controlMode === 'supported' && !p.rag) out.supportedTo[p.id] = sim.t;
  };
  await runSim(sim, Infinity, (s) => {
    if (!opts.palms) return;
    const R = s.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    for (const p of s.players) for (const side of SIDES) {
      const pu = s.arms!.pushOf(p.id, side);
      const tgt = pu ? s.players.find((x) => x.id === pu.targetId) : undefined;
      if (!pu || !tgt || !p.pose || !tgt.pose) continue;
      const palm = drawnShapes(p.pose, p.body, R).find((x) => x.cls === 'palm' && x.side === side)!;
      const trunk = drawnShapes(tgt.pose, tgt.body, R).filter((x) => x.cls === 'trunk');
      const shown = s.arms!.obs(p.id)![side]!.palmContactWorld;
      out.palmGap.push({ t: s.t, key: `${p.id}:${side}`, off: len(sub(shown, pu.pointWorld)), inside: dot(sub(pu.pointWorld, shown), pu.normalWorld), d: ballGap(palm.c, palm.r, trunk) });
    }
  });
  out.events = sim.events.filter((e) => /^push/.test(e.type)).map((e) => ({ t: e.t, type: e.type, id: `${e.playerId}:${e.data?.arm as string}`, data: e.data ?? {} }));
  sim.dispose();
  return out;
}

const memo = new Map<string, Promise<Run>>();
const once = (key: string, f: () => Promise<Run>): Promise<Run> => {
  if (!memo.has(key)) memo.set(key, f());
  return memo.get(key)!;
};
const window = (r: Run, from: number, to: number): number[] => r.t.flatMap((t, i) => (t >= from && t <= to ? [i] : []));
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const count = (r: Run, type: string, id?: string): number => r.events.filter((e) => e.type === type && (!id || e.id === id)).length;

// Two men pushing each other square on at a 0.3 m/s request, B 3 cm off centre (the plan 16 probe's nudge). At 1 m/s the
// arms carry the push, but the force at shoulder height leans both men back until the balance torque saturates and one
// goes over: standing against it is the block controller's (stance, lean), not the palm's.
const nudge = (arms: Man['arms'] = 'push'): FixtureDef => pair({ A: { push: 0.3, arms }, B: { push: 0.3, arms }, offsetX: 0.03, durationS: 6 });
// A presses B, then B backs off at 0.8 m/s from 2.5 s until he is out of A's reach.
const backOff = (): FixtureDef => pair({ A: { push: 0.3 }, B: { push: 0, arms: 'none', then: { fromS: 2.5, mps: -0.8 } }, durationS: 4 });
// A drives into B (3 m/s request) with both palms; B holds his ground.
const hard = (hold?: ArmProfile['hold']): FixtureDef => pair({ A: { push: 3 }, B: { push: 3 }, durationS: 2.5, ...(hold ? { hold } : {}) });

describe('plan 16, the palm push (PALM_PUSH_V1, no registered fixture)', () => {
  it('(a) a constant press holds a steady force: from 2 s to the end each palm pushes unbroken, one push each, no substep jump past 2 N and its 0.25 s means within 25 % of its mean; with the patch unheld (re-born from each substep\'s palm contact, as a clamp is) it chatters', async () => {
    const steady = (r: Run): string[] => {
      const bad: string[] = [];
      const idx = window(r, 2, 6);
      for (const k of Object.keys(r.force)) {
        const f = idx.map((i) => r.force[k][i]);
        const m = mean(f);
        let jump = 0;
        for (let i = 1; i < f.length; i++) jump = Math.max(jump, Math.abs(f[i] - f[i - 1]));
        const quarter: number[] = [];
        for (let i = 0; i + 60 <= f.length; i += 60) quarter.push(mean(f.slice(i, i + 60)));
        const spread = Math.max(...quarter) - Math.min(...quarter);
        if (count(r, 'pushBegin', k) !== 1 || count(r, 'pushEnd', k) !== 0) bad.push(`${k}: ${count(r, 'pushBegin', k)} begins, ${count(r, 'pushEnd', k)} ends`);
        if (!(m > 15)) bad.push(`${k}: mean ${m.toFixed(1)} N`);
        if (jump > 2) bad.push(`${k}: substep jump ${jump.toFixed(1)} N`);
        if (spread > 0.25 * m) bad.push(`${k}: 0.25 s means spread ${spread.toFixed(1)} N of ${m.toFixed(1)}`);
        if (idx.some((i) => !r.held[k][i])) bad.push(`${k}: not held throughout`);
      }
      return bad;
    };
    const on = await once('nudge', () => run(nudge()));
    expect(steady(on)).toEqual([]);
    const off = await run(nudge(), { pushUnheld: true });
    const bad = steady(off);
    expect(bad.some((b) => /begins/.test(b))).toBe(true);
    expect(Math.min(...Object.keys(off.force).map((k) => count(off, 'pushBegin', k)))).toBeGreaterThan(100);
  });

  it('(b) two men pushing each other with two palms each stay apart at about arm\'s length (chests 0.25-0.45 m apart from 2 s), square (within 5 deg) and on their feet for 6 s under a 3 cm asymmetry; with forearm clamps in their place they come chest to chest', async () => {
    const holds = (r: Run): string[] => {
      const bad: string[] = [];
      const idx = window(r, 2, 6);
      const g = idx.map((i) => r.gap[i]);
      if (Math.min(...g) < 0.25 || Math.max(...g) > 0.45) bad.push(`chest gap ${Math.min(...g).toFixed(3)}-${Math.max(...g).toFixed(3)} m`);
      const y = Math.max(...idx.map((i) => Math.abs(r.yaw[i])));
      if (y > 5) bad.push(`yaw ${y.toFixed(1)} deg`);
      for (const id of ['A', 'B']) if (!((r.supportedTo[id] ?? 0) >= 6 - 1e-6)) bad.push(`${id} supported to ${r.supportedTo[id]}`);
      return bad;
    };
    const on = await once('nudge', () => run(nudge()));
    expect(holds(on)).toEqual([]);
    const clamp = await run(nudge('clamp'));
    expect(holds(clamp).some((b) => /chest gap/.test(b))).toBe(true);
  });

  it('(c) equal and opposite: every push\'s pair is opposite forces at one point (no net force, no net torque); the recorded pairs with the owner\'s half dropped are not', async () => {
    const r = await once('backOff', () => run(backOff(), undefined, { ledger: true }));
    const unpaired = (es: ForceLedgerEntry[]): number => es.filter((e) => len(add(e.forceOnTarget, e.forceOnOwner)) > 1e-9 * Math.max(1, len(e.forceOnTarget)) || len(sub(e.pointOnTarget, e.pointOnOwner)) > 1e-12).length;
    const loaded = r.pushes.filter((e) => e.actual > 1);
    expect(loaded.length).toBeGreaterThan(500);
    expect(unpaired(r.pushes)).toBe(0);
    expect(unpaired(loaded.map((e) => ({ ...e, forceOnOwner: scale(e.forceOnOwner, 0) })))).toBe(loaded.length);
  });

  it('(d) energy: once B starts backing away the push is passive: the pairs\' net work on the two men never exceeds the strut\'s elastic energy then (stiffness times compression, shoulder to patch, at the rest length); a push set from its length at birth (not the arm\'s compression) gives energy from nowhere', async () => {
    const K = PALM_PUSH_V1.stiffness;
    const excess = (r: Run): number => {
      let worst = -Infinity;
      for (const side of SIDES) {
        const es = r.pushes.filter((e) => e.owner === 'A' && e.arm === side && e.t >= 2.5);
        if (!es.length) return Infinity;
        const stored = 0.5 * K * Math.max(0, es[0].restM - es[0].armM) ** 2;
        let cum = 0;
        for (const e of es) worst = Math.max(worst, (cum += e.workJ) - stored);
      }
      return worst;
    };
    const on = await once('backOff', () => run(backOff(), undefined, { ledger: true }));
    expect(on.pushes.filter((e) => e.t >= 2.5).length).toBeGreaterThan(20);
    expect(excess(on)).toBeLessThanOrEqual(0.02);
    const off = await run(backOff(), { pushConstant: true }, { ledger: true });
    expect(excess(off)).toBeGreaterThan(2);
  });

  it('(e) never pulls: as B backs away each push\'s force on him points away from A until it lets go out of reach (`unreachable`); with the strut let go below zero it pulls him', async () => {
    const pulls = (r: Run): number => r.pushes.filter((e) => dot(e.forceOnTarget, v3(0, 0, 1)) < -1e-9).length;
    const on = await once('backOff', () => run(backOff(), undefined, { ledger: true }));
    expect(on.pushes.length).toBeGreaterThan(500);
    expect(pulls(on)).toBe(0);
    for (const side of SIDES) expect(on.events.filter((e) => e.type === 'pushEnd' && e.id === `A:${side}`).map((e) => e.data.reason)).toEqual(['unreachable']);
    const off = await run(backOff(), { pushPulls: true }, { ledger: true });
    expect(pulls(off)).toBeGreaterThan(20);
  });

  it('(f) budgets with two hands on: with an owner budget (400 N) and arm ceiling (250 N) below what a hard press asks, each arm stays within its ceiling and the two within the budget; with the push applied as demanded they pass both', async () => {
    const H = { ...FIX('L3-F6-hold').armProfile!.hold, ownerBudgetN: 400, perArmCeilingN: 250 };
    const over = (r: Run): { arm: number; owner: number; asked: number } => ({
      arm: Math.max(...SIDES.flatMap((s) => r.force[`A:${s}`])),
      owner: Math.max(...r.ownerSum),
      asked: Math.max(...r.ownerDemand),
    });
    const on = over(await run(hard(H)));
    expect(on.asked).toBeGreaterThan(H.ownerBudgetN * 1.2);
    expect(on.arm).toBeLessThanOrEqual(H.perArmCeilingN + 1e-6);
    expect(on.owner).toBeLessThanOrEqual(H.ownerBudgetN + 1e-6);
    const off = over(await run(hard(H), { pushNoBudget: true }));
    expect(off.arm).toBeGreaterThan(H.perArmCeilingN * 1.1);
    expect(off.owner).toBeGreaterThan(H.ownerBudgetN * 1.1);
  });

  it('(g) the palm on the surface: under a hard press the shown palm (its contact landmark) stays on the patch, within the surface tolerance (1.5 cm), and the drawn palm never in his drawn chest past the visible bar (5 cm); shown at the strut\'s rest length it is inside his chest', async () => {
    const tol = FIX('L3-F6-hold').armProfile!.surfaceTolM;
    const worst = (r: Run): { off: number; inside: number; drawnIn: number } => ({
      off: Math.max(...r.palmGap.map((p) => p.off)),
      inside: Math.max(...r.palmGap.map((p) => p.inside)),
      drawnIn: Math.max(...r.palmGap.map((p) => -p.d)),
    });
    const on = await once('hard', () => run(hard(), undefined, { palms: true }));
    expect(on.palmGap.length).toBeGreaterThan(100);
    const w = worst(on);
    expect(w.off).toBeLessThanOrEqual(tol);
    expect(w.drawnIn).toBeLessThanOrEqual(LIMB_HELD_M);
    const off = worst(await run(hard(), { pushPalmAtRest: true }, { palms: true }));
    expect(off.inside).toBeGreaterThan(2 * tol);
  });

  it('(h) where it lands: a palm on the belly (below the ribs), at the throat, on the helmet or on his back is refused (no push, its reason given), and a man out of reach is never pushed; with a band of the whole body each in reach is a push, and the man in reach is', async () => {
    const WIDE: PalmPushProfile = { ...PALM_PUSH_V1, band: { regions: ['torso', 'pelvis', 'head', 'support', 'capsule'], lowM: -2, highM: 2, frontMinDot: -2 } };
    const rows: { name: string; aim: Man['aim']; turned?: boolean; why: RegExp | null; sep?: number; walk?: number }[] = [
      { name: 'belly', aim: { y: 0.22, x: 0.1, z: 0.12 }, why: /outsideBand/ },
      { name: 'throat', aim: { y: 0.65, x: 0.05, z: 0.12 }, why: /outsideBand/ },
      { name: 'helmet', aim: { y: 0.8, x: 0.05, z: 0.05 }, why: /region/ },
      { name: 'back', aim: { y: 0.45, x: 0.12, z: -0.12 }, turned: true, why: /notFront/ },
      // standing still 1.5 m off: the palm never reaches him (the twin: 0.9 m off)
      { name: 'out of reach', aim: AIM, why: null, sep: 1.5, walk: 0 },
    ];
    // from 1.5 m off A raises his hands to the aim and walks in, so the palm meets him level
    const def = (row: (typeof rows)[number], wide: boolean) =>
      pair({ A: { push: row.walk ?? 0.5, fromS: 0.6, aim: row.aim }, B: { push: 0, arms: 'none' }, sep: wide && row.why === null ? 0.9 : (row.sep ?? 1.5), bTurned: row.turned, durationS: 2.5, ...(wide ? { palmPush: WIDE } : {}) });
    const bad: string[] = [];
    for (const row of rows) {
      const on = await run(def(row, false));
      const begin = on.events.find((e) => e.type === 'pushBegin');
      if (begin) bad.push(`${row.name}: pushed ${JSON.stringify(begin.data)}`);
      const rej = on.events.filter((e) => e.type === 'pushRejected' && e.id.startsWith('A:'));
      if (row.why && !rej.some((e) => row.why!.test(String(e.data.reasons)))) bad.push(`${row.name}: refusals ${[...new Set(rej.map((e) => e.data.reasons))].join(' | ') || 'none'}`);
      if (!row.why && rej.length) bad.push(`${row.name}: touched him`);
      const off = await run(def(row, true));
      if (count(off, 'pushBegin') === 0) bad.push(`${row.name}: no push with the wide band (or in reach): ${[...new Set(off.events.filter((e) => e.type === 'pushRejected').map((e) => e.data.reasons))].join(' | ')}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
