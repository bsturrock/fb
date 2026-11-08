// Plan 08 (L3): locomotion transitions and automatic tackle integration. The composed foot planner (start, brake, settle),
// the fitted idle and procedural walking arms, the per-player locomotion mode (free, preparation, contact, exit) and the
// transition audit. L2, HC and every earlier fixture keep their paths; each L3 fixture opts in under its own id.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { allFixtures } from '../src/sim/fixtures/index';
import { asL3, transitionFixtures } from '../src/sim/fixtures/transitions';
import { FixedStepDriver } from '../src/sim/driver';
import { Simulation, type TransitionDelta } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import type { ArmSide } from '../src/sim/contracts';
import { FOOT_DEBUG, FOOTWORK_L2, FOOTWORK_L3 } from '../src/sim/footwork';
import { advanceLoco, IDLE_POSE_RECORD, LOCOMOTION_L3, newLocoState, type LocoMode, type LocoObs } from '../src/sim/locomotion';
import { add, dist, horiz, len, qConj, qRot, scale, sub, v3, vc, type Vec3 } from '../src/sim/vec';
import { idleIntake } from '../scripts/model/idle-intake';
import { run, traceDiff } from './helpers';
import { ARM_G2, RAGDOLL_G4, RULES_FOOTBALL, type ArmProfile } from '../src/sim/profiles';
import type { ArmObs } from '../src/sim/arms';

// a long file of synchronous runs: let the runner's messages through between tests
afterEach(() => new Promise<void>((done) => setTimeout(done)));

const SIDES: ArmSide[] = ['left', 'right'];
const FIX = (id: string): FixtureDef => {
  const f = allFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};
const L3 = (re: RegExp): FixtureDef[] => transitionFixtures().filter((d) => re.test(d.id));
/** One test per fixture of a group (a long synchronous loop would starve the test runner). */
const each = (re: RegExp, name: string, f: (d: FixtureDef) => Promise<void>): void => {
  for (const d of L3(re)) it(`${name}: ${d.id}`, () => f(d), 30000);
};
const modes = (sim: Simulation, id: string): { t: number; to: LocoMode; reason: string }[] =>
  sim.events.filter((e) => e.type === 'locoMode' && e.playerId === id).map((e) => ({ t: e.t, to: e.data!.to as LocoMode, reason: e.data!.reason as string }));
const armProfile = (d: FixtureDef): ArmProfile => d.armProfile ?? ARM_G2;
const ragOf = (d: FixtureDef) => d.ragdoll ?? RAGDOLL_G4;
/** The largest error of an achieved arm's three segments against the arm profile. */
const armLengthErr = (a: Pick<ArmObs, 'shoulderWorld' | 'elbowWorld' | 'wristWorld' | 'palmContactWorld'>, A: ArmProfile): number =>
  Math.max(Math.abs(dist(a.shoulderWorld, a.elbowWorld) - A.upperArmM), Math.abs(dist(a.elbowWorld, a.wristWorld) - A.forearmM), Math.abs(dist(a.wristWorld, a.palmContactWorld) - A.palmExtensionM));
const count = (sim: Simulation, type: string, id?: string): number => sim.events.filter((e) => e.type === type && (!id || e.playerId === id)).length;

