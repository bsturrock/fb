// Plan 16 (p40): the three-point stances (LEAN_IN_V4's `threePoint`, `PreSnapPose`). A constructed scene: BL-F1-even's men
// 2 m apart, A set in the three-point offense, B in the three-point defense, held (no snap) for 3.5 s; measured over the
// last 0.7 s. Each piece a three-point needs has its fault twin, the scene with that piece taken out of both poses: the
// hinge's own pace (`pace`; without it the trunk overruns the balance and he falls), the stance's own floor (`lowM`;
// without it the root stands at the suspension's 0.72) and the level feet and yaw (`FlatStance.level`; without them the
// body's forward vanishes near 90 deg of pitch and the planner and the yaw servo turn him round).
import { describe, expect, it } from 'vitest';
import { BLOCK_STRIKE_V2, LEAN_IN_V4, type PreSnapPose, type PreSnapStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, contested } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, sub, v3, type Vec3 } from '../src/sim/vec';
import { drawnShapes } from './visible';
import { FIX } from './helpers';

const OFF: PreSnapStance = { kind: 'three-point', side: 'offense' };
const DEF: PreSnapStance = { kind: 'three-point', side: 'defense' };
type Fault = 'pace' | 'lowM' | 'level';

function scene(fault?: Fault): FixtureDef {
  const o = BL_SCENES.find((x) => x.id === 'BL-F1-even')!;
  const m = (x: typeof o.A, stance: PreSnapStance) => ({ ...x, profile: contested(undefined, BLOCK_STRIKE_V2), leanIn: LEAN_IN_V4, stance, fromS: 99 });
  const def = blockScene({ ...o, id: 'BL-T-threePoint', A: m(o.A, OFF), B: m(o.B, DEF), sepM: 2, durationS: 3.5 }, FIX('L3-F6-hold'));
  if (!fault) return def;
  const strip = (p: PreSnapPose): PreSnapPose => {
    if (fault === 'pace') return { ...p, pace: undefined };
    if (fault === 'lowM') return { ...p, lowM: undefined };
    return { ...p, flat: { ...p.flat!, level: undefined } };
  };
  return {
    ...def,
    players: def.players.map((pl: any) => {
      const P = pl.controller.profile;
      const pre = Object.fromEntries(Object.entries(P.preSnap).map(([k, v]) => [k, k.startsWith('three-point') ? strip(v as PreSnapPose) : v]));
      return { ...pl, controller: { ...pl.controller, profile: { ...P, preSnap: pre } } };
    }),
  };
}

interface Held {
  fell: boolean;
  /** Per man over the last 0.7 s: extremes of each measure. */
  m: Record<string, { hand: number[]; knee: number[][]; dorsi: number; hipOverSh: number[]; stagger: number[]; root: number; facing: number; steps: number }>;
}

