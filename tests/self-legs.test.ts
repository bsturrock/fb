import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { isSupportedLeg, RAPIER, segmentDistanceSq } from '../src/sim/physics';
import { LEG_GUARD_V3, SELF_LEGS_V1, sideSignX, withoutHipStops, withSelfLegs, withoutSelfLegs, type RagdollProfile } from '../src/sim/profiles';
import { poseOfRb, SEGMENTS, selfLegPair, selfLegPairs, type Ragdoll } from '../src/sim/ragdoll';
import type { Simulation } from '../src/sim/simulation';
import { toWorld, v3, type Vec3 } from '../src/sim/vec';
import { create, FIX as REGISTERED, preOwnLegs, preV3, rows, runSim } from './helpers';
import { INJECTION_J, passiveEnergyMeter } from './passive-energy';
import { loadState, resumeState } from './state';

// Ladder rung 9a: ragdoll own-leg contact (`RagdollProfile.selfLegs`, SELF_LEGS_V1; every L3/L4/HC ragdoll since the
// own-leg flip, ladder 9). Gate 4's
// contact filter drops every same-owner pair but plan 11's forearm pairs, so a fallen player's legs pass through each
// other and its own trunk. With the profile each leg carries massless self shapes (distal thigh, shin, shoe) that meet
// the other leg's and, the shin's and the shoe's, the own trunk; a group of pairs overlapping deeper than the skin at
// the switch stays out of the solve until none of its pairs is.

// (the definitions as before the own-leg flip: each case switches it on itself, its twin runs without it, and the capture
// was taken under rung 8m's registration)
const FIX = (id: string): FixtureDef => preOwnLegs(REGISTERED(id));
const on = (d: FixtureDef): FixtureDef => ({ ...d, ragdoll: withSelfLegs(d.ragdoll!) });
/** The summed contact impulse of a ragdoll's own-leg pairs in the last solve (N s). */
function selfImpulse(sim: Simulation, rag: Ragdoll): number {
  let J = 0;
  for (const p of selfLegPairs(sim.physics, rag)) sim.physics.world.contactPair(p.a.collider, p.b, (m) => {
    for (let i = 0; i < m.numContacts(); i++) J += m.contactImpulse(i);
  });
  return J;
}
/** The nearest own-leg pair's distance (m, negative: overlap), read to 1 m. */
function nearestPair(sim: Simulation, rag: Ragdoll): number {
  let d = 1;
  for (const p of selfLegPairs(sim.physics, rag)) {
    const r = p.a.collider.contactCollider(p.b, 1);
    if (r) d = Math.min(d, r.distance);
  }
  return d;
}
/**
 * How deep one leg is in the other (m), read the same with and without the profile: the distal thigh (from half its
 * length to the knee) and the shin (knee to ankle) of each leg as capsules about the bones at SELF_LEGS_V1's radii, the
 * deepest overlap of a pair on different legs (0 for shapes touching).
 */
function legsDepth(rag: Ragdoll): number {
  const R = rag.profile;
  const tol = SELF_LEGS_V1.toleranceM;
  const bones = (side: 'left' | 'right') => {
    const T = poseOfRb(rag.bodies[`${side}Thigh`]);
    const S = poseOfRb(rag.bodies[`${side}Shin`]);
    return [
      { a: toWorld(T, v3(0, -R.lengths.thigh * SELF_LEGS_V1.thighFromFraction, 0)), b: toWorld(T, v3(0, -R.lengths.thigh, 0)), r: Math.min(R.radii.thigh - tol, SELF_LEGS_V1.thighMaxRadiusM) },
      { a: toWorld(S, v3()), b: toWorld(S, v3(0, -R.lengths.shin, 0)), r: R.radii.shin - tol },
    ];
  };
  let d = 0;
  for (const x of bones('left')) for (const y of bones('right')) d = Math.max(d, x.r + y.r - Math.sqrt(segmentDistanceSq(x.a, x.b, y.a, y.b)));
  return d;
}

/**
 * The zero-gravity rig of L4-F1 (a lone ragdoll switched in standing at 0.02 s, no muscle, no contact; the registered
 * profile's solve, PGS 4), on the authored or the model body, its spherical hips free (no envelope, no hip stops: the
 * hip's range is not what is tested), one hip pulled across the other leg by `nm` N m about the forward axis from
 * 0.05 s, or no load.
 */
