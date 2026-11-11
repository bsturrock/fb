// Ladder rung 6 (docs/open/contact-motion/prerequisites-ladder.md): physical supported legs, `LegGuardProfile.physicalLegs`
// (LEG_GUARD_V3 = LEG_GUARD_V2 with it; no fixture runs it in this rung, so every case here sets it). A supported proxy's
// six pose leg shapes become massless colliders on its own body (PhysicsWorld.addLegCollider), placed from the achieved
// pose after each solve (syncPhysicalLegs), live only while the proxy stands on static ground (physicalLegsLive), off at
// the conversion request and removed with the proxy; the pose guard keeps the posed legs clear of the bodies they meet,
// also where such a body would stop (D1). The leg ledger (Simulation.legLedger) is observation only.
//
// Each case has a fault twin: the same state or construct with the mechanism removed, which the assertion must fail.
// Bounds are the rules' constants (PHYS_LEG_OK, HARD_OK, the conversion tolerance) or derived from the construct.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import type { FixtureDef } from '../src/sim/fixture';
import { CONT_LEG_MPS, HARD_OK, PHYS_LEG_OK, poseLimbShapes, type PhysicalPose, type PoseShape } from '../src/sim/pose';
import { initPhysics, isSupportedLeg, PhysicsWorld, RAPIER } from '../src/sim/physics';
import { legHull, legMeets, legPointMove, legSurfaceAdvance, observePhysicalLegs, physicalLegsLive, syncPhysicalLegs, type LegLedger, type LegPlace, type PhysicalLegs } from '../src/sim/pose-runtime';
import { LEG_GUARD_V2, LEG_GUARD_V3 } from '../src/sim/profiles';
import { Simulation, type PlayerRuntime, type SimOptions } from '../src/sim/simulation';
import { add, cross, dot, len, norm, qConj, qFromUnitVectors, qFromYaw, qInvRot, qMul, qRot, scale, sub, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { FIX, rows } from './helpers';
import { SEGMENTS } from '../src/sim/ragdoll';

type Check = [string, () => void | Promise<void>];
const checks = (cs: Check[]): Promise<void> => rows(cs, ([n]) => n, ([, f]) => f());
const vecOf = (v: { x: number; y: number; z: number }): Vec3 => v3(v.x, v.y, v.z);
const V3 = (d: FixtureDef, over: Partial<FixtureDef> = {}): FixtureDef => ({ ...d, id: `${d.id}-v3`, legGuard: LEG_GUARD_V3, ...over });
const player = (sim: Simulation, id: string): PlayerRuntime => sim.players.find((p) => p.id === id)!;
/** Step whole ticks until `until` holds after one (or the run ends); false if it never did. */
function stepUntil(sim: Simulation, until: () => boolean): boolean {
  while (!sim.done) {
    sim.stepTick();
    if (until()) return true;
  }
  return false;
}

describe('rung 6: the profile', () => {
  it('LEG_GUARD_V3 is LEG_GUARD_V2 with physical legs, and no fixture runs it; a fixture under it makes six leg colliders per supported player, under V2 none', async () => {
    expect({ ...LEG_GUARD_V3, id: LEG_GUARD_V2.id, physicalLegs: undefined }).toEqual({ ...LEG_GUARD_V2, physicalLegs: undefined });
    expect(LEG_GUARD_V3.physicalLegs).toBe(true);
    expect(allFixtures().filter((f) => f.legGuard?.physicalLegs).map((f) => f.id)).toEqual([]);
    const legColliders = async (d: FixtureDef): Promise<number> => {
      const sim = await Simulation.create({ ...d, durationS: 0.1 }, { trace: false });
      stepUntil(sim, () => false);
      let n = 0;
      sim.physics.world.forEachCollider((c) => {
        const t = sim.physics.tags.get(c.handle);
        if (t && isSupportedLeg(t)) n++;
      });
      sim.dispose();
      return n;
    };
    const base = FIX('L3-F9-convert-free');
    expect(await legColliders(V3(base))).toBe(6 * base.players.length);
    // the twin: the fixture's own profile (V2 here) builds none
    expect(await legColliders({ ...base, legGuard: LEG_GUARD_V2 })).toBe(0);
  }, 60000);
});

// ------------------------------------------------------------------ requirement 1: the impulse acts once
// A constructed world without gravity or damping: one proxy (the L3 body) with one physical thigh 1 m out from its axis
// (clear of its trunk and support), struck head-on by a 5 kg ball. The momentum the proxy gains is minus the leg's
// summed contact impulse, the ball's plus it: the solver applies the leg's contact to the proxy once, equal and
// opposite (the ball frictionless, so the contact impulse is the normal impulse the manifold reports). The twins: the same leg on a separate kinematic body following the proxy (the impulse never reaches the
// proxy), and the leg's contact impulse forwarded to the proxy once more after the solve (what a consumer turning
// contact records into a force on the body would add; no code does, which this case cannot see: the trace in the report).
describe('rung 6 (1): a physical leg contact acts on the proxy exactly once', () => {
  const def = FIX('L3-F9-convert-free');
  const at = { p: v3(0, 5, 0), q: qFromYaw(0) };
  const thigh: PoseShape = { kind: 'capsule', key: 'leftThigh', a: v3(1, 4.9, 0), b: v3(1, 4.45, 0), r: def.ragdoll!.radii.thigh };
  const massOf = (b: RAPIER.RigidBody) => ({ m: b.mass(), i: vecOf(b.principalInertia()), f: { ...b.principalInertiaLocalFrame() } });
  // the thigh's placement on the body (body frame, along local Y: the segment points down)
  const place: LegPlace = { p: v3(1, -0.325, 0), q: { x: 1, y: 0, z: 0, w: 0 }, h: 0.225 };

  function strike(variant: 'leg' | 'separate' | 'forwarded' | 'massive') {
    const P = new PhysicsWorld({ ...def.solver, gravityY: 0, linearDamping: 0, angularDamping: 0 });
    const proxy = P.createProxy('D', def.players[0].body, def.stance, at);
    const b = proxy.body;
    P.step();
    const m0 = massOf(b);
    const host = variant === 'separate' ? P.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.p.x, at.p.y, at.p.z)) : b;
    const hull = legHull(thigh, at.p, at.q);
    const leg =
      variant === 'massive'
        ? P.world.createCollider(RAPIER.ColliderDesc.roundConvexHull(hull.points, hull.r)!, b)
        : P.addLegCollider(host, 'D', 'leftThigh', 'thigh', hull, 'leftThigh');
    const ballBody = P.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 4.7, 0.4).setLinvel(0, 0, -3));
    // frictionless (the Min rule), so the leg's contact impulse is its normal impulse alone, which the manifold reports
    P.world.createCollider(RAPIER.ColliderDesc.ball(0.1).setMass(5).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), ballBody);
    P.step();
    const m1 = massOf(b);
    const pB0 = scale(vecOf(b.linvel()), b.mass());
    const pBall0 = scale(vecOf(ballBody.linvel()), ballBody.mass());
    // the ledger's own reading of the same solves: the leg as placed (no animated move), and as if the pose had just
    // advanced it 1 mm toward the ball (+z) before the solve
    const legsOf = (prev: LegPlace): PhysicalLegs => ({ colliders: [leg], keys: ['leftThigh'], prev: [prev], now: [place], enabled: true, on: [true] });
    const hosts = [legsOf(place), legsOf({ ...place, p: add(place.p, v3(0, 0, -0.001)) })].map((legs) => ({ physics: P, players: [{ id: 'D', legs, proxy } as unknown as PlayerRuntime], t: 0, legLedger: new Map<string, LegLedger>() }));
    let J = v3();
    for (let k = 0; k < 60; k++) {
      P.step();
      let Jk = v3();
      P.world.contactPair(leg, ballBody.collider(0), (m, flipped) => {
        // the normal from the leg to the ball: the ball's impulse, minus the leg's body's
        const n = flipped ? scale(vecOf(m.normal()), -1) : vecOf(m.normal());
        for (let i = 0; i < m.numContacts(); i++) Jk = add(Jk, scale(n, m.contactImpulse(i)));
      });
      J = add(J, Jk);
      if (variant === 'forwarded') b.applyImpulse(scale(Jk, -1), true);
      if (variant !== 'separate') for (const h of hosts) observePhysicalLegs(h);
    }
    const out = {
      J,
      dProxy: sub(scale(vecOf(b.linvel()), b.mass()), pB0),
      dBall: sub(scale(vecOf(ballBody.linvel()), ballBody.mass()), pBall0),
      massKept: JSON.stringify(m1) === JSON.stringify(m0),
      ledger: hosts.map((h) => h.legLedger.get('D')),
    };
    P.dispose();
    return out;
  }

  it('the proxy gains minus the leg contact impulse and the ball plus it; on a separate body the proxy gains nothing, forwarded again it gains twice', async () => {
    await initPhysics();
    const on = strike('leg');
    const Jn = len(on.J);
    // a strike: 5 kg at 3 m/s on the 1 m lever of a proxy free to yaw, about 4.5 N s with the solver's restitution
    expect(Jn).toBeGreaterThan(1);
    const rel = (a: Vec3, b: Vec3): number => len(sub(a, b)) / Jn;
    await checks([
      [
        'exactly once: the proxy gains -J, the ball +J (f32 solver, 0.1 %)',
        () => {
          expect(rel(on.dProxy, scale(on.J, -1))).toBeLessThan(1e-3);
          expect(rel(on.dBall, on.J)).toBeLessThan(1e-3);
        },
      ],
      [
        'the twin with the leg on a separate body: the ball is struck, the proxy gains nothing',
        () => {
          const off = strike('separate');
          expect(len(off.J)).toBeGreaterThan(1);
          expect(len(off.dProxy)).toBeLessThan(1e-3 * len(off.J));
          expect(rel(off.dProxy, scale(off.J, -1))).toBeGreaterThan(0.5);
        },
      ],
      [
        'the twin with the impulse forwarded once more: the proxy gains -2J, which the exactly-once check fails',
        () => {
          const off = strike('forwarded');
          expect(len(sub(off.dProxy, scale(off.J, -2))) / len(off.J)).toBeLessThan(1e-3);
          expect(len(sub(off.dProxy, scale(off.J, -1))) / len(off.J)).toBeGreaterThan(0.5);
        },
      ],
      [
        "the leg adds nothing to the body's mass properties (bitwise); the twin, the same hull with a collider's default density, does",
        () => {
          expect(on.massKept).toBe(true);
          expect(strike('massive').massKept).toBe(false);
        },
      ],
      [
        "the ledger: the summed normal impulse is the ball's momentum change; injected work is impulse times the leg's advance (1 mm), none without one",
        () => {
          const [still, moved] = on.ledger;
          expect(Math.abs(still!.impulseNs - len(on.dBall)) / Jn).toBeLessThan(1e-3);
          expect(moved!.impulseNs).toBe(still!.impulseNs);
          expect(still!.injectedJ).toBe(0);
          expect(Math.abs(moved!.injectedJ - 0.001 * moved!.impulseNs)).toBeLessThan(1e-6 * moved!.impulseNs);
          expect(moved!.substeps).toBeGreaterThan(0);
        },
      ],
    ]);
  });
});

