// Gate 4 acceptance and the referee rules (plan 13b: tests/gate4 and tests/rules-revision in one file). Every registered
// Gate 4 fixture runs once (`shared`) for all the tests that read it, with their observers attached; the checks of one
// topic are one test whose rows are the former tests, each with its assertions verbatim.
import { afterAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerContactObs } from '../src/sim/contracts';
import { Simulation } from '../src/sim/simulation';
import * as G4 from '../src/sim/fixtures/gate4';
import { allFixtures } from '../src/sim/fixtures/index';
import { anchorErrors, bulkOf, SEGMENTS } from '../src/sim/ragdoll';
import { RAGDOLL_G4, RULES_FOOTBALL, rulesRevision2, type RuleProfile } from '../src/sim/profiles';
import { RuleObserver, type RetentionObs, type RuleFrame } from '../src/sim/rules';
import type { FixtureDef } from '../src/sim/fixture';
import { add, dot, len, qRot, v3, type Vec3 } from '../src/sim/vec';
import { evs, nonEmpty, pace, rows, run, runEach, runSim, stepWhile, traceDiff, traceRowsDiff } from './helpers';
import { FixedStepDriver } from '../src/sim/driver';

const R = RAGDOLL_G4;
const R2D = 180 / Math.PI;

/** Plan 13b: one test over the distinct checks of one topic, as `[name, check]` rows. */
type Check = [string, () => void | Promise<void>];
const checks = (cs: Check[]): Promise<void> => rows(cs, ([n]) => n, ([, f]) => f());

/** Step a fixture tick by tick, calling `each` after every outer tick. */

/** Mechanical energy (kinetic + gravitational, J) of a player's active bodies. */
function energyOf(sim: Simulation, id: string): number {
  const pl = sim.players.find((p) => p.id === id)!;
  const b = bulkOf(sim.activeBodies(pl));
  return b.ke + b.massKg * -sim.def.solver.gravityY * b.com.y;
}

// --------------------------------------------------------------------------------------------- shared runs
/** A test's per-tick observer (called before the first tick and after every tick) and what it saw by the end. */
type Watcher<T> = { each: (s: Simulation) => void; seen: () => T };
type BulkV = { v: ReturnType<Simulation['bulk']>['v'] } | null;
/** The observers of the tests that read a shared run; each only reads, so the run is the one `run` gives. */
const WATCHERS = {
  /** G4-A: R's pose hinge angles on its last tick as a proxy */
  hinge: (): Watcher<{ poseHinge: Record<string, number> | null }> => {
    let poseHinge: Record<string, number> | null = null;
    return {
      each: (s) => {
        const pl = s.players[0];
        if (pl.representation === 'proxy') poseHinge = { ...pl.pose!.hingeDeg };
      },
      seen: () => ({ poseHinge }),
    };
  },
  /** G4-F1: per tick, R owns exactly 1 (proxy) or 10 (ragdoll) bodies and the world counts match */
  counts: (): Watcher<{ bad: string[] }> => {
    const bad: string[] = [];
    return {
      each: (s) => {
        const pl = s.players[0];
        const n = s.bodyCount('R');
        if (pl.representation === 'proxy' && n !== 1) bad.push(`${s.t} proxy owns ${n}`);
        if (pl.representation === 'ragdoll' && n !== 10) bad.push(`${s.t} ragdoll owns ${n}`);
        const c = s.counts();
        const wantBodies = 1 + (pl.representation === 'ragdoll' ? 10 : 1);
        if (c.bodies !== wantBodies) bad.push(`${s.t} world bodies ${c.bodies}`);
        if (c.joints !== (pl.representation === 'ragdoll' ? 9 : 0)) bad.push(`${s.t} joints ${c.joints}`);
      },
      seen: () => ({ bad }),
    };
  },
  /** G4-F1: the ragdoll's largest mechanical-energy rise after the handoff, and motors acting on it */
  energy: (): Watcher<{ eMaxRise: number; bad: string[] }> => {
    let e0: number | null = null;
    let eMaxRise = 0;
    const bad: string[] = [];
    return {
      each: (s) => {
        const pl = s.players[0];
        if (pl.representation !== 'ragdoll') return;
        const e = energyOf(s, 'R');
        if (e0 === null) e0 = e;
        eMaxRise = Math.max(eMaxRise, e - e0);
        if (len(pl.applied.drive) > 0 || len(pl.applied.supportTorque) > 0) bad.push(`${s.t} motor on ragdoll`);
      },
      seen: () => ({ eMaxRise, bad }),
    };
  },
  /** G4-F2: the bulk velocity on the last proxy tick and on the first ragdoll tick */
  f2: (): Watcher<{ pre: BulkV; post: BulkV }> => {
    let pre: BulkV = null;
    let post: BulkV = null;
    return {
      each: (s) => {
        const pl = s.players[0];
        if (pl.representation === 'proxy') pre = { v: s.bulk(pl).v };
        else if (!post) post = { v: s.bulk(pl).v };
      },
      seen: () => ({ pre, post }),
    };
  },
  /** G4-F5: R-D contact impulse once R is a ragdoll; same-owner contacts and D's motor bounds while supported */
  f5Standing: (): Watcher<{ pairImpulse: number; bad: string[] }> => {
    let pairImpulse = 0;
    const bad: string[] = [];
    return {
      each: (s) => {
        for (const c of s.contacts) {
          const ids = [c.a.playerId, c.b.playerId];
          if (ids.includes('R') && ids.includes('D')) {
            const rTag = c.a.playerId === 'R' ? c.a : c.b;
            if (s.players.find((p) => p.id === 'R')!.rag && rTag.key !== 'support') pairImpulse += c.impulse;
          }
          if (c.a.playerId && c.a.playerId === c.b.playerId) bad.push(`${s.t} same-owner contact ${c.a.key}/${c.b.key}`);
        }
        const D = s.players.find((p) => p.id === 'D')!;
        if (s.tick > 0 && D.representation === 'proxy' && D.controlMode === 'supported') {
          if (len(D.applied.drive) > D.applied.driveCap + 1e-6) bad.push(`${s.t} D drive above cap`);
          if (D.applied.driveCap <= 0 && D.grounded) bad.push(`${s.t} D motor frozen`);
        }
      },
      seen: () => ({ pairImpulse, bad }),
    };
  },
  /** G4-F5: contacts between the two ragdolls and their deepest point */
  f5TwoRagdolls: (): Watcher<{ rr: number; deepest: number }> => {
    let rr = 0;
    let deepest = 0;
    return {
      each: (s) => {
        if (!s.players.every((p) => p.rag)) return;
        for (const c of s.contacts) {
          if (c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) {
            rr++;
            for (const p of c.points) deepest = Math.max(deepest, -p.dist);
          }
        }
      },
      seen: () => ({ rr, deepest }),
    };
  },
  /** G4-F11: the stored ball spot on every tick after the ending, the ball path, and the post-ending requested velocity */
  spot: (): Watcher<{ spots: string[]; balls: number[][]; postDrive: number }> => {
    const spots: string[] = [];
    const balls: number[][] = [];
    let postDrive = 0;
    return {
      each: (s) => {
        if (!s.ending) return;
        spots.push(JSON.stringify(s.ending.ballSpot));
        if (s.trace.length && s.trace[s.trace.length - 1].rule) balls.push(s.trace[s.trace.length - 1].rule!.ball);
        // the ending row itself may still carry pre-ending substeps
        if (s.tick > s.ending.tick) for (const p of s.players) if (p.representation === 'proxy') postDrive = Math.max(postDrive, len(p.applied.requestedVelocity));
      },
      seen: () => ({ spots, balls, postDrive }),
    };
  },
};
type WatchName = keyof typeof WATCHERS;
type Seen = { [K in WatchName]?: ReturnType<ReturnType<(typeof WATCHERS)[K]>['seen']> };
/** The observers each fixture's shared run carries (by fixture id). */
const watchesOf = (id: string): WatchName[] => {
  if (id === G4.g4f1().id) return ['hinge', 'counts', 'energy'];
  if (id.startsWith('G4-F2-')) return ['f2'];
  if (id === G4.g4f5Standing().id) return ['f5Standing'];
  if (id === G4.g4f5TwoRagdolls().id) return ['f5TwoRagdolls'];
  if (id === G4.g4f11HeldUp().id || id === G4.g4f3TwoArm().id) return ['spot'];
  return [];
};

