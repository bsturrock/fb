import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { FALL_L4, LEG_GUARD_V3, type FallResponseProfile } from '../src/sim/profiles';
import type { SegmentId } from '../src/sim/contracts';
import { dot, sub, vc } from '../src/sim/vec';
import { asCaptured } from './helpers';
import { loadState, resumeState } from './state';

// Ladder rung 6c (fall response v6, `impactGuard.carried`). L4-F9-defenderFalling under the physical supported legs
// (LEG_GUARD_V3), captured at the end of tick 65 (1.083 s, both players ragdolls, D's fall response running): two
// substeps before the solve ending 1.200 s, D's right thigh closes on R's core at about 1.5 m/s, under the body speed
// (bodyClosingMPerS), while R's core lands on the floor at about 4.9 m/s. The guard's closing rule holds D's right leg
// only; the solve takes R's landing through the thigh (R's core on D's right thigh, > 80 N s) into D's core, and D's
// response realizes about 172 W against the 157.5 W ceiling. With `carried` the thigh, jointed to the core and closing on
// a body that lands faster than the body speed, holds D's whole body there: no substep over the ceiling. The twin is
// the same state resumed under FALL_L4 without the flag.
// The control (the narrow form: closing on the landing body): before that, R lands faster than the body speed three
// times (1.096, 1.133 and 1.150 s) with D's left thigh resting on it (touching, not closing): no carried hold there, and
// the runs with and without the flag are the same up to the first carried hit.
// Rung 7c: the capture predates the solved impulse reading (`SolverProfile.solvedImpulses`); it is resumed under it
// (the `solver` variant). The fixture run from the start under the solved reading no longer reaches this landing: D
// stays under the ceiling without `carried` too (132.7 W), so the state is kept as captured.
const CAPTURE = 'tests/data/state/L4-F9-defenderFalling~v3@65.json.gz';
const CEILING = FALL_L4.power.maxPositiveW * (1 + FALL_L4.power.toleranceFraction);
const UNTIL = 292;
const NO_CARRIED: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-noCarried`, impactGuard: { ...FALL_L4.impactGuard, carried: undefined } };

interface Row {
  steps: number;
  /** before the solve: R's fastest closing on the floor (within the lookahead), D's core-jointed segments' closest gap to R and their closing on it, D's closingSpeeds, the carried query */
  land: number;
  gap: number;
  closingOnR: Partial<Record<SegmentId, number>>;
  cs: Partial<Record<SegmentId, number>>;
  carried: Partial<Record<SegmentId, number>>;
  /** after the solve: the largest impulse between R's core and D's right thigh, D's effort stats */
  coreOnThighNs: number;
  overPower: number;
  heldBody: number;
  peakW: number;
}

async function resumed(carried: boolean): Promise<Row[]> {
  // (captured under LEG_GUARD_V3 before the visible flip: resumed under the definition it ran under, the solver aside)
  const cap = loadState(CAPTURE);
  const v3: FixtureDef = asCaptured(cap, (d) => ({ ...d, legGuard: LEG_GUARD_V3 }), ['solver']);
  const def = carried ? v3 : { ...v3, fallResponse: NO_CARRIED };
  const sim = await resumeState(cap, { def, variant: carried ? ['solver'] : ['solver', 'fallResponse'] });
  // (the private substep, wrapped to read the state before each solve and after it)
  const host = sim as unknown as { stepSubstep(i: number): void };
  const G = FALL_L4.impactGuard;
  const la = G.lookaheadSubsteps * sim.dt;
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const rows: Row[] = [];
  const orig = host.stepSubstep.bind(sim);
  host.stepSubstep = (i: number) => {
    const rag = D.rag!;
    const onCore = rag.colliders.map((c) => c.segment).filter((seg) => rag.joints.some((j) => j.child === seg && j.parent === 'core'));
    let land = 0;
    for (const oc of R.rag!.colliders) {
      const r = sim.physics.floorCollider.contactCollider(oc.collider, G.predictionM);
      if (!r) continue;
      const v = -dot(vc(R.rag!.bodies[oc.segment].velocityAtPoint(r.point2)), vc(r.normal1));
      if (r.distance - v * la < G.skinM) land = Math.max(land, v);
    }
    let gap = Infinity;
    const closingOnR: Partial<Record<SegmentId, number>> = {};
    for (const rc of rag.colliders) {
      if (!onCore.includes(rc.segment)) continue;
      for (const oc of R.rag!.colliders) {
        const r = oc.collider.contactCollider(rc.collider, G.predictionM);
        if (!r) continue;
        gap = Math.min(gap, r.distance);
        const v = -dot(sub(vc(rag.bodies[rc.segment].velocityAtPoint(r.point2)), vc(R.rag!.bodies[oc.segment].velocityAtPoint(r.point1))), vc(r.normal1));
        if (r.distance - v * la < G.skinM) closingOnR[rc.segment] = Math.max(closingOnR[rc.segment] ?? -Infinity, v);
      }
    }
    const cs = sim.closingSpeeds(rag, la, G.predictionM, G.skinM, true, true);
    const carriedNow = sim.carriedImpacts(rag, onCore, la, G.predictionM, G.skinM, G.bodyClosingMPerS, G.closingMPerS);
    const steps = sim.steps;
    orig(i);
    let coreOnThighNs = 0;
    for (const c of sim.contacts) {
      const rc = c.a.playerId === 'R' ? c.a : c.b.playerId === 'R' ? c.b : null;
      const dc = c.a.playerId === 'D' ? c.a : c.b.playerId === 'D' ? c.b : null;
      if (rc?.part === 'core' && dc?.part === 'rightThigh') coreOnThighNs = Math.max(coreOnThighNs, c.impulse);
    }
    const s = D.fall!.stats;
    rows.push({ steps, land, gap, closingOnR, cs, carried: carriedNow, coreOnThighNs, overPower: s.overPowerSubsteps, heldBody: s.heldBodySubsteps, peakW: s.peakPositiveW });
  };
  while (sim.steps < UNTIL && !sim.done) sim.stepTick();
  sim.dispose();
  return rows;
}

describe('L4 impact guard v6: a landing carried through a closing contact (L4-F9-defenderFalling under V3, seeded)', () => {
  it('without `carried` the landing goes through D\'s right thigh, held as a limb only, over the ceiling; with it D holds its body there and stays under; a landing body D only rests on holds nothing', async () => {
    const off = await resumed(false);
    const on = await resumed(true);
    const G = FALL_L4.impactGuard;
    expect(on.length).toBe(off.length);
    // the twin: exactly one substep over the ceiling, the solve that takes R's core through D's right thigh
    const k = off.findIndex((x) => x.overPower > 0);
    expect(k).toBeGreaterThan(0);
    expect(off[off.length - 1].overPower).toBe(1);
    expect(off[k].peakW).toBeGreaterThan(CEILING);
    expect(off[k].coreOnThighNs).toBeGreaterThan(40);
    // ... for the intended reason: before that solve the thigh closes on R above the guard speed and under the body speed
    // (the closing rule holds the leg only, not the body), R lands faster than the body speed, the body is not held
    const pre = off[k];
    expect(pre.cs.rightThigh!).toBeGreaterThan(G.closingMPerS);
    expect(pre.cs.rightThigh!).toBeLessThanOrEqual(G.bodyClosingMPerS);
    expect(pre.closingOnR.rightThigh!).toBeGreaterThan(G.closingMPerS);
    expect(pre.land).toBeGreaterThan(G.bodyClosingMPerS);
    expect(Object.keys(pre.carried)).toEqual(['rightThigh']);
    expect(off[k].heldBody).toBe(off[k - 1].heldBody);
    // with the flag: the body held in that substep, none over the ceiling
    expect(on[k].heldBody).toBe(on[k - 1].heldBody + 1);
    expect(on[on.length - 1].overPower).toBe(0);
    expect(on[on.length - 1].peakW).toBeLessThanOrEqual(CEILING);
    // the first carried hit, and the two runs the same before it
    const j = on.findIndex((x) => Object.keys(x.carried).length > 0);
    expect(j).toBeGreaterThan(0);
    expect(j).toBeLessThanOrEqual(k);
    for (let i = 0; i < j; i++) expect([on[i].heldBody, on[i].peakW], `substep ${on[i].steps}`).toEqual([off[i].heldBody, off[i].peakW]);
    // the control: R landing faster than the body speed with a D core-jointed segment resting on it (touching, within
    // 1 mm, not closing above the guard speed) holds nothing
    const rest = on.slice(0, j).filter((x) => x.land > G.bodyClosingMPerS && x.gap <= 0.001);
    expect(rest.length).toBeGreaterThanOrEqual(2);
    for (const x of rest) {
      expect(Object.values(x.closingOnR).every((v) => v! <= G.closingMPerS), `substep ${x.steps}`).toBe(true);
      expect(x.carried, `substep ${x.steps}`).toEqual({});
    }
  }, 120000);
});
