// Plan 08 (L3): locomotion transitions and automatic tackle integration. The composed foot planner (start, brake, settle),
// the fitted idle and procedural walking arms, the per-player locomotion mode (free, preparation, contact, exit) and the
// transition audit. L2, HC and every earlier fixture keep their paths; each L3 fixture opts in under its own id.
//
// Plan 13b: the checks that read a plain run of a registered L3 fixture are in tests/l3-contracts.test.ts, on its one
// shared run per fixture. Here: the opt-in, the idle intake, the locomotion mode state machine, and the cases that need
// their own runs (a changed body, profile, decision interval or render rate, an instrumented internal, a reset).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { asL3 } from '../src/sim/fixtures/transitions';
import { FixedStepDriver } from '../src/sim/driver';
import { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import type { ArmSide } from '../src/sim/contracts';
import type { FootPlanInput } from '../src/sim/footwork';
import { advanceLoco, IDLE_POSE_RECORD, LOCOMOTION_L3, newLocoState, type LocoObs } from '../src/sim/locomotion';
import { dist, len, qRot, v3, vc, type Vec3 } from '../src/sim/vec';
import { idleIntake } from '../scripts/model/idle-intake';
import { pace, rows, run, runSim, stepWhile, traceDiff, traceRowsDiff } from './helpers';
import { RULES_FOOTBALL, sideSignX } from '../src/sim/profiles';
import { FIX } from './transitions-shared';

// a long file of synchronous runs: let the runner's messages through between tests
afterEach(() => new Promise<void>((done) => setTimeout(done)));

describe('plan 08 opt-in', () => {
  it('asL3 keeps the source fixture and only adds the profiles', () => {
    const src = FIX('L2-F3-runStop');
    const d = asL3(src, 'L3-x');
    expect({ ...d, id: src.id, milestone: src.milestone, footwork: src.footwork, locomotion: undefined, carry: undefined, selfClearance: undefined, jointRange: undefined, rules: src.rules, notes: src.notes, runClips: src.runClips }).toEqual({ ...src, locomotion: undefined, carry: undefined });
    // the user's stance widths, chosen by eye: the base profile keeps none, so the committed fixtures do not move
    expect(d.runClips!.stanceWidthAddM).toEqual({ walk: 0, 'fast-run': 0.065 });
    expect(src.runClips!.stanceWidthAddM).toBeUndefined();
  });
});

describe('plan 08 idle intake', () => {
  it('the idle record reproduces from the supplied clip; the cycle is measured, one frame is used', () => {
    expect(idleIntake()).toEqual(IDLE_POSE_RECORD);
    const manifest = JSON.parse(readFileSync('models/animations/manifest.json', 'utf8')) as { kind?: string; sourceSha256?: string; posePolicy?: string }[];
    const idle = manifest.find((e) => e.kind === 'idle')!;
    expect(idle.sourceSha256).toBe(IDLE_POSE_RECORD.sourceSha256);
    expect(idle.posePolicy).toMatch(/^static/);
  });
});

describe('plan 08 locomotion mode', () => {
  const P = LOCOMOTION_L3;
  const dt = 1 / 240;
  const obs = (o: Partial<LocoObs>): LocoObs => ({ contact: false, retained: false, closing: false, falling: false, clipSettled: true, ...o });
  const drive = (st: ReturnType<typeof newLocoState>, o: Partial<LocoObs>, s: number, t0 = 0): number => {
    let t = t0;
    for (let i = 0; i < Math.round(s / dt); i++) {
      t += dt;
      advanceLoco(st, P, obs(o), t, dt);
    }
    return t;
  };

  it('the mode: preparation unwinds after the hold; contact holds through a brief loss and exits only settled, recontact named; falling interrupts every mode; a clamped brace weight takes its rate with it', async () => {
    const cases: [string, () => void][] = [
      [
        'preparation unwinds after the hold; contact needs observed contact or retention',
        () => {
          const st = newLocoState();
          drive(st, { closing: true }, 0.1);
          expect(st.mode).toBe('prep');
          drive(st, {}, P.contact.prepHoldS * 0.5, 0.1);
          expect(st.mode).toBe('prep');
          drive(st, {}, P.contact.prepHoldS * 0.6, 0.2);
          expect(st.mode).toBe('free');
          expect(st.reason).toBe('unwound');
        },
      ],
      [
        'a brief loss of contact does not chatter; exit needs its minimum time and a settled clip; recontact is named',
        () => {
          const st = newLocoState();
          let t = drive(st, { contact: true }, 0.2);
          expect(st.mode).toBe('contact');
          t = drive(st, {}, P.contact.clearS * 0.5, t);
          t = drive(st, { contact: true }, 0.01, t);
          t = drive(st, {}, P.contact.clearS * 0.5, t);
          expect(st.mode).toBe('contact');
          t = drive(st, {}, P.contact.clearS * 1.1, t);
          expect(st.mode).toBe('exit');
          t = drive(st, { clipSettled: false }, 1, t);
          expect(st.mode).toBe('exit');
          drive(st, { contact: true }, 0.01, t);
          expect(st.mode).toBe('contact');
          expect(st.reason).toBe('recontact');
        },
      ],
      [
        'falling interrupts every mode at once and clears the weights at the bounded rate',
        () => {
          for (const setup of [{ closing: true }, { contact: true }]) {
            const st = newLocoState();
            const t = drive(st, setup, 0.5);
            const w = st.contactW + st.prepW;
            expect(w).toBeGreaterThan(0);
            advanceLoco(st, P, obs({ falling: true }), t + dt, dt);
            expect(st.mode).toBe('free');
            expect(st.reason).toBe('falling');
            expect(st.contactW + st.prepW).toBeLessThan(w);
          }
        },
      ],
      [
        'a clamped brace weight takes its rate with it: it leaves the bound as one that came to rest there (plan 10b)',
        () => {
          // the critically damped brace weight does not reach its bounds in any L3 or L4 run; started past one, the rate the
          // clamp overrode used to keep it pinned there after the contact weight had moved away
          for (const [w0, v0, target] of [[0.999, 5, { contact: true }], [0.001, -5, {}]] as const) {
            const at = newLocoState();
            const t = drive(at, target, 0.5);
            const rest = { ...at, braceW: w0 > 0.5 ? 1 : 0, braceV: 0 };
            at.braceW = w0;
            at.braceV = v0;
            advanceLoco(at, P, obs(target), t + dt, dt);
            advanceLoco(rest, P, obs(target), t + dt, dt);
            expect(at.braceW).toBe(rest.braceW);
            expect(at.braceV).toBe(0);
            // then the other way: both leave the bound together
            const away = w0 > 0.5 ? {} : { contact: true };
            let tt = t + dt;
            let moved = 0;
            for (let i = 0; i < 120; i++) {
              tt += dt;
              advanceLoco(at, P, obs(away), tt, dt);
              advanceLoco(rest, P, obs(away), tt, dt);
              expect(at.braceW, `${w0} ${i}`).toBeCloseTo(rest.braceW, 12);
              if (Math.abs(at.braceW - (w0 > 0.5 ? 1 : 0)) > 0.01) moved++;
            }
            expect(moved).toBeGreaterThan(0);
          }
        },
      ],
    ];
    await rows(cases, ([n]) => n, ([, f]) => f());
  });
});

describe('plan 08 pass 2: idle and walking', () => {
  it('the idle stance is the fitted width on either body: the width outside the hip comes from the body (plan 10b)', async () => {
    // before 10b the width added outside the hip assumed bew-v6's 0.1125 m hip: on the stock body (0.13 m) the stance
    // was 0.355 m. Both the planner's home and the ordinary leg request are read at rest
    const fitted = FIX('L3-F15-fitted');
    const stock = FIX('L3-F4-gripTarget').players.find((p) => p.body.hipRight.x === 0.13)!.body;
    const widths: number[] = [];
    for (const d of [fitted, { ...fitted, players: fitted.players.map((p) => ({ ...p, body: stock })) }]) {
      const sim = await Simulation.create(d);
      const R = sim.players[0];
      const host = sim as unknown as { footInput: (pl: typeof R, ...a: unknown[]) => FootPlanInput };
      const input = host.footInput.bind(sim);
      let at: { home: FootPlanInput['home']; request: FootPlanInput['request']; right: Vec3; speed: number } | null = null;
      host.footInput = (pl, ...a) => {
        const r = input(pl, ...a);
        if (pl === R) {
          const q = R.proxy.body.rotation();
          const v = R.proxy.body.linvel();
          at = { home: structuredClone(r.home), request: structuredClone(r.request), right: qRot({ x: q.x, y: q.y, z: q.z, w: q.w }, v3(sideSignX(R.body, 'right'), 0, 0)), speed: Math.hypot(v.x, v.z) };
        }
        return r;
      };
      await runSim(sim);
      const a = at!;
      expect(a.speed, d.players[0].body.id).toBeLessThan(1e-3);
      const across = (p: Record<ArmSide, Vec3>): number => p.right.x * a.right.x + p.right.z * a.right.z - (p.left.x * a.right.x + p.left.z * a.right.z);
      for (const w of [across(a.home), across(a.request)]) {
        expect(w, d.players[0].body.id).toBeCloseTo(IDLE_POSE_RECORD.stance.widthM * IDLE_POSE_RECORD.stance.legScale, 3);
        widths.push(w);
      }
      sim.dispose();
    }
    expect(stock.hipRight.x).not.toBeCloseTo(Math.abs(fitted.players[0].body.hipRight.x), 2);
    expect(widths.length).toBe(4);
  }, 30000);

  it('a walk in the profile changes nothing outside a walking request: run, stop and contact match the run clips tick for tick', async () => {
    for (const id of ['L3-F16-runStop', 'L3-F4-twoArm']) {
      const d = FIX(id);
      const P = d.runClips!;
      const out: string[][] = [];
      for (const def of [d, { ...d, runClips: { ...P, walk: undefined, clips: P.clips.slice(1) } }]) {
        const sim = await Simulation.create(def);
        const row: string[] = [];
        while (!sim.done) {
          sim.stepTick();
          await pace();
          row.push(sim.players.map((p) => (p.rag ? 'rag' : JSON.stringify(p.proxy.body.translation()))).join());
        }
        sim.dispose();
        out.push(row);
      }
      expect(out[0], id).toEqual(out[1]);
    }
  }, 30000);
});

describe('plan 08 walking ramp between controller decisions', () => {
  const DECIDE_S = 0.05;
  /** The ramped request of each substep, with the controllers deciding every interval (0: every substep). */
  const requests = async (id: string, intervalS: number): Promise<{ sim: Simulation; mps: number[] }> => {
    const sim = await Simulation.create(FIX(id));
    const set = (): void => {
      for (const pl of sim.players) (pl.controller as { decisionIntervalS: number }).decisionIntervalS = intervalS;
    };
    set();
    const mps: number[] = [];
    while (!sim.done) {
      sim.stepTick();
      await pace();
      mps.push(len(sim.players[0].walkRequest ?? { x: 0, y: 0, z: 0 }));
    }
    return { sim, mps };
  };

  it('the reproduction: a walk decided every 0.05 s ramps to 1.20 m/s by 1.5 s and stops; decision intervals 0 and 0.05 s, aligned at the request changes, ramp and stop alike', async () => {
    // one run per (fixture, interval): the reproduction reads the 0.05 s run of L3-F14-forward the comparison makes
    const runs = new Map<string, Promise<{ sim: Simulation; mps: number[] }>>();
    const at = (id: string, intervalS: number): Promise<{ sim: Simulation; mps: number[] }> => {
      const k = `${id} ${intervalS}`;
      if (!runs.has(k)) runs.set(k, requests(id, intervalS));
      return runs.get(k)!;
    };
    const cases: [string, () => Promise<void>][] = [
      [
        'the reproduction: a walk decided every 0.05 s ramps to 1.20 m/s by 1.5 s and stops',
        async () => {
          const { sim, mps } = await at('L3-F14-forward', DECIDE_S);
          const tickAt = (t: number): number => mps[Math.round(t / sim.def.solver.outerTickS) - 1];
          expect(tickAt(1.5)).toBeCloseTo(1.2, 6);
          expect(tickAt(0.5 + 0.5)).toBeGreaterThan(0.5);
          expect(tickAt(2.45)).toBeCloseTo(1.2, 6);
          expect(mps.at(-1)).toBe(0);
        },
      ],
      [
        'decision intervals 0 and 0.05 s, aligned at the request changes, ramp and stop alike',
        async () => {
          for (const id of ['L3-F14-forward', 'L3-F14-walkRunStop']) {
            const a = await at(id, 0);
            const b = await at(id, DECIDE_S);
            expect(b.mps.length, id).toBe(a.mps.length);
            a.mps.forEach((m, i) => expect(b.mps[i], `${id} tick ${i}`).toBeCloseTo(m, 6));
            expect(traceDiff(a.sim.trace, b.sim.trace, a.sim.players.map((p) => p.id)).pos, id).toBeLessThan(1e-3);
          }
        },
      ],
    ];
    await rows(cases, ([n]) => n, ([, f]) => f());
    for (const r of runs.values()) (await r).sim.dispose();
  }, 60000);

  it('a reset inherits no request: the run after it matches a fresh one', async () => {
    const fresh = await run(FIX('L3-F14-forward'));
    const sim = await Simulation.create(FIX('L3-F14-forward'));
    await stepWhile(sim, () => sim.t < 1 - 1e-9);
    expect(len(sim.players[0].walkRequest!)).toBeGreaterThan(0.5);
    sim.reset();
    expect(sim.players[0].walkRequest).toBeUndefined();
    expect(sim.players[0].walkWant).toBeUndefined();
    await runSim(sim);
    expect(traceRowsDiff(sim.trace, fresh.trace)).toBeNull();
    sim.dispose();
    fresh.dispose();
  }, 30000);

  it('a referee ending stops the request at once between decisions, and in a walk it reaches the motor: no ramp back up, no forward drive after the call', async () => {
    const cases: [string, () => Promise<void>][] = [
      [
        'a referee ending stops the request at once between decisions',
        async () => {
          // L3-F1-phase0 is called down at 1.11 s: deciding every 0.05 s from just before it, the substep after the call no supported
          // player has a request left from the last decision
          const sim = await Simulation.create(FIX('L3-F1-phase0'));
          await stepWhile(sim, () => sim.t < 1.05 - 1e-9);
          for (const pl of sim.players) (pl.controller as { decisionIntervalS: number }).decisionIntervalS = DECIDE_S;
          await stepWhile(sim, () => !sim.rules?.ending);
          expect(sim.rules?.ending).toBeTruthy();
          sim.stepTick();
          await pace();
          let seen = 0;
          for (const pl of sim.players)
            if (pl.controlMode === 'supported' && pl.walkWant && pl.representation !== 'ragdoll') {
              seen++;
              expect(len(pl.walkWant), pl.id).toBe(0);
              expect(len(pl.applied.requestedVelocity), pl.id).toBe(0);
            }
          expect(seen).toBeGreaterThan(0);
          sim.dispose();
        },
      ],
      [
        'a referee ending in a walk reaches the motor: no ramp back up, no forward drive after the call',
        async () => {
          // L3-F14-carrier walks +Z and its only ending is a sideline plane at z = 0.8 m, reached at walking speed in free mode: the
          // case the ramp takes (a run or contact passes through it anyway). The motor's own request is the one read here.
          const def: FixtureDef = { ...FIX('L3-F14-carrier'), rules: RULES_FOOTBALL('R', { forwardAxis: v3(0, 0, 1), sidelineNormal: v3(0, 0, 1), sidelineOffsetM: 0.8, progress: false }) };
          const after: { request: number; along: number }[] = [];
          let called = false;
          let speedAtCall = 0;
          const sim = await Simulation.create(def, {
            onSubstep: (s) => {
              const pl = s.players[0];
              if (called) {
                const v = vc(pl.proxy.body.linvel());
                after.push({ request: len(pl.applied.requestedVelocity), along: pl.applied.drive.x * v.x + pl.applied.drive.z * v.z });
              } else if (s.rules?.ending) {
                called = true;
                speedAtCall = len(pl.walkRequest!);
              }
            },
          });
          await runSim(sim);
          expect(sim.rules?.ending?.kind).toBe('sidelineOut');
          expect(speedAtCall, 'the call comes mid walk').toBeGreaterThan(1);
          expect(sim.players[0].loco?.mode).toBe('free');
          expect(after.length).toBeGreaterThan(10);
          for (const a of after) {
            expect(a.request).toBe(0);
            expect(a.along).toBeLessThanOrEqual(1e-9);
          }
          sim.dispose();
        },
      ],
    ];
    await rows(cases, ([n]) => n, ([, f]) => f());
  }, 60000);

  it('contact and run requests still pass through the ramp between decisions; the ramp reads the mode decided this substep, and prep and exit pass through it as contact does (plan 10b)', async () => {
    const cases: [string, () => Promise<void>][] = [
      [
        'contact and run requests still pass through the ramp between decisions',
        async () => {
          // a contact run has no ramped request left over from an older decision
          const sim = await Simulation.create(FIX('L3-F7-phase0'));
          for (const pl of sim.players) (pl.controller as { decisionIntervalS: number }).decisionIntervalS = DECIDE_S;
          let seen = 0;
          while (!sim.done) {
            sim.stepTick();
            await pace();
            for (const pl of sim.players) {
              if (pl.loco?.mode !== 'contact' || pl.controlMode !== 'supported') continue;
              seen++;
              expect(dist(pl.walkRequest!, pl.walkWant!), pl.id).toBe(0);
            }
          }
          expect(seen).toBeGreaterThan(10);
          sim.dispose();
        },
      ],
      [
        'the ramp reads the mode decided this substep, and prep and exit pass through it as contact does (plan 10b)',
        async () => {
          // plan 08 kept contact and run requests out of the ramp (only a free walk is shaped); prep and exit are part of that
          // bypass. Before 10b the mode was decided after the ramp, so at each change the ramp used the last substep's mode
          for (const id of ['L3-F7-phase0', 'L3-F8-recontact']) {
            const atRamp = new Map<string, string | undefined>();
            const changes = new Map<string, number>();
            const last = new Map<string, string | undefined>();
            let bypass = 0;
            const sim = await Simulation.create(FIX(id), {
              onSubstep: (s) => {
                for (const pl of s.players) {
                  const mode = pl.loco?.mode;
                  expect(atRamp.get(pl.id), `${id} ${pl.id} ${s.t.toFixed(4)}`).toBe(mode);
                  if (last.has(pl.id) && last.get(pl.id) !== mode) changes.set(mode!, (changes.get(mode!) ?? 0) + 1);
                  last.set(pl.id, mode);
                  if (mode !== 'free' && pl.controlMode === 'supported' && !pl.rag) {
                    bypass++;
                    expect(dist(pl.walkRequest!, pl.walkWant!), `${id} ${pl.id} ${mode} ${s.t.toFixed(4)}`).toBe(0);
                  }
                }
              },
            });
            const host = sim as unknown as { rampWalkRequest: (pl: Simulation['players'][number], decided: boolean) => void };
            const ramp = host.rampWalkRequest.bind(sim);
            host.rampWalkRequest = (pl, decided) => {
              atRamp.set(pl.id, pl.loco?.mode);
              ramp(pl, decided);
            };
            await runSim(sim);
            for (const m of ['prep', 'contact', 'exit', 'free']) expect(changes.get(m) ?? 0, `${id} changes to ${m}`).toBeGreaterThan(0);
            expect(bypass).toBeGreaterThan(100);
            sim.dispose();
          }
        },
      ],
    ];
    await rows(cases, ([n]) => n, ([, f]) => f());
  }, 90000);
});

describe('plan 08 lifecycle and reproducibility', () => {
  it('L3-F12: render rate never changes the fixed-step run (no renderer in the loop: hidden players cannot matter)', async () => {
    for (const def of [FIX('L3-F7-phase25'), FIX('L3-F10-both')]) {
      const byRate = async (hz: number): Promise<Simulation> => {
        const s = await Simulation.create(def);
        const drv = new FixedStepDriver(def.solver.outerTickS, 8);
        while (!s.done) {
          for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
          await pace();
        }
        return s;
      };
      const a = await byRate(30);
      const b = await byRate(60);
      const c = await byRate(144);
      for (const o of [b, c]) {
        expect(traceDiff(a.trace, o.trace, a.players.map((p) => p.id)).pos).toBe(0);
        expect(JSON.stringify(o.events)).toBe(JSON.stringify(a.events));
      }
      for (const s of [a, b, c]) s.dispose();
    }
  }, 60000);

  it('20 resets: stable counts, a reset mid-mode reproduces the fresh run exactly', async () => {
    const def = FIX('L3-F9-convert-contact');
    const fresh = await run(def);
    const ref = { tr: fresh.trace, ev: JSON.stringify(fresh.events) };
    fresh.dispose();
    const sim = await Simulation.create(def);
    const base = sim.counts();
    const stops = [0.2, 0.45, 0.6, 0.7];
    for (let i = 0; i < 20; i++) {
      const stop = stops[i % stops.length];
      await stepWhile(sim, () => sim.t < stop - 1e-9);
      sim.reset();
      expect(sim.counts()).toEqual(base);
      expect(sim.players.every((p) => !p.loco || p.loco.mode === 'free')).toBe(true);
    }
    await runSim(sim);
    expect(traceRowsDiff(sim.trace, ref.tr)).toBeNull();
    expect(JSON.stringify(sim.events)).toBe(ref.ev);
    sim.dispose();
  }, 60000);
});