function rig(body: 'authored' | 'model', side: 'left' | 'right' | null, nm: number, self: boolean): FixtureDef {
  const h = FIX('L4-F1-hipSwing');
  const m = FIX('L4-F2-model-side-off');
  const free = (r: RagdollProfile): RagdollProfile => {
    const { envelope: _, ...rest } = withoutHipStops(r);
    return { ...rest, id: `${rest.id}-hips-free` };
  };
  const r0 = free(body === 'model' ? m.ragdoll! : h.ragdoll!);
  const p0 = body === 'model' ? { ...h.players[0], body: m.players[0].body } : h.players[0];
  const durationS = 1.2;
  // about the forward axis (Z) toward the body's middle: the leg's side is -X or +X by the body (`sideSignX`)
  const load = (s: 'left' | 'right') => ({ playerId: 'R', joint: `${s}Hip`, fromS: 0.05, toS: durationS, torqueParentNm: v3(0, 0, -sideSignX(p0.body, s) * nm) });
  return {
    ...h,
    id: `self-legs-rig-${body}-${side ?? 'rest'}`,
    durationS,
    players: [p0],
    ragdoll: self ? withSelfLegs(r0) : r0,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.02 }], jointLoads: side ? [load(side)] : [] },
  };
}

/** Over a run, R's legs: the deepest leg-in-leg overlap, the largest own-leg impulse, the nearest pair, the held pairs at the switch. */
async function legRun(def: FixtureDef, each?: (sim: Simulation, rag: Ragdoll) => void) {
  const sim = await create(def);
  const meter = passiveEnergyMeter(sim);
  const o = { depth: 0, J: 0, near: 1, heldAtSwitch: -1 };
  await runSim(sim, Infinity, (s) => {
    const rag = s.players.find((p) => p.id === 'R')!.rag;
    if (!rag?.enabled) return;
    if (o.heldAtSwitch < 0) o.heldAtSwitch = rag.selfLegs?.off.length ?? 0;
    o.depth = Math.max(o.depth, legsDepth(rag));
    if (rag.selfLegs) {
      o.J = Math.max(o.J, selfImpulse(s, rag));
      o.near = Math.min(o.near, nearestPair(s, rag));
    }
    each?.(s, rag);
  });
  meter.restore();
  return { ...o, energy: meter.runs().get('R')! };
}

