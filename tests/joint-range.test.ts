// Plan 12: joint range for shoulders and ankles. Under the opt-in profile (the L3, L4 and HC fixtures) one shoulder swing cone
// (45 deg behind the side line hanging, 30 deg at horizontal) limits the supported pose arms, the arm-task arms and the ragdoll
// envelope; the supported ankle dorsiflexes at most 25 deg (past it the heel lifts and the foot stands on its ball); a ragdoll's
// limp foot eases to 15 deg toe down. Each check is shown failing with the profile removed (the twin).
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import type { FixtureDef } from '../src/sim/fixture';
import { behindDeg, swingExcess, swingExtentDeg } from '../src/sim/joint-cone';
import { FOOTWORK_L3 } from '../src/sim/footwork';
import { ENVELOPE_L4, JOINT_RANGE_V1, sideSignX } from '../src/sim/profiles';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { len, qConj, qRot, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';

/** Plan 09's persistence limit (s), which the ragdoll envelope under the profile keeps. */
const FALLS_PERSIST_S = ENVELOPE_L4.persistS;

const J = JOINT_RANGE_V1;
const D = Math.PI / 180;
const twin = (d: FixtureDef): FixtureDef => ({ ...d, id: `${d.id}-noRange`, jointRange: undefined });
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];
type Src = 'pose' | 'armTask' | 'ragdoll';

/** The upper arm's direction in the core frame (unit). */
function upperArm(pl: PlayerRuntime, side: Side): Vec3 {
  const lm = pl.pose!.jointLandmarksWorld;
  const u = sub(lm[`${side}Elbow`], lm[`${side}Shoulder`]);
  return qRot(qConj(pl.pose!.segments.core.rotationWorld), scale(u, 1 / len(u)));
}

/** Shoulder swing excess past the profile's cone (deg, negative inside). */
const excessDeg = (pl: PlayerRuntime, side: Side): number => swingExcess(J.shoulder, upperArm(pl, side), sideSignX(pl.body, side)).rad / D;

interface Probe {
  /** Worst excess (deg) and behind angle (deg) per arm source, with where. */
  worst: Record<Src, { ex: number; behind: number; at: string }>;
  /** Longest run (s) of a ragdoll arm more than the envelope's 5 deg tolerance past the cone. */
  ragOverRunS: number;
  /** Supported ankle minimum (deg). */
  ankleMin: number;
  /** Per ragdoll: the published pitch on its first ragdoll tick, 0.35 s later, and the limp foot's held substeps then. */
  feet: Map<string, { t: number; conv: Partial<Record<Side, number>>; late?: Partial<Record<Side, number>>; held?: Record<Side, number> }>;
  /** Planted (held) supported feet: ticks, ticks past the ankle range, worst contact gap and slide (m). */
  planted: { n: number; past: number; gapM: number; hzM: number };
}

const probes = new Map<string, Promise<Probe>>();
const probe = (def: FixtureDef): Promise<Probe> => {
  if (!probes.has(def.id)) probes.set(def.id, runProbe(def));
  return probes.get(def.id)!;
};

