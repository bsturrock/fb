// Plan 11: arm self-clearance. Arms used to ignore the player's own body (supported pose arms, arm-task arms and the
// ragdoll's same-owner filter), so forearms and hands crossed the torso by up to 28 cm. Under the opt-in profile (the
// L3, L4 and HC fixtures) each arm's self shapes (forearm over its joints, palm, fingers) stay out of the player's
// measured trunk (mesh-fit convex pieces) beyond the skin-contact tolerance; every other fixture is unchanged.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import type { FixtureDef } from '../src/sim/fixture';
import { MODEL_CALIBRATION as C } from '../src/sim/model/profiles';
import { armSelfShapes, type PoseShape } from '../src/sim/pose';
import { RAPIER, trunkShapes } from '../src/sim/physics';
import { SELF_CLEARANCE_V1 } from '../src/sim/profiles';
import { SEGMENTS } from '../src/sim/ragdoll';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { addScaled, len, qFromUnitVectors, scale, sub, v3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';

const TOL = SELF_CLEARANCE_V1.toleranceM;

function rapierShape(s: PoseShape): { shape: RAPIER.Shape; p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } } {
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), p: s.c, q: { x: 0, y: 0, z: 0, w: 1 } };
  if (s.kind !== 'capsule') throw new Error('unexpected shape');
  const d = sub(s.b, s.a);
  const l = Math.max(len(d), 1e-9);
  return { shape: new RAPIER.Capsule(l / 2, s.r), p: addScaled(s.a, d, 0.5), q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) };
}

/** Deepest penetration (m) of either arm's self shapes, at their full radii, in the player's own measured trunk. */
function selfDepth(def: FixtureDef, pl: PlayerRuntime, side: 'left' | 'right'): number {
  const T = trunkShapes(pl.body);
  if (!T || !pl.pose) return 0;
  const lm = pl.pose.jointLandmarksWorld;
  const core = pl.pose.segments.core;
  let d = 0;
  for (const s of armSelfShapes(def.ragdoll!.radii, pl.body.measured!.handTipM!, side, lm[`${side}Elbow`], lm[`${side}Wrist`], lm[`${side}Palm`])) {
    const q = rapierShape(s);
    for (const t of T) {
      const r = t.contactShape(core.originWorld, core.rotationWorld, q.shape, q.p, q.q, 0.02);
      if (r) d = Math.max(d, -r.distance);
    }
  }
  return d;
}

type Src = 'pose' | 'armTask' | 'ragdoll';
/** Worst own-trunk depth per arm source over a whole run. */
async function worstBySource(def: FixtureDef): Promise<Record<Src, { d: number; at: string }>> {
  const sim = await Simulation.create(def);
  const out: Record<Src, { d: number; at: string }> = { pose: { d: 0, at: '' }, armTask: { d: 0, at: '' }, ragdoll: { d: 0, at: '' } };
  await runSim(sim, Infinity, (s) => {
    for (const pl of s.players)
      for (const side of ['left', 'right'] as const) {
        const src: Src = pl.rag ? 'ragdoll' : s.arms?.obs(pl.id)?.[side]?.enabled ? 'armTask' : 'pose';
        const d = selfDepth(def, pl, side);
        if (d > out[src].d) out[src] = { d, at: `${pl.id}.${side}@${s.t.toFixed(3)}` };
      }
  });
  sim.dispose();
  return out;
}

const without = (def: FixtureDef): FixtureDef => ({ ...def, id: `${def.id}-noSelf`, selfClearance: undefined });

describe('arm self-clearance: profile and geometry', () => {
  it('is on for exactly the L3, L4 and HC fixtures', () => {
    for (const d of allFixtures()) expect(d.selfClearance, d.id).toBe(/^(L3|L4|HC)$/.test(d.milestone) ? SELF_CLEARANCE_V1 : undefined);
  });

  it('the measured trunk is seven convex slabs of the spine and hips skin, inside the padded proxy boxes', () => {
    expect(C.trunkHull.pieces).toHaveLength(7);
    const lo = [Math.min(C.pelvis.center[1] - C.pelvis.halfExtents[1], C.torso.center[1] - C.torso.halfExtents[1])];
    for (const pc of C.trunkHull.pieces) {
      expect(pc.points.length).toBeGreaterThanOrEqual(8);
      for (const [x, y, z] of pc.points) {
        // the boxes are 2-98 percentile bounds (with the clavicles): the hull may pass them by a few cm only
        expect(Math.abs(x)).toBeLessThan(C.torso.halfExtents[0] + 0.03);
        expect(y).toBeGreaterThan(lo[0] - 0.03);
        expect(Math.abs(z - C.torso.center[2])).toBeLessThan(C.torso.halfExtents[2] + 0.06);
      }
    }
    const body = FIX('L3-F16-sprint').players[0].body;
    expect(body.measured?.trunkHull).toHaveLength(7);
    expect(body.measured?.handTipM).toBe(C.glove.tipAlongM);
  });
});