/** Largest one-tick second difference of a limb landmark in the body frame, per tick. */
function peaks(sim: Simulation, names: string[], fromS: number): (() => void) & { peak: { d: number; t: number } } {
  const hist: Record<string, Vec3[]> = {};
  const peak = { d: 0, t: 0 };
  const f = (): void => {
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body;
      const q = b.rotation();
      const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      const o = b.translation();
      for (const n of names) {
        const p = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], { x: o.x, y: o.y, z: o.z }));
        const h = (hist[`${pl.id}:${n}`] ??= []);
        h.push(p);
        if (h.length > 3) h.shift();
        if (h.length === 3 && sim.t >= fromS) {
          const d = len(add(sub(h[2], scale(h[1], 2)), h[0]));
          if (d > peak.d) {
            peak.d = d;
            peak.t = sim.t;
          }
        }
      }
    }
  };
  return Object.assign(f, { peak });
}
const LIMBS = ['leftAnkle', 'rightAnkle', 'leftKnee', 'rightKnee', 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'];

describe('plan 08 opt-in', () => {
  it('only L3 fixtures take the composed planner and the locomotion profile; earlier ids keep their paths', () => {
    expect(FOOTWORK_L2.compose).toBeUndefined();
    expect(FOOTWORK_L3.id).toBe('footwork-l3-v2');
    expect(LOCOMOTION_L3.id).toBe('locomotion-l3-v2');
    for (const d of allFixtures()) {
      if (d.id.startsWith('L4-')) continue; // later than L3: its falls start from L3 fixtures, with their profiles
      if (d.id.startsWith('L3-')) {
        expect(d.footwork, d.id).toBe(FOOTWORK_L3);
        expect(d.locomotion, d.id).toBe(LOCOMOTION_L3);
      } else {
        expect(d.locomotion, d.id).toBeUndefined();
        expect((d.footwork as typeof FOOTWORK_L3 | undefined)?.compose, d.id).toBeUndefined();
      }
    }
  });

  it('asL3 keeps the source fixture and only adds the profiles', () => {
    const src = FIX('L2-F3-runStop');
    const d = asL3(src, 'L3-x');
    expect({ ...d, id: src.id, milestone: src.milestone, footwork: src.footwork, locomotion: undefined, carry: undefined, rules: src.rules, notes: src.notes, runClips: src.runClips }).toEqual({ ...src, locomotion: undefined, carry: undefined });
    // the user's stance widths, chosen by eye: the base profile keeps none, so the committed fixtures do not move
    expect(d.runClips!.stanceWidthAddM).toEqual({ walk: 0, 'fast-run': 0.065, sprint: 0.025 });
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

  it('preparation unwinds after the hold; contact needs observed contact or retention', () => {
    const st = newLocoState();
    drive(st, { closing: true }, 0.1);
    expect(st.mode).toBe('prep');
    drive(st, {}, P.contact.prepHoldS * 0.5, 0.1);
    expect(st.mode).toBe('prep');
    drive(st, {}, P.contact.prepHoldS * 0.6, 0.2);
    expect(st.mode).toBe('free');
    expect(st.reason).toBe('unwound');
  });

  it('a brief loss of contact does not chatter; exit needs its minimum time and a settled clip; recontact is named', () => {
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
  });

  it('falling interrupts every mode at once and clears the weights at the bounded rate', () => {
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
  });
});

describe('plan 08 pass 1: start, brake, settle', () => {
  it('L3-F16: the toe-off release and the 2.55 s variant lose their L2 spike; settled, both feet planted, no late hop', async () => {
    for (const id of ['L3-F16-runStop', 'L3-F16-stop2.55']) {
      const sim = await Simulation.create(FIX(id));
      const p = peaks(sim, LIMBS, 2.4);
      while (!sim.done) {
        sim.stepTick();
        p();
      }
      expect(p.peak.d, id).toBeLessThan(0.09);
      const R = sim.players[0];
      expect(R.feet!.feet.left.mode, id).toBe('planted');
      expect(R.feet!.feet.right.mode, id).toBe('planted');
      const last = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === 'R').at(-1)!;
      expect(last.t, id).toBeLessThan(4.6);
      sim.dispose();
    }
  }, 60000);

  it('the stop keeps the plan 07 motor, the physical lower stance and individual steps', async () => {
    const def = FIX('L3-F16-runStop');
    const src = FIX('L2-F3-runStop');
    expect(def.motor).toEqual(src.motor);
    expect(def.support).toEqual(src.support);
    const sim = await Simulation.create(def);
    let low = Infinity;
    const both: number[] = [];
    while (!sim.done) {
      sim.stepTick();
      const R = sim.players[0];
      if (sim.t > 2.6 && sim.t < 4) {
        low = Math.min(low, R.proxy.body.translation().y);
        if (R.feet!.feet.left.mode === 'swing' && R.feet!.feet.right.mode === 'swing') both.push(sim.t);
      }
    }
    expect(low).toBeLessThan(0.84);
    // the run's own flight ends with the clip: from the first plant of the handover on one foot is always down (the
    // planner takes the legs only when the foot in the air can land in time: that plant is at 3.28 s)
    const down = sim.events.find((e) => e.type === 'footPlant' && e.t > 3.2)!;
    expect(down.t).toBeLessThan(3.3);
    expect(both.filter((t) => t > down.t)).toEqual([]);
    sim.dispose();
  }, 30000);

  each(/^L3-F16-/, 'brake phases, the comparison stop and the interrupted stops stay valid', async (d) => {
    const sim = await run(d);
    expect(sim.result === 'duration' || sim.result === 'practiceOutOfBounds', `${d.id} ${sim.result}`).toBe(true);
    expect(count(sim, 'handoffRejected'), d.id).toBe(0);
    // the kick leaves the ground: a landing proposal may fail honestly there
    // the stopping player's own plants: L3-F16-contactStop's defender fails one honestly in contact, by 1.8 cm of reach
    const failed = sim.events.filter((e) => e.type === 'footPlantFailed' && e.playerId === sim.players[0].id).length;
    expect(failed, d.id).toBeLessThanOrEqual(d.id === 'L3-F16-kick' ? 2 : 0);
    sim.dispose();
  });

  each(/^L3-F16-(runStop|stop\d)/, 'a full stop stays in bounds long enough to show it settle: at rest, both feet held, no late step', async (d) => {
    const sim = await run(d);
    expect(sim.result, d.id).toBe('duration');
    const R = sim.players[0];
    const v = R.proxy.body.linvel();
    expect(Math.hypot(v.x, v.z), d.id).toBeLessThan(0.01);
    for (const s of SIDES) {
      expect(R.feet!.feet[s].mode, d.id).toBe('planted');
      expect(R.feet!.feet[s].tentative, d.id).toBe(false);
    }
    const last = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === R.id).at(-1)!;
    expect(sim.t - last.t, d.id).toBeGreaterThan(0.5);
    expect(count(sim, 'footPlantFailed'), d.id).toBe(0);
    sim.dispose();
  });

  each(/^L3-F16-(runStop|stop\d)/, 'a stop lands one foot, then the other: never two at once, never a held foot released with the other still up', async (d) => {
    const sim = await run(d);
    const R = sim.players[0];
    const ctl = d.players[0].controller;
    const brake = ctl.kind === 'script' ? ctl.segments.at(-1)!.fromS : 0;
    const plants = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === R.id && e.t > brake);
    expect(plants.length, d.id).toBeGreaterThan(3);
    for (let i = 1; i < plants.length; i++) {
      if (plants[i]!.data?.side === plants[i - 1]!.data?.side) continue;
      expect(plants[i]!.t - plants[i - 1]!.t, `${d.id} landings at ${plants[i - 1]!.t}`).toBeGreaterThan(0.1);
    }
    sim.dispose();
  });

  each(/^L3-F(16-(reaccel|runStop$|runStopFree|stop\d)|7-)/, 'no stance is skipped: outside contact a moving player is never long off the ground', async (d) => {
    // steady Fast Run has 0.12 s of flight; the skipped stance this guards against was 0.37 s
    const sim = await Simulation.create(d);
    const R = d.id.startsWith('L3-F7') ? sim.byId.get('R')! : sim.players[0];
    let upS = 0;
    let worst = 0;
    while (!sim.done) {
      sim.stepTick();
      if (R.rag || !R.feet || !R.pose) break;
      const j = R.pose.jointLandmarksWorld;
      const v = R.proxy.body.linvel();
      const onGround = SIDES.some((s) => R.feet!.feet[s].mode === 'planted') || Math.min(j.leftAnkle.y, j.rightAnkle.y) < 0.2;
      upS = onGround || R.loco?.mode === 'contact' || Math.hypot(v.x, v.z) < 3 ? 0 : upS + 1 / 60;
      worst = Math.max(worst, upS);
    }
    expect(worst, d.id).toBeLessThan(0.25);
    sim.dispose();
  });

  it('free arms brace, ready hands keep their assignment, carry stays on the ball', async () => {
    const at = async (id: string): Promise<{ left: number; right: number }> => {
      const sim = await Simulation.create(FIX(id));
      while (sim.t < 3.3) sim.stepTick();
      const R = sim.players[0];
      const lm = R.pose!.jointLandmarksWorld;
      const out = { left: dist(lm.leftPalm, lm.leftShoulder), right: dist(lm.rightPalm, lm.rightShoulder) };
      sim.dispose();
      return out;
    };
    const free = await at('L3-F16-runStopFree');
    const carry = await at('L3-F16-runStop');
    expect(free.right).toBeGreaterThan(carry.right + 0.05);
    expect(free.left).toBeGreaterThan(0.45);
  }, 30000);
});

