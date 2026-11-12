// Plan 10f (F9): the simulation's evidence output, moved out of simulation.ts: the per-tick trace row, the fixture
// export, the joint-limit report and the summary. Read-only: nothing here changes simulation state but the trace array.
import type { ArmSide, PlayerId } from './contracts';
import { rapierVersion } from './physics';
import { ARM_G2, SCHEMA_VERSION, type BodyProfile } from './profiles';
import { debugExport } from './debug';
import { footTrace } from './footwork';
import { anchorErrors } from './ragdoll';
import { playbackLabel, runClipProfileExport } from './run-clip';
import { ruleProfileExport } from './rules';
import { round, rv, yawOf, horiz, len, upOf, dot, clamp, deg } from './vec';
import type { Simulation, PlayerRuntime, PlayerTraceRow, TraceRow } from './simulation';

/** What the evidence output reads from the simulation. */
export type EvidenceHost = Pick<
  Simulation,
  | 'arms'
  | 'balanceProfile'
  | 'balanceState'
  | 'balanced'
  | 'bulk'
  | 'byId'
  | 'clipFlight'
  | 'coreBody'
  | 'def'
  | 'events'
  | 'fall'
  | 'heightModels'
  | 'minPairGap'
  | 'opts'
  | 'physics'
  | 'players'
  | 'prepDrop'
  | 'result'
  | 'rules'
  | 'stop'
  | 'supportProfile'
  | 'suspension'
  | 't'
  | 'tick'
  | 'tickContactClasses'
  | 'trace'
>;

// ------------------------------------------------------------------ trace row
export function recordTrace(host: EvidenceHost): void {
  const players: Record<PlayerId, PlayerTraceRow> = {};
  for (const pl of host.players) {
    const b = host.coreBody(pl);
    const k = host.bulk(pl);
    const d = pl.applied;
    players[pl.id] = {
      p: rv(b.translation(), 5),
      com: rv(k.com, 5),
      v: rv(k.v, 5),
      w: rv(k.w, 5),
      yaw: round(yawOf(b.rotation()), 5),
      drive: rv(d.drive, 3),
      cap: round(d.driveCap, 3),
      req: [round(d.requestedVelocity.x, 4), round(d.requestedVelocity.z, 4)],
      yawT: round(d.yawTorque, 3),
      g: pl.grounded ? 1 : 0,
      c: [...(host.tickContactClasses[pl.id] ?? [])],
      ph: (pl.intent.debug?.phase as string | undefined) ?? undefined,
      mode: pl.controlMode,
    };
    if (host.balanced)
      players[pl.id].lean = {
        deg: round(deg(pl.balance.theta), 4),
        rate: round(pl.balance.outwardRate, 4),
        proj: round(deg(pl.balance.projected), 4),
        tauB: round(len(host.balanceState(pl).actualBalanceTorqueNm), 3),
        tauReq: round(len(pl.applied.balanceRequested), 3),
        s: round(pl.applied.leanScale, 4),
        cnt: pl.balance.counter,
        post: round(deg(Math.acos(clamp(pl.balance.desiredUp.y, -1, 1))), 4),
        dev: round(deg(Math.acos(clamp(dot(upOf(b.rotation()), pl.balance.desiredUp), -1, 1))), 4),
      };
    if (pl.rag) {
      const ae = anchorErrors(pl.rag);
      players[pl.id].rep = 'ragdoll';
      players[pl.id].jsep = round(Math.max(...Object.values(ae)), 5);
      players[pl.id].hinge = Object.fromEntries(Object.entries(pl.pose?.hingeDeg ?? {}).map(([kk, vv]) => [kk, round(vv, 2)]));
    }
    if (pl.fall) {
      const f = pl.fall;
      players[pl.id].fall = {
        e: round(f.effort, 3),
        l: [f.arms.left.task, f.arms.left.brace],
        r: [f.arms.right.task, f.arms.right.brace],
        W: round(f.stats.positiveWorkJ, 3),
        Wn: round(f.stats.negativeWorkJ, 3),
        P: round(f.applied.reduce((s, a) => s + Math.max(0, a.entry.realizedW), 0), 2),
        T: Object.fromEntries(f.applied.map((a) => [a.entry.joint, round(a.entry.appliedNm, 2)])),
      };
    }
    if (pl.rag?.envelope) players[pl.id].lim = round(Math.max(0, ...pl.rag.envelope.map((e) => e.maxOverDeg)), 2);
    if (pl.feet && !pl.rag) players[pl.id].ft = footTrace(pl.feet);
    if (pl.loco && !pl.rag) players[pl.id].loco = { m: pl.loco.mode, why: pl.loco.reason, p: round(pl.loco.prepW, 3), c: round(pl.loco.contactW, 3), s: round(pl.loco.swing, 3), d: round(host.prepDrop(pl), 4) };
    if (pl.run && host.def.runClips && !pl.rag) {
      const st = pl.run;
      players[pl.id].run = {
        clip: playbackLabel(st, host.def.runClips),
        u: round(st.u, 5),
        w: round(st.w, 4),
        wt: round(st.wTarget, 4),
        r: round(st.rate, 4),
        b: round(st.blend, 4),
        v: round(st.speed, 4),
        ...(st.stride !== undefined ? { s: round(st.stride, 4) } : {}),
        res: Object.fromEntries(Object.entries(pl.pose?.targetResidualM ?? {}).map(([kk, vv]) => [kk, round(vv, 4)])),
      };
    }
    if (pl.sus && !pl.rag) {
      const u = pl.sus;
      const pr = u.probe;
      players[pl.id].sup = {
        h: Number.isFinite(pr.heightM) ? round(pr.heightM, 5) : null,
        ht: round(u.targetM, 5),
        vt: round(u.targetVMps, 4),
        at: round(u.targetAMps2, 3),
        req: round(u.requestM, 4),
        run: Number.isFinite(u.runM) ? round(u.runM, 5) : null,
        ...(host.suspension?.brakingStance ? { bk: round(u.brakeB, 4), bkw: Number.isFinite(u.brakeWant) ? round(u.brakeWant, 4) : null } : {}),
        s: round(u.bobScale, 4),
        F: round(u.appliedN, 2),
        Fc: round(u.commandedN, 2),
        Fp: round(u.pivotN, 2),
        Fm: round(u.comN, 2),
        T: [round(u.tipTorqueNm.x, 2), round(u.tipTorqueNm.y, 2), round(u.tipTorqueNm.z, 2)],
        sat: u.saturated === 'none' ? 0 : u.saturated === 'zero' ? 1 : 2,
        a: round(u.authority, 4),
        ok: pr.valid ? 1 : 0,
        st: pr.status,
        lev: round(u.leverM, 4),
        W: round(u.workJ, 3),
        J: round(u.impulseNs, 4),
        P: round(u.powerW, 2),
        bot: u.bottomed ? 1 : 0,
        fl: host.clipFlight(pl) ? 1 : 0,
      };
      if (Number.isFinite(u.approachLimitMps)) players[pl.id].sup!.vl = round(u.approachLimitMps, 4);
    }
    const ao = host.arms?.obs(pl.id);
    if (ao) {
      const arm: NonNullable<PlayerTraceRow['arm']> = {};
      for (const side of ['left', 'right'] as ArmSide[]) {
        const o = ao[side];
        if (!o || !o.enabled) continue;
        const f = host.arms!.lastForce.get(`${pl.id}:${side}`);
        arm[side] = {
          ph: o.phase,
          id: o.gripId ?? o.clampContactId,
          F: round(f?.actual ?? 0, 2),
          N: round(f?.normalActual ?? 0, 2),
          Ft: round(f?.tangentActual ?? 0, 2),
          palm: rv(o.palmContactWorld, 4),
          ok: o.poseValid ? 1 : 0,
        };
      }
      players[pl.id].arm = arm;
      players[pl.id].wrap = host.arms!.wrap.get(pl.id)?.status;
    }
  }
  const row: TraceRow = { tick: host.tick, t: round(host.t, 5), players };
  if (host.rules?.lastRow) row.rule = host.rules.lastRow;
  host.trace.push(row);
}

