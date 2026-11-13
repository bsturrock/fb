// Contact motion M2: the ball carrier's brace (src/sim/brace.ts, `FixtureDef.brace`, registered on the L3, L4 and HC
// carriers; `preBrace` gives a fixture as before it).
// The decision: constructed cases on it alone, bodies at constant velocity on the flat, the carrier facing his travel,
// one decision substep at the gate 4 substep (1/240 s), "touching" when the torsos meet (both half widths, no margin).
// The pose: the carrier of a fixture run up to its first contact, with the profile and without it. Each case has its
// fault twin (`BraceDebug`, `PoseDebug`): the same case with one rule broken fails for that reason.
import { describe, expect, it } from 'vitest';
import { CARRIER_BRACE_V1, CARRIER_BRACE_V2, newCarrierBrace, stepBrace, type BraceBody, type BraceChange, type BraceDebug, type CarrierBraceProfile } from '../src/sim/brace';
import type { SimDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { carriedBall } from '../src/sim/pose';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { addScaled, deg, dist, dot, horiz, norm, qInvRot, qRot, sub, v3, vc, type Vec3 } from '../src/sim/vec';
import { FIX, preBrace, rows, traceRowsDiff } from './helpers';
import { captureState, resumeState } from './state';
import { depth, drawnShapes, selfPairs } from './visible';
import { LIMB_HELD_M } from './visible-bar';

const DT = 1 / 240;
const HALF_W = 0.23;

/** A body at constant velocity; from `turn.t` on it moves at `turn.v` instead. */
interface Mover {
  id: string;
  p: Vec3;
  v: Vec3;
  turn?: { t: number; v: Vec3 };
}

interface Played {
  /** Weight after each substep, and the time at the end of it. */
  w: number[];
  t: number[];
  /** First substep end at which an opponent touches the carrier (s), or null. */
  touchS: number | null;
  /** Weight at that substep. */
  wAtTouch: number | null;
  changes: (BraceChange & { t: number })[];
}

/** The carrier `A` faces his travel; `opponents` threaten, `teammates` only hide. */
function play(o: { carrier: Mover; opponents?: readonly Mover[]; teammates?: readonly Mover[]; untilS: number; faults?: BraceDebug; profile?: CarrierBraceProfile }): Played {
  const P = o.profile ?? CARRIER_BRACE_V1;
  const st = newCarrierBrace();
  const ms = [o.carrier, ...(o.opponents ?? []), ...(o.teammates ?? [])].map((m) => ({ ...m }));
  const out: Played = { w: [], t: [], touchS: null, wAtTouch: null, changes: [] };
  const body = (m: Mover): BraceBody => ({ id: m.id, com: m.p, v: m.v, halfWidthM: HALF_W });
  const oppIds = new Set((o.opponents ?? []).map((m) => m.id));
  for (let i = 0, t = 0; t < o.untilS; i++) {
    const self = ms[0];
    const opps = ms.filter((m) => oppIds.has(m.id));
    const touching = new Set(opps.filter((m) => dist(horiz(m.p), horiz(self.p)) <= 2 * HALF_W).map((m) => m.id));
    const ch = stepBrace(P, st, { ...body(self), forward: norm(horiz(self.v), v3(0, 0, 1)) }, opps.map(body), ms.slice(1).map(body), touching, true, DT, o.faults);
    t = (i + 1) * DT;
    if (ch) out.changes.push({ ...ch, t });
    out.w.push(st.w);
    out.t.push(t);
    if (touching.size && out.touchS === null) {
      out.touchS = t;
      out.wAtTouch = st.w;
    }
    for (const m of ms) {
      if (m.turn && t >= m.turn.t) m.v = m.turn.v;
      m.p = addScaled(m.p, m.v, DT);
    }
  }
  return out;
}

/** The weight at time `s` (the substep ending there or just after). */
const wAt = (r: Played, s: number): number => r.w[Math.min(r.w.length - 1, r.t.findIndex((t) => t >= s - 1e-9))];
const maxW = (r: Played, fromS = 0, toS = Infinity): number => Math.max(0, ...r.w.filter((_, i) => r.t[i] >= fromS && r.t[i] <= toS));
/** Largest weight change in one substep. */
const maxStep = (r: Played): number => Math.max(0, ...r.w.map((w, i) => Math.abs(w - (r.w[i - 1] ?? 0))));

// the carrier runs at 3 m/s along +Z
const CARRIER: Mover = { id: 'A', p: v3(0, 1, 0), v: v3(0, 0, 3) };
// a defender 5 m ahead at 4 m/s toward him: the torsos meet at 0.649 s, the prediction reaches 0.45 s at 0.170 s
const FRONT: Mover = { id: 'D', p: v3(0, 1, 5), v: v3(0, 0, -4) };
// from 40 degrees off his facing, 6.5 m away, closing at 8 m/s on a collision course (constant bearing): the torsos meet
// at 0.755 s, the prediction reaches 0.45 s at 0.280 s
const OBLIQUE: Mover = { id: 'D', p: v3(6.5 * Math.sin(0.698), 1, 6.5 * Math.cos(0.698)), v: v3(-8 * Math.sin(0.698), 0, 3 - 8 * Math.cos(0.698)) };

describe('contact motion M2: the carrier sees a hit coming and braces', () => {
  it('the profile: carrier-brace-v1 (v2 registered), on every L3, L4 and HC fixture with a composed ball carrier, on no G, L1, L2 or RH fixture', () => {
    expect(CARRIER_BRACE_V1).toMatchObject({ id: 'carrier-brace-v1', acquireS: 0.45, holdS: 0.65, fovHalfDeg: 70 });
    let on = 0;
    for (const d of allFixtures()) {
      const carrier = /^(L3|L4|HC)-/.test(d.id) && !!d.locomotion && d.players.some((p) => p.role === 'runner');
      if (carrier) on++;
      // (since the M2 follow-up's lean flip: V2)
      expect(d.brace, d.id).toBe(carrier ? CARRIER_BRACE_V2 : undefined);
    }
    expect(on).toBeGreaterThan(100);
  });

  it('a front or oblique approach he sees is braced for before contact, ramped (the twin without anticipation braces only at contact)', async () => {
    await rows(
      [
        ['front', FRONT],
        ['oblique 40 deg', OBLIQUE],
      ] as const,
      ([n]) => n,
      ([, d]) => {
        const on = play({ carrier: CARRIER, opponents: [d], untilS: 1 });
        const twin = play({ carrier: CARRIER, opponents: [d], untilS: 1, faults: { contactOnly: true } });
        expect(on.touchS).not.toBeNull();
        expect(on.changes[0]).toMatchObject({ to: 'D', reason: 'seen' });
        expect(on.changes[0].tcS!).toBeLessThanOrEqual(CARRIER_BRACE_V1.acquireS + 1e-9);
        // acquired at least 0.4 s before the torsos meet and fully braced by then, the weight's rate under 8 /s
        expect(on.touchS! - on.changes[0].t).toBeGreaterThan(0.4);
        expect(on.wAtTouch!).toBeGreaterThan(0.9);
        expect(maxStep(on) / DT).toBeLessThan(8);
        expect(twin.touchS).toBe(on.touchS);
        expect(twin.wAtTouch!).toBeLessThan(0.05);
      },
    );
  });

  it('a near miss: the threat veers wide and the brace releases on the miss and ramps out (the twin that never releases stays braced)', () => {
    // the defender of `FRONT` from 6 m (acquired at 0.313 s), swerving at 0.45 s to pass 1.3 m off the carrier's centre
    const veer: Mover = { ...FRONT, p: v3(0, 1, 6), turn: { t: 0.45, v: v3(3.5, 0, -4) } };
    const on = play({ carrier: CARRIER, opponents: [veer], untilS: 1.2 });
    const twin = play({ carrier: CARRIER, opponents: [veer], untilS: 1.2, faults: { holdForever: true } });
    expect(on.touchS).toBeNull();
    expect(on.changes.map((c) => c.reason)).toEqual(['seen', 'miss']);
    const rel = on.changes[1].t;
    expect(rel).toBeGreaterThan(0.45);
    expect(rel).toBeLessThan(0.46);
    expect(maxW(on)).toBeGreaterThan(0.5);
    expect(maxStep(on) / DT).toBeLessThan(8);
    // no crouch persists: under 0.02 within 0.35 s of the release and on to the end
    expect(maxW(on, rel + 0.35)).toBeLessThan(0.02);
    expect(twin.changes.map((c) => c.reason)).toEqual(['seen']);
    expect(wAt(twin, rel + 0.35)).toBeGreaterThan(0.9);
  });

  it('the same threat holds the brace past the acquisition horizon (hysteresis; the twin with no hold band releases it)', () => {
    // `FRONT`, acquired at 0.170 s; at 0.3 s the defender checks his run to 0.73 m/s, so the prediction steps out from
    // 0.32 s to 0.6 s (inside the 0.65 s hold) and closes in again; the torsos meet at 0.95 s
    const ease: Mover = { ...FRONT, turn: { t: 0.3, v: v3(0, 0, -0.73) } };
    const on = play({ carrier: CARRIER, opponents: [ease], untilS: 1.1 });
    const twin = play({ carrier: CARRIER, opponents: [ease], untilS: 1.1, profile: { ...CARRIER_BRACE_V1, id: 'no-hold', holdS: CARRIER_BRACE_V1.acquireS } });
    const minW = (r: Played): number => Math.min(...r.w.filter((_, i) => r.t[i] >= 0.4 && r.t[i] <= r.touchS!));
    expect(on.touchS).toBeGreaterThan(0.9);
    expect(on.changes.map((c) => c.reason)).toEqual(['seen']);
    expect(minW(on)).toBeGreaterThan(0.9);
    expect(twin.touchS).toBe(on.touchS);
    expect(twin.changes.map((c) => c.reason)).toEqual(['seen', 'far', 'seen']);
    expect(minW(twin)).toBeLessThan(0.5);
  });

  it('a rear or hidden approach does not start a brace (the twin that skips visibility braces for both)', async () => {
    // a defender 4 m behind at 7 m/s; and the front defender with a teammate 1.2 m ahead of the carrier on the sight line
    const rear: Mover = { id: 'D', p: v3(0, 1, -4), v: v3(0, 0, 7) };
    const blocker: Mover = { id: 'B', p: v3(0.1, 1, 1.2), v: v3(0, 0, 3) };
    await rows(
      [
        ['rear', { opponents: [rear], teammates: [] as Mover[], hiddenUntil: Infinity }],
        // the defender passes the teammate's line 1.2 m ahead of the carrier at 0.54 s
        ['hidden', { opponents: [FRONT], teammates: [blocker], hiddenUntil: 0.53 }],
      ] as const,
      ([n]) => n,
      ([, c]) => {
        // to just after the torsos meet (a kinematic rear defender then passes through him)
        const on = play({ carrier: CARRIER, ...c, untilS: 0.95 });
        const twin = play({ carrier: CARRIER, ...c, untilS: 0.95, faults: { unseen: true } });
        expect(on.touchS).not.toBeNull();
        expect(maxW(on, 0, c.hiddenUntil)).toBe(0);
        if (c.hiddenUntil === Infinity) expect(on.changes).toEqual([]);
        expect(maxW(twin, 0, Math.min(c.hiddenUntil, twin.touchS!))).toBeGreaterThan(0.5);
      },
    );
  });

  it('unthreatened running does not brace: no opponent, one passing wide, one running away (the twin without the miss test braces for the passing line)', async () => {
    // L3-F2-miss: the defender's line passes 0.95 m from the carrier's centre (contact distance 0.66 m)
    const wide: Mover = { id: 'D', p: v3(0.95, 1, 5), v: v3(0, 0, -4) };
    const away: Mover = { id: 'D', p: v3(0, 1, 2), v: v3(0, 0, 4) };
    await rows(
      [
        ['no opponent', [] as Mover[], false],
        ['passing 0.95 m wide', [wide], true],
        ['running away ahead', [away], false],
      ] as const,
      ([n]) => n,
      ([, opponents, twinBraces]) => {
        const on = play({ carrier: CARRIER, opponents: [...opponents], untilS: 2 });
        const twin = play({ carrier: CARRIER, opponents: [...opponents], untilS: 2, faults: { noMissTest: true } });
        expect(on.touchS).toBeNull();
        expect(on.changes).toEqual([]);
        expect(maxW(on)).toBe(0);
        if (twinBraces) expect(maxW(twin)).toBeGreaterThan(0.9);
      },
    );
  });

  it('in a fixture, from what the carrier observes: L3-F3-collision is braced before first contact, traced and exported (the twin without anticipation is not)', async () => {
    // the head-on collision: the defender is acquired at 0.13 s (4 degrees off the carrier's facing), contact at 0.53 s
    const read = async (faults?: BraceDebug) => {
      const def = { ...FIX('L3-F3-collision'), brace: CARRIER_BRACE_V1 };
      const sim = await Simulation.create(def, faults ? { debug: { brace: faults } } : {});
      const R = def.players.find((p) => p.role === 'runner')!.id;
      let wAtContact: number | null = null;
      while (!sim.done && wAtContact === null) {
        sim.stepTick();
        if ((sim.contactObs[R] ?? []).length) wAtContact = sim.byId.get(R)!.brace!.w;
      }
      const out = { wAtContact, seen: sim.events.find((e) => e.type === 'brace' && e.playerId === R), row: sim.trace.at(-1)!.players[R].br, x: sim.exportFixture() as { profileIds: Record<string, unknown> } };
      sim.dispose();
      return out;
    };
    const on = await read();
    const twin = await read({ contactOnly: true });
    expect(on.wAtContact!).toBeGreaterThan(0.9);
    expect(on.seen!.data).toMatchObject({ from: null, reason: 'seen' });
    expect(on.row!.th).toBe((on.seen!.data as { to: string }).to);
    expect(on.row!.w).toBeGreaterThan(0.9);
    expect(on.x.profileIds.brace).toBe('carrier-brace-v1');
    expect(twin.wAtContact!).toBeLessThan(0.05);
  }, 60000);
});

/** The fixture without the brace profile (whether or not it has one). */
const unbraced = preBrace;
const braced = (id: string): FixtureDef => ({ ...unbraced(FIX(id)), brace: CARRIER_BRACE_V1 });

/** One tick of the carrier while supported: his proxy's height and forward pitch, and his pose in the proxy frame. */
interface CarrierTick {
  t: number;
  w: number;
  y: number;
  pitchDeg: number;
  /** The drawn ball's centre, its distance to the published landmark, the free (left) palm. */
  ball: Vec3 | null;
  ballVsLandmark: number;
  leftPalm: Vec3;
  /** The free arm's upper arm in his own pec slab (the trunk hull piece in front of the chest), m. */
  leftUpperArmInChest: number;
}

async function carrierTicks(def: FixtureDef, untilS: number, debug?: SimDebug): Promise<{ ticks: CarrierTick[]; contactS: number | null }> {
  const sim = await Simulation.create(def, debug ? { debug } : {});
  const R = def.players.find((p) => p.role === 'runner')!.id;
  const RP = def.ragdoll ?? DEFAULT_POSE_PROFILE;
  const ticks: CarrierTick[] = [];
  let contactS: number | null = null;
  while (!sim.done && sim.t < untilS - 1e-9) {
    sim.stepTick();
    const pl = sim.byId.get(R)!;
    if (contactS === null && (sim.contactObs[R] ?? []).length) contactS = sim.t;
    if (!pl.pose || pl.rag) continue;
    const b = pl.proxy.body;
    const p = vc(b.translation());
    const q = b.rotation();
    const local = (x: Vec3): Vec3 => qInvRot(q, sub(x, p));
    const up = qRot(q, v3(0, 1, 0));
    const ball = carriedBall(pl.pose);
    const chest = selfPairs(drawnShapes(pl.pose, pl.body, RP)).filter((x) => x.cls === 'armTrunk' && x.a.key.startsWith('leftUpperArm') && x.b.key === 'trunk4');
    ticks.push({
      t: sim.t,
      w: pl.brace?.w ?? 0,
      y: p.y,
      pitchDeg: deg(Math.atan2(dot(up, norm(horiz(qRot(q, v3(0, 0, 1))))), up.y)),
      ball: ball ? local(ball.p) : null,
      ballVsLandmark: ball ? dist(ball.p, pl.pose.jointLandmarksWorld.carriedBall) : 0,
      leftPalm: local(pl.pose.jointLandmarksWorld.leftPalm),
      leftUpperArmInChest: Math.max(0, ...chest.map((x) => depth(x.a, x.b))),
    });
  }
  sim.dispose();
  return { ticks, contactS };
}
const tickAt = (ts: CarrierTick[], s: number): CarrierTick => ts.reduce((a, b) => (Math.abs(b.t - s) < Math.abs(a.t - s) ? b : a));
const within = (ts: CarrierTick[], from: number, to: number): CarrierTick[] => ts.filter((x) => x.t >= from - 1e-9 && x.t <= to + 1e-9);
/** Largest one-tick move of the drawn ball in the proxy frame over the ticks (consecutive supported ticks). */
const ballStep = (ts: CarrierTick[]): number => Math.max(0, ...ts.map((x, i) => (i && x.ball && ts[i - 1].ball ? dist(x.ball, ts[i - 1].ball!) : 0)));
const range = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);