describe('plan 08 pass 2: idle and walking', () => {
  it('L3-F13: stands still: no stepping, no root offset, no arm chatter, carrier and not', async () => {
    for (const id of ['L3-F13-carrier', 'L3-F13-free', 'L3-F13-ready']) {
      const sim = await Simulation.create(FIX(id));
      const p = peaks(sim, ['leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'], 0.5);
      while (!sim.done) {
        sim.stepTick();
        p();
      }
      expect(count(sim, 'footPlant', 'R'), id).toBeLessThanOrEqual(2);
      expect(p.peak.d, id).toBeLessThan(0.002);
      sim.dispose();
    }
  }, 30000);

  it('L3-F13 stops from different gait phases settle on existing plants and stay', async () => {
    for (const d of L3(/^L3-F13-settle/)) {
      const sim = await run(d);
      const last = sim.events.filter((e) => e.type === 'footPlant').at(-1)!;
      expect(last.t, d.id).toBeLessThan(d.durationS - 0.5);
      expect(sim.players[0].feet!.feet.left.mode).toBe('planted');
      expect(sim.players[0].feet!.feet.right.mode).toBe('planted');
      sim.dispose();
    }
  }, 30000);

  it('L3-F15: the fitted posture keeps the supplied stance and converts valid', async () => {
    const sim = await run(FIX('L3-F15-fitted'));
    const R = sim.players[0];
    const a = R.feet!.feet.left.ankleW;
    const b = R.feet!.feet.right.ankleW;
    expect(dist(a, b)).toBeGreaterThan(IDLE_POSE_RECORD.stance.widthM * 0.75);
    sim.dispose();
    const h = await run(FIX('L3-F15-handoff'));
    expect(count(h, 'handoffRejected')).toBe(0);
    expect(h.players[0].representation).toBe('ragdoll');
    h.dispose();
  }, 30000);

  it('L3-F14: a free arm swings visibly at a walk; the swing fades with the gait; carry and ready keep their assignment', async () => {
    const range = async (id: string, side: ArmSide): Promise<number> => {
      const sim = await Simulation.create(FIX(id));
      let lo = Infinity;
      let hi = -Infinity;
      while (!sim.done) {
        sim.stepTick();
        const R = sim.players[0];
        if (!R.pose || sim.t < 1.4 || sim.t > 2.5) continue; // steady walking: the ramped start has the clip by 1.3 s, the stop begins at 2.6 s
        const q = R.proxy.body.rotation();
        const p = qRot(qConj({ x: q.x, y: q.y, z: q.z, w: q.w }), sub(R.pose.jointLandmarksWorld[`${side}Wrist`], R.proxy.body.translation() as Vec3));
        lo = Math.min(lo, p.z);
        hi = Math.max(hi, p.z);
      }
      sim.dispose();
      return hi - lo;
    };
    expect(await range('L3-F14-forward', 'left')).toBeGreaterThan(0.12);
    expect(await range('L3-F14-carrier', 'left')).toBeGreaterThan(0.12);
    expect(await range('L3-F14-carrier', 'right')).toBeLessThan(0.05);
    expect(await range('L3-F14-ready', 'left')).toBeLessThan(0.05);
  }, 30000);

  it('L3-F14: a walk starts and stops over steps: ramped speed, alternating footfalls, the clip to the last stride', async () => {
    const sim = await Simulation.create(FIX('L3-F14-forward'));
    const R = sim.players[0];
    let was = 0;
    let wasT = 0;
    let up = 0;
    let down = 0;
    let lateW = 0;
    while (!sim.done) {
      sim.stepTick();
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
    }
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
    sim.dispose();
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
          row.push(sim.players.map((p) => (p.rag ? 'rag' : JSON.stringify(p.proxy.body.translation()))).join());
        }
        sim.dispose();
        out.push(row);
      }
      expect(out[0], id).toEqual(out[1]);
    }
  }, 30000);

  each(/^L3-F17-/, 'L3-F17: a run start goes foot by foot, the strides growing, through the walk into the run', async (d) => {
    const sim = await Simulation.create(d);
    while (!sim.done) sim.stepTick();
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
    expect(last).toBeGreaterThan(1.4);
    sim.dispose();
  });

  it('walk, run and stop stay valid; a conversion inside the walk-to-run blend passes the audit', async () => {
    for (const d of L3(/^L3-F14-/)) {
      const sim = await run(d);
      expect(count(sim, 'handoffRejected'), d.id).toBe(0);
      expect(count(sim, 'footPlantFailed'), d.id).toBe(0);
      sim.dispose();
    }
  }, 60000);
});

