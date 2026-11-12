// Ladder rung 7f: the envelope's persistence rule, as its intent reads: no joint stays past the tolerance longer than the
// persistence limit *while a correction is possible*. A limb whose distal segments the floor holds (load-pinned) cannot
// be corrected by its envelope; the persistence clock counts only the substeps it is free, and a pinned limb is judged
// by what its load explains instead:
//
// - pinned: the floor's load on the distal segments (solved normal impulses, this substep) could exert, at most, the
//   moment the envelope exerts at the tolerance along the binding limit (k |grad| tol). The most a contact force can
//   exert about the joint is its Coulomb cone at its lever, N |r| sqrt(1 + mu^2), plus twist friction mu N rho (rho its
//   distance from the manifold's centre of pressure); friction is unreadable per point in this Rapier, so the bound is
//   the cone's. Own-trunk load does not pin: it is not ground, and a forearm the trunk presses on still has the envelope
//   to correct it (the weight it carries reaches the floor through the segments that touch it, which this counts).
// - loaded bound: while pinned, the excess is at most the static deflection of the load the limb actually carries plus
//   the envelope's own overshoot. The load is the external moment on the distal chain about the joint along the binding
//   limit, from its angular momentum balance over the solve (inverse dynamics: dL/dt less every applied torque and
//   force), so it includes the friction no contact record shows; per unit stiffness-excess it is Mx = M . g / |g|^2.
//   excess <= (1 + os) max(Mx over the last half damped period) / k, os the envelope's step overshoot on the chain's
//   inertia about the joint. A load at the envelope's cap has no static deflection (the limit is overrun): unbounded.
// - return: once the floor lets go of a limb still past the tolerance, it is back inside within the envelope's free
//   crossing time from rest, (pi - acos zeta) / omega_d, plus one tick (the pinned reading flickers with the contact
//   impulses within a tick).
//
// Observation only: every quantity is read after the solve from the bodies, the colliders and the solved impulses.
import type { Collider } from '@dimforge/rapier3d-compat';
import { solvedImpulses } from '../src/sim/physics';
import type { RagdollEnvelope } from '../src/sim/profiles';
import { envelopeMoments, relativeOmega, type Ragdoll } from '../src/sim/ragdoll';
import type { SegmentId } from '../src/sim/contracts';
import type { Simulation } from '../src/sim/simulation';
import { add, cross, dot, len, qConj, qMul, qRot, scale, sub, v3, vc, type Vec3 } from '../src/sim/vec';
import { JOINT_PAST_DEG } from './visible-bar';

/** One envelope joint's record over a run. */
export interface LimbRecord {
  key: string;
  /** The envelope's own clock (EnvelopeRuntime.maxOverRunS): every substep past the tolerance, pinned or not. */
  oldRunS: number;
  /** Longest run of free (not pinned) substeps past the tolerance, a pinned substep restarting it. */
  freeRunS: number;
  /** Time past the tolerance while pinned. */
  pinnedS: number;
  /** Largest excess over the loaded bound while pinned (deg; <= 0 inside it), and when. */
  overBoundDeg: number;
  overBoundAt: number;
  /** Pinned time within the first half damped period past the tolerance (the entry transient: not judged by the bound). */
  transient: number;
  /** Pinned substeps past the tolerance with the load at the envelope's cap (no static deflection: not bounded). */
  capped: number;
  /** The return after an unload furthest over its bound: return - bound (s; <= 0 inside), the return, its bound, and
   *  when the unload was (the last pinned substep). */
  returnOverS: number;
  returnS: number;
  returnBoundS: number;
  returnAt: number;
  /** Ladder 15, the visible bar: the longest run (s) of substeps more than JOINT_PAST_DEG past the limit (tests/visible-bar.ts), pinned or not, its start, and the largest excess (deg). */
  deepRunS: number;
  deepFrom: number;
  maxDeg: number;
}

type Kin = { m: number; com: Vec3; v: Vec3; L: Vec3 };
interface JointState {
  rec: LimbRecord;
  prev: { kin: Kin[]; J: Vec3 } | null;
  hist: { t: number; Mx: number }[];
  free: number;
  /** Time since the first pinned substep of this stretch past the tolerance (0: not pinned in it yet). */
  loadedFor: number;
  armed: boolean;
  ret: number;
  retBound: number;
  retFrom: number;
  deep: number;
  deepFrom: number;
}

const DEG = 180 / Math.PI;

/** The chain a joint carries: its child and every segment below it. */
function chainOf(rag: Ragdoll, child: SegmentId): SegmentId[] {
  const out = [child];
  for (let i = 0; i < out.length; i++) for (const j of rag.joints) if (j.parent === out[i]) out.push(j.child);
  return out;
}

