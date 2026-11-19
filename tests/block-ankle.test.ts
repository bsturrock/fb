// Plan 16 (p39), the blocking stance's own ankle range (`FlatStance.dorsiDeg`, `LeanInStance.ankleDeg`; the owner's ruling,
// 2026-11-18: a man in a block or a blocking stance bends the loaded ankle to about 38 deg, every other player keeps the
// joint range profile's 25). One reader (pose-runtime.ts `jointRangeOf`) gives the pose's ankle, the flat and ball rules
// and the foot plan's range the stance's range; the visible meter reads his dorsiflexion against it. Constructed: the
// reader and the meter's measure. Then a BL scene on a lean-in derived at 38 deg: his planted ankles bend past 25 and
// never past 38, the rear foot within the ball's limit. Each has its fault twin: the stance without its range (every ankle
// stops at the profile's 25), the meter without it.
import { describe, expect, it } from 'vitest';
import type { ArmSide } from '../src/sim/contracts';
import { LEAN_IN_V1, type BlockProfile, type LeanInStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, type BlockMan } from '../src/sim/fixtures/blocking';
import { jointRangeOf } from '../src/sim/pose-runtime';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { qRot, v3 } from '../src/sim/vec';
import { FIX } from './helpers';
import { HUMAN_RANGES, jointAngles } from './visible';

const SIDES: ArmSide[] = ['left', 'right'];
/** The lean-in's own limit for a foot on its ball (deg) and the meter's implausible margin for the ankle. */
const BALL_DEG = LEAN_IN_V1.ball.stepDeg;
const DORSI = HUMAN_RANGES.find((r) => r.joint === 'Ankle' && r.dof === 'dorsiflexion')!;

describe('plan 16 (p39), the stance\'s own ankle range: the reader', () => {
  it('jointRangeOf: a supported man in a stance with its own range stands under it, every other player (and a ragdoll) under the fixture\'s own object; fault twin: the stance without its range', () => {
    const def = FIX('BL-F1-even');
    const J = def.jointRange!;
    const host = { def };
    const flat = { ...(def.players[0].initial.stance!.flat!), dorsiDeg: 38 };
    const scoped = jointRangeOf(host, { sus: { flat } as PlayerRuntime['sus'], rag: null });
    expect(scoped!.ankle.dorsiDeg).toBe(38);
    expect(scoped!.ankle.plantarDeg).toBe(J.ankle.plantarDeg);
    expect(scoped!.shoulder).toBe(J.shoulder);
    const { dorsiDeg: _d, ...plain } = flat;
    expect(jointRangeOf(host, { sus: { flat: plain } as PlayerRuntime['sus'], rag: null })).toBe(J);
    expect(jointRangeOf(host, { sus: { flat } as PlayerRuntime['sus'], rag: {} as PlayerRuntime['rag'] })).toBe(J);
    expect(jointRangeOf(host, { sus: null, rag: null })).toBe(J);
  });

  it('the visible meter reads a scoped ankle against its range: 37 deg of dorsiflexion is within it; fault twin: read against the human 20 it is implausible', () => {
    const def = FIX('BL-F1-even');
    const body = def.players[0].body;
    // a pose whose only joint read here is the ankle (the meter's measure of it is the published pitch)
    const pose = { anklePitchDeg: { left: -37, right: -10 }, segments: new Proxy({}, { get: () => ({ positionWorld: v3(), rotationWorld: { x: 0, y: 0, z: 0, w: 1 } }) }) } as unknown as Parameters<typeof jointAngles>[0];
    expect(DORSI.excess(jointAngles(pose, body, 38).leftAnkle)).toBeLessThanOrEqual(0);
    expect(DORSI.excess(jointAngles(pose, body).leftAnkle)).toBeGreaterThan(DORSI.implausible);
  });
});

// ------------------------------------------------------------------ a BL scene on a stance with its own range
// (the ball's pitch at the load 6 deg: on the ankle's 38 the rear foot stands 1.3 cm behind the hips, its heel 3 cm up)
const AT38: LeanInStance = { ...LEAN_IN_V1, id: 'lean-in-v1-a38', ankleDeg: 38, ball: { ...LEAN_IN_V1.ball, pitchDeg: 6 } };

