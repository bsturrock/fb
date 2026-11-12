// Ladder 11d (iii): a supported arm's continuity push settles between its own trunk pieces (`SelfClearanceProfile
// .seamSettle`, SELF_CLEARANCE_V2, used by no fixture yet). Re-derived from contact motion's palm continuity (s17
// palm.patch). The continuity step's palm target is pushed out of what the arm penetrates up to four times, and the own
// trunk's share is the deepest hit's normal per shape: a forearm lying across the seam between two trunk pieces is pushed
// fully into the other piece each time, so the side the last push leaves it on follows where the step started. The
// pushed target is the next step's start, and the palm went to and fro every substep (L3-F9-convert-contact D's left
// arm, 0.63 to 0.78 s). Under the profile that share is halved each time it turns against the one before and the pushes
// settle in the seam. The twin is the same state on SELF_CLEARANCE_V1.
import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/sim/fixtures/index';
import { SELF_CLEARANCE_V1, SELF_CLEARANCE_V2, type SelfClearanceProfile } from '../src/sim/profiles';
import { dist, qInvRot, sub, vc, type Vec3 } from '../src/sim/vec';
import { FIX } from './runs';
import { loadState, resumeState } from './state';

/** A palm move this large (m, body frame, one substep) is a visible jump; one undone to within this share the next substep went to and fro. */
const JUMP_M = 0.006;
const UNDONE = 0.25;

describe('ladder 11d: the continuity push settles in an own-trunk seam', () => {
  it('the profile: self-clearance-v1 with seamSettle, used by no fixture', () => {
    expect({ ...SELF_CLEARANCE_V2, id: SELF_CLEARANCE_V1.id, seamSettle: undefined }).toEqual({ ...SELF_CLEARANCE_V1, seamSettle: undefined });
    for (const d of allFixtures()) expect(d.selfClearance?.seamSettle, d.id).toBeUndefined();
  });

  it('L3-F9-convert-contact from 0.60 s: D\'s left palm takes no jump the next substep undoes (the twin on self-clearance-v1 goes to and fro)', async () => {
    // captured at the end of tick 36 (0.600 s) under the registered profile, just before D's left forearm settles across
    // the seam; resumed under each profile to 0.85 s, D's left palm in its proxy body frame every supported substep.
    // Measured: 60 supported substeps; on, no undone jump; the twin, 20 (1.2 to 1.5 cm)
    const cap = loadState('tests/data/state/L3-F9-convert-contact@36.json.gz');
    const read = async (selfClearance: SelfClearanceProfile): Promise<{ substeps: number; undone: number }> => {
      const palms: (Vec3 | null)[] = [];
      const sim = await resumeState(cap, {
        def: { ...FIX('L3-F9-convert-contact'), selfClearance },
        variant: ['selfClearance'],
        opts: {
          onSubstep: (s) => {
            const p = s.players.find((x) => x.id === 'D')!;
            if (!p.pose || p.rag || p.controlMode !== 'supported') return void palms.push(null);
            palms.push(qInvRot(p.proxy.body.rotation(), sub(p.pose.jointLandmarksWorld.leftPalm, vc(p.proxy.body.translation()))));
          },
        },
      });
      while (!sim.done && sim.t < 0.85) sim.stepTick();
      sim.dispose();
      let undone = 0;
      for (let i = 2; i < palms.length; i++) {
        const [a, b, c] = [palms[i - 2], palms[i - 1], palms[i]];
        if (a && b && c && dist(a, b) > JUMP_M && dist(a, c) < UNDONE * dist(a, b)) undone++;
      }
      return { substeps: palms.filter(Boolean).length, undone };
    };
    const on = await read(SELF_CLEARANCE_V2);
    const twin = await read(SELF_CLEARANCE_V1);
    expect(on.substeps).toBeGreaterThan(40);
    expect(on.undone).toBe(0);
    expect(twin.undone).toBeGreaterThan(10);
  }, 120000);
});