// ------------------------------------------------------------------ requirement 5: the collision filter
// What a physical leg of D meets in the solve, pair by pair against every collider of the world, through the solver's
// own three layers (collision groups both ways, the simulation's contact hook, one body never meeting itself), is
// legMeets (the pose guard's statement of it): another player's ragdoll segment colliders and nothing else; never another
// player's proxy (its torso, pelvis, head, support capsule or guard: supported against supported stays the proxy
// collision's and the pose guards'), self clearance shapes, physical legs, the floor or D's own. Read on
// L3-F9-convert-free (suspension support, ragdoll, self clearance) at 0.10 s (R supported, its legs physical) and 0.30 s
// (R a ragdoll), and on L4-F2-forward-on (legacy support). The hook alone is legMeets; the twin, groups alone, admits R's
// supported proxy (torso, pelvis, head, support capsule) and the legacy floor.
describe('rung 6 (5): the physical leg collision filter', () => {
  /** Per collider of the world, whether a leg of `owner` meets it through each layer, against legMeets, at each stop. */
  async function filterTable(id: string, owner: string, stops: ((sim: Simulation) => boolean)[]) {
    const sim = await Simulation.create(V3(FIX(id)), { trace: false });
    const P = sim.physics;
    const hook = (P as unknown as { hooks: RAPIER.PhysicsHooks }).hooks;
    const groups = (a: RAPIER.Collider, b: RAPIER.Collider): boolean => {
      const ga = a.collisionGroups();
      const gb = b.collisionGroups();
      return ((ga >>> 16) & gb & 0xffff) !== 0 && ((gb >>> 16) & ga & 0xffff) !== 0;
    };
    const hooked = (a: RAPIER.Collider, b: RAPIER.Collider): boolean => hook.filterContactPair(a.handle, b.handle, a.parent()!.handle, b.parent()!.handle) !== null;
    const sameBody = (a: RAPIER.Collider, b: RAPIER.Collider): boolean => a.parent()!.handle === b.parent()!.handle;
    const O = player(sim, owner);
    const kinds = new Set<string>();
    const wrong = { solver: [] as string[], groupsOnly: [] as string[], hookOnly: [] as string[] };
    const met = new Set<string>();
    for (const stop of stops) {
      expect(stepUntil(sim, () => stop(sim)), `${id} stop`).toBe(true);
      expect(O.legs?.enabled, `${id} ${owner} legs at ${sim.t}`).toBe(true);
      for (const c of O.legs!.colliders)
        P.world.forEachCollider((k) => {
          if (k.handle === c.handle) return;
          const t = P.tags.get(k.handle);
          const want = legMeets(t, owner);
          const name = `${t?.playerId}:${t?.key}`;
          kinds.add(t?.playerId === null ? 'floor' : t?.playerId === owner ? 'own' : t && isSupportedLeg(t) ? 'leg' : (t?.key ?? '?').replace(/:.*/, ''));
          if (want) met.add(name);
          if ((groups(c, k) && hooked(c, k) && !sameBody(c, k)) !== want) wrong.solver.push(name);
          if ((groups(c, k) && !sameBody(c, k)) !== want) wrong.groupsOnly.push(name);
          if ((hooked(c, k) && !sameBody(c, k)) !== want) wrong.hookOnly.push(name);
        });
    }
    const suspension = !!sim.suspension;
    sim.dispose();
    return { kinds, wrong, suspension, met: [...met] };
  }

  it("every pair a leg can form is legMeets, another player's ragdoll segments only; the hook alone is legMeets, groups alone admit a supported proxy (and the legacy floor)", async () => {
    // L3-F9-convert-free (suspension support, ragdoll, self clearance): D at 0.10 s (R supported, its legs physical) and
    // 0.30 s (R a ragdoll)
    const L3 = await filterTable('L3-F9-convert-free', 'D', [(s) => s.t >= 0.1 - 1e-9 && !!player(s, 'R').legs?.enabled, (s) => s.t >= 0.3 - 1e-9 && !!player(s, 'R').rag]);
    // L4-F2-forward-on (legacy support, R alone): R's first physical substep
    const L4 = await filterTable('L4-F2-forward-on', 'R', [(s) => !!player(s, 'R').legs?.enabled]);
    expect([L3.suspension, L4.suspension]).toEqual([true, false]);
    // every kind of collider was paired: the floor, D's own, R's proxy parts and physical legs (0.10 s), R's ragdoll
    // segments (core, limbs, head) and self-clearance shapes (0.30 s)
    for (const k of ['floor', 'own', 'leg', 'support', 'torso', 'pelvis', 'head', 'core', 'leftThigh', 'selfTrunk', 'selfArm']) expect([...L3.kinds].some((x) => x.startsWith(k)), k).toBe(true);
    // legMeets: R's ragdoll segments, none of R's proxy parts
    expect(L3.met.some((n) => /^R:core:/.test(n)) && L3.met.some((n) => /^R:(left|right)Thigh:/.test(n)), "R's ragdoll segments").toBe(true);
    expect(L3.met.filter((n) => { const [pid, seg, region, more] = n.split(':'); return !(pid === 'R' && (SEGMENTS as string[]).includes(seg) && !!region && more === undefined); })).toEqual([]);
    expect(L4.met).toEqual([]);
    expect(L3.wrong.solver).toEqual([]);
    expect(L4.wrong.solver).toEqual([]);
    // the hook alone states it; the twin, collision groups alone, admits R's supported proxy
    expect(L3.wrong.hookOnly).toEqual([]);
    for (const k of ['R:support', 'R:torso', 'R:pelvis', 'R:head']) expect(L3.wrong.groupsOnly, `groups alone admit ${k}`).toContain(k);
    // under the suspension the floor is static (GROUP_STATIC) and both layers keep it out; under legacy support only the hook
    expect(L3.wrong.groupsOnly.some((n) => n.startsWith('null:'))).toBe(false);
    expect(L4.wrong.groupsOnly.some((n) => n === 'null:floor'), 'groups alone admit the legacy floor').toBe(true);
  }, 60000);

  it('in the solve: D\'s stance shoes touch the floor with no impulse, and every leg impulse is on a collider legMeets admits', async () => {
    const sim = await Simulation.create(V3(FIX('L3-F9-convert-free')), {
      trace: false,
      onSubstep: (s) => {
        const L = player(s, 'D').legs;
        if (!L?.enabled) return;
        L.colliders.forEach((c, i) => {
          if (!c.isEnabled()) return;
          const f = s.physics.floorCollider;
          if (L.keys[i].endsWith('Shoe') && (c.shape.contactShape(c.translation(), c.rotation(), f.shape, f.translation(), f.rotation(), 0.001)?.distance ?? 1) <= 0.001) touching++;
          s.physics.world.contactPairsWith(c, (o) =>
            s.physics.world.contactPair(c, o, (m) => {
              for (let k = 0; k < m.numContacts(); k++) {
                const ji = m.contactImpulse(k);
                if (ji <= 0) continue;
                const t = s.physics.tags.get(o.handle);
                if (legMeets(t, 'D')) met += ji;
                else stray.push(`${t?.playerId}:${t?.key} ${ji}`);
              }
            }),
          );
        });
      },
    });
    let touching = 0;
    let met = 0;
    const stray: string[] = [];
    stepUntil(sim, () => false);
    sim.dispose();
    expect(touching, 'substeps a stance shoe touches the floor').toBeGreaterThan(20);
    expect(met, "R's ragdoll on D's legs (N s)").toBeGreaterThan(1);
    expect(stray).toEqual([]);
  }, 60000);
});

