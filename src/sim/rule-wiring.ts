// Plan 10f (F9): the rules wiring, moved out of simulation.ts: one solved substep's rule frame (runner state, contacts,
// retention relationships with their fresh forces) fed to the rule observer; on an ending, the settle window starts.
import { ARM_G2 } from './profiles';
import { type RetentionObs } from './rules';
import type { ArmSide } from './contracts';
import { v3, vc, len } from './vec';
import type { Simulation } from './simulation';

/** What the rules wiring reads from the simulation. */
export type RuleWiringHost = Pick<
  Simulation,
  | 'arms'
  | 'balanced'
  | 'balanceProfile'
  | 'bulk'
  | 'byId'
  | 'contactObs'
  | 'contacts'
  | 'coreBody'
  | 'def'
  | 'physics'
  | 'players'
  | 'rules'
  | 'settleUntil'
  | 'stampTick'
  | 'steps'
  | 't'
>;

/** Feed the rule observer one solved substep; on an ending, stop tackle actions and start the settle window. */
export function observeRules(host: RuleWiringHost): void {
  const R = host.rules!;
  const pl = host.byId.get(R.runnerId);
  if (!pl) return;
  const core = host.coreBody(pl);
  const retention: RetentionObs[] = [];
  if (host.arms) {
    for (const g of host.arms.grips.values()) {
      if (g.targetId !== pl.id) continue;
      const e = host.arms.lastForce.get(`${g.ownerId}:${g.arm}`);
      const fresh = e && e.id === g.id && e.step === host.steps - 1;
      retention.push({ id: g.id, owner: g.ownerId, kind: 'grip', forceOnRunner: fresh ? e!.forceOnTarget : v3(), loadN: fresh ? len(e!.forceOnTarget) : 0 });
    }
    for (const o of host.players) for (const side of ['left', 'right'] as ArmSide[]) {
      const c = host.arms.clampOf(o.id, side);
      if (!c || c.targetId !== pl.id) continue;
      const e = host.arms.lastForce.get(`${o.id}:${side}`);
      const fresh = e && e.id === c.id && e.step === host.steps - 1;
      retention.push({ id: c.id, owner: o.id, kind: 'clamp', forceOnRunner: fresh ? e!.forceOnTarget : v3(), loadN: c.normalForceN });
    }
  }
  const opp = (host.contactObs[pl.id] ?? []).filter((o) => host.byId.get(o.other)?.setup.role !== pl.setup.role);
  const end = R.observe({
    t: host.t,
    tick: host.stampTick,
    step: host.steps,
    dt: host.physics.dt,
    runnerId: pl.id,
    representation: pl.representation,
    validHandoff: !!pl.handoff?.accepted,
    controlMode: pl.controlMode,
    grounded: pl.grounded,
    balanced: !host.balanced || pl.balance.projected < host.balanceProfile.minLeanRad,
    corePose: { p: vc(core.translation()), q: { ...core.rotation() } },
    pose: pl.pose,
    velocity: host.bulk(pl).v,
    request: pl.intent.locomotion.desiredVelocityWorld,
    contacts: host.contacts,
    opponentContacts: opp,
    retention,
    minClampNormalN: (host.def.armProfile ?? ARM_G2).wrap.minClampNormalN,
  });
  if (end && host.settleUntil === null) {
    host.settleUntil = host.t + R.profile.settleS;
    host.arms?.endPlay();
  }
}
