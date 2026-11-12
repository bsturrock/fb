// Plan 10f (F9): representation conversions, moved out of simulation.ts: one batch of proxy-to-ragdoll handoffs at a
// controlled boundary (candidate build and validation, the transfer and its audit, the handoff record and events).
import type { PlayerId } from './contracts';
import { newLocoState } from './locomotion';
import { buildCandidate, externalFromColliders, externalFromRagdoll, initEnvelope, ragdollPose, removeRagdoll, switchToRagdoll, validateCandidate, type CandidateEdit, type CandidateReport, type ExternalShape } from './ragdoll';
import { vc, round } from './vec';
import type { Simulation, HandoffRecord, PlayerRuntime } from './simulation';

/** What a conversion batch reads and writes on the simulation. */
export type ConversionHost = Pick<
  Simulation,
  | 'activeColliders'
  | 'arms'
  | 'bodyCount'
  | 'byId'
  | 'carrySide'
  | 'def'
  | 'emit'
  | 'fall'
  | 'invalidTransfer'
  | 'obstacleColliders'
  | 'physics'
  | 'players'
  | 'rules'
  | 'steps'
  | 't'
>;

// ------------------------------------------------------------------ Gate 4: representation transition
/**
 * One boundary operation for every player converting now: build all candidates (disabled), validate them together
 * (other converting players are checked as candidates, everyone else as active colliders), then switch the
 * accepted ones atomically and remap their relationships once. Rejected candidates are removed and the player
 * continues as the Gate 3 falling proxy with a recorded handoffRejected reason.
 */
