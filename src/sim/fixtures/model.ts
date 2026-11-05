// G4-M: the supplied player model's measured geometry (models/bew-v6.glb) on existing Gate 2-4 drills. Each fixture is
// an existing one re-profiled with the model body, arm and ragdoll profiles (src/sim/model/profiles.ts); starting
// conditions, requests, controllers, solver and non-geometric profile values are unchanged. The authored fixtures keep
// their profiles and results; these are separate profile identities with their own results.
import type { FixtureDef } from '../fixture';
import { ARM_G2 } from '../profiles';
import { modelArm, modelBody, modelRagdoll, modelRules } from '../model/profiles';
import { g2f1, g2f2, g2f5, g2f11 } from './gate2';
import { balancedVariant, g3f1 } from './gate3';
import { asG4, g4f1, g4f2, g4f3Failed, g4f3OneArm, g4f3TwoArm, g4f4, g4f5TwoRagdolls, g4f10, g4f11Sideline } from './gate4';
import { v3 } from '../vec';

/** Re-profile a Gate 4 fixture with the model geometry (every player, the arm, ragdoll and rule profiles). */
export function asModel(def: FixtureDef, title = def.title): FixtureDef {
  if (!def.ragdoll) throw new Error(`asModel: ${def.id} has no ragdoll profile (re-profile it for Gate 4 first)`);
  const players = def.players.map((p) => ({ ...p, body: modelBody(p.body) }));
  const runner = def.rules ? players.find((p) => p.id === def.rules!.runnerId) : undefined;
  return {
    ...def,
    id: `${def.id}-M`,
    gate: 4,
    milestone: 'G4-M',
    title: `${title} [bew-v6 model geometry]`,
    notes: [def.notes, 'Model geometry: calibrated body, arm and ragdoll profiles (anatomical right on -X).'].filter(Boolean).join(' '),
    armProfile: def.players.some((p) => p.arms) ? modelArm(def.armProfile ?? ARM_G2) : def.armProfile,
    ragdoll: modelRagdoll(def.ragdoll),
    rules: def.rules ? modelRules(def.rules, runner?.body) : undefined,
    players,
  };
}

/** Gate 2/3 drill as a Gate 4 fixture (balanced profile, ragdoll handoff available), then on the model geometry. */
const fromG2 = (def: FixtureDef): FixtureDef => asModel(asG4(balancedVariant(def, 'G4-M'), { id: def.id, milestone: 'G4-M', title: def.title }));

export function modelFixtures(): FixtureDef[] {
  return [
    asModel(asG4(g3f1(), { id: 'G3-F1', milestone: 'G4-M', title: 'Idle, run and brake: rest 5 s, run +X at 5 m/s, brake' })),
    fromG2(g2f1()),
    fromG2(g2f2()),
    fromG2(g2f5()),
    fromG2(g2f11()),
    asModel(g4f1()),
    asModel(g4f2('yaw225-tumble', 225, v3(-2, 0, -2), v3(1.5, 0, -1))),
    asModel(g4f3TwoArm()),
    asModel(g4f3OneArm()),
    asModel(g4f3Failed()),
    asModel(g4f4('ownerOnly')),
    asModel(g4f4('simultaneous')),
    asModel(g4f10('simultaneous')),
    asModel(g4f5TwoRagdolls()),
    asModel(g4f11Sideline(3.85)),
  ];
}
