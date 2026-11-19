// Plan 16 (p42): the hit (`ContestHit`, CONTEST_V2) with the strike it is for (BLOCK_STRIKE_V4). (a) The force pair:
// the closing (with the punch's parting) over tauS, at most maxN; the winner's legs hold his part; an even meeting shares
// it. (b) A state captured just before the snap in BL-F9-threePoint's set with both men on CONTEST_V2 and
// BLOCK_STRIKE_V4, resumed with the hit on and off (CONTEST_V2 without `hit`), without the hips' torque while striking
// and driving (`strike.hipNm`), and without the hips held low until a palm lands (`strike.riseOnLand`). Each with its
// fault twin.
import { describe, expect, it } from 'vitest';
import { CONTEST_V2, hitPair, type BlockContest, type ContestHit } from '../src/sim/block-base';
import { BLOCK_STRIKE_V4, type BlockProfile, type BlockStrike } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, contested } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { add, dot, norm, qRot, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p42), the hit', () => {
  it("(a) the force pair: the closing with the punch's parting over tauS, at most maxN; the man with twice his man's push capacity holds all his part, half way between half of it; an even meeting shares it; none once they part faster than the punch; fault twins: without the punch they do not close, and a winner who held nothing would be moved as much as his man", () => {
    const H: ContestHit = CONTEST_V2.hit!;
    // two 100 kg men (reduced mass 50 kg) closing at 2.8 m/s: 50 * 2.8 / 0.02 = 7000 N, at most 3000
    const even = hitPair(H, 50, 2.8, 0.5, 300, 300);
    expect(even.F, 'at most maxN').toBe(3000);
    expect(even.onA, 'even: a moved').toBe(-3000);
    expect(even.onB, 'even: b moved').toBe(3000);
    const won = hitPair(H, 50, 2.8, 0.5, 600, 300);
    expect(won.onA, 'twice the capacity: a holds his part').toBeCloseTo(0, 9);
    expect(won.onB, 'b takes the hit').toBe(3000);
    const half = hitPair(H, 50, 2.8, 0.5, 450, 300);
    expect(half.onA, 'half way: half his part').toBeCloseTo(-1500, 6);
    expect(hitPair(H, 50, 2.8, 0.5, 300, 600).onB, 'b the winner').toBeCloseTo(0, 9);
    // parting at 0.6 m/s with a punch of 1 m/s: still closing by 0.4, 50 * 0.4 / 0.02 = 1000 N
    expect(hitPair(H, 50, -0.6, 1, 300, 300).F, 'the punch parts them on').toBeCloseTo(1000, 6);
    expect(hitPair(H, 50, -0.6, 0.5, 300, 300).F, 'parting faster than the punch: none').toBe(0);
    // a man with no contest: neither holds
    const bare = hitPair(H, 50, 2.8, 0, 600);
    expect([bare.onA, bare.onB], 'no contest on b').toEqual([-3000, 3000]);
    // fault twins
    expect(hitPair(H, 50, -0.6, 0, 300, 300).F, 'no punch: parting, none').toBe(0);
    expect(hitPair({ ...H, winX: Infinity }, 50, 2.8, 0.5, 600, 300).onA, 'a winner holding nothing is moved').toBe(-3000);
  });

  // BL-F9-threePoint's set (A three-point offense driving, B defense holding, both at 0.5, 2 m, the snap at 3.3 s)
  const SNAP = 3.3;
  function scene(o: { noHit?: boolean; noHip?: boolean; noLow?: boolean } = {}): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    const C: BlockContest = o.noHit ? { ...CONTEST_V2, hit: undefined } : CONTEST_V2;
    const st = { ...BLOCK_STRIKE_V4.strike, ...(o.noHip ? { hipNm: undefined } : {}), ...(o.noLow ? { riseOnLand: undefined } : {}) };
    const K: BlockStrike = { ...BLOCK_STRIKE_V4, strike: st };
    const m = (x: typeof s.A) => ({ ...x, profile: contested(undefined, K, C) as BlockProfile });
    return blockScene({ ...s, id: 'BL-T-hit', A: m(s.A), B: m(s.B), durationS: 5.2 }, FIX('L3-F6-hold'));
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene());
    while (sim.t < SNAP - 0.05 - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    /** The chest plates' least horizontal distance from the contact (either man engaged) to 0.6 s after it (m). */
    minChest: number;
    /** B's move along the line in the 0.4 s from the contact (m, + toward A), and his speed away from A at 1.0 s (m/s). */
    b04: number;
    bAway10: number;
    /** A's trunk's least pitch from vertical toward B from 0.2 to 0.4 s after the contact (deg). */
    aTrunk: number;
    /** A's hips above the ground when his first palm lands (m). */
    aHipLand: number;
    fell: boolean;
  }
  async function run(o: Parameters<typeof scene>[0] = {}): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(o) });
    const [a, b] = sim.players;
    const mid = (p: Vec3, q: Vec3) => v3((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
    const chest = (p: typeof a): Vec3 => {
      const T = p.body.compound.torso;
      const t = p.proxy.body.translation();
      return add(v3(t.x, t.y, t.z), qRot(p.proxy.body.rotation(), v3(0, T.center.y, T.center.z + T.halfExtents.z)));
    };
    const r: Out = { minChest: Infinity, b04: NaN, bAway10: NaN, aTrunk: Infinity, aHipLand: NaN, fell: false };
    let t0: number | undefined;
    let u0 = v3(0, 0, 1);
    let bx0 = 0;
    while (!sim.done) {
      sim.stepTick();
      if (sim.players.some((p) => p.rag)) r.fell = true;
      if (r.fell) break;
      const ta = a.proxy.body.translation();
      const tb = b.proxy.body.translation();
      const u = norm(v3(tb.x - ta.x, 0, tb.z - ta.z));
      if (t0 === undefined && sim.t > SNAP && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) {
        t0 = sim.t;
        u0 = u;
        bx0 = dot(v3(tb.x, 0, tb.z), u0);
      }
      if (Number.isNaN(r.aHipLand) && (['left', 'right'] as const).some((s) => sim.arms!.pushOf('A', s)?.targetId === 'B')) {
        const L = a.pose!.jointLandmarksWorld;
        r.aHipLand = mid(L.leftHip, L.rightHip).y - a.sus!.probe.groundY;
      }
      if (t0 === undefined) continue;
      const dt = sim.t - t0;
      if (dt <= 0.6) {
        const ca = chest(a);
        const cb = chest(b);
        r.minChest = Math.min(r.minChest, Math.hypot(ca.x - cb.x, ca.z - cb.z));
      }
      if (dt >= 0.2 && dt <= 0.4) {
        const L = a.pose!.jointLandmarksWorld;
        const tv = sub(mid(L.leftShoulder, L.rightShoulder), mid(L.leftHip, L.rightHip));
        r.aTrunk = Math.min(r.aTrunk, (Math.atan2(dot(tv, u), tv.y) * 180) / Math.PI);
      }
      if (Number.isNaN(r.b04) && dt >= 0.4 - 1e-9) r.b04 = -(dot(v3(tb.x, 0, tb.z), u0) - bx0);
      if (dt >= 1.0 - 1e-9) {
        const vb = b.proxy.body.linvel();
        r.bAway10 = dot(v3(vb.x, 0, vb.z), u0);
        break;
      }
    }
    sim.dispose();
    return r;
  }

  it('(b) the captured set resumed on the hit: the palms take the closing (the chest plates at least 0.28 m apart for 0.6 s from the contact), B is knocked back at least 0.2 m in 0.4 s and has anchored by 1 s (moving away under 0.2 m/s), nobody falls; fault twin: without the hit the chests close within 0.15 m and B is not knocked back 0.2 m', async () => {
    const on = await run();
    expect(on.fell, 'on: nobody falls').toBe(false);
    expect(on.minChest, 'on: the chests held apart').toBeGreaterThanOrEqual(0.28);
    expect(on.b04, 'on: B knocked back').toBeLessThanOrEqual(-0.2);
    expect(on.bAway10, 'on: B anchored by 1 s').toBeLessThan(0.2);
    const off = await run({ noHit: true });
    expect(off.minChest, 'fault: the chests meet').toBeLessThan(0.15);
    expect(off.b04, 'fault: B not knocked back').toBeGreaterThan(-0.2);
  }, 120_000);

  it("(c) the captured set resumed: striking and driving with the hips' torque, A's trunk stays at least 12 deg inclined 0.2-0.4 s after the contact; his hips at the load's height (under 0.77 m) when his palm lands; fault twins: without the hips' torque his trunk comes up under 12 deg, and without the hips held low they are above 0.78 m when the palm lands", async () => {
    const on = await run();
    expect(on.aTrunk, 'on: trunk inclined').toBeGreaterThanOrEqual(12);
    expect(on.aHipLand, 'on: hips low at the landing').toBeLessThan(0.77);
    const noHip = await run({ noHip: true });
    expect(noHip.aTrunk, "fault: no hips' torque, the trunk comes up").toBeLessThan(12);
    const noLow = await run({ noLow: true });
    expect(noLow.aHipLand, 'fault: not held low, the hips up at the landing').toBeGreaterThan(0.78);
  }, 180_000);
});