async function hold(fault?: Fault): Promise<Held> {
  const def = scene(fault);
  const r: Held = { fell: false, m: {} };
  let sim!: Simulation;
  const mid = (a: Vec3, b: Vec3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  const mode: Record<string, string> = {};
  sim = await Simulation.create(def, {
    onSubstep: () => {
      for (const p of sim.players as any[]) {
        if (p.rag || p.controlMode !== 'supported') r.fell = true;
        if (p.rag || !p.pose || !p.feet || sim.t < 2.8) continue;
        const e = (r.m[p.id] ??= { hand: [Infinity, -Infinity], knee: [[Infinity, -Infinity], [Infinity, -Infinity]], dorsi: -Infinity, hipOverSh: [Infinity, -Infinity], stagger: [Infinity, -Infinity], root: -Infinity, facing: Infinity, steps: 0 });
        const L = p.pose.jointLandmarksWorld;
        const gy = p.sus.probe.groundY;
        const him = sim.players.find((x) => x !== p)!;
        const a = p.proxy.body.translation();
        const b = him.proxy.body.translation();
        const u = norm(v3(b.x - a.x, 0, b.z - a.z));
        const pb = drawnShapes(p.pose, p.body, sim.def.ragdoll!).find((x) => x.key === 'rightPalm')!;
        const span = (x: number[], v: number) => ((x[0] = Math.min(x[0], v)), (x[1] = Math.max(x[1], v)));
        span(e.hand, pb.c.y - pb.r - gy);
        span(e.knee[0], p.pose.hingeDeg.leftKnee);
        span(e.knee[1], p.pose.hingeDeg.rightKnee);
        e.dorsi = Math.max(e.dorsi, -p.pose.anklePitchDeg.left, -p.pose.anklePitchDeg.right);
        span(e.hipOverSh, mid(L.leftHip, L.rightHip).y - mid(L.leftShoulder, L.rightShoulder).y);
        span(e.stagger, dot(sub(L.leftAnkle, L.rightAnkle), u));
        e.root = Math.max(e.root, a.y - gy);
        // his trunk toward his man: the shoulders' mid-point ahead of the hips' along the line to him
        e.facing = Math.min(e.facing, dot(sub(mid(L.leftShoulder, L.rightShoulder), mid(L.leftHip, L.rightHip)), u));
        for (const s of ['left', 'right'] as const) {
          const k = p.id + s;
          if (mode[k] && mode[k] !== 'swing' && p.feet.feet[s].mode === 'swing') e.steps++;
          mode[k] = p.feet.feet[s].mode;
        }
      }
    },
  });
  sim.runToEnd();
  sim.dispose();
  return r;
}

describe('plan 16 (p40), the three-point stances (LEAN_IN_V4)', () => {
  it('(b) held 3.5 s: offense (A) knees 80-100 deg, hips within 4 cm of his shoulders, root under 0.70 m, the down hand on the turf; defense (B) hips 4 cm or more over his shoulders, the stagger heel to toe; both ankles within 39 deg, still, facing his man, nobody falls; fault twins: without the pace someone falls, without the stance\'s floor the offense root stands at 0.72, without level feet a man is turned or stepping', async () => {
    const on = await hold();
    expect(on.fell, 'a man down').toBe(false);
    const A = on.m.A;
    const B = on.m.B;
    for (const [id, e] of Object.entries(on.m)) {
      expect(e.hand[0], `${id}'s down palm under the turf (m)`).toBeGreaterThan(-0.015);
      expect(e.hand[1], `${id}'s down palm over the turf (m)`).toBeLessThan(0.02);
      expect(e.dorsi, `${id}'s ankle (deg)`).toBeLessThan(39);
      expect(e.facing, `${id}'s shoulders ahead of his hips toward his man (m)`).toBeGreaterThan(0.3);
      expect(e.steps, `${id}'s steps in the last 0.7 s`).toBe(0);
    }
    expect(Math.min(A.knee[0][0], A.knee[1][0]), "A's knees (deg)").toBeGreaterThan(80);
    expect(Math.max(A.knee[0][1], A.knee[1][1]), "A's knees (deg)").toBeLessThan(100);
    expect(Math.max(Math.abs(A.hipOverSh[0]), Math.abs(A.hipOverSh[1])), "A's hips against his shoulders (m)").toBeLessThan(0.04);
    expect(A.root, "A's root (m)").toBeLessThan(0.7);
    expect(A.stagger[0], "A's stagger (m)").toBeGreaterThan(0.04);
    expect(B.hipOverSh[0], "B's hips over his shoulders (m)").toBeGreaterThan(0.04);
    expect(B.stagger[0], "B's stagger, heel to toe (m)").toBeGreaterThan(0.25);
    expect(Math.min(B.knee[0][0], B.knee[1][0]), "B's knees (deg)").toBeGreaterThan(65);
    expect(Math.max(B.knee[0][1], B.knee[1][1]), "B's knees (deg)").toBeLessThan(100);

    expect((await hold('pace')).fell, 'without the pace: a man down').toBe(true);
    const low = await hold('lowM');
    expect(low.m.A.root, "without the floor: A's root (m)").toBeGreaterThan(0.715);
    const lev = await hold('level');
    const bad = lev.fell || Object.values(lev.m).some((e) => e.facing < 0.3 || e.steps > 0);
    expect(bad, 'without level feet and yaw: a man turned, stepping or down').toBe(true);
  }, 300_000);
});
