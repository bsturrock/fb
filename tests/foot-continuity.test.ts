// Plan 10b: the composed foot planner's step targets move continuously inside an ownership (B1), a step's stored
// vertical motion is the published one (B2), and the clip's leg request has no jump of its own (B3). Every L3 fixture,
// every substep.
import { describe, expect, it } from 'vitest';
import { FOOTWORK_L2, FOOTWORK_L3, stepAccelLimits } from '../src/sim/footwork';
import type { FixtureDef } from '../src/sim/fixture';
import { add, len, qRot, scale, sub, type Vec3 } from '../src/sim/vec';
import type { Simulation } from '../src/sim/simulation';
import { allFixtures } from '../src/sim/fixtures/index';
import { run } from './helpers';
import { each, FIX, SIDES } from './transitions-shared';

const C = FOOTWORK_L3.compose!;
const SW = FOOTWORK_L3.swing;
const aMaxAt = (sp: number): number => C.stepAccelMps2 + C.stepAccelPerTravel * sp;
const vCapAt = (sp: number): number => SW.maxSpeedMps + SW.travelSpeedK * sp;

/** What the per-substep checks saw over the whole file (each L3 fixture adds its own). */
const seen = { steps: 0, stored: 0, chaseStarts: 0, chaseReseeds: 0, chaseInside: 0, requests: 0 };

/** B3: the declared limit of the clip leg request's own world-frame second difference (m): the composition limit. */
const REQUEST_DD_M = 0.01;

/** The transition audit's record of each player's last ordinary leg request (body frame); read only. */
type AuditView = { auditPrev: Map<string, { reqL: Record<'left' | 'right', Vec3>; supported: boolean; falling: boolean }> };

interface Row {
  key: string;
  mode: string;
  source: string;
  seeds: number;
  h: Vec3;
  y: number;
  vy: number;
  sy: number;
  avy: number;
  aMax: number;
  vCap: number;
}

interface Breach {
  what: string;
  at: string;
  got: number;
  limit: number;
}

/**
 * Runs a fixture (with the transition audit, which reads copies) and checks at every substep, for every foot of every
 * proxy player:
 * - B1: a step target's horizontal second difference within the step's acceleration limit (the larger of the two
 *   substeps' limits, over dt^2), plus what the speed cap took off the last substep's motion where the cap fell below it
 *   (the cap scales with the body's travel speed, which a collision can cut in one substep);
 * - B2: a step's stored vertical rate equal to the published one;
 * - B2: a chase's published vertical rate changing within the declared lift acceleration, from the motion it starts from
 *   (the published motion, or the achieved ankle where the chase reseeded);
 * - B3: the clip's ordinary leg request (world) moving with a second difference within REQUEST_DD_M while the clip is
 *   shown at full weight on a supported body.
 */
