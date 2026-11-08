// Plan 08 (L3): locomotion transitions and automatic tackle integration. The composed foot planner (start, brake, settle),
// the fitted idle and procedural walking arms, the per-player locomotion mode (free, preparation, contact, exit) and the
// transition audit. L2, HC and every earlier fixture keep their paths; each L3 fixture opts in under its own id.
import { afterEach, describe, expect, it } from 'vitest';
import { Simulation, type TransitionDelta } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { FOOT_DEBUG, FOOTWORK_L3 } from '../src/sim/footwork';
import { dist, horiz, len, type Vec3 } from '../src/sim/vec';
import { run, runSim, traceDiff } from './helpers';
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

  it('the audit reads copies: the same run with and without it is identical', async () => {
    for (const id of ['L3-F16-runStop', 'L3-F7-phase25', 'L3-F4-twoArm', 'L3-F9-noProbe-prep', 'L3-F3-side']) {
      const a = await run(FIX(id));
      const b = await run(FIX(id), { transitionAudit: true });
      expect(traceDiff(a.trace, b.trace, a.players.map((p) => p.id)).pos, id).toBe(0);
      expect(JSON.stringify(b.events), id).toBe(JSON.stringify(a.events));
      a.dispose();
      b.dispose();
    }
  }, 30000);

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

  it('a step that gathers speed out of time has not stopped: nothing is set aside, the comparison is the old path as it is', async () => {
    // L3-F1-low: D's step gathers speed in the substep it loses support: carrying its last motion on would compare the new foot
    // with a path nothing was on (the boundary's time follows the runner's ragdoll, plan 08a)
    const x = (await audited(FIX('L3-F1-low'))).find((b) => b.playerId === 'D' && b.t > 1.45 && b.t < 1.55 && b.to.includes('airborne') && !b.from.includes('airborne'));
    expect(x).toBeTruthy();
    expect(x!.stepStopM.right).toBe(0);
    expect(x!.deltaM).toBe(x!.rawM);
  }, 30000);

  it('the audit keeps the raw difference and what it set aside: a collision jolts the clip request, the new path does not take it', async () => {
    // L3-F7-phase0: collision turns the travel direction, the clip heading follows and the old path's request jolts; the
    // feet that changed owner at that boundary do not carry the jolt, and their achieved motion shows it
    const ds = await audited(FIX('L3-F7-phase0'));
    const jolted = ds.filter((x) => x.rawM > 0.01 && x.deltaM <= 0.01);
    expect(jolted.length).toBeGreaterThan(0);
    for (const x of jolted) expect(Math.max(...Object.values(x.requestJumpM))).toBeGreaterThan(0);
    // the two measures differ only where a demonstrated artifact was corrected; every boundary keeps all three numbers
    for (const x of ds) {
      expect(Object.keys(x.rawBy).sort()).toEqual(Object.keys(x.by).sort());
      expect(Number.isFinite(x.continuedM)).toBe(true);
      if (Math.max(...Object.values(x.requestJumpM), ...Object.values(x.stepStopM)) === 0) expect(x.deltaM).toBeCloseTo(x.rawM, 10);
    }
  }, 30000);

  it('a jump the old owner\'s offset already took up is not corrected a second time', async () => {
    // the planner takes a request jump over 15 m/s into the offset: the reference must not subtract it again
    for (const d of L3(/^L3-F(1-phase3|1-low|9-noProbe-prep|9-playerBelow)$/)) {
      const ds = await audited(d);
      for (const x of ds) for (const m of Object.values(x.requestJumpM)) expect(m * 240, `${d.id} ${x.t}`).toBeLessThanOrEqual(15);
    }
  }, 60000);

  it('an old path that was about to run on past the landing is the artifact: the landing is smooth, the raw difference stays on the record', async () => {
    // L3-F3-side at 0.32 s: R's step lands. Carried on one more substep the old step path is 5 cm from the plant, with no
    // request jump to explain it; the achieved shoe carries on its own motion to 4 mm
    // (the step out of time at the speed cap: its target stands still after moving 5.6 cm a substep). The reference carries that
    // stored motion on, from the plan: not from the achieved motion, which stays a separate number
    const ds = await audited(FIX('L3-F3-side'));
    const x = ds.find((b) => b.playerId === 'R' && Math.abs(b.t - 0.3208) < 1e-3)!;
    expect(x.rawM).toBeGreaterThan(0.04);
    expect(Math.max(...Object.values(x.requestJumpM))).toBe(0);
    expect(x.stepStopM.right).toBeGreaterThan(0.04);
    expect(x.deltaM).toBeLessThanOrEqual(0.01);
    expect(x.deltaM).not.toBe(x.continuedM);
    // D's next left landing (0.767 s after the leg repair) has the same artifact. The raw 1.88 cm stays recorded,
    // and the landing itself is not excused: its plant still fails on that slide.
    const y = ds.find((b) => b.playerId === 'D' && b.t > 0.4 && b.legs.left.old.kind === 'target' && b.legs.left.now.kind === 'plant')!;
    expect(y).toBeDefined();
    expect(y.rawM).toBeGreaterThan(0.01);
    expect(Math.max(...Object.values(y.requestJumpM))).toBe(0);
    expect(y.stepStopM.left).toBeGreaterThan(0.02);
    expect(y.deltaM).toBeLessThanOrEqual(0.01);
    const sim = await Simulation.create(FIX('L3-F3-side'));
    await runSim(sim);
    const failed = sim.events.find((e) => e.type === 'footPlantFailed' && e.playerId === 'D' && e.data?.side === 'left' && Math.abs(e.t - y.t) < 1e-5);
    sim.dispose();
    expect(failed?.data?.reason).toBe('slide');
  }, 30000);

  it('negative control: a known old/new pose difference over 1 cm still fails with the achieved motion smooth', async () => {
    // L3-F7-phase25 without the handover check: a short step about to accelerate hands its foot to the request. The new path
    // carries the achieved motion on (smooth); the old path was going 1.7 cm further. The audit has to report it
    FOOT_DEBUG.noJoinCheck = true;
    try {
      const ds = await audited(FIX('L3-F7-phase25'));
      const x = ds.filter((b) => b.deltaM > 0.01 && b.continuedM < 0.01);
      expect(x.length).toBeGreaterThan(0);
      for (const b of x) expect(b.rawM).toBeGreaterThan(0.01);
    } finally {
      FOOT_DEBUG.noJoinCheck = false;
    }
  }, 30000);

  it('a held leg handed to a step keeps the old owner\'s request at the handover, and a support loss keeps a step on its path', async () => {
    let carried = 0;
    let kept = 0;
    let airborne = 0;
    let overdue = 0;
    for (const d of L3(/^L3-F(1-low|1-phase4|3-collision|9-noProbe-contact|9-noProbe-free|9-noProbe-prep|11-invalid)$/)) {
      const was = new Map<string, { carried: boolean; seeds: number; mode: string; source: string; late: boolean; moveV: Vec3; stepV: Vec3; target: Vec3 }>();
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
                  // a step past its time goes on from the motion it had, not from a path velocity it dropped: the mean of its last
                  // substep, or while it was still gathering speed what it ended that substep at
                  overdue++;
                  const speed = dist({ ...f.target, y: 0 }, { ...p.target, y: 0 }) / s.dt;
                  expect(speed, `${d.id} ${s.t}`).toBeGreaterThan(Math.max(len(p.moveV) - 2, 0.5 * len(p.moveV)));
                  expect(speed, `${d.id} ${s.t}`).toBeLessThan(Math.max(len(p.moveV), len(horiz(p.stepV))) + 2);
                }
              }
              // a held leg that loses support stays on the old owner's path too
              if (p && p.mode === 'swing' && p.source === 'follow' && f.mode === 'airborne' && f.source === 'step' && f.carried) {
                airborne++;
                expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
              }
              was.set(k, { carried: f.carried, seeds: f.seeds, mode: f.mode, source: f.source, late: f.elapsedS >= f.durS, moveV: { ...f.moveV }, stepV: { ...f.stepV }, target: { ...f.target } });
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

