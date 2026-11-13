import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import type { BornForce } from '../src/sim/debug';
import { BORN_OVERLAP_V1, BORN_OVERLAP_V2, withBornOverlap, withConversionRetry, type BornOverlapProfile } from '../src/sim/profiles';
import type { PlayerRuntime, Simulation, SimOptions } from '../src/sim/simulation';
import { dot, v3, vc, type Vec3 } from '../src/sim/vec';
import { create, evs, FIX, runSim } from './helpers';
import { INJECTION_J, passiveEnergyMeter } from './passive-energy';

// Ladder 17 (direction item 4: a player who should go to ragdoll always does): the born-overlap conversion
// (`RagdollProfile.bornOverlap`, BORN_OVERLAP_V1; registered on L3, L4 and HC since 17b). Without it the validation
// refuses a candidate deeper than 1.5 cm in another player, and a refused (or, under the retry, still refused at the
// window's end) player falls as the rigid Gate 3 proxy to the end of the run. Under the profile the candidate is
// converted and each collider pair born deeper than the tolerance is left out of the solve until the two have separated.
// The cases are G4's, whose profile has neither, each test adding the profile itself.
//
// The constructed cases are G4-F6-crowded's: R stands with D's chest against his right side, so R's articulated right
// arm starts 3.7 cm inside D's torso (the registered fixture's contract: the handoff is rejected), and, with D
// converted first and R's trunk collider shifted 15 cm toward D, R's trunk starts 14 cm inside D's ragdoll trunk (the
// gross case). G4-F1's lone R with a shoe shifted down is the floor case.

/** The run's explosion gate (ladder 15: tests/falls.test.ts, 40 J and 9 m/s). */
const EXPLODE_J = 40;
const EXPLODE_MS = 9;
/** Solves read after R's switch (0.1 s). */
const AFTER = 24;

interface Crowd {
  born?: BornOverlapProfile | false;
  /** D converted at 0.45 s and R's trunk shifted 15 cm into D's ragdoll trunk. */
  trunk?: boolean;
  retry?: boolean;
}
function crowded(o: Crowd): FixtureDef {
  const d = FIX('G4-F6-crowded');
  let r = d.ragdoll!;
  if (o.retry) r = withConversionRetry(r);
  if (o.born !== false) r = withBornOverlap(r, o.born ?? BORN_OVERLAP_V1);
  const R = { playerId: 'R', atS: 0.5, ...(o.trunk ? { edit: { kind: 'surfaceShift' as const, segment: 'core' as const, region: 'torso' as const, offsetLocal: v3(0.15, 0, 0) } } : {}) };
  return { ...d, ragdoll: r, diagnostics: { ...d.diagnostics, conversions: [...(o.trunk ? [{ playerId: 'D', atS: 0.45 }] : []), R] } };
}

const player = (sim: Simulation, id: string): PlayerRuntime => sim.players.find((p) => p.id === id)!;
const rigid = (p: PlayerRuntime): boolean => p.controlMode === 'falling' && !p.rag;

/** The accepted handoff's transfer audit (tests/handoff-contact.test.ts `expectAudited`, the bookkeeping part). */
function expectBooked(p: PlayerRuntime, tag: string): void {
  const h = p.handoff!;
  expect(h.outcome, tag).toBe('accepted');
  expect(h.report.ok, tag).toBe(true);
  const a = h.audit!;
  expect(a.ok, tag).toBe(true);
  expect(Math.abs(a.massDiffKg), tag).toBeLessThan(1e-6);
  expect(a.linearRelErr, tag).toBeLessThan(1e-3);
  expect(a.angularRelErr, tag).toBeLessThan(1e-2);
}