async function runProbe(def: FixtureDef): Promise<Probe> {
  const sim = await Simulation.create(def);
  const worst = { pose: { ex: -999, behind: -999, at: '' }, armTask: { ex: -999, behind: -999, at: '' }, ragdoll: { ex: -999, behind: -999, at: '' } };
  const run = new Map<string, number>();
  const out: Probe = { worst, ragOverRunS: 0, ankleMin: 999, feet: new Map(), planted: { n: 0, past: 0, gapM: 0, hzM: 0 } };
  let last = 0;
  await runSim(sim, Infinity, (s) => {
    const dt = s.t - last;
    last = s.t;
    for (const pl of s.players) {
      if (!pl.pose) continue;
      const ap = pl.pose.anklePitchDeg ?? {};
      for (const side of SIDES) {
        const src: Src = pl.rag ? 'ragdoll' : s.arms?.obs(pl.id)?.[side]?.enabled ? 'armTask' : 'pose';
        const ex = excessDeg(pl, side);
        const w = worst[src];
        if (ex > w.ex) [w.ex, w.at] = [ex, `${pl.id}.${side}@${s.t.toFixed(3)}`];
        w.behind = Math.max(w.behind, behindDeg(upperArm(pl, side)));
        const k = `${pl.id}.${side}`;
        const r = src === 'ragdoll' && ex > 5 ? (run.get(k) ?? 0) + dt : 0;
        run.set(k, r);
        out.ragOverRunS = Math.max(out.ragOverRunS, r);
        const f = pl.feet?.feet[side];
        if (!pl.rag && ap[side] !== undefined) {
          out.ankleMin = Math.min(out.ankleMin, ap[side]!);
          if (f && f.mode === 'planted' && !f.tentative) {
            out.planted.n++;
            if (ap[side]! < -J.ankle.dorsiDeg - 1e-9) out.planted.past++;
            out.planted.gapM = Math.max(out.planted.gapM, f.gapM);
            out.planted.hzM = Math.max(out.planted.hzM, f.featureHzM);
          }
        }
      }
      if (pl.rag) {
        const c = out.feet.get(pl.id);
        if (!c) out.feet.set(pl.id, { t: s.t, conv: { ...ap } });
        else if (!c.late && s.t >= c.t + 0.35 - 1e-9) c.late = { ...ap }, (c.held = { ...(pl.rag.limpFoot?.heldSubsteps ?? { left: 0, right: 0 }) });
      }
    }
  });
  sim.dispose();
  return out;
}

describe('plan 12 joint range: profile and cone', () => {
  it('is on for exactly the L3, L4 and HC fixtures, and the export records it', async () => {
    for (const d of allFixtures()) expect(d.jointRange, d.id).toBe(/^(L3|L4|HC)$/.test(d.milestone) ? J : undefined);
    for (const d of [FIX('L3-F16-sprint'), FIX('L2-F14-oneArmFeet')]) {
      const sim = await Simulation.create(d);
      const e = sim.exportFixture() as { profileIds: Record<string, unknown>; profiles: Record<string, unknown> };
      expect(e.profileIds.jointRange, d.id).toBe(d.jointRange?.id);
      expect(e.profiles.jointRange, d.id).toEqual(d.jointRange);
      sim.dispose();
    }
  });

  it('the shoulder cone: 45 deg behind the side line hanging, 30 deg at horizontal, forward and out about unlimited', () => {
    const at = (elevDeg: number): number => {
      // the behind angle where the cone's boundary crosses, at this elevation from hanging, along the back of the side line
      for (let a = 0; a <= 180; a += 0.25) {
        const dir = v3(Math.sin(elevDeg * D) * Math.sin(a * D), -Math.cos(elevDeg * D), Math.sin(elevDeg * D) * Math.cos(a * D));
        if (swingExcess(J.shoulder, dir, 1).rad > 0) return behindDeg(dir);
      }
      return 180;
    };
    expect(swingExtentDeg(J.shoulder, 180)).toBeCloseTo(44.5, 0);
    expect(at(45)).toBeCloseTo(45, 0);
    expect(at(90)).toBeGreaterThan(29);
    expect(at(90)).toBeLessThan(32);
    expect(swingExtentDeg(J.shoulder, 0)).toBeGreaterThan(170);
    expect(swingExtentDeg(J.shoulder, 90)).toBeGreaterThan(170);
    expect(J.ankle).toEqual({ dorsiDeg: 25, plantarDeg: 50 });
    expect(J.limpFoot).toEqual({ pitchDeg: 15, easeS: 0.3 });
  });
});

