// Plan 08 (L3): locomotion transitions and automatic tackle integration. The composed foot planner (start, brake, settle),
// the fitted idle and procedural walking arms, the per-player locomotion mode (free, preparation, contact, exit) and the
// transition audit. L2, HC and every earlier fixture keep their paths; each L3 fixture opts in under its own id.
import { afterEach, describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { add, dist, qRot, scale, sub, type Vec3 } from '../src/sim/vec';
import { pace, run, runSim } from './helpers';
import { SIDES, FIX, L3, each, modes, armProfile, ragOf, armLengthErr, count } from './transitions-shared';


// a long file of synchronous runs: let the runner's messages through between tests
afterEach(() => new Promise<void>((done) => setTimeout(done)));

describe('plan 08 pass 3: contact integration', () => {
  each(/^L3-F1-/, 'no shared stance reset: anchors held at entry stay, every target finite, whatever the phase', async (d) => {
    {
      const sim = await Simulation.create(d);
      const before: Record<string, Record<string, Vec3 | null>> = {};
      // plan 10b: the entries and the plants held across them, so the claim is not vacuous
      let entries = 0;
      let kept = 0;
      while (!sim.done) {
        for (const pl of sim.players) {
          if (!pl.feet || !pl.pose) continue;
          for (const v of Object.values(pl.pose.jointLandmarksWorld)) expect(Number.isFinite(v.x + v.y + v.z), d.id).toBe(true);
          before[pl.id] = { left: pl.feet.feet.left.heelW, right: pl.feet.feet.right.heelW };
        }
        const was = sim.players.map((p) => p.loco?.mode);
        sim.stepTick();
        await pace();
        sim.players.forEach((pl, i) => {
          if (pl.rag || was[i] === pl.loco?.mode || pl.loco?.mode !== 'contact') return;
          entries++;
          for (const s of SIDES) {
            const h0 = before[pl.id]?.[s];
            const f = pl.feet!.feet[s];
            // a plant held across the entry keeps its anchor; the mode itself moves nothing
            if (h0 && f.mode === 'planted' && f.heelW && dist(h0, f.heelW) > 1e-9) expect(f.plantedAtS, `${d.id} ${pl.id} ${s}`).toBeGreaterThan(sim.t - 1 / 60 - 1e-6);
            else if (h0 && f.mode === 'planted') kept++;
          }
        });
      }
      expect(entries, `${d.id} contact entries`).toBeGreaterThan(0);
      expect(kept, `${d.id} plants held across an entry`).toBeGreaterThan(0);
      sim.dispose();
    }
  });

  it('L3-F2: preparation unwinds; no contact, no grip, the run carries on', async () => {
    for (const d of L3(/^L3-F2-/)) {
      const sim = await run(d);
      for (const id of ['R', 'D']) expect(modes(sim, id).map((m) => m.to), d.id).toEqual(['prep', 'free']);
      expect(modes(sim, 'R')[1].reason).toBe('unwound');
      expect(sim.events.filter((e) => e.type === 'contactBegin' || e.type === 'gripBegin' || e.type === 'clampBegin')).toEqual([]);
      const v = sim.players.find((p) => p.id === 'R')!.proxy.body.linvel();
      expect(Math.hypot(v.x, v.z), d.id).toBeGreaterThan(3.5);
      sim.dispose();
    }
  }, 30000);

  it('L3-F3: the mode follows the first observed contact within a tick; the blend does not delay the body', async () => {
    for (const d of L3(/^L3-F3-/)) {
      const sim = await run(d);
      const c = sim.events.find((e) => e.type === 'contactBegin')!;
      const m = modes(sim, 'R').find((x) => x.to === 'contact')!;
      expect(Math.abs(m.t - c.t), d.id).toBeLessThanOrEqual(1 / 60 + 1e-6);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      sim.dispose();
    }
  }, 30000);

  it('L3-F4/F5: legs keep stepping in contact from the actual movement; tackles end as their copies do', async () => {
    for (const d of L3(/^L3-F4-(two|one)Arm|^L3-F5-/)) {
      const sim = await run(d);
      const entry = modes(sim, 'D').find((x) => x.to === 'contact')!;
      expect(sim.events.some((e) => e.type === 'footPlant' && e.t > entry.t), d.id).toBe(true);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      sim.dispose();
    }
  }, 30000);

  it('L3-F6: a stationary hold settles: no fall, no conversion, no marching', async () => {
    for (const d of L3(/^L3-F6-hold/)) {
      const sim = await run(d);
      expect(sim.players.every((p) => p.representation !== 'ragdoll' && p.controlMode === 'supported'), d.id).toBe(true);
      for (const id of ['R', 'D']) expect(sim.events.filter((e) => e.type === 'footPlant' && e.playerId === id && e.t > 3.5).length, d.id).toBeLessThanOrEqual(1);
      expect(modes(sim, 'R').map((m) => m.to), d.id).toEqual(['contact']);
      sim.dispose();
    }
  }, 30000);

  it('L3-F6/F7: a saturating load released in the hold or in the exit does not launch', async () => {
    for (const id of ['L3-F6-saturated', 'L3-F7-loadRelease']) {
      const sim = await Simulation.create(FIX(id));
      let y = 0;
      while (!sim.done) {
        sim.stepTick();
        await pace();
        for (const p of sim.players) if (!p.rag) y = Math.max(y, p.proxy.body.translation().y);
      }
      expect(y, id).toBeLessThan(0.91);
      expect(sim.players.every((p) => p.representation !== 'ragdoll'), id).toBe(true);
      sim.dispose();
    }
  }, 30000);

  it('L3-F7: contact clears from every run phase and side, the run resumes on the clip, no fall', async () => {
    for (const d of L3(/^L3-F7-(phase|mirror)/)) {
      const sim = await run(d);
      expect(modes(sim, 'R').map((m) => m.to), d.id).toEqual(['prep', 'contact', 'exit', 'free']);
      const R = sim.players.find((p) => p.id === 'R')!;
      expect(R.run!.w, d.id).toBeGreaterThan(0.9);
      expect(R.representation).toBe('proxy');
      const plants = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === 'R' && e.t > 1.1).map((e) => e.data!.side);
      expect(plants.length, d.id).toBeGreaterThan(3);
      for (let i = 1; i < plants.length; i++) expect(plants[i], d.id).not.toBe(plants[i - 1]);
      sim.dispose();
    }
  }, 60000);

  it('L3-F8: R is in exit when the second defender arrives: contact, exit, contact, exit, free, the second contact named recontact', async () => {
    const sim = await run(FIX('L3-F8-recontact'), { transitionAudit: true });
    const m = modes(sim, 'R');
    expect(m.map((x) => x.to)).toEqual(['prep', 'contact', 'exit', 'contact', 'exit', 'free']);
    expect(m.map((x) => x.reason)).toEqual(['closing', 'contact', 'cleared', 'recontact', 'cleared', 'resumed']);
    // really still exiting when it arrives, and from the other player
    expect(m[3].t).toBeGreaterThan(m[2].t + 1 / 60);
    const arrives = sim.events.find((e) => e.type === 'contactBegin' && e.playerId === 'R' && e.data!.other === 'D2')!;
    expect(Math.abs(arrives.t - m[3].t)).toBeLessThanOrEqual(1 / 60 + 1e-6);
    // hysteresis: each mode held, one resumption
    for (let i = 1; i < m.length; i++) expect(m[i].t - m[i - 1].t).toBeGreaterThan(0.02);
    expect(m.filter((x) => x.reason === 'resumed')).toHaveLength(1);
    // the audited boundary itself: feet, held arms and landmarks
    const at = sim.transitionDeltas.filter((x) => x.playerId === 'R' && Math.abs(x.t - m[3].t) <= 1 / 240 + 1e-9);
    expect(at.length).toBeGreaterThan(0);
    for (const x of at) expect(x.deltaM, `${x.t} ${x.landmark} ${x.from} > ${x.to}`).toBeLessThanOrEqual(0.01);
    sim.dispose();
  });

  each(/^L3-F9-lift-/, 'temporary airborne recovery: probe support lost in the named mode and regained, feet airborne, no support force in the air, no conversion', async (d) => {
    const mode = d.id.split('-').pop();
    let lost: { t: number; mode: string } | null = null;
    let back: number | null = null;
    let was = true;
    let bothAir = 0;
    let airN = 0;
    let backN = 0;
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        const R = s.byId.get('R')!;
        const ok = R.sus!.probe.valid;
        if (was && !ok && !lost) lost = { t: s.t, mode: R.loco!.mode };
        if (!was && ok && lost && back === null) back = s.t;
        if (lost && back === null) {
          if (R.feet!.feet.left.mode === 'airborne' && R.feet!.feet.right.mode === 'airborne') bothAir++;
          airN = Math.max(airN, R.sus!.appliedN);
        }
        if (back !== null) backN = Math.max(backN, R.sus!.appliedN);
        was = ok;
      },
    });
    await runSim(sim);
    const R = sim.byId.get('R')!;
    expect(lost, d.id).not.toBeNull();
    expect(lost!.mode, d.id).toBe(mode);
    expect(back, d.id).not.toBeNull();
    expect(bothAir, d.id).toBeGreaterThan(0);
    expect(airN, d.id).toBe(0);
    expect(backN, d.id).toBeGreaterThan(0);
    expect(sim.events.filter((e) => e.type === 'footPlant' && e.playerId === 'R' && e.t > back!).length, d.id).toBeGreaterThan(0);
    // temporary: nothing converted
    expect(count(sim, 'lossOfSupport', 'R'), d.id).toBe(0);
    expect(R.controlMode, d.id).toBe('supported');
    expect(R.representation, d.id).toBe('proxy');
    sim.dispose();
  });

  /** The irreversible fall of one player: its mode at the trigger, the accepted conversion and its audits, nothing supports it afterwards. */
  const fell = async (d: FixtureDef, id: string, mode: string | null, how: RegExp): Promise<Simulation> => {
    let before = '';
    let at: number | null = null;
    let supported = 0;
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        const P = s.byId.get(id)!;
        if (P.controlMode === 'falling' || P.rag) {
          at ??= s.t;
          if (P.sus && (P.sus.active || P.sus.appliedN !== 0)) supported++;
        } else before = P.loco!.mode;
      },
    });
    await runSim(sim);
    const P = sim.byId.get(id)!;
    expect(at, d.id).not.toBeNull();
    if (mode) expect(before, d.id).toBe(mode);
    expect(supported, d.id).toBe(0);
    expect(P.controlMode, d.id).toBe('falling');
    expect(P.representation, d.id).toBe('ragdoll');
    const rep = sim.events.filter((e) => e.type === 'representation' && e.playerId === id);
    expect(rep, d.id).toHaveLength(1);
    expect(String(rep[0].data!.trigger), d.id).toMatch(how);
    const cand = rep[0].data!.candidate as { maxAnchorErrM: number };
    const audit = rep[0].data!.audit as { ok: boolean };
    expect(cand.maxAnchorErrM, d.id).toBeLessThanOrEqual(ragOf(d).validation.anchorTolM);
    expect(audit.ok, d.id).toBe(true);
    expect(count(sim, 'handoffRejected'), d.id).toBe(0);
    expect(count(sim, 'handoffAuditFailure'), d.id).toBe(0);
    return sim;
  };

  each(/^L3-F9-convert-/, 'a labelled conversion in the named mode is an audited, irreversible fall', async (d) => {
    (await fell(d, 'R', d.id.split('-').pop()!, /diagnostic/)).dispose();
  });
  each(/^L3-F9-noProbe-/, 'loss of probe support in the named mode is an audited, irreversible fall', async (d) => {
    const sim = await fell(d, 'R', d.id.split('-').pop()!, /lossOfSupport/);
    expect(count(sim, 'lossOfSupport', 'R'), d.id).toBe(1);
    sim.dispose();
  });
  it('L3-F9-low: a conversion of the low runner in contact is an audited, irreversible fall', async () => {
    (await fell(FIX('L3-F9-low'), 'R', 'contact', /diagnostic/)).dispose();
  });
  each(/^L3-F9-defender/, 'the defender converts on the measured sign of its bob', async (d) => {
    const rising = d.id.endsWith('Rising');
    let vy = 0;
    let at: number | null = null;
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        const D = s.byId.get('D')!;
        if (D.rag) at ??= vy;
        else vy = D.proxy.body.linvel().y;
      },
    });
    await runSim(sim);
    const D = sim.byId.get('D')!;
    expect(at, d.id).not.toBeNull();
    expect(Math.sign(at!), d.id).toBe(rising ? 1 : -1);
    expect(D.handoff, d.id).not.toBeNull();
    expect(D.handoff!.reason, d.id).toBe('diagnostic');
    const rep = sim.events.find((e) => e.type === 'representation' && e.playerId === 'D')!;
    expect((rep.data!.audit as { ok: boolean }).ok, d.id).toBe(true);
    expect(count(sim, 'handoffRejected'), d.id).toBe(0);
    sim.dispose();
  });

  it('L3-F9 player below stays a support-budget regression', async () => {
    const sim = await run(FIX('L3-F9-playerBelow'));
    expect(count(sim, 'handoffRejected')).toBe(0);
    sim.dispose();
  });

  it('L3-F10: either or both convert with retention; no duplicated bodies', async () => {
    for (const d of L3(/^L3-F10-/)) {
      const sim = await run(d);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      expect(sim.players.filter((p) => p.representation === 'ragdoll').length, d.id).toBeGreaterThan(0);
      sim.dispose();
    }
  }, 60000);

  it('L3-F11: a genuine bad candidate is rejected with the safe fallback, no accepted conversion for that player', async () => {
    const sim = await run(FIX('L3-F11-invalid'));
    const r = sim.events.filter((e) => e.type === 'handoffRejected');
    expect(r).toHaveLength(1);
    expect(r[0].data!.reasons).toMatch(/jointAnchor/);
    expect(r[0].data!.fallback).toBe('fallingProxy');
    sim.dispose();
  });

  /** Deliberate faults for the negative controls: the shown elbow pushed out along the upper arm, the anchor moved on the target. */
  interface Tamper {
    stretchElbow?: number;
    anchorLocal?: Vec3;
  }
  /**
   * The held arms as the published pose shows them (plan 10b: the pose's landmarks, not the arm system's observation, so a
   * pose-side displacement fails): segments against the arm profile and every live hold's palm against its anchor on the
   * target, each substep the hold exists.
   */
  const held = async (d: FixtureDef, watch: (s: Simulation) => void = () => {}, tamper: Tamper = {}): Promise<{ sim: Simulation; lengthM: number; gripGapM: number; grips: number; clamps: number; clampGapM: number }> => {
    const A = armProfile(d);
    const out = { lengthM: 0, gripGapM: 0, grips: 0, clamps: 0, clampGapM: 0 };
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        watch(s);
        const arms = s.arms!;
        for (const pl of s.players) {
          if (pl.rag) continue;
          const o = arms.obs(pl.id);
          const lm = pl.pose?.jointLandmarksWorld;
          for (const side of SIDES) {
            const a = o?.[side];
            if (!a || !(a.gripId || a.clampContactId)) continue;
            expect(lm, `${d.id} ${pl.id} ${side} held with no published pose`).toBeDefined();
            const sh = lm![`${side}Shoulder`]!;
            const el = lm![`${side}Elbow`]!;
            const shown = {
              shoulderWorld: sh,
              elbowWorld: tamper.stretchElbow ? add(el, scale(sub(el, sh), tamper.stretchElbow)) : el,
              wristWorld: lm![`${side}Wrist`]!,
              palmContactWorld: lm![`${side}Palm`]!,
            };
            // a held arm is shown by the arm solve: fixed segments, the free-arm composition adds nothing to it
            out.lengthM = Math.max(out.lengthM, armLengthErr(shown, A));
            if (a.gripId) {
              const g = arms.grips.get(a.gripId)!;
              const t = s.byId.get(g.targetId)!;
              if (t.rag) continue;
              const b = t.proxy.body;
              const q = b.rotation();
              const p = b.translation();
              const anchor = add({ x: p.x, y: p.y, z: p.z }, qRot({ x: q.x, y: q.y, z: q.z, w: q.w }, tamper.anchorLocal ? add(g.targetPointLocal, tamper.anchorLocal) : g.targetPointLocal));
              out.gripGapM = Math.max(out.gripGapM, dist(shown.palmContactWorld, anchor));
              out.grips++;
            }
            if (a.clampContactId) out.clamps++;
          }
        }
      },
    });
    await runSim(sim);
    return { sim, ...out };
  };

  it('real palm holds: the anchor and arm segments stay within Gate 2 through entry; conversions remap on the anchor within Gate 4', async () => {
    for (const id of ['L3-F4-gripTarget', 'L3-F4-gripOwner', 'L3-F4-gripBoth']) {
      const d = FIX(id);
      const A = armProfile(d);
      const r = await held(d);
      const { sim } = r;
      const begin = sim.events.filter((e) => e.type === 'gripBegin');
      expect(begin, id).toHaveLength(2);
      expect(r.grips, id).toBeGreaterThan(0);
      for (const e of begin) expect(e.data!.palmGap as number, id).toBeLessThanOrEqual(A.surfaceTolM + 1e-9);
      expect(r.lengthM, id).toBeLessThanOrEqual(ragOf(d).validation.lengthTolM);
      expect(r.gripGapM, id).toBeLessThanOrEqual(A.surfaceTolM);
      // the holds outlive the entry; a hold ends only with a reason from the engine, after the conversion
      const rep = sim.events.find((e) => e.type === 'representation')!;
      expect(rep.t, id).toBeGreaterThan(begin[1].t);
      for (const e of sim.events.filter((x) => x.type === 'gripRelease')) {
        expect(e.t, id).toBeGreaterThan(rep.t);
        expect(e.data!.reason, id).toBeTruthy();
      }
      for (const e of sim.events.filter((x) => x.type === 'gripRemap')) {
        expect(e.data!.ok, id).toBe(true);
        expect(Number(e.data!.anchorErrM), id).toBeLessThanOrEqual(ragOf(d).validation.anchorTolM);
        expect(Number(e.data!.surfaceDistM), id).toBeLessThanOrEqual(ragOf(d).validation.anchorTolM);
      }
      for (const e of sim.events.filter((x) => x.type === 'gripPassive')) expect(e.data!.ok, id).not.toBe(false);
      // one force law per held relationship
      const seen = new Set<string>();
      for (const l of sim.arms!.ledger) {
        const k = `${l.step}:${l.id}`;
        expect(seen.has(k), `${id} ${k}`).toBe(false);
        seen.add(k);
      }
      sim.dispose();
    }
  }, 60000);

  it('real forearm clamps: the arm segments stay within Gate 2 through entry, exit and conversion, and end only for an engine reason', async () => {
    for (const id of ['L3-F4-twoArm', 'L3-F6-hold', 'L3-F10-both']) {
      const d = FIX(id);
      const r = await held(d);
      const { sim } = r;
      expect(sim.events.filter((e) => e.type === 'clampBegin').length, id).toBeGreaterThan(0);
      expect(r.clamps, id).toBeGreaterThan(0);
      expect(r.lengthM, id).toBeLessThanOrEqual(ragOf(d).validation.lengthTolM);
      for (const e of sim.events.filter((x) => x.type === 'clampBegin')) expect(e.data!.gap as number, id).toBeLessThanOrEqual(armProfile(d).surfaceTolM + 1e-9);
      for (const e of sim.events.filter((x) => x.type === 'clampEnd')) expect(e.data!.reason, id).toBeTruthy();
      sim.dispose();
    }
  }, 60000);

  it('the retention measures fail a stretched limb and a shifted anchor, and the wrong player has no hold', async () => {
    // the same measures, on the same run, with a 2 % longer shown upper arm or an anchor moved 2 cm on the target
    const d = FIX('L3-F4-gripTarget');
    const A = armProfile(d);
    const tol = ragOf(d).validation.lengthTolM;
    const r = await held(d, (s) => {
      // the held runner holds nothing: inspecting it would prove nothing
      const q = s.arms!.obs('R');
      expect(q?.left?.gripId ?? null).toBeNull();
      expect(q?.right?.gripId ?? null).toBeNull();
    });
    expect(r.grips).toBeGreaterThan(0);
    expect(r.lengthM).toBeLessThanOrEqual(tol);
    expect(r.gripGapM).toBeLessThanOrEqual(A.surfaceTolM);
    r.sim.dispose();
    const stretched = await held(d, () => {}, { stretchElbow: 0.02 });
    expect(stretched.lengthM).toBeGreaterThan(tol);
    expect(stretched.gripGapM).toBeLessThanOrEqual(A.surfaceTolM);
    stretched.sim.dispose();
    const shifted = await held(d, () => {}, { anchorLocal: { x: 0.02, y: 0, z: 0 } });
    expect(shifted.gripGapM).toBeGreaterThan(A.surfaceTolM);
    expect(shifted.lengthM).toBeLessThanOrEqual(tol);
    shifted.sim.dispose();
  }, 60000);
});