/**
 * The rule's monitor: `substep` after every physics substep (`onSubstep`); `records` per `<player> <joint>`. The
 * envelope it judges by is each player's declared one, as its ragdoll first shows it (`declared` overrides), so a twin
 * that changes the running profile is judged against what the fixture declares.
 */
export function loadedLimbMonitor(declared?: (pid: string) => RagdollEnvelope): { substep: (s: Simulation) => void; records: () => LimbRecord[] } {
  const joints = new Map<string, JointState>();
  const decl = new Map<string, RagdollEnvelope>();
  const substep = (s: Simulation): void => {
    const dt = s.physics.dt;
    const w = s.physics.world;
    const floor = s.physics.floorBody.handle;
    for (const pl of s.players) {
      const rag = pl.rag as Ragdoll | undefined;
      if (!rag?.enabled || !rag.envelope || !rag.profile.envelope) continue;
      if (!decl.has(pl.id)) decl.set(pl.id, declared?.(pl.id) ?? rag.profile.envelope);
      const P = decl.get(pl.id)!;
      const tol = P.toleranceDeg / DEG;
      for (const e of rag.envelope) {
        const j = rag.joints[e.jointIndex];
        const E = j.kind === 'shoulder' ? P.shoulder : P.hip;
        if (!E) continue;
        const key = `${pl.id} ${e.jointId}`;
        let st = joints.get(key);
        if (!st) {
          st = { rec: { key, oldRunS: 0, freeRunS: 0, pinnedS: 0, overBoundDeg: -Infinity, overBoundAt: NaN, transient: 0, capped: 0, returnOverS: -Infinity, returnS: 0, returnBoundS: NaN, returnAt: NaN, deepRunS: 0, deepFrom: NaN, maxDeg: 0 }, prev: null, hist: [], free: 0, loadedFor: 0, armed: false, ret: 0, retBound: Infinity, retFrom: NaN, deep: 0, deepFrom: NaN };
          joints.set(key, st);
        }
        st.rec.oldRunS = e.maxOverRunS;
        const qp = rag.bodies[j.parent].rotation();
        const q = qMul(qConj(qp), rag.bodies[j.child].rotation());
        // ladder 13a: a shoulder under the anatomical twist limit is judged in that measure, as its envelope acts
        const M = envelopeMoments(E, q, j.sideSign ?? 1, e, qRot(qConj(qp), relativeOmega(rag, j)), j.kind === 'shoulder' ? rag.profile.shoulderTwistLimit : undefined);
        const terms = [
          { t: M.swing, k: E.swing.stiffnessNmPerRad, c: E.swing.dampingNmsPerRad },
          { t: M.hi, k: E.twist.stiffnessNmPerRad, c: E.twist.dampingNmsPerRad },
          { t: M.lo, k: E.twist.stiffnessNmPerRad, c: E.twist.dampingNmsPerRad },
        ];
        const b = terms.reduce((x, y) => (y.t.excess > x.t.excess ? y : x));
        const x = Math.max(0, b.t.excess);
        // ladder 15: the visible bar, on the same excess
        st.rec.maxDeg = Math.max(st.rec.maxDeg, x * DEG);
        if (x * DEG > JOINT_PAST_DEG) {
          if (st.deep === 0) st.deepFrom = s.t;
          st.deep += dt;
          if (st.deep > st.rec.deepRunS) [st.rec.deepRunS, st.rec.deepFrom] = [st.deep, st.deepFrom];
        } else st.deep = 0;
        const gw = qRot(qp, b.t.grad);
        const gl = len(gw);
        const gh = gl > 0 ? scale(gw, 1 / gl) : v3(1, 0, 0);
        const Jw = add(vc(rag.bodies[j.parent].translation()), qRot(qp, j.anchorParentLocal));
        // the chain's state after this solve; the inertia view is shared scratch, copied before any other read
        const chain = chainOf(rag, j.child);
        let I = 0;
        const kin = chain.map((sg) => {
          const body = rag.bodies[sg];
          const om = vc(body.angvel());
          const T = body.effectiveAngularInertia();
          const [a, b2, c, d, f, g] = [T.m11, T.m12, T.m13, T.m22, T.m23, T.m33];
          const Iw = (u: Vec3): Vec3 => v3(a * u.x + b2 * u.y + c * u.z, b2 * u.x + d * u.y + f * u.z, c * u.x + f * u.y + g * u.z);
          const m = body.mass();
          const com = vc(body.worldCom());
          const r = sub(com, Jw);
          I += dot(gh, Iw(gh)) + m * (dot(r, r) - dot(r, gh) ** 2);
          return { m, com, v: vc(body.linvel()), L: Iw(om), F: vc(body.userForce()), T: vc(body.userTorque()) };
        });
        // the external moment over this solve about the joint's mid-step point, per unit stiffness-excess
        let Mx = 0;
        if (st.prev) {
          const prev = st.prev;
          const Pm = scale(add(prev.J, Jw), 0.5);
          const Lof = (ks: Kin[]): Vec3 => ks.reduce((acc, k) => add(acc, add(k.L, cross(sub(k.com, Pm), scale(k.v, k.m)))), v3());
          const dL = scale(sub(Lof(kin), Lof(prev.kin)), 1 / dt);
          const applied = kin.reduce((acc, k, i) => add(acc, add(k.T, cross(sub(scale(add(k.com, prev.kin[i].com), 0.5), Pm), k.F))), v3());
          if (gl > 0) Mx = dot(sub(dL, applied), gh) / gl;
        }
        st.prev = { kin: kin.map(({ m, com, v, L }) => ({ m, com, v, L })), J: Jw };
        // the envelope's response on this chain along the binding limit
        const kk = b.k * gl * gl;
        const wn = Math.sqrt(kk / Math.max(I, 1e-9));
        const zeta = Math.min(0.999, (b.c * gl * gl) / (2 * Math.sqrt(kk * Math.max(I, 1e-9))));
        const wd = wn * Math.sqrt(1 - zeta * zeta);
        const halfPeriod = Math.PI / wd;
        const os = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
        const crossing = (Math.PI - Math.acos(zeta)) / wd;
        st.hist.push({ t: s.t, Mx });
        while (st.hist.length && st.hist[0].t <= s.t - halfPeriod - 1e-9) st.hist.shift();
        const past = x > tol;
        if (!past) {
          st.loadedFor = 0;
          st.free = 0;
          st.armed = false;
          st.ret = 0;
          continue;
        }
        // the floor's largest possible moment on the chain
        let cap = 0;
        const cols: Collider[] = [...rag.colliders, ...(rag.self?.arms ?? [])].filter((c) => chain.includes(c.segment)).map((c) => c.collider);
        for (const c1 of cols)
          w.contactPairsWith(c1, (c2) => {
            if (c2.parent()?.handle !== floor) return;
            const mu = Math.max(c1.friction(), c2.friction(), c1.friction() * c2.friction());
            w.contactPair(c1, c2, (m, flipped) => {
              const s1 = flipped ? c2 : c1;
              const s2 = flipped ? c1 : c2;
              const p1 = { p: vc(s1.translation()), q: { ...s1.rotation() } };
              const p2 = { p: vc(s2.translation()), q: { ...s2.rotation() } };
              const Jm = solvedImpulses(m, p1, p2);
              const pts: { p: Vec3; N: number }[] = [];
              for (let i = 0; i < m.numContacts(); i++) if (Jm[i] > 0) pts.push({ p: add(p1.p, qRot(p1.q, vc(m.localContactPoint1(i)!))), N: Jm[i] / dt });
              const Ns = pts.reduce((acc, p) => acc + p.N, 0);
              if (!Ns) return;
              const centre = scale(pts.reduce((acc, p) => add(acc, scale(p.p, p.N)), v3()), 1 / Ns);
              for (const p of pts) cap += p.N * (len(sub(p.p, Jw)) * Math.sqrt(1 + mu * mu) + mu * len(sub(p.p, centre)));
            });
          });
        const pinned = gl > 0 && cap >= b.k * gl * tol;
        if (pinned || st.loadedFor > 0) st.loadedFor += dt;
        if (pinned) {
          st.free = 0;
          st.ret = 0;
          st.armed = true;
          st.retBound = crossing + dt * s.def.solver.substeps;
          st.retFrom = s.t;
          st.rec.pinnedS += dt;
          const Mw = Math.max(0, ...st.hist.map((h) => h.Mx));
          // the load's entry transient (an impact, or the limb's own swing into it) is not a static deflection
          if (st.loadedFor < halfPeriod) st.rec.transient += dt;
          else if (Mw >= E.maxTorqueNm) st.rec.capped++;
          else {
            const over = (x - ((1 + os) * Mw) / b.k) * DEG;
            if (over > st.rec.overBoundDeg) [st.rec.overBoundDeg, st.rec.overBoundAt] = [over, s.t];
          }
        } else {
          st.free += dt;
          st.rec.freeRunS = Math.max(st.rec.freeRunS, st.free);
          if (st.armed) {
            st.ret += dt;
            if (st.ret - st.retBound > st.rec.returnOverS) Object.assign(st.rec, { returnOverS: st.ret - st.retBound, returnS: st.ret, returnBoundS: st.retBound, returnAt: st.retFrom });
          }
        }
      }
    }
  };
  return { substep, records: () => [...joints.values()].map((x) => x.rec) };
}