describe('own-leg contact: profile and shapes', () => {
  it('every L3, L4 and HC ragdoll runs it (the own-leg flip), no other fixture', () => {
    const ragdolls = allFixtures().filter((d) => d.ragdoll);
    for (const d of ragdolls) expect(d.ragdoll!.selfLegs, d.id).toBe(/^(L3|L4|HC)-/.test(d.id) ? SELF_LEGS_V1 : undefined);
    expect(ragdolls.filter((d) => d.ragdoll!.selfLegs).length).toBeGreaterThan(100);
    expect(on(FIX('HC-F1-at0.9'))).toEqual(REGISTERED('HC-F1-at0.9'));
    expect(withoutSelfLegs(withSelfLegs(FIX('HC-F1-at0.9').ragdoll!))).toEqual(FIX('HC-F1-at0.9').ragdoll);
  });

  it('the self shapes leave every segment\'s mass properties bitwise; a massless collider off the body origin (the fault) does not', async () => {
    // the shapes are hulls in their body's frame on colliders at the body origin with zero mass properties; an offset
    // massless collider makes Rapier re-sum the body's properties about another point, which re-rounds them
    const props = (b: InstanceType<typeof RAPIER.RigidBody>): number[] => {
      const c = b.localCom();
      const I = b.principalInertia();
      const f = b.principalInertiaLocalFrame();
      return [b.mass(), c.x, c.y, c.z, I.x, I.y, I.z, f.x, f.y, f.z, f.w];
    };
    const cap = loadState('tests/data/state/HC-F1-at0.9@53.json.gz');
    // (captured before the ladder 10 leg-guard flip: resumed under the leg guard it ran under)
    const base = preV3(FIX('HC-F1-at0.9'));
    const sims = [await resumeState(cap, { def: on(base), variant: ['ragdoll'] }), await resumeState(cap, { def: base })];
    while (!sims.every((s) => s.players.every((p) => p.rag?.enabled))) for (const s of sims) s.stepTick();
    const [a, b] = sims;
    let moved = 0;
    for (const pl of a.players) {
      const twin = b.players.find((p) => p.id === pl.id)!.rag!;
      expect(pl.rag!.selfLegs!.legs.length).toBe(6);
      for (const id of SEGMENTS) {
        expect(props(pl.rag!.bodies[id]), `${pl.id}.${id}`).toEqual(props(twin.bodies[id]));
        // the fault, on the twin: a massless ball 10 cm off the origin
        const before = props(twin.bodies[id]);
        b.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.02).setTranslation(0, -0.1, 0.03).setMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), twin.bodies[id]);
        twin.bodies[id].recomputeMassPropertiesFromColliders();
        if (props(twin.bodies[id]).some((x, i) => !Object.is(x, before[i]))) moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    for (const s of sims) s.dispose();
  });

  it('the self shapes are never in a contact record and touch only their own pairs; let through the filter (the fault) they touch the floor and others', async () => {
    // L3-F9-noProbe-prep under the physical supported legs (V3, which no registered fixture runs yet): two ragdolls and a
    // supported player whose physical legs meet them; the self shapes are in the broad phase with all of it
    const def = { ...on(FIX('L3-F9-noProbe-prep')), legGuard: LEG_GUARD_V3 };
    const read = async (fault: boolean) => {
      const sim = await create(def);
      if (fault) {
        const P = sim.physics as unknown as { hooks: RAPIER.PhysicsHooks };
        const pass = P.hooks.filterContactPair.bind(P.hooks);
        P.hooks.filterContactPair = (h1, h2, b1, b2) => (/^selfLeg:/.test(sim.physics.tags.get(h1)?.key ?? '') || /^selfLeg:/.test(sim.physics.tags.get(h2)?.key ?? '') ? RAPIER.SolverFlags.COMPUTE_IMPULSE : pass(h1, h2, b1, b2));
      }
      const tags = sim.physics.tags;
      const o = { own: 0, other: 0, recorded: 0, legPairs: 0 };
      await runSim(sim, Infinity, (s) => {
        for (const c of s.contacts) if (c.a.key.startsWith('selfLeg') || c.b.key.startsWith('selfLeg')) o.recorded++;
        for (const pl of s.players)
          for (const x of pl.rag?.selfLegs?.legs ?? [])
            s.physics.world.contactPairsWith(x.collider, (c) => {
              const t = tags.get(c.handle) ?? { playerId: null, key: '(untagged)', region: 'floor' as const };
              if (isSupportedLeg(t)) o.legPairs++;
              let n = 0;
              s.physics.world.contactPair(x.collider, c, (m) => (n += m.numContacts()));
              if (n) o[selfLegPair(tags.get(x.collider.handle)!, t) ? 'own' : 'other']++;
            });
      });
      sim.dispose();
      return o;
    };
    const w = await read(false);
    expect(w.own).toBeGreaterThan(0);
    expect(w.legPairs).toBeGreaterThan(0);
    expect(w.other).toBe(0);
    expect(w.recorded).toBe(0);
    const f = await read(true);
    expect(f.other).toBeGreaterThan(0);
  }, 60000);
});

describe('own-leg contact: a leg pulled across the other (constructed)', () => {
  // the zero-gravity rig, one hip pulled across (20 N m); without the profile the leg swings through the other one
  const NM = 20;
  it('the legs stop at each other on both sides and both bodies; without the profile they pass through', async () => {
    await rows(
      (['authored', 'model'] as const).flatMap((body) => (['left', 'right'] as const).map((side) => ({ body, side }))),
      (c) => `${c.body} ${c.side}`,
      async ({ body, side }) => {
        const w = await legRun(rig(body, side, NM, true));
        expect(w.heldAtSwitch).toBe(0);
        expect(w.J).toBeGreaterThan(0.5);
        expect(w.depth).toBeLessThan(0.01);
        expect(w.energy.injecting).toBe(0);
        const off = await legRun(rig(body, side, NM, false));
        expect(off.depth).toBeGreaterThan(0.1);
      },
    );
  }, 240000);
});