/** Plan 11: the measured trunk and hand tip are read only under the self-clearance profile; other exports omit them. */
function withoutSelfClearance(b: BodyProfile): BodyProfile {
  if (!b.measured || (b.measured.trunkHull === undefined && b.measured.handTipM === undefined)) return b;
  const { trunkHull: _t, handTipM: _h, ...measured } = b.measured;
  return { ...b, measured };
}

export function fixtureExport(host: EvidenceHost): Record<string, unknown> {
  const def = host.def;
  const bodyProfiles: Record<string, BodyProfile> = {};
  for (const p of def.players) bodyProfiles[p.body.id] = def.selfClearance ? p.body : withoutSelfClearance(p.body);
  return {
    schemaVersion: SCHEMA_VERSION,
    fixtureId: def.id,
    gate: def.gate,
    milestone: def.milestone,
    title: def.title,
    notes: def.notes,
    engine: { name: '@dimforge/rapier3d-compat', version: rapierVersion() },
    profileIds: {
      body: Object.fromEntries(def.players.map((p) => [p.id, p.body.id])),
      motor: def.motor.id,
      solver: def.solver.id,
      stance: def.stance.id,
      arm: host.arms ? (def.armProfile ?? ARM_G2).id : undefined,
      balance: host.balanced ? host.balanceProfile.id : undefined,
      ragdoll: def.ragdoll?.id,
      rule: def.rules?.id,
      runClips: def.runClips?.id,
      support: host.supportProfile.id,
      footwork: def.footwork?.id,
      locomotion: def.locomotion?.id,
      carry: def.carry?.id,
      fallResponse: def.fallResponse?.id,
      selfClearance: def.selfClearance?.id,
      jointRange: def.jointRange?.id,
      legGuard: def.legGuard?.id,
      armClearance: def.armClearance?.id,
    },
    profiles: {
      body: bodyProfiles,
      motor: def.motor,
      solver: def.solver,
      stance: def.stance,
      arm: host.arms ? (def.armProfile ?? ARM_G2) : undefined,
      balance: host.balanced ? host.balanceProfile : undefined,
      ragdoll: def.ragdoll,
      rule: def.rules ? ruleProfileExport(def.rules) : undefined,
      runClips: def.runClips ? runClipProfileExport(def.runClips) : undefined,
      support: host.supportProfile,
      footwork: def.footwork,
      locomotion: def.locomotion,
      carry: def.carry,
      fallResponse: def.fallResponse,
      selfClearance: def.selfClearance,
      jointRange: def.jointRange,
      legGuard: def.legGuard,
      armClearance: def.armClearance,
      supportHeights: host.heightModels ?? undefined,
    },
    diagnostics: def.diagnostics,
    obstacles: def.obstacles,
    handoffs: Object.fromEntries(host.players.filter((p) => p.handoff).map((p) => [p.id, p.handoff])),
    ...(def.ragdoll?.envelope
      ? {
          fallEffort: Object.fromEntries(host.players.filter((p) => p.fall).map((p) => [p.id, host.fall!.report(p.fall!)])),
          jointLimits: Object.fromEntries(host.players.filter((p) => p.rag).map((p) => [p.id, limitReportOf(host, p)])),
        }
      : {}),
    ruleEnding: host.rules?.ending ?? null,
    stop: host.stop,
    ...(debugExport(host.opts.debug) ? { debug: debugExport(host.opts.debug) } : {}),
    timing: {
      outerTickS: def.solver.outerTickS,
      substeps: def.solver.substeps,
      physicsDtS: host.physics.dt,
      durationS: def.durationS,
      durationTicks: Math.round(def.durationS / def.solver.outerTickS),
      settleS: def.settleS,
    },
    area: def.area,
    players: def.players.map((p) => ({
      id: p.id,
      role: p.role,
      bodyProfileId: p.body.id,
      motorProfileId: (p.motor ?? def.motor).id,
      selectedShoulder: p.selectedShoulder,
      arms: p.arms,
      initial: p.initial,
      controller: host.byId.get(p.id)?.controller.exportParams(def.solver.outerTickS),
      measuredMass: host.byId.get(p.id)?.mass,
    })),
    randomSeed: null,
  };
}

