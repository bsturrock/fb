// Contact motion M2: the ball carrier's brace decision (src/sim/brace.ts, `FixtureDef.brace`, used by no fixture yet).
// Constructed cases on the decision itself: bodies at constant velocity on the flat, the carrier facing his travel, one
// decision substep at the gate 4 substep (1/240 s), "touching" when the torsos meet (both half widths, no margin). Each
// case has its fault twin (`BraceDebug`): the same case with one rule broken fails for that reason.
import { describe, expect, it } from 'vitest';
import { CARRIER_BRACE_V1, newCarrierBrace, stepBrace, type BraceBody, type BraceChange, type BraceDebug, type CarrierBraceProfile } from '../src/sim/brace';
import { allFixtures } from '../src/sim/fixtures/index';
import { Simulation } from '../src/sim/simulation';
import { addScaled, dist, horiz, norm, v3, type Vec3 } from '../src/sim/vec';
import { FIX, rows } from './helpers';

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
  it('the profile: carrier-brace-v1, used by no fixture yet', () => {
    expect(CARRIER_BRACE_V1).toMatchObject({ id: 'carrier-brace-v1', acquireS: 0.45, holdS: 0.65, fovHalfDeg: 70 });
    for (const d of allFixtures()) expect(d.brace, d.id).toBeUndefined();
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
