// Plan 16, the base (block-base.ts; BASE_V1, the stance: the feet cover the pressure the balance asks for; BASE_V2, and the
// balance held to what the planted feet give). The reading on a constructed pose; then constructed scenes from the BL
// family's package (fixtures/blocking.ts `blockScene` on L3-F6-hold's definition): both men driving hard at effort 1
// asking 1.4 m/s (BLOCK_V1_HARD, as BL-F7-hard) for 3.5 s, A's hands under. Each case has its fault twin: a swing foot
// read as planted, today's stance, a brace that always steps back, the short base, the fixed ceiling, no conversion.
import { describe, expect, it } from 'vitest';
import { BASE_V2, baseMoments, limitToBase, soleContacts, SOLE_TOUCH_M, type BlockBase } from '../src/sim/block-base';
import type { ArmSide } from '../src/sim/contracts';
import { BLOCK_V1, withBase, type BlockProfile } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BLOCK_V1_HARD, blockScene, type BlockMan } from '../src/sim/fixtures/blocking';
import type { FootPlan } from '../src/sim/footwork';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { cross, dot, norm, qFromAxisAngle, v3, UP, type Vec3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
const W = 867;
const SHOE = { he: v3(0.09, 0.09, 0.15), centerFoot: v3(0, -0.03, 0.06) };

/** A constructed foot plan: each foot's mode, ankle and shoe frame (only what the reading reads). */
const plan = (feet: Record<ArmSide, { mode: string; ankleW: Vec3; footQ?: { x: number; y: number; z: number; w: number } }>): FootPlan =>
  ({ shoe: SHOE, feet: { left: { footQ: { x: 0, y: 0, z: 0, w: 1 }, ...feet.left }, right: { footQ: { x: 0, y: 0, z: 0, w: 1 }, ...feet.right } } }) as unknown as FootPlan;

const man = (profile: BlockProfile, hands: 'under' | 'over'): BlockMan => ({ effort: 1, intent: 'drive', hands, profile });
const on = (base: BlockBase, widthAddM = 0.03): BlockProfile => withBase(BLOCK_V1_HARD, base, widthAddM);
const hard = (A: BlockProfile, B: BlockProfile, durationS = 3.5): FixtureDef =>
  blockScene({ id: 'BL-T-base', title: 'plan 16 base (test)', A: man(A, 'under'), B: man(B, 'over'), durationS }, FIX('L3-F6-hold'));

interface Run {
  /** First time each man left support (s); time A was a rigid falling proxy (s); A a ragdoll at the end. */
  down: Record<string, number>;
  rigidS: number;
  ragAtEnd: boolean;
  /** A's engaged substeps, those with his rear ankle `behindM` behind his hips along the line to B, the most behind (m). */
  engaged: number;
  behind: number;
  rearMinM: number;
  /** Engaged substeps whose applied balance torque about the push line's normal is past what the planted feet give (N m, worst). */
  pastBase: number;
  pastBaseMaxNm: number;
}

const core = (p: PlayerRuntime) => (p.rag ? p.rag.bodies.core : p.proxy.body);

/** `noConversion`: a fault, the simulation's conversions skipped (a man who loses his balance stays the rigid falling proxy). */
async function run(def: FixtureDef, behindM = 0.15, noConversion = false): Promise<Run> {
  const r: Run = { down: {}, rigidS: 0, ragAtEnd: false, engaged: 0, behind: 0, rearMinM: Infinity, pastBase: 0, pastBaseMaxNm: 0 };
  // the base the motor step reads: the feet as shown after the substep before, the line from its end
  const prev = new Map<string, { pts: Vec3[]; u: Vec3 }>();
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      for (const p of sim.players) {
        const him = sim.players.find((o) => o !== p)!;
        if (p.rag || p.controlMode !== 'supported') r.down[p.id] ??= sim.t;
        if (p.id === 'A' && p.controlMode === 'falling' && !p.rag) r.rigidS += sim.physics.dt;
        if (p.rag || !p.feet || !p.sus) {
          prev.delete(p.id);
          continue;
        }
        const was = prev.get(p.id);
        const me = p.proxy.body.translation();
        const to = core(him).translation();
        const u = norm(v3(to.x - me.x, 0, to.z - me.z));
        if (p.block?.phase === 'engaged' && p.controlMode === 'supported') {
          if (was) {
            const m = baseMoments(was.pts, p.sus.pivotPointWorld, was.u, p.proxy.body.mass() * Math.abs(def.solver.gravityY));
            const pitch = dot(p.applied.balanceCapped, cross(UP, was.u));
            const past = Math.max(pitch - m.back, -m.front - pitch);
            if (past > 1) {
              r.pastBase++;
              r.pastBaseMaxNm = Math.max(r.pastBaseMaxNm, past);
            }
          }
          if (p.id === 'A') {
            const lm = p.pose!.jointLandmarksWorld;
            const hip = v3((lm.leftHip.x + lm.rightHip.x) / 2, 0, (lm.leftHip.z + lm.rightHip.z) / 2);
            const rear = Math.min(...SIDES.map((s) => dot(v3(lm[`${s}Ankle`].x - hip.x, 0, lm[`${s}Ankle`].z - hip.z), u)));
            r.engaged++;
            if (rear < -behindM) r.behind++;
            r.rearMinM = Math.min(r.rearMinM, rear);
          }
        }
        prev.set(p.id, { pts: soleContacts(p.feet, SOLE_TOUCH_M), u });
      }
    },
  });
  if (noConversion) (sim as unknown as { convertBatch: () => void }).convertBatch = () => {};
  await runSim(sim, Infinity);
  r.ragAtEnd = !!sim.players.find((p) => p.id === 'A')!.rag;
  sim.dispose();
  return r;
}

