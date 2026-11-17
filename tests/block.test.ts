// Plan 16, the block controller and its engaged state (controllers/block.ts, BLOCK_V1; simulation.ts `advanceBlock`):
// two model-body defenders from the BL family's package (fixtures/blocking.ts `blockScene` on L3-F6-hold's registered
// definition, as the BL fixtures are made). Constructed short runs, one registered scene (BL-F1-even) whole. Each case
// has its fault twin: a man who does not follow, a block that never punches, arms too short, `SimDebug.block` faults
// (the engaged state taken from the contact, the feet regime not reading it), a swap that leaves the hands on, and the
// hard drive without the hip hinge.
import { describe, expect, it } from 'vitest';
import type { ArmSide, PlayerIntent } from '../src/sim/contracts';
import type { Controller, ControllerContext } from '../src/sim/controllers/base';
import { ScriptController } from '../src/sim/controllers/base';
import { advanceBlockState, BLOCK_V1, type BlockProfile, type BlockState } from '../src/sim/controllers/block';
import type { SimDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { BLOCK_V1_HARD_NO_HINGE, blockScene, type BlockMan, type BlockSceneOpts } from '../src/sim/fixtures/blocking';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { v3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
/** Model body: the torso box's front is 0.215 m ahead of the origin. */
const CHEST_FRONT_M = 0.215;

const man = (o: Partial<BlockMan> = {}): BlockMan => ({ effort: 0.5, intent: 'hold', hands: 'under', ...o });
const scene = (o: Partial<BlockSceneOpts> & { durationS: number }): FixtureDef =>
  blockScene({ id: 'BL-T-block', title: 'plan 16 block (test)', A: man(), B: man({ hands: 'over' }), ...o }, FIX('L3-F6-hold'));
const withProfile = (o: BlockMan, profile: BlockProfile): BlockMan => ({ ...o, profile });

interface Sample {
  t: number;
  /** Chest gap (origin distance less two torso fronts, m); A's facing off the line to B (deg); B across A's line (m). */
  gap: number;
  offDeg: number;
  across: number;
  phase: Record<string, string | undefined>;
  mode: Record<string, string | undefined>;
  held: Record<string, boolean>;
  force: Record<string, number>;
  hingeRad: Record<string, number>;
  supported: Record<string, boolean>;
}

const yawOf = (q: { x: number; y: number; z: number; w: number }): number => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
const body = (p: PlayerRuntime) => (p.rag ? p.rag.bodies.core : p.proxy.body);

/** Runs a scene, sampling every substep; `at` is called each substep with the simulation (swaps, wrappers). */
async function run(def: FixtureDef, debug?: SimDebug, at?: (sim: Simulation) => void): Promise<Sample[]> {
  const out: Sample[] = [];
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    ...(debug ? { debug } : {}),
    onSubstep: () => {
      at?.(sim);
      const [A, B] = ['A', 'B'].map((id) => sim.players.find((p) => p.id === id)!);
      const a = body(A).translation();
      const b = body(B).translation();
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      const line = Math.atan2(dx, dz);
      let off = ((yawOf(body(A).rotation()) - line) * 180) / Math.PI;
      while (off > 180) off -= 360;
      while (off < -180) off += 360;
      const s: Sample = { t: sim.t, gap: dist - 2 * CHEST_FRONT_M, offDeg: off, across: 0, phase: {}, mode: {}, held: {}, force: {}, hingeRad: {}, supported: {} };
      // B across A's own facing (m)
      const ya = yawOf(body(A).rotation());
      s.across = dx * Math.cos(ya) - dz * Math.sin(ya);
      for (const p of [A, B]) {
        s.phase[p.id] = p.block?.phase;
        s.mode[p.id] = p.loco?.mode;
        s.hingeRad[p.id] = p.hinge?.rad ?? 0;
        s.supported[p.id] = p.controlMode === 'supported' && !p.rag;
        for (const side of SIDES) {
          const k = `${p.id}:${side}`;
          s.held[k] = !!sim.arms!.pushOf(p.id, side);
          const f = sim.arms!.lastForce.get(k);
          s.force[k] = f && f.kind === 'push' ? f.actual : 0;
        }
      }
      out.push(s);
    },
  });
  await runSim(sim, Infinity);
  sim.dispose();
  return out;
}

const from = (s: Sample[], t0: number, t1 = Infinity) => s.filter((x) => x.t >= t0 && x.t <= t1);
const fracOf = (s: Sample[], f: (x: Sample) => boolean) => s.filter(f).length / Math.max(1, s.length);

/** A controller that returns another's intent with a change (the tests' wrappers; not in committed source). */
const wrap = (inner: Controller, f: (i: PlayerIntent, ctx: ControllerContext) => PlayerIntent): Controller =>
  Object.assign(Object.create(Object.getPrototypeOf(inner)), inner, { decide: (ctx: ControllerContext) => f(inner.decide(ctx), ctx) });

