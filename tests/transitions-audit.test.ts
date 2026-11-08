// Plan 08 (L3): locomotion transitions and automatic tackle integration. The composed foot planner (start, brake, settle),
// the fitted idle and procedural walking arms, the per-player locomotion mode (free, preparation, contact, exit) and the
// transition audit. L2, HC and every earlier fixture keep their paths; each L3 fixture opts in under its own id.
import { afterEach, describe, expect, it } from 'vitest';
import { Simulation, type TransitionDelta } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { FOOT_DEBUG, FOOTWORK_L3 } from '../src/sim/footwork';
import { dist, horiz, len, scale, sub, type Vec3 } from '../src/sim/vec';
import { nonEmpty, run, runSim, traceRowsDiff } from './helpers';
import { SIDES, FIX, L3, each } from './transitions-shared';


// a long file of synchronous runs: let the runner's messages through between tests
afterEach(() => new Promise<void>((done) => setTimeout(done)));

describe('plan 08 transition audit', () => {
  const audited = async (d: FixtureDef): Promise<TransitionDelta[]> => {
    const sim = await run(d, { transitionAudit: true });
    const out = sim.transitionDeltas;
    sim.dispose();
    return out;
  };

  it('the audit reads copies: the same run with and without it is identical, every trace row and every substep\'s planner, sampler and pose state', async () => {
    // plan 10b: the full trace rows, the events, and at every substep each player's foot plan, run-clip playback, pose
    // memory, locomotion state, walking request and published pose. The stated sample: the first fixture of each L3
    // family (F1-F17) and the five the audit was first checked on
    const first = new Map<string, string>();
    for (const d of L3(/^L3-/)) first.set(d.id.split('-').slice(0, 2).join('-'), first.get(d.id.split('-').slice(0, 2).join('-')) ?? d.id);
    const ids = [...new Set([...first.values(), 'L3-F16-runStop', 'L3-F7-phase25', 'L3-F4-twoArm', 'L3-F9-noProbe-prep', 'L3-F3-side'])];
    expect(first.size).toBeGreaterThanOrEqual(16);
    for (const id of ids) {
      const states = async (audit: boolean): Promise<{ sim: Simulation; states: string[] }> => {
        const out: string[] = [];
        const sim = await run(FIX(id), {
          transitionAudit: audit,
          onSubstep: (s) => {
            out.push(JSON.stringify(s.players.map((pl) => [pl.feet, pl.run, pl.poseMemory, pl.loco, pl.walkRequest, pl.walkWant, pl.pose])));
          },
        });
        return { sim, states: out };
      };
      const a = await states(false);
      const b = await states(true);
      expect(b.sim.transitionDeltas.length + b.sim.events.length, id).toBeGreaterThan(0);
      expect(traceRowsDiff(a.sim.trace, b.sim.trace), id).toBeNull();
      expect(JSON.stringify(b.sim.events), id).toBe(JSON.stringify(a.sim.events));
      expect(b.states.length, id).toBe(a.states.length);
      const i = a.states.findIndex((x, k) => x !== b.states[k]);
      expect(i, `${id}: substep ${i} state differs`).toBe(-1);
      a.sim.dispose();
      b.sim.dispose();
    }
  }, 300000);

  // every L3 case: free movement, contact, recontact, landing and airborne recovery, contact interrupted by falling
  each(/^L3-/, 'transition-only pose discontinuity at most 1 cm at every ownership change, all landmarks, same solved time', async (d) => {
    // every reseed the pose takes as a new owner, seen from outside the audit
    const seeds = new Map<string, number>();
    const reseeds: { t: number; id: string }[] = [];
    const sim = await run(d, {
      transitionAudit: true,
      onSubstep: (s) => {
        for (const pl of s.players)
          for (const side of SIDES) {
            const f = pl.feet?.feet[side];
            if (!f || pl.rag) continue;
            const k = `${pl.id}:${side}`;
            const was = seeds.get(k);
            if (was !== undefined && was !== f.seeds) reseeds.push({ t: s.t, id: pl.id });
            seeds.set(k, f.seeds);
          }
      },
    });
    const ds = sim.transitionDeltas;
    sim.dispose();
    for (const x of ds) {
      expect(Object.keys(x.rawBy).length, d.id).toBeGreaterThan(20);
      expect(x.deltaM, `${d.id} ${x.t.toFixed(4)} ${x.playerId} ${x.landmark} ${x.from} > ${x.to} raw ${x.rawM.toFixed(4)}`).toBeLessThanOrEqual(0.01);
    }
    for (const r of reseeds) expect(ds.some((x) => x.playerId === r.id && Math.abs(x.t - r.t) < 1e-9), `${d.id} reseed of ${r.id} at ${r.t.toFixed(5)} has no boundary`).toBe(true);
  });

  it('a reseed that keeps mode and source is a boundary, compared with the old owner', async () => {
    // L3-F1-phase5: D's right foot is reseeded three times early in the run with no change of mode or source: the pose takes each as
    // a new owner, so the old owner's continuation has to be what the live foot is compared with
    const ds = (await audited(FIX('L3-F1-phase5'))).filter((x) => x.playerId === 'D');
    for (const t of [0.029167, 0.041667, 0.05]) {
      const x = ds.find((b) => Math.abs(b.t - t) < 1e-5);
      expect(x, `no boundary at ${t}`).toBeTruthy();
      expect(x!.from.replace(/#\d+/g, ''), `${t}`).toBe(x!.to.replace(/#\d+/g, ''));
      expect(x!.from, `${t}`).not.toBe(x!.to);
      expect(dist(x!.legs.right.old.request, x!.legs.right.now.request), `${t}`).toBeGreaterThan(0);
    }
  }, 30000);

  it('a step is compared with its old path as it is: nothing of a step is set aside (plan 10b)', async () => {
    // L3-F1-low: D's step loses support out of time. Before 10b the reference carried a timed-out step's stored motion on
    // (stepStopM) because the old path stopped dead; the step now slows within its limit, so there is nothing to carry on
    const ds = await audited(FIX('L3-F1-low'));
    const x = ds.find((b) => b.playerId === 'D' && b.t > 1.45 && b.t < 1.55 && b.to.includes('airborne') && !b.from.includes('airborne'));
    expect(x).toBeTruthy();
    expect(x!.legs.right.old.kind).toBe('target');
    expect(x!.deltaM).toBe(x!.rawM);
    expect('stepStopM' in x!).toBe(false);
  }, 30000);

  it('the audit keeps the raw difference and what it set aside: where the clip request jumps in the body frame, the new path does not take it', async () => {
    // L3-F7-phase0: before 10b the collision turned the travel direction, the clip heading snapped to it and the old
    // path's request jolted (two boundaries over 1 cm raw, passed only through the correction). The heading now follows at
    // a bounded rate (B3): nothing there is over 1 cm before or after the correction
    const f7 = nonEmpty(await audited(FIX('L3-F7-phase0')), 'L3-F7-phase0 boundaries');
    for (const x of f7) expect(x.rawM, `L3-F7-phase0 ${x.t}`).toBeLessThanOrEqual(0.01);
    // what still jumps is the body-frame request when contact entry turns the body (the angular impulse; the clip itself
    // is the same in both compositions): L3-F1-mirror0 D 0.479 s
    const ds = await audited(FIX('L3-F1-mirror0'));
    const jolted = nonEmpty(ds.filter((x) => x.rawM > 0.01 && x.deltaM <= 0.01), 'jolted boundaries');
    for (const x of jolted) expect(Math.max(...Object.values(x.requestJumpM))).toBeGreaterThan(0);
    // the two measures differ only where a demonstrated artifact was corrected; every boundary keeps all three numbers
    for (const x of [...f7, ...ds]) {
      expect(Object.keys(x.rawBy).sort()).toEqual(Object.keys(x.by).sort());
      expect(Number.isFinite(x.continuedM)).toBe(true);
      if (Math.max(...Object.values(x.requestJumpM)) === 0) expect(x.deltaM).toBeCloseTo(x.rawM, 10);
    }
  }, 30000);

  it('a jump the old owner\'s offset already took up is not corrected a second time', async () => {
    // the planner takes a request jump over 15 m/s into the offset: the reference must not subtract it again
    for (const d of L3(/^L3-F(1-phase3|1-low|9-noProbe-prep|9-playerBelow)$/)) {
      const ds = await audited(d);
      for (const x of ds) for (const m of Object.values(x.requestJumpM)) expect(m * 240, `${d.id} ${x.t}`).toBeLessThanOrEqual(15);
    }
  }, 60000);

  it('a landing is compared with the old step path as it is: the old path no longer runs on past it (plan 10b)', async () => {
    // L3-F3-side: before 10b, R's step at 0.32 s ran out of time at the speed cap and its old path stood still 5 cm past
    // the plant the substep after (the stop the stepStopM reference carried on); across L3 that correction carried 14
    // boundaries over 1 cm, up to 6.9 cm. Now every step-to-plant landing passes with nothing set aside
    for (const id of ['L3-F3-side', 'L3-F3-sideMirror', 'L3-F5-drag', 'L3-F8-recontact']) {
      const ds = await audited(FIX(id));
      const landings = ds.filter((b) => SIDES.some((s) => b.legs[s].old.kind === 'target' && b.legs[s].now.kind === 'plant'));
      expect(landings.length, id).toBeGreaterThan(1);
      for (const x of landings) {
        expect(x.rawM, `${id} ${x.t.toFixed(4)} ${x.playerId}`).toBeLessThanOrEqual(0.01);
        if (Math.max(...Object.values(x.requestJumpM)) === 0) expect(x.deltaM).toBe(x.rawM);
      }
    }
  }, 60000);

  it('negative control: a known old/new pose difference over 1 cm still fails (the 10b crossing heading fault put back)', async () => {
    // L3-F7-loadRelease with the composed crossing setting a following foot's heading to the body's, as before 10b: D's
    // left knee pole turns 19 degrees in one substep at contact entry and the leg takes another clearance variant, while
    // the old owner keeps its heading. The audit has to report that boundary, with nothing set aside. (The plan 08 control,
    // the handover check switched off in L3-F7-phase25, no longer gives one: with 10b's bounded step paths no handover in
    // L3 departs by over 1 cm without it.)
    FOOT_DEBUG.crossingBodyHeading = true;
    try {
      const ds = await audited(FIX('L3-F7-loadRelease'));
      const x = ds.filter((b) => b.deltaM > 0.01);
      expect(x.map((b) => `${b.playerId} ${b.t.toFixed(4)} ${b.landmark}`)).toEqual(['D 0.5750 leftAnkle']);
      for (const b of x) expect(b.deltaM).toBeCloseTo(b.rawM, 10);
    } finally {
      FOOT_DEBUG.crossingBodyHeading = false;
    }
  }, 30000);

  it('a held leg handed to a step keeps the old owner\'s request at the handover, and a support loss keeps a step on its path', async () => {
    let carried = 0;
    let kept = 0;
    let airborne = 0;
    let overdue = 0;
    for (const d of L3(/^L3-F(1-low|1-phase4|3-collision|9-noProbe-contact|9-noProbe-free|9-noProbe-prep|11-invalid)$/)) {
      const was = new Map<string, { carried: boolean; seeds: number; mode: string; source: string; late: boolean; moveV: Vec3; stepV: Vec3; target: Vec3; aMax: number }>();
      const sim = await Simulation.create(d, {
        transitionAudit: true,
        onSubstep: (s) => {
          for (const pl of s.players)
            for (const side of SIDES) {
              const f = pl.feet?.feet[side];
              if (!f || pl.rag) continue;
              const k = `${pl.id}:${side}`;
              const p = was.get(k);
              if (p && !p.carried && f.carried) {
                carried++;
                expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
                const x = s.transitionDeltas.filter((b) => b.playerId === pl.id).at(-1)!;
                expect(x.t, `${d.id} ${s.t}`).toBeCloseTo(s.t, 9);
                // on the ground old and new are one path here, less what the lift cap takes off the old path's motion in the step's
                // first update; a support loss adds the request's seam
                const cut = Math.max(0, Math.abs(f.requestWasV.y + f.offsetV.y) - FOOTWORK_L3.swing.maxLiftRateMps) * s.dt;
                expect(dist(x.legs[side].old.ankle, x.legs[side].now.ankle), `${d.id} ${s.t}`).toBeLessThan(f.mode === 'airborne' ? 0.01 : 1e-3 + cut);
              }
              if (p && p.mode === 'swing' && p.source === 'step' && f.mode === 'airborne' && f.source === 'step') {
                kept++;
                expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
                if (p.late) {
                  // a step past its time goes on from the motion it had, not from a path velocity it dropped: its motion changes by
                  // at most the step's declared acceleration over the substep, plus what the speed cap takes off (plan 10b; this
                  // was a window of -2/+2 m/s around the last speed, with half the speed as the floor, which a bounded reversal
                  // through zero speed breaks)
                  overdue++;
                  const sp = len(horiz(pl.proxy.body.linvel()));
                  const C = FOOTWORK_L3.compose!;
                  const vNow = scale(horiz(sub(f.target, p.target)), 1 / s.dt);
                  const cut = Math.max(0, len(p.moveV) - (FOOTWORK_L3.swing.maxSpeedMps + FOOTWORK_L3.swing.travelSpeedK * sp));
                  expect(len(sub(vNow, p.moveV)), `${d.id} ${s.t}`).toBeLessThanOrEqual(Math.max(C.stepAccelMps2 + C.stepAccelPerTravel * sp, p.aMax) * s.dt + cut + 1e-9);
                }
              }
              // a held leg that loses support stays on the old owner's path too
              if (p && p.mode === 'swing' && p.source === 'follow' && f.mode === 'airborne' && f.source === 'step' && f.carried) {
                airborne++;
                expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
              }
              const C = FOOTWORK_L3.compose!;
              was.set(k, { carried: f.carried, seeds: f.seeds, mode: f.mode, source: f.source, late: f.elapsedS >= f.durS, moveV: { ...f.moveV }, stepV: { ...f.stepV }, target: { ...f.target }, aMax: C.stepAccelMps2 + C.stepAccelPerTravel * len(horiz(pl.proxy.body.linvel())) });
            }
        },
      });
      await runSim(sim);
      sim.dispose();
    }
    expect(carried).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
    expect(airborne).toBeGreaterThan(0);
    expect(overdue).toBeGreaterThan(0);
  }, 60000);

  it('a request seam at a support change is taken up by the offset, not by the foot', async () => {
    let seams = 0;
    for (const d of L3(/^L3-F9-(lift-free|playerBelow)$/)) {
      const was = new Map<string, Vec3>();
      const sim = await Simulation.create(d, {
        onSubstep: (s) => {
          for (const pl of s.players)
            for (const side of SIDES) {
              const f = pl.feet?.feet[side];
              if (!f || pl.rag) continue;
              const k = `${pl.id}:${side}`;
              const last = was.get(k);
              if (last && len(f.seamOffset) > 0.02) {
                seams++;
                // the 34 cm of the request's seam stay out of the foot
                expect(dist(f.target, last) / s.dt, `${d.id} ${pl.id} ${s.t}`).toBeLessThan(15);
              }
              was.set(k, { ...f.target });
            }
        },
      });
      await runSim(sim);
      sim.dispose();
    }
    expect(seams).toBeGreaterThan(0);
  }, 30000);

  it('a fresh plant is not stepped from the moment it lands', async () => {
    // at speed the reach-time trigger would release a foot one substep after its touchdown
    for (const d of L3(/^L3-F(3-side|5-drag)$/)) {
      const sim = await run(d);
      const quick = sim.events.filter((e) => e.type === 'footRelease' && e.data!.reason === 'reach' && Number(e.data!.solves) <= 1);
      expect(quick, d.id).toHaveLength(0);
      sim.dispose();
    }
  }, 30000);
});