interface Metered {
  sim: Simulation;
  /** D's and R's passive energy summed per solve over the AFTER solves from R's switch (J), from the first. */
  pair: number[];
}
/** Run `def` to its end with the passive meter (tests/passive-energy.ts) on both ragdolls. */
async function metered(def: FixtureDef, opts: SimOptions = {}): Promise<Metered> {
  const sim = await create(def, opts);
  const by = new Map<number, number>();
  const meter = passiveEnergyMeter(sim, (e) => {
    const h = player(sim, 'R').handoff;
    if (!h || h.outcome !== 'accepted' || e.step <= h.step || e.step > h.step + AFTER) return;
    by.set(e.step, (by.get(e.step) ?? 0) + e.passiveJ);
  });
  await runSim(sim);
  meter.restore();
  return { sim, pair: [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, j]) => j) };
}

describe('ladder 17: born overlap (a candidate inside another player is converted, its born pairs out of the solve until they separate)', () => {
  it('G4-F6-crowded: the registered validation leaves R a rigid falling proxy; under the profile R converts at the request, his arm pairs held and then released, the transfer booked, both orders deterministic', async () => {
    const reg = await runSim(await create(crowded({ born: false })));
    const r0 = player(reg, 'R');
    // the fault: the registered refusal (G4-F6-crowded's contract) and the rigid figure it leaves
    expect(r0.handoff!.outcome).toBe('rejected');
    expect(r0.handoff!.report.reasons).toEqual(['externalPenetration']);
    expect(rigid(r0)).toBe(true);
    reg.dispose();
    const summaries: string[] = [];
    for (const reverseOrder of [false, true, false, true]) {
      const sim = await runSim(await create(crowded({}), { reverseOrder }));
      const R = player(sim, 'R');
      const tag = `R ${reverseOrder ? 'reversed' : 'forward'}`;
      expectBooked(R, tag);
      expect(R.handoff!.t, tag).toBeCloseTo(0.5, 6);
      expect(rigid(R), tag).toBe(false);
      expect(R.rag, tag).toBeTruthy();
      const rep = R.handoff!.report;
      // the arm in D's torso: a limb, tolerated at once
      expect(rep.tolerated, tag).toEqual(['externalPenetration']);
      expect(rep.maxNewExternalPenetrationM, tag).toBeGreaterThan(0.03);
      const born = rep.born!;
      expect(born.length, tag).toBeGreaterThan(0);
      expect(born.every((b) => !b.gross && !b.fixed && b.own.startsWith('right')), `${tag} ${JSON.stringify(born)}`).toBe(true);
      // every held pair separates and rejoins the solve within the run; none is left
      const rel = evs(sim, 'bornOverlapReleased', 'R');
      expect(rel.length, tag).toBe(born.length);
      for (const e of rel) expect(e.data.heldS as number, tag).toBeGreaterThan(0);
      expect(R.rag!.born ?? [], tag).toEqual([]);
      for (const p of sim.players) if (p.ragStats) expect(p.ragStats.maxSpeed, `${tag} ${p.id}`).toBeLessThan(EXPLODE_MS);
      summaries.push(JSON.stringify(sim.summary()));
      sim.dispose();
    }
    expect(summaries[2]).toBe(summaries[0]);
    expect(summaries[3]).toBe(summaries[1]);
  }, 120000);

  it('no energy from the born overlap: R born with his trunk 14 cm in D\'s ragdoll trunk converts at once (gross, no retry window) and the pair\'s first solve gains nothing; the fault (`bornInSolve`, the born pairs left in the solve) gains over 2 J; the explosion gate holds', async () => {
    const on = await metered(crowded({ trunk: true }));
    const fault = await metered(crowded({ trunk: true }), { debug: { conversion: { bornInSolve: true } } });
    for (const [m, tag] of [[on, 'on'], [fault, 'fault']] as const) {
      const R = player(m.sim, 'R');
      expectBooked(R, tag);
      expect(R.handoff!.t, tag).toBeCloseTo(0.5, 6);
      expect(R.handoff!.report.born!.some((b) => b.gross && b.own === 'core:torso' && b.other === 'D:core:torso'), tag).toBe(true);
      expect(R.handoff!.report.maxNewExternalPenetrationM, tag).toBeGreaterThan(0.1);
      expect(m.pair.length, tag).toBe(AFTER);
    }
    console.log(`ladder 17 born trunk pair, first solve after R's switch: ${on.pair[0].toFixed(3)} J held out, ${fault.pair[0].toFixed(3)} J in the solve (fault)`);
    expect(on.pair[0]).toBeLessThanOrEqual(INJECTION_J);
    expect(fault.pair[0]).toBeGreaterThan(2);
    // the explosion gate over the run, and over the read solves no gain of the gate's size
    const gained = on.pair.reduce((s, j) => s + Math.max(0, j), 0);
    expect(gained).toBeLessThan(EXPLODE_J);
    for (const p of on.sim.players) expect(p.ragStats!.maxSpeed, p.id).toBeLessThan(EXPLODE_MS);
    on.sim.dispose();
    fault.sim.dispose();
  }, 120000);

  it('the gross case under the retry: deferred over the window, then converted with the pair held out rather than left a rigid figure; without the profile it is refused at the window\'s end and falls rigid', async () => {
    const off = await runSim(await create(crowded({ trunk: true, retry: true, born: false })));
    const R0 = player(off, 'R');
    expect(R0.handoff!.outcome).toBe('rejected');
    expect(R0.handoff!.deferred).toBeTruthy();
    expect(rigid(R0)).toBe(true);
    off.dispose();
    const sim = await runSim(await create(crowded({ trunk: true, retry: true })));
    const R = player(sim, 'R');
    expectBooked(R, 'R');
    const h = R.handoff!;
    expect(h.deferred!.t).toBeCloseTo(0.5, 6);
    expect(h.t - h.deferred!.t).toBeGreaterThanOrEqual(0.25 - 1e-6);
    expect(h.report.tolerated).toContain('externalPenetration');
    expect(h.report.born!.some((b) => b.gross)).toBe(true);
    expect(rigid(R)).toBe(false);
    sim.dispose();
  }, 120000);

  it('the floor: a shoe born up to 5 cm in it converts and is pushed out without a launch; deeper is refused as before; without the profile the shallow one is refused too (the fault twin: accepting the deep one launches the shin)', async () => {
    const SHIN_UP_MS = 0.5;
    const shifted = (s: number, born: BornOverlapProfile | false): FixtureDef => {
      const d = FIX('G4-F1');
      const conversions = d.diagnostics!.conversions!.map((c) => ({ ...c, edit: { kind: 'surfaceShift' as const, segment: 'leftShin' as const, region: 'shoe' as const, offsetLocal: v3(0, -s, 0) } }));
      return { ...d, ragdoll: born ? withBornOverlap(d.ragdoll!, born) : d.ragdoll!, diagnostics: { ...d.diagnostics, conversions } };
    };
    /** Over 0.3 s from the switch: the shin's fastest upward speed and the trunk's rise. */
    const read = async (def: FixtureDef): Promise<{ p: PlayerRuntime; floorM: number; shinUp: number; coreRise: number; sim: Simulation }> => {
      let t0 = -1;
      let y0 = 0;
      let shinUp = 0;
      let coreRise = 0;
      const sim = await create(def, {
        onSubstep: (x) => {
          const rag = x.players[0].rag;
          if (!rag) return;
          if (t0 < 0) [t0, y0] = [x.t, rag.bodies.core.translation().y];
          if (x.t - t0 > 0.3) return;
          shinUp = Math.max(shinUp, rag.bodies.leftShin.linvel().y);
          coreRise = Math.max(coreRise, rag.bodies.core.translation().y - y0);
        },
      });
      await runSim(sim);
      const p = sim.players[0];
      return { p, floorM: p.handoff!.report.floorPenetrationM, shinUp, coreRise, sim };
    };
    const shallow = await read(shifted(0.055, BORN_OVERLAP_V1));
    expect(shallow.floorM).toBeGreaterThan(0.04);
    expect(shallow.floorM).toBeLessThanOrEqual(BORN_OVERLAP_V1.floorBornM);
    expectBooked(shallow.p, 'shallow');
    expect(shallow.p.handoff!.report.tolerated).toEqual(['floorPenetration']);
    console.log(`ladder 17 floor-born shoe ${(shallow.floorM * 100).toFixed(1)} cm: shin up ${shallow.shinUp.toFixed(2)} m/s, trunk rise ${(shallow.coreRise * 100).toFixed(2)} cm`);
    expect(shallow.shinUp).toBeLessThan(SHIN_UP_MS);
    expect(shallow.coreRise).toBeLessThan(0.01);
    expect(shallow.p.ragStats!.maxSpeed).toBeLessThan(EXPLODE_MS);
    shallow.sim.dispose();
    const regd = await read(shifted(0.055, false));
    // (the registered external depth reads the floor too)
    expect(regd.p.handoff!.report.reasons).toEqual(['floorPenetration', 'externalPenetration']);
    expect(rigid(regd.p)).toBe(true);
    regd.sim.dispose();
    const deep = await read(shifted(0.15, BORN_OVERLAP_V1));
    expect(deep.floorM).toBeGreaterThan(BORN_OVERLAP_V1.floorBornM);
    expect(deep.p.handoff!.outcome).toBe('rejected');
    expect(deep.p.handoff!.report.reasons).toEqual(['floorPenetration']);
    deep.sim.dispose();
    const loose = await read(shifted(0.15, { ...BORN_OVERLAP_V1, id: 'born-loose', floorBornM: 0.3 }));
    expect(loose.p.handoff!.outcome).toBe('accepted');
    expect(loose.shinUp).toBeGreaterThan(SHIN_UP_MS);
    loose.sim.dispose();
  }, 120000);
});

