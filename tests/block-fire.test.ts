// Plan 16 (p41): the fire-out (`BlockStrike.fire`, BLOCK_STRIKE_V3). (a) The decision: out of his pre-snap stance his
// first punch loads at the snap wherever his man is, and stays his fire-out through a missed strike. (b) The hips' own
// torque (`HingeLimits.hipNm`) and the legs' rate at the hinge's edge under it. (c) What stood him up: a state captured
// just before the snap in BL-F9-threePoint's set on BLOCK_STRIKE_V3, resumed with the rule on and off (`fireFree`: his
// feet the free locomotion's, the walking start ramp and the run clip, as before p41); and resumed without the hips'
// own torque. Each with its fault twin.
import { describe, expect, it } from 'vitest';
import { BLOCK_STRIKE_V2, BLOCK_STRIKE_V3, nextPunch, type BlockProfile, type PunchCues } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, contested } from '../src/sim/fixtures/blocking';
import { hingeAxis, hingePitch, hipTorque, legOmega, type HingeLimits, type HingeState } from '../src/sim/hinge';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, qFromAxisAngle, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p41), the fire-out', () => {
  it('(a) the decision: fired (out of his stance, punch 0, BLOCK_STRIKE_V3) he loads at once 2.4 m from his man, as his fire-out; a missed strike loads again still firing; a landed one drives (no longer firing); fault twin: the same cues unfired wait', () => {
    const cues = (o: Partial<PunchCues>): PunchCues => ({ t: 3.3, serial: 0, gap: 2.4, closingMps: 0, engaged: false, reachM: 1.9, loaded: false, anyOn: false, straight: false, speedMps: 0, ...o });
    const K = BLOCK_STRIKE_V3;
    const first = nextPunch(K, 0.8, undefined, cues({ fired: true }));
    expect(first?.phase, 'fired').toBe('load');
    expect(first?.fire, 'fired: his fire-out').toBe(true);
    const missed = nextPunch(K, 0.8, { n: 0, phase: 'strike', since: 3.6, depth: 1, fire: true }, cues({ t: 3.7, straight: true }));
    expect(missed?.phase, 'missed').toBe('load');
    expect(missed?.fire, 'missed: still firing').toBe(true);
    const landed = nextPunch(K, 0.8, { n: 0, phase: 'strike', since: 3.6, depth: 1, fire: true, onT: 3.62 }, cues({ t: 3.8, anyOn: true }));
    expect(landed?.phase, 'landed').toBe('drive');
    expect(landed?.fire, 'landed: no longer firing').toBeUndefined();
    // fault twin: unfired, the same man waits until the load gap
    expect(nextPunch(K, 0.8, undefined, cues({})), 'unfired').toBeUndefined();
    expect(nextPunch(BLOCK_STRIKE_V2, 0.8, undefined, cues({})), 'V2').toBeUndefined();
  });

  it("(b) the hips' own torque: what the trunk's pitch asks beyond what the balance served, up to hipNm, about the hinge's axis; and at the hinge's edge the body's pitch rate turns the hinge, not the legs; fault twin: without hipNm, neither", () => {
    const q = qFromAxisAngle(v3(1, 0, 0), 1.2);
    const up = v3(0, 1, 0);
    const L: HingeLimits = { maxDeg: 90, rateDegPerS: 300, accelDegPerS2: 1500, maxDropM: 0, dropRateMps: 1, hipNm: 400 };
    const a = hingeAxis(q);
    const t = hipTorque(L, q, { hingeWantNm: -700, hingeNm: -100 });
    expect(dot(t, a), 'clamped to hipNm').toBeCloseTo(-400, 6);
    expect(dot(hipTorque(L, q, { hingeWantNm: -250, hingeNm: -100 }), a), 'the unserved part').toBeCloseTo(-150, 6);
    // at the edge: the commanded pitch caught up with the body's (capRad equal to the pitch)
    const p = hingePitch(q, up);
    const h = (lim?: HingeLimits): HingeState => ({ rad: p, capRad: p, rateRadPerS: 0, dropM: 0, ...(lim ? { limits: lim } : {}) });
    const w = v3(-3, 0, 0);
    expect(Math.abs(dot(legOmega(h(L), q, up, w), a)), 'hipNm: edge rate the hinge’s').toBeLessThan(1e-9);
    // fault twin
    const { hipNm: _drop, ...L0 } = L;
    expect(dot(hipTorque(L0, q, { hingeWantNm: -700, hingeNm: -100 }), a), 'no hipNm: no torque').toBe(0);
    expect(Math.abs(dot(legOmega(h(L0), q, up, w), a)), 'no hipNm: edge rate the legs’').toBeCloseTo(3, 6);
  });

  // BL-F9-threePoint's set (A three-point offense, B defense, 2 m, the snap at 3.3 s) with both men on BLOCK_STRIKE_V3
  const SNAP = 3.3;
  function scene(noHip = false): FixtureDef {
    const o = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    const K = noHip ? { ...BLOCK_STRIKE_V3, fire: { ...BLOCK_STRIKE_V3.fire!, pace: { ...BLOCK_STRIKE_V3.fire!.pace, hipNm: undefined } } } : BLOCK_STRIKE_V3;
    const m = (x: typeof o.A) => ({ ...x, profile: contested(undefined, K) as BlockProfile });
    return blockScene({ ...o, id: 'BL-T-fire', A: m(o.A), B: m(o.B), durationS: 4.3, stayLow: false, shoulderTops: false, foldKeeps: false, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false }, FIX('L3-F6-hold'));
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
    /** Per man, from the snap until his first strike (or 0.6 s): how far his root rose above its height at the snap (m), his speed toward his man 0.4 s after the snap (m/s), his trunk's pitch from vertical then (deg). */
    m: Record<string, { root0: number; rise: number; v04: number; trunk04: number; struck: boolean }>;
    fell: boolean;
  }
  async function fire(o: { fault?: boolean; noHip?: boolean } = {}): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(o.noHip), ...(o.fault ? { faults: { block: { fireFree: true } } } : {}) });
    const r: Out = { m: {}, fell: false };
    const mid = (a: Vec3, b: Vec3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    while (sim.t < SNAP + 0.6 - 1e-9) {
      sim.stepTick();
      for (const p of sim.players as any[]) {
        if (p.rag || p.controlMode !== 'supported') r.fell = true;
        if (p.rag || !p.pose || sim.t <= SNAP) continue;
        const e = (r.m[p.id] ??= { root0: p.proxy.body.translation().y - p.sus.probe.groundY, rise: 0, v04: NaN, trunk04: NaN, struck: false });
        const him = sim.players.find((x) => x !== p)!;
        const a = p.proxy.body.translation();
        const b = him.proxy.body.translation();
        const u = norm(v3(b.x - a.x, 0, b.z - a.z));
        if (p.block?.punch?.phase === 'strike') e.struck = true;
        if (!e.struck) e.rise = Math.max(e.rise, a.y - p.sus.probe.groundY - e.root0);
        if (Number.isNaN(e.v04) && sim.t >= SNAP + 0.4 - 1e-9) {
          const v = p.proxy.body.linvel();
          e.v04 = v.x * u.x + v.z * u.z;
          const L = p.pose.jointLandmarksWorld;
          const tv = sub(mid(L.leftShoulder, L.rightShoulder), mid(L.leftHip, L.rightHip));
          e.trunk04 = (Math.atan2(dot(tv, u), tv.y) * 180) / Math.PI;
        }
      }
    }
    sim.dispose();
    return r;
  }

  it('(c) captured before the snap and resumed: firing, his root rises under 5 cm from the snap until his strike and he is at over 1 m/s 0.4 s after it; fault twin: his feet the free locomotion\'s (fireFree), the run clip\'s height stands him up over 12 cm and the walking start ramp holds him under 0.6 m/s', async () => {
    const on = await fire();
    const off = await fire({ fault: true });
    console.log('fire on', JSON.stringify(on), '\nfire off (fireFree)', JSON.stringify(off));
    expect(on.fell || off.fell).toBe(false);
    for (const id of ['A', 'B']) {
      expect(on.m[id].rise, `${id} root's rise before the strike`).toBeLessThan(0.05);
      expect(on.m[id].v04, `${id} speed at 0.4 s`).toBeGreaterThan(1);
      expect(off.m[id].rise, `${id} fault: root's rise`).toBeGreaterThan(0.12);
      expect(off.m[id].v04, `${id} fault: speed at 0.4 s`).toBeLessThan(0.6);
    }
  }, 120_000);

  it("(d) resumed: the hips' own torque brings his trunk up from the three-point's near 90 deg to under 60 deg 0.4 s after the snap; fault twin: without hipNm it is still over 70 deg", async () => {
    const on = await fire();
    const off = await fire({ noHip: true });
    console.log('hip on', JSON.stringify(on.m.A), '\nhip off', JSON.stringify(off.m.A));
    expect(on.fell || off.fell).toBe(false);
    expect(on.m.A.trunk04, 'A trunk at 0.4 s').toBeLessThan(60);
    expect(off.m.A.trunk04, 'A fault: trunk at 0.4 s').toBeGreaterThan(70);
  }, 120_000);
});
