// Ladder rung 7g: the passive energy of every ragdoll across every solve, observation only.
//
// passive = change of (kinetic energy, linear and angular with the world inertia, of every segment + potential energy)
//           - work of every applied force and torque on its segments over the solve (drives, envelope, fall response,
//             anything added to a body before the solve: Rapier's user force and torque, trapezoid on the velocities)
// What is left is what the solve itself did to the ragdoll: contacts, joints, damping, gravity's integration. Contacts
// with static ground, between its own shapes and its joints can only take energy out of a ragdoll; only another
// player's body can give it energy legitimately, so a solve counts only when no other player's collider touches it
// (no contact impulse, solved or raw, on any pair with one). A counted solve that gains more than INJECTION_J injects.
//
// Off-run cost nothing: the meter wraps the one Simulation's physics step (an instance property, restored by
// `restore`), reads bodies before and after it, and contact manifolds only for a solve that could change a record.
import type RAPIER from '@dimforge/rapier3d-compat';
import { isGround, type SegmentId } from '../src/sim/contracts';
import { solvedImpulses } from '../src/sim/physics';
import { SEGMENTS, type Ragdoll } from '../src/sim/ragdoll';
import type { Simulation } from '../src/sim/simulation';

/**
 * Gain over one solve (J) counted as injection: the smallest the investigation called a defect (the self-trunk pinch's
 * class starts there; 7.7 J was its worst). The bookkeeping's own floor is under it: gravity's symplectic Euler step reads
 * -m g^2 dt^2 / 2 per solve (-0.08 J for a 100 kg body at dt 1/240 s; a gain never; tests/passive-energy.test.ts). A
 * solve with no contact impulse at all gains only where segments move off their velocities' path: Rapier's CCD holding
 * one back at its time of impact in the solve before its first contact, the velocity kept (the core 5.6 mm short on
 * L4-F2-model-back-off, 6.8 mm on L3-F14-handoff; the contact's solve takes the energy back), or every segment 2-6 mm off
 * between two contact solves (L3-F1-phase3 reversed, not attributed). Over every L3/L4/HC run at rung 7g such gains
 * reach 1.7 J (10 runs over INJECTION_J): reported per run (`quietMaxJ`), and marked in `over` (`contact` false).
 */
export const INJECTION_J = 0.5;

interface Snap {
  m: number;
  c: [number, number, number];
  v: [number, number, number];
  w: [number, number, number];
  I: [number, number, number, number, number, number];
  F: [number, number, number];
  T: [number, number, number];
}
const snap = (b: RAPIER.RigidBody): Snap => {
  const v = b.linvel();
  const w = b.angvel();
  const c = b.worldCom();
  const F = b.userForce();
  const T = b.userTorque();
  const m = b.mass();
  // the inertia view is shared scratch: copied before any later read
  const I = b.effectiveAngularInertia();
  return { m, c: [c.x, c.y, c.z], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z], I: [I.m11, I.m12, I.m13, I.m22, I.m23, I.m33], F: [F.x, F.y, F.z], T: [T.x, T.y, T.z] };
};
const kinetic = (s: Snap): number => {
  const [a, b, c, d, e, f] = s.I;
  const [x, y, z] = s.w;
  return 0.5 * s.m * (s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2) + 0.5 * (x * (a * x + b * y + c * z) + y * (b * x + d * y + e * z) + z * (c * x + e * y + f * z));
};
const dot3 = (p: number[], q: number[]): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

/** One solve's reading for one ragdoll (`onSolve`, when the meter is asked for every solve; `touched` ones included). */
export interface SolveEnergy {
  pid: string;
  /** Solve index (Simulation.steps after it) and its end time. */
  step: number;
  t: number;
  passiveJ: number;
  dKineticJ: number;
  dPotentialJ: number;
  appliedJ: number;
  /** Another player's collider took an impulse with this ragdoll in this solve (solved or raw; not counted). */
  touched: boolean;
  /** Any contact impulse on its colliders at all (floor, obstacles, its own shapes). */
  contact: boolean;
  /** Segments touching static ground and one of its own shapes in the same solve (the pinch). */
  pinch: SegmentId[];
}

/** One ragdoll's record over a run. */
export interface EnergyRun {
  /** Solves with the ragdoll enabled. */
  solves: number;
  /** Counted solves gaining more than INJECTION_J, and their total gain (J). */
  injecting: number;
  injectedJ: number;
  /** The largest counted gain (J, 0 if none gained), its solve, time and pinch segments. */
  maxJ: number;
  maxStep: number | null;
  maxAt: number | null;
  maxPinch: SegmentId[] | null;
  /** The largest gain of a counted solve with no contact impulse at all (the bookkeeping's floor; read to QUIET_J). */
  quietMaxJ: number;
  /**
   * Every injecting solve: its index, gain, pinch segments, the largest loss of the tick before it (the four solves
   * before; a rebound follows an impact that took energy out), and whether it had any contact impulse.
   */
  over: { step: number; J: number; pinch: SegmentId[]; priorLossJ: number; contact: boolean }[];
}

/** The resolution of `quietMaxJ`: a quiet solve's gain under it is not looked for (it reads 0). */
export const QUIET_J = 0.01;

const newRun = (): EnergyRun => ({ solves: 0, injecting: 0, injectedJ: 0, maxJ: 0, maxStep: null, maxAt: null, maxPinch: null, quietMaxJ: 0, over: [] });

