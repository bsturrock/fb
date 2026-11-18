// Plan 16, flat feet (p34: `FlatStance`, FLAT_V1; a block profile `withFlat`). The rule a viewer sees: a man in a block
// may be on the balls of his feet but never on his toes, his planted heel at most 3 cm up and his foot pitched at most
// 10 deg (`LIMIT`). Constructed scenes from the BL family's package (fixtures/blocking.ts `blockScene` on L3-F6-hold's
// definition): an even hold, and a man giving ground (his steps, the brace's among them, land flat). Then the stepping
// model on constructed input (no physics): a man moved faster takes as long and steady steps, not more short ones. Each
// has its fault twin: today's stance (feet under the hips), a stance whose dead zone is a few centimetres.
import { describe, expect, it } from 'vitest';
import { FLAT_V1 } from '../src/sim/block-base';
import { STEPS_V2, withSteps } from '../src/sim/contact-steps';
import type { ArmSide, FlatStance } from '../src/sim/contracts';
import { withFlat, type BlockProfile } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { FOOTWORK_L3, initFeet, newFootPlan, observeFeet, planFeet, type FootEvent, type FootPlanInput } from '../src/sim/footwork';
import { groundOf } from '../src/sim/free-ground';
import type { FootRequest, PhysicalPose } from '../src/sim/pose';
import { JOINT_RANGE_V3 } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { add, qRot, v3, type Vec3 } from '../src/sim/vec';
import { FIX } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
/** The viewer's bar: a planted heel no more than this up (m), a foot pitched no more than this (deg). */
const LIMIT = { heelM: 0.03, pitchDeg: 10 };
/** The stagger the flat stance stands at (m; the block profiles' 0.24 puts the rear foot under the hips). */
const STAGGER_M = 0.1;

const scene = (id: string, flat: FlatStance | null, durationS: number): FixtureDef => {
  const o = BL_SCENES.find((x) => x.id === id)!;
  const on = (p: BlockProfile): BlockProfile => (flat ? withFlat(p, flat, STAGGER_M) : p);
  return blockScene({ ...o, A: { ...o.A, profile: on(o.A.profile!) }, B: { ...o.B, profile: on(o.B.profile!) }, durationS }, FIX('L3-F6-hold'));
};

interface Feet {
  /** Planted-foot substeps of a man in his block (engaged or punching), those past the limit, the worst heel (m) and pitch (deg). */
  ticks: number;
  beyond: number;
  heelM: number;
  pitchDeg: number;
  /** Each landing of a step in his block: its heel up (m) and pitch (deg) at the plant and over the 0.1 s after it (the worst). */
  landings: { t: number; heelM: number; pitchDeg: number }[];
  fell: boolean;
}

async function feetOf(def: FixtureDef, id: string): Promise<Feet> {
  const r: Feet = { ticks: 0, beyond: 0, heelM: 0, pitchDeg: 0, landings: [], fell: false };
  const open: { t: number; side: ArmSide; heelM: number; pitchDeg: number }[] = [];
  const wasPlanted: Partial<Record<ArmSide, boolean>> = {};
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      const p = sim.players.find((x) => x.id === id)!;
      if (p.rag || p.controlMode !== 'supported' || !p.feet) {
        r.fell = true;
        return;
      }
      const b = p.block;
      const inBlock = !!b && (b.phase === 'engaged' || !!b.punch);
      const gy = p.sus?.probe.groundY ?? 0;
      const { he, centerFoot } = p.feet.shoe;
      for (const s of SIDES) {
        const f = p.feet.feet[s];
        const planted = f.mode === 'planted';
        const y = (x: number, z: number): number => add(f.ankleW, qRot(f.footQ, v3(x, centerFoot.y - he.y, z))).y - gy;
        const heelM = Math.min(y(-he.x, centerFoot.z - he.z), y(he.x, centerFoot.z - he.z));
        const pitchDeg = Math.abs((Math.asin(Math.max(-1, Math.min(1, qRot(f.footQ, v3(0, 0, 1)).y))) * 180) / Math.PI);
        if (inBlock && planted) {
          r.ticks++;
          if (heelM > LIMIT.heelM || pitchDeg > LIMIT.pitchDeg) r.beyond++;
          r.heelM = Math.max(r.heelM, heelM);
          r.pitchDeg = Math.max(r.pitchDeg, pitchDeg);
          if (wasPlanted[s] === false) open.push({ t: sim.t, side: s, heelM, pitchDeg });
          for (const l of open) if (l.side === s && sim.t - l.t <= 0.1) ((l.heelM = Math.max(l.heelM, heelM)), (l.pitchDeg = Math.max(l.pitchDeg, pitchDeg)));
        }
        wasPlanted[s] = planted;
      }
    },
  });
  sim.runToEnd();
  r.landings = open.map(({ t, heelM, pitchDeg }) => ({ t, heelM, pitchDeg }));
  return r;
}

