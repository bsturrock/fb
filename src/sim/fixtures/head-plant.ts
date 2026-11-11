// Opt-in regression host (not registered in allFixtures): L4-F9-low's runner alone, converted at 0.05 s, so a state seed
// of its ragdoll and fall episode can be applied to it. Nothing of the supported pose reaches the ragdoll after the
// seed: the joint anchors are the blueprint's, and the seed carries every pose-built collider and landmark placement.
import type { FixtureDef } from '../fixture';
import type { FallResponseProfile } from '../profiles';
import { l4f9 } from './falls';

export function headPlantHost(response?: FallResponseProfile): FixtureDef {
  const d = l4f9().find((x) => x.id === 'L4-F9-low')!;
  return {
    ...d,
    id: 'L4-F9-low-headPlantHost',
    title: "L4-F9-low's runner alone, a host for a state seed",
    players: d.players.filter((p) => p.id === 'R'),
    rules: undefined,
    focus: undefined,
    diagnostics: { conversions: [{ playerId: 'R', atS: 0.05 }] },
    durationS: 2,
    ...(response ? { fallResponse: response } : {}),
  };
}
