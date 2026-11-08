// Plan 08 (L3) test helpers shared by the tests/transitions-*.test.ts files.
import { allFixtures } from '../src/sim/fixtures/index';
import { transitionFixtures } from '../src/sim/fixtures/transitions';
import { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import type { ArmSide } from '../src/sim/contracts';
import { type LocoMode } from '../src/sim/locomotion';
import { add, dist, len, qConj, qRot, scale, sub, type Vec3 } from '../src/sim/vec';
import { ARM_G2, RAGDOLL_G4, type ArmProfile } from '../src/sim/profiles';
import type { ArmObs } from '../src/sim/arms';
import { it } from 'vitest';

export const SIDES: ArmSide[] = ['left', 'right'];
export const FIX = (id: string): FixtureDef => {
  const f = allFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no fixture ${id}`);
  return f;
};
export const L3 = (re: RegExp): FixtureDef[] => transitionFixtures().filter((d) => re.test(d.id));
/** One test per fixture of a group (a long synchronous loop would starve the test runner). */
export const each = (re: RegExp, name: string, f: (d: FixtureDef) => Promise<void>): void => {
  for (const d of L3(re)) it(`${name}: ${d.id}`, () => f(d), 30000);
};
export const modes = (sim: Simulation, id: string): { t: number; to: LocoMode; reason: string }[] =>
  sim.events.filter((e) => e.type === 'locoMode' && e.playerId === id).map((e) => ({ t: e.t, to: e.data!.to as LocoMode, reason: e.data!.reason as string }));
export const armProfile = (d: FixtureDef): ArmProfile => d.armProfile ?? ARM_G2;
export const ragOf = (d: FixtureDef) => d.ragdoll ?? RAGDOLL_G4;
/** The largest error of an achieved arm's three segments against the arm profile. */
export const armLengthErr = (a: Pick<ArmObs, 'shoulderWorld' | 'elbowWorld' | 'wristWorld' | 'palmContactWorld'>, A: ArmProfile): number =>
  Math.max(Math.abs(dist(a.shoulderWorld, a.elbowWorld) - A.upperArmM), Math.abs(dist(a.elbowWorld, a.wristWorld) - A.forearmM), Math.abs(dist(a.wristWorld, a.palmContactWorld) - A.palmExtensionM));
export const count = (sim: Simulation, type: string, id?: string): number => sim.events.filter((e) => e.type === type && (!id || e.playerId === id)).length;

/** Largest one-tick second difference of a limb landmark in the body frame, per tick. */
export function peaks(sim: Simulation, names: string[], fromS: number): (() => void) & { peak: { d: number; t: number } } {
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
export const LIMBS = ['leftAnkle', 'rightAnkle', 'leftKnee', 'rightKnee', 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'];
