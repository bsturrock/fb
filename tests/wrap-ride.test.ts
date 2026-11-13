// Contact motion polish 1.2, the ride-down (WRAP_V7, `WrapProfile.ride`, src/sim/controllers/wrap.ts; the carrier counted
// as support, `Simulation.rideSupported`; the come-down, `WrapRideDown`; its arrival, `WrapRideDown.arrive`). No fixture
// uses it. Each case has its fault twin: WRAP_V5 (the ride absent) or the same run with the rule it checks broken
// (`SimDebug.wrap`, or the profile without it) fails for that reason.
import { describe, expect, it } from 'vitest';
import { lowestY, WRAP_V5, WRAP_V7, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { hingeAxis } from '../src/sim/hinge';
import { BALANCE_G3, upperBodyCompound } from '../src/sim/profiles';
import { SEGMENTS } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { add, cross, deg, dot, horiz, m3Add, m3Inverse, m3ParallelAxis, m3Vec, norm, qFromAxisAngle, qMul, scale, sub, UP, upOf, v3, vc, worldInertia, type Mat3, type Vec3 } from '../src/sim/vec';
import { asCaptured, FIX } from './helpers';
import { loadState, resumeState } from './state';

const RD = WRAP_V7.ride!;
/**
 * WRAP_V7 without the come-down's arrival (`WrapRideDown.arrive`): the ride's and the come-down's other rules, which the
 * cases before the arrival's measure (its slower fold holds the carrier longer and converts by the no-support guard).
 */
const { arrive: _arrive, ...DOWN_PRE } = RD.down!;
const V7_PRE_ARRIVE: WrapProfile = { ...WRAP_V7, ride: { ...RD, down: DOWN_PRE } };
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

describe('polish 1.2, the ride-down (WRAP_V7)', () => {
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
      const ride = await overRun({ ...FIX(id), wrap: V7_PRE_ARRIVE });
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
const DN = DOWN_PRE;
/** WRAP_V7 as before the come-down: exits (g), (l) and the referee's ending convert him where he is. */
const V7_AT_ONCE: WrapProfile = { ...WRAP_V7, ride: { ...RD, down: undefined } };

describe('polish 1.2, the ride-down\'s come-down (WRAP_V7 ride.down)', () => {
  it('(a) after the referee\'s ending the rider keeps the full fold and never rises, and converts low by (h) or (t); twin: the old at-once conversion converts him at the ending, higher', async () => {
    for (const id of ['L3-F5-dragMirror', 'L3-F19-rear']) {
      const ok = await downRun(id, V7_PRE_ARRIVE);
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
    const ok = await downRun('L3-F19-rear', V7_PRE_ARRIVE);
    expect(ok.pitch60At).not.toBeNull();
    expect(ok.pitch60At! - ok.rConvAt!).toBeLessThanOrEqual(0.25);
    const S = WRAP_V7.strike!.hinge;
    const twin = await downRun('L3-F19-rear', { ...V7_PRE_ARRIVE, ride: { ...RD, down: { ...DN, hinge: { rateDegPerS: S.rateDegPerS, accelDegPerS2: S.accelDegPerS2, dropRateMps: S.dropRateMps } } } });
    expect(twin.pitch60At).toBeNull();
  }, 60_000);

  it('(c) the time bound converts a rider who cannot get low (exits h, s, f and the no-support guard off): by (t), maxS after the come-down began; twin: with no bound he stays posed to the trial\'s end', async () => {
    const off: WrapDebug = { noRideGuard: true, noRideLoose: true };
    for (const id of ['L3-F5-dragMirror', 'L3-F4-twoArm']) {
      const ok = await downRun(id, V7_PRE_ARRIVE, off);
      expect(ok.downAt, id).not.toBeNull();
      expect(ok.conv?.exit, id).toBe('t');
      expect(ok.conv!.t - ok.downAt!, id).toBeGreaterThanOrEqual(DN.maxS - 1e-9);
      expect(ok.conv!.t - ok.downAt!, id).toBeLessThanOrEqual(DN.maxS + 2 / 240 + 1e-9);
      const twin = await downRun(id, { ...V7_PRE_ARRIVE, ride: { ...RD, down: { ...DN, maxS: 10 } } }, off);
      expect(twin.downAt, id).not.toBeNull();
      expect(twin.conv, id).toBeNull();
    }
  }, 120_000);
});

/**
 * Polish 1.2, the come-down arriving (`WrapRideDown.arrive`), from L3-F19-rear under WRAP_V7 at 2.15 s (tick 129,
 * `scripts/capture-state.ts L3-F19-rear 129 --wrap=v7`): the carrier off his support since 1.89 s, the rider's fold
 * braking at about 64 deg of pitch, 0.25 s before his conversion. The twin resumes the same state under V7_PRE_ARRIVE
 * (the fold at the hinge's bounds, the topple to the end, exit (h) at any pitch rate, the drive's extra speed).
 */
const ARRIVE_CAP = 'tests/data/state/L3-F19-rear~wrapv7@129.json.gz';
const AR = RD.down!.arrive!;

/** The definition the capture ran under, with `wrap` in place of WRAP_V7 (V7_PRE_ARRIVE keeps its id). */
function arriveDef(wrap: WrapProfile): FixtureDef {
  return { ...asCaptured(loadState(ARRIVE_CAP), (d) => ({ ...d, wrap: WRAP_V7 })), wrap };
}

interface ArriveRun {
  /**
   * His conversion: its audit's energy gain (J) and the bound a conversion inside exit (h)'s rate gate can reach: the
   * orbital term of the centre-of-mass offset (the proxy's COM off the ragdoll's, times his momentum) and a spin of
   * `arrive.foldedRateDegPerS` about his hinge axis, both on the ragdoll's inertia: (sqrt(E_orb) + sqrt(E_spin))^2.
   */
  conv: { t: number; dE: number; orbJ: number; boundJ: number } | null;
  /** The first substep after it with a shin above his hips by 0.15 m and above his head by 0.3 m (his feet over his head). */
  feetOverAt: number | null;
}

async function arriveRun(wrap: WrapProfile): Promise<ArriveRun> {
  const cap = loadState(ARRIVE_CAP);
  let probe: (() => void) | null = null;
  const sim = await resumeState(cap, { def: arriveDef(wrap), opts: { onSubstep: () => probe?.() } });
  const D = sim.players.find((p) => p.id === 'D')!;
  const out: ArriveRun = { conv: null, feetOverAt: null };
  let Ip: Mat3 | null = null;
  let axis: Vec3 = v3(1, 0, 0);
  probe = () => {
    if (D.controlMode === 'supported') {
      const b = D.proxy.body;
      Ip = worldInertia(vc(b.principalInertia()), { ...b.principalInertiaLocalFrame() }, { ...b.rotation() });
      axis = hingeAxis({ ...b.rotation() });
      return;
    }
    if (!D.rag) return;
    const B = D.rag.bodies;
    if (!out.conv) {
      // the ragdoll's assembly inertia about its COM (one substep after the switch)
      const parts = SEGMENTS.map((sg) => ({ m: B[sg].mass(), C: vc(B[sg].worldCom()), I: worldInertia(vc(B[sg].principalInertia()), { ...B[sg].principalInertiaLocalFrame() }, { ...B[sg].rotation() }) }));
      const M = parts.reduce((s, p) => s + p.m, 0);
      const C = scale(parts.reduce((s, p) => add(s, scale(p.C, p.m)), v3()), 1 / M);
      let I: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const p of parts) I = m3Add(I, m3Add(p.I, m3ParallelAxis(p.m, sub(p.C, C))));
      const J = m3Inverse(I)!;
      const A = D.handoff!.audit!;
      const v = (x: number[]): Vec3 => v3(x[0], x[1], x[2]);
      const Lo = cross(sub(v(A.before.com), v(A.after.com)), v(A.before.P));
      const Lb = m3Vec(Ip!, scale(axis, (AR.foldedRateDegPerS * Math.PI) / 180));
      const orbJ = 0.5 * dot(Lo, m3Vec(J, Lo));
      const spinJ = 0.5 * dot(Lb, m3Vec(J, Lb));
      out.conv = { t: sim.t, dE: A.energyDeltaJ, orbJ, boundJ: (Math.sqrt(orbJ) + Math.sqrt(spinJ)) ** 2 };
    }
    const feet = Math.max(B.leftShin.translation().y, B.rightShin.translation().y);
    if (out.feetOverAt === null && feet > B.core.translation().y + 0.15 && feet > B.head.translation().y + 0.3) out.feetOverAt = sim.t;
  };
  while (!sim.done) sim.stepTick();
  sim.dispose();
  return out;
}

/**
 * From the capture, his body set pitched `pitchDeg` toward the carrier about his own lateral axis, pitching on at
 * `rateDegPerS`, the exit the next decision asks (his chest height there, m).
 */
async function foldedAsk(wrap: WrapProfile, pitchDeg: number, rateDegPerS: number): Promise<{ exit: string | null; chest: number }> {
  const cap = loadState(ARRIVE_CAP);
  let probe: (() => void) | null = null;
  const sim = await resumeState(cap, { def: arriveDef(wrap), opts: { onSubstep: () => probe?.() } });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const b = D.proxy.body;
  const p = vc(b.translation());
  const Rc = vc(R.rag ? R.rag.bodies.core.translation() : R.proxy.body.translation());
  const d = norm(horiz(sub(Rc, p)));
  const yaw = qFromAxisAngle(UP, Math.atan2(d.x, d.z));
  const a = hingeAxis(yaw);
  const q = qMul(qFromAxisAngle(a, (pitchDeg * Math.PI) / 180), yaw);
  b.setRotation(q, true);
  b.setAngvel(scale(a, (rateDegPerS * Math.PI) / 180), true);
  const chest = lowestY(D.body, p, q);
  let exit: string | null | undefined;
  probe = () => {
    exit ??= (D.intent.debug as { drive?: { exit: string | null } } | undefined)?.drive?.exit ?? null;
  };
  sim.stepTick();
  sim.dispose();
  return { exit: exit ?? null, chest };
}

describe('polish 1.2, the come-down arriving (WRAP_V7 ride.down.arrive)', () => {
  it('(a) his conversion gains no more than the centre-of-mass offset and the exit\'s own rate gate allow; twin: the come-down without the arrival gains several times its bound', async () => {
    const ok = await arriveRun(WRAP_V7);
    expect(ok.conv).not.toBeNull();
    expect(ok.conv!.dE).toBeLessThanOrEqual(ok.conv!.boundJ);
    const twin = await arriveRun(V7_PRE_ARRIVE);
    expect(twin.conv!.dE).toBeGreaterThan(2 * twin.conv!.boundJ);
  }, 60_000);

  it('(b) after his conversion his feet never pass over his head (he comes down on the carrier, legs trailing); twin: without the arrival he rolls over him', async () => {
    const ok = await arriveRun(WRAP_V7);
    expect(ok.conv).not.toBeNull();
    expect(ok.feetOverAt).toBeNull();
    const twin = await arriveRun(V7_PRE_ARRIVE);
    expect(twin.feetOverAt).not.toBeNull();
  }, 60_000);

  it('(c) pitched past the full fold with his chest above ride.groundM, exit (h) waits for his pitch rate to fall under arrive.foldedRateDegPerS (asked at rest); twin: without the arrival it is asked at any rate', async () => {
    const fast = await foldedAsk(WRAP_V7, RD.pitchDeg + 1, 3 * AR.foldedRateDegPerS);
    expect(fast.chest).toBeGreaterThan(RD.groundM);
    expect(fast.exit).not.toBe('h');
    const still = await foldedAsk(WRAP_V7, RD.pitchDeg + 1, 0);
    expect(still.chest).toBeGreaterThan(RD.groundM);
    expect(still.exit).toBe('h');
    const twin = await foldedAsk(V7_PRE_ARRIVE, RD.pitchDeg + 1, 3 * AR.foldedRateDegPerS);
    expect(twin.exit).toBe('h');
  }, 60_000);
});
