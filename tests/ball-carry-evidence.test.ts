// Plan 10d D1(a): one ball. What the lab draws (its own ball choice on its own render interpolation), what the rules read
// (`RuleObserver.ballRef`) and what the evidence records (the trace's per-tick ball, the ending event and the export's
// spot, read back from the JSON the fixture runner writes) agree on every tick of every L3 fixture with a rule profile.
import { describe, expect, it } from 'vitest';
import { capturePose, drawnBall, lerpPose, type PoseKey } from '../src/lab/render-pose';
import { allFixtures } from '../src/sim/fixtures/index';
import { carriedBall, type PhysicalPose } from '../src/sim/pose';
import { Simulation, type TraceRow } from '../src/sim/simulation';
import { dist, v3, type Vec3 } from '../src/sim/vec';
import { breathe, pace } from './helpers';

const vec = (a: [number, number, number]): Vec3 => v3(a[0], a[1], a[2]);
/** Largest per-axis difference (the trace rounds to 4 decimals: 5e-5). */
const axisGap = (a: Vec3, b: Vec3): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
const ROUND4 = 5e-5 + 1e-9;

describe('plan 10d D1(a): the drawn ball, the rule reference and the evidence are one ball', () => {
  const defs = allFixtures().filter((d) => d.milestone === 'L3' && d.rules);

  it('every L3 rule fixture draws the seated ball', () => {
    expect(defs.length).toBeGreaterThanOrEqual(20);
    for (const d of defs) expect(d.rules!.ballSource, d.id).toBe('carryPose');
  });

  it('on every tick of every L3 rule fixture; the spot is the ball at the ending and stays frozen', async () => {
    let ticks = 0;
    let seated = 0;
    let endings = 0;
    for (const def of defs) {
      let atEnding: Vec3 | null = null;
      const sim = await Simulation.create(def, {
        // the substep the ending is called on: the observer has just read this pose
        onSubstep: (s) => {
          if (!s.ending || atEnding) return;
          const R = s.players.find((p) => p.id === s.rules!.runnerId)!;
          atEnding = drawnBall(R.pose, s.poseOf(R), s.rules!.profile).p;
        },
      });
      const R = sim.players.find((p) => p.id === sim.rules!.runnerId)!;
      const live = new Map<number, Vec3>();
      let prev: PoseKey | null = null;
      let prevRep = R.representation;
      let spot: string | null = null;
      while (!sim.done) {
        sim.stepTick();
        await pace();
        const ref = sim.rules!.ballRef(sim.poseOf(R), R.pose);
        // the lab at alpha 1: its interpolation from the kept previous tick to this one (reset at a representation change)
        const shown: PhysicalPose | null = prev && R.pose && prevRep === R.representation ? lerpPose(prev, R.pose, 1) : R.pose;
        const drawn = drawnBall(shown, sim.poseOf(R), sim.rules!.profile);
        expect(dist(drawn.p, ref), `${def.id} t=${sim.t}`).toBeLessThan(1e-9);
        const c = carriedBall(R.pose);
        if (c) {
          seated++;
          expect(dist(drawn.p, c.p), def.id).toBeLessThan(1e-9);
        }
        live.set(sim.tick, ref);
        prev = capturePose(prev, R.pose);
        prevRep = R.representation;
        ticks++;
        if (sim.ending && !spot) spot = JSON.stringify(sim.ending.ballSpot);
        if (spot) expect(JSON.stringify(sim.ending!.ballSpot), def.id).toBe(spot);
      }
      // the evidence as written: fixture runner's export, through JSON
      const ev = JSON.parse(JSON.stringify({ fixture: sim.exportFixture(), summary: sim.summary(), events: sim.events, trace: sim.trace })) as {
        fixture: { ruleEnding: { ballSpot: Vec3 } | null };
        events: { type: string; data: { ballSpot?: [number, number, number] } }[];
        trace: TraceRow[];
      };
      let rows = 0;
      for (const row of ev.trace) {
        const ref = live.get(row.tick);
        if (!ref) continue;
        expect(row.rule, `${def.id} tick ${row.tick}`).toBeDefined();
        expect(axisGap(vec(row.rule!.ball), ref), `${def.id} tick ${row.tick}`).toBeLessThanOrEqual(ROUND4);
        rows++;
      }
      expect(rows, def.id).toBe(live.size);
      if (sim.ending) {
        endings++;
        const end = ev.events.filter((e) => e.type === 'ruleEnding');
        expect(end.length, def.id).toBe(1);
        expect(atEnding, def.id).not.toBeNull();
        // the official spot is the drawn ball at the substep the ending was called
        expect(dist(sim.ending.ballSpot, atEnding!), def.id).toBeLessThan(1e-12);
        expect(dist(ev.fixture.ruleEnding!.ballSpot, atEnding!), def.id).toBeLessThan(1e-12);
        expect(axisGap(vec(end[0].data.ballSpot!), atEnding!), def.id).toBeLessThanOrEqual(ROUND4);
      } else expect(ev.fixture.ruleEnding, def.id).toBeNull();
      sim.dispose();
      await breathe();
    }
    expect(ticks).toBeGreaterThan(2000);
    expect(seated).toBeGreaterThan(0.9 * ticks);
    expect(endings).toBeGreaterThanOrEqual(15);
  }, 240000);
});
