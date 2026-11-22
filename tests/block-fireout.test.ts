// Plan 16 (p40): the fire-out. (a) The deadlock: a loaded man held off at arm's length by the other man's palms strikes
// from where he is (`BlockStrike.strike.engagedReachM`, BLOCK_STRIKE_V2) instead of staying loaded for the whole block.
// Constructed cues and a constructed scene (BL-F1-even's men from the two-point set, 1.1 m apart); each with its fault
// twin (BLOCK_STRIKE_V1, the rule absent).
import { describe, expect, it } from 'vitest';
import { BLOCK_STRIKE_V1, BLOCK_STRIKE_V2, LEAN_IN_V3, nextPunch, type BlockStrike, type PunchCues, type PunchState, type PreSnapStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, contested } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { FIX, WITHOUT_NEWER } from './helpers';

const TWO: PreSnapStance = { kind: 'two-point', side: 'offense' };

describe('plan 16 (p40), the fire-out deadlock: engaged, in reach, he strikes', () => {
  it('(a) the decision: loaded and engaged at 0.64 m of reach with no closing speed, BLOCK_STRIKE_V2 throws the strike; not engaged at the same reach, or engaged out past 0.66 m, it waits; fault twin: BLOCK_STRIKE_V1 waits engaged at 0.64 m (outside contactM\'s 0.6 with nothing closing)', () => {
    const cues = (o: Partial<PunchCues>): PunchCues => ({ t: 1, serial: 0, gap: 0.74, closingMps: 0, engaged: true, reachM: 0.64, loaded: true, anyOn: false, straight: false, speedMps: 0, ...o });
    const load: PunchState = { n: 0, phase: 'load', since: 0, depth: 1 };
    const K = BLOCK_STRIKE_V2;
    expect(K.strike.engagedReachM).toBeLessThan(K.strike.straightM);
    expect(nextPunch(K, 0.8, load, cues({}))?.phase, 'V2 engaged at 0.64 m').toBe('strike');
    expect(nextPunch(K, 0.8, load, cues({ engaged: false }))?.phase, 'V2 not engaged at 0.64 m').toBe('load');
    expect(nextPunch(K, 0.8, load, cues({ reachM: 0.68 }))?.phase, 'V2 engaged at 0.68 m').toBe('load');
    expect(nextPunch(K, 0.8, load, cues({ reachM: 0.45 }))?.phase, 'V2 engaged too close (0.45 m)').toBe('load');
    expect(nextPunch(K, 0.8, load, cues({ loaded: false }))?.phase, 'V2 engaged, hands not loaded').toBe('load');
    // fault twin
    expect(nextPunch(BLOCK_STRIKE_V1, 0.8, load, cues({}))?.phase, 'V1 engaged at 0.64 m').toBe('load');
  });

  interface Fire {
    /** Per man: when his first strike was thrown (s; absent: never), the longest stretch engaged and loaded (s), a palm of his on the other man (ever). */
    strikeT: Record<string, number | undefined>;
    loadedEngagedS: Record<string, number>;
    landed: Record<string, boolean>;
    fell: boolean;
  }
  async function fire(K: BlockStrike): Promise<Fire> {
    const o = BL_SCENES.find((x) => x.id === 'BL-F1-even')!;
    const m = (x: typeof o.A) => ({ ...x, profile: contested(undefined, K), leanIn: LEAN_IN_V3, stance: TWO, fromS: 1 });
    const def: FixtureDef = blockScene({ ...o, ...WITHOUT_NEWER, id: 'BL-T-fireout', A: m(o.A), B: m(o.B), sepM: 1.1, durationS: 3 }, FIX('L3-F6-hold'));
    const r: Fire = { strikeT: {}, loadedEngagedS: { A: 0, B: 0 }, landed: { A: false, B: false }, fell: false };
    const since: Record<string, number | null> = { A: null, B: null };
    let sim!: Simulation;
    sim = await Simulation.create(def, {
      onSubstep: () => {
        for (const p of sim.players) {
          if (p.rag || p.controlMode !== 'supported') r.fell = true;
          const pu = p.block?.punch;
          if (pu?.phase === 'strike' && r.strikeT[p.id] === undefined) r.strikeT[p.id] = sim.t;
          if (p.block?.phase === 'engaged' && pu?.phase === 'load') {
            since[p.id] ??= sim.t;
            r.loadedEngagedS[p.id] = Math.max(r.loadedEngagedS[p.id], sim.t - since[p.id]!);
          } else since[p.id] = null;
          if (sim.arms?.pushOf(p.id, 'left') || sim.arms?.pushOf(p.id, 'right')) r.landed[p.id] = true;
        }
      },
    });
    sim.runToEnd();
    sim.dispose();
    return r;
  }

  it('(a) the scene: BL-F1-even\'s men set in the two-point set 1.1 m apart, the snap at 1 s (3 s): on BLOCK_STRIKE_V2 both strike within 0.6 s of the snap and land their palms, neither stays engaged and loaded past 0.3 s, nobody falls; fault twin: on BLOCK_STRIKE_V1 the under man (A), struck first and held off, never strikes and stays loaded the rest of the run', async () => {
    const on = await fire(BLOCK_STRIKE_V2);
    const say = JSON.stringify(on);
    expect(on.fell, say).toBe(false);
    for (const id of ['A', 'B']) {
      expect(on.strikeT[id], `${id} ${say}`).toBeDefined();
      expect(on.strikeT[id]!, `${id} ${say}`).toBeLessThan(1.6);
      expect(on.landed[id], `${id} ${say}`).toBe(true);
      expect(on.loadedEngagedS[id], `${id} ${say}`).toBeLessThan(0.3);
    }
    const off = await fire(BLOCK_STRIKE_V1);
    const sayOff = JSON.stringify(off);
    expect(off.strikeT.A, sayOff).toBeUndefined();
    expect(off.landed.A, sayOff).toBe(false);
    expect(off.loadedEngagedS.A, sayOff).toBeGreaterThan(1.2);
  }, 120_000);
});