async function continuity(d: FixtureDef): Promise<{ breaches: Breach[]; outOfTime: { at: string; t: number; speed: number; next: number; aMax: number }[]; requestDD: { d: number; at: string }[]; overdue: { at: string; n: number }[] }> {
  const breaches: Breach[] = [];
  // continued steps past their time: substeps per step
  const overdue: { at: string; n: number }[] = [];
  const over = new Map<string, { at: string; n: number }>();
  const outOfTime: { at: string; t: number; speed: number; next: number; aMax: number }[] = [];
  const requestDD: { d: number; at: string }[] = [];
  const hist = new Map<string, Row[]>();
  const late = new Map<string, { t: number; speed: number; aMax: number } | null>();
  const reqs = new Map<string, { p: Vec3; ok: boolean }[]>();
  const sim = await run(d, {
    transitionAudit: true,
    onSubstep: (s: Simulation) => {
      const dt = s.dt;
      const audit = (s as unknown as AuditView).auditPrev;
      for (const pl of s.players) {
        if (pl.rag) continue;
        // B3: the ordinary request, as the audit recorded it this substep, in the world
        const a = audit.get(pl.id);
        if (a) {
          const tr = pl.proxy.body.translation();
          const q = pl.proxy.body.rotation();
          const ok = !!pl.run && (pl.run.wF ?? pl.run.w) >= 0.999 && a.supported && !a.falling;
          for (const side of SIDES) {
            const k = `${pl.id}:${side}`;
            const h = reqs.get(k) ?? [];
            h.push({ p: add({ x: tr.x, y: tr.y, z: tr.z }, qRot({ x: q.x, y: q.y, z: q.z, w: q.w }, a.reqL[side])), ok });
            if (h.length > 3) h.shift();
            reqs.set(k, h);
            if (h.length === 3 && h.every((x) => x.ok)) {
              seen.requests++;
              const dd = len(add(sub(h[2]!.p, scale(h[1]!.p, 2)), h[0]!.p));
              if (dd > REQUEST_DD_M) requestDD.push({ d: dd, at: `${d.id} ${k} ${s.t.toFixed(4)}` });
            }
          }
        }
        if (!pl.feet) continue;
        const v = pl.proxy.body.linvel();
        const sp = Math.hypot(v.x, v.z);
        for (const side of SIDES) {
          const f = pl.feet.feet[side];
          const at = `${d.id} ${pl.id}:${side} ${s.t.toFixed(4)}`;
          const pastDue = f.mode === 'swing' && f.source === 'step' && f.why === 'continue' && !f.wait && !f.rejoin && f.elapsedS > f.durS;
          const o = over.get(`${pl.id}:${side}`);
          if (pastDue && o) o.n++;
          else if (pastDue) over.set(`${pl.id}:${side}`, { at, n: 1 });
          else if (o) { overdue.push(o); over.delete(`${pl.id}:${side}`); }
          const step = f.mode !== 'planted' && f.source === 'step' && !f.wait && !f.rejoin;
          const row: Row = { key: `${f.mode !== 'planted'}/${f.source}/${f.seeds}/${f.wait}/${f.rejoin}`, mode: f.mode, source: f.source, seeds: f.seeds, h: { x: f.target.x, y: 0, z: f.target.z }, y: f.target.y, vy: f.stepV.y, sy: f.solvedW.y, avy: f.ankleV.y, aMax: aMaxAt(sp), vCap: vCapAt(sp) };
          const k = `${pl.id}:${side}`;
          const h = hist.get(k) ?? [];
          h.push(row);
          if (h.length > 3) h.shift();
          hist.set(k, h);
          const [r0, r1, r2] = h.length === 3 ? h : [undefined, h[0], h[1]];
          if (!r1 || !r2 || dt <= 0) continue;
          // B2: the stored vertical rate is the published one
          if (f.mode !== 'planted' && f.source === 'step' && r1.key === r2.key) {
            seen.stored++;
            const pub = (r2.y - r1.y) / dt;
            if (Math.abs(f.stepV.y - pub) > 1e-9) breaches.push({ what: 'stored vertical rate', at, got: f.stepV.y, limit: pub });
          }
          // B1: the step's horizontal second difference
          if (step && r0 && r0.key === r2.key && r1.key === r2.key) {
            seen.steps++;
            const m1 = sub(r1.h, r0.h);
            const m2 = sub(r2.h, r1.h);
            const bound = Math.max(r1.aMax, r2.aMax) * dt * dt + Math.max(0, len(m1) - r2.vCap * dt);
            const dd = len(sub(m2, m1));
            if (dd > bound + 1e-12) breaches.push({ what: 'step target second difference', at, got: dd, limit: bound });
          }
          // B2: a chase's vertical rate (a carried handover's first update is the old owner's target, not the chase's)
          const chase = f.mode === 'airborne' && f.source === 'step';
          const carry = r1.source === 'follow' && r1.seeds === r2.seeds;
          if (chase && !carry && r0) {
            const reseed = r1.seeds !== r2.seeds;
            const from = reseed ? { y: r1.sy, v: r1.avy } : { y: r1.y, v: (r1.y - r0.y) / dt };
            if (reseed) seen.chaseReseeds++;
            else if (r1.mode === 'airborne' && r1.source === 'step') seen.chaseInside++;
            else seen.chaseStarts++;
            const acc = Math.abs((r2.y - from.y) / dt - from.v) / dt;
            if (acc > C.liftAccelMps2 + 1e-9) breaches.push({ what: `chase vertical acceleration${reseed ? ' (reseed)' : ''}`, at, got: acc, limit: C.liftAccelMps2 });
          }
          // a step whose time runs out while it moves (the B1 reproductions): its motion over the next substep
          const was = late.get(k);
          if (was) outOfTime.push({ at: k, t: was.t, speed: was.speed, next: len(sub(r2.h, r1.h)) / dt, aMax: was.aMax });
          late.set(k, step && f.mode === 'swing' && r1.key === r2.key && f.elapsedS >= f.durS && f.elapsedS - dt < f.durS ? { t: s.t, speed: len(sub(r2.h, r1.h)) / dt, aMax: Math.max(r1.aMax, r2.aMax) } : null);
        }
      }
    },
  });
  sim.dispose();
  overdue.push(...over.values());
  return { breaches, outOfTime, requestDD, overdue };
}