describe('own-leg contact: the impact guard', () => {
  it('sees a leg closing on the other (both legs) and its impulse; with the pairs out of the solve it sees neither', async () => {
    // the rig has no floor contact, no other player and no muscle: what the guard reads on the legs is the own legs. Plan
    // 09's guard (`closingSpeeds`, `selfImpulses`) takes own-leg pairs as plan 11's forearm pairs: unseen, a fall
    // response drives a limb into it
    const LEGS = /^(left|right)(Thigh|Shin)$/;
    const legs = (r: Partial<Record<string, number>>): string[] => Object.keys(r).filter((k) => LEGS.test(k) && r[k]! > 0);
    const seen = { closing: new Set<string>(), impulse: new Set<string>(), closingOff: new Set<string>(), trunkHit: new Set<string>(), trunkMismatch: 0, legLegAsTrunk: 0 };
    await legRun(rig('authored', 'left', 20, true), (s, rag) => {
      const dt = s.physics.dt;
      for (const k of legs(s.closingSpeeds(rag, 1.5 * dt, 0.1, 0.002, true, true))) seen.closing.add(k);
      for (const k of legs(s.selfImpulses(rag))) seen.impulse.add(k);
      // the same state with every pair left out
      const S = rag.selfLegs!;
      const off = S.off;
      const pairs = selfLegPairs(s.physics, rag);
      S.off = pairs.map((p) => p.key);
      for (const k of legs(s.closingSpeeds(rag, 1.5 * dt, 0.1, 0.002, true, true))) seen.closingOff.add(k);
      // ladder 9f: the own-trunk closings (`selfTrunk`, what `impactGuard.selfTrunkBody` reads) are a leg's on the trunk
      // only. With only the trunk pairs in, they are the legs' closings; with only the leg-on-leg pairs in, there are none
      S.off = [...off, ...pairs.filter((p) => p.seg).map((p) => p.key)];
      const trunk: Partial<Record<string, number>> = {};
      const c: Partial<Record<string, number>> = s.closingSpeeds(rag, 1.5 * dt, 0.1, 0.002, true, true, trunk);
      for (const k of legs(c)) {
        seen.trunkHit.add(k);
        if (trunk[k] !== c[k]) seen.trunkMismatch++;
      }
      S.off = [...off, ...pairs.filter((p) => !p.seg).map((p) => p.key)];
      const legLeg: Partial<Record<string, number>> = {};
      s.closingSpeeds(rag, 1.5 * dt, 0.1, 0.002, true, true, legLeg);
      seen.legLegAsTrunk += legs(legLeg).length;
      S.off = off;
    });
    expect([...seen.closing].some((k) => k.startsWith('left')) && [...seen.closing].some((k) => k.startsWith('right'))).toBe(true);
    expect([...seen.impulse].some((k) => k.startsWith('left')) && [...seen.impulse].some((k) => k.startsWith('right'))).toBe(true);
    expect([...seen.closingOff]).toEqual([]);
    // the rig's shins also close on the trunk as the legs cross
    expect(seen.trunkHit.size).toBeGreaterThan(0);
    expect(seen.trunkMismatch).toBe(0);
    expect(seen.legLegAsTrunk).toBe(0);
  }, 60000);
});