describe('plan 16, the block controller and its engaged state (BLOCK_V1)', () => {
  it('(a) turns to and follows a man who moves sideways: B walks 1.2 m sideways at 0.6 m/s; A ends facing him within 8 deg and within 0.2 m of square across his line; a man who keeps his facing (a script pushing ahead) is left 1 m off', async () => {
    const sideways = (A: FixtureDef['players'][number]['controller']): FixtureDef => {
      const d = scene({ durationS: 4 });
      const B = d.players[1];
      const segs = [
        { fromS: 0, velocity: v3(), facing: v3(0, 0, -1), effort: 1 },
        { fromS: 1, velocity: v3(0.6, 0, 0), facing: v3(0, 0, -1), effort: 1 },
        { fromS: 3, velocity: v3(), facing: v3(0, 0, -1), effort: 1 },
      ];
      return { ...d, players: [{ ...d.players[0], controller: A }, { ...B, controller: { kind: 'script', segments: segs } }] };
    };
    const blocks = sideways(scene({ durationS: 4 }).players[0].controller);
    const ahead = sideways({
      kind: 'script',
      segments: [{ fromS: 0, velocity: v3(0, 0, 0.1), facing: v3(0, 0, 1), effort: 0.5 }],
      arms: SIDES.map((side) => ({ fromS: 0.2, side, action: 'push' as const, push: { effort: 0.5, lengthM: 0.64 }, target: { frame: 'focus' as const, point: v3(side === 'right' ? 0.09 : -0.09, 0.36, 0.13) } })),
    });
    for (const [def, follows] of [[blocks, true], [ahead, false]] as const) {
      const s = await run(def);
      const end = from(s, 3.6);
      const off = Math.max(...end.map((x) => Math.abs(x.offDeg)));
      const across = Math.max(...end.map((x) => Math.abs(x.across)));
      if (follows) {
        expect(off, 'A facing off the line to B (deg)').toBeLessThan(8);
        expect(across, 'B across A (m)').toBeLessThan(0.2);
      } else expect(across, 'B across the non-follower (m)').toBeGreaterThan(1);
    }
  }, 120_000);

  it('(b) the hands go on within 0.8 s of the start (inside the punch gap) and stay on: from the first push both men hold both palms on 95 % of the time to 4 s; a block that never punches has none on', async () => {
    const never: BlockProfile = { ...BLOCK_V1, id: 'test-never-punch', punchGapM: -1 };
    for (const [def, ok] of [
      [scene({ durationS: 4 }), true],
      [scene({ durationS: 4, A: withProfile(man(), never), B: withProfile(man({ hands: 'over' }), never) }), false],
    ] as const) {
      const s = await run(def);
      const all = (x: Sample) => Object.values(x.held).every(Boolean);
      const first = s.find(all);
      if (!ok) {
        expect(first, 'a palm on without a punch').toBeUndefined();
        continue;
      }
      expect(first?.t ?? Infinity, 'first time all four palms are on (s)').toBeLessThan(0.8);
      expect(fracOf(from(s, first!.t), all), 'fraction of the time all four palms are on').toBeGreaterThan(0.95);
    }
  }, 120_000);

  it("(c) arm's length: from 1.5 s the chest gap stays in 0.62-0.80 m (the palms' length, not chest to chest); with 0.35 m arms it is below 0.62 m", async () => {
    const short: BlockProfile = {
      ...BLOCK_V1,
      id: 'test-short-arms',
      lengthM: 0.35,
      hands: { ...BLOCK_V1.hands, under: { ...BLOCK_V1.hands.under, lengthM: 0.35 }, over: { ...BLOCK_V1.hands.over, lengthM: 0.35 } },
    };
    for (const [def, ok] of [
      [scene({ durationS: 3.5 }), true],
      [scene({ durationS: 3.5, A: withProfile(man({ intent: 'drive' }), short), B: withProfile(man({ hands: 'over', intent: 'drive' }), short) }), false],
    ] as const) {
      const g = from(await run(def), 1.5).map((x) => x.gap);
      if (ok) {
        expect(Math.min(...g), 'least chest gap (m)').toBeGreaterThan(0.62);
        expect(Math.max(...g), 'greatest chest gap (m)').toBeLessThan(0.8);
      } else expect(Math.min(...g), 'least chest gap with short arms (m)').toBeLessThan(0.62);
    }
  }, 120_000);

  it('(d) the engaged state persists across a loss: one substep without a hold stays engaged (taken from the contact it is lost); every palm off for 0.25 s at 2 s keeps both men engaged and in contact stepping to 2.38 s (the feet not reading it, they leave it), and all four palms are back on by 3.2 s', async () => {
    const R = { request: { target: 'B', effort: 0.5, intent: 'hold' as const }, profile: BLOCK_V1 };
    for (const fault of [undefined, { fromContact: true }]) {
      let st: BlockState | undefined;
      const dt = 1 / 240;
      const seq = [true, true, false, true, true];
      const phases = seq.map((on, i) => (st = advanceBlockState(st, R, on, i * dt, fault).st)!.phase);
      if (fault) expect(phases).toContain('lost');
      else expect(phases).toEqual(['engaged', 'engaged', 'engaged', 'engaged', 'engaged']);
    }
    // the hands off: each controller's arms dropped for 0.25 s (the arms rest, every push ends 'voluntary')
    const gap = (sim: Simulation) => {
      for (const p of sim.players) {
        const k = p as PlayerRuntime & { __inner?: Controller };
        if (!k.__inner) {
          k.__inner = p.controller;
          p.controller = wrap(p.controller, (i, ctx) => (ctx.t >= 2 && ctx.t < 2.25 ? { ...i, arms: {} } : i));
        }
      }
    };
    for (const debug of [undefined, { block: { feetIgnore: true } }, { block: { fromContact: true } }] as const) {
      const s = await run(scene({ durationS: 3.3 }), debug, gap);
      const w = from(s, 2, 2.38);
      const off = w.filter((x) => !Object.values(x.held).some(Boolean)).length;
      expect(off, 'substeps with every palm off').toBeGreaterThan(30);
      const engaged = w.every((x) => x.phase.A === 'engaged' && x.phase.B === 'engaged');
      const stepping = w.every((x) => x.mode.A === 'contact' && x.mode.B === 'contact');
      if (!debug) {
        const back = from(s, 2.25).find((x) => Object.values(x.held).every(Boolean));
        expect(back?.t ?? Infinity, 'all four palms back on (s)').toBeLessThan(3.2);
        expect(engaged, 'both engaged through the loss').toBe(true);
        expect(stepping, 'both in contact stepping through the loss').toBe(true);
      } else if (debug.block.feetIgnore) expect(stepping, 'contact stepping with the feet not reading the state').toBe(false);
      else expect(engaged, 'engaged with the state taken from the contact').toBe(false);
    }
  }, 180_000);

  it('(e) stopping the block releases cleanly: A swapped to a standing script at 2 s has no palm on and no push force within 0.1 s, no block state, and his hip hinge unwound by 3 s; a swap that keeps the hands leaves them pushing', async () => {
    for (const keep of [false, true]) {
      let done = false;
      const swap = (sim: Simulation) => {
        if (done || sim.t < 2) return;
        done = true;
        const A = sim.players.find((p) => p.id === 'A')!;
        const old = A.controller;
        const script = new ScriptController({ kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, 1), effort: 1 }] }, v3(0, 0, 1));
        let last: PlayerIntent | null = null;
        A.controller = keep ? wrap(script, (i, ctx) => ({ ...i, arms: (last ??= old.decide(ctx)).arms })) : script;
      };
      const s = await run(scene({ durationS: 3.2 }), undefined, swap);
      const after = from(s, 2.1);
      const on = after.some((x) => x.held['A:left'] || x.held['A:right'] || x.force['A:left'] > 0 || x.force['A:right'] > 0);
      if (keep) {
        expect(on, "A's palms on after a swap that keeps the hands").toBe(true);
        continue;
      }
      expect(on, "A's palms on or pushing after the swap").toBe(false);
      expect(after.every((x) => x.phase.A === undefined), "A's block state after the swap").toBe(true);
      expect(Math.abs(from(s, 3)[0].hingeRad.A), "A's hip hinge at 3 s (rad)").toBeLessThan(0.01);
    }
  }, 120_000);

  it('(f) the even scene (BL-F1-even) stands its whole length: both men supported to the end, A within 3 deg of square on B from 1 s; the hard drive without the hip hinge (BL-F8) goes over', async () => {
    const even = await run(FIX('BL-F1-even'));
    expect(even.at(-1)!.t).toBeGreaterThan(8.9);
    expect(even.every((x) => x.supported.A && x.supported.B), 'both supported throughout').toBe(true);
    expect(Math.max(...from(even, 1).map((x) => Math.abs(x.offDeg))), 'A off square on B (deg)').toBeLessThan(3);
    const tip = await run(scene({ durationS: 4.5, A: withProfile(man({ effort: 1, intent: 'drive' }), BLOCK_V1_HARD_NO_HINGE), B: withProfile(man({ effort: 1, intent: 'drive', hands: 'over' }), BLOCK_V1_HARD_NO_HINGE) }));
    expect(tip.some((x) => !x.supported.A || !x.supported.B), 'a man down in the hard drive without the hinge').toBe(true);
  }, 180_000);
});
