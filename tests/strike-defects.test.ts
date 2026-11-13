// Contact motion M5 (the strike, WRAP_V4), tracked defects (rule 5) its flip reached: mechanisms the strike's moved
// trajectories run into, each on a full-state capture a little before it (tests/data/state; how to capture:
// tests/README.md). Each test pins the defect present in its captured state and fails once the defect is gone from it
// (it then becomes the fix's test, with its fault twin). The twin shows the cause: the same state or the run before the
// flip with the one thing the mechanism needs changed. The defects and their dispositions: docs/handoff/contact-motion-m3.md,
// "Known issues".
import { describe, expect, it } from 'vitest';
import type { ArmSide } from '../src/sim/contracts';
import type { FixtureDef } from '../src/sim/fixture';
import type { Simulation } from '../src/sim/simulation';
import { add, len, qRot, scale, sub, type Quat, type Vec3 } from '../src/sim/vec';
import { continuity, noneSeen, REQUEST_DD_M } from './l3-pass';
import { asCaptured, create, FIX, preWrapV4, preWrapV5 } from './runs';
import { loadState, resumeState, type StateCapture } from './state';
import { jointQuats, qAngle, SNAP_RADPS } from './visible';
import { heldBornBar } from './visible-bar';

type AuditView = { auditPrev: Map<string, { reqL: Record<ArmSide, Vec3> }> };
const sd = (h: Vec3[]): number => len(add(sub(h[2]!, scale(h[1]!, 2)), h[0]!));

/**
 * One player's clip leg request on one side as B3 reads it (the world: root plus the body-frame request), per substep:
 * the largest second difference of the whole, of the root alone and of the request relative to the root, over [fromS,
 * toS]; and the largest one-substep change of his run's stride scale there.
 */
function requestSplit(pid: string, side: ArmSide, fromS: number, toS: number) {
  const h: { p: Vec3; root: Vec3; rel: Vec3 }[] = [];
  const out = { all: 0, root: 0, rel: 0, stride: 0 };
  let stride: number | undefined;
  return {
    out,
    substep(s: Simulation): void {
      const pl = s.byId.get(pid)!;
      const a = (s as unknown as AuditView).auditPrev.get(pid);
      if (!a || pl.rag) return;
      const t = pl.proxy.body.translation();
      const root = { x: t.x, y: t.y, z: t.z };
      const rel = qRot(pl.proxy.body.rotation(), a.reqL[side]);
      h.push({ p: add(root, rel), root, rel });
      if (h.length > 3) h.shift();
      const st = pl.run?.stride;
      if (s.t >= fromS - 1e-9 && s.t <= toS + 1e-9) {
        if (h.length === 3) {
          out.all = Math.max(out.all, sd(h.map((x) => x.p)));
          out.root = Math.max(out.root, sd(h.map((x) => x.root)));
          out.rel = Math.max(out.rel, sd(h.map((x) => x.rel)));
        }
        if (st !== undefined && stride !== undefined) out.stride = Math.max(out.stride, Math.abs(st - stride));
      }
      stride = st;
    },
  };
}

/** The B3 record of `def` run fresh (with the transition audit) to `untilS`, plus a request split. */
async function freshB3(def: FixtureDef, untilS: number, split: ReturnType<typeof requestSplit>) {
  const c = continuity(def, noneSeen());
  const sim = await create(def, { transitionAudit: true, onSubstep: (s) => (c.watch.substep!(s), split.substep(s)) });
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  sim.dispose();
  return c.out.requestDD;
}

/** The same from a capture (taken with the audit). */
async function resumedB3(cap: StateCapture, untilS: number, split: ReturnType<typeof requestSplit>) {
  const def = asCaptured(cap);
  const c = continuity(def, noneSeen());
  const sim = await resumeState(cap, { def, opts: { onSubstep: (s) => (c.watch.substep!(s), split.substep(s)) } });
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  sim.dispose();
  return c.out.requestDD;
}

/** `d` with the defender's arms off from `s` (no arm work: nothing touches the carrier before the body hit). */
const armsOffAt = (d: FixtureDef, s: number): FixtureDef => ({
  ...d,
  id: `${d.id}~armsOff`,
  players: d.players.map((p) => (p.id === 'D' && p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, armsOffAfterS: s } } : p)),
});