describe('plan 12 joint range: shoulders', () => {
  it('supported pose arms are within 0.5 deg of the cone; without the profile they are far past it', async () => {
    for (const id of ['L3-F9-convert-prep', 'L3-F16-sprint']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      expect(on.worst.pose.ex, `${id} ${on.worst.pose.at}`).toBeLessThanOrEqual(0.5);
      expect(off.worst.pose.ex, id).toBeGreaterThan(4);
    }
  }, 120000);

  it('arm-task arms stay inside the cone (a guard: the twins\' worst is also inside, 5 deg)', async () => {
    for (const id of ['HC-F5-invalidOne', 'L3-F4-twoArm', 'L4-F5-onePalm-on', 'L4-F6-break']) {
      const on = await probe(FIX(id));
      expect(on.worst.armTask.ex, `${id} ${on.worst.armTask.at}`).toBeGreaterThan(-999);
      expect(on.worst.armTask.ex, `${id} ${on.worst.armTask.at}`).toBeLessThanOrEqual(1e-6);
    }
  }, 120000);

  it('ragdoll shoulders: the runner cases stay within the 5 deg tolerance past the cone, but for brief loads; the twins go far behind', async () => {
    for (const id of ['HC-F3-phase0', 'HC-F3-lowRunner', 'L3-F1-phase0', 'L3-F1-low']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      expect(off.worst.ragdoll.behind, id).toBeGreaterThan(45);
      expect(on.worst.ragdoll.behind, id).toBeLessThan(off.worst.ragdoll.behind - 20);
      // past the tolerance only for a run shorter than the envelope's persistence limit
      expect(on.ragOverRunS, `${id} ${on.worst.ragdoll.at}`).toBeLessThan(FALLS_PERSIST_S);
      expect(on.worst.ragdoll.ex, `${id} ${on.worst.ragdoll.at}`).toBeLessThan(15);
    }
    // HC-F1-low: the twin's runner arm is 13 deg past the cone (27 behind); with the profile it is inside
    const on = await probe(FIX('HC-F1-low'));
    const off = await probe(twin(FIX('HC-F1-low')));
    expect(off.worst.ragdoll.ex).toBeGreaterThan(5);
    expect(on.worst.ragdoll.ex).toBeLessThanOrEqual(5);
  }, 240000);
});

describe('plan 12 joint range: ankles', () => {
  it('supported ankles never dorsiflex past 25 deg; the twins reach 36-45 deg', async () => {
    for (const id of ['HC-F1-low', 'L3-F1-low', 'L3-F16-sprint']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      expect(on.ankleMin, id).toBeGreaterThanOrEqual(-J.ankle.dorsiDeg);
      expect(off.ankleMin, id).toBeLessThan(-J.ankle.dorsiDeg - 10);
    }
  }, 120000);

  it('heel lift: a planted foot past the range stands on its ball, the contact held within the plant tolerance', async () => {
    for (const id of ['L3-F1-low', 'L3-F16-sprint']) {
      const on = await probe(FIX(id));
      const off = await probe(twin(FIX(id)));
      // the twin plants with the shin leaning past the range; with the profile the heel lifts instead, no foot lost
      expect(off.planted.past, id).toBeGreaterThan(10);
      expect(on.planted.past, id).toBe(0);
      expect(on.planted.n, id).toBeGreaterThanOrEqual(off.planted.n);
      expect(on.planted.gapM, id).toBeLessThanOrEqual(FOOTWORK_L3.plantTolM);
      expect(on.planted.hzM, id).toBeLessThanOrEqual(FOOTWORK_L3.plantTolM);
    }
  }, 120000);

  it('ragdoll feet: in range at conversion, relaxed to 15 deg within 1 deg 0.35 s later unless the limp shoe is held near another player', async () => {
    // the held cases (Simulation.shoeDeeper, listed in docs/handoff/plan12.md): the shoe would turn within 8 cm of another player
    const heldCases = new Set<string>();
    for (const id of ['L4-F3-forward-on', 'L4-F8-passive', 'HC-F1-low']) {
      const on = await probe(FIX(id));
      expect(on.feet.size, id).toBeGreaterThan(0);
      for (const [pid, c] of on.feet) {
        expect(c.late, `${id} ${pid}`).toBeTruthy();
        for (const side of SIDES) {
          const p = c.conv[side]!;
          expect(p, `${id} ${pid} ${side}`).toBeGreaterThanOrEqual(-J.ankle.dorsiDeg);
          expect(p, `${id} ${pid} ${side}`).toBeLessThanOrEqual(J.ankle.plantarDeg);
          if (c.held![side] > 0) heldCases.add(`${id} ${pid}.${side}`);
          else expect(Math.abs(c.late![side]! - J.limpFoot.pitchDeg), `${id} ${pid} ${side}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect([...heldCases].sort()).toEqual(['HC-F1-low D.right', 'HC-F1-low R.left']);
    // the twin keeps the supported pitch it converted with, past the range
    const off = await probe(twin(FIX('HC-F1-low')));
    for (const [pid, c] of off.feet) expect(Math.min(c.conv.left!, c.conv.right!), pid).toBeLessThan(-J.ankle.dorsiDeg);
  }, 120000);
});