describe('plan 08 pass 3: contact integration', () => {
  each(/^L3-F1-/, 'no shared stance reset: anchors held at entry stay, every target finite, whatever the phase', async (d) => {
    {
      const sim = await Simulation.create(d);
      const before: Record<string, Record<string, Vec3 | null>> = {};
      while (!sim.done) {
        for (const pl of sim.players) {
          if (!pl.feet || !pl.pose) continue;
          for (const v of Object.values(pl.pose.jointLandmarksWorld)) expect(Number.isFinite(v.x + v.y + v.z), d.id).toBe(true);
          before[pl.id] = { left: pl.feet.feet.left.heelW, right: pl.feet.feet.right.heelW };
        }
        const was = sim.players.map((p) => p.loco?.mode);
        sim.stepTick();
        sim.players.forEach((pl, i) => {
          if (pl.rag || was[i] === pl.loco?.mode || pl.loco?.mode !== 'contact') return;
          for (const s of SIDES) {
            const h0 = before[pl.id]?.[s];
            const f = pl.feet!.feet[s];
            // a plant held across the entry keeps its anchor; the mode itself moves nothing
            if (h0 && f.mode === 'planted' && f.heelW && dist(h0, f.heelW) > 1e-9) expect(f.plantedAtS, `${d.id} ${pl.id} ${s}`).toBeGreaterThan(sim.t - 1 / 60 - 1e-6);
          }
        });
      }
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
    sim.runToEnd();
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
    sim.runToEnd();
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
    sim.runToEnd();
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

  /** The achieved arm segments against the arm profile and every live hold's palm against its anchor, each substep it exists. */
  const held = async (d: FixtureDef, watch: (s: Simulation) => void = () => {}): Promise<{ sim: Simulation; lengthM: number; gripGapM: number; grips: number; clamps: number; clampGapM: number }> => {
    const A = armProfile(d);
    const out = { lengthM: 0, gripGapM: 0, grips: 0, clamps: 0, clampGapM: 0 };
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        watch(s);
        const arms = s.arms!;
        for (const pl of s.players) {
          if (pl.rag) continue;
          const o = arms.obs(pl.id);
          for (const side of SIDES) {
            const a = o?.[side];
            if (!a) continue;
            // a held arm is shown by the arm solve: fixed segments, the free-arm composition adds nothing to it
            if (a.gripId || a.clampContactId) {
              out.lengthM = Math.max(out.lengthM, armLengthErr(a, A));
            }
            if (a.gripId) {
              const g = arms.grips.get(a.gripId)!;
              const t = s.byId.get(g.targetId)!;
              if (t.rag) continue;
              const b = t.proxy.body;
              const q = b.rotation();
              const p = b.translation();
              const anchor = add({ x: p.x, y: p.y, z: p.z }, qRot({ x: q.x, y: q.y, z: q.z, w: q.w }, g.targetPointLocal));
              out.gripGapM = Math.max(out.gripGapM, dist(a.palmContactWorld, anchor));
              out.grips++;
            }
            if (a.clampContactId) out.clamps++;
          }
        }
      },
    });
    sim.runToEnd();
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
    const d = FIX('L3-F4-gripTarget');
    const A = armProfile(d);
    let seen: ArmObs | null = null;
    const r = await held(d, (s) => {
      const o = s.arms!.obs('D');
      if (o?.left?.gripId) seen ??= structuredClone(o.left);
      // the held runner holds nothing: inspecting it would prove nothing
      const q = s.arms!.obs('R');
      expect(q?.left?.gripId ?? null).toBeNull();
      expect(q?.right?.gripId ?? null).toBeNull();
    });
    expect(seen).not.toBeNull();
    const a = seen!;
    expect(armLengthErr(a, A)).toBeLessThanOrEqual(ragOf(d).validation.lengthTolM);
    const stretched = { ...a, elbowWorld: add(a.elbowWorld, scale(sub(a.elbowWorld, a.shoulderWorld), 0.02)) };
    expect(armLengthErr(stretched, A)).toBeGreaterThan(ragOf(d).validation.lengthTolM);
    expect(dist(a.palmContactWorld, add(a.palmContactWorld, { x: 0.02, y: 0, z: 0 }))).toBeGreaterThan(A.surfaceTolM);
    r.sim.dispose();
  }, 30000);
});

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
    while (!sim.done) sim.stepTick();
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
      while (!sim.done) sim.stepTick();
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
      while (!sim.done) sim.stepTick();
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

