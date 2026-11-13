// Contact motion polish 1.2, the ride-down (WRAP_V7, `WrapProfile.ride`, src/sim/controllers/wrap.ts; the carrier counted
// as support, `Simulation.rideSupported`; the come-down, `WrapRideDown`). No fixture uses it. Each case has its fault twin: WRAP_V5 (the ride absent) or
// the same run with the rule it checks broken (`SimDebug.wrap`) fails for that reason.
import { describe, expect, it } from 'vitest';
import { lowestY, WRAP_V5, WRAP_V7, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { BALANCE_G3, upperBodyCompound } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { cross, deg, horiz, norm, qFromAxisAngle, scale, sub, UP, upOf, v3, vc } from '../src/sim/vec';
import { FIX } from './helpers';

const RD = WRAP_V7.ride!;
interface Priv {
  rideSupported(pl: unknown, theta: number, up: unknown): boolean;
  evaluateBalance(): void;
  arms: { arms: Map<string, Record<string, { clamp: unknown }>>; grips: Map<string, { ownerId: string }> };
}

/**
 * The substeps of his drive (begun, `debug.drive`) on his feet with an arm holding the carrier (an observed clamp or grip
 * touching him) while the carrier is going over (off his support, or leaning past WRAP_V5's `goLeanDeg`), and the first
 * of them he asks to leave his feet.
 */
async function overRun(def: FixtureDef): Promise<{ over: number; asked: { t: number; exit: string | null } | null }> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.() });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out = { over: 0, asked: null as { t: number; exit: string | null } | null };
  probe = () => {
    const dv = (D.intent.debug as { drive?: { exit: string | null; driving: boolean } } | undefined)?.drive;
    const ob = sim.arms?.obs('D');
    const holding = (['left', 'right'] as const).some((s) => !!(ob?.[s]?.clampContactId || ob?.[s]?.gripId) && ob?.[s]?.touchingTarget === 'R');
    if (D.controlMode !== 'supported' || !dv || !holding) return;
    if (R.controlMode === 'supported' && deg(R.balance.theta) < WRAP_V5.drive!.goLeanDeg) return;
    out.over++;
    if (D.intent.leaveSupport && !out.asked) out.asked = { t: sim.t, exit: dv.exit };
  };
  while (!sim.done && sim.t < 1.2 && D.controlMode === 'supported') sim.stepTick();
  sim.dispose();
  return out;
}