// Ladder 18 (`BornOverlapProfile.separation`, BORN_OVERLAP_V2): a held pair pushed apart, capped, rather than left to part.
// Left alone a held pair can deepen (the solve never sees it); pushed, none goes deeper than it was born, and it parts in
// about the profile's `partS`. The separation's work is read here from the motion itself: each force the probe reports
// (`debug.bornForce`, before the solve) times the mean of its point's velocities before and after the solve, on both
// bodies.

interface Held {
  /** Depth when born, deepest after any solve (m), the release time (s) and the separation's own count of its work (J). */
  depth0: number;
  deep: number;
  heldS: number | null;
  workJ: number | null;
  trunk: boolean;
}
interface Separated {
  sim: Simulation;
  /** Per held pair (`player:own~other`). */
  pairs: Map<string, Held>;
  /** The separating forces' work over the run, from the motion (J), and the fastest segment of R's right arm (m/s). */
  workJ: number;
  armMs: number;
}
const isTrunkKey = (k: string): boolean => /(^|:)(core|torso|pelvis|head)(:|$)/.test(k);
async function separated(def: FixtureDef, opts: SimOptions = {}): Promise<Separated> {
  const pending: { f: BornForce; lo: Vec3; hi: Vec3 }[] = [];
  const pairs = new Map<string, Held>();
  let workJ = 0;
  let armMs = 0;
  const sim = await create(def, {
    ...opts,
    debug: { ...opts.debug, bornForce: (f) => pending.push({ f, lo: vc(f.lo.velocityAtPoint(f.point)), hi: vc(f.hi.velocityAtPoint(f.point)) }) },
    onSubstep: (x) => {
      for (const { f, lo, hi } of pending) {
        const lo1 = vc(f.lo.velocityAtPoint(f.point));
        const hi1 = vc(f.hi.velocityAtPoint(f.point));
        // (the force on lo; hi takes its opposite)
        workJ += (dot(f.force, v3((lo.x + lo1.x) / 2, (lo.y + lo1.y) / 2, (lo.z + lo1.z) / 2)) - dot(f.force, v3((hi.x + hi1.x) / 2, (hi.y + hi1.y) / 2, (hi.z + hi1.z) / 2))) * x.physics.dt;
      }
      pending.length = 0;
      const w = x.physics.world;
      for (const pl of x.players) {
        for (const bp of pl.rag?.born ?? []) {
          const k = `${pl.id}:${bp.ownKey}~${bp.otherKey}`;
          let h = pairs.get(k);
          if (!h) pairs.set(k, (h = { depth0: bp.depth0M, deep: 0, heldS: null, workJ: null, trunk: isTrunkKey(bp.ownKey) && isTrunkKey(bp.otherKey) }));
          const a = w.getCollider(bp.own);
          const b = w.getCollider(bp.other);
          const c = a && b ? a.contactCollider(b, 0) : null;
          if (c) h.deep = Math.max(h.deep, -c.distance);
        }
      }
      const R = x.players.find((p) => p.id === 'R')!.rag;
      if (R) for (const sg of ['rightUpperArm', 'rightForearm'] as const) armMs = Math.max(armMs, Math.hypot(R.bodies[sg].linvel().x, R.bodies[sg].linvel().y, R.bodies[sg].linvel().z));
    },
  });
  await runSim(sim);
  for (const e of evs(sim, 'bornOverlapReleased')) {
    const h = pairs.get(`${e.playerId}:${e.data.own}~${e.data.other}`);
    if (h) [h.heldS, h.workJ] = [e.data.heldS as number, (e.data.workJ as number | undefined) ?? null];
  }
  return { sim, pairs, workJ, armMs };
}
const fmt = (m: Map<string, Held>): string => [...m.entries()].map(([k, h]) => `${k} ${(h.depth0 * 100).toFixed(1)}->${(h.deep * 100).toFixed(1)} cm held ${h.heldS?.toFixed(3)} s work ${h.workJ?.toFixed(2)}`).join('; ');