describe('plan 16, flat feet: a planted foot in a block is flat (the balls of the feet at most, never the toes)', () => {
  it('an even hold (BL-F1-even, 4 s): every planted substep of both men within the limit; fault twin: today\'s stance, its heels up', async () => {
    for (const id of ['A', 'B']) {
      const on = await feetOf(scene('BL-F1-even', FLAT_V1, 4), id);
      expect(on.fell).toBe(false);
      expect(on.ticks).toBeGreaterThan(500);
      expect(on.beyond, `${id}: heel ${(on.heelM * 100).toFixed(1)} cm, pitch ${on.pitchDeg.toFixed(1)} deg`).toBe(0);
      const off = await feetOf(scene('BL-F1-even', null, 4), id);
      expect(off.beyond / off.ticks).toBeGreaterThan(0.25);
      expect(off.heelM).toBeGreaterThan(0.08);
    }
  }, 120_000);

  it('a man giving ground (BL-F3-blockerDrives B, 3 s): each step he takes back lands flat and stays flat; fault twin: today\'s stance lands them on the toes', async () => {
    const on = await feetOf(scene('BL-F3-blockerDrives', FLAT_V1, 3), 'B');
    expect(on.landings.length).toBeGreaterThanOrEqual(3);
    for (const l of on.landings) expect(l.heelM <= LIMIT.heelM && l.pitchDeg <= LIMIT.pitchDeg, `landing ${l.t.toFixed(2)}: heel ${(l.heelM * 100).toFixed(1)} cm, pitch ${l.pitchDeg.toFixed(1)} deg`).toBe(true);
    expect(on.beyond).toBe(0);
    const off = await feetOf(scene('BL-F3-blockerDrives', null, 3), 'B');
    expect(off.landings.length).toBeGreaterThanOrEqual(3);
    expect(off.landings.filter((l) => l.heelM > LIMIT.heelM || l.pitchDeg > LIMIT.pitchDeg).length).toBeGreaterThan(off.landings.length / 2);
  }, 120_000);
});

// ------------------------------------------------------------------ the stepping model, constructed
const R = FIX('L3-F6-hold').ragdoll!;
const SOLE = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
const TOE = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
const CEIL = SOLE + R.lengths.shin;
const DT = 1 / 240;
const ON = { ...withSteps(FOOTWORK_L3), steps: STEPS_V2 };
const I = { x: 0, y: 0, z: 0, w: 1 };

const pose = (ankles: Record<ArmSide, Vec3>): PhysicalPose => {
  const seg = (sid: string) => ({ segmentId: sid, originWorld: v3(), rotationWorld: I });
  const li = (s: ArmSide) => ({ variant: 0, request: ankles[s], liftM: 0, softM: 0 });
  return {
    playerId: 'T',
    segments: { leftShin: seg('leftShin'), rightShin: seg('rightShin') } as unknown as PhysicalPose['segments'],
    jointLandmarksWorld: { leftAnkle: { ...ankles.left }, rightAnkle: { ...ankles.right } } as unknown as PhysicalPose['jointLandmarksWorld'],
    hingeDeg: {},
    anklePitchDeg: { left: 0, right: 0 },
    straightFallback: [],
    limbClearance: {},
    legInfo: { left: li('left'), right: li('right') },
  } as unknown as PhysicalPose;
};
const ankleOf = (r: FootRequest, inp: FootPlanInput, s: ArmSide): Vec3 => (r.kind === 'plant' ? add(r.heelW, v3(0, SOLE, 0)) : r.kind === 'target' ? { ...r.ankleW } : add(inp.request[s], r.offsetW));

/**
 * A man in a block moved back at `mps(t)` (m/s) for `durS` (facing +z, moving -z; hips 0.75 m above the sole, the feet's homes
 * under them a hip width apart), under the stepping model with the flat stance's cover and lead (`flat`; null: the
 * model's own). The shin trigger is left out (a lean no shin reaches), so this reads the cover and the lead alone. Each
 * step's length along the travel (m), its landing time (s), and the hips' travel (m).
 */
