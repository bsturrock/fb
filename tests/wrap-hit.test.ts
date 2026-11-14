// Contact motion polish 4, the hit (WRAP_V12: WRAP_V11 with `hit`, src/sim/controllers/wrap.ts `WrapHit`; the tackler's
// request `WrapSpec.tackle`): the tackle's kind is decided once as the strike starts, a hit at `minCloseMps` of closing
// speed or more (a placeholder until game context asks), else a wrap exactly as before; a hit strikes with the shoulder,
// the head behind the runner's travel, the arms tucked and never closing, through the contact at his own approach speed.
// No fixture uses it. Constructed runs from the start (the fast side wrap closes at 8.1 m/s as the strike starts, the
// drag at 5.0, the front hold at 1.2; tests run them to a little after contact). Each case has its fault twin: the wrap's
// arms, the strike's side rule or the wrap's steer on a hit (`WrapDebug`), the threshold changed, the request absent.
import { describe, expect, it } from 'vitest';
import { WRAP_V11, WRAP_V12, type WrapDebug, type WrapProfile, type WrapSpec } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { add, dot, horiz, len, qRot, sub, vc, type Vec3 } from '../src/sim/vec';
import { create, FIX } from './helpers';

const FAST = 'L3-F4-twoArm';
const SLOW = 'L3-F5-drag';
const HOLD = 'L3-F10-both';

interface HitRun {
  /** The kind the controller decided (its strike debug), and the closing speed on the runner as the strike started. */
  kind: string | null;
  /** Each supported substep's intent without its debug (JSON), for identity with another run. */
  intents: string[];
  /** Any arm intent that closes or pulls, any clamp or grip of the tackler, his `ride` or `leaveSupport` seen. */
  closed: boolean;
  held: boolean;
  rode: boolean;
  left: boolean;
  /** The head's side asked (strike debug, world: side x head) against the runner's velocity as the strike started. */
  headAlongRunner: number | null;
  /** At first body contact: the tackler's head centre along the runner's travel from his core (m; < 0 behind him). */
  headAtContact: number | null;
  /** Before first body contact, the worst shortfall of the velocity request's speed from the approach's (m/s). */
  slowest: number;
  contactT: number | null;
}

function withSpec(def: FixtureDef, tackle: WrapSpec['tackle']): FixtureDef {
  return { ...def, players: def.players.map((p) => (p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, tackle } } : p)) };
}

async function hitRun(def: FixtureDef, wrap: WrapProfile, o: { faults?: WrapDebug; untilS?: number } = {}): Promise<HitRun> {
  let hook: (() => void) | null = null;
  const sim = await create({ ...def, wrap }, { onSubstep: () => hook?.(), ...(o.faults ? { debug: { wrap: o.faults } } : {}) });
  const D = sim.players.find((p) => p.setup.controller.kind === 'wrapAttempt')!;
  const R = sim.players.find((p) => p.id === sim.def.focus![D.id])!;
  const spec = D.setup.controller as WrapSpec;
  const approach = spec.approachVelocityWorld ? Math.min(len(horiz(spec.approachVelocityWorld)), D.motor.maximumRequestedSpeedMps) : null;
  const out: HitRun = { kind: null, intents: [], closed: false, held: false, rode: false, left: false, headAlongRunner: null, headAtContact: null, slowest: 0, contactT: null };
  hook = () => {
    if (D.rag || D.controlMode !== 'supported') return;
    const it = D.intent;
    const dbg = it.debug as { strike?: { on: boolean; head: number; tackle?: string }; side?: Vec3 } | undefined;
    out.intents.push(JSON.stringify({ ...it, debug: undefined }));
    if (dbg?.strike?.tackle) out.kind = dbg.strike.tackle;
    if (Object.values(it.arms ?? {}).some((a) => a?.action === 'close' || a?.action === 'pull')) out.closed = true;
    if (it.ride) out.rode = true;
    if (it.leaveSupport) out.left = true;
    if (R.rag) return;
    const vR = horiz(vc(R.proxy.body.linvel()));
    if (out.headAlongRunner === null && dbg?.strike?.on && dbg.side) out.headAlongRunner = dot(vR, dbg.side) * dbg.strike.head;
    const touching = (sim.contactObs[D.id] ?? []).some((c) => c.other === R.id);
    if (out.contactT === null && touching) {
      out.contactT = sim.t;
      const head = add(vc(D.proxy.body.translation()), qRot(D.proxy.body.rotation(), D.body.compound.head.center));
      out.headAtContact = dot(sub(head, vc(R.proxy.body.translation())), len(vR) > 1e-6 ? { x: vR.x / len(vR), y: 0, z: vR.z / len(vR) } : { x: 1, y: 0, z: 0 });
    }
    if (out.contactT === null && approach !== null && dbg?.strike?.on) out.slowest = Math.max(out.slowest, approach - len(horiz(it.locomotion.desiredVelocityWorld)));
  };
  while (!sim.done && sim.t < (o.untilS ?? Infinity)) sim.stepTick();
  out.held = sim.events.some((e) => e.playerId === D.id && (e.type === 'clampBegin' || e.type === 'gripBegin'));
  sim.dispose();
  return out;
}

