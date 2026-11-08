// Plan 10e: the rule corrections, on rules revision 2 (U8: a new revision opted in on L3 and L4; the historical profile
// keeps the behaviour it was recorded with). E1 the settle window keeps the stance request and yaw effort (U9), E2
// influence clears only out of contact and retention, E3 progress counts the retention opposing it, E4 a profile cannot
// make an excluded region end a play. Each check runs the historical profile beside revision 2.
import { describe, expect, it } from 'vitest';
import type { PlayerContactObs } from '../src/sim/contracts';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { RAGDOLL_G4, RULES_FOOTBALL, rulesRevision2, type RuleProfile } from '../src/sim/profiles';
import { RuleObserver, ruleProfileExport, type RetentionObs, type RuleFrame } from '../src/sim/rules';
import { Simulation } from '../src/sim/simulation';
import { v3, type Vec3 } from '../src/sim/vec';
import { runSim } from './helpers';

const DT = 1 / 240;
const HIST = RULES_FOOTBALL('R', { sideline: false });
const REV2 = rulesRevision2(HIST);

/** One supported, grounded proxy runner substep with no ground contact (the ball on the core offset). */
const frame = (i: number, o: { request?: Vec3; velocity?: Vec3; opponentContacts?: PlayerContactObs[]; retention?: RetentionObs[] } = {}): RuleFrame => ({
  t: i * DT,
  tick: Math.floor(i / 4),
  step: i,
  dt: DT,
  runnerId: 'R',
  representation: 'proxy',
  validHandoff: false,
  controlMode: 'supported',
  grounded: true,
  corePose: { p: v3(0, 1, 0), q: { x: 0, y: 0, z: 0, w: 1 } },
  pose: null,
  velocity: o.velocity ?? v3(),
  request: o.request ?? v3(),
  contacts: [],
  opponentContacts: o.opponentContacts ?? [],
  retention: o.retention ?? [],
  minClampNormalN: 1,
});

const touch = (impulse: number): PlayerContactObs => ({
  other: 'D',
  ownRegion: 'torso',
  ownClass: 'torso',
  otherRegion: 'torso',
  otherClass: 'shoulder:selected',
  pointWorld: v3(0, 1, 0),
  normalFromOther: v3(1, 0, 0),
  impulse,
});

/** Feed `n` substeps after one opening contact; the events in order and the observer. */
function play(profile: RuleProfile, n: number, at: (i: number) => RuleFrame, open = true): { events: string[]; obs: RuleObserver } {
  const events: string[] = [];
  const obs = new RuleObserver(profile, RAGDOLL_G4, (type) => events.push(type));
  if (open) obs.observe(frame(0, { opponentContacts: [touch(0.01)] }));
  for (let i = 1; i <= n && !obs.ending; i++) obs.observe(at(i));
  return { events, obs };
}

