// Lab render contract (plan 06 pass 3): the follow camera tracks what is drawn. Players are drawn interpolated between
// the last two ticks (FixedStepDriver alpha); a camera target taken from the current tick alone steps once per tick
// and makes a smoothly drawn runner shake against the camera and the field.
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { FixedStepDriver } from '../src/sim/driver';
import { followCenter } from '../src/lab/follow';
import * as L1 from '../src/sim/fixtures/locomotion';
import { len, v3, type Vec3 } from '../src/sim/vec';
import { pace } from './helpers';

describe('lab render: follow camera', () => {
  it('the drawn runner holds still against the follow camera at 60 and 120 Hz display rates (no per-tick stepping)', async () => {
    for (const hz of [60, 120, 144]) {
      const def = L1.l1f1('fastRun');
      const sim = await Simulation.create(def);
      const drv = new FixedStepDriver(def.solver.outerTickS, def.solver.maxTicksPerFrame);
      const pl = () => sim.players.find((p) => p.id === 'R')!;
      let prev: { core: Vec3; com: Vec3 } | null = null;
      const rel: Vec3[] = [];
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      while (!sim.done && sim.t < 1.5) {
        const n = drv.frame(1 / hz + (rnd() - 0.5) * 0.0004);
        for (let i = 0; i < n && !sim.done; i++) {
          prev = { core: { ...pl().pose!.segments.core.originWorld }, com: { ...sim.bulk(pl()).com } };
          sim.stepTick();
          await pace();
        }
        if (!prev) continue;
        const a = drv.alpha();
        const cur = pl().pose!.segments.core.originWorld;
        const drawn = v3(prev.core.x + (cur.x - prev.core.x) * a, 0, prev.core.z + (cur.z - prev.core.z) * a);
        const cam = followCenter([{ prev: prev.com, cur: sim.bulk(pl()).com }], a);
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
