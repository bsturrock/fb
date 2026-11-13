// Contact motion M4 (rough slice step 1): FALL_REACT_V1, the plan 09 fall response for every L3 and HC conversion
// (src/sim/profiles.ts; the hold onset and the hip target on the hard stops in src/sim/fall-response.ts, the build's
// check and the arm system's profile in src/sim/simulation.ts). Step 2: FALL_REACT_V2, the landed palm bearing load
// (`brace.load`, src/sim/fall-response.ts). Each case has its fault twin: the same run with the rule
// it checks broken (a profile field taken away, or a joint group's effort off) fails for that reason.
import { describe, expect, it } from 'vitest';
import { isGround, type ArmSide } from '../src/sim/contracts';
import type { FixtureDef } from '../src/sim/fixture';
import { ARM_G2, FALL_HOLD_V1, FALL_L4, FALL_REACT_V1, FALL_REACT_V2, withoutHipStops, type FallResponseProfile } from '../src/sim/profiles';
import { armSystemProfile, checkLimbContract, Simulation } from '../src/sim/simulation';
import { hingeAngles, limbDirWorld } from '../src/sim/ragdoll';
import { dot, qInvRot } from '../src/sim/vec';
import { FIX } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
const MEMORY = FALL_REACT_V1.arms.holdMemoryS;
const deg = (r: number): number => (r * 180) / Math.PI;

/** `d` with the fall response `P` (an L3 or HC fixture as the flip would register it). */
const reacting = (d: FixtureDef, P: FallResponseProfile = FALL_REACT_V1): FixtureDef => ({ ...d, fallResponse: P });
const variant = (o: Partial<FallResponseProfile>, id: string): FallResponseProfile => ({ ...FALL_REACT_V1, ...o, id });
/** An installed player's tipped fall (L4-F2-model) with the L3 and HC ragdoll: a shoulder envelope only, the hips their hard stops. */
const l3Tipped = (dir: 'forward' | 'back' | 'side', P: FallResponseProfile): FixtureDef => {
  const d = FIX(`L4-F2-model-${dir}-on`);
  return { ...d, id: `${d.id}-l3`, ragdoll: { ...d.ragdoll!, envelope: undefined }, fallResponse: P };
};

interface Run {
  sim: Simulation;
  /** The simulation time after the first substep each player was an accepted ragdoll. */
  convS: Record<string, number>;
  /** The response each player started: profile id and its starting tasks. */
  began: Record<string, { profile: string; tasks: Record<ArmSide, string> }>;
  /** Per player and arm: how long after his switch the arm system last retained a hold of his. */
  heldS: Record<string, Record<ArmSide, number | null>>;
  /** Per player: the largest angle (deg) of the carry upper arm from its direction at the switch (core frame), over the first second. */
  carryDevDeg: Record<string, number>;
  /** Per player: knee flexion and hip flexion (deg, both sides' mean) `atS` after his switch, and at the switch. */
  legsAt: Record<string, { knee0: number; hip0: number; knee: number; hip: number }>;
}

const hipFlexDeg = (s: Simulation, id: string): number => {
  const rag = s.players.find((p) => p.id === id)!.rag!;
  const q = rag.bodies.core.rotation();
  return SIDES.map((side) => {
    const d = qInvRot(q, limbDirWorld(rag, `${side}Thigh`));
    return deg(Math.atan2(d.z, -d.y));
  }).reduce((a, b) => a + b, 0) / 2;
};
const kneeDeg = (s: Simulation, id: string): number => {
  const h = hingeAngles(s.players.find((p) => p.id === id)!.rag!);
  return (h.leftKnee + h.rightKnee) / 2;
};