describe('arm self-clearance: evidence', () => {
  it('an opted export records the profile and the trunk; every other export is as before (no trunk, no profile)', async () => {
    const on = await Simulation.create(FIX('L3-F16-sprint'));
    const e = on.exportFixture() as { profileIds: Record<string, unknown>; profiles: { body: Record<string, { measured?: { trunkHull?: unknown[] } }>; selfClearance?: unknown } };
    expect(e.profileIds.selfClearance).toBe(SELF_CLEARANCE_V1.id);
    expect(e.profiles.selfClearance).toEqual(SELF_CLEARANCE_V1);
    for (const b of Object.values(e.profiles.body)) expect(b.measured?.trunkHull).toHaveLength(7);
    on.dispose();
    // L2-F3-runStop uses the model body: its export keeps the measured block without the trunk or hand tip
    const off = await Simulation.create(FIX('L2-F3-runStop'));
    const x = JSON.stringify(off.exportFixture());
    expect(x).toContain('"calibrationId"');
    for (const k of ['trunkHull', 'handTipM', 'selfClearance']) expect(x).not.toContain(k);
    off.dispose();
  });
});

describe('arm self-clearance: supported and arm-task arms stay out of the own trunk', () => {
  // free running, stopping, sprinting and the carry: no other body near the arms
  for (const id of ['L3-F16-sprint', 'L3-F16-runStop', 'L3-F17-runStart', 'L3-F13-carrier', 'L3-F13-free']) {
    it(`${id}: pose arms within the skin tolerance`, async () => {
      const w = await worstBySource(FIX(id));
      expect(w.pose.d, w.pose.at).toBeLessThanOrEqual(TOL + 0.012);
    });
  }

  // tackles: the tackler's arm-task arms (reach, close, hold) never through its own torso
  for (const id of ['L3-F1-low', 'HC-F3-mirror', 'L3-F5-dragMirror']) {
    it(`${id}: arm-task arms within the skin tolerance`, async () => {
      const w = await worstBySource(FIX(id));
      expect(w.armTask.d, w.armTask.at).toBeLessThanOrEqual(TOL + 0.005);
    });
  }

  it('without the profile the same sprint swing crosses the trunk (the historical path is unchanged)', async () => {
    const w = await worstBySource(without(FIX('L3-F16-sprint')));
    expect(w.pose.d).toBeGreaterThan(0.025);
  });
});

describe('arm self-clearance: ragdoll forearms collide with their own trunk', () => {
  for (const id of ['HC-F1-low', 'L3-F3-recover', 'L3-F16-handoff']) {
    it(`${id}: ragdoll forearms stay out of the trunk; without the profile they pass through`, async () => {
      const w = await worstBySource(FIX(id));
      expect(w.ragdoll.d, w.ragdoll.at).toBeLessThanOrEqual(0.025);
      const off = await worstBySource(without(FIX(id)));
      expect(off.ragdoll.d, off.ragdoll.at).toBeGreaterThan(0.05);
    });
  }

  it('the plan 09 impact guard sees a forearm meeting its own trunk (L4-F9-contact)', async () => {
    // R's left forearm hits its own trunk at 1.14 s with a 41 N s impulse; unseen by the guard, the elbow realised 221 W
    // over the 150 W ceiling. The guard now holds that arm (its own trunk is an impact) and the episode stays within it
    const def = FIX('L4-F9-contact');
    let peak = 0;
    const sim = await Simulation.create(def, {
      onSubstep: (s) => {
        const pl = s.players.find((p) => p.id === 'R')!;
        if (pl.rag) for (const j of Object.values(s.selfImpulses(pl.rag))) peak = Math.max(peak, j);
      },
    });
    await runSim(sim, Infinity);
    expect(peak).toBeGreaterThan(def.fallResponse!.impactGuard.impulseNs);
    const r = (sim.exportFixture() as { fallEffort: Record<string, { overPowerSubsteps: number; heldSubsteps: number }> }).fallEffort.R;
    expect(r.overPowerSubsteps).toBe(0);
    sim.dispose();
  });

  it('the self colliders are massless, never in a contact record and never meet another player', async () => {
    const def = FIX('HC-F1-low');
    const on = await Simulation.create(def);
    const off = await Simulation.create(without(def));
    let checked = 0;
    const seen = (s: Simulation) => {
      for (const c of s.contacts) expect(c.a.key.startsWith('self') || c.b.key.startsWith('self')).toBe(false);
    };
    while (!on.done && !off.done) {
      on.stepTick();
      off.stepTick();
      seen(on);
      for (const pl of on.players) {
        if (!pl.rag) continue;
        const twin = off.players.find((p) => p.id === pl.id)!;
        if (!twin.rag) continue;
        for (const id of SEGMENTS) expect(pl.rag.bodies[id].mass(), `${pl.id}.${id}`).toBeCloseTo(twin.rag.bodies[id].mass(), 9);
        checked++;
      }
      if (checked > 20) break;
    }
    expect(checked).toBeGreaterThan(20);
    on.dispose();
    off.dispose();
  });
});
