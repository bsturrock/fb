import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BORN_OVERLAP_V1, withBornOverlap, withConversionRetry, type BornOverlapProfile } from '../src/sim/profiles';
import type { PlayerRuntime, Simulation, SimOptions } from '../src/sim/simulation';
import { v3 } from '../src/sim/vec';
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