function moved(mps: (t: number) => number, flat: Pick<FlatStance, 'coverM' | 'captureK'> | null, durS = 3): { lens: number[]; lands: number[]; travelM: number } {
  const plan = newFootPlan(ON, R);
  let c = v3();
  const input = (t: number): FootPlanInput => {
    const home = { left: v3(c.x - 0.12, SOLE, c.z), right: v3(c.x + 0.12, SOLE, c.z) };
    return {
      t,
      dt: DT,
      core: { p: v3(c.x, SOLE + 0.85, c.z), q: I },
      vel: v3(0, 0, -mps(t)),
      yawRate: 0,
      supported: true,
      falling: false,
      ragdoll: false,
      groundY: 0,
      hips: { left: add(home.left, v3(0, 0.75, 0)), right: add(home.right, v3(0, 0.75, 0)) },
      home,
      request: home,
      clip: null,
      soleM: SOLE,
      toeM: TOE,
      rightW: v3(1, 0, 0),
      sideSign: { left: -1, right: 1 },
      contactHold: true,
      ground: groundOf([], CEIL),
      legs: R,
      range: { profile: JOINT_RANGE_V3, sideX: { left: -1, right: 1 } },
      ...(flat ? { flat: { maxShinRad: 10, aimShinRad: 10, coverM: flat.coverM, captureK: flat.captureK } } : {}),
    };
  };
  const first = input(0);
  initFeet(plan, pose({ left: first.home.left, right: first.home.right }), first, []);
  const from: Partial<Record<ArmSide, Vec3>> = {};
  const lens: number[] = [];
  const lands: number[] = [];
  let travelM = 0;
  for (let k = 1; k * DT <= durS + 1e-9; k++) {
    const t = k * DT;
    c = add(c, v3(0, 0, -mps(t) * DT));
    travelM += mps(t) * DT;
    const inp = input(t);
    const ev: FootEvent[] = [];
    const req = planFeet(plan, inp, ev);
    const ankle = { left: ankleOf(req.left, inp, 'left'), right: ankleOf(req.right, inp, 'right') };
    observeFeet(plan, pose(ankle), SOLE, 0, ev, t);
    for (const e of ev) {
      if (e.type === 'footSwing' && e.data.source === 'step') from[e.side] = ankle[e.side];
      if (e.type === 'footPlant' && from[e.side]) {
        lens.push(from[e.side]!.z - ankle[e.side].z);
        lands.push(t);
        delete from[e.side];
      }
    }
  }
  return { lens, lands, travelM };
}

describe('plan 16, flat feet: a man moved faster takes longer or as long steps, not more short ones', () => {
  // the block's load case: a man knocked back fast for a moment (1.5 m/s for 0.3 s), then held still
  const KNOCK = (t: number): number => (t < 0.3 ? 1.5 : 0);
  const knock = (flat: Pick<FlatStance, 'coverM' | 'captureK'> | null) => moved(KNOCK, flat, 2.5);

  const read = (flat: Pick<FlatStance, 'coverM' | 'captureK'> | null) => {
    const slow = moved(() => 0.2, flat);
    const fast = moved(() => 0.8, flat);
    const short = (r: { lens: number[] }) => r.lens.filter((l) => l < 0.1).length;
    return { slow, fast, short: short(slow) + short(fast), perM: { slow: slow.lens.length / slow.travelM, fast: fast.lens.length / fast.travelM } };
  };

  it('FLAT_V1, a steady drive at 0.2 and 0.8 m/s: no step under 15 cm, the faster steps no shorter, and fewer steps per metre', () => {
    const r = read(FLAT_V1);
    expect(r.slow.lens.length).toBeGreaterThanOrEqual(3);
    expect(r.short).toBe(0);
    expect(Math.min(...r.slow.lens, ...r.fast.lens)).toBeGreaterThanOrEqual(0.15);
    expect(Math.min(...r.fast.lens)).toBeGreaterThanOrEqual(Math.min(...r.slow.lens));
    expect(r.perM.fast).toBeLessThanOrEqual(r.perM.slow);
  });

  it('fault twin: a dead zone of a few centimetres (the cover 4 cm) patters, steps under 10 cm and more of them per metre', () => {
    const r = read({ coverM: 0.04, captureK: FLAT_V1.captureK });
    expect(r.short).toBeGreaterThan(0);
    expect(r.perM.slow).toBeGreaterThan(read(FLAT_V1).perM.slow + 5);
  });

  it('FLAT_V1, knocked back fast then held: at most three committed steps back, each 15 cm or more, then planted for good within 0.2 s of the stop', () => {
    const r = knock(FLAT_V1);
    expect(r.lens.length).toBeGreaterThanOrEqual(1);
    expect(r.lens.length).toBeLessThanOrEqual(3);
    expect(Math.min(...r.lens)).toBeGreaterThanOrEqual(0.15);
    expect(Math.max(...r.lands)).toBeLessThanOrEqual(0.5);
  });

  it("fault twin, knocked back then held: the stepping model's own cover and lead overshoot, and he steps again as he settles", () => {
    const r = knock(null);
    expect(Math.max(...r.lands) > 0.5 || r.lens.some((l) => l < 0)).toBe(true);
  });
});
