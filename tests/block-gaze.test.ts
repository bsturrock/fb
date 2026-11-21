// Plan 16 (p43): the eyes on his man (`BlockProfile.gaze`, `PostureIntent.gaze`). (a) The neck's extension for a point:
// the face turned up onto it in the trunk's sagittal plane, between the head on the trunk and the neck's range. (b) A
// state captured just before the snap in BL-F9-threePoint's set, resumed with the gaze on and off (off: the stance's
// head up, `HeadUp`, asked only until the snap, as before p43). Each with its fault twin.
import { describe, expect, it } from 'vitest';
import { GAZE_V1, withGaze, type BlockProfile } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { gazeRadOf } from '../src/sim/pose-runtime';
import { Simulation } from '../src/sim/simulation';
import { add, dot, norm, qFromAxisAngle, qRot, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

const D = 180 / Math.PI;

describe('plan 16 (p43), the eyes on his man', () => {
  it("(a) the neck's extension for a point: a trunk pitched 90 deg looking at a man ahead at his height extends to the range (50); pitched 40 it extends about 40 (the face level), and a point below the face asks none; fault twin: without the neck's range the trunk pitched 90 extends past 80", () => {
    const body = FIX('L3-F6-hold').players[0].body;
    if (body.kind !== 'upperBodyCompound') throw new Error('model body expected');
    // forward is +z; a pitch forward is about +x
    const at = (pitchDeg: number) => {
      const q = qFromAxisAngle(v3(1, 0, 0), pitchDeg / D);
      const p = v3(0, 0.6, 0);
      const head = add(p, qRot(q, body.headCenter));
      return { core: { p, q }, head };
    };
    const deep = at(90);
    expect(gazeRadOf(deep.core, body, { atWorld: add(deep.head, v3(0, 0, 1.6)), maxDeg: 50 }) * D, 'pitched 90: the range').toBeCloseTo(50, 6);
    const mid = at(40);
    const level = gazeRadOf(mid.core, body, { atWorld: add(mid.head, v3(0, 0, 1.6)), maxDeg: 50 }) * D;
    expect(level, 'pitched 40: about 40').toBeGreaterThan(36);
    expect(level, 'pitched 40: about 40').toBeLessThan(44);
    expect(gazeRadOf(mid.core, body, { atWorld: add(mid.head, v3(0, -1.6, 0.6)), maxDeg: 50 }), 'below the face: none').toBe(0);
    // fault twin: no range
    expect(gazeRadOf(deep.core, body, { atWorld: add(deep.head, v3(0, 0, 1.6)), maxDeg: 180 }) * D, 'no range: past 80').toBeGreaterThan(80);
  });

  // BL-F9-threePoint's set (A three-point offense driving, B defense holding, 2 m apart, the snap at 3.3 s)
  const SNAP = 3.3;
  function scene(gaze: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    const base = FIX('L3-F6-hold');
    // the twin keeps the profile's id (the capture's), its gaze taken out
    const m = (x: typeof s.A) => {
      const G: BlockProfile = x.profile!.gaze ? x.profile! : withGaze(x.profile!, GAZE_V1);
      return { ...x, profile: gaze ? G : { ...G, gaze: undefined } };
    };
    return blockScene({ ...s, id: 'BL-T-gaze', A: m(s.A), B: m(s.B), durationS: 4.2, stayLow: false, shoulderTops: false, foldKeeps: false, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false, palmSlide: false, laneOnStrike: false }, base);
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(true));
    while (sim.t < SNAP - 0.05 - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    /** Per man: his face's pitch below the horizon in the last tick before the snap, and its most from the snap to contact + 0.3 s (deg). */
    stance: Record<string, number>;
    most: Record<string, number>;
    /** Per man: the most angle between his face and the line to the other man's head from snap + 0.3 s to contact + 0.3 s (deg). */
    off: Record<string, number>;
  }
  async function run(gaze: boolean): Promise<Out> {
    // (the twin: the gaze taken out of both men's profiles, under the capture's ids)
    const sim = await resumeState(await captured(), { def: scene(gaze), variant: gaze ? [] : ['players.0.controller.profile.gaze', 'players.1.controller.profile.gaze'] });
    const r: Out = { stance: {}, most: {}, off: {} };
    let t0: number | undefined;
    while (!sim.done) {
      sim.stepTick();
      if (sim.players.some((p) => p.rag || !p.pose)) break;
      if (t0 === undefined && sim.t > SNAP && sim.players.some((p) => p.block?.phase === 'engaged')) t0 = sim.t;
      if (t0 !== undefined && sim.t > t0 + 0.3) break;
      for (const p of sim.players) {
        const o = sim.players.find((x) => x !== p)!;
        const face = norm(qRot(p.pose!.segments.head.rotationWorld, v3(0, 0, 1)));
        const pitch = Math.asin(-face.y) * D;
        if (sim.t <= SNAP) r.stance[p.id] = pitch;
        else r.most[p.id] = Math.max(r.most[p.id] ?? -90, pitch);
        const to: Vec3 = norm(sub(o.pose!.jointLandmarksWorld.headCenter, p.pose!.jointLandmarksWorld.headCenter));
        if (sim.t >= SNAP + 0.3) r.off[p.id] = Math.max(r.off[p.id] ?? 0, Math.acos(Math.min(1, dot(face, to))) * D);
      }
    }
    sim.dispose();
    return r;
  }

  it("(b) the captured set resumed with the gaze: from the snap to 0.3 s after the contact neither man's face drops more than 2 deg below its stance's, and from 0.3 s after the snap each face is within 15 deg of the line to the other man's head; fault twin: without it (the stance's head up only until the snap) the faces drop 30 deg or more below the stance's at the snap", async () => {
    const on = await run(true);
    for (const id of ['A', 'B']) {
      expect(on.most[id] - on.stance[id], `on: ${id}'s face no lower than in the stance`).toBeLessThanOrEqual(2);
      expect(on.off[id], `on: ${id}'s face on the other man`).toBeLessThanOrEqual(15);
    }
    const off = await run(false);
    for (const id of ['A', 'B']) expect(off.most[id] - off.stance[id], `fault: ${id}'s face drops`).toBeGreaterThanOrEqual(30);
  }, 120_000);
});