// ------------------------------------------------------------------ requirement 7 (D2): live only on static ground
// physicalLegsLive: a supported proxy of the profile, no handoff, and standing on static ground; players are never
// ground. Under the suspension the support probe says where: HC-F2-lift1.4 A, held up by B, reads B below it
// (`obstructed`) and ground beyond travel (`beyondTravel`, lifted), and `ok` when down; under legacy support (no probe:
// no suspension is not eligibility) the support capsule's floor contact (`grounded`): L4-F2-forward-on R grounded,
// L4-F1-knee R not. Its legs are physical exactly in the ground substeps. The twin is the eligibility without D2 (a
// supported proxy, no handoff), which holds the legs live in every one of those substeps.
describe('rung 6 (D2): physical legs only on static ground', () => {
  it('real states: physical on ground within travel or on the legacy floor, never over a player, lifted or ungrounded; the eligibility without D2 is live in all', async () => {
    const CASES: [string, string][] = [
      ['HC-F2-lift1.4', 'A'],
      ['L4-F2-forward-on', 'R'],
      ['L4-F1-knee', 'R'],
    ];
    const seen: Record<string, { n: number; live: number }> = {};
    let preD2 = 0;
    let n = 0;
    for (const [id, pid] of CASES) {
      const sim = await Simulation.create(V3(FIX(id)), {
        trace: false,
        onSubstep: (s) => {
          const p = player(s, pid);
          if (p.rag || p.handoff || p.controlMode !== 'supported') return;
          const k = `${p.sus ? p.sus.probe.status : p.grounded ? 'legacy grounded' : 'legacy ungrounded'}`;
          const x = (seen[k] ??= { n: 0, live: 0 });
          x.n++;
          n++;
          if (p.legs?.enabled) x.live++;
          preD2++;
        },
      });
      stepUntil(sim, () => false);
      sim.dispose();
    }
    expect(Object.keys(seen).sort()).toEqual(['beyondTravel', 'legacy grounded', 'legacy ungrounded', 'obstructed', 'ok']);
    for (const k of ['ok', 'legacy grounded']) expect(seen[k].live, k).toBe(seen[k].n);
    for (const k of ['obstructed', 'beyondTravel', 'legacy ungrounded']) {
      expect(seen[k].n, k).toBeGreaterThan(4);
      expect(seen[k].live, k).toBe(0);
    }
    // the twin: every one of them is a supported proxy without a handoff
    expect(preD2).toBe(n);
  }, 120000);

  it('the suspension rule on one real state, its probe replaced: a refused surface or normal within travel is live, nothing below or a reading past travel is not; off at once, on again the next tick', async () => {
    const sim = await Simulation.create(V3(FIX('L3-F9-convert-free')), { trace: false });
    expect(stepUntil(sim, () => sim.t >= 0.1 - 1e-9)).toBe(true);
    const D = player(sim, 'D');
    const S = sim.suspension!;
    expect(D.sus!.probe.status).toBe('ok');
    expect(physicalLegsLive(sim, D)).toBe(true);
    const probe = (status: string, heightM = D.sus!.probe.heightM) => ({ ...D, sus: { ...D.sus!, probe: { ...D.sus!.probe, status, heightM } } }) as unknown as PlayerRuntime;
    const CASES: [string, PlayerRuntime, boolean][] = [
      ['a refused surface within travel', probe('invalidSurface'), true],
      ['a refused normal within travel', probe('invalidNormal'), true],
      ['a player below (obstructed)', probe('obstructed'), false],
      ['nothing below (none, airborne)', probe('none', Number.NaN), false],
      ['ground beyond travel', probe('beyondTravel', S.probeMaxM + 0.1), false],
      ['ok read past the travel', probe('ok', S.probeMaxM + 0.01), false],
    ];
    const preD2 = (pl: PlayerRuntime): boolean => !pl.rag && !pl.handoff && pl.controlMode === 'supported';
    for (const [name, pl, live] of CASES) {
      expect(physicalLegsLive(sim, pl), name).toBe(live);
      expect(preD2(pl), `the twin, ${name}`).toBe(true);
    }
    // syncing a state over a player turns the colliders off at once; the next tick (on ground) turns them on again
    syncPhysicalLegs(sim, probe('obstructed'));
    expect(D.legs!.enabled).toBe(false);
    expect(D.legs!.colliders.every((c) => !c.isEnabled())).toBe(true);
    sim.stepTick();
    expect(D.legs!.enabled).toBe(true);
    expect(D.legs!.colliders.some((c) => c.isEnabled())).toBe(true);
    sim.dispose();
  }, 60000);
});