describe('polish 1.2, the ride-down (WRAP_V7, no fixture uses it)', () => {
  it('lowestY is the lowest corner of the torso box: upright, the box bottom; pitched 85 deg at root 0.72, the chest near 0.56 m', () => {
    const b = upperBodyCompound();
    if (b.kind === 'legacyCapsule') throw new Error('compound body expected');
    const t = b.compound.torso;
    expect(lowestY(b, v3(0, 0.89, 0), { x: 0, y: 0, z: 0, w: 1 })).toBeCloseTo(0.89 + t.center.y - t.halfExtents.y, 9);
    const q = qFromAxisAngle(v3(1, 0, 0), (85 * Math.PI) / 180);
    expect(lowestY(b, v3(0, 0.72, 0), q)).toBeCloseTo(0.556, 2);
  });

  it('(a) with a secure hold and the carrier going over (off his support in the side wrap, leaning past 30 deg in the front wrap) the rider does not ask to leave his feet; WRAP_V5 asks at once (exits a and b)', async () => {
    for (const [id, want] of [['L3-F4-twoArm', 'a'], ['L3-F19-front', 'b']] as const) {
      const ride = await overRun({ ...FIX(id), wrap: WRAP_V7 });
      expect(ride.over, id).toBeGreaterThan(0);
      expect(ride.asked, id).toBeNull();
      // twin: the ride absent
      const v5 = await overRun({ ...FIX(id), wrap: WRAP_V5 });
      expect(v5.asked?.exit, id).toBe(want);
    }
  }, 60_000);

  it('(b) riding with an arm holding and his body on the carrier, a lean toward him past the loss envelope queues no loss; with the hold gone the same lean queues it at once (twin: the hold and contact check off keeps it from converting)', async () => {
    const at = async (fault?: WrapDebug): Promise<{ held: boolean; lossHeld: boolean; lossGone: boolean }> => {
      const sim = await Simulation.create({ ...FIX('L3-F19-rear'), wrap: WRAP_V7 }, fault ? { debug: { wrap: fault } } : {});
      const P = sim as unknown as Priv;
      const D = sim.players.find((p) => p.id === 'D')!;
      const R = sim.players.find((p) => p.id === 'R')!;
      // a riding substep with the carrier counted as his support (a small lean toward him)
      const toR = (): ReturnType<typeof norm> => norm(horiz(sub(vc(R.proxy.body.translation()), vc(D.proxy.body.translation()))));
      const leanUp = (deg0: number) => {
        const a = norm(cross(UP, toR()));
        return { a, q: qFromAxisAngle(a, (deg0 * Math.PI) / 180) };
      };
      while (!sim.done && sim.t < 1.6 && !(D.intent.ride && P.rideSupported(D, 0.01, horiz(toR())))) sim.stepTick();
      const held = !!D.intent.ride && P.rideSupported(D, 0.01, horiz(toR()));
      // the lean: 35 deg toward the carrier, rotating outward at 2 rad/s (projected past the envelope's 55), no hinge
      const lean = (): void => {
        const { a, q } = leanUp(35);
        D.hinge = undefined;
        D.proxy.body.setRotation(q, true);
        D.proxy.body.setAngvel(scale(a, 2), true);
      };
      const step = (): boolean => {
        lean();
        P.evaluateBalance();
        return D.balance.pendingLoss;
      };
      expect(deg(BALANCE_G3.minLeanRad)).toBeLessThan(35);
      let lossHeld = false;
      for (let i = 0; i < BALANCE_G3.confirmSubsteps + 1; i++) lossHeld ||= step();
      // the hold gone: no clamp, no grip of his
      for (const s of Object.values(P.arms.arms.get('D')!)) s.clamp = null;
      for (const [k, g] of [...P.arms.grips]) if (g.ownerId === 'D') P.arms.grips.delete(k);
      const lossGone = step();
      sim.dispose();
      return { held, lossHeld, lossGone };
    };
    const ok = await at();
    expect(ok).toEqual({ held: true, lossHeld: false, lossGone: true });
    const twin = await at({ rideNoHoldCheck: true });
    expect(twin.lossGone).toBe(false);
  }, 60_000);

  it('(c) the height guard: riding, his chest within ride.groundM of the ground converts him (takedown, exit h); with the guard off he stays posed below it', async () => {
    const run = async (fault?: WrapDebug): Promise<{ h: { t: number; chest: number } | null; conv: { t: number; why: string } | null; posedBelow: number }> => {
      const wrap: WrapProfile = { ...WRAP_V7, ride: { ...RD, groundM: 0.7 } };
      let probe: (() => void) | null = null;
      const sim = await Simulation.create({ ...FIX('L3-F19-rear'), wrap }, { onSubstep: () => probe?.(), ...(fault ? { debug: { wrap: fault } } : {}) });
      const D = sim.players.find((p) => p.id === 'D')!;
      const out = { h: null as { t: number; chest: number } | null, conv: null as { t: number; why: string } | null, posedBelow: 0 };
      probe = () => {
        if (out.conv === null && D.controlMode !== 'supported') out.conv = { t: sim.t, why: String(D.handoff?.reason) };
        if (D.controlMode !== 'supported') return;
        const chest = lowestY(D.body, vc(D.proxy.body.translation()), { ...D.proxy.body.rotation() });
        if (D.intent.ride && chest <= 0.7 - 0.02) out.posedBelow++;
        const dv = (D.intent.debug as { drive?: { exit: string | null } } | undefined)?.drive;
        if (dv?.exit === 'h' && !out.h) out.h = { t: sim.t, chest };
      };
      while (!sim.done && sim.t < 2.4 && out.conv === null) sim.stepTick();
      while (!sim.done && sim.t < 2.4) sim.stepTick();
      sim.dispose();
      return out;
    };
    const ok = await run();
    expect(ok.h).not.toBeNull();
    expect(ok.h!.chest).toBeLessThanOrEqual(0.7);
    expect(ok.conv?.why).toBe('takedown');
    expect(ok.conv!.t - ok.h!.t).toBeLessThanOrEqual(2 / 240 + 1e-9);
    expect(ok.posedBelow).toBe(0);
    const twin = await run({ noRideGuard: true });
    expect(twin.h).toBeNull();
    expect(twin.posedBelow).toBeGreaterThan(0);
  }, 60_000);
});

/** One run's come-down (`WrapRideDown`): its start, the rider's requests and root after it, and his conversion. */
interface DownRun {
  /** The come-down's start (debug `drive.downS`), the referee's ending, the carrier's conversion (s). */
  downAt: number | null;
  endAt: number | null;
  rConvAt: number | null;
  /** Riding substeps after the come-down began with a hinge request short of the full fold; the root's largest rise there (m). */
  shortFold: number;
  rootRise: number;
  /** The first substep his body pitch reached 60 deg while posed (s). */
  pitch60At: number | null;
  /** His conversion: time, reason, the ride's exit asked (null: none asked), shoulder height (mean of the two, m). */
  conv: { t: number; why: string; exit: string | null; sh: number } | null;
}

