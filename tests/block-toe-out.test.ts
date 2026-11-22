// Plan 16 (p49): the set stances' plants toed out (`FlatStance.toeOutDeg`, `withToeOut`, TOE_OUT_DEG; contact-steps.ts
// `toeOutOf`, pose-runtime.ts `toedReset`). The rule on constructed inputs (each foot's toe away from his midline,
// whatever his facing; none without a toe-out), then BL-F10-twoPointVsThree (A in the two-point set, B in the defense
// three-point, set until the snap at 3.3 s) with both men toed out and, as the fault twin, without: toed out, A's knees
// stand over his ankles instead of 8-9 cm inside them, B's 3 cm outside; the plants hold their anchors getting set (no
// skate, no jump); the first step after the snap lands along his facing.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { toeOutOf } from '../src/sim/contact-steps';
import type { FootPlanInput } from '../src/sim/footwork';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { footFrame } from '../src/sim/pose';
import { Simulation } from '../src/sim/simulation';
import { dot, levelForwardOf, qRot, sub, v3, type Vec3 } from '../src/sim/vec';
import { FIX } from './helpers';

describe('plan 16 (p49), the set stances toed out', () => {
  it('the turn toes each foot out from his midline, whatever his facing; none without a toe-out; fault twin: the side ignored turns both feet the same way', () => {
    for (const h of [0, 1, Math.PI, -2.5]) {
      // his right along his facing h (forward (sin h, 0, cos h)): a foot's lateral grows with the heading
      const rightW = v3(-Math.cos(h), 0, Math.sin(h));
      const inp = { flat: { toeOutRad: 0.3 }, rightW, sideSign: { left: -1, right: 1 } } as unknown as FootPlanInput;
      for (const s of ['left', 'right'] as const) {
        const t = toeOutOf(inp, s, h);
        const toe = v3(Math.sin(h + t), 0, Math.cos(h + t));
        // the toe turned toward his own side: along his right for the right foot, against it for the left
        expect(inp.sideSign[s] * dot(toe, rightW), `h ${h} ${s}`).toBeGreaterThan(0.29);
        expect(Math.abs(t)).toBeCloseTo(0.3, 9);
      }
      expect(toeOutOf({ ...inp, flat: { toeOutRad: 0 } } as FootPlanInput, 'left', h)).toBe(0);
      expect(toeOutOf({ ...inp, flat: undefined } as unknown as FootPlanInput, 'right', h)).toBe(0);
      // fault twin: one side's sign for both feet turns one of them in
      const both = { ...inp, sideSign: { left: 1, right: 1 } } as unknown as FootPlanInput;
      expect(toeOutOf(both, 'left', h)).toBe(toeOutOf(both, 'right', h));
    }
  });

  const SNAP_S = 3.3;
  const scene = (toeOut: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-toe-out', durationS: SNAP_S + 1, toeOut }, FIX('L3-F6-hold'));
  };
  interface Man {
    /** while set: the knee across from its ankle (m, + out from his midline), mean of both legs */
    kneeOutM: number;
    /** while set: the planted shoes' toe-out off his facing (deg, + out), mean */
    toeOutDeg: number;
    /** while set: the most a planted foot's contact feature stood from its anchor (m), and moved in one tick (m) */
    driftM: number;
    jumpM: number;
    /** after the snap: the first step's landing heading off his facing (deg, + out) */
    firstDeg: number | null;
  }
  async function run(toeOut: boolean): Promise<Record<string, Man>> {
    const sim = await Simulation.create(scene(toeOut));
    const out: Record<string, Man & { n: number }> = {};
    const prev: Record<string, Vec3 | null> = {};
    while (!sim.done) {
      const n0 = sim.events.length;
      sim.stepTick();
      for (const p of sim.players) {
        const m = (out[p.id] ??= { kneeOutM: 0, toeOutDeg: 0, driftM: 0, jumpM: 0, firstDeg: null, n: 0 });
        const fw = levelForwardOf(p.proxy.body.rotation());
        const rt = v3(fw.z, 0, -fw.x);
        const h = Math.atan2(fw.x, fw.z);
        if (sim.t < SNAP_S - 1e-9) {
          m.n++;
          for (const s of ['left', 'right'] as const) {
            const o = s === 'left' ? 1 : -1;
            const L = p.pose!.jointLandmarksWorld;
            m.kneeOutM += (o * dot(sub(L[`${s}Knee`], L[`${s}Ankle`]), rt)) / 2;
            const z = qRot(footFrame(p.pose!, s), v3(0, 0, 1));
            m.toeOutDeg += (Math.atan2(o * dot(z, rt), dot(z, fw)) * 180) / Math.PI / 2;
            const f = p.feet!.feet[s];
            const k = `${p.id}:${s}`;
            if (f.mode === 'planted' && !f.tentative) {
              m.driftM = Math.max(m.driftM, f.driftM);
              if (prev[k]) m.jumpM = Math.max(m.jumpM, Math.hypot(f.featureW.x - prev[k]!.x, f.featureW.z - prev[k]!.z));
              prev[k] = { ...f.featureW };
            } else prev[k] = null;
          }
        } else if (m.firstDeg === null) {
          for (const e of sim.events.slice(n0)) {
            if (e.playerId !== p.id || e.type !== 'footPlant') continue;
            const side = (e.data as { side?: string }).side ?? (e as unknown as { side?: string }).side;
            const d = (((((e.data as { headingDeg: number }).headingDeg - (h * 180) / Math.PI) % 360) + 540) % 360) - 180;
            m.firstDeg = (side === 'left' ? 1 : -1) * d;
            break;
          }
        }
      }
    }
    sim.dispose();
    for (const m of Object.values(out)) {
      m.kneeOutM /= m.n;
      m.toeOutDeg /= m.n;
    }
    return out;
  }

  it("BL-F10-twoPointVsThree set to the snap: toed out, A's knees over his ankles (two-point, 20 deg) and B's outside them (defense three-point, 10 deg), the plants held on their anchors, the first step after the snap along his facing; fault twin: without, A's knees 8 cm inside his ankles and the shoes near straight", async () => {
    const on = await run(true);
    expect(on.A.toeOutDeg, 'on: A toed out (two-point)').toBeGreaterThan(18);
    expect(on.B.toeOutDeg, 'on: B toed out (defense three-point)').toBeGreaterThan(9);
    expect(on.A.kneeOutM, "on: A's knees over his ankles").toBeGreaterThan(-0.01);
    expect(on.B.kneeOutM, "on: B's knees outside his ankles").toBeGreaterThan(0.015);
    for (const id of ['A', 'B']) {
      expect(on[id].driftM, `on: ${id}'s plants on their anchors`).toBeLessThan(0.01);
      expect(on[id].jumpM, `on: ${id}'s plants never jump`).toBeLessThan(0.002);
      expect(on[id].firstDeg, `on: ${id}'s first step after the snap along his facing`).not.toBeNull();
      expect(Math.abs(on[id].firstDeg!), `on: ${id}'s first step straight`).toBeLessThan(1);
    }
    const off = await run(false);
    expect(off.A.kneeOutM, "fault: A's knees inside his ankles").toBeLessThan(-0.07);
    expect(off.A.toeOutDeg, 'fault: A near straight').toBeLessThan(6);
    expect(off.B.toeOutDeg, 'fault: B near straight').toBeLessThan(4);
  }, 120_000);
});