async function run(def: FixtureDef, untilS: number, o: { rev?: boolean; atS?: number } = {}): Promise<Run> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { reverseOrder: !!o.rev, onSubstep: () => probe?.() });
  const out: Run = { sim, convS: {}, began: {}, heldS: {}, carryDevDeg: {}, legsAt: {} };
  const dir0: Record<string, { x: number; y: number; z: number }> = {};
  probe = () => {
    for (const pl of sim.players) {
      if (!pl.rag || !pl.handoff?.accepted) continue;
      if (out.convS[pl.id] === undefined) {
        out.convS[pl.id] = sim.t;
        out.heldS[pl.id] = { left: null, right: null };
        out.legsAt[pl.id] = { knee0: kneeDeg(sim, pl.id), hip0: hipFlexDeg(sim, pl.id), knee: NaN, hip: NaN };
      }
      const tS = sim.t - out.convS[pl.id];
      for (const s of SIDES) if (sim.arms?.retained(pl.id, s)) out.heldS[pl.id][s] = tS;
      const side = sim.carrySide(pl);
      if (side && tS <= 1) {
        const d = qInvRot(pl.rag.bodies.core.rotation(), limbDirWorld(pl.rag, `${side}UpperArm`));
        dir0[pl.id] ??= d;
        out.carryDevDeg[pl.id] = Math.max(out.carryDevDeg[pl.id] ?? 0, deg(Math.acos(Math.min(1, dot(d, dir0[pl.id])))));
      }
      if (o.atS !== undefined && Number.isNaN(out.legsAt[pl.id].knee) && tS >= o.atS - 1e-9) Object.assign(out.legsAt[pl.id], { knee: kneeDeg(sim, pl.id), hip: hipFlexDeg(sim, pl.id) });
    }
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  for (const e of sim.events) {
    const d = e.data as Record<string, unknown>;
    if (e.type === 'fallResponse') out.began[e.playerId!] = { profile: String(d.profile), tasks: d.tasks as Record<ArmSide, string> };
  }
  return out;
}