describe('contact motion M2: the braced carrier pose', () => {
  it('L3-F3-collision before contact: hips lower, chest forward, the ball held still at the ribs, the free palm on it (the twin without anticipation keeps the running pose)', async () => {
    // acquired at 0.15 s, contact about 0.53 s; at 0.5 s fully braced
    const off = await carrierTicks(unbraced(FIX('L3-F3-collision')), 0.5);
    const check = async (debug: SimDebug | undefined, expectBraced: boolean): Promise<void> => {
      const on = await carrierTicks(braced('L3-F3-collision'), 0.5, debug);
      const a = tickAt(off.ticks, 0.5);
      const b = tickAt(on.ticks, 0.5);
      const swing = (r: CarrierTick[]): number => range(within(r, 0.25, 0.5).map((x) => x.ball!.y));
      const fails: string[] = [];
      if (!(b.w > 0.9)) fails.push(`weight ${b.w}`);
      // the support drop of the pose (5 cm) on top of the running height
      if (!(b.y - a.y < -0.8 * CARRIER_BRACE_V1.pose.dropM)) fails.push(`hips ${(b.y - a.y).toFixed(3)} m`);
      if (!(b.pitchDeg - a.pitchDeg > 1.5)) fails.push(`pitch ${(b.pitchDeg - a.pitchDeg).toFixed(1)} deg`);
      // the running carry swings the ball 26 cm up and down over these 0.25 s; braced it stays under half of that
      if (!(swing(on.ticks) < 0.5 * swing(off.ticks))) fails.push(`ball swing ${swing(on.ticks).toFixed(3)} vs ${swing(off.ticks).toFixed(3)} m`);
      // the cover: the palm at the ball's inner side, one ball radius, a palm radius and the gap from its centre
      if (!(dist(b.leftPalm, b.ball!) < 0.2)) fails.push(`free palm ${dist(b.leftPalm, b.ball!).toFixed(3)} m from the ball`);
      if (expectBraced) expect(fails).toEqual([]);
      else expect(fails.length).toBeGreaterThanOrEqual(5);
      // the drawn ball is the published landmark on every tick
      expect(Math.max(...on.ticks.map((x) => x.ballVsLandmark))).toBeLessThan(1e-9);
    };
    expect(dist(tickAt(off.ticks, 0.5).leftPalm, tickAt(off.ticks, 0.5).ball!)).toBeGreaterThan(0.5);
    await check(undefined, true);
    await check({ brace: { contactOnly: true } }, false);
  }, 60000);

  it('V2: the chest is 7-12 deg forward at a head-on hit, the lean formed in time and held as reached, with no loss of support before contact (the twin under V1 reaches under 4 deg)', async () => {
    // contact motion M2 follow-up. V1 leans the desired up at the balance profile's 30 deg/s, and the posture hold of the
    // desired lean, already full while the body is near upright, leaves an effective stiffness of kp - m g L against kd:
    // the lean forms with a time constant of about 1 s, 2-4 deg by contact. V2 turns the desired up at 60 deg/s and holds
    // the reached lean while short of the desired one. Measured at the flip's scan: V1 -0.3 to 3.0 deg at the first
    // contact of the 37 braced runs with one, V2 7.6 to 10.8.
    expect(CARRIER_BRACE_V2).toEqual({ ...CARRIER_BRACE_V1, id: 'carrier-brace-v2', pose: { ...CARRIER_BRACE_V1.pose, leanRateDegPerS: 60, leanHold: 'reached' } });
    await rows(['L3-F3-collision', 'L3-F1-phase0', 'HC-F3-phase0'], (id) => id, async (id) => {
      const at = async (brace: CarrierBraceProfile) => {
        const r = await carrierTicks({ ...unbraced(FIX(id)), brace }, 0.7);
        expect(r.contactS, id).not.toBeNull();
        const before = within(r.ticks, 0, r.contactS!);
        // still supported at contact: a tick of his up to it, every one
        expect(before.length, id).toBe(Math.round(r.contactS! * 60));
        return tickAt(before, r.contactS!).pitchDeg;
      };
      const v2 = await at(CARRIER_BRACE_V2);
      expect(v2, id).toBeGreaterThan(7);
      expect(v2, id).toBeLessThan(12);
      expect(await at(CARRIER_BRACE_V1), id).toBeLessThan(4);
    });
  }, 60000);

  it('the free arm covering the ball stays out of the chest (the twin that swings it out reaches into the pec)', async () => {
    // L3-F1-phase0: braced from the start, contact at 0.52 s; the met-arm swing-out takes the cover arm forward toward
    // the threat with the elbow up, its upper arm into the pec slab
    const peak = async (debug?: SimDebug): Promise<number> => {
      const r = await carrierTicks(braced('L3-F1-phase0'), 0.52, debug);
      const win = within(r.ticks, 0.45, 0.52);
      expect(Math.min(...win.map((x) => x.w))).toBeGreaterThan(0.9);
      return Math.max(...win.map((x) => x.leftUpperArmInChest));
    };
    expect(await peak()).toBeLessThan(LIMB_HELD_M);
    expect(await peak({ pose: { braceCoverSwingOut: true } })).toBeGreaterThan(LIMB_HELD_M);
  }, 60000);

  it('the brace ramps in: the ball moves no further in one tick than the running carry does (the twin that steps the weight jumps it)', async () => {
    // L3-F1-phase0: the threat is acquired on the first substeps, the ball goes from the running carry to the brace key
    const off = await carrierTicks(unbraced(FIX('L3-F1-phase0')), 0.5);
    const runStep = ballStep(off.ticks);
    const rampStep = async (debug?: SimDebug): Promise<number> => {
      const r = await carrierTicks(braced('L3-F1-phase0'), 0.3, debug);
      expect(r.ticks.at(-1)!.w).toBeGreaterThan(0.9);
      return ballStep(r.ticks);
    };
    expect(runStep).toBeGreaterThan(0.01);
    expect(await rampStep()).toBeLessThan(runStep);
    expect(await rampStep({ brace: { noRamp: true } })).toBeGreaterThan(runStep);
  }, 60000);

  it('unthreatened running is unchanged by the profile: the whole run as without it (the twin without the miss test braces for the passing line)', async () => {
    const strip = (sim: Simulation) =>
      sim.trace.map((r) => ({ ...r, players: Object.fromEntries(Object.entries(r.players).map(([k, v]) => [k, { ...v, br: undefined }])) }));
    const runOf = async (def: FixtureDef, debug?: SimDebug) => {
      const sim = await Simulation.create(def, debug ? { debug } : {});
      while (!sim.done) sim.stepTick();
      const out = { trace: strip(sim), braces: sim.events.filter((e) => e.type === 'brace').length, result: sim.result };
      sim.dispose();
      return out;
    };
    await rows(
      [
        // the defender's line passes ahead of the carrier (no contact); the sprint has no opponent (no twin)
        ['L3-F2-miss', true],
        ['L3-F16-sprint', false],
      ] as const,
      ([id]) => id,
      async ([id, twinBraces]) => {
        const off = await runOf(unbraced(FIX(id)));
        const on = await runOf(braced(id));
        expect(on.braces).toBe(0);
        expect(on.result).toBe(off.result);
        expect(traceRowsDiff(off.trace, on.trace)).toBeNull();
        if (twinBraces) {
          const twin = await runOf(braced(id), { brace: { noMissTest: true } });
          expect(twin.braces).toBeGreaterThan(0);
          expect(traceRowsDiff(off.trace, twin.trace)).not.toBeNull();
        }
      },
    );
  }, 120000);

  it('a state captured braced resumes without the profile: the carrier stands out of the brace (the twin resumed with it stays braced)', async () => {
    // L3-F3-collision at 0.35 s, fully braced, to 0.5 s (before contact); the twin's change is the profile (resumeState's
    // variant), as a capture-based twin of a brace on/off question resumes it
    const def = braced('L3-F3-collision');
    const sim = await Simulation.create(def);
    while (sim.t < 0.35 - 1e-9) sim.stepTick();
    const R = def.players.find((p) => p.role === 'runner')!.id;
    expect(sim.byId.get(R)!.brace!.w).toBeGreaterThan(0.9);
    const cap = captureState(sim);
    sim.dispose();
    const at = async (d: FixtureDef, variant: string[]): Promise<{ y: number; palmToBall: number }> => {
      const s = await resumeState(cap, { def: d, variant });
      while (s.t < 0.5 - 1e-9) s.stepTick();
      const pl = s.byId.get(R)!;
      const out = { y: pl.proxy.body.translation().y, palmToBall: dist(pl.pose!.jointLandmarksWorld.leftPalm, carriedBall(pl.pose)!.p) };
      s.dispose();
      return out;
    };
    const on = await at(def, []);
    const off = await at(unbraced(def), ['brace']);
    expect(on.palmToBall).toBeLessThan(0.2);
    expect(off.palmToBall).toBeGreaterThan(0.3);
    expect(off.y - on.y).toBeGreaterThan(0.03);
  }, 60000);
});