/** Contacts of one ragdoll after a solve, by impulse (solved or raw). */
function contactsOf(sim: Simulation, pid: string, rag: Ragdoll): { touched: boolean; contact: boolean; pinch: SegmentId[] } {
  const w = sim.physics.world;
  const tags = sim.physics.tags;
  const own = new Map<number, SegmentId>();
  // its own shapes: segment colliders, plan 11's self shapes and ladder rung 9a's (whose trunk may be plan 11's)
  const cols: [RAPIER.Collider, SegmentId][] = [...rag.colliders, ...(rag.self?.arms ?? []), ...(rag.selfLegs?.legs ?? [])].map((c) => [c.collider, c.segment]);
  for (const c of new Set([...(rag.self?.trunk ?? []), ...(rag.selfLegs?.trunk ?? [])])) cols.push([c, 'core']);
  for (const [c, seg] of cols) own.set(c.handle, seg);
  const ground = new Set<SegmentId>();
  const self = new Set<SegmentId>();
  let touched = false;
  let contact = false;
  const seen = new Set<string>();
  for (const [c1, seg1] of cols) {
    const h1 = c1.handle;
    w.contactPairsWith(c1, (c2) => {
      const key = h1 < c2.handle ? `${h1}:${c2.handle}` : `${c2.handle}:${h1}`;
      if (seen.has(key)) return;
      seen.add(key);
      // the solved reading, and the raw one: among points at the same position the solved reading can give a solver
      // contact's impulse to another point than the one Rapier wrote it to (it reads 0 where 15.5 N s acted:
      // L3-F1-phase6 reversed, R's pelvis on D's support, solve 266); a stale raw value only excludes more
      let J = 0;
      w.contactPair(c1, c2, (m, flipped) => {
        const s1 = flipped ? c2 : c1;
        const s2 = flipped ? c1 : c2;
        const imp = solvedImpulses(m, { p: s1.translation(), q: s1.rotation() }, { p: s2.translation(), q: s2.rotation() });
        for (let i = 0; i < m.numContacts(); i++) J += Math.max(0, imp[i], m.contactImpulse(i));
      });
      if (!(J > 0)) return;
      contact = true;
      const seg2 = own.get(c2.handle);
      if (seg2 !== undefined) {
        self.add(seg1);
        self.add(seg2);
        return;
      }
      const tag = tags.get(c2.handle);
      if (tag?.playerId && tag.playerId !== pid) touched = true;
      else if (tag && (isGround(tag) || (tag.playerId === null && c2.parent()?.isFixed()))) ground.add(seg1);
    });
  }
  return { touched, contact, pinch: SEGMENTS.filter((s) => ground.has(s) && self.has(s)) };
}

/**
 * Meter the passive energy of every ragdoll of `sim` from now on. `onSolve` (optional) receives every solve's reading
 * (the manifolds are then read on every solve); without it only the solves that can change a record are read.
 */
export function passiveEnergyMeter(sim: Simulation, onSolve?: (e: SolveEnergy) => void): { runs: () => Map<string, EnergyRun>; restore: () => void } {
  const phys = sim.physics;
  const step = phys.step;
  const runs = new Map<string, EnergyRun>();
  const recent = new Map<string, number[]>();
  const g = phys.world.gravity;
  const G = [g.x, g.y, g.z];
  phys.step = function metered(this: typeof phys): void {
    const rags: [string, Ragdoll, Snap[]][] = [];
    for (const p of sim.players) if (p.rag?.enabled) rags.push([p.id, p.rag, SEGMENTS.map((s) => snap(p.rag!.bodies[s]))]);
    step.call(this);
    const dt = phys.dt;
    for (const [pid, rag, pre] of rags) {
      const post = SEGMENTS.map((s) => snap(rag.bodies[s]));
      let dK = 0;
      let dP = 0;
      let W = 0;
      for (let i = 0; i < pre.length; i++) {
        const [a, b] = [pre[i], post[i]];
        dK += kinetic(b) - kinetic(a);
        dP -= a.m * (dot3(G, b.c) - dot3(G, a.c));
        W += dt * (dot3(a.F, [(a.v[0] + b.v[0]) / 2, (a.v[1] + b.v[1]) / 2, (a.v[2] + b.v[2]) / 2]) + dot3(a.T, [(a.w[0] + b.w[0]) / 2, (a.w[1] + b.w[1]) / 2, (a.w[2] + b.w[2]) / 2]));
      }
      const passive = dK + dP - W;
      const r = runs.get(pid) ?? newRun();
      runs.set(pid, r);
      r.solves++;
      const prior = recent.get(pid) ?? [];
      recent.set(pid, [...prior.slice(-3), passive]);
      // only a solve that gains more than the least of the threshold, the largest gain and the quiet floor can change
      // a record; the others are read only when every solve is asked for
      if (!onSolve && !(passive > Math.min(INJECTION_J, r.maxJ, Math.max(r.quietMaxJ, QUIET_J)))) continue;
      const c = contactsOf(sim, pid, rag);
      const stepN = sim.steps + 1;
      const t = stepN * dt;
      onSolve?.({ pid, step: stepN, t, passiveJ: passive, dKineticJ: dK, dPotentialJ: dP, appliedJ: W, ...c });
      if (c.touched) continue;
      if (!c.contact && passive > QUIET_J) r.quietMaxJ = Math.max(r.quietMaxJ, passive);
      if (passive > INJECTION_J) {
        r.injecting++;
        r.injectedJ += passive;
        r.over.push({ step: stepN, J: passive, pinch: c.pinch, priorLossJ: Math.max(0, ...prior.map((x) => -x)), contact: c.contact });
      }
      if (passive > r.maxJ) Object.assign(r, { maxJ: passive, maxStep: stepN, maxAt: t, maxPinch: c.pinch });
    }
  };
  return {
    runs: () => runs,
    restore: () => {
      phys.step = step;
    },
  };
}