describe('contact motion M4: every falling player on L3 and HC reacts (FALL_REACT_V1)', () => {
  it('the profile is FALL_L4 (tasks, gains, timing, power and work caps, impact guard, knees and hips) with the M3 hold: FALL_HOLD_V1\'s arm ceilings, hold scale and press, and its no-delay onset for a holding arm alone', () => {
    const { id, ceilingsNm, arms, ...rest } = FALL_REACT_V1;
    const { id: _i, ceilingsNm: c4, arms: a4, ...rest4 } = FALL_L4;
    expect(id).toBe('fall-react-v1');
    expect(rest).toEqual(rest4);
    expect(ceilingsNm).toEqual(FALL_HOLD_V1.ceilingsNm);
    expect({ ...c4, shoulder: 30, elbow: 20 }).toEqual(ceilingsNm);
    expect(arms).toEqual({ ...a4, holdScale: 1, holdPressN: 100, holdOnset: { delayS: 0, rampS: 0.02 } });
    expect(rest.enable).toEqual({ knee: true, hip: true, arms: true });
  });

  it('it builds on an L3 or HC ragdoll (the joint-range shoulder envelope, the hips only their hard stops) and starts at every accepted conversion: in the front wrap the tackler (his takedown) holds with both arms, the carrier (his lost balance) protects the ball and braces his free arm. The fault twins: without the hip stops the build refuses it; under WRAP_V3 alone (no response of the fixture\'s own) only the takedown starts one, the M3 hold', async () => {
    const d = FIX('L3-F19-front');
    const r = await run(reacting(d), 1.5);
    expect(r.sim.players.find((p) => p.id === 'D')!.handoff?.reason).toBe('takedown');
    expect(r.sim.players.find((p) => p.id === 'R')!.handoff?.reason).toBe('lossOfSupport');
    expect(r.began).toEqual({ D: { profile: FALL_REACT_V1.id, tasks: { left: 'hold', right: 'hold' } }, R: { profile: FALL_REACT_V1.id, tasks: { left: 'brace', right: 'protect' } } });
    r.sim.dispose();
    await expect(Simulation.create(reacting({ ...d, ragdoll: withoutHipStops(d.ragdoll!) }))).rejects.toThrow(/needs a ragdoll profile with a shoulder envelope and a hip envelope or hip stops/);
    const twin = await run(d.fallResponse ? { ...d, fallResponse: undefined } : d, 1.5);
    expect(twin.began).toEqual({ D: { profile: FALL_HOLD_V1.id, tasks: { left: 'hold', right: 'hold' } } });
    twin.sim.dispose();
  }, 60000);

  it('an arm still holding at the switch keeps its hold (`holdOnset`, no reaction delay): in the front wrap (both orders) and the rear wrap, each of the tackler\'s holds lasts at least 0.3 s past his takedown (three times the 0.1 s memory). The fault twin: with the reaction delay of every other task (FALL_L4\'s 40 ms and 80 ms ramp) a hold lapses within 0.2 s in each, and every hold does in the reversed front wrap and the rear wrap', async () => {
    for (const [id, rev, all] of [['L3-F19-front', false, false], ['L3-F19-front', true, true], ['L3-F19-rear', false, true]] as const) {
      const label = `${id}${rev ? ' reversed' : ''}`;
      const r = await run(reacting(FIX(id)), 1.6, { rev });
      for (const s of SIDES) expect(r.heldS.D[s], `${label} ${s}`).toBeGreaterThanOrEqual(3 * MEMORY - 1e-9);
      r.sim.dispose();
      const late = await run(reacting(FIX(id), variant({ arms: { ...FALL_REACT_V1.arms, holdOnset: undefined } }, 'fall-react-late-hold')), 1.6, { rev });
      const lapsed = SIDES.filter((s) => (late.heldS.D[s] ?? 0) < 0.2);
      expect(lapsed.length, label).toBeGreaterThanOrEqual(all ? 2 : 1);
      late.sim.dispose();
    }
  }, 120000);

  it('the knees and hips flex before landing on the L3 and HC ragdoll, whose hips have only the hard stops (the installed player tipped forward, back and sideways): 0.3 s after the switch the knees are more flexed than in the twin with no leg effort in every direction, and in the forward fall, whose hips the fall itself straightens, so are the hips; every hip torque stays within its ceiling. (In the back and side falls the fall folds the hips faster than their target: past it the drive only brakes, the yield)', async () => {
    for (const dir of ['forward', 'back', 'side'] as const) {
      const on = await run(l3Tipped(dir, FALL_REACT_V1), 0.8, { atS: 0.3 });
      const off = await run(l3Tipped(dir, variant({ enable: { knee: false, hip: false, arms: true } }, 'fall-react-no-legs')), 0.8, { atS: 0.3 });
      const a = on.legsAt.R;
      const b = off.legsAt.R;
      expect(a.knee, dir).toBeGreaterThan(b.knee + 2);
      if (dir === 'forward') expect(a.hip, dir).toBeGreaterThan(b.hip + 5);
      const hips = on.sim.fall!.report(on.sim.players[0].fall!) as { peakNm: Record<string, number> };
      expect(hips.peakNm.hip, dir).toBeGreaterThan(0);
      expect(hips.peakNm.hip, dir).toBeLessThanOrEqual(FALL_REACT_V1.ceilingsNm.hip + 1e-9);
      on.sim.dispose();
      off.sim.dispose();
    }
  }, 90000);

  it('the ball carrier keeps his tuck, around the braced pose he converts in: converted mid-run (L3-F16-handoff) and in the front wrap (both orders) his carry upper arm stays within 40 deg of its direction at the switch (core frame) over the first second. The fault twin: the same falls with no arm effort turn it past 60 deg', async () => {
    for (const [id, rev, untilS] of [['L3-F16-handoff', false, 3.7], ['L3-F19-front', false, 2.3], ['L3-F19-front', true, 2.3]] as const) {
      const label = `${id}${rev ? ' reversed' : ''}`;
      const on = await run(reacting(FIX(id)), untilS, { rev });
      expect(on.began.R?.tasks.right, label).toBe('protect');
      expect(on.carryDevDeg.R, label).toBeLessThan(40);
      on.sim.dispose();
      const off = await run(reacting(FIX(id), variant({ enable: { knee: true, hip: true, arms: false } }, 'fall-react-no-arms')), untilS, { rev });
      expect(off.carryDevDeg.R, label).toBeGreaterThan(60);
      off.sim.dispose();
    }
  }, 120000);

  it('a free arm reaches for the floor and lands on its palm ahead of the body: the carrier converted mid-run (L3-F16-handoff) braces his free left arm, whose palm meets the floor. The fault twin: with no arm effort no brace is made', async () => {
    const on = await run(reacting(FIX('L3-F16-handoff')), 3.7);
    const bc = on.sim.events.filter((e) => e.type === 'braceContact' && e.playerId === 'R');
    expect(bc.map((e) => [(e.data as { arm: string }).arm, (e.data as { part: string }).part])).toEqual([['left', 'palm']]);
    on.sim.dispose();
    const off = await run(reacting(FIX('L3-F16-handoff'), variant({ enable: { knee: true, hip: true, arms: false } }, 'fall-react-no-arms')), 3.7);
    expect(off.sim.events.filter((e) => e.type === 'braceContact' || e.type === 'braceTarget')).toEqual([]);
    off.sim.dispose();
  }, 60000);

  it('a fixture whose players have no supported arms runs its arm system, the response\'s shared falling budget, on the ragdoll\'s limbs (`armSystemProfile`): L3-F16-handoff\'s carrier gets the model ragdoll\'s lengths and radii, which meet the limb contract, and every arm allocation stays within the owner budget. A fixture with supported arms keeps its own. The fault twin: the fixture\'s own arm profile (ARM_G2) breaks the contract', async () => {
    const d = reacting(FIX('L3-F16-handoff'));
    expect(d.players.some((p) => p.arms)).toBe(false);
    const A = armSystemProfile(d);
    expect(A.id).toBe(`${ARM_G2.id}+limbs:${d.ragdoll!.id}`);
    expect(() => checkLimbContract(A, d.ragdoll!)).not.toThrow();
    expect(() => checkLimbContract(d.armProfile ?? ARM_G2, d.ragdoll!)).toThrow(/limb contract/);
    const w = FIX('L3-F19-front');
    expect(armSystemProfile(w)).toBe(w.armProfile ?? ARM_G2);
    const s = await Simulation.create(d, { ledgers: true });
    while (!s.done && s.t < 3.7) s.stepTick();
    // (built on the simulation's ragdoll, which carries the fixture's joint range)
    expect(s.arms!.profile).toEqual(armSystemProfile(s.def));
    expect(s.arms!.profile.id).toBe(`${ARM_G2.id}+limbs:${s.def.ragdoll!.id}`);
    const effort = s.arms!.effortLedger.filter((e) => e.owner === 'R');
    expect(effort.length).toBeGreaterThan(0);
    for (const e of effort) expect(e.allocatedN).toBeLessThanOrEqual(e.ownerBudgetN + 1e-6);
    s.dispose();
  }, 60000);
});