interface Shared {
  sim: Simulation;
  ledger: Ledger;
  clampsAt: Map<number, number>;
  seen: Seen;
}
const sharedRunCache = new Map<string, Promise<Shared>>();
/**
 * The one run of a registered fixture (default options) that every test reading it shares: `runLedger`'s record plus
 * the fixture's observers. Keyed by the whole definition, so an edited copy never gets the original's run. The runs
 * stay alive (tests read engine bodies) until the file ends.
 */
function shared(def: FixtureDef): Promise<Shared> {
  const key = JSON.stringify(def);
  let p = sharedRunCache.get(key);
  if (!p) {
    const ws = watchesOf(def.id).map((n) => [n, WATCHERS[n]()] as const);
    p = runLedger(def, (s) => {
      for (const [, w] of ws) w.each(s);
    }).then((r) => ({ ...r, seen: Object.fromEntries(ws.map(([n, w]) => [n, w.seen()])) as Seen }));
    sharedRunCache.set(key, p);
  }
  return p;
}
afterAll(async () => {
  for (const p of sharedRunCache.values()) await p.then((r) => r.sim.dispose(), () => undefined);
  sharedRunCache.clear();
});

// --------------------------------------------------------------------------------------------- G4-A blueprint
describe('G4-A blueprint: ten bodies, masses, joints and limits read back from the engine', () => {
  it('F1 candidate: ten segment bodies, nine joints, declared masses, hinge limits on the engine joints; hinge angles measured from the engine bodies equal the pose hinge angles at the handoff (every check)', async () => {
    await checks([
      ['F1 candidate: ten segment bodies, nine joints, declared masses, hinge limits set on the engine joints', async () => {
        const { sim } = await shared(G4.g4f1());
        const pl = sim.players[0];
        expect(pl.representation).toBe('ragdoll');
        const rag = pl.rag!;
        expect(Object.keys(rag.bodies).sort()).toEqual([...SEGMENTS].sort());
        expect(rag.joints).toHaveLength(9);
        const total = pl.handoff!.audit!.before.massKg;
        const f = R.massFractions;
        const want: Record<string, number> = {
          core: f.core, head: f.head, leftUpperArm: f.upperArm, rightUpperArm: f.upperArm, leftForearm: f.forearm, rightForearm: f.forearm,
          leftThigh: f.thigh, rightThigh: f.thigh, leftShin: f.shin, rightShin: f.shin,
        };
        let sum = 0;
        for (const id of SEGMENTS) {
          const m = rag.bodies[id].mass();
          sum += m;
          expect(m).toBeCloseTo(want[id] * total, 4);
          const pi = rag.bodies[id].principalInertia();
          expect(Math.min(pi.x, pi.y, pi.z)).toBeGreaterThan(0);
        }
        expect(sum).toBeCloseTo(total, 4);
        const lim: Record<string, [number, number]> = { neck: R.limitsDeg.neck, elbow: R.limitsDeg.elbow, knee: R.limitsDeg.knee };
        for (const j of rag.joints) {
          expect(j.joint.contactsEnabled()).toBe(false);
          if (j.kind === 'shoulder' || j.kind === 'hip') {
            // Rapier 0.21 reports JointData.spherical joints as Generic (three locked linear axes, free angular axes)
            expect([RAPIER.JointType.Spherical, RAPIER.JointType.Generic]).toContain(j.joint.type());
            expect(j.limitsRad).toBeNull();
            continue;
          }
          expect(j.joint.type()).toBe(RAPIER.JointType.Revolute);
          const rj = j.joint as RAPIER.RevoluteImpulseJoint;
          expect(rj.limitsEnabled()).toBe(true);
          expect(rj.limitsMin() * R2D).toBeCloseTo(lim[j.kind][0], 4); // engine stores f32
          expect(rj.limitsMax() * R2D).toBeCloseTo(lim[j.kind][1], 4);
        }
      }],
      ['candidate hinge angles measured from the engine bodies equal the pose hinge angles at the handoff', async () => {
        const { sim, seen } = await shared(G4.g4f1());
        const { poseHinge } = seen.hinge!;
        const rep = sim.players[0].handoff!.report;
        for (const [k, v] of nonEmpty(Object.entries(poseHinge!), 'hinges')) expect(Math.abs(rep.hingeDeg[k] - v)).toBeLessThan(0.05);
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-F1
describe('G4-F1 stationary handoff and settling', () => {
  it('accepted with zero anchor error and exact bulk transfer; never two representations or none; no launch, passive, settles at rest on the ground (every check)', async () => {
    await checks([
      ['accepted with zero anchor error, continuous landmarks, no new penetration, and exact bulk transfer', async () => {
        const { sim } = await shared(G4.g4f1());
        const pl = sim.players[0];
        const h = pl.handoff!;
        expect(h.accepted).toBe(true);
        expect(h.reason).toBe('diagnostic');
        expect(h.report.ok).toBe(true);
        expect(h.report.maxAnchorErrM).toBeLessThanOrEqual(R.validation.anchorTolM);
        expect(h.report.maxLandmarkErrM).toBeLessThanOrEqual(R.validation.landmarkTolM);
        expect(h.report.floorPenetrationM).toBeLessThanOrEqual(R.validation.penetrationTolM);
        expect(h.report.maxNewExternalPenetrationM).toBeLessThanOrEqual(R.validation.penetrationTolM);
        expect(h.report.hingeOk).toBe(true);
        const a = h.audit!;
        expect(a.ok).toBe(true);
        expect(Math.abs(a.massDiffKg)).toBeLessThanOrEqual(R.audit.massTolKg);
        expect(a.linearRelErr).toBeLessThanOrEqual(R.audit.linearRelTol);
        expect(a.angularRelErr).toBeLessThanOrEqual(R.audit.angularRelTol);
        expect(a.energyDeltaJ).toBeLessThanOrEqual(1e-6);
        expect(h.activeBodies).toEqual({ before: 1, after: 10, proxyRemoved: true });
        expect(evs(sim, 'representation', 'R')).toHaveLength(1);
        expect(evs(sim, 'handoffRejected')).toHaveLength(0);
        expect(evs(sim, 'handoffAuditFailure')).toHaveLength(0);
      }],
      ['never two representations or none: per tick, R owns exactly 1 (proxy) or 10 (ragdoll) bodies; world counts match', async () => {
        const { sim, seen } = await shared(G4.g4f1());
        const { bad } = seen.counts!;
        expect(bad).toEqual([]);
        expect(sim.counts()).toMatchObject({ bodies: 11, joints: 9, colliders: 16, tags: 16, grips: 0, clamps: 0 });
      }],
      ['no launch: mechanical energy never rises after the handoff; passive (no motors); settles at rest on the ground', async () => {
        const { sim, seen } = await shared(G4.g4f1());
        const { eMaxRise, bad } = seen.energy!;
        expect(bad).toEqual([]);
        expect(eMaxRise).toBeLessThan(0.5);
        const pl = sim.players[0];
        const b = sim.bulk(pl);
        expect(len(b.v)).toBeLessThan(0.02);
        expect(pl.grounded).toBe(true);
        const sep = anchorErrors(pl.rag!);
        expect(Math.max(...Object.values(sep))).toBeLessThan(R.validation.anchorTolM);
        // settling extremes are recorded for the report (not gates beyond the declared tolerances)
        expect(pl.ragStats!.maxFloorPenM).toBeLessThanOrEqual(R.validation.penetrationTolM);
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-F2
describe('G4-F2 moving and rotating conversion', () => {
  const cases = G4.gate4Fixtures().filter((d) => d.id.startsWith('G4-F2'));
  it('several yaws and a tilted pose; P and L continuous, energy within limit, direction retained, no extra impulse on every G4-F2 fixture; a same-runtime repeat gives identical ragdoll traces', async () => {
    await checks([
      ['covers several yaws and a tilted pose', () => {
        expect(cases.length).toBeGreaterThanOrEqual(3);
        expect(new Set(cases.map((d) => d.players[0].initial.yawDeg)).size).toBeGreaterThanOrEqual(3);
        expect(cases.some((d) => (d.players[0].initial.leanDeg ?? 0) > 0)).toBe(true);
      }],
      ...cases.map((def): Check => [`${def.id}: P and L continuous, energy within limit, direction retained, no extra impulse`, async () => {
        const { sim, seen } = await shared(def);
        const { pre, post } = seen.f2!;
        const h = sim.players[0].handoff!;
        expect(h.accepted).toBe(true);
        expect(h.audit!.ok).toBe(true);
        expect(h.audit!.linearRelErr).toBeLessThanOrEqual(R.audit.linearRelTol);
        expect(h.audit!.angularRelErr).toBeLessThanOrEqual(R.audit.angularRelTol);
        expect(h.audit!.energyDeltaJ).toBeLessThanOrEqual(h.audit!.energyGainLimitJ);
        const P0 = v3(...(h.audit!.before.P as [number, number, number]));
        const P1 = v3(...(h.audit!.after.P as [number, number, number]));
        expect(len(P0)).toBeGreaterThan(100);
        expect(dot(P0, P1) / (len(P0) * len(P1))).toBeGreaterThan(1 - 1e-9);
        // one tick later the horizontal motion still points the same way (gravity/ground only; no impact impulse added)
        const hv = (v: { x: number; z: number }) => v3(v.x, 0, v.z);
        expect(dot(hv(pre!.v), hv(post!.v)) / (len(hv(pre!.v)) * len(hv(post!.v)))).toBeGreaterThan(0.99);
        expect(evs(sim, 'handoffAuditFailure')).toHaveLength(0);
        expect(evs(sim, 'numericalFailure')).toHaveLength(0);
      }]),
      ['same-runtime repeat: identical ragdoll traces', async () => {
        const a = (await shared(cases[0])).sim;
        const b = await run(cases[0]);
        expect(a.trace.length).toBe(b.trace.length);
        for (let i = 0; i < a.trace.length; i++) expect(a.trace[i].players.R.p).toEqual(b.trace[i].players.R.p);
        b.dispose();
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-F6
describe('G4-F6 bad candidate and safe failure', () => {
  it('joint mismatch: rejected with jointAnchor; proxy keeps falling as Gate 3 proxy; no ragdoll bodies or completion', async () => {
    const { sim } = await shared(G4.g4f6Joint());
    const rej = evs(sim, 'handoffRejected', 'R');
    expect(rej).toHaveLength(1);
    expect(String(rej[0].data!.reasons).split(',')).toContain('jointAnchor');
    expect(Number(rej[0].data!.maxAnchorErrM)).toBeGreaterThan(R.validation.anchorTolM);
    expect(rej[0].data!.edit).toMatchObject({ kind: 'jointMismatch', segment: 'leftForearm' });
    expect(rej[0].data!.fallback).toBe('fallingProxy');
    const pl = sim.players[0];
    expect(pl.representation).toBe('proxy');
    expect(pl.controlMode).toBe('falling');
    expect(pl.rag).toBeNull();
    expect(evs(sim, 'representation')).toHaveLength(0);
    expect(sim.counts()).toMatchObject({ bodies: 2, joints: 0 });
    expect(sim.result).not.toBe('groundDown');
  });

  it('crowded neighbour: rejected with externalPenetration against the other player; nothing shrunk, moved or disabled', async () => {
    const def = G4.g4f6Crowded();
    const { sim } = await shared(def);
    const rej = evs(sim, 'handoffRejected', 'R');
    expect(rej).toHaveLength(1);
    expect(String(rej[0].data!.reasons).split(',')).toContain('externalPenetration');
    const w = rej[0].data!.worstExternal as { other: string; newDepthM: number };
    expect(w.other.startsWith('D:')).toBe(true);
    expect(w.newDepthM).toBeGreaterThan(R.validation.penetrationTolM);
    expect(sim.players.every((p) => p.representation === 'proxy')).toBe(true);
    expect(sim.counts()).toMatchObject({ bodies: 3, joints: 0 });
    const r = sim.players[0].proxy.body.translation();
    expect(Math.hypot(r.x - def.players[0].initial.x, r.z - def.players[0].initial.z)).toBeLessThan(0.05);
  });
});

// --------------------------------------------------------------------------------------------- prior gates
// --------------------------------------------------------------------------------------------- G4-B helpers
type V = { x: number; y: number; z: number };
type Ledger = {
  tick: number; step: number; owner: string; arm: string; kind: 'hold' | 'clamp' | 'passive'; id: string; target: string;
  actual: number; forceOnTarget: V; pointOnTarget: V; forceOnOwner: V; pointOnOwner: V;
}[];
/**
 * Passive grasp direction (review finding 1): a loaded passive link must be tensile. The force on the target points
 * from the held point toward the owner's palm, so dot(forceOnTarget, pointOnTarget - pointOnOwner) < 0 whenever the
 * points are apart; the owner receives the opposite force. Returns the offending entries.
 */
function nonTensilePassive(ledger: Ledger): Ledger {
  return ledger.filter((x) => {
    if (x.kind !== 'passive' || x.actual <= 1) return false;
    const d = v3(x.pointOnTarget.x - x.pointOnOwner.x, x.pointOnTarget.y - x.pointOnOwner.y, x.pointOnTarget.z - x.pointOnOwner.z);
    if (len(d) < 1e-6) return false;
    const sum = len(add(v3(x.forceOnTarget.x, x.forceOnTarget.y, x.forceOnTarget.z), v3(x.forceOnOwner.x, x.forceOnOwner.y, x.forceOnOwner.z)));
    return !(dot(v3(x.forceOnTarget.x, x.forceOnTarget.y, x.forceOnTarget.z), d) < 0) || sum > 1e-9;
  });
}
/**
 * Run with the arm force ledger kept. `clampsAt.get(T)` is the clamp count entering outer tick T; events and ledger
 * entries stamped T happen inside that tick (conversions run at its first substep). `extra` observes every tick after
 * that record (the shared runs' observers).
 */
async function runLedger(def: FixtureDef, extra?: (s: Simulation) => void): Promise<{ sim: Simulation; ledger: Ledger; clampsAt: Map<number, number> }> {
  const clampsAt = new Map<number, number>();
  const sim = await runEach(def, (s) => {
    const arms = (s as unknown as { arms?: { keepLedger: boolean } }).arms;
    if (arms) arms.keepLedger = true;
    clampsAt.set(s.tick, s.counts().clamps);
    extra?.(s);
  });
  const ledger = ((sim as unknown as { arms?: { ledger: Ledger } }).arms?.ledger ?? []) as Ledger;
  return { sim, ledger, clampsAt };
}
/** Steps in which one grip id received both an active shoulder ('hold') and a passive palm ('passive') force. */
function holdAndPassiveTogether(ledger: Ledger): string[] {
  const by = new Map<string, Set<string>>();
  for (const x of ledger) {
    const k = `${x.step}:${x.id}`;
    if (!by.has(k)) by.set(k, new Set());
    by.get(k)!.add(x.kind);
  }
  return [...by].filter(([, s]) => s.has('hold') && s.has('passive')).map(([k]) => k);
}

// --------------------------------------------------------------------------------------------- G4-F3
describe('G4-F3 real one-arm and two-arm tackle falls', () => {
  it('contact-driven loss of support converts the runner and surviving clamps continue on the ragdoll (G4-F3-twoArm, G4-F3-oneArm); the two-arm case is a genuine wrap first; the slower failed line stays supported (every check)', async () => {
    await checks([
      ...[G4.g4f3TwoArm(), G4.g4f3OneArm()].map((def): Check => [`${def.id}: contact-driven loss of support converts the runner; surviving clamps continue on the ragdoll`, async () => {
        const { sim, ledger, clampsAt } = await shared(def);
        const loss = evs(sim, 'lossOfSupport', 'R');
        expect(loss).toHaveLength(1);
        // the disturbance came from the defender: relevant ids name D's arms/contacts, and D's clamps loaded R before the loss
        const ids = loss[0].data!.relevantContactAndGripIds as string[];
        expect(ids.some((s) => s.startsWith('D:') || s.includes('D>R') || s.includes('R>D'))).toBe(true);
        expect(ledger.some((x) => x.owner === 'D' && x.target === 'R' && x.kind === 'clamp' && x.tick < loss[0].tick)).toBe(true);
        // the runner's request never changed (constant run); no diagnostic conversion exists
        expect(def.diagnostics).toBeUndefined();
        const rep = evs(sim, 'representation', 'R');
        expect(rep).toHaveLength(1);
        expect(rep[0].data!.trigger).toBe('lossOfSupport');
        expect(rep[0].tick).toBe(loss[0].tick);
        const h = sim.players.find((p) => p.id === 'R')!.handoff!;
        expect(h.accepted).toBe(true);
        expect(h.report.ok).toBe(true);
        expect(h.report.maxLandmarkErrM).toBeLessThanOrEqual(R.validation.landmarkTolM);
        expect(h.audit!.ok).toBe(true);
        // every clamp alive at the boundary was remapped onto the ragdoll target, and kept loading it afterwards
        const remaps = evs(sim, 'clampRemap', 'D');
        const before = clampsAt.get(loss[0].tick - 1) ?? 0; // state entering the tick in which the conversion ran (the previous row)
        expect(before).toBeGreaterThan(0);
        expect(remaps).toHaveLength(before);
        for (const r of remaps) {
          expect(r.tick).toBe(loss[0].tick);
          expect(r.data!.target).toBe('R');
          expect(ledger.some((x) => x.id === r.data!.clamp && x.tick >= loss[0].tick)).toBe(true);
        }
        expect(evs(sim, 'gripBegin')).toHaveLength(0);
        expect(evs(sim, 'handoffRejected')).toHaveLength(0);
        expect(evs(sim, 'numericalFailure')).toHaveLength(0);
      }]),
      ['the two-arm case is a genuine wrap before the fall', async () => {
        const { sim } = await shared(G4.g4f3TwoArm());
        const loss = evs(sim, 'lossOfSupport', 'R')[0];
        expect(sim.trace.some((r) => r.t < loss.t && r.players.D.wrap === 'wrapped')).toBe(true);
      }],
      ['failed attempt: same code, slower line; the wrap forms but the runner stays supported and runs to the practice edge', async () => {
        const two = G4.g4f3TwoArm();
        const fail = G4.g4f3Failed();
        // only the defender line speed (and the shorter duration) differ
        const strip = (d: FixtureDef) => JSON.stringify({ ...d, id: '', title: '', notes: '', durationS: 0, players: d.players.map((p) => (p.id === 'R' ? p : { ...p, initial: { ...p.initial, z: 0, velocity: null }, controller: { ...p.controller, approachSpeedMps: 0, driveInMps: 0, approachVelocityWorld: null, finish: null } })) });
        expect(strip(fail)).toBe(strip(two));
        const { sim } = await shared(fail);
        expect(sim.trace.some((r) => r.players.D.wrap !== 'noHold')).toBe(true);
        expect(evs(sim, 'lossOfSupport', 'R')).toHaveLength(0);
        expect(evs(sim, 'representation', 'R')).toHaveLength(0);
        const R0 = sim.players.find((p) => p.id === 'R')!;
        expect(R0.controlMode).toBe('supported');
        const vEnd = sim.bulk(R0).v;
        expect(vEnd.x).toBeGreaterThan(1);
        // no referee ending: the runner advanced to the practice safety edge (a separate non-success label)
        expect(sim.ending).toBeNull();
        expect(sim.result).toBe('practiceOutOfBounds');
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-F4
describe('G4-F4 grip remapping interventions', () => {
  it('target-only remap, owner-only tensile passive links, simultaneous both; never active and passive force on one grip in one step (every F4 case)', async () => {
    await checks([
      ['target-only: both holds remap onto the ragdoll torso with zero anchor error and keep loading it; releases carry reasons', async () => {
        const { sim, ledger } = await shared(G4.g4f4('targetOnly'));
        const rep = evs(sim, 'representation', 'R')[0];
        const remaps = evs(sim, 'gripRemap', 'D');
        expect(remaps).toHaveLength(2);
        for (const r of remaps) {
          expect(r.data!.ok).toBe(true);
          expect(Number(r.data!.anchorErrM)).toBeLessThanOrEqual(R.validation.anchorTolM);
          expect(Number(r.data!.surfaceDistM)).toBeLessThanOrEqual(R.validation.anchorTolM);
          expect(r.data!.to).toBe('core');
          const after = ledger.filter((x) => x.id === r.data!.grip && x.tick >= rep.tick);
          expect(after.length).toBeGreaterThan(0);
          expect(nonEmpty(after, 'ledger after').every((x) => x.kind === 'hold' && x.target === 'R')).toBe(true);
        }
        for (const r of evs(sim, 'gripRelease', 'D')) expect(typeof r.data!.reason).toBe('string');
        expect(evs(sim, 'gripPassive')).toHaveLength(0);
      }],
      ['owner-only: active shoulder force stops; each grip continues only as a tensile passive palm link, ending only by separation', async () => {
        const { sim, ledger } = await shared(G4.g4f4('ownerOnly'));
        const rep = evs(sim, 'representation', 'D')[0];
        const pas = evs(sim, 'gripPassive', 'D');
        expect(pas).toHaveLength(2);
        for (const p of pas) {
          expect(p.data!.ok).toBe(true);
          expect(Number(p.data!.palmGapM)).toBeLessThanOrEqual(R.validation.anchorTolM);
          const after = ledger.filter((x) => x.id === p.data!.grip && x.tick >= rep.tick);
          expect(after.length).toBeGreaterThan(0);
          expect(nonEmpty(after, 'ledger after').every((x) => x.kind === 'passive')).toBe(true);
        }
        expect(ledger.filter((x) => x.owner === 'D' && x.tick >= rep.tick && x.kind !== 'passive')).toHaveLength(0);
        // the passive links pull the held runner toward the palms (tensile), never push the players apart
        const loaded = ledger.filter((x) => x.kind === 'passive' && x.actual > 1);
        expect(loaded.length).toBeGreaterThan(0);
        expect(nonTensilePassive(ledger)).toEqual([]);
        // a link ends only by separating past the passive limit; links still alive at the end stay within it
        const rel = evs(sim, 'gripRelease', 'D');
        expect(rel.every((r) => r.data!.reason === 'separation')).toBe(true);
        for (const g of nonEmpty(sim.arms!.grips.values(), 'live grips')) expect(g.passive).toBeDefined();
      }],
      ['simultaneous: target remap and passive owner link both apply; still one force law per grip', async () => {
        const { sim, ledger } = await shared(G4.g4f4('simultaneous'));
        expect(evs(sim, 'representation')).toHaveLength(2);
        expect(nonEmpty(evs(sim, 'gripRemap', 'D'), 'grip remaps').every((r) => r.data!.ok === true)).toBe(true);
        expect(evs(sim, 'gripPassive', 'D')).toHaveLength(2);
        const t0 = evs(sim, 'representation')[0].tick;
        expect(ledger.filter((x) => x.tick >= t0 && x.kind !== 'passive')).toHaveLength(0);
        expect(ledger.some((x) => x.kind === 'passive' && x.actual > 1)).toBe(true);
        expect(nonTensilePassive(ledger)).toEqual([]);
        expect(evs(sim, 'gripRelease', 'D').every((r) => r.data!.reason === 'separation')).toBe(true);
        expect(sim.counts()).toMatchObject({ bodies: 21, joints: 18 });
      }],
      ['active shoulder and passive palm forces never act on one grip in the same step (all F4 cases)', async () => {
        for (const k of ['targetOnly', 'ownerOnly', 'simultaneous', 'invalidSurface'] as const) {
          const { ledger } = await shared(G4.g4f4(k));
          expect(ledger.length).toBeGreaterThan(0);
          expect(holdAndPassiveTogether(ledger)).toEqual([]);
        }
      }],
    ]);
  });

  it('invalid surface (labelled diagnostic edit): both grips release with invalidSurface at the boundary, no further force', async () => {
    const def = G4.g4f4('invalidSurface');
    expect(def.diagnostics!.conversions![0].edit).toMatchObject({ kind: 'surfaceShift' });
    const { sim, ledger } = await shared(def);
    const rep = evs(sim, 'representation', 'R')[0];
    const remaps = evs(sim, 'gripRemap', 'D');
    expect(remaps).toHaveLength(2);
    for (const r of remaps) {
      expect(r.data!.ok).toBe(false);
      expect(Number(r.data!.surfaceDistM)).toBeGreaterThan(R.validation.anchorTolM);
    }
    const rel = evs(sim, 'gripRelease', 'D');
    expect(rel).toHaveLength(2);
    for (const r of rel) {
      expect(r.data!.reason).toBe('invalidSurface');
      expect(r.tick).toBe(rep.tick);
    }
    expect(ledger.filter((x) => x.tick >= rep.tick)).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------------------------- G4-F10
describe('G4-F10 forearm-clamp representation handoff', () => {
  it("target-only: the supported owner keeps its remapped virtual clamps; owner-only and simultaneous: the converting owner's virtual clamps end and never return (every G4-F10 case)", async () => {
    await checks([
      ['target-only: the supported owner keeps its virtual clamps on the fallen target (remapped, still loading)', async () => {
        const { sim, ledger, clampsAt } = await shared(G4.g4f10('targetOnly'));
        const rep = evs(sim, 'representation', 'R')[0];
        const remaps = evs(sim, 'clampRemap', 'D');
        expect(remaps.length).toBe(clampsAt.get(rep.tick - 1));
        expect(remaps.length).toBeGreaterThan(0);
        for (const r of nonEmpty(remaps, 'clamp remaps')) expect(ledger.some((x) => x.id === r.data!.clamp && x.tick >= rep.tick && x.kind === 'clamp')).toBe(true);
        expect(evs(sim, 'gripBegin')).toHaveLength(0);
        expect(evs(sim, 'gripPassive')).toHaveLength(0);
      }],
      ...(['ownerOnly', 'simultaneous'] as const).map((k): Check => [`${k}: the converting owner's virtual clamps end (ownerRagdoll) and never return; no palm anchor; physical forearms only`, async () => {
        const { sim, ledger, clampsAt } = await shared(G4.g4f10(k));
        const rep = evs(sim, 'representation', 'D')[0];
        const ends = evs(sim, 'clampEnd', 'D').filter((e) => e.data!.reason === 'ownerRagdoll');
        expect(ends.length).toBe(clampsAt.get(rep.tick - 1));
        expect(ends.length).toBeGreaterThan(0);
        for (const e of nonEmpty(ends, 'clamp ends')) expect(e.tick).toBe(rep.tick);
        expect(ledger.filter((x) => x.owner === 'D' && x.tick >= rep.tick)).toHaveLength(0);
        for (const [tick, n] of clampsAt) if (tick >= rep.tick) expect(n).toBe(0);
        expect(evs(sim, 'gripBegin')).toHaveLength(0);
        expect(evs(sim, 'gripPassive')).toHaveLength(0);
        expect(evs(sim, 'clampRemap')).toHaveLength(0);
      }]),
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-C helpers
const ruleEvents = (sim: Simulation, type: string) => evs(sim, type, 'R');
const without = (def: FixtureDef, id: string): FixtureDef => ({ ...def, id: `${def.id}-solo`, players: def.players.filter((p) => p.id !== id), diagnostics: def.diagnostics ? { conversions: def.diagnostics.conversions?.filter((c) => c.playerId !== id) } : undefined });
/** Core-body path of a player (one point per trace row). */
const pathOf = (sim: Simulation, id: string) => sim.trace.map((r) => r.players[id]?.p);
const maxDiverge = (a: ReturnType<typeof pathOf>, b: ReturnType<typeof pathOf>) => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] && b[i]) m = Math.max(m, Math.hypot(a[i]![0] - b[i]![0], a[i]![1] - b[i]![1], a[i]![2] - b[i]![2]));
  return m;
};

// --------------------------------------------------------------------------------------------- G4-F5
describe('G4-F5 external collision and continuing opponent', () => {
  it('a ragdoll against a standing opponent and two ragdolls from different owners: solved contacts with bounded overlap, the defender keeps working, each fall differs from its solo run (every check)', async () => {
    await checks([
      ['ragdoll vs standing opponent: solved segment-proxy contacts; the defender keeps executing bounded requests; contact changes the fall', async () => {
        const def = G4.g4f5Standing();
        const { sim, seen } = await shared(def);
        const { pairImpulse, bad } = seen.f5Standing!;
        expect(bad).toEqual([]);
        expect(sim.players.find((p) => p.id === 'R')!.representation).toBe('ragdoll');
        expect(pairImpulse).toBeGreaterThan(1);
        const solo = await run(without(def, 'D'));
        expect(maxDiverge(pathOf(sim, 'R'), pathOf(solo, 'R'))).toBeGreaterThan(0.2);
        solo.dispose();
      }],
      ['two ragdolls from different owners: segment-segment contacts with bounded overlap; each fall differs from its solo run', async () => {
        const def = G4.g4f5TwoRagdolls();
        const { sim, seen } = await shared(def);
        const { rr, deepest } = seen.f5TwoRagdolls!;
        expect(rr).toBeGreaterThan(0);
        expect(deepest).toBeLessThanOrEqual(R.validation.penetrationTolM);
        for (const id of ['R', 'D']) {
          const solo = await run(without(def, id === 'R' ? 'D' : 'R'));
          expect(maxDiverge(pathOf(sim, id), pathOf(solo, id))).toBeGreaterThan(0.2);
          solo.dispose();
        }
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-F7
describe('G4-F7 completion semantics (event matrix)', () => {
  it('event matrix: lab-core result, untouched fall, foot brace, limb first, grounded then touched, defender falls alone, no progressStopped without opponent restraint, per-point hand/wrist exclusion (every row)', async () => {
    await checks([
      ['labCoreOnly keeps the historical result: untouched fall, solved torso/pelvis-ground contact after a valid handoff', async () => {
        const { sim } = await shared(G4.g4f7LabCore());
        expect(sim.result).toBe('runnerCoreDown');
        const e = sim.ending!;
        expect(e.profile).toBe('rules-g4-labCoreOnly-v1');
        expect(['torso', 'pelvis']).toContain(e.evidence.region);
        expect(sim.players[0].handoff!.accepted).toBe(true);
      }],
      ['football subset, untouched fall: grounded without influence, no contacted-runner ending (timeout label)', async () => {
        const { sim } = await shared(G4.g4f7Untouched());
        expect(sim.ending).toBeNull();
        expect(ruleEvents(sim, 'groundWithoutInfluence')).toHaveLength(1);
        expect(ruleEvents(sim, 'influenceBegin')).toHaveLength(0);
        expect(sim.result).toBe('duration');
      }],
      ['foot brace only: a held runner on his feet with continuing influence gives no groundDown', async () => {
        const { sim } = await shared(G4.g4f7FootBrace());
        expect(sim.players.find((p) => p.id === 'R')!.representation).toBe('proxy');
        const t0 = ruleEvents(sim, 'influenceBegin')[0].t;
        const after = sim.trace.filter((r) => r.t > t0 && r.rule);
        expect(after.length).toBeGreaterThan(100);
        expect(nonEmpty(after, 'rule rows after').every((r) => r.rule!.infl === 1)).toBe(true);
        const labels = new Set(after.flatMap((r) => r.rule!.gnd));
        // virtual support (physical) and achieved-pose shoe probes ('?') only
        expect([...labels].sort()).toEqual(['foot?', 'footSupport']);
        expect(evs(sim, 'gripBegin', 'D')).toHaveLength(2);
        expect(sim.ending).toBeNull();
        expect(sim.result).toBe('duration');
      }],
      ['eligible limb before the core with continuing influence: groundDown at the shin touch, core not on the ground', async () => {
        const { sim } = await shared(G4.g4f7LimbFirst());
        const e = sim.ending!;
        expect(e.kind).toBe('groundDown');
        expect(['shin', 'knee', 'thigh', 'forearm', 'elbow', 'upperArm']).toContain(e.evidence.region);
        const touching = e.evidence.touching as string[];
        expect(touching.some((l) => l === 'torso' || l === 'pelvis')).toBe(false);
        const infl = e.evidence.influence as { sources: string[] };
        expect(infl.sources.some((s) => s.startsWith('D:') && s.includes(':c'))).toBe(true);
      }],
      ['opponent touches an already-grounded runner: the ending is the first opponent touch', async () => {
        const { sim } = await shared(G4.g4f7GroundedThenTouched());
        const g = ruleEvents(sim, 'groundWithoutInfluence')[0];
        const ib = ruleEvents(sim, 'influenceBegin')[0];
        expect(g.t).toBeLessThan(ib.t);
        expect(sim.ending!.kind).toBe('groundDown');
        expect(sim.ending!.step).toBe(ib.step);
        expect((ib.data!.sources as string[])[0].startsWith('contact:D:')).toBe(true);
      }],
      ['contact only with the other player and the defender falls alone: no runner groundDown', async () => {
        const { sim } = await shared(G4.g4f7DefenderFallsAlone());
        expect(sim.players.find((p) => p.id === 'D')!.representation).toBe('ragdoll');
        expect(sim.players.find((p) => p.id === 'R')!.representation).toBe('proxy');
        expect(ruleEvents(sim, 'influenceBegin').length).toBeGreaterThan(0);
        expect(sim.ending).toBeNull();
      }],
      ...[G4.g4f7Stationary, G4.g4f7Wall, G4.g4f7FreeRun].map((mk): Check => [`${mk().id}: no progressStopped (no opponent restraint)`, async () => {
        const { sim } = await shared(mk());
        expect(sim.ending).toBeNull();
        expect(sim.result).toBe('duration');
        if (mk === G4.g4f7Wall) {
          const Rp = sim.players[0];
          expect(Math.hypot(sim.bulk(Rp).v.x, sim.bulk(Rp).v.z)).toBeLessThan(0.3); // stopped against the wall
          expect(Rp.intent.locomotion.desiredVelocityWorld.x).toBe(3); // still requesting forward
        }
      }]),
      ['hand/wrist exclusion is per contact point: palm and wrist band never end the play; mid-forearm does (observer, real ragdoll pose)', async () => {
        const { RuleObserver, labelLimbPoint } = await import('../src/sim/rules');
        const { RULES_FOOTBALL } = await import('../src/sim/profiles');
        const { sim } = await shared(G4.g4f1());
        const pl = sim.players[0];
        const pose = pl.pose!;
        const band = 0.03;
        expect(labelLimbPoint('forearm', 'leftForearm', -0.34 + 0.02, band, R.lengths)).toBe('wrist');
        expect(labelLimbPoint('forearm', 'leftForearm', -0.17, band, R.lengths)).toBe('forearm');
        expect(labelLimbPoint('shin', 'leftShin', -0.36 + 0.01, band, R.lengths)).toBe('ankle');
        expect(labelLimbPoint('shin', 'leftShin', -0.01, band, R.lengths)).toBe('knee');
        expect(labelLimbPoint('palm', 'leftForearm', 0, band, R.lengths)).toBe('hand');
        expect(labelLimbPoint('shoe', 'leftShin', 0, band, R.lengths)).toBe('foot');
        const out: string[] = [];
        const obs = new RuleObserver(RULES_FOOTBALL('R', { sideline: false, progress: false }), R, (t) => out.push(t));
        const sp = pose.segments.leftForearm;
        const pt = (y: number) => {
          const w = add(sp.originWorld, qRot(sp.rotationWorld, v3(0, y, 0)));
          return v3(w.x, 0, w.z);
        };
        const tag = (region: string) => ({ playerId: 'R', part: 'leftForearm' as const, region: region as 'forearm', key: `leftForearm:${region}` });
        const floor = { playerId: null, part: 'floor' as const, region: 'floor' as const, key: 'floor' };
        const frame = (points: { region: string; y: number }[], t: number) => ({
          t, tick: 1, step: 1, dt: 1 / 240, runnerId: 'R', representation: 'ragdoll' as const, validHandoff: true, controlMode: 'falling' as const, grounded: true,
          corePose: { p: v3(), q: { x: 0, y: 0, z: 0, w: 1 } }, pose, velocity: v3(), request: v3(),
          contacts: points.map((p) => ({ a: tag(p.region), b: floor, normalAB: v3(0, -1, 0), impulse: 1, points: [{ pointWorld: pt(p.y), dist: -0.001, impulse: 1 }] })),
          opponentContacts: [], retention: [{ id: 'D:right:g1', owner: 'D', kind: 'grip' as const, forceOnRunner: v3(0, 0, 50), loadN: 50 }], minClampNormalN: 1,
        });
        expect(obs.observe(frame([{ region: 'palm', y: -0.36 }, { region: 'forearm', y: -0.34 + 0.01 }], 0.1))).toBeNull();
        expect(obs.lastRow!.gnd.sort()).toEqual(['hand', 'wrist']);
        const end = obs.observe(frame([{ region: 'forearm', y: -0.17 }], 0.2));
        expect(end!.kind).toBe('groundDown');
        expect(end!.evidence.region).toBe('forearm');
      }],
    ]);
  });

  it('numerical failure is a separate non-success label (diagnostic NaN injection), never an ending', async () => {
    const def = G4.g4f11HeldUp();
    const sim = await Simulation.create(def);
    for (let i = 0; i < 10; i++) {
      sim.stepTick();
      await pace();
    }
    sim.players.find((p) => p.id === 'R')!.proxy.body.setTranslation({ x: NaN, y: 1, z: 0 }, true);
    await runSim(sim);
    expect(sim.result).toBe('numericalFailure');
    expect(sim.ending).toBeNull();
    sim.dispose();
  });

  it('rejected runner handoff with a rule profile: observer disabled; invalidHandoff label, never a completion', async () => {
    const def: FixtureDef = { ...G4.g4f6Joint(), rules: (await import('../src/sim/profiles')).RULES_FOOTBALL('R') };
    const sim = await run(def);
    expect(ruleEvents(sim, 'ruleObserverDisabled')).toHaveLength(1);
    expect(sim.ending).toBeNull();
    expect(sim.result).toBe('invalidHandoff');
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F11
describe('G4-F11 forward progress, boundary and frozen event spot', () => {
  it('held-up upright stop after the declared window, a frozen event spot with bodies still settling, resumed progress ends the window, a sideline foot touch ends the play (every check)', async () => {
    await checks([
      ['held-up upright stop: progressStopped after the declared window, both players still supported; predicates logged', async () => {
        const def = G4.g4f11HeldUp();
        const P = def.rules!.progress;
        const { sim } = await shared(def);
        const e = sim.ending!;
        expect(e.kind).toBe('progressStopped');
        expect(Number(e.evidence.windowS)).toBeGreaterThanOrEqual(P.windowS - 1e-6);
        expect(Number(e.evidence.advanceM)).toBeLessThanOrEqual(P.maxAdvanceM);
        expect(Number(e.evidence.requestMps)).toBeGreaterThanOrEqual(P.minRequestMps);
        expect(Math.max(Number(e.evidence.retentionN), Number(e.evidence.bodyOpposeN))).toBeGreaterThanOrEqual(P.minRestraintN);
        expect(evs(sim, 'lossOfSupport')).toHaveLength(0);
        expect(sim.players.every((p) => p.controlMode === 'supported')).toBe(true);
        expect(evs(sim, 'ruleEnding')).toHaveLength(1);
      }],
      ['frozen event spot: bodies keep settling for 0.5 s after the ending; the stored spot never moves; no post-ending tackle drive', async () => {
        for (const def of [G4.g4f11HeldUp(), G4.g4f3TwoArm()]) {
          const { sim, seen } = await shared(def);
          const { spots, balls, postDrive } = seen.spot!;
          const e = sim.ending!;
          expect(new Set(spots).size).toBe(1);
          expect(sim.t - e.t).toBeGreaterThanOrEqual(def.rules!.settleS - 1e-6);
          expect(sim.result).toBe(e.kind);
          expect(evs(sim, 'trialEnd')[0].data!.reason).toBe(e.kind);
          // physical bodies keep moving after a fall's event (no freeze); a held-up stop may already be at rest
          const moved = Math.hypot(balls[balls.length - 1][0] - balls[0][0], balls[balls.length - 1][2] - balls[0][2], balls[balls.length - 1][1] - balls[0][1]);
          if (e.kind === 'groundDown') expect(moved).toBeGreaterThan(0.005);
          expect(postDrive).toBe(0); // only braking (zero requested velocity) after the ending
          expect(sim.counts().grips + sim.counts().clamps).toBe(0);
        }
      }],
      ['resumed progress before the window completes: the window ends, no progressStopped, the runner advances', async () => {
        const { sim } = await shared(G4.g4f11Resumed());
        expect(sim.ending).toBeNull();
        const w = ruleEvents(sim, 'progressWindow');
        const end = w.find((e) => e.data!.phase === 'end')!;
        expect(Number(end.data!.windowS)).toBeLessThan(G4.g4f11Resumed().rules!.progress.windowS);
        expect(sim.result).toBe('practiceOutOfBounds');
        expect(evs(sim, 'practiceOutOfBounds')[0].playerId).toBe('R');
      }],
      ['sideline: an actual foot ground touch on/over the plane ends the play while the COM is inside; a clear run does not', async () => {
        const def = G4.g4f11Sideline(3.85);
        const { sim } = await shared(def);
        const e = sim.ending!;
        expect(e.kind).toBe('sidelineOut');
        expect(e.evidence.region).toBe('foot');
        expect(Number(e.evidence.planeValue)).toBeGreaterThanOrEqual(def.rules!.sideline.offsetM);
        const rowAt = sim.trace.find((r) => r.tick === e.tick)!;
        expect(rowAt.players.R.com[2]).toBeLessThan(def.rules!.sideline.offsetM);
        const { sim: clear } = await shared(G4.g4f11Sideline(3.75));
        expect(clear.ending).toBeNull();
        expect(clear.result).toBe('duration');
      }],
    ]);
  });
});

// --------------------------------------------------------------------------------------------- G4-F3 completion
describe('G4-F3 completion comes from the selected rule observer', () => {
  it("groundDown from an eligible solved ground contact after the contact-caused handoff, with the defender's influence, on G4-F3-twoArm and G4-F3-oneArm", async () => {
    await rows([G4.g4f3TwoArm, G4.g4f3OneArm], (mk) => mk().id, async (mk) => {
      const { sim } = await shared(mk());
      const e = sim.ending!;
      expect(e.kind).toBe('groundDown');
      expect(e.evidence.source).toBe('physical');
      expect(e.t).toBeGreaterThan(ruleEvents(sim, 'representation')[0].t);
      const infl = e.evidence.influence as { sources: string[] };
      expect(infl.sources.some((s) => s.startsWith('D:'))).toBe(true);
      expect(sim.result).toBe('groundDown');
    });
  });

  it('failed transfer audit (copied profile, energyGainFraction 0.01): distinct invalidTransfer outcome, never a completion', async () => {
    // Review finding 2: only the copied validation profile differs. The default 50 % allowance passes this transfer;
    // a 1 % allowance leaves the 10 J absolute floor, below R's transfer energy change.
    const base = G4.g4f3TwoArm();
    const strict = structuredClone(base.ragdoll!);
    strict.validation.energyGainFraction = 0.01;
    const def: FixtureDef = { ...base, id: `${base.id}-strictEnergy`, ragdoll: strict };
    const sim = await run(def);
    const h = sim.players.find((p) => p.id === 'R')!.handoff!;
    expect(h.audit!.ok).toBe(false);
    expect(h.audit!.reasons).toContain('energyGain');
    expect(h.audit!.energyDeltaJ).toBeGreaterThan(h.audit!.energyGainLimitJ);
    expect(h.outcome).toBe('transferFailed');
    expect(h.accepted).toBe(false);
    // the switched assembly stays as diagnostic state (no second representation, no proxy)
    expect(h.activeBodies).toEqual({ before: 1, after: 10, proxyRemoved: true });
    expect(evs(sim, 'handoffAuditFailure', 'R')).toHaveLength(1);
    expect(ruleEvents(sim, 'ruleObserverDisabled')[0].data!.reason).toBe('invalidTransfer');
    expect(sim.ending).toBeNull();
    expect(evs(sim, 'ruleEnding')).toHaveLength(0);
    expect(sim.result).toBe('invalidTransfer');
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F8
describe('G4-F8 lifecycle and reproducibility', () => {
  /** Engine/lifecycle invariants of a freshly built or reset simulation. */
  function cleanState(sim: Simulation): string[] {
    const bad: string[] = [];
    const w = sim.physics.world;
    for (const h of sim.physics.tags.keys()) if (!w.getCollider(h)) bad.push(`orphan tag ${h}`);
    if (sim.physics.tags.size !== w.colliders.len()) bad.push(`tags ${sim.physics.tags.size} != colliders ${w.colliders.len()}`);
    const ids = new Set(sim.players.map((p) => p.id));
    w.bodies.forEach((b) => {
      const u = b.userData as { playerId?: string } | undefined;
      if (u?.playerId !== undefined && !ids.has(u.playerId)) bad.push(`orphan body of ${u.playerId}`);
    });
    if (sim.players.some((p) => p.representation !== 'proxy' || p.rag || p.handoff || p.controlMode !== 'supported')) bad.push('representation not reset');
    if (sim.arms && (sim.arms.grips.size || sim.counts().clamps || sim.arms.ended)) bad.push('arm relationships not reset');
    if (sim.ending || (sim.rules && (sim.rules.disabledReason || sim.rules.ending))) bad.push('completion not reset');
    if (sim.events.some((e) => ['representation', 'ruleEnding', 'gripBegin', 'lossOfSupport'].includes(e.type))) bad.push('stale events');
    return bad;
  }

  it('35 reset cycles across supported, holding, one-converting, both-converting and completed states return to baseline', async () => {
    const plan: [FixtureDef, number[]][] = [
      [G4.g4f11HeldUp(), [0.2, 0.6, 1.6, 9]], // supported, restrained, completed (+settle), run to end
      [G4.g4f4('targetOnly'), [0.45, 0.75, 1.0, 1.5, 9]], // holding (one / two grips), target converted
      [G4.g4f3TwoArm(), [0.55, 0.95, 1.3, 9]], // wrapping, one converted, completed
      [G4.g4f4('simultaneous'), [0.95, 1.4, 9]], // both converting
      [G4.g4f10('ownerOnly'), [1.25, 9]],
      [G4.g4f5TwoRagdolls(), [0.4, 1.0, 9]],
    ];
    let cycles = 0;
    const states = new Set<string>();
    for (const [def, stops] of plan) {
      const fresh = await run(def);
      const ref = { tr: fresh.trace, ev: JSON.stringify(fresh.events), result: fresh.result };
      fresh.dispose();
      const sim = await Simulation.create(def);
      const base = sim.counts();
      expect(cleanState(sim)).toEqual([]);
      for (let rep = 0; rep < 2; rep++)
        for (const stopS of stops) {
          await stepWhile(sim, () => sim.t < stopS - 1e-9);
          const reps = sim.players.map((p) => p.representation);
          states.add(sim.done ? 'completed' : reps.every((r) => r === 'ragdoll') ? 'bothConverted' : reps.includes('ragdoll') ? 'oneConverted' : sim.counts().grips + sim.counts().clamps > 0 ? 'holding' : 'supported');
          sim.reset();
          cycles++;
          expect(sim.counts()).toEqual(base);
          expect(cleanState(sim)).toEqual([]);
        }
      await runSim(sim);
      expect(sim.result).toBe(ref.result);
      expect(JSON.stringify(sim.events)).toBe(ref.ev);
      expect(traceRowsDiff(sim.trace, ref.tr)).toBeNull();
      sim.dispose();
    }
    expect(cycles).toBeGreaterThanOrEqual(30);
    expect([...states].sort()).toEqual(['bothConverted', 'completed', 'holding', 'oneConverted', 'supported']);
  });

  it('render rate and cosmetic colours never change physical outcomes', async () => {
    for (const def of [G4.g4f3TwoArm(), G4.g4f4('simultaneous')]) {
      const byRate = async (hz: number, d: FixtureDef = def) => {
        const s = await Simulation.create(d);
        const drv = new FixedStepDriver(d.solver.outerTickS, 8);
        while (!s.done) {
          for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
          await pace();
        }
        return s;
      };
      const a = await byRate(30);
      const b = await byRate(144);
      const c = await byRate(60, { ...def, cosmetic: { palette: 'alt' } });
      for (const o of [b, c]) {
        expect(traceDiff(a.trace, o.trace, ['R', 'D']).pos).toBe(0);
        expect(JSON.stringify(o.events)).toBe(JSON.stringify(a.events));
      }
      for (const s of [a, b, c]) s.dispose();
    }
  });

  it('reversed player/transition iteration order: same labels and ending kinds for every Gate 4 fixture (deviation recorded)', async () => {
    const deviations: string[] = [];
    await rows(G4.gate4Fixtures(), (def) => def.id, async (def) => {
      const { sim: a } = await shared(def);
      const b = await run(def, { reverseOrder: true });
      expect(b.result).toBe(a.result);
      expect(b.ending?.kind ?? null).toBe(a.ending?.kind ?? null);
      const d = traceDiff(a.trace, b.trace, def.players.map((p) => p.id));
      if (d.pos > 0) deviations.push(`${def.id} max |dp| ${d.pos.toFixed(4)} m${a.ending ? ` ending t ${a.ending.t} vs ${b.ending!.t}` : ''}`);
      b.dispose();
    });
    console.log(`[G4-F8] reversed-order sensitivity (not bitwise):\n  ${deviations.join('\n  ')}`);
  });
});

// ============================================================================================= rules revision 2
// Plan 10e: the rule corrections, on rules revision 2 (U8: a new revision opted in on L3 and L4; the historical profile
// keeps the behaviour it was recorded with). E1 the settle window keeps the stance request and yaw effort (U9), E2
// influence clears only out of contact and retention, E3 progress counts the retention opposing it, E4 a profile cannot
// make an excluded region end a play. Each check runs the historical profile beside revision 2.
const DT = 1 / 240;
const HIST = RULES_FOOTBALL('R', { sideline: false });
const REV2 = rulesRevision2(HIST);

/** One supported, grounded proxy runner substep with no ground contact (the ball on the core offset). */
const frame = (i: number, o: { request?: Vec3; velocity?: Vec3; opponentContacts?: PlayerContactObs[]; retention?: RetentionObs[] } = {}): RuleFrame => ({
  t: i * DT,
  tick: Math.floor(i / 4),
  step: i,
  dt: DT,
  runnerId: 'R',
  representation: 'proxy',
  validHandoff: false,
  controlMode: 'supported',
  grounded: true,
  corePose: { p: v3(0, 1, 0), q: { x: 0, y: 0, z: 0, w: 1 } },
  pose: null,
  velocity: o.velocity ?? v3(),
  request: o.request ?? v3(),
  contacts: [],
  opponentContacts: o.opponentContacts ?? [],
  retention: o.retention ?? [],
  minClampNormalN: 1,
});

const touch = (impulse: number): PlayerContactObs => ({
  other: 'D',
  ownRegion: 'torso',
  ownClass: 'torso',
  otherRegion: 'torso',
  otherClass: 'shoulder:selected',
  pointWorld: v3(0, 1, 0),
  normalFromOther: v3(1, 0, 0),
  impulse,
});

/** Feed `n` substeps after one opening contact; the events in order and the observer. */
function play(profile: RuleProfile, n: number, at: (i: number) => RuleFrame, open = true): { events: string[]; obs: RuleObserver } {
  const events: string[] = [];
  const obs = new RuleObserver(profile, RAGDOLL_G4, (type) => events.push(type));
  if (open) obs.observe(frame(0, { opponentContacts: [touch(0.01)] }));
  for (let i = 1; i <= n && !obs.ending; i++) obs.observe(at(i));
  return { events, obs };
}

describe('plan 10e: rules revision 2', () => {
  it('E2: a runner touched or held with a zero request keeps influence; out of contact it clears', () => {
    const held: RetentionObs = { id: 'clamp:D:left', owner: 'D', kind: 'clamp', forceOnRunner: v3(), loadN: 0 };
    const cases: [string, (i: number) => RuleFrame, boolean][] = [
      // an unloaded clamp and a touch under the source impulse are not influence sources, but they are contact
      ['clamp unloaded, zero request', (i) => frame(i, { retention: [held] }), false],
      ['touch under the source impulse, zero request', (i) => frame(i, { opponentContacts: [touch(1e-5)] }), false],
      ['no contact, zero request', (i) => frame(i), true],
      ['no contact, moving freely', (i) => frame(i, { request: v3(2, 0, 0), velocity: v3(2, 0, 0) }), true],
    ];
    for (const [name, at, clears] of cases) {
      const hist = play(HIST, 240, at);
      const rev = play(REV2, 240, at);
      expect(hist.events, name).toContain('influenceBegin');
      // the historical profile clears after 0.2 s in every case: a zero request reads as moving freely
      expect(hist.events, name).toContain('influenceCleared');
      expect(rev.events.includes('influenceCleared'), name).toBe(clears);
      expect(rev.obs.lastRow!.infl, name).toBe(clears ? 0 : 1);
    }
  });

  it('E3: a sideways or forward retention force is not progress retained; one opposing progress is', () => {
    // the runner asks for 1 m/s along the field's forward axis (+x) and does not move
    const grip = (f: Vec3): RetentionObs => ({ id: 'grip:D:right', owner: 'D', kind: 'grip', forceOnRunner: f, loadN: Math.hypot(f.x, f.y, f.z) });
    const cases: [string, Vec3, boolean][] = [
      ['sideways', v3(0, 0, 100), false],
      ['forward', v3(100, 0, 0), false],
      ['opposing', v3(-100, 0, 0), true],
      ['opposing, at 45 degrees', v3(-70.8, 0, 70.8), true],
    ];
    for (const [name, f, stops] of cases) {
      const at = (i: number) => frame(i, { request: v3(1, 0, 0), retention: [grip(f)] });
      const hist = play(HIST, 300, at, false);
      const rev = play(REV2, 300, at, false);
      // the historical profile counts the whole force: every case is restrained and stops after the 0.75 s window
      expect(hist.obs.ending?.kind, name).toBe('progressStopped');
      expect(rev.obs.ending?.kind ?? null, name).toBe(stops ? 'progressStopped' : null);
      if (!stops) expect(rev.events, name).not.toContain('progressWindow');
      else expect(rev.obs.ending!.evidence.retentionN, name).toBeCloseTo(-f.x, 6);
    }
  });

  it('E4: a profile that lists an excluded region cannot be refereed; every registered profile can', () => {
    for (const region of ['hand', 'wrist', 'foot', 'ankle', 'footSupport'])
      expect(() => new RuleObserver({ ...REV2, eligibleRegions: [...REV2.eligibleRegions, region] }, RAGDOLL_G4, () => {}), region).toThrow(/EXCLUDED_GROUND_REGIONS/);
    for (const d of allFixtures().filter((x) => x.rules)) expect(() => new RuleObserver(d.rules!, d.ragdoll ?? RAGDOLL_G4, () => {}), d.id).not.toThrow();
  });

  it('E1: after the ending players keep their stance request and yaw effort through the settle window', async () => {
    // L3-F1-mirror0 with the defender wrapping in a lowered stance: both profiles end at the same substep and the defender
    // is still a supported proxy for a while after it (the runner, a ragdoll by then, asks for full yaw effort). Plan 13d:
    // was L3-F1-phase0, whose defender after Fast Run's contact timing has settled before the ending (no rise to compare)
    const base = allFixtures().find((d) => d.id === 'L3-F1-mirror0')!;
    const variant = (rules: RuleProfile): FixtureDef => ({
      ...base,
      id: `test-E1-${rules.revision ?? 1}`,
      rules,
      players: base.players.map((p) => (p.id === 'D' && p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, stance: { heightM: 0.78 } } } : p)),
    });
    const hist: RuleProfile = { ...base.rules!, revision: undefined, id: `${base.rules!.id}+historical` };
    type Run = { stance: (number | null)[]; runner: { h: number | null; yaw: number | null }[]; h: number[] };
    const runs: Record<string, Run> = {};
    for (const [k, rules] of [['hist', hist], ['rev2', base.rules!]] as const) {
      const out: Run = { stance: [], runner: [], h: [] };
      let endT = NaN;
      const sim = await Simulation.create(variant(rules), {
        onSubstep: (s) => {
          if (!s.ending) return;
          // the ending substep ran on the intent decided before it; the override starts with the next one
          if (Number.isNaN(endT)) {
            endT = s.t;
            return;
          }
          const R = s.players.find((p) => p.id === 'R')!;
          out.runner.push({ h: R.intent.locomotion.stance?.heightM ?? null, yaw: R.intent.locomotion.yawEffort ?? null });
          const D = s.players.find((p) => p.id === 'D')!;
          if (D.representation !== 'proxy' || D.controlMode !== 'supported' || s.t > endT + 0.15) return;
          out.stance.push(D.intent.locomotion.stance?.heightM ?? null);
          out.h.push(s.poseOf(D).p.y);
        },
      });
      await runSim(sim);
      expect(sim.ending, k).not.toBeNull();
      sim.dispose();
      runs[k] = out;
    }
    expect(runs.rev2.stance.length).toBeGreaterThan(20);
    expect(runs.hist.stance.length).toBeGreaterThan(20);
    // revision 2: the requests they stood in; the historical profile drops both for the profile's standing height
    expect(new Set(runs.rev2.stance)).toEqual(new Set([0.78]));
    expect(new Set(runs.rev2.runner.map((r) => `${r.h}/${r.yaw}`))).toEqual(new Set(['null/1']));
    expect(new Set(runs.hist.stance)).toEqual(new Set([null]));
    expect(new Set(runs.hist.runner.map((r) => `${r.h}/${r.yaw}`))).toEqual(new Set(['null/null']));
    // and the defender stays down: the historical core rises toward the standing height through the same window
    const rise = (h: number[]): number => h[h.length - 1] - h[0];
    expect(rise(runs.hist.h)).toBeGreaterThan(rise(runs.rev2.h) + 0.01);
  }, 60000);
});
