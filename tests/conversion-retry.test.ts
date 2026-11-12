import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { CONVERSION_RETRY_V1, withConversionRetry, type ConversionRetryProfile } from '../src/sim/profiles';
import type { Simulation } from '../src/sim/simulation';
import { create, evs, FIX, flip8i, preHoldStill, preV3, rows, runSim } from './helpers';
import { INJECTION_J, passiveEnergyMeter } from './passive-energy';
import { loadState, resumeState } from './state';

// Ladder rung 8j: the deferred conversion (`RagdollProfile.conversionRetry`, CONVERSION_RETRY_V1; no fixture runs it).
// A conversion is tried once: a candidate rejected for any reason leaves the player the Gate 3 falling proxy, a rigid
// body with its shown pose, to the end of the run (`PlayerRuntime.handoff` is set, and conversions are queued only for a
// player without one), and from the rejection on its shown pose is no longer guarded for validity. Under the ladder 8i
// visible flip four runs end so: D's posed leg is inside R's ragdoll past the validation's tolerance at its conversion,
// met there by R's moving body (HC-F3-falling reversed: R's left palm 1.57 cm into D's right thigh, past the tolerance in
// that substep only) or held there for some substeps (the LEG_IN_RAGDOLL class). The registered profile rejects each the
// same from the same state (ladder 8i). Unguarded, D's posed legs then sink 2-9 cm into R's legs and come out again; a
// candidate built from them would be valid 5-22 substeps after the rejection (21-92 ms), and stays so.
// Captured under the 8i variant (scripts/capture-state.ts --flip8i; the leg guard before the ladder 10 flip, `preV3`),
// each a few ticks before D's conversion:
const CASES: { cap: string; rejectedAt: number; outcome: 'accepted' | 'transferFailed' }[] = [
  // D's diagnostic conversion at 1.171 s: right thigh 1.57 cm in R's left palm; deferred: converts at the next try
  { cap: 'HC-F3-falling~flip8i-rev@69', rejectedAt: 1.1708, outcome: 'accepted' },
  // HC-F5-strictTransfer exists to show the strict transfer audit failing (`+energyGain=0`: any gain fails, both players
  // `transferFailed`, the result `invalidTransfer`, never a completion); D's rejection is not its contract. Forward: right
  // thigh 3.37 cm in R's pelvis at 1.288 s (3 substeps held); deferred: converts after 6 tries and fails its strict audit
  // (energyGain), the registered outcome. Reversed: left shin 3.42 cm in R's right thigh at 1.246 s (13 substeps held);
  // 4 tries, the same
  { cap: 'HC-F5-strictTransfer~flip8i@75', rejectedAt: 1.2875, outcome: 'transferFailed' },
  { cap: 'HC-F5-strictTransfer~flip8i-rev@70', rejectedAt: 1.2458, outcome: 'transferFailed' },
  // right thigh 2.71 cm in R's pelvis at 1.300 s (6 substeps held); 11 tries
  { cap: 'L3-F1-phase4~flip8i-rev@72', rejectedAt: 1.3, outcome: 'accepted' },
];
const fixtureOf = (cap: string): string => cap.split('@')[0].split('~')[0];
/** Solves read after the switch: 0.1 s. */
const AFTER = 24;
/** The energy fault's addition (J). */
const ADD_J = 2;

const withRetry = (d: FixtureDef, p: ConversionRetryProfile = CONVERSION_RETRY_V1): FixtureDef => ({ ...d, ragdoll: withConversionRetry(d.ragdoll!, p) });

/** The deepest any of `pid`'s ragdoll segment colliders is inside another player's active colliders (m), with the pair. */
function deepestIn(sim: Simulation, pid: string): { depth: number; pair: string } {
  const host = sim as unknown as { activeColliders(o: unknown): import('@dimforge/rapier3d-compat').Collider[] };
  const me = sim.players.find((p) => p.id === pid)!;
  let out = { depth: 0, pair: '' };
  for (const c of me.rag?.colliders ?? [])
    for (const o of sim.players) {
      if (o === me) continue;
      for (const k of host.activeColliders(o)) {
        const r = c.collider.shape.contactShape(c.collider.translation(), c.collider.rotation(), k.shape, k.translation(), k.rotation(), 0);
        if (r && -r.distance > out.depth) out = { depth: -r.distance, pair: `${c.segment}:${c.region} in ${o.id}:${sim.physics.tags.get(k.handle)?.key}` };
      }
    }
  return out;
}