// ------------------------------------------------------------------ requirement 4: ownership at conversion
// L3-F9-convert-free R (converted by label at 0.20 s): at the conversion request its legs leave the solve, and after the
// switch no collider or tag of them is left. The no-stray check (every physical leg collider in the world, and every
// such tag, belongs to a live player's legs) and the ownership check (R has none) are read on the substep before the
// request too, as their twin: there they find R's six enabled colliders.
describe('rung 6 (4): ownership at conversion', () => {
  it('R\'s legs are off at its conversion request and gone after the switch; one substep before, the same checks find all six on', async () => {
    const states: { t: number; mode: string; rag: boolean; legs?: PhysicalLegs; onR: number; inWorldR: number; tagsR: number; stray: string[] }[] = [];
    const sim = await Simulation.create(V3(FIX('L3-F9-convert-free')), {
      trace: false,
      onSubstep: (s) => {
        const R = player(s, 'R');
        if (s.t > 0.3) return;
        let inWorldR = 0;
        const stray: string[] = [];
        const live = new Set(s.players.flatMap((p) => (p.legs ? p.legs.colliders.map((c) => c.handle) : [])));
        s.physics.world.forEachCollider((c) => {
          const t = s.physics.tags.get(c.handle);
          if (!t || !isSupportedLeg(t)) return;
          if (t.playerId === 'R') inWorldR++;
          if (!live.has(c.handle)) stray.push(`${t.playerId}:${t.key}`);
        });
        let tagsR = 0;
        for (const [h, t] of s.physics.tags) {
          if (!isSupportedLeg(t)) continue;
          if (t.playerId === 'R') tagsR++;
          if (!live.has(h)) stray.push(`tag ${t.playerId}:${t.key}`);
        }
        states.push({ t: s.t, mode: R.controlMode, rag: !!R.rag, legs: R.legs, onR: R.legs ? R.legs.colliders.filter((c) => c.isEnabled()).length : 0, inWorldR, tagsR, stray });
      },
    });
    stepUntil(sim, () => sim.t > 0.3);
    const accepted = player(sim, 'R').handoff?.outcome;
    sim.dispose();
    const req = states.findIndex((x) => x.mode !== 'supported');
    const sw = states.findIndex((x) => x.rag);
    expect(accepted).toBe('accepted');
    expect(req).toBeGreaterThan(0);
    expect(sw).toBeGreaterThanOrEqual(req);
    await checks([
      [
        'the twin: one substep before the request the checks find R\'s six leg colliders, on, in the world and tagged',
        () => {
          const b = states[req - 1];
          expect([b.onR, b.inWorldR, b.tagsR]).toEqual([6, 6, 6]);
          expect(b.stray).toEqual([]);
        },
      ],
      [
        'from the request to the switch: R\'s legs out of the solve',
        () => {
          for (const x of states.slice(req, sw)) {
            expect(x.onR, `${x.t}`).toBe(0);
            expect(x.legs?.enabled, `${x.t}`).toBe(false);
          }
        },
      ],
      [
        'after the switch: R owns no leg collider, none is in the world or tagged, and no physical leg is stray',
        () => {
          for (const x of states.slice(sw)) {
            expect(x.legs, `${x.t}`).toBeUndefined();
            expect([x.inWorldR, x.tagsR], `${x.t}`).toEqual([0, 0]);
            expect(x.stray, `${x.t}`).toEqual([]);
          }
        },
      ],
    ]);
  }, 60000);
});