describe('contact motion polish 4: the hit (WRAP_V12)', () => {
  it('no fixture registers WRAP_V12', async () => {
    const { allFixtures } = await import('../src/sim/fixtures/index');
    expect(allFixtures().filter((d) => d.wrap?.id === WRAP_V12.id).map((d) => d.id)).toEqual([]);
  });

  it('above the threshold the tackle is a hit: no arm closes, nothing clamps or grips, no ride and no takedown; its twin (the wrap arms on a hit) closes and clamps', async () => {
    const hit = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.9 });
    expect(hit.kind).toBe('hit');
    expect(hit.contactT).not.toBeNull();
    expect([hit.closed, hit.held, hit.rode, hit.left]).toEqual([false, false, false, false]);
    const twin = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.9, faults: { hitWrapArms: true } });
    expect(twin.kind).toBe('hit');
    expect(twin.closed).toBe(true);
    expect(twin.held).toBe(true);
  });

  it('below the threshold the request is WRAP_V11\'s exactly (the drag, 5.0 m/s); its twin (the threshold under it) makes it a hit and changes it', async () => {
    const v11 = await hitRun(FIX(SLOW), WRAP_V11, { untilS: 1.0 });
    const v12 = await hitRun(FIX(SLOW), WRAP_V12, { untilS: 1.0 });
    expect(v12.kind).toBe('wrap');
    expect(v12.closed).toBe(true);
    expect(v12.intents.length).toBeGreaterThan(100);
    expect(v12.intents).toEqual(v11.intents);
    const low: WrapProfile = { ...WRAP_V12, id: `${WRAP_V12.id}-min4`, hit: { ...WRAP_V12.hit!, minCloseMps: 4 } };
    const twin = await hitRun(FIX(SLOW), low, { untilS: 1.0 });
    expect(twin.kind).toBe('hit');
    expect(twin.intents).not.toEqual(v11.intents);
  });

  it('a hit puts the head behind the runner\'s travel (asked and at contact); its twin (the strike\'s side rule) takes the default side, across his front', async () => {
    const hit = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.6 });
    expect(hit.headAlongRunner!).toBeLessThan(-1);
    expect(hit.headAtContact!).toBeLessThan(0);
    const twin = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.6, faults: { hitStrikeSide: true } });
    expect(twin.headAlongRunner!).toBeGreaterThan(1);
    expect(twin.headAtContact!).toBeGreaterThan(0.1);
  });

  it('a hit asks for his approach speed up to contact (the steer only turns his line); its twin (the wrap\'s steer) slows him', async () => {
    const hit = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.6 });
    expect(hit.contactT).not.toBeNull();
    expect(hit.slowest).toBeLessThan(1e-9);
    const twin = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.6, faults: { hitAddSteer: true } });
    expect(twin.slowest).toBeGreaterThan(0.3);
  });

  it('the profile without `hit` is WRAP_V11 on the fast side wrap; its twin (with it) is not', async () => {
    const v11 = await hitRun(FIX(FAST), WRAP_V11, { untilS: 0.9 });
    const { hit: _h, ...rest } = WRAP_V12;
    void _h;
    const none = await hitRun(FIX(FAST), { ...rest, id: `${WRAP_V12.id}-nohit` }, { untilS: 0.9 });
    expect(none.kind).toBeNull();
    expect(none.intents).toEqual(v11.intents);
    const v12 = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.9 });
    expect(v12.intents).not.toEqual(v11.intents);
  });

  it('the tackler\'s request overrides the speed rule: a slow approach asked to hit hits; its twin (no request) wraps', async () => {
    const asked = await hitRun(withSpec(FIX(HOLD), 'hit'), WRAP_V12, { untilS: 0.8 });
    expect(asked.kind).toBe('hit');
    expect([asked.closed, asked.held, asked.rode, asked.left]).toEqual([false, false, false, false]);
    const twin = await hitRun(FIX(HOLD), WRAP_V12, { untilS: 0.8 });
    expect(twin.kind).toBe('wrap');
    expect(twin.closed).toBe(true);
    expect(twin.held).toBe(true);
  });

  it('the tackler\'s request overrides the speed rule: a fast approach asked to wrap wraps as WRAP_V11; its twin (no request) hits', async () => {
    const v11 = await hitRun(FIX(FAST), WRAP_V11, { untilS: 0.9 });
    const asked = await hitRun(withSpec(FIX(FAST), 'wrap'), WRAP_V12, { untilS: 0.9 });
    expect(asked.kind).toBe('wrap');
    expect(asked.intents).toEqual(v11.intents);
    const twin = await hitRun(FIX(FAST), WRAP_V12, { untilS: 0.9 });
    expect(twin.kind).toBe('hit');
    expect(twin.intents).not.toEqual(v11.intents);
  });
});
