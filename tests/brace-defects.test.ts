// Contact motion M2 follow-up, tracked defects (rule 5) the carrier's brace reached: mechanisms the brace flip's (and the
// lean flip's) moved trajectories run into, each on a full-state capture a little before it (tests/data/state; how to
// capture: tests/README.md). Each test pins the defect present in its captured state and fails once the defect is gone
// from it (it then becomes the fix's test, with its fault twin). The twin resumes the same state with the carrier's brace
// off (`preBrace`, variant `brace`): where the defect is there too, the brace reaches it and does not make it. The
// defects and their dispositions: docs/handoff/contact-motion-m2.md, "Tracked defects".
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { SEGMENTS } from '../src/sim/ragdoll';
import type { Simulation } from '../src/sim/simulation';
import { len, lerp, sub, vc } from '../src/sim/vec';
import { passiveEnergyMeter, type SolveEnergy } from './passive-energy';
import { asCaptured, preBrace } from './runs';
import { loadState, resumeState } from './state';
import { depth, drawnShapes, jointQuats, qAngle, SNAP_RADPS } from './visible';

type DShape = Parameters<typeof depth>[0];

/** Resume `file` as captured, or with the carrier's brace off from there. */
async function resume(file: string, brace: boolean): Promise<Simulation> {
  const cap = loadState(`tests/data/state/${file}.json.gz`);
  const def = asCaptured(cap);
  expect(def.brace, file).toBeDefined();
  return resumeState(cap, brace ? { def } : { def: preBrace(def), variant: ['brace'] });
}

/** Steps `sim` tick by tick to `untilS`, calling `each` after every tick. */
function runTo(sim: Simulation, untilS: number, each: () => void): void {
  while (!sim.done && sim.t < untilS - 1e-9) {
    sim.stepTick();
    each();
  }
}

/** Per tick, each pose joint of player `id` that turned faster than the visible meter's snap (rad/s), as the meter reads. */
function snaps(sim: Simulation, id: string, untilS: number): { t: number; joint: string; radps: number; rep: string }[] {
  const out: { t: number; joint: string; radps: number; rep: string }[] = [];
  const dt = sim.def.solver.outerTickS;
  let prev: { rep: string; q: ReturnType<typeof jointQuats> } | null = null;
  const p = sim.byId.get(id)!;
  runTo(sim, untilS, () => {
    if (!p.pose) return;
    const q = jointQuats(p.pose);
    if (prev && prev.rep === p.representation)
      for (const [joint, x] of Object.entries(q)) {
        const radps = qAngle(prev.q[joint], x) / dt;
        if (radps > SNAP_RADPS) out.push({ t: Number(sim.t.toFixed(4)), joint, radps, rep: p.representation });
      }
    prev = { rep: p.representation, q };
  });
  return out;
}