// ------------------------------------------------------------------ rung 6b: a conversion mid-contact
// A physical leg meets ragdoll segments only (legMeets), so it can stand inside a supported proxy (the pose guard bounds
// that, within HARD_OK of its torso / pelvis / head), and the ragdoll that proxy converts into stands where its pose
// stood. Constructed on L3-F9-convert-prep under V3 (R converted by label at 0.45 s, the players closing): at the end of
// the substep before the conversion, D's leg nearest to R's posed limbs (closing on it at about 1.9 m/s) is placed DEPTH
// into it (its hull moved along the contact normal; D's pose and body untouched). The conversion is accepted (the candidate clears D's leg
// within its tolerance) and legsOffInsideConverted takes that leg out of the solve: no solve starts with a leg of D's on
// inside R's ragdoll, and the leg comes on again once clear (syncPhysicalLegs, from D's own pose). The twin turns the
// leg on again before the first solve after the switch: that solve starts DEPTH deep and resolves it (the leg ledger
// reads a loaded depth near DEPTH; measured 8.1 mm, 39.7 N s in that one solve).
describe('rung 6b: a conversion with a physical leg inside the new ragdoll', () => {
  const AT = 0.45;
  const DEPTH = 0.008;
  const rapShape = (s: PoseShape): { shape: RAPIER.Shape; p: Vec3; q: Quat } => {
    if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), p: s.c, q: { x: 0, y: 0, z: 0, w: 1 } };
    if (s.kind === 'box') return { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), p: s.c, q: s.q };
    const ab = sub(s.b, s.a);
    const l = len(ab);
    return { shape: new RAPIER.Capsule(l / 2, s.r), p: add(s.a, scale(ab, 0.5)), q: qFromUnitVectors(v3(0, 1, 0), scale(ab, 1 / l)) };
  };
  const moved = (s: PoseShape, d: Vec3): PoseShape => (s.kind === 'capsule' ? { ...s, a: add(s.a, d), b: add(s.b, d) } : { ...s, c: add(s.c, d) });
  interface Solve {
    t: number;
    fresh: boolean;
    on: boolean;
    depth: number;
  }
  async function run(twin: boolean): Promise<{ placed: { leg: string; other: string; closing: number } | null; atSwitch: number; solves: Solve[]; outcome?: string; ledger?: LegLedger }> {
    const d = V3(FIX('L3-F9-convert-prep'), { durationS: AT + 0.1 });
    let placed: { leg: string; other: string; i: number; closing: number } | null = null;
    const sim = await Simulation.create(d, {
      trace: false,
      onSubstep: (s) => {
        const D = player(s, 'D');
        const R = player(s, 'R');
        if (placed || R.rag || s.t < AT - 1e-9 || !D.legs?.enabled || !R.pose) return;
        // the conversion runs at the start of the next substep
        const b = D.proxy.body;
        const bp = vecOf(b.translation());
        const bq = { ...b.rotation() };
        const mine = poseLimbShapes(s.def.ragdoll!, D.pose!);
        const theirs = poseLimbShapes(s.def.ragdoll!, R.pose);
        let best: { i: number; x: PoseShape; o: PoseShape; dist: number; n: Vec3; closing: number } | null = null;
        D.legs.keys.forEach((k, i) => {
          if (!D.legs!.on[i]) return;
          const x = mine.find((m) => m.key === k)!;
          const a = rapShape(x);
          for (const o of theirs) {
            const c = rapShape(o);
            const r = a.shape.contactShape(a.p, a.q, c.shape, c.p, c.q, 2);
            if (r && (!best || r.distance < best.dist)) best = { i, x, o, dist: r.distance, n: vecOf(r.normal1), closing: dot(sub(vecOf(b.velocityAtPoint(r.point1)), vecOf(R.proxy.body.velocityAtPoint(r.point2))), vecOf(r.normal1)) };
          }
        });
        if (!best) return;
        const B = best as { i: number; x: PoseShape; o: PoseShape; dist: number; n: Vec3; closing: number };
        s.physics.reshapeLeg(D.legs.colliders[B.i], legHull(moved(B.x, scale(B.n, B.dist + DEPTH)), bp, bq));
        placed = { leg: B.x.key, other: B.o.key, i: B.i, closing: B.closing };
      },
    });
    const solves: Solve[] = [];
    let atSwitch = -1;
    const step0 = sim.physics.step.bind(sim.physics);
    sim.physics.step = () => {
      const D = player(sim, 'D');
      const R = player(sim, 'R');
      if (placed && R.rag && D.legs) {
        const fresh = atSwitch < 0;
        if (fresh) atSwitch = solves.length;
        const c = D.legs.colliders[placed.i];
        if (fresh && twin && !D.legs.on[placed.i]) {
          c.setEnabled(true);
          D.legs.on[placed.i] = true;
        }
        const on = D.legs.enabled && D.legs.on[placed.i] && c.isEnabled();
        let depth = 0;
        for (const k of R.rag.colliders) {
          const r = c.shape.contactShape(D.proxy.body.translation(), D.proxy.body.rotation(), k.collider.shape, k.collider.translation(), k.collider.rotation(), 0);
          if (r) depth = Math.max(depth, -r.distance);
        }
        solves.push({ t: sim.t, fresh, on, depth });
      }
      step0();
    };
    stepUntil(sim, () => false);
    const P = placed as { leg: string; other: string; closing: number } | null;
    const out = { placed: P ? { leg: P.leg, other: P.other, closing: P.closing } : null, atSwitch, solves, outcome: player(sim, 'R').handoff?.outcome, ledger: sim.legLedger?.get('D') };
    sim.dispose();
    return out;
  }

  it("a leg of D's inside R's new ragdoll leaves the solve at the switch and comes on again once clear; the twin's first solve starts in it", async () => {
    const on = await run(false);
    const tw = await run(true);
    for (const x of [on, tw]) {
      expect(x.placed).not.toBeNull();
      // the construct: D's leg closes on R's limb (an overlap there loads the solve)
      expect(x.placed!.closing).toBeGreaterThan(0.5);
      expect(x.outcome).toBe('accepted');
      expect(x.atSwitch).toBe(0);
      // the construct: the leg is in R's ragdoll at the first solve after the switch, near DEPTH
      expect(x.solves[0].depth).toBeGreaterThan(DEPTH / 2);
      expect(x.solves[0].depth).toBeLessThan(2 * DEPTH);
    }
    await checks([
      ['the leg is off at the first solve after the switch', () => expect(on.solves[0].on).toBe(false)],
      ['the leg comes on again within a tick, clear of R\'s ragdoll (within PHYS_LEG_ON_M; what it meets later is ordinary contact)', () => {
        const k = on.solves.findIndex((x) => x.on);
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThanOrEqual(4);
        expect(on.solves[k].depth).toBeLessThanOrEqual(0.001);
      }],
      ['the twin: its first solve starts with the leg on, DEPTH deep, and the ledger reads a loaded depth there', () => {
        expect(tw.solves[0].on).toBe(true);
        expect(tw.ledger!.maxLoadedDepthM).toBeGreaterThan(DEPTH / 2);
        expect(tw.ledger!.maxLoadedDepthM).toBeGreaterThan(2 * on.ledger!.maxLoadedDepthM);
      }],
    ]);
  }, 120000);
});

