import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { GROUP_STATIC, interactionGroups } from '../src/sim/physics';
import { ENVELOPE_L4, LEG_GUARD_V3, type RagdollEnvelope, type RagdollProfile } from '../src/sim/profiles';
import type { Simulation } from '../src/sim/simulation';
import { FIX, preFlip, runSim } from './helpers';
import { loadedLimbMonitor, type LimbRecord } from './loaded-limb';
import { loadState, resumeState } from './state';

// Ladder rung 7f: the loaded-limb persistence rule (tests/loaded-limb.ts) on its case. L4-F3-run-on under the physical
// supported legs (LEG_GUARD_V3), captured at the end of tick 66 (1.100 s): R lies on its right side, rolling back onto
// its right arm, the arm chain carrying 0.3-2 body weights on the floor; its right shoulder is 5-7.6 deg past the swing
// limit (tolerance 5) from 1.25 to 1.54 s, held there by the load (static deflection load / k = 190 / 1500 N m/rad,
// 7.3 deg, under the 500 N m cap), while the envelope pushes it inward every substep. The envelope's own clock reads
// 0.2875 s against the persistence limit 0.25 s; the rule finds the limb pinned throughout, within its load's
// deflection. The twins change R's running envelope or its arm's contact from a chosen time; the rule judges them
// against the declared envelope.
const CAPTURE = 'tests/data/state/L4-F3-run-on~v3@66.json.gz';
const ID = 'L4-F3-run-on';
const PERSIST = ENVELOPE_L4.persistS;
type Twin = (s: Simulation) => void;

/** The capture to its end, with `twin` applied to the state after the first substep at or past `at`. */
async function resumed(twin?: Twin, at = 0): Promise<Record<string, LimbRecord>> {
  // (captured before the visible flip: resumed under the profile it ran under)
  const def: FixtureDef = { ...preFlip(FIX(ID)), legGuard: LEG_GUARD_V3 };
  const sim = await resumeState(loadState(CAPTURE), { def });
  const declared = new Map<string, RagdollEnvelope>();
  for (const p of sim.players) if (p.rag?.profile.envelope) declared.set(p.id, p.rag.profile.envelope);
  const mon = loadedLimbMonitor((pid) => declared.get(pid)!);
  let applied = !twin;
  sim.opts.onSubstep = (s) => {
    mon.substep(s);
    if (!applied && s.t >= at - 1e-9) {
      twin!(s);
      applied = true;
    }
  };
  await runSim(sim);
  sim.dispose();
  return Object.fromEntries(mon.records().map((r) => [r.key, r]));
}

/** R's shoulder swing spring (both sides: one envelope) from now on. */
const swing =
  (stiffness: (k: number) => number, damping: (c: number) => number): Twin =>
  (s) => {
    const rag = s.players.find((p) => p.id === 'R')!.rag!;
    const E = rag.profile.envelope!;
    const sw = E.shoulder.swing;
    rag.profile = { ...rag.profile, envelope: { ...E, shoulder: { ...E.shoulder, swing: { stiffnessNmPerRad: stiffness(sw.stiffnessNmPerRad), dampingNmsPerRad: damping(sw.dampingNmsPerRad) } } } } as RagdollProfile;
  };
const off = swing(() => 0, () => 0);
/** R's right arm chain stops touching static ground: the floor lets go of it at once. */
const unload: Twin = (s) => {
  for (const c of s.players.find((p) => p.id === 'R')!.rag!.colliders) if (c.segment === 'rightUpperArm' || c.segment === 'rightForearm') c.collider.setCollisionGroups(interactionGroups(0xffff & ~GROUP_STATIC, 0xffff & ~GROUP_STATIC));
};

describe('ladder rung 7f: the loaded-limb persistence rule (L4-F3-run-on, V3, from 1.10 s)', () => {
  it("R's right shoulder, pinned by the floor past the tolerance longer than the persistence limit, is within its load's deflection; the fault twins fail the rule's three parts", async () => {
    const base = (await resumed())['R rightShoulder'];
    // the envelope's clock alone fails, the rule passes: pinned throughout, within the deflection, no unload past it
    expect(base.oldRunS).toBeGreaterThan(PERSIST);
    expect(base.pinnedS).toBeGreaterThan(PERSIST);
    expect(base.freeRunS).toBeLessThan(PERSIST);
    expect(base.overBoundDeg).toBeLessThan(0);
    expect(base.returnOverS).toBeLessThanOrEqual(0);

    // (i) the swing spring off at 1.30 s, the limb pinned and past: the load no longer explains the excess (it stays with
    // no load moment to hold it), and only the loaded bound sees it: the limb never leaves the floor
    const i = (await resumed(off, 1.3))['R rightShoulder'];
    expect(i.overBoundDeg).toBeGreaterThan(5);
    expect(i.freeRunS).toBeLessThan(PERSIST);

    // (ii) the swing spring off from the start: R's left arm, which the floor never holds, folds past the tolerance and
    // stays: the free clock fails it as the envelope's own clock does
    const ii = (await resumed(off))['R leftShoulder'];
    expect(ii.pinnedS).toBe(0);
    expect(ii.oldRunS).toBeGreaterThan(PERSIST);
    expect(ii.freeRunS).toBeGreaterThan(PERSIST);

    // the unload: at 1.40 s, 7 deg past, the floor lets go of the right arm, and the envelope returns it inside within its
    // crossing time plus a tick
    const u = (await resumed(unload, 1.4))['R rightShoulder'];
    expect(u.returnAt).toBeGreaterThan(1.39);
    expect(u.returnS).toBeGreaterThan(0);
    expect(u.returnOverS).toBeLessThanOrEqual(0);

    // (iii) the same unload with the swing spring at 1/25 from there: the return is slow, past its bound, while the free
    // clock stays under the persistence limit
    const iii = (await resumed((s) => (unload(s), swing((k) => k / 25, (c) => c)(s)), 1.4))['R rightShoulder'];
    expect(iii.returnOverS).toBeGreaterThan(0.05);
    expect(iii.freeRunS).toBeLessThan(PERSIST);
  }, 240000);
});
