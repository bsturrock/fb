// Lab render contract (plan 06 pass 3; plan 13a look-ahead playback). The lab draws per-tick snapshots, interpolated
// between the two frames around the shown time; the follow camera tracks what is drawn. The simulation runs ahead of
// the shown time within a wall-time budget per display frame, so a slow tick costs buffer lead, not frames.
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { followCenter } from '../src/lab/follow';
import { Playback, type PlaybackSource } from '../src/lab/playback';
import { FrameCapture, type LabFrame } from '../src/lab/snapshot';
import * as L1 from '../src/sim/fixtures/locomotion';
import { len, v3, type Vec3 } from '../src/sim/vec';
import { FIX, create, pace } from './helpers';

/** A fake simulation: tick k costs `cost(k)` ms on the fake clock; its frames are the tick numbers. */
function fakeSource(ticks: number, cost: (k: number) => number, clock: { ms: number }): PlaybackSource<number> & { k: number } {
  return {
    k: 0,
    capture() {
      return this.k;
    },
    step() {
      clock.ms += cost(this.k);
      this.k++;
    },
    done() {
      return this.k >= ticks;
    },
  };
}

describe('lab render: look-ahead playback', () => {
  it('a slow stretch costs buffer lead, not frames: no frame computes past its budget, shown time follows wall time', () => {
    const clock = { ms: 0 };
    // 0.5 ms ticks, 40 ticks of 12 ms from tick 120 (a contact): over budget for real time, covered by the lead
    const src = fakeSource(400, (k) => (k >= 120 && k < 160 ? 12 : 0.5), clock);
    const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
    pb.paused = false;
    const wallS = 1 / 60;
    let worstFillMs = 0;
    let shownPrev = 0;
    let held = 0;
    for (let f = 0; f < 600 && !pb.ended; f++) {
      const t0 = clock.ms;
      pb.frame(wallS);
      // a tick starts only while its estimated cost fits; one tick of misestimate at most (0.5 ms estimate, 12 ms tick)
      worstFillMs = Math.max(worstFillMs, clock.ms - t0);
      const shown = pb.shown;
      if (pb.computing) held++;
      else if (!pb.ended) expect(shown - shownPrev).toBeCloseTo(1, 6); // one tick per 60 Hz frame at 1x
      shownPrev = shown;
      clock.ms += 16.7 - (clock.ms - t0); // the rest of the display frame
    }
    expect(pb.ended).toBe(true);
    expect(pb.newest).toBe(400);
    expect(worstFillMs).toBeLessThanOrEqual(8 + 12);
    // the 40 slow ticks need 480 ms of compute; the lead built over the first 2 s covers them, so playback never waits
    expect(held).toBe(0);
  });

  it('when playback catches the buffer it holds the newest frame (computing) and resumes without skipping a tick', () => {
    const clock = { ms: 0 };
    const src = fakeSource(100, () => 20, clock); // every tick over the budget, played at 2x: playback outruns the simulation
    const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
    pb.paused = false;
    pb.speed = 2;
    const seen: number[] = [];
    for (let f = 0; f < 400 && !pb.ended; f++) {
      pb.frame(1 / 60);
      seen.push(pb.view().tick);
      if (f > 2 && !pb.ended) expect(pb.computing).toBe(true);
    }
    expect(pb.ended).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBeLessThanOrEqual(1);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it('paused, the buffer fills in the background; step, seek, finish and restart address ticks exactly', () => {
    const clock = { ms: 0 };
    const src = fakeSource(50, () => 1, clock);
    const pb = new Playback(src, 1 / 60, () => clock.ms, 8);
    pb.frame(1 / 60);
    expect(pb.paused).toBe(true);
    expect(pb.shown).toBe(0);
    expect(pb.newest).toBeGreaterThanOrEqual(7);
    pb.step();
    expect(pb.view()).toMatchObject({ tick: 1, a: 1, alpha: 0 });
    pb.seek(30);
    expect(pb.view()).toMatchObject({ tick: 30, a: 30 });
    pb.seek(99);
    expect(pb.view().tick).toBe(50);
    expect(pb.ended).toBe(true);
    src.k = 0;
    pb.restart();
    expect(pb.newest).toBe(0);
    pb.finish();
    expect(pb.newest).toBe(50);
    expect(pb.shown).toBe(0);
  });

  it('frames of a real fixture: one per tick, in order, identical to stepping the simulation directly', async () => {
    const direct = await create(FIX('L4-F10-wrap-on'));
    const ref: { t: number; core: Vec3 }[] = [];
    const corePos = (s: Simulation): Vec3 => ({ ...s.poseOf(s.players[0]).p });
    ref.push({ t: direct.t, core: corePos(direct) });
    while (!direct.done) {
      direct.stepTick();
      ref.push({ t: direct.t, core: corePos(direct) });
      await pace();
    }
    direct.dispose();
    const sim = await create(FIX('L4-F10-wrap-on'));
    const cap = new FrameCapture(sim);
    const clock = { ms: 0 };
    const pb = new Playback<LabFrame>({ capture: () => cap.capture(), step: () => sim.stepTick(), done: () => sim.done }, sim.def.solver.outerTickS, () => clock.ms++, 8);
    while (!pb.complete) {
      pb.frame(0);
      await pace();
    }
    expect(pb.frames.length).toBe(ref.length);
    pb.frames.forEach((f, k) => {
      expect(f.tick).toBe(k);
      expect(f.t).toBe(ref[k].t);
      expect(f.players[0].core.p).toEqual(ref[k].core);
    });
    // the wireframe set is shared while unchanged and replaced at the representation change
    const sets = new Set(pb.frames.map((f) => f.players[0].colliderSet));
    const reps = new Set(pb.frames.map((f) => f.players[0].rep));
    expect(sets.size).toBe(reps.size);
    sim.dispose();
  });
});

describe('lab render: follow camera', () => {
  it('the drawn runner holds still against the follow camera at 60, 120 and 144 Hz display rates (no per-tick stepping)', async () => {
    for (const hz of [60, 120, 144]) {
      const def = L1.l1f1('fastRun');
      const sim = await Simulation.create(def);
      const cap = new FrameCapture(sim);
      let clockMs = 0;
      const pb = new Playback<LabFrame>({ capture: () => cap.capture(), step: () => sim.stepTick(), done: () => sim.done }, def.solver.outerTickS, () => clockMs, 8);
      pb.paused = false;
      const rel: Vec3[] = [];
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      while (!pb.ended && pb.view().a.t < 1.5) {
        pb.frame(1 / hz + (rnd() - 0.5) * 0.0004);
        clockMs += 1000 / hz;
        await pace();
        const { a, b, alpha } = pb.view();
        const pa = a.players.find((p) => p.id === 'R')!;
        const pbf = b.players.find((p) => p.id === 'R')!;
        if (a.tick === 0) continue;
        const ca = pa.pose!.segments.core.originWorld;
        const cb = pbf.pose!.segments.core.originWorld;
        const drawn = v3(ca.x + (cb.x - ca.x) * alpha, 0, ca.z + (cb.z - ca.z) * alpha);
        const cam = followCenter([{ prev: pa.com, cur: pbf.com }], alpha);
        rel.push(v3(drawn.x - cam.x, 0, drawn.z - cam.z));
      }
      let worst = 0;
      for (let i = 1; i < rel.length - 1; i++) worst = Math.max(worst, len(v3(rel[i + 1].x - 2 * rel[i].x + rel[i - 1].x, 0, rel[i + 1].z - 2 * rel[i].z + rel[i - 1].z)));
      expect(rel.length).toBeGreaterThan(50);
      expect(worst).toBeLessThan(1e-3);
      sim.dispose();
    }
  });
});