describe('plan 10b foot target continuity', () => {
  it('the step acceleration limits are declared from the swing limits, not measured', () => {
    // a minimum-jerk path peaks at 80 / (15 sqrt 3) = 3.079 x its peak speed / its time: the speed cap over the shortest
    // step, and the lift cap over half of it
    const k = 80 / (15 * Math.sqrt(3));
    expect(stepAccelLimits(FOOTWORK_L2.swing)).toEqual({ stepAccelMps2: (k * 3.5) / 0.2, stepAccelPerTravel: (k * 2.5) / 0.2, liftAccelMps2: (k * 1.5) / 0.1 });
    expect(C.stepAccelMps2).toBeCloseTo(53.89, 2);
    expect(C.stepAccelPerTravel).toBeCloseTo(38.49, 2);
    expect(C.liftAccelMps2).toBeCloseTo(46.19, 2);
    expect(FOOTWORK_L3.id).toBe('footwork-l3-v3');
    expect(FOOTWORK_L2.compose).toBeUndefined();
  });

  each(/^L3-/, 'step targets within the acceleration limit, stored vertical motion as published, chases within the lift acceleration, no jump in the clip leg request', async (d) => {
    const { breaches, requestDD } = await continuity(d);
    expect(breaches.slice(0, 5).map((b) => `${b.what} ${b.at}: ${b.got} > ${b.limit}`), `${breaches.length} breaches`).toEqual([]);
    expect(requestDD.slice(0, 5).map((r) => `${r.at}: ${r.d}`), `${requestDD.length} request jumps`).toEqual([]);
  });

  it('the per-substep checks saw every kind of substep they bound', () => {
    // (runs after the per-fixture tests above: the counts are theirs)
    expect(seen.steps).toBeGreaterThan(30000);
    expect(seen.stored).toBeGreaterThan(30000);
    expect(seen.chaseStarts).toBeGreaterThan(5);
    expect(seen.chaseInside).toBeGreaterThan(100);
    expect(seen.requests).toBeGreaterThan(30000);
  });

  it('reproductions: a step out of time while moving slows within its limit, it does not stop at its destination in one substep', async () => {
    // before 10b: L3-F3-side D left 0.0583 s went from 20.51 m/s to 0 in one substep (8.55 cm second difference), and the
    // same at R 0.2708 s, D left 0.3333 s and L3-F1-phase0 0.6708 s. Those runs have changed with the fix; each fixture
    // still has steps running out of time at speed
    for (const id of ['L3-F3-side', 'L3-F1-phase0']) {
      const { outOfTime } = await continuity(FIX(id));
      const moving = outOfTime.filter((x) => x.speed > 1);
      expect(moving.length, id).toBeGreaterThan(0);
      for (const x of moving) {
        expect(x.next, `${id} ${x.at} ${x.t.toFixed(4)}`).toBeGreaterThan(0);
        expect(x.speed - x.next, `${id} ${x.at} ${x.t.toFixed(4)}`).toBeLessThanOrEqual(x.aMax * (1 / 240) + 1e-9);
      }
      if (id === 'L3-F3-side') {
        // D's left foot, the first reproduction: out of time at over 10 m/s near 0.054 s, still moving after it
        const first = moving.find((x) => x.at === 'D:left' && x.t < 0.07);
        expect(first, 'D left out of time near 0.054 s').toBeDefined();
        expect(first!.speed).toBeGreaterThan(10);
        expect(first!.next).toBeGreaterThan(10);
      }
    }
  }, 60000);

  it('a continued step is given the time its acceleration limit needs: on a free stop or start it lands on time', async () => {
    // without the acceleration term in its timing a continued step was timed shorter than its path can keep (L3-F16-stop1.7
    // left 2.258 s: 0.70 m in 0.105 s, about 3 x the limit) and ran past its time: 3 to 13 substeps on these runs. With it
    // the most measured is 2 (L3-F16-stop2.9 R right 3.575 s), where the destination moved on after the step was timed
    const ids = allFixtures().filter((x) => /^L3-F1[67]-(runStop|stop\d|reaccel|runStart)/.test(x.id)).map((x) => x.id);
    expect(ids.length).toBe(16);
    for (const id of ids) {
      const { overdue } = await continuity(FIX(id));
      const worst = overdue.reduce((a, x) => (x.n > a.n ? x : a), { at: '-', n: 0 });
      expect(worst.n, `${worst.at} overdue ${worst.n} substeps`).toBeLessThanOrEqual(2);
    }
  }, 300000);

  it('B3 fault put back: with the clip heading snapping to the travel direction, the leg request jumps at contact', async () => {
    // before 10b the sampled clip's heading took the travel direction in one substep, so a collision that turned the
    // travel turned the leg request with it: up to 4.45 cm in L3-F8-recontact (D2 left 0.829 s), 116 substeps over 1 cm
    // across L3. The heading now follows at the planner's follow rate (run-clips headingRadPerS)
    const d = FIX('L3-F8-recontact');
    expect(d.runClips?.headingRadPerS).toBe(18);
    const now = await continuity(d);
    expect(now.requestDD).toEqual([]);
    const snap = await continuity({ ...d, runClips: { ...d.runClips!, headingRadPerS: undefined } });
    expect(Math.max(...snap.requestDD.map((r) => r.d))).toBeGreaterThan(0.03);
  }, 60000);
});
