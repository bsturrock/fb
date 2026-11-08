// Plan 10f (F9): contact observation, moved out of simulation.ts: after each solve, the contact manifolds, each
// player's grounded state (ragdoll floor contact, suspension probe or legacy support region), the classified player
// contacts, the closest gaps between player pairs, and the contact episodes with their per-tick classes.
import type { PlayerId } from './contracts';
import { isGround, pairKey } from './contracts';
import { observePlayerContacts, type ClassifyInput } from './contact';
import { anchorErrors, hingeAngles } from './ragdoll';
import { v3, vc, round, rv, len, add, qRot } from './vec';
import { updateProbe1, type SupportHost } from './support-runtime';
import type { Simulation } from './simulation';

/** What contact observation reads and writes on the simulation. */
export type ContactHost = SupportHost &
  Pick<
    Simulation,
    | 'activeBodies'
    | 'activeColliders'
    | 'contactObs'
    | 'contacts'
    | 'def'
    | 'emit'
    | 'episodes'
    | 'minPairGap'
    | 'pairClosest'
    | 'pairGap'
    | 'physics'
    | 'players'
    | 'poseOf'
    | 'steps'
    | 't'
    | 'tickContactClasses'
  >;

/** Read contacts, support, classification and gaps after a solve. */
export function observeContacts(host: ContactHost, initial: boolean): void {
  host.contacts = host.physics.collectContacts();
  for (const pl of host.players) {
    if (pl.rag) {
      // ragdoll: grounded = any solved segment-floor manifold (observation only; no support capability; plan 10c: the
      // floor only, not an obstacle)
      let g = false;
      let pen = 0;
      for (const c of host.contacts) {
        const own = c.a.playerId === pl.id ? c.a : c.b.playerId === pl.id ? c.b : null;
        const other = own === c.a ? c.b : c.a;
        if (!own || !isGround(other)) continue;
        g = true;
        for (const p of c.points) pen = Math.max(pen, -p.dist);
      }
      if (!initial && g !== pl.grounded) host.emit('grounded', pl.id, { grounded: g, representation: 'ragdoll' });
      pl.grounded = g;
      pl.supportPoint = null;
      if (pl.ragStats && !initial) {
        const ae = anchorErrors(pl.rag);
        pl.ragStats.maxAnchorErrM = Math.max(pl.ragStats.maxAnchorErrM, ...Object.values(ae));
        pl.ragStats.maxFloorPenM = Math.max(pl.ragStats.maxFloorPenM, pen);
        const hd = hingeAngles(pl.rag);
        for (const j of pl.rag.joints) {
          if (!j.limitsRad) continue;
          const lo = (j.limitsRad[0] * 180) / Math.PI;
          const hi = (j.limitsRad[1] * 180) / Math.PI;
          if (hd[j.id] - hi > pl.ragStats.maxHingeOverDeg) {
            pl.ragStats.maxHingeOverDeg = hd[j.id] - hi;
            pl.ragStats.hingeOverJoint = j.id;
          }
          if (lo - hd[j.id] > pl.ragStats.maxHingeReverseDeg) {
            pl.ragStats.maxHingeReverseDeg = lo - hd[j.id];
            pl.ragStats.hingeReverseJoint = j.id;
          }
        }
        for (const b of host.activeBodies(pl)) pl.ragStats.maxSpeed = Math.max(pl.ragStats.maxSpeed, len(vc(b.linvel())));
      }
      continue;
    }
    if (pl.sus) {
      // plan 06a: support-eligible ground is the classified probe, never the capsule manifold or a drawn foot
      const before = pl.sus.probe;
      updateProbe1(host, pl, initial);
      const pr = pl.sus.probe;
      if (!initial && pr.valid !== pl.grounded) host.emit('grounded', pl.id, { grounded: pr.valid, probe: pr.status, heightM: round(pr.heightM, 4), surface: pr.surface });
      if (!initial && pr.status !== before.status) host.emit('supportProbe', pl.id, { from: before.status, to: pr.status, heightM: round(pr.heightM, 4), normalUpDot: round(pr.normalUpDot, 4), surface: pr.surface, mode: pl.controlMode });
      pl.grounded = pr.valid;
      // support point: the turf point below the body-axis point at probe depth (as applied by the suspension)
      const ax = pr.valid ? add(vc(pl.proxy.body.translation()), qRot({ ...pl.proxy.body.rotation() }, v3(0, -pr.heightM, 0))) : null;
      pl.supportPoint = ax ? v3(ax.x, pr.groundY, ax.z) : null;
      let bot = false;
      for (const c of host.contacts) if ((c.a.key === 'supportGuard' && c.a.playerId === pl.id && c.b.playerId === null) || (c.b.key === 'supportGuard' && c.b.playerId === pl.id && c.a.playerId === null)) bot = true;
      if (!initial && bot !== pl.sus.bottomed) host.emit('supportGuard', pl.id, { contact: bot, mode: pl.controlMode, heightM: round(pr.heightM, 4) });
      pl.sus.bottomed = bot;
      // Collapse: the body has come down onto its bump stop on static ground with no valid support below it (invalid
      // surface or normal, obstructed): a loss of support, queued for the next controlled boundary like an envelope
      // loss. A landing re-acquires the probe within travel before the guard can touch, so it never triggers host.
      if (!initial && bot && !pr.valid && pl.controlMode === 'supported' && !pl.balance.pendingLoss) {
        pl.balance.pendingLoss = true;
        pl.balance.lossT = host.t;
        host.emit('lossOfSupport', pl.id, { reason: 'unsupportedBottomOut', probe: pr.status, surface: pr.surface, heightM: Number.isFinite(pr.heightM) ? round(pr.heightM, 4) : null, step: host.steps });
      }
      continue;
    }
    const com = vc(pl.proxy.body.worldCom());
    const sc = host.physics.supportContact(pl.proxy.support, pl.proxy.supportShape, com);
    if (initial) {
      // Reset-time state: manifolds predate the initial placement, so use geometric clearance instead.
      sc.supporting = host.physics.supportClearance(pl.proxy.support, pl.proxy.supportShape) <= host.def.solver.supportRegionTolM;
    }
    if (!initial && sc.supporting !== pl.grounded) {
      host.emit('grounded', pl.id, { grounded: sc.supporting, localY: sc.localY, normalUpDot: sc.normalUpDot });
    }
    pl.grounded = sc.supporting;
    pl.supportPoint = sc.pointWorld;
  }
  const who: Record<PlayerId, ClassifyInput> = {};
  for (const pl of host.players) {
    who[pl.id] = { pose: host.poseOf(pl), body: pl.body, selectedShoulder: pl.setup.selectedShoulder };
  }
  host.contactObs = observePlayerContacts(host.contacts, who);
  // closest surfaces between every player pair
  for (let i = 0; i < host.players.length; i++)
    for (let j = i + 1; j < host.players.length; j++) {
      const A = host.players[i];
      const B = host.players[j];
      const cl = host.physics.closestBetween(host.activeColliders(A), host.activeColliders(B));
      const k = pairKey(A.id, B.id);
      if (cl) {
        host.pairGap[k] = cl.distance;
        host.pairClosest[k] = { gap: cl.distance, points: { [A.id]: cl.pointA, [B.id]: cl.pointB } };
        if (!initial) host.minPairGap = Math.min(host.minPairGap, cl.distance);
      } else {
        host.pairGap[k] = 50;
        delete host.pairClosest[k];
      }
    }
  if (!initial) updateEpisodes(host);
}

