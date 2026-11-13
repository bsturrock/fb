// Contact motion M3, the hold through the takedown (WRAP_V3's `commit.hold`, FALL_HOLD_V1; src/sim/conversion.ts
// `takedownHold`, the press in src/sim/fall-response.ts and ArmSystem.pressTarget). Measured on the front and rear wraps
// (L3-F19), whose defender takes the carrier down with a secure two-arm forearm hold; each case has its fault twin: the
// same run with the rule it checks broken (or without the carried hold) fails for that reason.
import { describe, expect, it } from 'vitest';
import { WRAP_V2, WRAP_V3, type WrapProfile } from '../src/sim/controllers/wrap';
import type { ArmSide } from '../src/sim/contracts';
import type { FixtureDef } from '../src/sim/fixture';
import { ENVELOPE_L4, FALL_HOLD_V1, type FallResponseProfile } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { FIX, preFallReact } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
const SUB = 1 / 240;
const MEMORY = FALL_HOLD_V1.arms.holdMemoryS;

// (contact motion M4: as before the fall flip, `preFallReact`, the defender's hold FALL_HOLD_V1, the takedown's own; under the
// flip's FALL_REACT_V1 the same hold, tests/fall-react.test.ts)
const withWrap = (d: FixtureDef, w: WrapProfile, o: Partial<FixtureDef> = {}): FixtureDef => ({ ...preFallReact(d), wrap: w, ...o });
const holdWith = (h: Partial<FallResponseProfile>): WrapProfile => ({ ...WRAP_V3, commit: { ...WRAP_V3.commit!, hold: { ...FALL_HOLD_V1, ...h, id: 'fall-hold-twin' } } });

interface Run {
  /** The simulation's time after the first substep the defender is a ragdoll, and his conversion's reason. */
  convS: number | null;
  /** The substep (Simulation.steps) he converted in. */
  convStep: number | null;
  reason: string | null;
  /** Per arm: how long after the switch the arm system last retained his hold (null: never after it). */
  heldS: Record<ArmSide, number | null>;
  /** The fall response each player started (profile id, the arm tasks it began with); absent: none. */
  began: Record<string, { profile: string; tasks: Record<ArmSide, string> }>;
  /** The defender's arm task changes, with their time after the switch. */
  tasks: { arm: ArmSide; from: string; to: string; reason: string; s: number }[];
  sim: Simulation;
}

async function run(def: FixtureDef, untilS: number, rev = false, ledgers = false): Promise<Run> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { reverseOrder: rev, ledgers, onSubstep: () => probe?.() });
  const D = sim.players.find((p) => p.id === 'D')!;
  const out: Run = { convS: null, convStep: null, reason: null, heldS: { left: null, right: null }, began: {}, tasks: [], sim };
  probe = () => {
    if (out.convS === null && D.rag) {
      out.convS = sim.t;
      out.convStep = sim.steps - 1;
    }
    if (out.convS === null) return;
    for (const s of SIDES) if (sim.arms!.retained('D', s)) out.heldS[s] = sim.t - out.convS;
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  out.reason = D.handoff?.reason ?? null;
  for (const e of sim.events) {
    const d = e.data as Record<string, unknown>;
    if (e.type === 'fallResponse') out.began[e.playerId!] = { profile: String(d.profile), tasks: d.tasks as Record<ArmSide, string> };
    if (e.type === 'fallTask' && e.playerId === 'D' && out.convS !== null) out.tasks.push({ arm: d.arm as ArmSide, from: String(d.from), to: String(d.to), reason: String(d.reason), s: e.t - out.convS });
  }
  return out;
}

const CASES: { id: string; rev: boolean }[] = [
  { id: 'L3-F19-front', rev: false },
  { id: 'L3-F19-front', rev: true },
  { id: 'L3-F19-rear', rev: false },
];