// ------------------------------------------------------------------ requirement 6 (D1): a leg yields where a body stops
// L3-F9-convert-free with R converted by label at 0.15 s; at 0.40 s R's ragdoll is moved rigidly so its head lies outside
// D's leading thigh, 60 % of the way to the knee, along the thigh point's motion, a gap of 40 % of one prediction's
// travel (aheadS at the point's speed), and given D's velocity: the 13f prediction (relative motion) sees it standing
// off the thigh, but if it stopped (on the floor, or held by anything) the thigh would be 60 % of that travel into it.
// The physical leg guard clears the stopped copy too: over the next three ticks the posed leg yields until its depth in
// the stopped head (the head moved back by D's own motion at it over aheadS, measured here on the posed leg capsules)
// is within PHYS_LEG_OK. The twin (PoseDebug.noLegStop: the met body only where the prediction has it) stays in it.
describe('rung 6 (D1): the posed leg yields where a met body would stop', () => {
  const AT = 0.4;
  const ALONG = 0.6;
  const GAP = 0.4;
  const SUBSTEPS = 12;
  async function stoppedDepths(opts: SimOptions): Promise<{ out: number[]; dt: number }> {
    const base = FIX('L3-F9-convert-free');
    const d = V3(base, { durationS: AT + 0.1, diagnostics: { conversions: [{ playerId: 'R', atS: 0.15 }] } });
    const aheadS = LEG_GUARD_V3.aheadS;
    let placed = -1;
    const out: number[] = [];
    const sim = await Simulation.create(d, {
      ...opts,
      trace: false,
      onSubstep: (s) => {
        const D = player(s, 'D');
        const R = player(s, 'R');
        if (!D.pose || D.rag || !R.rag) return;
        const lm = D.pose.jointLandmarksWorld;
        const hc = R.rag.bodies.head.collider(0);
        const rH = (hc.shape as RAPIER.Ball).radius;
        if (placed < 0 && s.t >= AT - 1e-9) {
          placed = s.steps;
          const vD = vecOf(D.proxy.body.linvel());
          const sd = dot(sub(lm.leftKnee, lm.rightKnee), norm(v3(vD.x, 0, vD.z))) > 0 ? 'left' : 'right';
          const at = add(lm[`${sd}Hip`], scale(sub(lm[`${sd}Knee`], lm[`${sd}Hip`]), ALONG));
          const vSelf = vecOf(D.proxy.body.velocityAtPoint(at));
          const u = norm(vSelf);
          const head = vecOf(hc.translation());
          const q = qFromUnitVectors(norm(sub(vecOf(R.rag.bodies.core.translation()), head)), u);
          const to = add(at, scale(u, rH + d.ragdoll!.radii.thigh + GAP * len(vSelf) * aheadS));
          for (const b of Object.values(R.rag.bodies)) {
            b.setTranslation(add(to, qRot(q, sub(vecOf(b.translation()), head))), true);
            b.setRotation(qMul(q, b.rotation()), true);
            b.setLinvel(vD, true);
            b.setAngvel(v3(), true);
          }
          return;
        }
        if (placed < 0 || s.steps > placed + SUBSTEPS) return;
        const head = vecOf(hc.translation());
        const stopped = sub(head, scale(vecOf(D.proxy.body.velocityAtPoint(head)), aheadS));
        let worst = 0;
        for (const x of poseLimbShapes(s.def.ragdoll!, D.pose)) {
          if (x.kind !== 'capsule' || !/(Thigh|Shin)$/.test(x.key)) continue;
          const ab = sub(x.b, x.a);
          const l = len(ab);
          const r = new RAPIER.Ball(rH).contactShape(stopped, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(l / 2, x.r), add(x.a, scale(ab, 0.5)), qFromUnitVectors(v3(0, 1, 0), scale(ab, 1 / l)), 0.05);
          if (r) worst = Math.max(worst, -r.distance);
        }
        out.push(worst);
      },
    });
    stepUntil(sim, () => false);
    const dt = sim.physics.dt;
    sim.dispose();
    expect(out.length).toBe(SUBSTEPS);
    return { out, dt };
  }

  it('V3 yields the thigh out of the stopped head within PHYS_LEG_OK in three ticks; the twin without the stopped copy stays in it', async () => {
    const { out: on, dt } = await stoppedDepths({});
    const { out: off } = await stoppedDepths({ debug: { pose: { noLegStop: true } } });
    // both start in it: the construct puts the stopped head 60 % of a prediction's travel (1.2 cm at 4.8 m/s) into the thigh
    expect(on[0]).toBeGreaterThan(HARD_OK);
    expect(off[0]).toBeGreaterThan(HARD_OK);
    // the yield runs at the leg departure rate (CONT_LEG_MPS a substep) at most
    for (let k = 1; k < on.length; k++) expect(on[k - 1] - on[k], `substep ${k}`).toBeLessThanOrEqual(CONT_LEG_MPS * dt + 1e-4);
    expect(on[on.length - 1]).toBeLessThanOrEqual(PHYS_LEG_OK);
    for (const [k, x] of off.entries()) expect(x, `twin substep ${k}`).toBeGreaterThan(PHYS_LEG_OK);
  }, 120000);
});