describe('contact motion M5 tracked defects (rule 5)', () => {
  // (a) Under the strike the wide arms touch nothing before the body hit, so the hit arrives with the clip at full weight
  // (before it the arms' first touch began the contact composition, whose fade took the clip below full weight first),
  // and moves the clip's leg request in one substep. The carrier: a walking player's stride scale follows his measured
  // speed unsmoothed (src/sim/run-clip.ts, the walk's `short`), and the hit takes R in L3-F10-bothMirror from 0.90 to
  // 1.23 m/s, his stride scale from 0.57 to 0.77 in one substep: his left request jumps 6.3 cm at 0.604 s, all of it
  // relative to his root. Twin, the run before the flip with the defender's arms off (the body hit at full clip weight,
  // 0.754 s): over 1 cm at the hit too. Reached. The defender: L3-F1-mirror4's harder hit (184 N s; 106 before the flip)
  // jolts D's root, and his request, which rides it, moves 1.14 cm, about 1 cm of it the root's own second difference and
  // under 0.5 cm the clip's relative to it: what a viewer sees is the body stopping on the hit. Neither foot shows the
  // request while the planner owns it. tests/l3-pass.ts HIT_MOVES_CLIP_REQUEST excepts these jumps at the hit's onset.
  it('HIT_MOVES_CLIP_REQUEST (L3-F10-bothMirror from 0.583 s, L3-F1-mirror4 from 0.433 s): the hit moves the clip leg request past B3 at its onset, the carrier\'s by his walk stride scale (relative to his root), the defender\'s with his jolted root; before the flip with no arm touch first, the carrier\'s too', async () => {
    const r = requestSplit('R', 'left', 0.59, 0.62);
    const carrier = await resumedB3(loadState('tests/data/state/L3-F10-bothMirror~audit@35.json.gz'), 0.65, r);
    const said = `carrier ${JSON.stringify(carrier)} ${JSON.stringify(r.out)}`;
    expect(carrier.filter((x) => x.at.includes('R:left') && x.onset).map((x) => x.d).reduce((a, b) => Math.max(a, b), 0), said).toBeGreaterThan(0.05);
    expect(carrier.every((x) => x.onset), said).toBe(true);
    expect(r.out.stride, said).toBeGreaterThan(0.15);
    expect(r.out.rel, said).toBeGreaterThan(0.05);
    expect(r.out.root, said).toBeLessThan(REQUEST_DD_M);
    const twinSplit = requestSplit('R', 'left', 0.75, 0.8);
    const twin = await freshB3(armsOffAt(preWrapV4(preWrapV5(FIX('L3-F10-bothMirror'))), 0), 0.85, twinSplit);
    expect(twin.length, `twin ${JSON.stringify(twin)}`).toBeGreaterThan(0);
    expect(twin.every((x) => x.at.includes(' R:')) && twin.some((x) => x.onset), `twin ${JSON.stringify(twin)}`).toBe(true);
    expect(await freshB3(preWrapV4(preWrapV5(FIX('L3-F10-bothMirror'))), 0.85, requestSplit('R', 'left', 0, 0))).toEqual([]);
    const d = requestSplit('D', 'left', 0.44, 0.46);
    const defender = await resumedB3(loadState('tests/data/state/L3-F1-mirror4~audit@26.json.gz'), 0.5, d);
    const dSaid = `defender ${JSON.stringify(defender)} ${JSON.stringify(d.out)}`;
    expect(defender.map((x) => `${x.at.split(' ')[1]} ${x.onset}`), dSaid).toEqual(['D:left true']);
    expect(d.out.root, dSaid).toBeGreaterThan(0.009);
    expect(d.out.rel, dSaid).toBeLessThan(0.005);
  }, 120000);

  // (b) HC-F5-invalidOne (the labelled invalid candidate in a simultaneous batch, 1.217 s): under the strike D's trunk is
  // pitched over R at the batch and R's left upper arm is born 7.7 cm in D's torso (3.9 cm before the flip), held out of
  // the solve and pushed out to 3.4 cm by 1.42 s; D, whose candidate is rejected, stays a rigid falling proxy and falls
  // onto it, pressing it back past 5 cm for 0.13 s (6.7 cm at 1.53 s). Twin, the same state with D's candidate valid (no
  // labelled edit): the same arm born as deep is out within 0.05 s. The press is the rejected proxy's, which only a
  // labelled invalid candidate leaves; tests/handoff-contact.test.ts REJECTED_PROXY_PRESS excepts it there alone.
  it('REJECTED_PROXY_PRESS (HC-F5-invalidOne, from 1.167 s): a limb born in a rejected player\'s proxy is pressed back in past the held bar by it; with the candidate valid the same limb is pushed out', async () => {
    const cap = loadState('tests/data/state/HC-F5-invalidOne@70.json.gz');
    const def = asCaptured(cap);
    const look = async (d: FixtureDef) => {
      const bar = heldBornBar();
      const sim = await resumeState(cap, { def: d, opts: { onSubstep: bar.substep } });
      while (!sim.done) sim.stepTick();
      const D = sim.byId.get('D')!;
      const out = { outcome: D.handoff?.outcome, breaches: bar.of('R')?.breaches() ?? [], deepest: bar.of('R')?.deepest().d ?? 0 };
      sim.dispose();
      return out;
    };
    const on = await look(def);
    expect(on.outcome).toBe('rejected');
    expect(on.breaches.length, JSON.stringify(on)).toBe(1);
    expect(on.breaches[0], JSON.stringify(on)).toMatch(/^R leftUpperArm:upperArm in D:torso at .*: over 5 cm deep for /);
    const valid = await look({ ...def, diagnostics: { ...def.diagnostics, conversions: def.diagnostics!.conversions!.map(({ edit: _e, ...c }) => c) } });
    expect(valid.outcome).toBe('accepted');
    expect(valid.deepest, JSON.stringify(valid)).toBeGreaterThan(0.07);
    expect(valid.breaches, JSON.stringify(valid)).toEqual([]);
  }, 60000);

  // (c) L3-F1-phase7 (D's left foot, 0.500 s): the hit drives D's left thigh into R's shin; the leg's pose clears it
  // (clearance variant 1) and its solved ankle moves 5 cm back in one substep. The plant is released for it ('clearance')
  // and the planner's step, seeded from the achieved ankle and its velocity (src/sim/foot-compose.ts `seedStep`), takes
  // those 5 cm as 12 m/s backward, 16 m/s relative to his hips. The step carries the foot 0.7 m further back within its
  // acceleration limit before it turns; the foot stays out of reach behind him (1.14 m from the hips) and the leg's twist
  // turns 60 deg in one frame (leftHip 63 rad/s at 0.933 s): a supported snap. Before the flip D fell at the hit here; the
  // same seed from a clearance jump is in 19 runs before the flip as after it (9 to 17 m/s relative; L3-F1-phase1 D left
  // 0.483 s, 17.1), none run away to a snap. Twin: the same state with the foot's ankle velocity from before the clearance
  // jump kept for the seed: the seed under 8 m/s relative, no snap.
  it('STEP_SEEDS_CLEARANCE_JUMP (L3-F1-phase7, from 0.483 s): a step seeded from a clearance jump of the achieved ankle runs the foot away behind the hips to a supported hip snap; with the velocity from before the jump kept, no snap', async () => {
    const cap = loadState('tests/data/state/L3-F1-phase7@29.json.gz');
    const def = asCaptured(cap);
    const look = async (keepVelocity: boolean) => {
      const kept: Partial<Record<ArmSide, Vec3>> = {};
      const was: Partial<Record<ArmSide, { seeds: number; variant: number }>> = {};
      const out = { seedRel: 0, farM: 0, snap: 0, joint: '' };
      const sim = await resumeState(cap, {
        def,
        opts: {
          onSubstep: (s) => {
            const D = s.byId.get('D')!;
            if (D.rag || !D.feet) return;
            const v = D.proxy.body.linvel();
            const hip = D.proxy.body.translation();
            for (const side of ['left', 'right'] as const) {
              const f = D.feet.feet[side];
              const o = was[side];
              if (o && f.seeds !== o.seeds && f.source === 'step' && f.mode !== 'planted' && o.variant !== 0) out.seedRel = Math.max(out.seedRel, Math.hypot(f.stepH.v.x - v.x, f.stepH.v.z - v.z));
              out.farM = Math.max(out.farM, Math.hypot(f.target.x - hip.x, f.target.z - hip.z));
              if (keepVelocity && f.variant !== 0 && kept[side]) f.ankleV = kept[side]!;
              else kept[side] = { ...f.ankleV };
              was[side] = { seeds: f.seeds, variant: f.variant };
            }
          },
        },
      });
      let prev: Record<string, Quat> | null = null;
      while (!sim.done && sim.t < 1.2 - 1e-9) {
        sim.stepTick();
        const D = sim.byId.get('D')!;
        if (D.rag || D.controlMode !== 'supported' || !D.pose) {
          prev = null;
          continue;
        }
        const Q = jointQuats(D.pose);
        if (prev) for (const [j, q] of Object.entries(Q)) {
          const w = qAngle(prev[j]!, q) / def.solver.outerTickS;
          if (w > out.snap) Object.assign(out, { snap: w, joint: `${j}@${sim.t.toFixed(4)}` });
        }
        prev = Q;
      }
      sim.dispose();
      return out;
    };
    const on = await look(false);
    expect(on.seedRel, JSON.stringify(on)).toBeGreaterThan(12);
    expect(on.farM, JSON.stringify(on)).toBeGreaterThan(1);
    expect(on.snap, JSON.stringify(on)).toBeGreaterThan(SNAP_RADPS);
    expect(on.joint, JSON.stringify(on)).toMatch(/^leftHip@/);
    const twin = await look(true);
    expect(twin.seedRel, JSON.stringify(twin)).toBeLessThan(8);
    expect(twin.snap, JSON.stringify(twin)).toBeLessThan(SNAP_RADPS);
  }, 60000);
});