interface Solve {
  D: number;
  R: number;
  touched: boolean;
}
interface Start {
  sim: Simulation;
  switchStep: number;
  /** Over AFTER solves from D's switch: the deepest D's segments are in another player, and each solve's passive gain of D and R (J) with whether another player touched D. */
  depth: { depth: number; pair: string };
  solves: Map<number, Solve>;
}
const untouchedMaxJ = (s: Start): number => Math.max(-Infinity, ...[...s.solves.values()].filter((r) => !r.touched).map((r) => r.D));
const pairMaxJ = (s: Start): number => Math.max(-Infinity, ...[...s.solves.values()].map((r) => r.D + r.R));

/**
 * The capture resumed under `def` to its end, read over the AFTER solves from D's switch. `addAt`: the energy fault, 2 J
 * of kinetic energy added to D's core inside that solve (Simulation.steps after it; between the meter's two readings, as
 * tests/passive-energy.test.ts does).
 */
async function start(cap: string, def: FixtureDef, variant: string[], addAt?: number): Promise<Start> {
  let switchStep = -1;
  let depth = { depth: 0, pair: '' };
  const sim = await resumeState(loadState(`tests/data/state/${cap}.json.gz`), {
    def,
    variant,
    opts: {
      onSubstep: (s) => {
        const D = s.players.find((p) => p.id === 'D')!;
        if (D.rag && switchStep < 0) switchStep = D.handoff!.step;
        if (switchStep >= 0 && s.steps - switchStep <= AFTER) {
          const d = deepestIn(s, 'D');
          if (d.depth > depth.depth) depth = d;
        }
      },
    },
  });
  if (addAt !== undefined) {
    // inside the solve: after the engine's step, before the meter's second reading (the meter wraps this one)
    const phys = sim.physics;
    const step = phys.step;
    phys.step = function (this: typeof phys): void {
      step.call(this);
      if (sim.steps + 1 !== addAt) return;
      const core = sim.players.find((p) => p.id === 'D')!.rag!.bodies.core;
      const v = core.linvel();
      const m = core.mass();
      const sp = Math.hypot(v.x, v.y, v.z);
      const u = sp > 1e-6 ? { x: v.x / sp, y: v.y / sp, z: v.z / sp } : { x: 0, y: 1, z: 0 };
      const dv = -sp + Math.sqrt(sp * sp + (2 * ADD_J) / m);
      core.setLinvel({ x: v.x + u.x * dv, y: v.y + u.y * dv, z: v.z + u.z * dv }, true);
    };
  }
  const solves = new Map<number, Solve>();
  const meter = passiveEnergyMeter(sim, (e) => {
    // (the meter reads a solve before onSubstep runs: the switch is read here too, for the first solve after it)
    const D = sim.players.find((p) => p.id === 'D')!;
    if (D.rag && switchStep < 0) switchStep = D.handoff!.step;
    if (switchStep < 0 || e.step - switchStep > AFTER) return;
    const r = solves.get(e.step) ?? { D: NaN, R: 0, touched: false };
    if (e.pid === 'D') Object.assign(r, { D: e.passiveJ, touched: e.touched });
    else r.R = e.passiveJ;
    solves.set(e.step, r);
  });
  await runSim(sim);
  meter.restore();
  return { sim, switchStep, depth, solves };
}

