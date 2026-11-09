// Plan 13b: the L3 contract pass, the checks and what they record. Every L3 fixture runs once, with the transition
// audit on (it reads copies: the copy comparison below) and every check that covers it attached: per-fixture contracts
// (plan 08, 10b, 12) and the named cases that read a plain run of a registered L3 fixture. tests/l3-contracts.test.ts
// runs the pass (split over shard processes, tests/l3-shard.ts) and holds one test per contract over every fixture it
// covers. No vitest import here: the shards run outside vitest, so the checks use tests/plain-expect.ts.
import { createHash } from 'node:crypto';
import type { PlayerRuntime, Simulation, SimOptions, TraceRow, TransitionDelta } from '../src/sim/simulation';
import { capturePose, drawnBall, lerpPose, type PoseKey } from '../src/lab/render-pose';
import { allFixtures } from '../src/sim/fixtures/index';
import { carriedBall, type PhysicalPose } from '../src/sim/pose';
import type { FixtureDef } from '../src/sim/fixture';
import { FOOTWORK_L3 } from '../src/sim/footwork';
import { IDLE_POSE_RECORD, IDLE_STANCE_FADE_MPS } from '../src/sim/locomotion';
import { add, dist, horiz, len, qConj, qMul, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { expect } from './plain-expect';
import { create, FIX, pace, run, traceRowsDiff } from './runs';
import { armLengthErr, armProfile, count, L3, LIMBS, modes, peaks, ragOf, SIDES } from './transitions-shared';

// ---------------------------------------------------------------------------------------------------------------------
// The pass

/** One check's view of one run: called on every substep, before and after every tick, and once at the end. */
export interface Watch {
  substep?(sim: Simulation): void;
  beforeTick?(sim: Simulation): void;
  tick?(sim: Simulation): void;
  finish?(sim: Simulation): void;
}
/** Where a check reports a failure (several per fixture where it collects them). */
export type Report = (detail: string) => void;
export interface Check {
  name: string;
  /** The L3 fixtures it covers: a pattern, or a list of ids (each must be an L3 fixture). */
  fixtures: RegExp | readonly string[];
  watch(d: FixtureDef, report: Report): Watch;
}

const text = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 600 ? `${m.slice(0, 600)}…` : m;
};
/** Runs an assertion and reports its failure instead of throwing, so one fixture reports every breach it has. */
const softly =
  (report: Report) =>
  (f: () => void): void => {
    try {
      f();
    } catch (e) {
      report(text(e));
    }
  };

/**
 * Runs `def` once with every watch attached, yielding to the runner between ticks. A hook that throws (a failed
 * assertion) reports it and its watch stops there, as the test it came from stopped at its first failed assertion; the
 * other watches go on.
 */
export async function runWatched(def: FixtureDef, watches: { w: Watch; fail: Report }[], opts: SimOptions = {}): Promise<void> {
  const live = watches.map((x) => ({ ...x, dead: false }));
  const call = (l: (typeof live)[number], f: ((sim: Simulation) => void) | undefined, sim: Simulation): void => {
    if (!f || l.dead) return;
    try {
      f(sim);
    } catch (e) {
      l.dead = true;
      l.fail(text(e));
    }
  };
  const sim = await create(def, {
    ...opts,
    onSubstep: (s) => {
      for (const l of live) call(l, l.w.substep, s);
    },
  });
  try {
    while (!sim.done) {
      for (const l of live) call(l, l.w.beforeTick, sim);
      sim.stepTick();
      for (const l of live) call(l, l.w.tick, sim);
      await pace();
    }
    for (const l of live) call(l, l.w.finish, sim);
  } finally {
    sim.dispose();
  }
}

export const covers = (c: Check, id: string): boolean => (c.fixtures instanceof RegExp ? c.fixtures.test(id) : c.fixtures.includes(id));
export const CHECKS: Check[] = [];
/** Registers a check with the pass; returns its name. */
const check = (c: Check): string => {
  if (CHECKS.some((x) => x.name === c.name)) throw new Error(`two checks named ${c.name}`);
  CHECKS.push(c);
  return c.name;
};

// ---------------------------------------------------------------------------------------------------------------------
// The transition audit (plan 08, 10b, 12)

// Plan 12 known audit cases (listed in docs/handoff/plan12.md): boundary (fixture, time, player, landmark) and its bound (m)
// Plan 13e known case (user ruling, bounded): on the supplied walk and run clips L3-F3-recover's right knee crosses its
// step-to-step boundary at 0.725 s by 1.144 cm
const KNOWN_AUDIT: Record<string, number> = { 'L3-F7-mirror0 0.7875 R leftAnkle': 0.0101, 'L3-F3-recover 0.7250 R rightKnee': 0.0115 };