/** One run's landed braces: per arm, the brace commands' realized work after its floor contact and the release. */
async function landed(def: FixtureDef, untilS: number, pid: string, side: ArmSide) {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { ledgers: true, onSubstep: () => probe?.() });
  let contactS: number | null = null;
  // per substep after the contact: whether the palm or forearm is on the floor, and the arm's task
  const steps: { t: number; onFloor: boolean; task: string; opposed: boolean }[] = [];
  probe = () => {
    const ep = sim.fall?.episodes.get(pid);
    if (!ep) return;
    if (contactS === null && ep.arms[side].brace === 'contact') contactS = sim.t;
    if (contactS === null) return;
    let onFloor = false;
    for (const c of sim.contacts) {
      if (c.impulse <= 0) continue;
      for (const [o, x] of [[c.a, c.b], [c.b, c.a]] as const) if (o.playerId === pid && o.side === side && (o.region === 'palm' || o.region === 'forearm') && isGround(x)) onFloor = true;
    }
    // each of the arm's applied commands against its joint's rate before the solve
    const opposed = ep.applied.filter((a) => a.cmd.arm === side).every((a) => dot(a.cmd.torque, a.cmd.wPre) <= 1e-9);
    steps.push({ t: sim.t, onFloor, task: ep.arms[side].task, opposed });
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  let posJ = 0;
  for (const e of sim.fall!.ledger) if (e.owner === pid && e.task === 'brace' && contactS !== null && e.t >= contactS - 1e-9 && e.joint.startsWith(side) && e.realizedW > 0) posJ += e.realizedW * sim.dt;
  const release = sim.events.filter((e) => e.type === 'braceRelease' && e.playerId === pid).map((e) => e.data as { arm: string; tS: number; loadedS: number });
  sim.dispose();
  return { contactS, steps, posJ, release };
}