// ------------------------------------------------------------------ surface speed: no fictitious speeds
// A capsule leg is the same shape at any twist about its axis, and its placement frame from the world up axis is
// singular for a leg pointing down: through that frame a thigh under its hip turned 18-90 degrees about its axis in
// substeps its axis swung 0.5-2.3 degrees, and the move read through it took the twist for the surface moving (the old
// tree: L4-F9-prep's impact guard read a closing speed of 38.8 m/s on a leg surface moving at 1.8). Constructed here on
// L3-F1-phase6 D's right thigh, placed twice, along dA then dB (2.4 degrees apart, through straight down beside it):
// - the ledger's reading (legSurfaceAdvance) is the surface's advance all round the thigh, to rounding;
// - the impact guard's (Simulation.legPlacementVelocity, a material point's move through twist-free frames) is the
//   advance over the substep to the second order of the swing: at most L * swing^2 / dt;
// the twin reads the same material points through the world-up frames (the placement frames themselves).
describe('rung 6: a capsule leg\'s animated move is its surface\'s (no fictitious speeds)', () => {
  it('a thigh swinging through straight down: the ledger reads the surface advance, the guard its rate; through world-up frames both read tens of m/s', async () => {
    const def = V3(FIX('L3-F1-phase6'));
    const sim = await Simulation.create(def, { trace: false });
    const pl = player(sim, 'D');
    expect(stepUntil(sim, () => !!pl.legs?.enabled && pl.legs.on[pl.legs.keys.indexOf('rightThigh')])).toBe(true);
    const L = pl.legs!;
    const i = L.keys.indexOf('rightThigh');
    const pose = pl.pose!;
    const hip = pose.jointLandmarksWorld.rightHip;
    const thighL = len(sub(pose.jointLandmarksWorld.rightKnee, hip));
    const thighAlong = (d: Vec3): PhysicalPose => {
      const out = JSON.parse(JSON.stringify(pose)) as PhysicalPose;
      out.jointLandmarksWorld.rightKnee = add(hip, scale(d, thighL));
      return out;
    };
    const dA = norm(v3(0.03, -1, -0.03));
    const dB = norm(v3(0.03, -1, 0.03));
    pl.pose = thighAlong(dA);
    syncPhysicalLegs(sim, pl);
    pl.pose = thighAlong(dB);
    syncPhysicalLegs(sim, pl);
    expect(L.on[i]).toBe(true);
    const b = pl.proxy.body;
    const bp = vecOf(b.translation());
    const bq: Quat = { ...b.rotation() };
    const dt = sim.physics.dt;
    // the twin's frames: each placement's own, from the world up axis (body frame)
    const worldUp = (d: Vec3): LegPlace => ({ p: qInvRot(bq, sub(add(hip, scale(d, thighL / 2)), bp)), q: qMul(qConj(bq), qFromUnitVectors(v3(0, 1, 0), d)), h: thighL / 2 });
    const twin = { prev: [worldUp(dA)], now: [worldUp(dB)] };
    const r = def.ragdoll!.radii.thigh;
    const mid = add(hip, scale(dB, 0.5 * thighL));
    const ref = norm(cross(dB, v3(1, 0, 0)));
    const lineDist = (p: Vec3, d: Vec3): number => len(cross(sub(p, hip), d));
    const swing = Math.acos(dot(dA, dB));
    let ledger = 0;
    let guard = 0;
    let twinLedger = 0;
    let twinGuard = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      const n = add(scale(ref, Math.cos(a)), scale(cross(dB, ref), Math.sin(a)));
      const p = add(mid, scale(n, r));
      const pBody = qInvRot(bq, sub(p, bp));
      const advance = lineDist(p, dA) - lineDist(p, dB);
      ledger = Math.max(ledger, Math.abs(legSurfaceAdvance(L, i, pBody) - advance));
      guard = Math.max(guard, Math.abs(dot(n, sim.legPlacementVelocity(pl, i, p)) - advance / dt));
      const twinMove = dot(n, qRot(bq, legPointMove(twin, 0, pBody)));
      twinLedger = Math.max(twinLedger, Math.abs(twinMove - advance));
      twinGuard = Math.max(twinGuard, Math.abs(twinMove / dt - advance / dt));
    }
    sim.dispose();
    expect(ledger).toBeLessThan(1e-6);
    expect(guard).toBeLessThanOrEqual((thighL * swing * swing) / dt);
    // the twin: errors of the order of the thigh's radius over a substep
    expect(twinLedger).toBeGreaterThan(r / 2);
    expect(twinGuard).toBeGreaterThan(10);
  }, 60000);
});