describe('contact motion M3: the tackler keeps his hold while he goes down (WRAP_V3)', () => {
  it('a takedown carries his forearm holds onto his ragdoll arms: in the front wrap (both orders) and the forward rear wrap his fall response (fall-hold-v1) starts at the takedown with both arms holding, each hold lasts at least 0.3 s past the switch (three times the 0.1 s memory: solved contact keeps renewing it), and when it lapses the arm braces (or goes limp with his core down) at that substep, never holding again. The fault twins: WRAP_V2 starts no response and retains nothing past the switch; without the press (`holdPressN` absent) a hold lapses within 0.2 s', async () => {
    for (const c of CASES) {
      const label = `${c.id}${c.rev ? ' reversed' : ''}`;
      const r = await run(withWrap(FIX(c.id), WRAP_V3), 2, c.rev);
      expect(r.reason, label).toBe('takedown');
      expect(r.began.D, label).toEqual({ profile: FALL_HOLD_V1.id, tasks: { left: 'hold', right: 'hold' } });
      for (const s of SIDES) {
        expect(r.heldS[s], `${label} ${s}`).toBeGreaterThanOrEqual(3 * MEMORY - 1e-9);
        const lost = r.tasks.filter((t) => t.arm === s && t.from === 'hold');
        expect(lost.length, `${label} ${s}`).toBe(1);
        expect(lost[0].reason, `${label} ${s}`).toBe('holdLost');
        expect(['brace', 'passive'], `${label} ${s}`).toContain(lost[0].to);
        expect(Math.abs(lost[0].s - (r.heldS[s]! + SUB)), `${label} ${s}`).toBeLessThanOrEqual(SUB + 1e-6);
        expect(r.tasks.some((t) => t.arm === s && t.to === 'hold'), `${label} ${s}`).toBe(false);
      }
      r.sim.dispose();
      const v2 = await run(withWrap(FIX(c.id), WRAP_V2), 2, c.rev);
      expect(v2.reason, label).toBe('takedown');
      expect(v2.began.D, label).toBeUndefined();
      expect(v2.heldS, label).toEqual({ left: null, right: null });
      v2.sim.dispose();
      const loose = await run(withWrap(FIX(c.id), holdWith({ arms: { ...FALL_HOLD_V1.arms, holdPressN: undefined } })), 2, c.rev);
      expect(loose.reason, label).toBe('takedown');
      expect(Math.min(...SIDES.map((s) => loose.heldS[s] ?? 0)), label).toBeLessThan(0.2);
      loose.sim.dispose();
    }
  }, 120000);

  it('only the takedown starts it: in the front wrap the carrier, converted on his lost balance, gets no fall response. The fault twin: the same hold as the fixture\'s own fall response (on an envelope with hips, which one needs) starts one for every conversion, the carrier\'s too', async () => {
    const d = FIX('L3-F19-front');
    const r = await run(withWrap(d, WRAP_V3), 1.5);
    expect(r.sim.players.find((p) => p.id === 'R')!.handoff?.reason).toBe('lossOfSupport');
    expect(Object.keys(r.began)).toEqual(['D']);
    r.sim.dispose();
    const twin = await run(withWrap(d, WRAP_V3, { ragdoll: { ...d.ragdoll!, envelope: ENVELOPE_L4 }, fallResponse: FALL_HOLD_V1 }), 1.5);
    expect(twin.sim.players.find((p) => p.id === 'R')!.handoff?.accepted).toBe(true);
    expect(Object.keys(twin.began).sort()).toEqual(['D', 'R']);
    twin.sim.dispose();
  }, 60000);

  it('the hold is the ragdoll arms\' alone and inside the shared budget: after his switch no retention force of his is virtual (no clamp or palm hold in the force ledger, no clamp begins), every arm effort allocation stays within the falling owner budget and its arm\'s ceiling, every joint torque within its cap and the profile\'s ceilings, and the work within its cap (front wrap, both orders). The fault twin: the same ledger read over the substeps before the switch finds his clamps', async () => {
    for (const rev of [false, true]) {
      const r = await run(withWrap(FIX('L3-F19-front'), WRAP_V3), 1.5, rev, true);
      const s = r.sim;
      const D = s.players.find((p) => p.id === 'D')!;
      const after = (step: number): boolean => step >= r.convStep!;
      const forces = s.arms!.ledger.filter((e) => e.owner === 'D');
      expect(forces.filter((e) => (e.kind === 'clamp' || e.kind === 'hold') && after(e.step)).length, `rev ${rev}`).toBe(0);
      expect(s.events.filter((e) => e.type === 'clampBegin' && e.playerId === 'D' && e.t >= r.convS! - SUB - 1e-9).length, `rev ${rev}`).toBe(0);
      const effort = s.arms!.effortLedger.filter((e) => e.owner === 'D');
      expect(effort.length, `rev ${rev}`).toBeGreaterThan(0);
      for (const e of effort) {
        expect(e.allocatedN, `rev ${rev}`).toBeLessThanOrEqual(e.perArmN + 1e-6);
        expect(e.ownerBudgetN, `rev ${rev}`).toBeLessThanOrEqual(350 + 1e-9);
      }
      const bySub = new Map<number, number>();
      for (const e of effort) bySub.set(e.step, (bySub.get(e.step) ?? 0) + e.allocatedN);
      for (const [, n] of bySub) expect(n, `rev ${rev}`).toBeLessThanOrEqual(effort[0].ownerBudgetN + 1e-6);
      const joints = s.fall!.ledger.filter((e) => e.owner === 'D');
      expect(joints.length, `rev ${rev}`).toBeGreaterThan(0);
      for (const e of joints) {
        expect(e.appliedNm, e.joint).toBeLessThanOrEqual(e.capNm * (1 + 1e-6));
        expect(e.capNm, e.joint).toBeLessThanOrEqual(FALL_HOLD_V1.ceilingsNm[D.rag!.joints.find((j) => j.id === e.joint)!.kind as 'shoulder'] + 1e-9);
        expect(e.budgetScale, e.joint).toBeLessThanOrEqual(1 + 1e-9);
      }
      const rep = s.fall!.report(D.fall!) as { positiveWorkJ: number; overWork: boolean };
      expect(rep.overWork).toBe(false);
      expect(rep.positiveWorkJ).toBeLessThanOrEqual(FALL_HOLD_V1.power.maxPositiveWorkJ);
      // the twin: before the switch the same ledger holds his clamps
      expect(forces.filter((e) => e.kind === 'clamp' && !after(e.step)).length, `rev ${rev}`).toBeGreaterThan(0);
      s.dispose();
    }
  }, 60000);

  it('the build refuses a takedown hold that drives a ball joint its ragdoll has no envelope for (the front wrap without its joint-range profile: no shoulder envelope). The fault twin: as registered (the joint-range profile\'s shoulder envelope) it builds', async () => {
    const d = FIX('L3-F19-front');
    await expect(Simulation.create(withWrap(d, WRAP_V3, { jointRange: undefined, ragdoll: { ...d.ragdoll!, envelope: undefined } }))).rejects.toThrow(/needs a ragdoll envelope for every ball joint it drives/);
    const s = await Simulation.create(withWrap(d, WRAP_V3));
    expect(s.fall?.P.id).toBe(FALL_HOLD_V1.id);
    s.dispose();
  }, 30000);
});