export function updateEpisodes(host: ContactHost): void {
  const active = new Set<string>();
  for (const pl of host.players) {
    for (const o of host.contactObs[pl.id] ?? []) {
      const k = pairKey(pl.id, o.other);
      active.add(k);
      let ep = host.episodes.get(k);
      if (!ep) {
        ep = { since: host.t, seen: new Set() };
        host.episodes.set(k, ep);
        host.emit('contactBegin', pl.id, { other: o.other, own: o.ownClass, otherClass: o.otherClass, point: rv(o.pointWorld) });
      }
      const label = `${o.ownClass}>${o.otherClass}`;
      (host.tickContactClasses[pl.id] ??= new Set()).add(label);
      const sk = `${pl.id}:${label}`;
      if (!ep.seen.has(sk)) {
        ep.seen.add(sk);
        host.emit('contactRegion', pl.id, {
          other: o.other,
          own: o.ownClass,
          otherClass: o.otherClass,
          point: rv(o.pointWorld),
          impulse: round(o.impulse, 3),
        });
        if (o.ownClass === 'head') {
          host.emit('techniqueFailure', pl.id, { kind: 'headContact', other: o.other, otherClass: o.otherClass });
        }
      }
    }
  }
  for (const [k, ep] of host.episodes) {
    if (!active.has(k)) {
      host.emit('contactEnd', undefined, { pair: k, durationS: round(host.t - ep.since, 4) });
      host.episodes.delete(k);
    }
  }
}