describe('own-leg contact: the rest pose', () => {
  /**
   * The fault: each thigh's self shape the whole thigh capsule, hip to knee, at the thigh collider's radius (no skin, not
   * distal): the mesh-fit thighs lie against each other from the hips down, so at rest it touches the other thigh.
   */
  const fatThighs = (rag: Ragdoll): void => {
    const E = 2e-4;
    for (const x of rag.selfLegs!.legs.filter((l) => l.region === 'thigh')) {
      const L = rag.profile.lengths.thigh;
      const pts: Vec3[] = [];
      for (const y of [0, -L]) for (const su of [-E, E]) for (const sw of [-E, E]) pts.push(v3(su, y, sw));
      x.collider.setShape(new RAPIER.RoundConvexPolyhedron(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])), undefined, rag.profile.radii.thigh - E));
    }
  };

  /** The most a resting touch carries (N s per solve). */
  const REST_TOUCH_NS = 0.01;

  it('standing (switched in at rest, zero gravity, the first 0.25 s): no pair held or pressing; with fat thighs they press', async () => {
    // after that the legs, free and weightless, drift together from the idle sway they were switched in with
    const rest = (body: 'authored' | 'model'): FixtureDef => ({ ...rig(body, null, 0, true), durationS: 0.27 });
    await rows(['authored', 'model'] as const, (b) => b, async (body) => {
      const w = await legRun(rest(body));
      expect(w.heldAtSwitch).toBe(0);
      // the model's knees at its idle stance are 23 cm apart and its shin shapes 11.4 cm thick: they touch there, at
      // 2 mN s (the authored body's shapes are 11 cm apart)
      expect(w.J).toBeLessThan(body === 'model' ? REST_TOUCH_NS : 1e-9);
      expect(w.near).toBeGreaterThan(body === 'model' ? -0.005 : 0.05);
    });
    // the fault on the model body (the authored thighs are 8.5 cm, apart at rest even whole)
    let fat = false;
    const f = await legRun(rest('model'), (_s, rag) => {
      if (!fat) fatThighs(rag);
      fat = true;
    });
    expect(f.J).toBeGreaterThan(10 * REST_TOUCH_NS);
  }, 120000);

  it('lying straight (on the back, on the side, model body): no pair held or in contact over the last 0.5 s; with fat thighs they touch', async () => {
    await rows(['L4-F2-model-back-off', 'L4-F2-model-side-off'], (id) => id, async (id) => {
      const def = on(FIX(id));
      for (const fault of [false, true]) {
        let J = 0;
        let held = 0;
        let fat = false;
        await legRun(def, (s, rag) => {
          if (fault && !fat) fatThighs(rag);
          fat = true;
          if (s.t < def.durationS - 0.5) return;
          J = Math.max(J, selfImpulse(s, rag));
          held = Math.max(held, rag.selfLegs!.off.length);
        });
        if (fault) expect(J, 'fat thighs').toBeGreaterThan(0);
        else {
          expect(J).toBe(0);
          expect(held).toBe(0);
        }
      }
    });
  }, 120000);
});