describe('plan 08 foot limits at every actual substep', () => {
  const LIFT = FOOTWORK_L3.swing.maxLiftRateMps;
  const REJOIN = FOOTWORK_L3.rejoinMps;
  type Seen = { lift: number; offset: number; nLift: number; nOffset: number; ownerChanges: number; gap: number; nCarried: number; carriedStat: number; carriedFlat: number };
  /**
   * The vertical target speed and the offset recovery speed from outside the planner, between two substeps of one seed: a step
   * also from the substep it takes over without a reseed (a carried leg), or changes mode on its path. `carriedStat` and
   * `carriedFlat` are how far the planner's own record of that first update is from what it published, vertically and level.
   */
  const measure = async (d: FixtureDef): Promise<{ sim: Simulation; seen: Seen }> => {
    const seen: Seen = { lift: 0, offset: 0, nLift: 0, nOffset: 0, ownerChanges: 0, gap: 0, nCarried: 0, carriedStat: 0, carriedFlat: 0 };
    const last = new Map<string, { source: string; mode: string; target: Vec3; offset: Vec3; seeds: number; solved: Vec3; recoord: boolean }>();
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        for (const pl of s.players)
          for (const side of SIDES) {
            const f = pl.feet?.feet[side];
            // a converted player has no planner update: its stored rates are the last substep's, nothing moves the plan
            if (!f || pl.rag) continue;
            const k = `${pl.id}:${side}`;
            const p = last.get(k);
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
              // a reseed keeps the foot: the new owner's target starts one substep from the achieved foot
              seen.ownerChanges++;
              seen.gap = Math.max(seen.gap, dist(f.target, p.solved));
            }
            last.set(k, { source: f.source, mode: f.mode, target: { ...f.target }, offset: { ...f.offset }, seeds: f.seeds, solved: { ...f.solvedW }, recoord: f.rejoin || f.wait });
          }
      },
    });
    while (!sim.done) sim.stepTick();
    return { sim, seen };
  };
  const counters = (sim: Simulation): { lift: number; offset: number; margin: number } => ({
    lift: Math.max(...sim.players.map((p) => p.feet?.stats.liftRateMps ?? 0)),
    offset: Math.max(...sim.players.map((p) => p.feet?.stats.offsetDecayMps ?? 0)),
    margin: Math.min(...sim.players.map((p) => p.feet?.stats.stepCapMarginMps ?? Infinity)),
  });

  each(/^L3-/, 'vertical target and offset recovery stay inside their limits, measured inside the planner and from outside', async (d) => {
    const { sim, seen } = await measure(d);
    const c = counters(sim);
    expect(c.lift, d.id).toBeLessThanOrEqual(LIFT + 1e-6);
    expect(c.offset, d.id).toBeLessThanOrEqual(REJOIN + 1e-6);
    expect(seen.lift, d.id).toBeLessThanOrEqual(LIFT + 1e-6);
    expect(seen.offset, d.id).toBeLessThanOrEqual(REJOIN + 1e-6);
    expect(seen.gap, d.id).toBeLessThan(0.1);
    expect(seen.carriedStat, d.id).toBeLessThan(1e-6);
    expect(seen.carriedFlat, d.id).toBeLessThan(1e-6);
    expect(c.margin, d.id).toBeGreaterThanOrEqual(-1e-9);
    sim.dispose();
  });

  it('a carried handover is under the bound from its first update, and the planner records that update', async () => {
    // the follow path these legs came off was going down at 3.25 m/s (phase3) and 2.85 m/s (phase0) when a step took them over
    for (const id of ['L3-F1-phase3', 'L3-F1-phase0', 'L3-F1-low']) {
      const { sim, seen } = await measure(FIX(id));
      expect(seen.nCarried, id).toBeGreaterThan(0);
      expect(seen.lift, id).toBeGreaterThan(0.9 * LIFT);
      expect(seen.lift, id).toBeLessThanOrEqual(LIFT + 1e-6);
      sim.dispose();
    }
  }, 30000);

  it('the reported overruns run again: the limits are reached there, not avoided', async () => {
    for (const id of ['L3-F16-runStop', 'L3-F14-walkRunStop', 'L3-F7-phase0']) {
      const { sim, seen } = await measure(FIX(id));
      const c = counters(sim);
      expect(seen.nLift, id).toBeGreaterThan(100);
      expect(seen.nOffset, id).toBeGreaterThan(100);
      expect(seen.ownerChanges, id).toBeGreaterThan(4);
      expect(Math.max(c.lift, seen.lift), id).toBeGreaterThan(0.9 * LIFT);
      sim.dispose();
    }
  }, 60000);
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
      mps.push(len(sim.players[0].walkRequest ?? { x: 0, y: 0, z: 0 }));
    }
    return { sim, mps };
  };

  it('the reproduction: a walk decided every 0.05 s ramps to 1.20 m/s by 1.5 s and stops', async () => {
    const { sim, mps } = await requests('L3-F14-forward', DECIDE_S);
    const at = (t: number): number => mps[Math.round(t / sim.def.solver.outerTickS) - 1];
    expect(at(1.5)).toBeCloseTo(1.2, 6);
    expect(at(0.5 + 0.5)).toBeGreaterThan(0.5);
    expect(at(2.45)).toBeCloseTo(1.2, 6);
    expect(mps.at(-1)).toBe(0);
    sim.dispose();
  }, 30000);

  it('decision intervals 0 and 0.05 s, aligned at the request changes, ramp and stop alike', async () => {
    for (const id of ['L3-F14-forward', 'L3-F14-walkRunStop']) {
      const a = await requests(id, 0);
      const b = await requests(id, DECIDE_S);
      expect(b.mps.length, id).toBe(a.mps.length);
      a.mps.forEach((m, i) => expect(b.mps[i], `${id} tick ${i}`).toBeCloseTo(m, 6));
      expect(traceDiff(a.sim.trace, b.sim.trace, a.sim.players.map((p) => p.id)).pos, id).toBeLessThan(1e-3);
      a.sim.dispose();
      b.sim.dispose();
    }
  }, 60000);

  it('a reset inherits no request: the run after it matches a fresh one', async () => {
    const fresh = await run(FIX('L3-F14-forward'));
    const sim = await Simulation.create(FIX('L3-F14-forward'));
    while (sim.t < 1 - 1e-9) sim.stepTick();
    expect(len(sim.players[0].walkRequest!)).toBeGreaterThan(0.5);
    sim.reset();
    expect(sim.players[0].walkRequest).toBeUndefined();
    expect(sim.players[0].walkWant).toBeUndefined();
    sim.runToEnd();
    expect(traceDiff(sim.trace, fresh.trace, sim.players.map((p) => p.id)).pos).toBe(0);
    sim.dispose();
    fresh.dispose();
  }, 30000);

  it('a referee ending stops the request at once between decisions', async () => {
    // L3-F1-phase0 is called down at 1.11 s: deciding every 0.05 s from just before it, the substep after the call no supported
    // player has a request left from the last decision
    const sim = await Simulation.create(FIX('L3-F1-phase0'));
    while (sim.t < 1.05 - 1e-9) sim.stepTick();
    for (const pl of sim.players) (pl.controller as { decisionIntervalS: number }).decisionIntervalS = DECIDE_S;
    while (!sim.done && !sim.rules?.ending) sim.stepTick();
    expect(sim.rules?.ending).toBeTruthy();
    sim.stepTick();
    let seen = 0;
    for (const pl of sim.players)
      if (pl.controlMode === 'supported' && pl.walkWant && pl.representation !== 'ragdoll') {
        seen++;
        expect(len(pl.walkWant), pl.id).toBe(0);
        expect(len(pl.applied.requestedVelocity), pl.id).toBe(0);
      }
    expect(seen).toBeGreaterThan(0);
    sim.dispose();
  }, 30000);

  it('a referee ending in a walk reaches the motor: no ramp back up, no forward drive after the call', async () => {
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
    while (!sim.done) sim.stepTick();
    expect(sim.rules?.ending?.kind).toBe('sidelineOut');
    expect(speedAtCall, 'the call comes mid walk').toBeGreaterThan(1);
    expect(sim.players[0].loco?.mode).toBe('free');
    expect(after.length).toBeGreaterThan(10);
    for (const a of after) {
      expect(a.request).toBe(0);
      expect(a.along).toBeLessThanOrEqual(1e-9);
    }
    sim.dispose();
  }, 30000);

  it('contact and run requests still pass through the ramp between decisions', async () => {
    // a contact run has no ramped request left over from an older decision
    const sim = await Simulation.create(FIX('L3-F7-phase0'));
    for (const pl of sim.players) (pl.controller as { decisionIntervalS: number }).decisionIntervalS = DECIDE_S;
    let seen = 0;
    while (!sim.done) {
      sim.stepTick();
      for (const pl of sim.players) {
        if (pl.loco?.mode !== 'contact' || pl.controlMode !== 'supported') continue;
        seen++;
        expect(dist(pl.walkRequest!, pl.walkWant!), pl.id).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(10);
    sim.dispose();
  }, 30000);
});