describe('plan 10e: rules revision 2', () => {
  it('L3 and L4 referee on revision 2; every historical fixture keeps its profile, with no revision in its export', () => {
    const all = allFixtures().filter((d) => d.rules);
    const recent = all.filter((d) => /^L[34]$/.test(d.milestone));
    const hist = all.filter((d) => !/^L[34]$/.test(d.milestone));
    expect(recent.length).toBeGreaterThan(30);
    expect(hist.length).toBeGreaterThan(20);
    for (const d of recent) {
      expect(d.rules!.revision, d.id).toBe(2);
      expect(d.rules!.id, d.id).toMatch(/\+revision=2$/);
    }
    for (const d of hist) {
      expect(d.rules!.revision, d.id).toBeUndefined();
      expect(d.rules!.id, d.id).not.toContain('revision');
      expect(Object.keys(ruleProfileExport(d.rules!)), d.id).not.toContain('revision');
    }
    // idempotent: an L3 fixture's rules are not wrapped again by L4
    expect(rulesRevision2(REV2)).toBe(REV2);
  });

  it('E2: a runner touched or held with a zero request keeps influence; out of contact it clears', () => {
    const held: RetentionObs = { id: 'clamp:D:left', owner: 'D', kind: 'clamp', forceOnRunner: v3(), loadN: 0 };
    const cases: [string, (i: number) => RuleFrame, boolean][] = [
      // an unloaded clamp and a touch under the source impulse are not influence sources, but they are contact
      ['clamp unloaded, zero request', (i) => frame(i, { retention: [held] }), false],
      ['touch under the source impulse, zero request', (i) => frame(i, { opponentContacts: [touch(1e-5)] }), false],
      ['no contact, zero request', (i) => frame(i), true],
      ['no contact, moving freely', (i) => frame(i, { request: v3(2, 0, 0), velocity: v3(2, 0, 0) }), true],
    ];
    for (const [name, at, clears] of cases) {
      const hist = play(HIST, 240, at);
      const rev = play(REV2, 240, at);
      expect(hist.events, name).toContain('influenceBegin');
      // the historical profile clears after 0.2 s in every case: a zero request reads as moving freely
      expect(hist.events, name).toContain('influenceCleared');
      expect(rev.events.includes('influenceCleared'), name).toBe(clears);
      expect(rev.obs.lastRow!.infl, name).toBe(clears ? 0 : 1);
    }
  });

  it('E3: a sideways or forward retention force is not progress retained; one opposing progress is', () => {
    // the runner asks for 1 m/s along the field's forward axis (+x) and does not move
    const grip = (f: Vec3): RetentionObs => ({ id: 'grip:D:right', owner: 'D', kind: 'grip', forceOnRunner: f, loadN: Math.hypot(f.x, f.y, f.z) });
    const cases: [string, Vec3, boolean][] = [
      ['sideways', v3(0, 0, 100), false],
      ['forward', v3(100, 0, 0), false],
      ['opposing', v3(-100, 0, 0), true],
      ['opposing, at 45 degrees', v3(-70.8, 0, 70.8), true],
    ];
    for (const [name, f, stops] of cases) {
      const at = (i: number) => frame(i, { request: v3(1, 0, 0), retention: [grip(f)] });
      const hist = play(HIST, 300, at, false);
      const rev = play(REV2, 300, at, false);
      // the historical profile counts the whole force: every case is restrained and stops after the 0.75 s window
      expect(hist.obs.ending?.kind, name).toBe('progressStopped');
      expect(rev.obs.ending?.kind ?? null, name).toBe(stops ? 'progressStopped' : null);
      if (!stops) expect(rev.events, name).not.toContain('progressWindow');
      else expect(rev.obs.ending!.evidence.retentionN, name).toBeCloseTo(-f.x, 6);
    }
  });

  it('E4: a profile that lists an excluded region cannot be refereed; every registered profile can', () => {
    for (const region of ['hand', 'wrist', 'foot', 'ankle', 'footSupport'])
      expect(() => new RuleObserver({ ...REV2, eligibleRegions: [...REV2.eligibleRegions, region] }, RAGDOLL_G4, () => {}), region).toThrow(/EXCLUDED_GROUND_REGIONS/);
    for (const d of allFixtures().filter((x) => x.rules)) expect(() => new RuleObserver(d.rules!, d.ragdoll ?? RAGDOLL_G4, () => {}), d.id).not.toThrow();
  });

  it('E1: after the ending players keep their stance request and yaw effort through the settle window', async () => {
    // L3-F1-phase0 with the defender wrapping in a lowered stance: both profiles end at the same substep and the defender
    // is still a supported proxy for a while after it (the runner, a ragdoll by then, asks for full yaw effort)
    const base = allFixtures().find((d) => d.id === 'L3-F1-phase0')!;
    const variant = (rules: RuleProfile): FixtureDef => ({
      ...base,
      id: `test-E1-${rules.revision ?? 1}`,
      rules,
      players: base.players.map((p) => (p.id === 'D' && p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, stance: { heightM: 0.78 } } } : p)),
    });
    const hist: RuleProfile = { ...base.rules!, revision: undefined, id: `${base.rules!.id}+historical` };
    type Run = { stance: (number | null)[]; runner: { h: number | null; yaw: number | null }[]; h: number[] };
    const runs: Record<string, Run> = {};
    for (const [k, rules] of [['hist', hist], ['rev2', base.rules!]] as const) {
      const out: Run = { stance: [], runner: [], h: [] };
      let endT = NaN;
      const sim = await Simulation.create(variant(rules), {
        onSubstep: (s) => {
          if (!s.ending) return;
          // the ending substep ran on the intent decided before it; the override starts with the next one
          if (Number.isNaN(endT)) {
            endT = s.t;
            return;
          }
          const R = s.players.find((p) => p.id === 'R')!;
          out.runner.push({ h: R.intent.locomotion.stance?.heightM ?? null, yaw: R.intent.locomotion.yawEffort ?? null });
          const D = s.players.find((p) => p.id === 'D')!;
          if (D.representation !== 'proxy' || D.controlMode !== 'supported' || s.t > endT + 0.15) return;
          out.stance.push(D.intent.locomotion.stance?.heightM ?? null);
          out.h.push(s.poseOf(D).p.y);
        },
      });
      await runSim(sim);
      expect(sim.ending, k).not.toBeNull();
      sim.dispose();
      runs[k] = out;
    }
    expect(runs.rev2.stance.length).toBeGreaterThan(20);
    expect(runs.hist.stance.length).toBeGreaterThan(20);
    // revision 2: the requests they stood in; the historical profile drops both for the profile's standing height
    expect(new Set(runs.rev2.stance)).toEqual(new Set([0.78]));
    expect(new Set(runs.rev2.runner.map((r) => `${r.h}/${r.yaw}`))).toEqual(new Set(['null/1']));
    expect(new Set(runs.hist.stance)).toEqual(new Set([null]));
    expect(new Set(runs.hist.runner.map((r) => `${r.h}/${r.yaw}`))).toEqual(new Set(['null/null']));
    // and the defender stays down: the historical core rises toward the standing height through the same window
    const rise = (h: number[]): number => h[h.length - 1] - h[0];
    expect(rise(runs.hist.h)).toBeGreaterThan(rise(runs.rev2.h) + 0.01);
  }, 60000);
});