describe('contact motion M2 tracked defects (rule 5)', () => {
  // (a) The defender's forearm whips at up to 13 m/s as a ragdoll in the falling families (HC-F3, L3-F1, L3-F9, L4-F9
  // `-falling`; player-runs with a ragdoll body at 9 m/s or more: 25 before the brace, 40 under V1, 36 under V2).
  // L3-F1-falling under CARRIER_BRACE_V1, captured at 0.667 s with the carrier braced and still supported (he loses
  // support at 0.783 s): D's left forearm reaches 12.80 m/s at 1.267 s. Twin, brace off from there: 12.79 m/s at the same
  // tick. Reached. (Under V2 this run's fastest defender body is 9.56 m/s; the fastest now are in L3-F3-side, 13.5 m/s.)
  it('FAST_FOREARM (L3-F1-falling, brace V1, from 0.667 s): the falling defender\'s left forearm passes 12 m/s by 1.3 s, with the brace and without it', async () => {
    const peak = async (brace: boolean) => {
      const sim = await resume('L3-F1-falling@40', brace);
      const D = sim.byId.get('D')!;
      let v = 0;
      let seg = '';
      runTo(sim, 1.3, () => {
        if (!D.rag) return;
        for (const s of SEGMENTS) {
          const x = len(vc(D.rag.bodies[s].linvel()));
          if (x > v) [v, seg] = [x, s];
        }
      });
      sim.dispose();
      return { v, seg };
    };
    for (const brace of [true, false]) {
      const p = await peak(brace);
      expect(p.seg, `brace ${brace}`).toBe('leftForearm');
      expect(p.v, `brace ${brace}`).toBeGreaterThan(12);
    }
  }, 60000);

  // (b) The defender's right hip, supported, snaps (65 rad/s, one tick) at 0.783 s in L3-F1-phase4 and HC-F3-phase50,
  // reversed order, under V1 (gone under V2: no supported snap is left in L3, L4 or HC). L3-F1-phase4 reversed under
  // CARRIER_BRACE_V1, captured at 0.750 s with the carrier braced (he loses support at 0.842 s). Twin, brace off: the same
  // tick, 64.2 rad/s against 65.0. Reached.
  it('HIP_SNAP (L3-F1-phase4 reversed, brace V1, from 0.750 s): the supported defender\'s right hip turns past the snap rate at 0.783 s, with the brace and without it', async () => {
    for (const brace of [true, false]) {
      const sim = await resume('L3-F1-phase4~bracev1-rev@45', brace);
      const s = snaps(sim, 'D', 0.8);
      sim.dispose();
      expect(s.map((x) => `${x.t} ${x.joint} ${x.rep}`), `brace ${brace}`).toEqual(['0.7833 rightHip proxy']);
    }
  }, 60000);

  // (c) The defender's wrap upper arm in his own trunk (the arm task's self shapes are the forearm and palm only; ladder
  // 13c `SelfClearanceProfile.upperArm`, parked, takes the upper arm in): the distal half's axis over 1 cm inside the
  // drawn trunk, player-seconds over L3, L4 and HC both orders, 0.55 before the brace, 6.5 under V1 (defenders that stayed
  // up wrapping), 0.8 under V2. L3-F1-phase5 as registered, captured at 0.700 s with the carrier braced: D's right upper
  // arm is inside from 0.717 s to 0.850 s, 2.3 cm at most. Twin, brace off: the same nine ticks, 1.7 cm at most (the braced
  // carrier presses the wrap deeper; the arm is in its trunk without him). Reached.
  it('UPPER_ARM_IN_TRUNK (L3-F1-phase5, from 0.700 s): the supported defender\'s wrap upper arm is over 1 cm inside his own trunk for at least eight ticks, with the brace and without it', async () => {
    const I = { x: 0, y: 0, z: 0, w: 1 };
    for (const brace of [true, false]) {
      const sim = await resume('L3-F1-phase5@42', brace);
      const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
      const D = sim.byId.get('D')!;
      const inside: string[] = [];
      runTo(sim, 0.9, () => {
        if (!D.pose || D.representation !== 'proxy' || D.controlMode !== 'supported') return;
        const trunk = drawnShapes(D.pose, D.body, R).filter((s) => s.cls === 'trunk');
        const lm = D.pose.jointLandmarksWorld;
        for (const side of ['left', 'right'] as const) {
          const a = lerp(lm[`${side}Shoulder`], lm[`${side}Elbow`], 0.5);
          const b = lm[`${side}Elbow`];
          const axis = { key: `${side}UpperDAx`, cls: 'upperArmD', side, seg: { a, b, r: 1e-3 }, p: lerp(a, b, 0.5), q: I, c: lerp(a, b, 0.5), r: len(sub(b, a)) / 2 + 1e-3 } as DShape;
          if (Math.max(0, ...trunk.map((t) => depth(axis, t))) > 0.01) inside.push(`${side} ${sim.t.toFixed(3)}`);
        }
      });
      sim.dispose();
      expect(inside.length, `brace ${brace}: ${inside.join(', ')}`).toBeGreaterThanOrEqual(8);
      expect(inside.every((x) => x.startsWith('right')), `brace ${brace}`).toBe(true);
    }
  }, 60000);

  // (d) The carry forearm pinched between the carrier's own trunk and the ground gains energy in one solve (the pinch;
  // tests/passive-energy.ts). Carrier pinches over 5 J, L3, L4 and HC both orders: 6 before the brace, 8 under V1, 7 under
  // V2; the largest 86 J (L4-F5-oneClamp-on reversed) before it, 210 J (L3-F1-phase3) under V1, 166 J under V2.
  // L3-F1-low reversed as registered, captured at 1.067 s, the carrier a ragdoll since 0.771 s: his right forearm gains
  // 165.9 J in the solve ending at 1.092 s. Twin, brace off: the same solve, the same gain (a ragdoll has no brace; from
  // 0.75 s, before his conversion, the run without it has no pinch: the moved trajectory). Reached.
  it('CARRY_PINCH (L3-F1-low reversed, from 1.067 s): the carrier\'s pinched right forearm gains over 100 J in one solve, with the brace and without it', async () => {
    for (const brace of [true, false]) {
      const sim = await resume('L3-F1-low~rev@64', brace);
      const got: SolveEnergy[] = [];
      const meter = passiveEnergyMeter(sim, (e) => void (e.pid === 'R' && !e.touched && e.passiveJ > 100 && got.push(e)));
      runTo(sim, 1.15, () => {});
      meter.restore();
      sim.dispose();
      expect(got.map((e) => `${e.t.toFixed(4)} [${e.pinch.join(',')}]`), `brace ${brace}`).toEqual(['1.0917 [rightForearm]']);
    }
  }, 60000);

  // (e) A ragdoll defender's shoulder snaps: his upper arm, lying on the ground, spun about its own axis at up to 100
  // rad/s relative to the core as his forearm swings up through the elbow. Ragdoll snaps in L3, L4 and HC: none before
  // the brace (earlier rungs had them, e.g. L4-F10-elbow-off R's right shoulder, 86 rad/s, ladder 8c), 2 under V1
  // (L4-F9-defenderRising, L4-F5-oneClamp-on, 1.217 s), 4 under V2 (L4-F9-defenderFalling 1.133 s, HC-F3-mirror
  // reversed, L3-F1-phase3 both orders). L4-F9-defenderFalling as registered, captured at 1.083 s, both players ragdolls
  // since 0.725 s: D's right shoulder 94.5 rad/s at 1.133 s and 72.7 at 1.150 s. Twin, brace off: the same. Reached.
  it('RAGDOLL_SHOULDER_SNAP (L4-F9-defenderFalling, from 1.083 s): the ragdoll defender\'s right shoulder turns past the snap rate at 1.133 s with the upper arm on the ground, with the brace and without it', async () => {
    for (const brace of [true, false]) {
      const sim = await resume('L4-F9-defenderFalling@65', brace);
      const D = sim.byId.get('D')!;
      const s = snaps(sim, 'D', 1.13);
      const armY = D.rag!.bodies.rightUpperArm.translation().y;
      sim.dispose();
      expect(s.map((x) => `${x.t} ${x.joint} ${x.rep}`), `brace ${brace}`).toEqual(['1.1333 rightShoulder ragdoll']);
      expect(armY, `brace ${brace}`).toBeLessThan(0.05);
    }
  }, 60000);
});