describe('plan 08 lifecycle and reproducibility', () => {
  it('L3-F12: render rate never changes the fixed-step run (no renderer in the loop: hidden players cannot matter)', async () => {
    for (const def of [FIX('L3-F7-phase25'), FIX('L3-F10-both')]) {
      const byRate = async (hz: number): Promise<Simulation> => {
        const s = await Simulation.create(def);
        const drv = new FixedStepDriver(def.solver.outerTickS, 8);
        while (!s.done) for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) s.stepTick();
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
      while (!sim.done && sim.t < stop - 1e-9) sim.stepTick();
      sim.reset();
      expect(sim.counts()).toEqual(base);
      expect(sim.players.every((p) => !p.loco || p.loco.mode === 'free')).toBe(true);
    }
    sim.runToEnd();
    expect(traceDiff(sim.trace, ref.tr, sim.players.map((p) => p.id)).pos).toBe(0);
    expect(JSON.stringify(sim.events)).toBe(ref.ev);
    sim.dispose();
  }, 60000);

  it('the export names the locomotion and footwork profiles and the per-player mode', async () => {
    const sim = await run(FIX('L3-F7-phase0'));
    const x = sim.exportFixture() as { profiles: Record<string, unknown> };
    expect(JSON.stringify(x.profiles)).toContain('locomotion-l3-v2');
    expect(JSON.stringify(x.profiles)).toContain('footwork-l3-v2');
    expect(sim.trace.at(-1)!.players.R.loco).toBeDefined();
    sim.dispose();
  });
});