describe('plan 16, the base (BASE_V1, BASE_V2)', () => {
  it('(a) what the planted feet give: weight times the reach of their touching soles from the support point, behind, ahead and to either side; a foot in a step and a heel shown lifted give nothing', () => {
    // feet square 0.4 m apart, the rear (right) ankle 0.2 m behind the support point, the front 0.1 m ahead; the line +z
    const sp = v3(0, 0, 0);
    const u = v3(0, 0, 1);
    const rear = v3(-0.2, 0.12, -0.2);
    const front = v3(0.2, 0.12, 0.1);
    const both = baseMoments(soleContacts(plan({ left: { mode: 'planted', ankleW: front }, right: { mode: 'planted', ankleW: rear } }), SOLE_TOUCH_M), sp, u, W);
    // heel 0.09 m behind the ankle (0.06 - 0.15), toe 0.21 ahead; the soles' outer edges 0.09 m out from each ankle
    expect(both.back).toBeCloseTo(W * (0.2 + 0.09), 6);
    expect(both.front).toBeCloseTo(W * (0.1 + 0.21), 6);
    expect(both.left).toBeCloseTo(W * 0.29, 6); // up x +z is +x: his left facing his man
    expect(both.right).toBeCloseTo(W * 0.29, 6);
    // the rear foot in a step: nothing behind the support point (fault twin: the same foot planted gives the 251 N m)
    const stepping = baseMoments(soleContacts(plan({ left: { mode: 'planted', ankleW: front }, right: { mode: 'swing', ankleW: rear } }), SOLE_TOUCH_M), sp, u, W);
    expect(stepping.back, 'behind, the rear foot in a step').toBe(0);
    expect(stepping.front).toBeCloseTo(both.front, 6);
    expect(baseMoments(soleContacts(plan({ left: { mode: 'swing', ankleW: front }, right: { mode: 'swing', ankleW: rear } }), SOLE_TOUCH_M), sp, u, W), 'no foot planted').toEqual({ back: 0, front: 0, left: 0, right: 0 });
    // the rear foot planted on its toe (shown pitched 40 deg toe down about its ankle): only its toe, 0.2 - 0.21 cos 40 behind
    const toeDown = qFromAxisAngle(v3(1, 0, 0), (40 * Math.PI) / 180);
    const onToe = baseMoments(soleContacts(plan({ left: { mode: 'planted', ankleW: front }, right: { mode: 'planted', ankleW: rear, footQ: toeDown } }), SOLE_TOUCH_M), sp, u, W);
    const toeZ = -0.2 + (0.06 + 0.15) * Math.cos((40 * Math.PI) / 180) - 0.12 * Math.sin((40 * Math.PI) / 180);
    expect(onToe.back, 'behind, the rear heel shown lifted').toBeCloseTo(W * Math.max(0, -toeZ), 3);
    expect(onToe.back).toBeLessThan(both.back - 150);
  });

  it('(b) the balance torque is held to the base: its pitch within [-front, back], its roll within [-right, left], the vertical part as it is; inside, untouched', () => {
    const u = v3(0, 0, 1);
    const a = cross(UP, u);
    const m = { back: 100, front: 300, left: 50, right: 60 };
    const held = limitToBase(v3(250, 40, 0), m, u); // +x is a: a pitch of 250 asks the pressure behind
    expect(dot(held.torque, a)).toBeCloseTo(100, 9);
    expect(held.torque.y).toBe(40);
    expect(held.saturated).toBe(true);
    expect(dot(limitToBase(v3(-400, 0, 0), m, u).torque, a)).toBeCloseTo(-300, 9);
    expect(dot(limitToBase(v3(0, 0, 80), m, u).torque, u)).toBeCloseTo(50, 9);
    expect(dot(limitToBase(v3(0, 0, -80), m, u).torque, u)).toBeCloseTo(-60, 9);
    const inside = limitToBase(v3(-120, 5, 30), m, u);
    expect(inside.saturated).toBe(false);
    expect(inside.torque).toEqual(v3(-120, 5, 30));
    expect(len3(limitToBase(v3(90, 0, 70), { back: 0, front: 0, left: 0, right: 0 }, u).torque), 'no base: no horizontal torque').toBe(0);
  });

  it('(c) under a hard push the base is kept: on BASE_V2 A, pushed back, has his rear foot 0.15 m or more behind his hips on 80 % of his engaged time, stands, and his balance never pushes past what his planted feet give; on today\'s stance (fault twin) it stays within 0.05 m and the fixed ceiling pushes past them', async () => {
    const based = await run(hard(on(BASE_V2), on(BASE_V2)));
    expect(based.down, 'who left support').toEqual({});
    expect(based.behind / based.engaged, 'engaged time with the rear foot 0.15 m behind').toBeGreaterThan(0.8);
    expect(based.pastBase, `substeps past the base (worst ${based.pastBaseMaxNm.toFixed(0)} N m)`).toBe(0);
    const today = await run(hard(BLOCK_V1_HARD, BLOCK_V1_HARD));
    expect(today.rearMinM, 'rear foot on today\'s stance (m)').toBeGreaterThan(-0.05);
    expect(today.pastBase, 'the fixed ceiling past the feet').toBeGreaterThan(0);
  }, 180_000);

  it('(d) a light push keeps the stance: in an even hold at effort 0.5 (as BL-F1-even) on BASE_V2 the rear foot never goes more than 0.05 m behind the hips; a brace that always steps back (fault twin: a 0.4 m margin) takes it back', async () => {
    const even = (p: BlockProfile): FixtureDef =>
      blockScene({ id: 'BL-T-base', title: 'plan 16 base (test)', A: { effort: 0.5, intent: 'hold', hands: 'under', profile: p }, B: { effort: 0.5, intent: 'hold', hands: 'over', profile: p }, durationS: 3 }, FIX('L3-F6-hold'));
    const light = await run(even(withBase(BLOCK_V1, BASE_V2, 0.03)), 0.05);
    expect(light.engaged).toBeGreaterThan(0);
    expect(light.behind, 'engaged substeps with the rear foot 0.05 m behind').toBe(0);
    const always = await run(even(withBase(BLOCK_V1, { ...BASE_V2, id: 'test-always-back', brace: { marginM: 0.4 } }, 0.03)), 0.05);
    expect(always.behind, 'the always-back brace').toBeGreaterThan(0);
  }, 180_000);

  it('(e) the long base holds the push that topples the same man on a short base: on BASE_V2 A stands; resisting without the brace (his feet kept under him) he leaves support within 2 s', async () => {
    const short = await run(hard(on({ id: 'test-short', resist: true }), on({ id: 'test-short', resist: true })));
    expect(short.down.A ?? Infinity, 'A down on the short base (s)').toBeLessThan(2);
    // (the long base: case (c), the same push, stands)
  }, 180_000);

  it('(f) pushed hard with his feet together (2 cm from his centre) he goes over, as a ragdoll: off support within 2 s, a rigid falling proxy for at most 0.1 s, a ragdoll at the end; on the fixed ceiling (fault twin) he stands; with the conversion skipped (fault twin) he falls rigid', async () => {
    const together = on({ id: 'test-together', resist: true }, -0.15);
    const over = await run(hard(together, BLOCK_V1_HARD));
    expect(over.down.A ?? Infinity, 'A down (s)').toBeLessThan(2);
    expect(over.rigidS, 'A a rigid falling proxy (s)').toBeLessThanOrEqual(0.1);
    expect(over.ragAtEnd, 'A a ragdoll at the end').toBe(true);
    const fixed = await run(hard(on({ id: 'test-together-fixed' }, -0.15), BLOCK_V1_HARD));
    expect(fixed.down.A, 'A on the fixed ceiling').toBeUndefined();
    const stiff = await run(hard(together, BLOCK_V1_HARD), 0.15, true);
    expect(stiff.down.A ?? Infinity, 'A down, the conversion skipped (s)').toBeLessThan(2);
    expect(stiff.rigidS, 'A rigid, the conversion skipped (s)').toBeGreaterThan(0.1);
  }, 240_000);
});

function len3(t: Vec3): number {
  return Math.hypot(t.x, t.y, t.z);
}