async function downRun(id: string, wrap: WrapProfile, fault?: WrapDebug): Promise<DownRun> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create({ ...FIX(id), wrap }, { onSubstep: () => probe?.(), ...(fault ? { debug: { wrap: fault } } : {}) });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out: DownRun = { downAt: null, endAt: null, rConvAt: null, shortFold: 0, rootRise: 0, pitch60At: null, conv: null };
  let last: { exit: string | null; sh: number } = { exit: null, sh: NaN };
  let rootMin = Infinity;
  probe = () => {
    out.endAt ??= sim.ending?.t ?? null;
    if (out.rConvAt === null && R.controlMode !== 'supported') out.rConvAt = sim.t;
    if (D.controlMode !== 'supported') {
      out.conv ??= { t: sim.t, why: String(D.handoff?.reason), ...last };
      return;
    }
    const dv = (D.intent.debug as { drive?: { exit: string | null; downS?: number } } | undefined)?.drive;
    const ob = sim.arms!.obs('D')!;
    last = { exit: dv?.exit ?? null, sh: (ob.left!.shoulderWorld.y + ob.right!.shoulderWorld.y) / 2 };
    if (out.pitch60At === null && out.rConvAt !== null && deg(Math.acos(Math.min(1, upOf({ ...D.proxy.body.rotation() }).y))) >= 60) out.pitch60At = sim.t;
    if (dv?.downS !== undefined) out.downAt ??= sim.t - dv.downS;
    if (out.downAt !== null && D.intent.ride) {
      if ((D.intent.posture?.hinge?.rad ?? 0) < (RD.pitchDeg * Math.PI) / 180 - 1e-9) out.shortFold++;
      const y = D.proxy.body.translation().y;
      rootMin = Math.min(rootMin, y);
      out.rootRise = Math.max(out.rootRise, y - rootMin);
    }
  };
  while (!sim.done) sim.stepTick();
  sim.dispose();
  return out;
}
const DN = RD.down!;
/** WRAP_V7 as before the come-down: exits (g), (l) and the referee's ending convert him where he is. */
const V7_AT_ONCE: WrapProfile = { ...WRAP_V7, ride: { ...RD, down: undefined } };

describe('polish 1.2, the ride-down\'s come-down (WRAP_V7 ride.down, no fixture uses it)', () => {
  it('(a) after the referee\'s ending the rider keeps the full fold and never rises, and converts low by (h) or (t); twin: the old at-once conversion converts him at the ending, higher', async () => {
    for (const id of ['L3-F5-dragMirror', 'L3-F19-rear']) {
      const ok = await downRun(id, WRAP_V7);
      expect(ok.endAt, id).not.toBeNull();
      expect(ok.downAt, id).not.toBeNull();
      expect(ok.conv, id).not.toBeNull();
      // he rides on through the ending: the come-down begins with it and converts him after it, by the low exit
      expect(ok.conv!.t, id).toBeGreaterThan(ok.endAt! + 1e-9);
      expect(ok.conv!.why, id).toBe('takedown');
      expect(['h', 't'], id).toContain(ok.conv!.exit);
      expect(ok.conv!.sh, id).toBeLessThanOrEqual(0.9);
      expect(ok.shortFold, id).toBe(0);
      expect(ok.rootRise, id).toBeLessThanOrEqual(0.01);
      // twin: the ending converts him at once (no ride exit asked), at least 0.15 m higher
      const twin = await downRun(id, V7_AT_ONCE);
      expect(twin.downAt, id).toBeNull();
      expect(twin.conv!.t - twin.endAt!, id).toBeLessThanOrEqual(2 / 240 + 1e-9);
      expect(twin.conv!.sh - ok.conv!.sh, id).toBeGreaterThan(0.15);
    }
  }, 120_000);

  it('(b) on the ride\'s own bounds the trunk reaches 60 deg of pitch within 0.25 s of the carrier\'s conversion (L3-F19-rear, measured 0.23 s); twin on the strike\'s hinge bounds it never does', async () => {
    const ok = await downRun('L3-F19-rear', WRAP_V7);
    expect(ok.pitch60At).not.toBeNull();
    expect(ok.pitch60At! - ok.rConvAt!).toBeLessThanOrEqual(0.25);
    const S = WRAP_V7.strike!.hinge;
    const twin = await downRun('L3-F19-rear', { ...WRAP_V7, ride: { ...RD, down: { ...DN, hinge: { rateDegPerS: S.rateDegPerS, accelDegPerS2: S.accelDegPerS2, dropRateMps: S.dropRateMps } } } });
    expect(twin.pitch60At).toBeNull();
  }, 60_000);

  it('(c) the time bound converts a rider who cannot get low (exits h, s, f and the no-support guard off): by (t), maxS after the come-down began; twin: with no bound he stays posed to the trial\'s end', async () => {
    const off: WrapDebug = { noRideGuard: true, noRideLoose: true };
    for (const id of ['L3-F5-dragMirror', 'L3-F4-twoArm']) {
      const ok = await downRun(id, WRAP_V7, off);
      expect(ok.downAt, id).not.toBeNull();
      expect(ok.conv?.exit, id).toBe('t');
      expect(ok.conv!.t - ok.downAt!, id).toBeGreaterThanOrEqual(DN.maxS - 1e-9);
      expect(ok.conv!.t - ok.downAt!, id).toBeLessThanOrEqual(DN.maxS + 2 / 240 + 1e-9);
      const twin = await downRun(id, { ...WRAP_V7, ride: { ...RD, down: { ...DN, maxS: 10 } } }, off);
      expect(twin.downAt, id).not.toBeNull();
      expect(twin.conv, id).toBeNull();
    }
  }, 120_000);
});