describe('own-leg contact: legs switched in crossed (HC-F1-at0.9 from before the switch)', () => {
  // HC-F1-at0.9@53 (before the ladder 10 leg-guard flip: resumed under V1, `preV3`): both players convert at 0.904 s lying on each other. D's supported legs are crossed 12-14 cm deep
  // (the self shapes; its thighs, shins and shoes all), R's 1-2 cm. The capture is under the registered profile; the
  // profile is the twin's variant (`ragdoll`), so the conversion builds the shapes
  const CAP = 'tests/data/state/HC-F1-at0.9@53.json.gz';
  const LEGS = ['leftThigh', 'leftShin', 'rightThigh', 'rightShin'] as const;
  /** 0.1 s after the switch. */
  const TICKS = 6;

  it('no kick: the held groups leave the legs as without the profile; armed at the switch (the fault) they kick D\'s legs apart', async () => {
    const cap = loadState(CAP);
    const base = preV3(FIX('HC-F1-at0.9'));
    const [off, held, fault] = [await resumeState(cap, { def: base }), await resumeState(cap, { def: on(base), variant: ['ragdoll'] }), await resumeState(cap, { def: on(base), variant: ['ragdoll'] })];
    const step = fault.physics.step;
    const armed = new Set<string>();
    fault.physics.step = function (this: typeof fault.physics) {
      for (const pl of fault.players)
        if (pl.rag?.selfLegs && !armed.has(pl.id)) {
          pl.rag.selfLegs.off = [];
          armed.add(pl.id);
        }
      step.call(this);
    };
    const speed = (s: Simulation, pid: string, g: (typeof LEGS)[number]): Vec3 => s.players.find((p) => p.id === pid)!.rag!.bodies[g].linvel();
    const dv = { held: 0, fault: 0 };
    let ticks = 0;
    let groups: string[] = [];
    while (ticks < TICKS) {
      for (const s of [off, held, fault]) s.stepTick();
      const D = held.players.find((p) => p.id === 'D')!.rag;
      if (!D?.enabled) continue;
      if (!ticks) groups = [...D.selfLegs!.off];
      ticks++;
      expect(selfImpulse(held, D)).toBe(0);
      for (const g of LEGS) {
        const v0 = speed(off, 'D', g);
        for (const [k, s] of [['held', held], ['fault', fault]] as const) {
          const v = speed(s, 'D', g);
          dv[k] = Math.max(dv[k], Math.hypot(v.x - v0.x, v.y - v0.y, v.z - v0.z));
        }
      }
    }
    // every pair of the legs against each other is held (9: thigh, shin and shoe against the other leg's)
    expect(groups.length).toBe(9);
    // R's pairs within the skin are in the solve from the switch, and D lies on R
    expect(dv.held).toBeLessThan(0.001);
    expect(dv.fault).toBeGreaterThan(0.3);
    for (const s of [off, held, fault]) s.dispose();
  }, 60000);

  it('a held group takes part once none of its pairs is deeper than the skin, and its contact acts from then', async () => {
    const sim = await resumeState(loadState(CAP), { def: on(preV3(FIX('HC-F1-at0.9'))), variant: ['ragdoll'] });
    const out = new Map<string, { released: number | null; after: number }>();
    await runSim(sim, Infinity, (s) => {
      for (const pl of s.players) {
        const S = pl.rag?.selfLegs;
        if (!S || !pl.rag!.enabled) continue;
        const o = out.get(pl.id) ?? { released: null, after: 0 };
        out.set(pl.id, o);
        if (o.released === null && !S.off.length) {
          o.released = s.t;
          // at release no pair is deeper than the skin
          expect(nearestPair(s, pl.rag!)).toBeGreaterThanOrEqual(-SELF_LEGS_V1.toleranceM);
        }
        if (o.released !== null) o.after = Math.max(o.after, selfImpulse(s, pl.rag!));
      }
    });
    for (const pid of ['D', 'R']) {
      expect(out.get(pid)!.released, pid).not.toBeNull();
      expect(out.get(pid)!.after, pid).toBeGreaterThan(1);
    }
    sim.dispose();
    // the fault: D's held groups never released (its pairs left out as at the switch before every solve)
    const kept = await resumeState(loadState(CAP), { def: on(preV3(FIX('HC-F1-at0.9'))), variant: ['ragdoll'] });
    const step = kept.physics.step;
    let atSwitch: string[] | null = null;
    let J = 0;
    kept.physics.step = function (this: typeof kept.physics) {
      const S = kept.players.find((p) => p.id === 'D')!.rag?.selfLegs;
      if (S) S.off = [...(atSwitch ??= S.off)];
      step.call(this);
    };
    await runSim(kept, Infinity, (s) => {
      const D = s.players.find((p) => p.id === 'D')!.rag;
      if (D?.enabled) J = Math.max(J, selfImpulse(s, D));
    });
    expect(atSwitch!.length).toBe(9);
    expect(J).toBeLessThan(1);
    kept.dispose();
  }, 60000);

  it('energy: no solve of either ragdoll injects to the end; armed at the switch (the fault) R injects', async () => {
    const run = async (fault: boolean) => {
      const sim = await resumeState(loadState(CAP), { def: on(preV3(FIX('HC-F1-at0.9'))), variant: ['ragdoll'] });
      if (fault) {
        const step = sim.physics.step;
        const armed = new Set<string>();
        sim.physics.step = function (this: typeof sim.physics) {
          for (const pl of sim.players)
            if (pl.rag?.selfLegs && !armed.has(pl.id)) {
              pl.rag.selfLegs.off = [];
              armed.add(pl.id);
            }
          step.call(this);
        };
      }
      const meter = passiveEnergyMeter(sim);
      await runSim(sim);
      meter.restore();
      const r = meter.runs();
      sim.dispose();
      return r;
    };
    const held = await run(false);
    for (const pid of ['D', 'R']) expect(held.get(pid)!.injecting, pid).toBe(0);
    const fault = await run(true);
    expect(fault.get('R')!.maxJ).toBeGreaterThan(INJECTION_J);
  }, 60000);
});