export const AUDIT = check({
  name: 'transition audit',
  fixtures: /^L3-/,
  // every L3 case: free movement, contact, recontact, landing and airborne recovery, contact interrupted by falling
  watch(d, report) {
    const ok = softly(report);
    // every reseed the pose takes as a new owner, seen from outside the audit
    const seeds = new Map<string, number>();
    const reseeds: { t: number; id: string }[] = [];
    return {
      substep(s) {
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
      finish(sim) {
        const ds = sim.transitionDeltas;
        for (const x of ds) {
          ok(() => expect(Object.keys(x.rawBy).length, d.id).toBeGreaterThan(20));
          // plan 12 known case (handoff): R's left foot on its toe at the ankle limit lifts into a step inside a contact pile. The
          // new owner turns its heading at its yaw rate and takes the achieved foot angle, and the shown leg leaves clearance
          // variant 1 for the primary one: 1.009 cm at the ankle. Bounded here, not let go
          const known = KNOWN_AUDIT[`${d.id} ${x.t.toFixed(4)} ${x.playerId} ${x.landmark}`];
          ok(() => expect(x.deltaM, `${d.id} ${x.t.toFixed(4)} ${x.playerId} ${x.landmark} ${x.from} > ${x.to} raw ${x.rawM.toFixed(4)}`).toBeLessThanOrEqual(known ?? 0.01));
        }
        for (const r of reseeds) ok(() => expect(ds.some((x) => x.playerId === r.id && Math.abs(x.t - r.t) < 1e-9), `${d.id} reseed of ${r.id} at ${r.t.toFixed(5)} has no boundary`).toBe(true));
      },
    };
  },
});

/** A watch that keeps the run's audited boundaries for a finish that reads them. */
const onDeltas =
  (f: (ds: TransitionDelta[], sim: Simulation) => void): Check['watch'] =>
  () => ({ finish: (sim) => f(sim.transitionDeltas, sim) });

export const RESEED = check({
  name: 'a reseed that keeps mode and source',
  fixtures: ['L3-F7-phase75'],
  // L3-F7-phase75: R's right foot, planted on the ball of the foot, is released by clearance and planted again in the next
  // substep with no change of mode or source: the pose takes it as a new owner, so the old owner's continuation has to be
  // what the live foot is compared with. (Before plan 12: L3-F1-phase5, D's right foot reseeded three times early in the
  // run; with the ankle range and heel lift those proposals no longer fail.)
  watch: onDeltas((all) => {
    const ds = all.filter((x) => x.playerId === 'R');
    for (const t of [0.541667]) {
      const x = ds.find((b) => Math.abs(b.t - t) < 1e-5);
      expect(x, `no boundary at ${t}`).toBeTruthy();
      expect(x!.from.replace(/#\d+/g, ''), `${t}`).toBe(x!.to.replace(/#\d+/g, ''));
      expect(x!.from, `${t}`).not.toBe(x!.to);
      expect(dist(x!.legs.right.old.request, x!.legs.right.now.request), `${t}`).toBeGreaterThan(0);
    }
  }),
});

export const STEP_AS_IS = check({
  name: 'a step compared with its old path as it is',
  fixtures: ['L3-F1-phase6'],
  // A step that loses support (first L3-F1-low: D's step out of time). Before 10b the reference carried a timed-out step's
  // stored motion on (stepStopM) because the old path stopped dead; the step now slows within its limit, so there is
  // nothing to carry on. L3-F1-phase6: the run's only supported-to-airborne boundary of D, 1.26 s (plan 12: L3-F1-low's
  // D no longer loses support on a step, its boundary at 1.65 s is gone; plan 13d: nor does L3-F1-phase5's at 1.55 s)
  watch: onDeltas((ds) => {
    const x = ds.find((b) => b.playerId === 'D' && b.to.includes('airborne') && !b.from.includes('airborne'));
    expect(x).toBeTruthy();
    expect(x!.legs.right.old.kind).toBe('target');
    expect(x!.deltaM).toBe(x!.rawM);
    expect('stepStopM' in x!).toBe(false);
  }),
});

export const RAW_KEPT = check({
  name: 'the raw difference and what was set aside',
  fixtures: ['L3-F7-phase0', 'L3-F1-mirror4'],
  watch: (d) => ({
    finish(sim) {
      const ds = sim.transitionDeltas;
      if (d.id === 'L3-F7-phase0') {
        // L3-F7-phase0: before 10b the collision turned the travel direction, the clip heading snapped to it and the old
        // path's request jolted (two boundaries over 1 cm raw, passed only through the correction). The heading now follows at
        // a bounded rate (B3): nothing there is over 1 cm before or after the correction
        const f7 = nonEmpty(ds, 'L3-F7-phase0 boundaries');
        for (const x of f7) expect(x.rawM, `L3-F7-phase0 ${x.t}`).toBeLessThanOrEqual(0.01);
      } else {
        // what still jumps is the body-frame request when contact entry turns the body (the angular impulse; the clip itself
        // is the same in both compositions). Plan 13d: no L3 boundary is over 1 cm raw any more (L3-F1-mirror0 D 0.479 s was
        // 1.76 cm), so the record is a boundary the correction set at least 5 mm aside: L3-F1-mirror4 D 0.479 s, raw 0.99 cm,
        // 0.22 cm after it
        const jolted = nonEmpty(ds.filter((x) => x.rawM - x.deltaM > 0.005), 'jolted boundaries');
        for (const x of jolted) expect(Math.max(...Object.values(x.requestJumpM))).toBeGreaterThan(0);
      }
      // the two measures differ only where a demonstrated artifact was corrected; every boundary keeps all three numbers
      for (const x of ds) {
        expect(Object.keys(x.rawBy).sort()).toEqual(Object.keys(x.by).sort());
        expect(Number.isFinite(x.continuedM)).toBe(true);
        if (Math.max(...Object.values(x.requestJumpM)) === 0) expect(x.deltaM).toBeCloseTo(x.rawM, 10);
      }
    },
  }),
});

export const NOT_TWICE = check({
  name: 'a jump the offset took up is not corrected again',
  // the planner takes a request jump over 15 m/s into the offset: the reference must not subtract it again
  fixtures: ['L3-F1-phase3', 'L3-F1-low', 'L3-F9-noProbe-prep', 'L3-F9-playerBelow'],
  watch: (d) => ({
    finish(sim) {
      for (const x of sim.transitionDeltas) for (const m of Object.values(x.requestJumpM)) expect(m * 240, `${d.id} ${x.t}`).toBeLessThanOrEqual(15);
    },
  }),
});

export const LANDINGS = check({
  name: 'a landing compared with the old step path as it is',
  // L3-F3-side: before 10b, R's step at 0.32 s ran out of time at the speed cap and its old path stood still 5 cm past
  // the plant the substep after (the stop the stepStopM reference carried on); across L3 that correction carried 14
  // boundaries over 1 cm, up to 6.9 cm. Now every step-to-plant landing passes with nothing set aside
  fixtures: ['L3-F3-side', 'L3-F3-sideMirror', 'L3-F5-drag', 'L3-F8-recontact'],
  watch: (d) => ({
    finish(sim) {
      const id = d.id;
      const landings = sim.transitionDeltas.filter((b) => SIDES.some((s) => b.legs[s].old.kind === 'target' && b.legs[s].now.kind === 'plant'));
      expect(landings.length, id).toBeGreaterThan(1);
      for (const x of landings) {
        expect(x.rawM, `${id} ${x.t.toFixed(4)} ${x.playerId}`).toBeLessThanOrEqual(0.01);
        if (Math.max(...Object.values(x.requestJumpM)) === 0) expect(x.deltaM).toBe(x.rawM);
      }
    },
  }),
});

export const HANDOVER = { carried: 0, kept: 0, airborne: 0, overdue: 0 };
export const HELD_LEG = check({
  name: 'a held leg handed to a step, a support loss keeping a step on its path',
  // (plan 12: the overdue step that loses support moved out of these runs with the heel lift; L3-F9-noProbe-exit R's right
  // foot has one at 0.6333 s)
  fixtures: /^L3-F(1-low|1-phase4|3-collision|9-noProbe-contact|9-noProbe-free|9-noProbe-prep|9-noProbe-exit|11-invalid)$/,
  watch(d) {
    const was = new Map<string, { carried: boolean; seeds: number; mode: string; source: string; late: boolean; moveV: Vec3; target: Vec3; aMax: number }>();
    return {
      substep(s) {
        for (const pl of s.players)
          for (const side of SIDES) {
            const f = pl.feet?.feet[side];
            if (!f || pl.rag) continue;
            const k = `${pl.id}:${side}`;
            const p = was.get(k);
            if (p && !p.carried && f.carried) {
              HANDOVER.carried++;
              expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
              const x = s.transitionDeltas.filter((b) => b.playerId === pl.id).at(-1)!;
              expect(x.t, `${d.id} ${s.t}`).toBeCloseTo(s.t, 9);
              // on the ground old and new are one path here, less what the lift cap takes off the old path's motion in the step's
              // first update; a support loss adds the request's seam
              const cut = Math.max(0, Math.abs(f.requestWasV.y + f.offsetV.y) - FOOTWORK_L3.swing.maxLiftRateMps) * s.dt;
              expect(dist(x.legs[side].old.ankle, x.legs[side].now.ankle), `${d.id} ${s.t}`).toBeLessThan(f.mode === 'airborne' ? 0.01 : 1e-3 + cut);
            }
            if (p && p.mode === 'swing' && p.source === 'step' && f.mode === 'airborne' && f.source === 'step') {
              HANDOVER.kept++;
              expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
              if (p.late) {
                // a step past its time goes on from the motion it had, not from a path velocity it dropped: its motion changes by
                // at most the step's declared acceleration over the substep, plus what the speed cap takes off (plan 10b; this
                // was a window of -2/+2 m/s around the last speed, with half the speed as the floor, which a bounded reversal
                // through zero speed breaks)
                HANDOVER.overdue++;
                const sp = len(horiz(pl.proxy.body.linvel()));
                const C = FOOTWORK_L3.compose!;
                const vNow = scale(horiz(sub(f.target, p.target)), 1 / s.dt);
                const cut = Math.max(0, len(p.moveV) - (FOOTWORK_L3.swing.maxSpeedMps + FOOTWORK_L3.swing.travelSpeedK * sp));
                expect(len(sub(vNow, p.moveV)), `${d.id} ${s.t}`).toBeLessThanOrEqual(Math.max(C.stepAccelMps2 + C.stepAccelPerTravel * sp, p.aMax) * s.dt + cut + 1e-9);
              }
            }
            // a held leg that loses support stays on the old owner's path too
            if (p && p.mode === 'swing' && p.source === 'follow' && f.mode === 'airborne' && f.source === 'step' && f.carried) {
              HANDOVER.airborne++;
              expect(f.seeds, `${d.id} ${s.t}`).toBe(p.seeds);
            }
            const C = FOOTWORK_L3.compose!;
            was.set(k, { carried: f.carried, seeds: f.seeds, mode: f.mode, source: f.source, late: f.elapsedS >= f.durS, moveV: { ...f.moveV }, target: { ...f.target }, aMax: C.stepAccelMps2 + C.stepAccelPerTravel * len(horiz(pl.proxy.body.linvel())) });
          }
      },
    };
  },
});

export const SEAMS = { n: 0 };
export const SEAM = check({
  name: 'a request seam taken up by the offset',
  fixtures: /^L3-F9-(lift-free|playerBelow)$/,
  watch(d) {
    const was = new Map<string, Vec3>();
    return {
      substep(s) {
        for (const pl of s.players)
          for (const side of SIDES) {
            const f = pl.feet?.feet[side];
            if (!f || pl.rag) continue;
            const k = `${pl.id}:${side}`;
            const last = was.get(k);
            if (last && len(f.seamOffset) > 0.02) {
              SEAMS.n++;
              // the 34 cm of the request's seam stay out of the foot
              expect(dist(f.target, last) / s.dt, `${d.id} ${pl.id} ${s.t}`).toBeLessThan(15);
            }
            was.set(k, { ...f.target });
          }
      },
    };
  },
});

export const FRESH_PLANT = check({
  name: 'a fresh plant not stepped from the moment it lands',
  // at speed the reach-time trigger would release a foot one substep after its touchdown
  fixtures: /^L3-F(3-side|5-drag)$/,
  watch: (d) => ({
    finish(sim) {
      const quick = sim.events.filter((e) => e.type === 'footRelease' && e.data!.reason === 'reach' && Number(e.data!.solves) <= 1);
      expect(quick, d.id).toHaveLength(0);
    },
  }),
});

// The audit reads copies: the audited side of the comparison comes from the pass (each substep's planner, sampler and
// pose state, hashed), the unaudited side is run in the test. The stated sample: the first fixture of each L3 family
// (F1-F17) and the five the audit was first checked on
export const FIRST = new Map<string, string>();
for (const d of L3(/^L3-/)) FIRST.set(d.id.split('-').slice(0, 2).join('-'), FIRST.get(d.id.split('-').slice(0, 2).join('-')) ?? d.id);
export const COPY_IDS = [...new Set([...FIRST.values(), 'L3-F16-runStop', 'L3-F7-phase25', 'L3-F4-twoArm', 'L3-F9-noProbe-prep', 'L3-F3-side'])];
/** Every substep's foot plan, run-clip playback, pose memory, locomotion state, walking request and published pose. */
const stateKey = (s: Simulation): string =>
  createHash('sha1')
    .update(JSON.stringify(s.players.map((pl) => [pl.feet, pl.run, pl.poseMemory, pl.loco, pl.walkRequest, pl.walkWant, pl.pose])))
    .digest('base64');
const AUDITED = new Map<string, { states: string[]; trace: TraceRow[]; events: string; n: number }>();
export const COPIES = check({
  name: 'the audited runs of the copy comparison',
  fixtures: COPY_IDS,
  watch(d) {
    const states: string[] = [];
    return {
      substep: (s) => states.push(stateKey(s)),
      finish: (sim) => AUDITED.set(d.id, { states, trace: sim.trace, events: JSON.stringify(sim.events), n: sim.transitionDeltas.length + sim.events.length }),
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Foot target continuity (plan 10b): the composed foot planner's step targets move continuously inside an ownership
// (B1), a step's stored vertical motion is the published one (B2), and the clip's leg request has no jump of its own (B3)

export const C = FOOTWORK_L3.compose!;
const SW = FOOTWORK_L3.swing;
const aMaxAt = (sp: number): number => C.stepAccelMps2 + C.stepAccelPerTravel * sp;
const vCapAt = (sp: number): number => SW.maxSpeedMps + SW.travelSpeedK * sp;

export type ContinuitySeen = { steps: number; stored: number; chaseStarts: number; chaseReseeds: number; chaseInside: number; requests: number };
/** What the per-substep checks saw over every L3 fixture of the pass. */
export const seen: ContinuitySeen = { steps: 0, stored: 0, chaseStarts: 0, chaseReseeds: 0, chaseInside: 0, requests: 0 };

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

export interface Continuity {
  breaches: Breach[];
  outOfTime: { at: string; t: number; speed: number; next: number; aMax: number }[];
  requestDD: { d: number; at: string }[];
  overdue: { at: string; n: number }[];
}

/**
 * Watches a run (with the transition audit, which reads copies) and checks at every substep, for every foot of every
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
export function continuity(d: FixtureDef, into: ContinuitySeen): { watch: Watch; out: Continuity } {
  const out: Continuity = { breaches: [], outOfTime: [], requestDD: [], overdue: [] };
  const { breaches, outOfTime, requestDD, overdue } = out;
  // continued steps past their time: substeps per step
  const over = new Map<string, { at: string; n: number }>();
  const hist = new Map<string, Row[]>();
  const late = new Map<string, { t: number; speed: number; aMax: number } | null>();
  const reqs = new Map<string, { p: Vec3; ok: boolean }[]>();
  const watch: Watch = {
    substep: (s: Simulation) => {
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
              into.requests++;
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
          else if (o) {
            overdue.push(o);
            over.delete(`${pl.id}:${side}`);
          }
          const step = f.mode !== 'planted' && f.source === 'step' && !f.wait && !f.rejoin;
          const row: Row = { key: `${f.mode !== 'planted'}/${f.source}/${f.seeds}/${f.wait}/${f.rejoin}`, mode: f.mode, source: f.source, seeds: f.seeds, h: { x: f.target.x, y: 0, z: f.target.z }, y: f.target.y, vy: f.stepY.v, sy: f.solvedW.y, avy: f.ankleV.y, aMax: aMaxAt(sp), vCap: vCapAt(sp) };
          const k = `${pl.id}:${side}`;
          const h = hist.get(k) ?? [];
          h.push(row);
          if (h.length > 3) h.shift();
          hist.set(k, h);
          const [r0, r1, r2] = h.length === 3 ? h : [undefined, h[0], h[1]];
          if (!r1 || !r2 || dt <= 0) continue;
          // B2: the stored vertical rate is the published one
          if (f.mode !== 'planted' && f.source === 'step' && r1.key === r2.key) {
            into.stored++;
            const pub = (r2.y - r1.y) / dt;
            if (Math.abs(f.stepY.v - pub) > 1e-9) breaches.push({ what: 'stored vertical rate', at, got: f.stepY.v, limit: pub });
          }
          // B1: the step's horizontal second difference
          if (step && r0 && r0.key === r2.key && r1.key === r2.key) {
            into.steps++;
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
            // (a step one row old started from the achieved request, not from the old owner's target: the two differ where the
            // pose lifts a foot at its ankle range limit off the floor, plan 12)
            const from = reseed ? { y: r1.sy, v: r1.avy } : { y: r1.y, v: (r1.y - (r0.seeds !== r1.seeds ? r0.sy : r0.y)) / dt };
            if (reseed) into.chaseReseeds++;
            else if (r1.mode === 'airborne' && r1.source === 'step') into.chaseInside++;
            else into.chaseStarts++;
            const acc = Math.abs((r2.y - from.y) / dt - from.v) / dt;
            // plus what the lift cap takes off a start faster than it (plan 12: L3-F9-noProbe-exit D's left foot reseeds at 0.6875 s
            // from an ankle the lifted hip carries up at 1.70 m/s, over the 1.5 m/s cap; B1 allows the speed cap the same way)
            const cut = Math.max(0, Math.abs(from.v) - FOOTWORK_L3.swing.maxLiftRateMps) / dt;
            if (acc > C.liftAccelMps2 + cut + 1e-9) breaches.push({ what: `chase vertical acceleration${reseed ? ' (reseed)' : ''}`, at, got: acc, limit: C.liftAccelMps2 + cut });
          }
          // a step whose time runs out while it moves (the B1 reproductions): its motion over the next substep
          const was = late.get(k);
          if (was) outOfTime.push({ at: k, t: was.t, speed: was.speed, next: len(sub(r2.h, r1.h)) / dt, aMax: was.aMax });
          late.set(k, step && f.mode === 'swing' && r1.key === r2.key && f.elapsedS >= f.durS && f.elapsedS - dt < f.durS ? { t: s.t, speed: len(sub(r2.h, r1.h)) / dt, aMax: Math.max(r1.aMax, r2.aMax) } : null);
        }
      }
    },
    finish: () => {
      overdue.push(...over.values());
    },
  };
  return { watch, out };
}

/** Each L3 fixture's continuity record from the pass. */
export const CONT = new Map<string, Continuity>();
export const CONTINUITY = check({
  name: 'foot-target continuity',
  fixtures: /^L3-/,
  watch(d, report) {
    const ok = softly(report);
    const c = continuity(d, seen);
    CONT.set(d.id, c.out);
    return {
      substep: c.watch.substep,
      finish(sim) {
        c.watch.finish!(sim);
        const { breaches, requestDD } = c.out;
        ok(() => expect(breaches.slice(0, 5).map((b) => `${b.what} ${b.at}: ${b.got} > ${b.limit}`), `${breaches.length} breaches`).toEqual([]));
        ok(() => expect(requestDD.slice(0, 5).map((r) => `${r.at}: ${r.d}`), `${requestDD.length} request jumps`).toEqual([]));
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Foot limits at every actual substep (plan 08)

export const LIFT = FOOTWORK_L3.swing.maxLiftRateMps;
const REJOIN = FOOTWORK_L3.rejoinMps;
type FeetSeen = { lift: number; offset: number; nLift: number; nOffset: number; ownerChanges: number; gap: number; gapLevel: number; gapStepY: number; nStepReseeds: number; nCarried: number; carriedStat: number; carriedFlat: number };
type Counters = { lift: number; offset: number; margin: number };
/**
 * The vertical target speed and the offset recovery speed from outside the planner, between two substeps of one seed: a step
 * also from the substep it takes over without a reseed (a carried leg), or changes mode on its path. `carriedStat` and
 * `carriedFlat` are how far the planner's own record of that first update is from what it published, vertically and level.
 */
function footLimits(): { watch: Watch; seen: FeetSeen } {
  const seen: FeetSeen = { lift: 0, offset: 0, nLift: 0, nOffset: 0, ownerChanges: 0, gap: 0, gapLevel: 0, gapStepY: 0, nStepReseeds: 0, nCarried: 0, carriedStat: 0, carriedFlat: 0 };
  const last = new Map<string, { source: string; mode: string; target: Vec3; offset: Vec3; seeds: number; solved: Vec3; recoord: boolean; speed: number }>();
  const watch: Watch = {
    substep: (s) => {
      for (const pl of s.players)
        for (const side of SIDES) {
          const f = pl.feet?.feet[side];
          // a converted player has no planner update: its stored rates are the last substep's, nothing moves the plan
          if (!f || pl.rag) continue;
          const k = `${pl.id}:${side}`;
          const p = last.get(k);
          const v = pl.proxy.body.linvel();
          const speed = Math.hypot(v.x, v.z);
          const same = !!p && p.seeds === f.seeds && !p.recoord && !f.rejoin;
          if (p && same && f.mode !== 'planted') {
            if (f.source === 'step') {
              const rate = Math.abs(f.target.y - p.target.y) / s.dt;
              seen.lift = Math.max(seen.lift, rate);
              seen.nLift++;
              if (p.source !== 'step') {
                seen.nCarried++;
                seen.carriedStat = Math.max(seen.carriedStat, Math.abs(f.liftRateMps - rate));
                seen.carriedFlat = Math.max(seen.carriedFlat, Math.abs(f.speedMps - len(horiz(sub(f.target, p.target))) / s.dt));
              }
            } else if (f.source === 'follow' && p.source === 'follow' && p.mode === f.mode && !f.wait) {
              // relative to the moving request; a request jump or seam is a change of coordinates the offset takes up
              seen.offset = Math.max(seen.offset, len(sub(sub(f.offset, p.offset), f.seamOffset)) / s.dt);
              seen.nOffset++;
            }
          } else if (p && p.seeds !== f.seeds) {
            // a reseed keeps the foot: the new owner's target starts one substep from the achieved foot. Level: within the
            // step speed cap at the body's travel speed (the fastest any owner moves a target, plan 10b), as a fraction of
            // it; a step's height within the lift cap. A follow owner's height is the request's; a plant's is the floor
            seen.ownerChanges++;
            seen.gap = Math.max(seen.gap, dist(f.target, p.solved));
            const cap = (SW.maxSpeedMps + SW.travelSpeedK * Math.max(speed, p.speed)) * s.dt;
            seen.gapLevel = Math.max(seen.gapLevel, len(horiz(sub(f.target, p.solved))) / cap);
            if (f.source === 'step' && f.mode !== 'planted') {
              seen.nStepReseeds++;
              seen.gapStepY = Math.max(seen.gapStepY, Math.abs(f.target.y - p.solved.y) / (LIFT * s.dt));
            }
          }
          last.set(k, { source: f.source, mode: f.mode, target: { ...f.target }, offset: { ...f.offset }, seeds: f.seeds, solved: { ...f.solvedW }, recoord: f.rejoin || f.wait, speed });
        }
    },
  };
  return { watch, seen };
}
const counters = (sim: Simulation): Counters => ({
  lift: Math.max(...sim.players.map((p) => p.feet?.stats.liftRateMps ?? 0)),
  offset: Math.max(...sim.players.map((p) => p.feet?.stats.offsetDecayMps ?? 0)),
  margin: Math.min(...sim.players.map((p) => p.feet?.stats.stepCapMarginMps ?? Infinity)),
});

/** Each L3 fixture's foot-limit record from the pass. */
export const FEET = new Map<string, { seen: FeetSeen; c: Counters }>();
export const FOOT_LIMITS = check({
  name: 'foot limits',
  fixtures: /^L3-/,
  watch(d, report) {
    const ok = softly(report);
    const m = footLimits();
    return {
      substep: m.watch.substep,
      finish(sim) {
        const { seen } = m;
        const c = counters(sim);
        FEET.set(d.id, { seen, c });
        ok(() => expect(c.lift, d.id).toBeLessThanOrEqual(LIFT + 1e-6));
        ok(() => expect(c.offset, d.id).toBeLessThanOrEqual(REJOIN + 1e-6));
        ok(() => expect(seen.lift, d.id).toBeLessThanOrEqual(LIFT + 1e-6));
        ok(() => expect(seen.offset, d.id).toBeLessThanOrEqual(REJOIN + 1e-6));
        ok(() => expect(seen.gap, d.id).toBeLessThan(0.1));
        ok(() => expect(seen.gapLevel, d.id).toBeLessThanOrEqual(1 + 1e-9));
        ok(() => expect(seen.gapStepY, d.id).toBeLessThanOrEqual(1 + 1e-9));
        ok(() => expect(seen.carriedStat, d.id).toBeLessThan(1e-6));
        ok(() => expect(seen.carriedFlat, d.id).toBeLessThan(1e-6));
        ok(() => expect(c.margin, d.id).toBeGreaterThanOrEqual(-1e-9));
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Plan 08 pass 1 and 2: start, brake, settle; idle and walking

/** The player the stop checks follow. */
const STOPS = /^L3-F16-(runStop|stop\d)/;

export const OFF_GROUND = check({
  name: 'never long off the ground',
  fixtures: /^L3-F(16-(reaccel|runStop$|runStopFree|stop\d)|7-)/,
  watch(d) {
    // steady Fast Run has 0.12 s of flight; the skipped stance this guards against was 0.37 s
    let R: Simulation['players'][number] | undefined;
    let upS = 0;
    let worst = 0;
    let stopped = false;
    return {
      tick(sim) {
        R ??= d.id.startsWith('L3-F7') ? sim.byId.get('R')! : sim.players[0];
        if (stopped) return;
        if (R.rag || !R.feet || !R.pose) {
          stopped = true;
          return;
        }
        const j = R.pose.jointLandmarksWorld;
        const v = R.proxy.body.linvel();
        const onGround = SIDES.some((s) => R!.feet!.feet[s].mode === 'planted') || Math.min(j.leftAnkle.y, j.rightAnkle.y) < 0.2;
        upS = onGround || R.loco?.mode === 'contact' || Math.hypot(v.x, v.z) < 3 ? 0 : upS + 1 / 60;
        worst = Math.max(worst, upS);
      },
      finish() {
        expect(worst, d.id).toBeLessThan(0.25);
      },
    };
  },
});

export const BRAKE = check({
  name: 'brake phases valid',
  fixtures: /^L3-F16-/,
  watch: (d) => ({
    finish(sim) {
      expect(sim.result === 'duration' || sim.result === 'practiceOutOfBounds', `${d.id} ${sim.result}`).toBe(true);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      // the kick leaves the ground: a landing proposal may fail honestly there
      // the stopping player's own plants: L3-F16-contactStop's defender fails one honestly in contact, by 1.8 cm of reach.
      // Plan 13e: a foot still sliding at the crossing continues as a swing (L3-F16-stop1.9's right foot was planted
      // sliding at 0.33 m/s and failed in 13d)
      const failed = sim.events.filter((e) => e.type === 'footPlantFailed' && e.playerId === sim.players[0].id).length;
      expect(failed, d.id).toBeLessThanOrEqual(d.id === 'L3-F16-kick' ? 2 : 0);
    },
  }),
});

export const SETTLES = check({
  name: 'a full stop settles',
  fixtures: STOPS,
  watch: (d) => ({
    finish(sim) {
      expect(sim.result, d.id).toBe('duration');
      const R = sim.players[0];
      const v = R.proxy.body.linvel();
      expect(Math.hypot(v.x, v.z), d.id).toBeLessThan(0.01);
      for (const s of SIDES) {
        expect(R.feet!.feet[s].mode, d.id).toBe('planted');
        expect(R.feet!.feet[s].tentative, d.id).toBe(false);
      }
      const last = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === R.id).at(-1)!;
      // plan 13d: L3-F16-stop2.9's squaring step (8.5 cm, left foot) comes 0.41 s before the end: the final heel sits 2.5 cm
      // further from the root, so the slow creep crosses the settle trigger later (0.56 s before, old margin 0.16 s)
      expect(sim.t - last.t, d.id).toBeGreaterThan(d.id === 'L3-F16-stop2.9' ? 0.4 : 0.5);
      expect(count(sim, 'footPlantFailed'), d.id).toBe(0);
    },
  }),
});

export const ONE_FOOT = check({
  name: 'a stop lands one foot then the other',
  fixtures: STOPS,
  watch: (d) => ({
    finish(sim) {
      const R = sim.players[0];
      const ctl = d.players[0].controller;
      const brake = ctl.kind === 'script' ? ctl.segments.at(-1)!.fromS : 0;
      const plants = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === R.id && e.t > brake);
      expect(plants.length, d.id).toBeGreaterThan(3);
      for (let i = 1; i < plants.length; i++) {
        if (plants[i]!.data?.side === plants[i - 1]!.data?.side) continue;
        expect(plants[i]!.t - plants[i - 1]!.t, `${d.id} landings at ${plants[i - 1]!.t}`).toBeGreaterThan(0.1);
      }
    },
  }),
});

/** Plan 13d: the stride share of a constant run above Fast Run's slowest cadence stays 1 on every tick (a substep that
 * measured no travel, the first after setup, used to pull it toward minStride for half a second). */
export const FULL_STRIDE = check({
  name: 'a constant run keeps the full stride',
  fixtures: ['L3-F16-sprint'],
  watch() {
    let worst = 1;
    let at = NaN;
    return {
      tick(sim) {
        const s = sim.players[0].run?.share;
        if (s !== undefined && s < worst) {
          worst = s;
          at = sim.t;
        }
      },
      finish() {
        expect(worst, `at ${at}`).toBe(1);
      },
    };
  },
});

export const RUN_START = check({
  name: 'a run start goes foot by foot',
  fixtures: /^L3-F17-/,
  watch: () => ({
    finish(sim) {
      const lands = sim.events.filter((e) => e.type === 'footPlant' && e.t > 0.1 && e.t < 2.6);
      expect(lands.length).toBeGreaterThanOrEqual(5);
      let last = 0;
      lands.forEach((e, i) => {
        if (!i) return;
        expect(e.data!.side, `plant at ${e.t}`).not.toBe(lands[i - 1].data!.side);
        expect(e.t - lands[i - 1].t, `plant at ${e.t}`).toBeGreaterThan(0.2);
        const step = Math.abs((e.data!.at as number[])[0] - (lands[i - 1].data!.at as number[])[0]);
        if (i < 3) expect(step, `plant at ${e.t}`).toBeGreaterThan(last); // full stride by the third step
        last = step;
      });
      // plan 13d: 1.39 (was 1.4): the last step is the short half of Fast Run's uneven stride (1.396 + 1.713 m, its
      // recorded 3.111 m); before 13d the top of the start blended toward a longer stride (1.406 + 1.758 m)
      expect(last).toBeGreaterThan(1.39);
    },
  }),
});

export const TOE_OFF = check({
  name: 'L3-F16: the toe-off release and the 2.55 s variant',
  fixtures: ['L3-F16-runStop', 'L3-F16-stop2.55'],
  watch(d) {
    let p: ReturnType<typeof peaks> | undefined;
    return {
      tick(sim) {
        (p ??= peaks(sim, LIMBS, 2.4))();
      },
      finish(sim) {
        const id = d.id;
        expect(p!.peak.d, id).toBeLessThan(0.09);
        const R = sim.players[0];
        expect(R.feet!.feet.left.mode, id).toBe('planted');
        expect(R.feet!.feet.right.mode, id).toBe('planted');
        const last = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === 'R').at(-1)!;
        expect(last.t, id).toBeLessThan(4.6);
      },
    };
  },
});

export const STOP_MOTOR = check({
  name: 'the stop keeps the plan 07 motor, the lower stance and individual steps',
  fixtures: ['L3-F16-runStop'],
  watch(def) {
    let low = Infinity;
    let cross = NaN;
    const both: number[] = [];
    return {
      tick(sim) {
        const R = sim.players[0];
        if (sim.t > 2.6 && sim.t < 4) {
          low = Math.min(low, R.proxy.body.translation().y);
          if (R.feet!.feet.left.mode === 'swing' && R.feet!.feet.right.mode === 'swing') both.push(sim.t);
        }
        if (sim.t > 2.6 && Number.isNaN(cross) && (R.run?.w ?? 0) === 0) cross = sim.t;
      },
      finish(sim) {
        const src = FIX('L2-F3-runStop');
        expect(def.motor).toEqual(src.motor);
        expect(def.support).toEqual(src.support);
        expect(low).toBeLessThan(0.84);
        // the run's own flight ends with the clip: from the first plant of the handover on one foot is always down (the
        // planner takes the legs only when the foot in the air can land in time: that plant is at 3.28 s; plan 12: 3.325 s,
        // the stance foot rises onto its toes and stays within reach 46 ms longer, and the step keeps the time its path needs).
        // Plan 13d: measured from the crossing (the first tick at clip weight 0), which moved from 3.183 s to 3.517 s with
        // the fade band; the handover plant within 0.1467 s of it (3.33 s - 3.183 s before), now at 3.5875 s
        expect(cross).toBeGreaterThan(2.6);
        const down = sim.events.find((e) => e.type === 'footPlant' && e.t > cross)!;
        expect(down.t - cross).toBeLessThan(0.1467);
        expect(both.filter((t) => t > down.t)).toEqual([]);
      },
    };
  },
});

/** The palm-to-shoulder reach of each arm at 3.3 s (the free arm braces, the carry arm stays on the ball). */
export const REACH_AT = new Map<string, { left: number; right: number }>();
export const FREE_ARMS = check({
  name: 'free arms brace at the stop',
  fixtures: ['L3-F16-runStopFree', 'L3-F16-runStop'],
  watch(d) {
    let got = false;
    const take = (sim: Simulation): void => {
      const R = sim.players[0];
      const lm = R.pose!.jointLandmarksWorld;
      REACH_AT.set(d.id, { left: dist(lm.leftPalm, lm.leftShoulder), right: dist(lm.rightPalm, lm.rightShoulder) });
      got = true;
    };
    // the first state at or after 3.3 s (or the last, if the run ends first)
    return {
      tick(sim) {
        if (!got && !(sim.t < 3.3)) take(sim);
      },
      finish(sim) {
        if (!got) take(sim);
      },
    };
  },
});

export const STANDS_STILL = check({
  name: 'L3-F13: stands still',
  fixtures: ['L3-F13-carrier', 'L3-F13-free', 'L3-F13-ready'],
  watch(d) {
    let p: ReturnType<typeof peaks> | undefined;
    return {
      tick(sim) {
        (p ??= peaks(sim, ['leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'], 0.5))();
      },
      finish(sim) {
        expect(count(sim, 'footPlant', 'R'), d.id).toBeLessThanOrEqual(2);
        expect(p!.peak.d, d.id).toBeLessThan(0.002);
      },
    };
  },
});

export const SETTLE_PLANTS = check({
  name: 'L3-F13: stops settle on existing plants',
  fixtures: /^L3-F13-settle/,
  watch: (d) => ({
    finish(sim) {
      const last = sim.events.filter((e) => e.type === 'footPlant').at(-1)!;
      expect(last.t, d.id).toBeLessThan(d.durationS - 0.5);
      expect(sim.players[0].feet!.feet.left.mode).toBe('planted');
      expect(sim.players[0].feet!.feet.right.mode).toBe('planted');
    },
  }),
});

// Plan 13e: the idle cycle on every model-body L3 fixture (the authored body keeps the static posture). The weight is in
// [0, 1], moves at most its rate a substep and is 0 once the player has been out of free supported movement (contact
// among them) or above IDLE_STANCE_FADE_MPS for longer than a full fade; the head turns on the core by at most the
// cycle's measured bound times the weight
export const IDLE_WEIGHT = check({
  name: 'plan 13e: the idle weight follows the stance fade and the mode; the head stays within the cycle',
  fixtures: /^L3-/,
  watch(d) {
    const P = d.locomotion;
    const C = P?.idle.cycle;
    if (!P || !C) return {};
    const fadeS = 1 / P.contact.weightRatePerS + 1e-9;
    const offS = new Map<string, number>();
    let last = new Map<string, number>();
    return {
      substep(s) {
        const now = new Map<string, number>();
        for (const pl of s.players) {
          if (pl.rag || !pl.loco || !pl.pose) continue;
          const w = pl.loco.idleW!;
          expect(w >= 0 && w <= 1, `${d.id} ${pl.id} ${s.t.toFixed(4)} idle weight ${w}`).toBe(true);
          const prev = last.get(pl.id);
          if (prev !== undefined) expect(Math.abs(w - prev), `${d.id} ${pl.id} ${s.t.toFixed(4)} idle weight step`).toBeLessThanOrEqual(P.contact.weightRatePerS * s.dt + 1e-9);
          now.set(pl.id, w);
          const v = pl.proxy.body.linvel();
          const out = pl.loco.mode !== 'free' || !pl.grounded || pl.controlMode !== 'supported' || Math.hypot(v.x, v.z) >= IDLE_STANCE_FADE_MPS;
          const o = out ? (offS.get(pl.id) ?? 0) + s.dt : 0;
          offS.set(pl.id, o);
          if (o > fadeS + s.dt) expect(w, `${d.id} ${pl.id} ${s.t.toFixed(4)} idle weight after ${o.toFixed(3)} s out (${pl.loco.mode})`).toBe(0);
          const core = pl.pose.segments.core.rotationWorld;
          const head = pl.pose.segments.head.rotationWorld;
          // (the angle from the vector part: 2 acos(w) loses its digits near identity; the bound's 1e-3 deg is the record's rounding)
          const r = qMul(qConj(core), head);
          const deg = (2 * Math.atan2(Math.hypot(r.x, r.y, r.z), Math.abs(r.w)) * 180) / Math.PI;
          expect(deg, `${d.id} ${pl.id} ${s.t.toFixed(4)} head on the core`).toBeLessThanOrEqual(C.headMaxDeg * w + 1e-3);
        }
        last = now;
      },
    };
  },
});

// Plan 13e: no marching. Once a player has stood idle for 1 s (full idle weight, its own request zero) no foot leaves
// its plant, and every plant keeps its contact feature within the plan 07 tolerance of its anchor
export const IDLE_PLANTS = check({
  name: 'plan 13e: standing idle, the feet stay on their plants',
  fixtures: /^L3-F1[35]-/,
  watch(d) {
    const tol = (d.footwork ?? FOOTWORK_L3).plantTolM;
    const idleS = new Map<string, number>();
    let seen = 0;
    let long = 0;
    return {
      substep(s) {
        for (const pl of s.players) {
          if (pl.rag || !pl.loco || !pl.feet) continue;
          const r = pl.intent.locomotion.desiredVelocityWorld;
          const idle = (pl.loco.idleW ?? 0) >= 0.99 && Math.hypot(r.x, r.z) === 0;
          idleS.set(pl.id, idle ? (idleS.get(pl.id) ?? 0) + s.dt : 0);
          if (idleS.get(pl.id)! >= 1) long++;
          for (const side of SIDES) {
            const f = pl.feet.feet[side];
            if (f.mode === 'planted' && !f.tentative) expect(f.driftM, `${d.id} ${pl.id} ${side} ${s.t.toFixed(4)} plant drift`).toBeLessThanOrEqual(tol);
          }
        }
      },
      tick(s) {
        for (const e of s.events.slice(seen)) {
          // (a conversion releases both feet: not a step)
          if ((e.type !== 'footSwing' && e.type !== 'footRelease') || (e.data as { reason?: string })?.reason === 'ragdoll') continue;
          expect((idleS.get(e.playerId!) ?? 0) < 1, `${d.id} ${e.playerId} ${e.type} at ${e.t.toFixed(4)} after standing idle ${idleS.get(e.playerId!)?.toFixed(3)} s`).toBe(true);
        }
        seen = s.events.length;
      },
      finish() {
        if (/^L3-F1[35]-(carrier|free|ready|fitted)$/.test(d.id)) expect(long, `${d.id} substeps standing idle past 1 s`).toBeGreaterThan(240);
      },
    };
  },
});

export const FITTED = check({
  name: 'L3-F15: the fitted posture keeps the stance and converts valid',
  fixtures: ['L3-F15-fitted', 'L3-F15-handoff'],
  watch: (d) => ({
    finish(sim) {
      if (d.id === 'L3-F15-fitted') {
        const R = sim.players[0];
        const a = R.feet!.feet.left.ankleW;
        const b = R.feet!.feet.right.ankleW;
        expect(dist(a, b)).toBeGreaterThan(IDLE_POSE_RECORD.stance.widthM * 0.75);
      } else {
        expect(count(sim, 'handoffRejected')).toBe(0);
        expect(sim.players[0].representation).toBe('ragdoll');
      }
    },
  }),
});

export const ARM_SWING = check({
  name: 'L3-F14: a free arm swings at a walk, carry and ready keep their assignment',
  fixtures: ['L3-F14-forward', 'L3-F14-carrier', 'L3-F14-ready'],
  watch(d) {
    const lo = { left: Infinity, right: Infinity };
    const hi = { left: -Infinity, right: -Infinity };
    return {
      tick(sim) {
        const R = sim.players[0];
        if (!R.pose || sim.t < 1.4 || sim.t > 2.5) return; // steady walking: the ramped start has the clip by 1.3 s, the stop begins at 2.6 s
        const q = R.proxy.body.rotation();
        for (const side of SIDES) {
          const p = qRot(qConj({ x: q.x, y: q.y, z: q.z, w: q.w }), sub(R.pose.jointLandmarksWorld[`${side}Wrist`], R.proxy.body.translation() as Vec3));
          lo[side] = Math.min(lo[side], p.z);
          hi[side] = Math.max(hi[side], p.z);
        }
      },
      finish() {
        const range = (side: 'left' | 'right'): number => hi[side] - lo[side];
        if (d.id === 'L3-F14-forward') expect(range('left')).toBeGreaterThan(0.12);
        if (d.id === 'L3-F14-carrier') {
          expect(range('left')).toBeGreaterThan(0.12);
          expect(range('right')).toBeLessThan(0.05);
        }
        if (d.id === 'L3-F14-ready') expect(range('left')).toBeLessThan(0.05);
      },
    };
  },
});

export const WALK_STEPS = check({
  name: 'L3-F14: a walk starts and stops over steps',
  fixtures: ['L3-F14-forward'],
  watch() {
    let was = 0;
    let wasT = 0;
    let up = 0;
    let down = 0;
    let lateW = 0;
    return {
      tick(sim) {
        const R = sim.players[0];
        const v = R.proxy.body.linvel();
        const s = Math.hypot(v.x, v.z);
        // the speed over a tenth of a second: the body's own gait wobble is not the ramp
        if (sim.t - wasT >= 0.1) {
          up = Math.max(up, (s - was) / (sim.t - wasT));
          down = Math.max(down, (was - s) / (sim.t - wasT));
          was = s;
          wasT = sim.t;
        }
        if (sim.t >= 3.15 && sim.t <= 3.2) lateW = Math.max(lateW, R.run!.w);
      },
      finish(sim) {
        const R = sim.players[0];
        expect(up).toBeLessThan(1.6);
        expect(down).toBeLessThan(1.6);
        expect(lateW).toBe(1);
        const lands = sim.events.filter((e) => e.type === 'footPlant' && e.t > 0.1);
        expect(lands.length).toBeGreaterThanOrEqual(5);
        lands.forEach((e, i) => {
          if (i) expect(e.data!.side, `plant at ${e.t}`).not.toBe(lands[i - 1].data!.side);
        });
        const first = sim.events.find((e) => e.type === 'footRelease' && e.t > 0.1)!;
        expect(first.t).toBeGreaterThan(0.7); // the hips lead the first step, as in the supplied start
        expect(R.feet!.feet.left.mode).toBe('planted');
        expect(R.feet!.feet.right.mode).toBe('planted');
      },
    };
  },
});

export const WALK_VALID = check({
  name: 'L3-F14: walk, run and stop stay valid',
  // a conversion inside the walk-to-run blend passes the audit
  fixtures: /^L3-F14-/,
  watch: (d) => ({
    finish(sim) {
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      // plan 13e known limit (user ruling, bounded): on the supplied walk clips L3-F14-lateral's left foot plants at
      // 1.1417 s and fails on the slide (3.36 cm horizontal); no other plant fails
      const failed = sim.events.filter((e) => e.type === 'footPlantFailed');
      if (d.id === 'L3-F14-lateral') {
        expect(failed.map((e) => `${e.playerId} ${(e.data as { side?: string }).side} ${e.t.toFixed(4)}`), d.id).toEqual(['R left 1.1417']);
        expect((failed[0].data as { hzM: number }).hzM, d.id).toBeLessThan(0.035);
      } else expect(failed.length, d.id).toBe(0);
    },
  }),
});

// ---------------------------------------------------------------------------------------------------------------------
// Plan 08 pass 3: contact integration

export const ANCHORS = check({
  name: 'contact entry keeps its anchors',
  fixtures: /^L3-F1-/,
  watch(d) {
    const before: Record<string, Record<string, Vec3 | null>> = {};
    // plan 10b: the entries and the plants held across them, so the claim is not vacuous
    let entries = 0;
    let kept = 0;
    let was: (string | undefined)[] = [];
    return {
      beforeTick(sim) {
        for (const pl of sim.players) {
          if (!pl.feet || !pl.pose) continue;
          for (const v of Object.values(pl.pose.jointLandmarksWorld)) expect(Number.isFinite(v.x + v.y + v.z), d.id).toBe(true);
          before[pl.id] = { left: pl.feet.feet.left.heelW, right: pl.feet.feet.right.heelW };
        }
        was = sim.players.map((p) => p.loco?.mode);
      },
      tick(sim) {
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
      },
      finish() {
        expect(entries, `${d.id} contact entries`).toBeGreaterThan(0);
        expect(kept, `${d.id} plants held across an entry`).toBeGreaterThan(0);
      },
    };
  },
});

export const LIFT_RECOVERY = check({
  name: 'temporary airborne recovery',
  fixtures: /^L3-F9-lift-/,
  watch(d) {
    const mode = d.id.split('-').pop();
    let lost: { t: number; mode: string } | null = null;
    let back: number | null = null;
    let was = true;
    let bothAir = 0;
    let airN = 0;
    let backN = 0;
    return {
      substep(s) {
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
      finish(sim) {
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
      },
    };
  },
});

/** The irreversible fall of one player: its mode at the trigger, the accepted conversion and its audits, nothing supports it afterwards. */
function fell(d: FixtureDef, id: string, mode: string | null, how: RegExp, then: (sim: Simulation) => void = () => {}): Watch {
  let before = '';
  let at: number | null = null;
  let supported = 0;
  return {
    substep(s) {
      const P = s.byId.get(id)!;
      if (P.controlMode === 'falling' || P.rag) {
        at ??= s.t;
        if (P.sus && (P.sus.active || P.sus.appliedN !== 0)) supported++;
      } else before = P.loco!.mode;
    },
    finish(sim) {
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
      then(sim);
    },
  };
}

export const AUDITED_FALL = check({
  name: 'a labelled conversion or loss of probe support is an audited fall',
  fixtures: /^L3-F9-(convert-|noProbe-|low$)/,
  watch(d) {
    // L3-F9-low: a conversion of the low runner in contact
    if (d.id === 'L3-F9-low') return fell(d, 'R', 'contact', /diagnostic/);
    if (d.id.startsWith('L3-F9-convert-')) return fell(d, 'R', d.id.split('-').pop()!, /diagnostic/);
    return fell(d, 'R', d.id.split('-').pop()!, /lossOfSupport/, (sim) => expect(count(sim, 'lossOfSupport', 'R'), d.id).toBe(1));
  },
});

export const DEFENDER_BOB = check({
  name: 'the defender converts on the sign of its bob',
  // plan 13d: was /^L3-F9-defender/. With Fast Run at 6.2-6.9 m/s the one-arm defender stays in contact
  // with level vertical speed through its diagnostic window: Rising converts on loss of support at 1.54 s, Falling's
  // conversion is rejected (plan 13f). The standing holds of L3-F10 convert on the measured sign of their bob
  fixtures: /^L3-F10-(rising|falling)$/,
  watch(d) {
    const rising = d.id.endsWith('rising');
    let vy = 0;
    let at: number | null = null;
    return {
      substep(s) {
        const D = s.byId.get('D')!;
        if (D.rag) at ??= vy;
        else vy = D.proxy.body.linvel().y;
      },
      finish(sim) {
        const D = sim.byId.get('D')!;
        expect(at, d.id).not.toBeNull();
        expect(Math.sign(at!), d.id).toBe(rising ? 1 : -1);
        expect(D.handoff, d.id).not.toBeNull();
        expect(D.handoff!.reason, d.id).toBe('diagnostic');
        const rep = sim.events.find((e) => e.type === 'representation' && e.playerId === 'D')!;
        expect((rep.data!.audit as { ok: boolean }).ok, d.id).toBe(true);
        expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      },
    };
  },
});

/** Plan 13d known limits (user ruling, to plan 13f): the one-arm defenders of L3-F9 (and L3-F1-falling, the same run) no
 * longer convert on their bob. */
export const DEFENDER_13F = check({
  name: 'the L3-F9 defenders as 13d leaves them',
  fixtures: ['L3-F9-defenderRising', 'L3-F9-defenderFalling', 'L3-F1-falling'],
  watch: (d) => ({
    finish(sim) {
      const D = sim.byId.get('D')!;
      if (d.id.endsWith('Rising')) {
        // in contact with level vertical speed through the diagnostic window: it converts on losing support instead
        expect(D.handoff?.outcome, d.id).toBe('accepted');
        expect(D.handoff!.reason, d.id).toBe('lossOfSupport');
      } else {
        // its conversion at 1.267 s is rejected for external penetration (its left thigh 2.39 cm in R's pelvis) and it
        // stays a falling proxy: pinned, so this fails when 13f's leg guard lets it convert
        expect(D.handoff?.outcome, d.id).toBe('rejected');
        expect(D.handoff!.report.reasons.join(','), d.id).toContain('externalPenetration');
      }
    },
  }),
});

export const PREP_UNWINDS = check({
  name: 'L3-F2: preparation unwinds',
  fixtures: /^L3-F2-/,
  watch: (d) => ({
    finish(sim) {
      for (const id of ['R', 'D']) expect(modes(sim, id).map((m) => m.to), d.id).toEqual(['prep', 'free']);
      expect(modes(sim, 'R')[1].reason).toBe('unwound');
      expect(sim.events.filter((e) => e.type === 'contactBegin' || e.type === 'gripBegin' || e.type === 'clampBegin')).toEqual([]);
      const v = sim.players.find((p) => p.id === 'R')!.proxy.body.linvel();
      expect(Math.hypot(v.x, v.z), d.id).toBeGreaterThan(3.5);
    },
  }),
});

export const FOLLOWS_CONTACT = check({
  name: 'L3-F3: the mode follows the first observed contact',
  fixtures: /^L3-F3-/,
  watch: (d) => ({
    finish(sim) {
      const c = sim.events.find((e) => e.type === 'contactBegin')!;
      const m = modes(sim, 'R').find((x) => x.to === 'contact')!;
      expect(Math.abs(m.t - c.t), d.id).toBeLessThanOrEqual(1 / 60 + 1e-6);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
    },
  }),
});

export const KEEP_STEPPING = check({
  name: 'L3-F4/F5: legs keep stepping in contact',
  fixtures: /^L3-F4-(two|one)Arm|^L3-F5-/,
  watch: (d) => ({
    finish(sim) {
      const entry = modes(sim, 'D').find((x) => x.to === 'contact')!;
      // a step lands or starts after the contact entry (L3-F4-twoArm: D's steps start in contact, and under plan 11's arm
      // self-clearance D falls 8 ms before the plant that used to land in exit mode)
      expect(sim.events.some((e) => (e.type === 'footPlant' || (e.type === 'footSwing' && e.data?.source === 'step')) && e.t > entry.t), d.id).toBe(true);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
    },
  }),
});

export const HOLD_SETTLES = check({
  name: 'L3-F6: a stationary hold settles',
  fixtures: /^L3-F6-hold/,
  watch: (d) => ({
    finish(sim) {
      expect(sim.players.every((p) => p.representation !== 'ragdoll' && p.controlMode === 'supported'), d.id).toBe(true);
      for (const id of ['R', 'D']) expect(sim.events.filter((e) => e.type === 'footPlant' && e.playerId === id && e.t > 3.5).length, d.id).toBeLessThanOrEqual(1);
      // plan 13e known limit (user ruling, bounded): with the supplied walk clips D's start ramp takes its run-in to 1.51 m/s, over the
      // 1.5 m/s prep threshold (1.46 m/s without clips), so both enter prep at 0.31 s; the arrival brake takes the closing
      // speed back under it and prep unwinds 37 ms before the wrap is retained. Held here: one prep, a free gap under 50 ms
      const ms = modes(sim, 'R');
      expect(ms.map((m) => m.to), d.id).toEqual(['prep', 'free', 'contact']);
      expect(ms[2].t - ms[1].t, d.id).toBeLessThan(0.05);
    },
  }),
});

export const NO_LAUNCH = check({
  name: 'L3-F6/F7: a saturating load released does not launch',
  fixtures: ['L3-F6-saturated', 'L3-F7-loadRelease'],
  watch(d) {
    let y = 0;
    return {
      tick(sim) {
        for (const p of sim.players) if (!p.rag) y = Math.max(y, p.proxy.body.translation().y);
      },
      finish(sim) {
        // plan 13e known limit (user ruling, bounded): with the supplied clips L3-F6-saturated's root peaks at 0.9122 m
        expect(y, d.id).toBeLessThan(d.id === 'L3-F6-saturated' ? 0.913 : 0.91);
        expect(sim.players.every((p) => p.representation !== 'ragdoll'), d.id).toBe(true);
      },
    };
  },
});

export const CLEARS = check({
  name: 'L3-F7: contact clears from every run phase and side',
  fixtures: /^L3-F7-(phase|mirror)/,
  watch: (d) => ({
    finish(sim) {
      expect(modes(sim, 'R').map((m) => m.to), d.id).toEqual(['prep', 'contact', 'exit', 'free']);
      const R = sim.players.find((p) => p.id === 'R')!;
      expect(R.run!.w, d.id).toBeGreaterThan(0.9);
      expect(R.representation).toBe('proxy');
      const plants = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === 'R' && e.t > 1.1).map((e) => e.data!.side);
      expect(plants.length, d.id).toBeGreaterThan(3);
      for (let i = 1; i < plants.length; i++) expect(plants[i], d.id).not.toBe(plants[i - 1]);
    },
  }),
});

export const RECONTACT = check({
  name: 'L3-F8: recontact in exit',
  fixtures: ['L3-F8-recontact'],
  watch: () => ({
    finish(sim) {
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
    },
  }),
});

export const PLAYER_BELOW = check({
  name: 'L3-F9: player below stays a support-budget regression',
  fixtures: ['L3-F9-playerBelow'],
  watch: () => ({
    finish(sim) {
      expect(count(sim, 'handoffRejected')).toBe(0);
    },
  }),
});

export const RETAINED = check({
  name: 'L3-F10: either or both convert with retention',
  fixtures: /^L3-F10-/,
  watch: (d) => ({
    finish(sim) {
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      expect(sim.players.filter((p) => p.representation === 'ragdoll').length, d.id).toBeGreaterThan(0);
    },
  }),
});

export const BAD_CANDIDATE = check({
  name: 'L3-F11: a genuine bad candidate is rejected with the safe fallback',
  fixtures: ['L3-F11-invalid'],
  watch: () => ({
    finish(sim) {
      const r = sim.events.filter((e) => e.type === 'handoffRejected');
      expect(r).toHaveLength(1);
      expect(r[0].data!.reasons).toMatch(/jointAnchor/);
      expect(r[0].data!.fallback).toBe('fallingProxy');
    },
  }),
});

/** Deliberate faults for the negative controls: the shown elbow pushed out along the upper arm, the anchor moved on the target. */
interface Tamper {
  stretchElbow?: number;
  anchorLocal?: Vec3;
}
type Held = { lengthM: number; gripGapM: number; grips: number; clamps: number; clampGapM: number };
/**
 * The held arms as the published pose shows them (plan 10b: the pose's landmarks, not the arm system's observation, so a
 * pose-side displacement fails): segments against the arm profile and every live hold's palm against its anchor on the
 * target, each substep the hold exists.
 */
function held(d: FixtureDef, watch: (s: Simulation) => void = () => {}, tamper: Tamper = {}): { watch: Watch; out: Held } {
  const A = armProfile(d);
  const out: Held = { lengthM: 0, gripGapM: 0, grips: 0, clamps: 0, clampGapM: 0 };
  return {
    out,
    watch: {
      substep: (s) => {
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
    },
  };
}

export const PALM_HOLDS = check({
  name: 'real palm holds',
  fixtures: ['L3-F4-gripTarget', 'L3-F4-gripOwner', 'L3-F4-gripBoth'],
  watch(d) {
    const h = held(d);
    return {
      substep: h.watch.substep,
      finish(sim) {
        const id = d.id;
        const A = armProfile(d);
        const r = h.out;
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
        const seenKeys = new Set<string>();
        for (const l of sim.arms!.ledger) {
          const k = `${l.step}:${l.id}`;
          expect(seenKeys.has(k), `${id} ${k}`).toBe(false);
          seenKeys.add(k);
        }
      },
    };
  },
});

export const CLAMPS = check({
  name: 'real forearm clamps',
  fixtures: ['L3-F4-twoArm', 'L3-F6-hold', 'L3-F10-both'],
  watch(d) {
    const h = held(d);
    return {
      substep: h.watch.substep,
      finish(sim) {
        const id = d.id;
        const r = h.out;
        expect(sim.events.filter((e) => e.type === 'clampBegin').length, id).toBeGreaterThan(0);
        expect(r.clamps, id).toBeGreaterThan(0);
        expect(r.lengthM, id).toBeLessThanOrEqual(ragOf(d).validation.lengthTolM);
        for (const e of sim.events.filter((x) => x.type === 'clampBegin')) expect(e.data!.gap as number, id).toBeLessThanOrEqual(armProfile(d).surfaceTolM + 1e-9);
        for (const e of sim.events.filter((x) => x.type === 'clampEnd')) expect(e.data!.reason, id).toBeTruthy();
      },
    };
  },
});

export const RETENTION_BITES = check({
  name: 'the retention measures fail a stretched limb and a shifted anchor',
  fixtures: ['L3-F4-gripTarget'],
  watch(d) {
    // the same measures, on the same run, with a 2 % longer shown upper arm or an anchor moved 2 cm on the target
    const A = armProfile(d);
    const tol = ragOf(d).validation.lengthTolM;
    const r = held(d, (s) => {
      // the held runner holds nothing: inspecting it would prove nothing
      const q = s.arms!.obs('R');
      expect(q?.left?.gripId ?? null).toBeNull();
      expect(q?.right?.gripId ?? null).toBeNull();
    });
    const stretched = held(d, () => {}, { stretchElbow: 0.02 });
    const shifted = held(d, () => {}, { anchorLocal: { x: 0.02, y: 0, z: 0 } });
    return {
      substep(s) {
        r.watch.substep!(s);
        stretched.watch.substep!(s);
        shifted.watch.substep!(s);
      },
      finish() {
        expect(r.out.grips).toBeGreaterThan(0);
        expect(r.out.lengthM).toBeLessThanOrEqual(tol);
        expect(r.out.gripGapM).toBeLessThanOrEqual(A.surfaceTolM);
        expect(stretched.out.lengthM).toBeGreaterThan(tol);
        expect(stretched.out.gripGapM).toBeLessThanOrEqual(A.surfaceTolM);
        expect(shifted.out.gripGapM).toBeGreaterThan(A.surfaceTolM);
        expect(shifted.out.lengthM).toBeLessThanOrEqual(tol);
      },
    };
  },
});
// ---------------------------------------------------------------------------------------------------------------------
// The carried ball (plan 08a, plan 10d D1(a)): checks that read a run of every L3 fixture with a rule profile, or the
// audited boundaries of the carrier (from tests/ball-carry.test.ts and the baseline ball-carry-evidence)

const runnerOf = (s: Simulation): PlayerRuntime => s.players.find((p) => p.id === s.rules!.runnerId)!;
const carrierOf = (s: Simulation): PlayerRuntime => s.players.find((p) => p.setup.role === 'runner')!;
const vec = (a: [number, number, number]): Vec3 => v3(a[0], a[1], a[2]);
/** Largest per-axis difference (the trace rounds to 4 decimals: 5e-5). */
const axisGap = (a: Vec3, b: Vec3): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
const ROUND4 = 5e-5 + 1e-9;

/** Every L3 fixture with a rule profile. */
export const RULE_FIXTURES = allFixtures()
  .filter((d) => d.milestone === 'L3' && d.rules)
  .map((d) => d.id);

/** Each L3 rule fixture's one-ball record: the ticks seen, those with the ball seated, and whether the play ended. */
export const ONE_BALL_SEEN = new Map<string, { ticks: number; seated: number; ending: boolean }>();
export const ONE_BALL = check({
  name: 'the drawn ball, the rule reference and the evidence are one ball',
  fixtures: RULE_FIXTURES,
  watch(def) {
    const e = { atEnding: null as Vec3 | null, live: new Map<number, Vec3>(), ticks: 0, seated: 0 };
    let R: PlayerRuntime | undefined;
    let prev: PoseKey | null = null;
    let prevRep: PlayerRuntime['representation'];
    let spot: string | null = null;
    return {
      // the substep the ending is called on: the observer has just read this pose
      substep: (s) => {
        if (!s.ending || e.atEnding) return;
        const R = runnerOf(s);
        e.atEnding = drawnBall(R.pose, s.poseOf(R), s.rules!.profile).p;
      },
      // before the first tick: the runner and its representation
      beforeTick: (sim) => {
        if (R) return;
        R = runnerOf(sim);
        prevRep = R.representation;
      },
      tick: (sim) => {
        const ref = sim.rules!.ballRef(sim.poseOf(R!), R!.pose);
        // the lab at alpha 1: its interpolation from the kept previous tick to this one (reset at a representation change)
        const shown: PhysicalPose | null = prev && R!.pose && prevRep === R!.representation ? lerpPose(prev, R!.pose, 1) : R!.pose;
        const drawn = drawnBall(shown, sim.poseOf(R!), sim.rules!.profile);
        expect(dist(drawn.p, ref), `${def.id} t=${sim.t}`).toBeLessThan(1e-9);
        const c = carriedBall(R!.pose);
        if (c) {
          e.seated++;
          expect(dist(drawn.p, c.p), def.id).toBeLessThan(1e-9);
        }
        e.live.set(sim.tick, ref);
        prev = capturePose(prev, R!.pose);
        prevRep = R!.representation;
        e.ticks++;
        if (sim.ending && !spot) spot = JSON.stringify(sim.ending.ballSpot);
        if (spot) expect(JSON.stringify(sim.ending!.ballSpot), def.id).toBe(spot);
      },
      finish: (sim) => {
        const { live, atEnding } = e;
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
          const end = ev.events.filter((x) => x.type === 'ruleEnding');
          expect(end.length, def.id).toBe(1);
          expect(atEnding, def.id).not.toBeNull();
          // the official spot is the drawn ball at the substep the ending was called
          expect(dist(sim.ending.ballSpot, atEnding!), def.id).toBeLessThan(1e-12);
          expect(dist(ev.fixture.ruleEnding!.ballSpot, atEnding!), def.id).toBeLessThan(1e-12);
          expect(axisGap(vec(end[0]!.data.ballSpot!), atEnding!), def.id).toBeLessThanOrEqual(ROUND4);
        } else expect(ev.fixture.ruleEnding, def.id).toBeNull();
        ONE_BALL_SEEN.set(def.id, { ticks: e.ticks, seated: e.seated, ending: !!sim.ending });
      },
    };
  },
});

/** Whether each of the first 12 L3 rule fixtures froze an official spot while the ball was drawn. */
export const RULE_REF_SPOT = new Map<string, boolean>();
export const RULE_REF = check({
  name: 'the rule reference, the drawn ball and the official spot agree',
  fixtures: RULE_FIXTURES.slice(0, 12),
  watch(def) {
    let spot: string | null = null;
    return {
      tick: (sim) => {
        const R = runnerOf(sim);
        const drawn = carriedBall(R.pose);
        if (!drawn) return;
        const ref = sim.rules!.ballRef(sim.poseOf(R), R.pose);
        expect(dist(ref, drawn.p), def.id).toBeLessThan(1e-6);
        if (sim.ending && !spot) {
          spot = JSON.stringify(sim.ending.ballSpot);
        }
        if (spot) expect(JSON.stringify(sim.ending!.ballSpot)).toBe(spot);
      },
      finish: () => void RULE_REF_SPOT.set(def.id, spot !== null),
    };
  },
});

/** The carrier's audited boundaries that compare the ball, the largest of them, and how far the ball left its seat. */
export const CARRY_BOUNDARIES = new Map<string, { boundaries: number; ball: number; moved: number }>();
export const CARRY_AUDIT = check({
  name: 'contact and recontact keep the ball under the same-time limit, on the achieved arm',
  fixtures: ['L3-F7-phase0', 'L3-F8-recontact', 'L3-F16-contactStop', 'L3-F14-carrier', 'L3-F14-walkRunStopCarrier', 'L3-F16-kick'],
  watch(def) {
    let moved = 0;
    return {
      // the ball stays seated on the achieved forearm at every substep, clearance corrections included
      substep: (s) => {
        const R = carrierOf(s);
        if (!R.pose?.carry) return;
        const ball = carriedBall(R.pose)!;
        const lm = R.pose.jointLandmarksWorld;
        const seat = R.pose.carry;
        moved = Math.max(moved, dist(lm.carriedBall, ball.p), Math.abs(dist(lm.carriedBall, lm.rightElbow) - Math.hypot(seat.alongM, seat.outM)));
      },
      finish: (sim) => {
        const R = carrierOf(sim);
        let boundaries = 0;
        let ball = 0;
        for (const x of sim.transitionDeltas.filter((b) => b.playerId === R.id)) {
          if (x.by.carriedBall === undefined) continue;
          boundaries++;
          ball = Math.max(ball, x.by.carriedBall);
        }
        CARRY_BOUNDARIES.set(def.id, { boundaries, ball, moved });
        expect(ball, def.id).toBeLessThanOrEqual(0.01);
        expect(moved, def.id).toBeLessThan(1e-6);
      },
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// One fixture of the pass, and what the pass records over several fixtures

/** The items as an array, after asserting there is at least one (tests/helpers.ts `nonEmpty`, on the plain expect). */
function nonEmpty<T>(xs: Iterable<T>, what = 'items'): T[] {
  const a = [...xs];
  expect(a.length, `${what}: expected at least one`).toBeGreaterThan(0);
  return a;
}

/** The copy comparison of each fixture of the sample: null when it holds, else its first failed assertion. */
export const COPIED = new Map<string, string | null>();
/** The unaudited side of the copy comparison, run right after the audited one (the pass's run of the fixture). */
async function compareCopy(id: string): Promise<void> {
  const b = AUDITED.get(id);
  AUDITED.delete(id);
  if (!b) return; // the audited run did not finish: the test reports the fixture as not compared
  try {
    // plan 10b: the full trace rows, the events, and at every substep each player's foot plan, run-clip playback, pose
    // memory, locomotion state, walking request and published pose
    const states: string[] = [];
    const a = await run(FIX(id), { transitionAudit: false, onSubstep: (s) => void states.push(stateKey(s)) });
    try {
      expect(b.n, id).toBeGreaterThan(0);
      expect(traceRowsDiff(a.trace, b.trace), id).toBeNull();
      expect(b.events, id).toBe(JSON.stringify(a.events));
      expect(b.states.length, id).toBe(states.length);
      const i = states.findIndex((x, k) => x !== b.states[k]);
      expect(i, `${id}: substep ${i} state differs`).toBe(-1);
    } finally {
      a.dispose();
    }
    COPIED.set(id, null);
  } catch (e) {
    COPIED.set(id, text(e));
  }
}

/** One fixture's part of the pass: the checks that covered it, and each failure with its check's name. */
export interface FixturePass {
  covered: string[];
  failures: [check: string, detail: string][];
}

/** Runs `d` once with every check that covers it attached (and the copy comparison, where it is in the sample). */
export async function passFixture(d: FixtureDef): Promise<FixturePass> {
  const out: FixturePass = { covered: [], failures: [] };
  const watches = CHECKS.filter((c) => covers(c, d.id)).map((c) => {
    out.covered.push(c.name);
    const fail: Report = (m) => void out.failures.push([c.name, m.startsWith(d.id) ? m : `${d.id}: ${m}`]);
    let w: Watch = {};
    try {
      w = c.watch(d, fail);
    } catch (e) {
      fail(text(e));
    }
    return { w, fail };
  });
  await runWatched(d, watches, { transitionAudit: true });
  if (COPY_IDS.includes(d.id)) await compareCopy(d.id);
  return out;
}

/** What the checks record over several fixtures, for the tests that read it: counters (summed) and per-fixture maps. */
export const RECORDS = { HANDOVER, SEAMS, seen, CONT, FEET, REACH_AT, COPIED, ONE_BALL_SEEN, RULE_REF_SPOT, CARRY_BOUNDARIES };
export type Records = typeof RECORDS;

/** Adds a shard's records into this process's: counters summed, per-fixture records taken over. */
export function mergeRecords(from: Records): void {
  for (const k of Object.keys(RECORDS) as (keyof Records)[]) {
    const into = RECORDS[k];
    const add = from[k];
    if (into instanceof Map) for (const [id, r] of add as Map<string, never>) (into as Map<string, unknown>).set(id, r);
    else for (const f of Object.keys(into)) (into as Record<string, number>)[f] += (add as Record<string, number>)[f]!;
  }
}