describe('ladder 18: born separation (a held born pair pushed apart, capped, rather than left to part)', () => {
  const S = BORN_OVERLAP_V2.separation!;

  it('the gross case (R born with his trunk 14 cm in D\'s ragdoll trunk, his right arm in it): left to part (V1, the twin) the pairs go deeper than born and the trunk pair is held 0.6 s; pushed apart (V2) none goes deeper than born, the limb pairs part within 0.2 s and the trunk pair well before V1\'s, each within its work budget by the separation\'s count and all within theirs by the motion; the explosion gate holds', async () => {
    const v1 = await separated(crowded({ trunk: true }));
    const v2 = await separated(crowded({ trunk: true, born: BORN_OVERLAP_V2 }));
    console.log(`ladder 18 gross case, V1: ${fmt(v1.pairs)}`);
    console.log(`ladder 18 gross case, V2: ${fmt(v2.pairs)}; work from the motion ${v2.workJ.toFixed(2)} J`);
    for (const [m, tag] of [[v1, 'V1'], [v2, 'V2']] as const) {
      expectBooked(player(m.sim, 'R'), tag);
      expect(m.pairs.size, tag).toBeGreaterThanOrEqual(4);
      // every pair released within the run, none left
      for (const [k, h] of m.pairs) expect(h.heldS, `${tag} ${k}`).not.toBeNull();
      for (const p of m.sim.players) expect(p.ragStats!.maxSpeed, `${tag} ${p.id}`).toBeLessThan(EXPLODE_MS);
    }
    // the twin: left to part, the trunk pair and an arm pair deepen while held
    const trunk1 = v1.pairs.get('R:core:torso~D:core:torso')!;
    expect(trunk1.deep - trunk1.depth0).toBeGreaterThan(0.01);
    expect(trunk1.heldS!).toBeGreaterThan(0.5);
    expect(v2.pairs.get('R:core:torso~D:core:torso')!.heldS!).toBeLessThan(trunk1.heldS! - 0.15);
    expect([...v1.pairs.values()].some((h) => !h.trunk && h.deep - h.depth0 > 0.005)).toBe(true);
    expect(v1.workJ).toBe(0);
    for (const [k, h] of v2.pairs) {
      expect(h.deep, `V2 ${k}`).toBeLessThanOrEqual(h.depth0 + 0.001);
      if (!h.trunk) expect(h.heldS!, `V2 ${k}`).toBeLessThanOrEqual(0.2);
      // (the trunk pairs: within their budget, the trunk in the trunk well before V1's; the shallower trunk in the pelvis
      // about as soon as V1's, which nothing drives deeper)
      expect(h.heldS!, `V2 ${k}`).toBeLessThanOrEqual(Math.max(0.2, v1.pairs.get(k)!.heldS! + 0.01));
      expect(h.workJ!, `V2 ${k}`).toBeLessThanOrEqual(S.workJ + 1e-9);
    }
    expect(v2.workJ).toBeGreaterThan(0);
    expect(v2.workJ).toBeLessThanOrEqual(v2.pairs.size * S.workJ);
    v1.sim.dispose();
    v2.sim.dispose();
  }, 120000);

  it('no kick: R\'s right arm born 3.7 cm in D\'s torso is pushed out in about 0.15 s by under 0.5 J (from the motion); the fault (`bornSeparationUncapped`, the depenetration the solve would give: the whole depth in one solve) does over 20 J and throws the arm out at over twice the speed', async () => {
    const on = await separated(crowded({ born: BORN_OVERLAP_V2 }));
    const fault = await separated(crowded({ born: BORN_OVERLAP_V2 }), { debug: { conversion: { bornSeparationUncapped: true } } });
    console.log(`ladder 18 arm case: capped ${on.workJ.toFixed(3)} J, arm ${on.armMs.toFixed(2)} m/s (${fmt(on.pairs)}); uncapped ${fault.workJ.toFixed(1)} J, arm ${fault.armMs.toFixed(2)} m/s`);
    for (const [m, tag] of [[on, 'on'], [fault, 'fault']] as const) {
      expectBooked(player(m.sim, 'R'), tag);
      expect(m.pairs.size, tag).toBeGreaterThanOrEqual(2);
      for (const [k, h] of m.pairs) {
        expect(h.heldS, `${tag} ${k}`).not.toBeNull();
        expect(h.deep, `${tag} ${k}`).toBeLessThanOrEqual(h.depth0 + 0.001);
      }
    }
    for (const [k, h] of on.pairs) expect(h.heldS!, k).toBeLessThanOrEqual(0.2);
    expect(on.workJ).toBeGreaterThan(0);
    expect(on.workJ).toBeLessThan(0.5);
    expect(fault.workJ).toBeGreaterThan(20);
    expect(fault.armMs).toBeGreaterThan(2 * on.armMs);
    on.sim.dispose();
    fault.sim.dispose();
  }, 120000);

  it('R and D converted in the same batch (the pair they were both born in held by whichever comes first): both orders release the same pairs, R and D accepted at the same step, each order deterministic', async () => {
    const d = crowded({ born: BORN_OVERLAP_V2 });
    const both = { ...d, diagnostics: { ...d.diagnostics, conversions: [{ playerId: 'D', atS: 0.5 }, { playerId: 'R', atS: 0.5 }] } };
    const seen: { rel: string[]; steps: string; summary: string }[] = [];
    for (const reverseOrder of [false, true, false, true]) {
      const sim = await runSim(await create(both, { reverseOrder }));
      const rel = evs(sim, 'bornOverlapReleased').map((e) => [`${e.playerId}:${e.data.own}`, e.data.other as string].sort().join('~'));
      seen.push({ rel: rel.sort(), steps: sim.players.map((p) => `${p.id} ${p.handoff!.outcome}@${p.handoff!.step}`).sort().join(', '), summary: JSON.stringify(sim.summary()) });
      sim.dispose();
    }
    // the shared pair is held once: by R forward, by D reversed
    expect(seen[0].rel.length).toBeGreaterThanOrEqual(4);
    expect(seen[1].rel).toEqual(seen[0].rel);
    expect(seen[1].steps).toBe(seen[0].steps);
    expect(seen[0].steps).toBe('D accepted@120, R accepted@120');
    expect(seen[2].summary).toBe(seen[0].summary);
    expect(seen[3].summary).toBe(seen[1].summary);
  }, 120000);
});