export function convertPlayers(host: ConversionHost, list: { pl: PlayerRuntime; reason: HandoffRecord['reason']; edit?: CandidateEdit }[]): void {
  const R = host.def.ragdoll!;
  const cands = list.map((c) => ({
    ...c,
    rag: buildCandidate(host.physics, c.pl.id, c.pl.body, c.pl.pose!, R, c.pl.proxy.body.mass(), c.edit, host.def.selfClearance, host.def.jointRange),
    report: null as CandidateReport | null,
  }));
  let accepted = [...cands];
  for (let pass = 0; pass < cands.length + 1; pass++) {
    for (const c of accepted) {
      const ext: ExternalShape[] = externalFromColliders([], () => '', host.physics.floorCollider);
      ext.push(...externalFromColliders(host.obstacleColliders, (cc) => host.physics.tags.get(cc.handle)?.key ?? 'obstacle'));
      for (const o of host.players) {
        if (o === c.pl) continue;
        const oc = accepted.find((x) => x.pl === o);
        if (oc) ext.push(...externalFromRagdoll(oc.rag));
        else {
          ext.push(...externalFromColliders(host.activeColliders(o), (cc) => `${o.id}:${host.physics.tags.get(cc.handle)?.key ?? '?'}`));
          // contact motion experiment: another supported player's physical legs are bodies the candidate must clear
          // (those in the solve: a leg kept off is inside a body the solver never sees it against)
          if (o.legs?.enabled) {
            const on = o.legs.colliders.filter((_, i) => o.legs!.on[i]);
            ext.push(...externalFromColliders(on, (cc) => `${o.id}:${host.physics.tags.get(cc.handle)?.key ?? '?'}`));
          }
        }
      }
      const cp: Parameters<typeof validateCandidate>[3] = {};
      for (const pc of c.pl.proxy.colliders) {
        const t = host.physics.tags.get(pc.handle);
        if (t && (t.region === 'torso' || t.region === 'pelvis' || t.region === 'head')) cp[t.region] = { shape: pc.shape, pose: { p: vc(pc.translation()), q: { ...pc.rotation() } } };
      }
      c.report = validateCandidate(c.rag, c.pl.pose!, ext, cp, c.pl.proxy.body.mass());
    }
    const still = accepted.filter((c) => c.report!.ok);
    if (still.length === accepted.length) break;
    accepted = still;
  }
  for (const c of cands) {
    if (accepted.includes(c)) continue;
    removeRagdoll(host.physics, c.rag);
    const rep = c.report!;
    c.pl.handoff = { accepted: false, outcome: 'rejected', t: host.t, step: host.steps, reason: c.reason, report: rep };
    if (host.rules && c.pl.id === host.rules.runnerId) host.rules.disable('invalidHandoff', { reasons: rep.reasons.join(',') });
    host.emit('handoffRejected', c.pl.id, {
      reasons: rep.reasons.join(','),
      trigger: c.reason,
      edit: c.edit ?? null,
      maxAnchorErrM: round(rep.maxAnchorErrM, 5),
      maxNewExternalPenetrationM: round(rep.maxNewExternalPenetrationM, 5),
      worstExternal: rep.worstExternal,
      proxyCoreDepthM: round(rep.proxyCoreDepthM, 5),
      floorPenetrationM: round(rep.floorPenetrationM, 5),
      hingeDeg: Object.fromEntries(Object.entries(rep.hingeDeg).map(([k, v]) => [k, round(v, 2)])),
      maxLandmarkErrM: round(rep.maxLandmarkErrM, 5),
      fallback: 'fallingProxy',
    });
  }
  const captured = host.arms?.captureRelations(accepted.map((c) => c.pl.id)) ?? new Map();
  const switched: PlayerId[] = [];
  for (const c of accepted) {
    const pl = c.pl;
    const before = host.bodyCount(pl.id);
    const oldHandle = pl.proxy.body.handle;
    // contact motion experiment: the physical legs leave with the proxy body (removed with its colliders)
    pl.legs = undefined;
    const audit = switchToRagdoll(host.physics, pl.proxy.body, c.rag);
    pl.rag = c.rag;
    // plan 08: an accepted conversion ends the locomotion composition (a rejected one keeps it: falling already cleared it)
    if (pl.loco) {
      if (pl.loco.mode !== 'free') host.emit('locoMode', pl.id, { from: pl.loco.mode, to: 'free', reason: 'conversion' });
      pl.loco = newLocoState();
    }
    pl.representation = 'ragdoll';
    const after = host.bodyCount(pl.id);
    const proxyRemoved = !host.physics.world.bodies.contains(oldHandle) || !host.physics.world.getRigidBody(oldHandle)?.isEnabled();
    pl.handoff = { accepted: audit.ok, outcome: audit.ok ? 'accepted' : 'transferFailed', t: host.t, step: host.steps, reason: c.reason, report: c.report!, audit, activeBodies: { before, after, proxyRemoved } };
    pl.ragStats = { maxAnchorErrM: c.report!.maxAnchorErrM, maxFloorPenM: 0, maxSpeed: 0, maxHingeOverDeg: 0, hingeOverJoint: null, maxHingeReverseDeg: 0, hingeReverseJoint: null };
    switched.push(pl.id);
    host.emit('representation', pl.id, {
      from: 'proxy',
      to: 'ragdoll',
      trigger: c.reason,
      profile: host.def.ragdoll!.id,
      activeBodies: { before, after, proxyRemoved },
      audit: { ...audit, massDiffKg: round(audit.massDiffKg, 8), linearRelErr: round(audit.linearRelErr, 9), angularRelErr: round(audit.angularRelErr, 9) },
      candidate: {
        maxAnchorErrM: round(c.report!.maxAnchorErrM, 6),
        maxNewExternalPenetrationM: round(c.report!.maxNewExternalPenetrationM, 5),
        worstExternal: c.report!.worstExternal,
        floorPenetrationM: round(c.report!.floorPenetrationM, 5),
        maxLandmarkErrM: round(c.report!.maxLandmarkErrM, 6),
        hingeDeg: Object.fromEntries(Object.entries(c.report!.hingeDeg).map(([k, v]) => [k, round(v, 2)])),
        straightFallback: pl.pose?.straightFallback ?? [],
      },
    });
    if (!audit.ok) {
      // The proxy is already gone (the audit reads the switched engine state); the assembly remains as diagnostic
      // state. A failed transfer invalidates the trial's physical evidence: no referee completion can follow.
      host.invalidTransfer = { playerId: pl.id, reasons: audit.reasons, t: host.t };
      host.emit('handoffAuditFailure', pl.id, { reasons: audit.reasons.join(','), energyDeltaJ: audit.energyDeltaJ, energyGainLimitJ: audit.energyGainLimitJ, outcome: 'transferFailed' });
      host.rules?.disable('invalidTransfer', { playerId: pl.id, reasons: audit.reasons.join(',') });
    }
  }
  if (switched.length) {
    host.arms?.onRepresentationChange(switched, captured);
    for (const id of switched) {
      const pl = host.byId.get(id)!;
      pl.pose = ragdollPose(pl.rag!);
      // plan 09: the anatomical range starts with the ragdoll; the effort layer only after an accepted transfer
      initEnvelope(pl.rag!);
      if (host.fall && pl.handoff?.accepted) pl.fall = host.fall.begin(pl.id, pl.rag!, pl.setup.role, host.arms, host.carrySide(pl));
    }
  }
}
