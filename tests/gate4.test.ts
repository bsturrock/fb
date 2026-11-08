import { describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Simulation } from '../src/sim/simulation';
import * as G4 from '../src/sim/fixtures/gate4';
import { allFixtures } from '../src/sim/fixtures/index';
import { anchorErrors, bulkOf, SEGMENTS } from '../src/sim/ragdoll';
import { RAGDOLL_G4, SOLVER_G1 } from '../src/sim/profiles';
import type { FixtureDef } from '../src/sim/fixture';
import { add, dot, len, qRot, v3 } from '../src/sim/vec';
import { nonEmpty, pace, run, runSim, stepWhile, traceDiff, traceRowsDiff } from './helpers';
import { FixedStepDriver } from '../src/sim/driver';

const R = RAGDOLL_G4;
const R2D = 180 / Math.PI;
const evs = (sim: Simulation, type: string, id?: string) => sim.events.filter((e) => e.type === type && (!id || e.playerId === id));

/** Step a fixture tick by tick, calling `each` after every outer tick. */
async function runEach(def: FixtureDef, each: (sim: Simulation) => void): Promise<Simulation> {
  const sim = await Simulation.create(def);
  each(sim);
  while (!sim.done) {
    sim.stepTick();
    await pace();
    each(sim);
  }
  return sim;
}

/** Mechanical energy (kinetic + gravitational, J) of a player's active bodies. */
function energyOf(sim: Simulation, id: string): number {
  const pl = sim.players.find((p) => p.id === id)!;
  const b = bulkOf(sim.activeBodies(pl));
  return b.ke + b.massKg * -sim.def.solver.gravityY * b.com.y;
}