describe('contact motion M4: a landed palm bears load (FALL_REACT_V2)', () => {
  it('the profile is FALL_REACT_V1 with `brace.load`: the gains\' damping (scale 1) from the floor contact, let go after 50 ms off the floor', () => {
    const { id, brace, ...rest } = FALL_REACT_V2;
    const { id: id1, brace: brace1, ...rest1 } = FALL_REACT_V1;
    expect([id, id1]).toEqual(['fall-react-v2', 'fall-react-v1']);
    expect(rest).toEqual(rest1);
    expect(brace).toEqual({ ...brace1, load: { dampScale: 1, releaseS: 0.05 } });
  });

  // L3-F9-convert-free: the carrier, a ragdoll from 0.658 s, lands his free left palm at 0.6625 s, the body coming down
  // on it; the palm and forearm leave the floor at 0.6708 s for 54 ms (the elbow folding under him), then touch on and off
  it('a landed brace bears load and lets go when unloaded: from the carrier\'s palm landing (L3-F9-convert-free) every command on that arm opposes its joint\'s motion and the arm gives back no work while loaded, and it goes passive once neither palm nor forearm has touched the floor for 50 ms (at 0.725 s). The fault twins: FALL_REACT_V1 (the pose at contact held on springs) pushes along the joints\' motion, gives back over 5 J and never lets go before its window ends; with no release time the arm lets go at the first substep off the floor', async () => {
    const d = FIX('L3-F9-convert-free');
    const v2 = await landed(reacting(d, FALL_REACT_V2), 1.6, 'R', 'left');
    expect(v2.contactS).toBeCloseTo(0.6625, 4);
    expect(v2.steps.every((s) => s.opposed)).toBe(true);
    expect(v2.posJ).toBeLessThan(0.5);
    expect(v2.release).toHaveLength(1);
    const rel = v2.release[0];
    expect(rel.tS - rel.loadedS).toBeGreaterThan(FALL_REACT_V2.brace.load!.releaseS);
    const firstOff = v2.steps.find((s) => !s.onFloor)!.t;
    const passiveAt = v2.steps.find((s) => s.task === 'passive')!.t;
    expect(passiveAt - firstOff).toBeGreaterThanOrEqual(FALL_REACT_V2.brace.load!.releaseS - 1e-9);
    expect(v2.steps.filter((s) => s.t >= passiveAt).every((s) => s.task === 'passive')).toBe(true);
    const v1 = await landed(reacting(d, FALL_REACT_V1), 1.6, 'R', 'left');
    expect(v1.contactS).toBeCloseTo(0.6625, 4);
    expect(v1.steps.filter((s) => !s.opposed).length).toBeGreaterThan(10);
    expect(v1.posJ).toBeGreaterThan(5);
    expect(v1.release).toEqual([]);
    expect(v1.steps.find((s) => s.task === 'passive')!.t).toBeGreaterThan(FALL_REACT_V1.timing.fadeStartS);
    const now = await landed(reacting(d, { ...FALL_REACT_V2, id: 'fall-react-v2-no-hysteresis', brace: { ...FALL_REACT_V2.brace, load: { ...FALL_REACT_V2.brace.load!, releaseS: 0 } } }), 1.6, 'R', 'left');
    const nowOff = now.steps.find((s) => !s.onFloor)!.t;
    expect(now.steps.find((s) => s.task === 'passive')!.t - nowOff).toBeLessThan(0.01);
  }, 120000);
});