/** Plan 09: measured limit error per joint since the handoff (native hinges and soft envelopes), with its mode. */
export function limitReportOf(host: EvidenceHost, pl: PlayerRuntime): Record<string, unknown> {
  const rs = pl.ragStats;
  return {
    hinges: { mode: 'native', maxOverDeg: round(rs?.maxHingeOverDeg ?? 0, 3), overJoint: rs?.hingeOverJoint ?? null, maxReverseDeg: round(rs?.maxHingeReverseDeg ?? 0, 3), reverseJoint: rs?.hingeReverseJoint ?? null },
    envelope: {
      mode: host.def.ragdoll?.envelope?.mode ?? null,
      profile: host.def.ragdoll?.envelope?.id ?? null,
      // plan 10c (C7): the two measures differ in their twist term; twist overshoot is the scaled one
      measures: {
        startOutsideDeg: 'range slack at the handoff: swing excess, or twist excess about the limb (unscaled)',
        maxOverDeg: 'excursion past the range in force: swing excess, or twist excess scaled by cos(swing / 2)',
        maxNominalOverDeg: 'excursion past the nominal range, measured as maxOverDeg',
      },
      joints: (pl.rag?.envelope ?? []).map((e) => ({
        joint: e.jointId,
        startOutsideDeg: round(e.startOutsideDeg, 3),
        maxOverDeg: round(e.maxOverDeg, 3),
        maxNominalOverDeg: round(e.maxNominalOverDeg, 3),
        maxOverRunS: round(e.maxOverRunS, 4),
        passivePositiveJ: round(e.passivePositiveJ, 4),
        passiveNegativeJ: round(e.passiveNegativeJ, 4),
      })),
    },
  };
}

export function summaryOf(host: EvidenceHost): Record<string, unknown> {
  return {
    fixtureId: host.def.id,
    result: host.result,
    ticks: host.tick,
    t: round(host.t, 4),
    minPairGap: Number.isFinite(host.minPairGap) ? round(host.minPairGap, 4) : null,
    events: host.events.filter((e) => e.type !== 'grounded').length,
    players: Object.fromEntries(
      host.players.map((pl) => {
        const b = host.coreBody(pl);
        const k = host.bulk(pl);
        return [pl.id, { p: rv(b.translation(), 3), v: rv(k.v, 3), speed: round(len(horiz(k.v)), 3), rep: pl.representation }];
      }),
    ),
  };
}