describe('ladder rung 8j: the deferred conversion', () => {
  it('as captured D is rejected for a posed leg in R and left a rigid falling proxy to the end; deferred, D converts within the window from a candidate inside the tolerance, with the outcome the fixture registers (HC-F3-falling, HC-F5-strictTransfer both orders, L3-F1-phase4, under the 8i variant)', async () => {
    await rows(CASES, (c) => c.cap, async (c) => {
      const base = flip8i(preV3(preHoldStill(FIX(fixtureOf(c.cap)))));
      const tol = base.ragdoll!.validation.penetrationTolM;
      // the twin: as captured (no deferral), the rejection is final
      const off = await runSim(await resumeState(loadState(`tests/data/state/${c.cap}.json.gz`), { def: base }));
      const rej = evs(off, 'handoffRejected', 'D');
      expect(rej.map((e) => e.t)).toEqual([expect.closeTo(c.rejectedAt, 4)]);
      expect(rej[0].data.reasons).toBe('externalPenetration');
      expect(rej[0].data.worstExternal.own).toMatch(/^(left|right)(Thigh|Shin):/);
      expect(rej[0].data.worstExternal.other).toMatch(/^R:/);
      const Doff = off.players.find((p) => p.id === 'D')!;
      expect([Doff.handoff!.outcome, Doff.controlMode, Doff.representation, !!Doff.rag]).toEqual(['rejected', 'falling', 'proxy', false]);
      expect(evs(off, 'handoffDeferred')).toEqual([]);
      off.dispose();

      const sim = await runSim(await resumeState(loadState(`tests/data/state/${c.cap}.json.gz`), { def: withRetry(base), variant: ['ragdoll'] }));
      expect(evs(sim, 'handoffRejected')).toEqual([]);
      const def = evs(sim, 'handoffDeferred', 'D');
      expect(def.map((e) => e.t)).toEqual([expect.closeTo(c.rejectedAt, 4)]);
      expect(def[0].data.worstExternal).toEqual(rej[0].data.worstExternal);
      const D = sim.players.find((p) => p.id === 'D')!;
      const h = D.handoff!;
      expect(D.representation).toBe('ragdoll');
      expect(h.outcome).toBe(c.outcome);
      if (c.outcome === 'transferFailed') expect(h.audit!.reasons).toEqual(['energyGain']);
      expect(h.deferred!.t).toBeCloseTo(c.rejectedAt, 4);
      expect(h.deferred!.tries).toBeGreaterThanOrEqual(1);
      expect(h.t - h.deferred!.t).toBeLessThan(CONVERSION_RETRY_V1.windowS);
      expect(h.report.ok).toBe(true);
      expect(h.report.maxNewExternalPenetrationM).toBeLessThanOrEqual(tol);
      expect(D.deferred).toBeUndefined();
      sim.dispose();
    });
  }, 120000);

  it('the deferred conversion starts clear of R and without an energy spike: over 0.1 s no segment deeper in R than the tolerance, no solve gaining over the injection threshold (untouched, or D and R together); twins: converted at the first try regardless of depth it starts past the tolerance; 2 J added in D\'s first untouched solve reads as an injection', async () => {
    await rows(CASES, (c) => c.cap, async (c) => {
      const base = flip8i(preV3(preHoldStill(FIX(fixtureOf(c.cap)))));
      const tol = base.ragdoll!.validation.penetrationTolM;
      const on = await start(c.cap, withRetry(base), ['ragdoll']);
      on.sim.dispose();
      expect(on.switchStep).toBeGreaterThan(0);
      expect(on.solves.size).toBe(AFTER);
      // measured: 1.11, 0.53, 1.30, 0.96 cm deepest; the largest untouched gain -0.02 J; D and R together at most -0.03 J
      expect(on.depth.depth, on.depth.pair).toBeLessThanOrEqual(tol);
      expect(untouchedMaxJ(on)).toBeLessThan(INJECTION_J);
      expect(pairMaxJ(on)).toBeLessThan(INJECTION_J);
      // the depth twin: the same state with the tolerance at 10 cm (a profile of the twin's own), D converting where it
      // was rejected; measured 1.56, 3.27, 3.41, 2.66 cm
      const R = base.ragdoll!;
      const loose: FixtureDef = { ...base, ragdoll: { ...R, id: `${R.id}+tol0.1`, validation: { ...R.validation, penetrationTolM: 0.1 } } };
      const forced = await start(c.cap, loose, ['ragdoll']);
      expect(forced.sim.players.find((p) => p.id === 'D')!.handoff!.t).toBeCloseTo(c.rejectedAt, 4);
      forced.sim.dispose();
      expect(forced.depth.depth, forced.depth.pair).toBeGreaterThan(tol);
      // the energy twin: the same deferred run with 2 J added inside D's first untouched solve after the switch
      const at = [...on.solves.entries()].find(([, r]) => !r.touched)![0];
      const twin = await start(c.cap, withRetry(base), ['ragdoll'], at);
      twin.sim.dispose();
      // (it reads 2 J more there, D and R together too; R's own loss in that solve can hide it from the pair's maximum)
      expect(twin.solves.get(at)!.D - on.solves.get(at)!.D).toBeCloseTo(ADD_J, 3);
      expect(twin.solves.get(at)!.D + twin.solves.get(at)!.R - (on.solves.get(at)!.D + on.solves.get(at)!.R)).toBeCloseTo(ADD_J, 3);
      expect(untouchedMaxJ(twin)).toBeGreaterThan(INJECTION_J);
    });
  }, 180000);

  it('a try at or past the window that is rejected is final, with the deferral recorded (HC-F5-strictTransfer forward, a window of 2 substeps); a candidate rejected for a reason outside the profile\'s is final at once (HC-F5-invalidOne, D\'s labelled anchor offset), deferred when the reason is the profile\'s (twin)', async () => {
    const cap = 'HC-F5-strictTransfer~flip8i@75';
    const base = flip8i(preV3(preHoldStill(FIX(fixtureOf(cap)))));
    const dt = base.solver.outerTickS / base.solver.substeps;
    const short = await runSim(await resumeState(loadState(`tests/data/state/${cap}.json.gz`), { def: withRetry(base, { ...CONVERSION_RETRY_V1, id: 'retry-2substeps', windowS: 2 * dt }), variant: ['ragdoll'] }));
    const D = short.players.find((p) => p.id === 'D')!;
    expect(evs(short, 'handoffDeferred', 'D').map((e) => e.t)).toEqual([expect.closeTo(1.2875, 4)]);
    const rej = evs(short, 'handoffRejected', 'D');
    expect(rej.map((e) => e.t)).toEqual([expect.closeTo(1.2875 + 2 * dt, 4)]);
    expect(rej[0].data.deferred).toEqual({ t: expect.closeTo(1.2875, 4), step: expect.any(Number), tries: 2 });
    expect([D.handoff!.outcome, D.handoff!.deferred!.tries, D.controlMode, D.representation, D.deferred]).toEqual(['rejected', 2, 'falling', 'proxy', undefined]);
    short.dispose();
    // (the full window converts the same state: the first test)

    const invalid = FIX('HC-F5-invalidOne');
    const once = await runSim(await create(withRetry(invalid)));
    const r1 = evs(once, 'handoffRejected', 'D');
    expect(r1.length).toBe(1);
    expect(r1[0].data.reasons).toBe('jointAnchor,landmarkDiscontinuity');
    expect(r1[0].data.deferred).toBeUndefined();
    expect(evs(once, 'handoffDeferred')).toEqual([]);
    expect(once.players.find((p) => p.id === 'R')!.handoff!.outcome).toBe('accepted');
    once.dispose();
    // the twin: the offset's reasons (the anchor and the landmarks it moves) deferred too, so D is tried again for the
    // whole window and rejected at its end
    const all = await runSim(await create(withRetry(invalid, { ...CONVERSION_RETRY_V1, id: 'retry-anchor', reasons: ['externalPenetration', 'jointAnchor', 'landmarkDiscontinuity'] })));
    const d2 = evs(all, 'handoffDeferred', 'D');
    const r2 = evs(all, 'handoffRejected', 'D');
    expect(d2.length).toBe(1);
    expect(r2.length).toBe(1);
    expect(r2[0].t - d2[0].t).toBeCloseTo(CONVERSION_RETRY_V1.windowS, 6);
    expect(r2[0].data.deferred.tries).toBe(Math.round(CONVERSION_RETRY_V1.windowS / dt));
    all.dispose();
  }, 120000);
});