// --------------------------------------------------------------------------------------------- G4-A blueprint
describe('G4-A blueprint: ten bodies, masses, joints and limits read back from the engine', () => {
  it('F1 candidate: ten segment bodies, nine joints, declared masses, hinge limits set on the engine joints', async () => {
    const sim = await run(G4.g4f1());
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
    sim.dispose();
  });

  it('candidate hinge angles measured from the engine bodies equal the pose hinge angles at the handoff', async () => {
    let poseHinge: Record<string, number> | null = null;
    const sim = await runEach(G4.g4f1(), (s) => {
      const pl = s.players[0];
      if (pl.representation === 'proxy') poseHinge = { ...pl.pose!.hingeDeg };
    });
    const rep = sim.players[0].handoff!.report;
    for (const [k, v] of nonEmpty(Object.entries(poseHinge!), 'hinges')) expect(Math.abs(rep.hingeDeg[k] - v)).toBeLessThan(0.05);
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F1
describe('G4-F1 stationary handoff and settling', () => {
  it('accepted with zero anchor error, continuous landmarks, no new penetration, and exact bulk transfer', async () => {
    const sim = await run(G4.g4f1());
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
    sim.dispose();
  });

  it('never two representations or none: per tick, R owns exactly 1 (proxy) or 10 (ragdoll) bodies; world counts match', async () => {
    const bad: string[] = [];
    const sim = await runEach(G4.g4f1(), (s) => {
      const pl = s.players[0];
      const n = s.bodyCount('R');
      if (pl.representation === 'proxy' && n !== 1) bad.push(`${s.t} proxy owns ${n}`);
      if (pl.representation === 'ragdoll' && n !== 10) bad.push(`${s.t} ragdoll owns ${n}`);
      const c = s.counts();
      const wantBodies = 1 + (pl.representation === 'ragdoll' ? 10 : 1);
      if (c.bodies !== wantBodies) bad.push(`${s.t} world bodies ${c.bodies}`);
      if (c.joints !== (pl.representation === 'ragdoll' ? 9 : 0)) bad.push(`${s.t} joints ${c.joints}`);
    });
    expect(bad).toEqual([]);
    expect(sim.counts()).toMatchObject({ bodies: 11, joints: 9, colliders: 16, tags: 16, grips: 0, clamps: 0 });
    sim.dispose();
  });

  it('no launch: mechanical energy never rises after the handoff; passive (no motors); settles at rest on the ground', async () => {
    let e0: number | null = null;
    let eMaxRise = 0;
    const bad: string[] = [];
    const sim = await runEach(G4.g4f1(), (s) => {
      const pl = s.players[0];
      if (pl.representation !== 'ragdoll') return;
      const e = energyOf(s, 'R');
      if (e0 === null) e0 = e;
      eMaxRise = Math.max(eMaxRise, e - e0);
      if (len(pl.applied.drive) > 0 || len(pl.applied.supportTorque) > 0) bad.push(`${s.t} motor on ragdoll`);
    });
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
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F2
describe('G4-F2 moving and rotating conversion', () => {
  const cases = G4.gate4Fixtures().filter((d) => d.id.startsWith('G4-F2'));
  it('covers several yaws and a tilted pose', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cases.map((d) => d.players[0].initial.yawDeg)).size).toBeGreaterThanOrEqual(3);
    expect(cases.some((d) => (d.players[0].initial.leanDeg ?? 0) > 0)).toBe(true);
  });
  for (const def of cases) {
    it(`${def.id}: P and L continuous, energy within limit, direction retained, no extra impulse`, async () => {
      let pre: { v: ReturnType<Simulation['bulk']>['v'] } | null = null;
      let post: { v: ReturnType<Simulation['bulk']>['v'] } | null = null;
      const sim = await runEach(def, (s) => {
        const pl = s.players[0];
        if (pl.representation === 'proxy') pre = { v: s.bulk(pl).v };
        else if (!post) post = { v: s.bulk(pl).v };
      });
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
      sim.dispose();
    });
  }

  it('same-runtime repeat: identical ragdoll traces', async () => {
    const a = await run(cases[0]);
    const b = await run(cases[0]);
    expect(a.trace.length).toBe(b.trace.length);
    for (let i = 0; i < a.trace.length; i++) expect(a.trace[i].players.R.p).toEqual(b.trace[i].players.R.p);
    a.dispose();
    b.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F6
describe('G4-F6 bad candidate and safe failure', () => {
  it('joint mismatch: rejected with jointAnchor; proxy keeps falling as Gate 3 proxy; no ragdoll bodies or completion', async () => {
    const sim = await run(G4.g4f6Joint());
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
    sim.dispose();
  });

  it('crowded neighbour: rejected with externalPenetration against the other player; nothing shrunk, moved or disabled', async () => {
    const def = G4.g4f6Crowded();
    const sim = await run(def);
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
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- prior gates
describe('G4 does not alter prior gate profiles', () => {
  it('every G1-G3 fixture keeps SOLVER_G1 and declares no ragdoll or rule profile', () => {
    for (const d of allFixtures().filter((f) => f.gate < 4)) {
      expect(d.solver).toEqual(SOLVER_G1);
      expect(d.ragdoll).toBeUndefined();
      expect(d.rules).toBeUndefined();
    }
  });
});


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
 * entries stamped T happen inside that tick (conversions run at its first substep).
 */
async function runLedger(def: FixtureDef): Promise<{ sim: Simulation; ledger: Ledger; clampsAt: Map<number, number> }> {
  const clampsAt = new Map<number, number>();
  const sim = await runEach(def, (s) => {
    const arms = (s as unknown as { arms?: { keepLedger: boolean } }).arms;
    if (arms) arms.keepLedger = true;
    clampsAt.set(s.tick, s.counts().clamps);
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
  for (const def of [G4.g4f3TwoArm(), G4.g4f3OneArm()]) {
    it(`${def.id}: contact-driven loss of support converts the runner; surviving clamps continue on the ragdoll`, async () => {
      const { sim, ledger, clampsAt } = await runLedger(def);
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
      sim.dispose();
    });
  }

  it('the two-arm case is a genuine wrap before the fall', async () => {
    const sim = await run(G4.g4f3TwoArm());
    const loss = evs(sim, 'lossOfSupport', 'R')[0];
    expect(sim.trace.some((r) => r.t < loss.t && r.players.D.wrap === 'wrapped')).toBe(true);
    sim.dispose();
  });

  it('failed attempt: same code, slower line; the wrap forms but the runner stays supported and runs to the practice edge', async () => {
    const two = G4.g4f3TwoArm();
    const fail = G4.g4f3Failed();
    // only the defender line speed (and the shorter duration) differ
    const strip = (d: FixtureDef) => JSON.stringify({ ...d, id: '', title: '', notes: '', durationS: 0, players: d.players.map((p) => (p.id === 'R' ? p : { ...p, initial: { ...p.initial, z: 0, velocity: null }, controller: { ...p.controller, approachSpeedMps: 0, driveInMps: 0, approachVelocityWorld: null, finish: null } })) });
    expect(strip(fail)).toBe(strip(two));
    const sim = await run(fail);
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
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F4
describe('G4-F4 grip remapping interventions', () => {
  it('target-only: both holds remap onto the ragdoll torso with zero anchor error and keep loading it; releases carry reasons', async () => {
    const { sim, ledger } = await runLedger(G4.g4f4('targetOnly'));
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
    sim.dispose();
  });

  it('owner-only: active shoulder force stops; each grip continues only as a tensile passive palm link, ending only by separation', async () => {
    const { sim, ledger } = await runLedger(G4.g4f4('ownerOnly'));
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
    sim.dispose();
  });

  it('simultaneous: target remap and passive owner link both apply; still one force law per grip', async () => {
    const { sim, ledger } = await runLedger(G4.g4f4('simultaneous'));
    expect(evs(sim, 'representation')).toHaveLength(2);
    expect(nonEmpty(evs(sim, 'gripRemap', 'D'), 'grip remaps').every((r) => r.data!.ok === true)).toBe(true);
    expect(evs(sim, 'gripPassive', 'D')).toHaveLength(2);
    const t0 = evs(sim, 'representation')[0].tick;
    expect(ledger.filter((x) => x.tick >= t0 && x.kind !== 'passive')).toHaveLength(0);
    expect(ledger.some((x) => x.kind === 'passive' && x.actual > 1)).toBe(true);
    expect(nonTensilePassive(ledger)).toEqual([]);
    expect(evs(sim, 'gripRelease', 'D').every((r) => r.data!.reason === 'separation')).toBe(true);
    expect(sim.counts()).toMatchObject({ bodies: 21, joints: 18 });
    sim.dispose();
  });

  it('invalid surface (labelled diagnostic edit): both grips release with invalidSurface at the boundary, no further force', async () => {
    const def = G4.g4f4('invalidSurface');
    expect(def.diagnostics!.conversions![0].edit).toMatchObject({ kind: 'surfaceShift' });
    const { sim, ledger } = await runLedger(def);
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
    sim.dispose();
  });

  it('active shoulder and passive palm forces never act on one grip in the same step (all F4 cases)', async () => {
    for (const k of ['targetOnly', 'ownerOnly', 'simultaneous', 'invalidSurface'] as const) {
      const { sim, ledger } = await runLedger(G4.g4f4(k));
      expect(ledger.length).toBeGreaterThan(0);
      expect(holdAndPassiveTogether(ledger)).toEqual([]);
      sim.dispose();
    }
  });
});

// --------------------------------------------------------------------------------------------- G4-F10
describe('G4-F10 forearm-clamp representation handoff', () => {
  it('target-only: the supported owner keeps its virtual clamps on the fallen target (remapped, still loading)', async () => {
    const { sim, ledger, clampsAt } = await runLedger(G4.g4f10('targetOnly'));
    const rep = evs(sim, 'representation', 'R')[0];
    const remaps = evs(sim, 'clampRemap', 'D');
    expect(remaps.length).toBe(clampsAt.get(rep.tick - 1));
    expect(remaps.length).toBeGreaterThan(0);
    for (const r of nonEmpty(remaps, 'clamp remaps')) expect(ledger.some((x) => x.id === r.data!.clamp && x.tick >= rep.tick && x.kind === 'clamp')).toBe(true);
    expect(evs(sim, 'gripBegin')).toHaveLength(0);
    expect(evs(sim, 'gripPassive')).toHaveLength(0);
    sim.dispose();
  });

  for (const k of ['ownerOnly', 'simultaneous'] as const) {
    it(`${k}: the converting owner's virtual clamps end (ownerRagdoll) and never return; no palm anchor; physical forearms only`, async () => {
      const { sim, ledger, clampsAt } = await runLedger(G4.g4f10(k));
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
      sim.dispose();
    });
  }
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
  it('ragdoll vs standing opponent: solved segment-proxy contacts; the defender keeps executing bounded requests; contact changes the fall', async () => {
    const def = G4.g4f5Standing();
    let pairImpulse = 0;
    const bad: string[] = [];
    const sim = await runEach(def, (s) => {
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
    });
    expect(bad).toEqual([]);
    expect(sim.players.find((p) => p.id === 'R')!.representation).toBe('ragdoll');
    expect(pairImpulse).toBeGreaterThan(1);
    const solo = await run(without(def, 'D'));
    expect(maxDiverge(pathOf(sim, 'R'), pathOf(solo, 'R'))).toBeGreaterThan(0.2);
    sim.dispose();
    solo.dispose();
  });

  it('two ragdolls from different owners: segment-segment contacts with bounded overlap; each fall differs from its solo run', async () => {
    const def = G4.g4f5TwoRagdolls();
    let rr = 0;
    let deepest = 0;
    const sim = await runEach(def, (s) => {
      if (!s.players.every((p) => p.rag)) return;
      for (const c of s.contacts) {
        if (c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) {
          rr++;
          for (const p of c.points) deepest = Math.max(deepest, -p.dist);
        }
      }
    });
    expect(rr).toBeGreaterThan(0);
    expect(deepest).toBeLessThanOrEqual(R.validation.penetrationTolM);
    for (const id of ['R', 'D']) {
      const solo = await run(without(def, id === 'R' ? 'D' : 'R'));
      expect(maxDiverge(pathOf(sim, id), pathOf(solo, id))).toBeGreaterThan(0.2);
      solo.dispose();
    }
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F7
describe('G4-F7 completion semantics (event matrix)', () => {
  it('labCoreOnly keeps the historical result: untouched fall, solved torso/pelvis-ground contact after a valid handoff', async () => {
    const sim = await run(G4.g4f7LabCore());
    expect(sim.result).toBe('runnerCoreDown');
    const e = sim.ending!;
    expect(e.profile).toBe('rules-g4-labCoreOnly-v1');
    expect(['torso', 'pelvis']).toContain(e.evidence.region);
    expect(sim.players[0].handoff!.accepted).toBe(true);
    sim.dispose();
  });

  it('football subset, untouched fall: grounded without influence, no contacted-runner ending (timeout label)', async () => {
    const sim = await run(G4.g4f7Untouched());
    expect(sim.ending).toBeNull();
    expect(ruleEvents(sim, 'groundWithoutInfluence')).toHaveLength(1);
    expect(ruleEvents(sim, 'influenceBegin')).toHaveLength(0);
    expect(sim.result).toBe('duration');
    sim.dispose();
  });

  it('foot brace only: a held runner on his feet with continuing influence gives no groundDown', async () => {
    const sim = await run(G4.g4f7FootBrace());
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
    sim.dispose();
  });

  it('eligible limb before the core with continuing influence: groundDown at the shin touch, core not on the ground', async () => {
    const sim = await run(G4.g4f7LimbFirst());
    const e = sim.ending!;
    expect(e.kind).toBe('groundDown');
    expect(['shin', 'knee', 'thigh', 'forearm', 'elbow', 'upperArm']).toContain(e.evidence.region);
    const touching = e.evidence.touching as string[];
    expect(touching.some((l) => l === 'torso' || l === 'pelvis')).toBe(false);
    const infl = e.evidence.influence as { sources: string[] };
    expect(infl.sources.some((s) => s.startsWith('D:') && s.includes(':c'))).toBe(true);
    sim.dispose();
  });

  it('opponent touches an already-grounded runner: the ending is the first opponent touch', async () => {
    const sim = await run(G4.g4f7GroundedThenTouched());
    const g = ruleEvents(sim, 'groundWithoutInfluence')[0];
    const ib = ruleEvents(sim, 'influenceBegin')[0];
    expect(g.t).toBeLessThan(ib.t);
    expect(sim.ending!.kind).toBe('groundDown');
    expect(sim.ending!.step).toBe(ib.step);
    expect((ib.data!.sources as string[])[0].startsWith('contact:D:')).toBe(true);
    sim.dispose();
  });

  it('contact only with the other player and the defender falls alone: no runner groundDown', async () => {
    const sim = await run(G4.g4f7DefenderFallsAlone());
    expect(sim.players.find((p) => p.id === 'D')!.representation).toBe('ragdoll');
    expect(sim.players.find((p) => p.id === 'R')!.representation).toBe('proxy');
    expect(ruleEvents(sim, 'influenceBegin').length).toBeGreaterThan(0);
    expect(sim.ending).toBeNull();
    sim.dispose();
  });

  for (const mk of [G4.g4f7Stationary, G4.g4f7Wall, G4.g4f7FreeRun]) {
    it(`${mk().id}: no progressStopped (no opponent restraint)`, async () => {
      const sim = await run(mk());
      expect(sim.ending).toBeNull();
      expect(sim.result).toBe('duration');
      if (mk === G4.g4f7Wall) {
        const Rp = sim.players[0];
        expect(Math.hypot(sim.bulk(Rp).v.x, sim.bulk(Rp).v.z)).toBeLessThan(0.3); // stopped against the wall
        expect(Rp.intent.locomotion.desiredVelocityWorld.x).toBe(3); // still requesting forward
      }
      sim.dispose();
    });
  }

  it('hand/wrist exclusion is per contact point: palm and wrist band never end the play; mid-forearm does (observer, real ragdoll pose)', async () => {
    const { RuleObserver, labelLimbPoint } = await import('../src/sim/rules');
    const { RULES_FOOTBALL } = await import('../src/sim/profiles');
    const sim = await run(G4.g4f1());
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
    sim.dispose();
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
  it('held-up upright stop: progressStopped after the declared window, both players still supported; predicates logged', async () => {
    const def = G4.g4f11HeldUp();
    const P = def.rules!.progress;
    const sim = await run(def);
    const e = sim.ending!;
    expect(e.kind).toBe('progressStopped');
    expect(Number(e.evidence.windowS)).toBeGreaterThanOrEqual(P.windowS - 1e-6);
    expect(Number(e.evidence.advanceM)).toBeLessThanOrEqual(P.maxAdvanceM);
    expect(Number(e.evidence.requestMps)).toBeGreaterThanOrEqual(P.minRequestMps);
    expect(Math.max(Number(e.evidence.retentionN), Number(e.evidence.bodyOpposeN))).toBeGreaterThanOrEqual(P.minRestraintN);
    expect(evs(sim, 'lossOfSupport')).toHaveLength(0);
    expect(sim.players.every((p) => p.controlMode === 'supported')).toBe(true);
    expect(evs(sim, 'ruleEnding')).toHaveLength(1);
    sim.dispose();
  });

  it('frozen event spot: bodies keep settling for 0.5 s after the ending; the stored spot never moves; no post-ending tackle drive', async () => {
    for (const def of [G4.g4f11HeldUp(), G4.g4f3TwoArm()]) {
      const spots: string[] = [];
      const balls: number[][] = [];
      let postDrive = 0;
      const sim = await runEach(def, (s) => {
        if (!s.ending) return;
        spots.push(JSON.stringify(s.ending.ballSpot));
        if (s.trace.length && s.trace[s.trace.length - 1].rule) balls.push(s.trace[s.trace.length - 1].rule!.ball);
        // the ending row itself may still carry pre-ending substeps
        if (s.tick > s.ending.tick) for (const p of s.players) if (p.representation === 'proxy') postDrive = Math.max(postDrive, len(p.applied.requestedVelocity));
      });
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
      sim.dispose();
    }
  });

  it('resumed progress before the window completes: the window ends, no progressStopped, the runner advances', async () => {
    const sim = await run(G4.g4f11Resumed());
    expect(sim.ending).toBeNull();
    const w = ruleEvents(sim, 'progressWindow');
    const end = w.find((e) => e.data!.phase === 'end')!;
    expect(Number(end.data!.windowS)).toBeLessThan(G4.g4f11Resumed().rules!.progress.windowS);
    expect(sim.result).toBe('practiceOutOfBounds');
    expect(evs(sim, 'practiceOutOfBounds')[0].playerId).toBe('R');
    sim.dispose();
  });

  it('sideline: an actual foot ground touch on/over the plane ends the play while the COM is inside; a clear run does not', async () => {
    const def = G4.g4f11Sideline(3.85);
    const sim = await run(def);
    const e = sim.ending!;
    expect(e.kind).toBe('sidelineOut');
    expect(e.evidence.region).toBe('foot');
    expect(Number(e.evidence.planeValue)).toBeGreaterThanOrEqual(def.rules!.sideline.offsetM);
    const rowAt = sim.trace.find((r) => r.tick === e.tick)!;
    expect(rowAt.players.R.com[2]).toBeLessThan(def.rules!.sideline.offsetM);
    sim.dispose();
    const clear = await run(G4.g4f11Sideline(3.75));
    expect(clear.ending).toBeNull();
    expect(clear.result).toBe('duration');
    clear.dispose();
  });
});

// --------------------------------------------------------------------------------------------- G4-F3 completion
describe('G4-F3 completion comes from the selected rule observer', () => {
  for (const mk of [G4.g4f3TwoArm, G4.g4f3OneArm]) {
    it(`${mk().id}: groundDown from an eligible solved ground contact after the contact-caused handoff, with the defender's influence`, async () => {
      const sim = await run(mk());
      const e = sim.ending!;
      expect(e.kind).toBe('groundDown');
      expect(e.evidence.source).toBe('physical');
      expect(e.t).toBeGreaterThan(ruleEvents(sim, 'representation')[0].t);
      const infl = e.evidence.influence as { sources: string[] };
      expect(infl.sources.some((s) => s.startsWith('D:'))).toBe(true);
      expect(sim.result).toBe('groundDown');
      sim.dispose();
    });
  }

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
    const rows: string[] = [];
    for (const def of G4.gate4Fixtures()) {
      const a = await run(def);
      const b = await run(def, { reverseOrder: true });
      expect(b.result).toBe(a.result);
      expect(b.ending?.kind ?? null).toBe(a.ending?.kind ?? null);
      const d = traceDiff(a.trace, b.trace, def.players.map((p) => p.id));
      if (d.pos > 0) rows.push(`${def.id} max |dp| ${d.pos.toFixed(4)} m${a.ending ? ` ending t ${a.ending.t} vs ${b.ending!.t}` : ''}`);
      a.dispose();
      b.dispose();
    }
    console.log(`[G4-F8] reversed-order sensitivity (not bitwise):\n  ${rows.join('\n  ')}`);
  });
});