/** BL-F1-even with both men on `S`; `strip` takes the stance's range off his flat feet (the placement as derived). */
function scene(S: LeanInStance, strip: boolean, durationS: number): FixtureDef {
  const o = BL_SCENES.find((x) => x.id === 'BL-F1-even')!;
  const on = (m: BlockMan): BlockMan => ({ ...m, leanIn: S });
  const def = blockScene({ ...o, A: on(o.A), B: on(o.B), durationS }, FIX('L3-F6-hold'));
  if (!strip) return def;
  const off = <T extends { flat?: object }>(x: T): T => {
    if (!x.flat) return x;
    const { dorsiDeg: _d, ...f } = x.flat as { dorsiDeg?: number };
    return { ...x, flat: f };
  };
  return {
    ...def,
    players: def.players.map((p) => ({
      ...p,
      initial: { ...p.initial, ...(p.initial.stance ? { stance: off(p.initial.stance) } : {}) },
      controller: { ...p.controller, profile: off((p.controller as { profile: BlockProfile }).profile) } as typeof p.controller,
    })),
  };
}

interface Ankles {
  /** Planted, supported substeps; the most dorsiflexed planted ankle (deg, + toe up); the most pitched planted foot (deg, heel up). */
  ticks: number;
  dorsiDeg: number;
  pitchDeg: number;
  /** The meter's worst dorsiflexion excess read against his stance's range. */
  meterEx: number;
  fell: boolean;
}

async function ankles(def: FixtureDef): Promise<Ankles> {
  const r: Ankles = { ticks: 0, dorsiDeg: 0, pitchDeg: 0, meterEx: -Infinity, fell: false };
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      for (const p of sim.players) {
        if (p.rag || p.controlMode !== 'supported') {
          r.fell = true;
          continue;
        }
        if (!p.pose || !p.feet || sim.t < 0.3) continue;
        const J = jointAngles(p.pose, p.body, p.sus?.flat?.dorsiDeg);
        for (const s of SIDES) {
          const f = p.feet.feet[s];
          if (f.mode !== 'planted' || f.tentative) continue;
          r.ticks++;
          r.dorsiDeg = Math.max(r.dorsiDeg, -(p.pose.anklePitchDeg?.[s] ?? 0));
          r.pitchDeg = Math.max(r.pitchDeg, Math.abs((Math.asin(Math.max(-1, Math.min(1, qRot(f.footQ, v3(0, 0, 1)).y))) * 180) / Math.PI));
          r.meterEx = Math.max(r.meterEx, DORSI.excess(J[`${s}Ankle`]));
        }
      }
    },
  });
  sim.runToEnd();
  sim.dispose();
  return r;
}

describe('plan 16 (p39), a man on a stance with its own ankle range', () => {
  it('BL-F1-even on the lean-in derived at 38 deg (2 s): planted ankles bend past 25 and never past 38, the feet within the ball\'s limit, the meter reading no excess; fault twin: the same stance without its range, every ankle stopped at the profile\'s 25', async () => {
    const on = await ankles(scene(AT38, false, 2));
    expect(on.fell).toBe(false);
    expect(on.ticks).toBeGreaterThan(500);
    expect(on.dorsiDeg).toBeGreaterThan(30);
    expect(on.dorsiDeg).toBeLessThanOrEqual(38 + 1e-6);
    expect(on.pitchDeg).toBeLessThanOrEqual(BALL_DEG);
    expect(on.meterEx).toBeLessThanOrEqual(0);
    const off = await ankles(scene(AT38, true, 2));
    // (on: 38.0 deg, the foot at most 10.7 deg heel up; the twin 25.0, its feet re-placed for 25 by the ball rule)
    expect(off.dorsiDeg).toBeLessThanOrEqual(25 + 1e-6);
    expect(off.dorsiDeg).toBeLessThan(30);
  }, 120_000);
});
