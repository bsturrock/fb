// Contact motion polish 4, the hit's aim (WRAP_V13: WRAP_V12 with `hit.aim`, src/sim/controllers/wrap.ts `WrapHitAim`;
// registered on L3, L4 and HC since the aim flip, lab `wrap=v12` the view before): a hit on a carrier crossing the approach turns the tackler's line, at his own
// speed, so that his striking shoulder meets the carrier's core led `aheadM` along the carrier's travel; the heading held
// once the contact is `holdS` away. Constructed runs from the start on the fast side wrap (`L3-F4-twoArm`, which asks for
// the hit), to a little after contact. The first contact is read in the runner's frame: the azimuth off his facing of the
// deepest point between the two (from his torso's centre, positive toward the tackler's side), and the tackler's part.
// Each case has its fault twin: the aim's turn off (`hitNoAim`: the strike's steer, V12's), the lead off (`aheadM` 0), the
// turn added without keeping his speed (`hitAimAdd`), the hold off (`holdS` 0), the aim absent.
import { describe, expect, it } from 'vitest';
import { WRAP_V12, WRAP_V12_AUTO, WRAP_V13, WRAP_V13_AUTO, type WrapDebug, type WrapProfile, type WrapSpec } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { add, cross, dot, horiz, len, norm, qRot, sub, v3, vc, type Vec3 } from '../src/sim/vec';
import { create, FIX } from './helpers';

const FAST = 'L3-F4-twoArm';
const FRONT = 'L3-F19-front';

interface AimRun {
  kind: string | null;
  intents: string[];
  /** First body contact: time, the deepest point's azimuth off the runner's facing (deg, + toward the tackler) and the tackler's collider region there. */
  contactT: number | null;
  az: number | null;
  part: string | null;
  /** Over the first 0.1 s of contact: the normal impulse the tackler's head takes, and in all (N s). */
  headJ: number;
  allJ: number;
  /** Before first contact, while the strike is on: the request's speed off the approach's, worst either way (m/s). */
  speedOff: number;
  /** In the last 0.08 s before first contact: the largest turn of the requested heading from one decision to the next (deg). */
  lastTurnDeg: number;
}

const UP = v3(0, 1, 0);

async function aimRun(def: FixtureDef, wrap: WrapProfile, o: { faults?: WrapDebug; untilS?: number } = {}): Promise<AimRun> {
  let hook: (() => void) | null = null;
  const sim = await create({ ...def, wrap }, { onSubstep: () => hook?.(), ...(o.faults ? { debug: { wrap: o.faults } } : {}) });
  const D = sim.players.find((p) => p.setup.controller.kind === 'wrapAttempt')!;
  const R = sim.players.find((p) => p.id === sim.def.focus![D.id])!;
  const spec = D.setup.controller as WrapSpec;
  const approach = Math.min(len(horiz(spec.approachVelocityWorld!)), D.motor.maximumRequestedSpeedMps);
  const out: AimRun = { kind: null, intents: [], contactT: null, az: null, part: null, headJ: 0, allJ: 0, speedOff: 0, lastTurnDeg: 0 };
  const heads: { t: number; v: Vec3 }[] = [];
  hook = () => {
    if (D.rag || D.controlMode !== 'supported') return;
    const it = D.intent;
    const dbg = it.debug as { strike?: { on: boolean; tackle?: string } } | undefined;
    out.intents.push(JSON.stringify({ ...it, debug: undefined }));
    if (dbg?.strike?.tackle) out.kind = dbg.strike.tackle;
    const touching = (sim.contactObs[D.id] ?? []).some((c) => c.other === R.id);
    const req = horiz(it.locomotion.desiredVelocityWorld);
    if (out.contactT === null && !touching) {
      if (dbg?.strike?.on) out.speedOff = Math.max(out.speedOff, Math.abs(len(req) - approach));
      heads.push({ t: sim.t, v: req });
    }
    if (out.contactT === null && touching) {
      out.contactT = sim.t;
      const fwd = norm(horiz(qRot(R.proxy.body.rotation(), v3(0, 0, 1))), v3(1, 0, 0));
      const left = norm(cross(UP, fwd));
      const torso = add(vc(R.proxy.body.translation()), qRot(R.proxy.body.rotation(), R.body.compound.torso.center));
      const dSide = Math.sign(dot(sub(vc(D.proxy.body.translation()), torso), left)) || 1;
      let best: { pt: Vec3; dist: number; region: string } | null = null;
      for (const c of sim.contacts) {
        const dA = c.a.playerId === D.id && c.b.playerId === R.id;
        if (!dA && !(c.b.playerId === D.id && c.a.playerId === R.id)) continue;
        for (const p of c.points) if (!best || p.dist < best.dist) best = { pt: p.pointWorld, dist: p.dist, region: (dA ? c.a : c.b).region };
      }
      if (best) {
        const r = horiz(sub(best.pt, torso));
        out.az = (Math.atan2(dot(r, left) * dSide, dot(r, fwd)) * 180) / Math.PI;
        out.part = best.region;
      }
      // (the hold begins on the estimate gap / closing speed, which the strike's pitch shortens: about 0.09 s out here)
      const last = heads.filter((h) => h.t >= sim.t - 0.08 - 1e-9);
      for (let i = 1; i < last.length; i++) {
        const a = norm(last[i - 1]!.v), b = norm(last[i]!.v);
        out.lastTurnDeg = Math.max(out.lastTurnDeg, (Math.atan2(len(cross(a, b)), dot(a, b)) * 180) / Math.PI);
      }
    }
    if (out.contactT !== null && sim.t - out.contactT <= 0.1 + 1e-9) {
      for (const c of sim.contacts) {
        const dA = c.a.playerId === D.id && c.b.playerId === R.id;
        if (!dA && !(c.b.playerId === D.id && c.a.playerId === R.id)) continue;
        const own = dA ? c.a : c.b;
        for (const p of c.points) {
          if (!(p.impulse > 0)) continue;
          out.allJ += p.impulse;
          if (own.region === 'head' || own.region === 'neck') out.headJ += p.impulse;
        }
      }
    }
  };
  while (!sim.done && sim.t < (o.untilS ?? Infinity)) sim.stepTick();
  sim.dispose();
  return out;
}

const withAim = (aim: Partial<NonNullable<NonNullable<WrapProfile['hit']>['aim']>>, tag: string): WrapProfile => ({ ...WRAP_V13, id: `${WRAP_V13.id}-${tag}`, hit: { ...WRAP_V13.hit!, aim: { ...WRAP_V13.hit!.aim!, ...aim } } });
const asking = (def: FixtureDef, tackle: WrapSpec['tackle']): FixtureDef => ({ ...def, players: def.players.map((p) => (p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, tackle } } : p)) });

describe('contact motion polish 4: the hit\'s aim (WRAP_V13)', () => {
  it('the aim flip: every L3, L4 and HC wrap fixture registers WRAP_V13, none WRAP_V13_AUTO (the speed rule, lab only) or WRAP_V12; each is its V12 profile with the aim', async () => {
    const { allFixtures } = await import('../src/sim/fixtures/index');
    const all = allFixtures();
    expect(all.filter((d) => d.wrap && d.wrap.id !== WRAP_V13.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.id === WRAP_V13.id).length).toBeGreaterThan(0);
    expect(all.filter((d) => d.wrap?.id === WRAP_V13_AUTO.id || d.wrap?.id === WRAP_V12.id).map((d) => d.id)).toEqual([]);
    expect(WRAP_V12.hit!.aim).toBeUndefined();
    expect({ ...WRAP_V13, id: WRAP_V12.id, hit: { ...WRAP_V13.hit!, aim: undefined } }).toEqual({ ...WRAP_V12, hit: { ...WRAP_V12.hit!, aim: undefined } });
    expect(WRAP_V13_AUTO.hit).toEqual({ ...WRAP_V13.hit, minCloseMps: 6 });
  });

  it('with the aim the hit\'s first contact is on the runner\'s front side (20 to 70 deg off his facing, toward the tackler), the tackler\'s trunk on him and his head out of the first 0.1 s; its twin (the aim\'s turn off: the strike\'s steer) meets him behind his shoulder line', async () => {
    const aim = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.6 });
    expect(aim.kind).toBe('hit');
    expect(aim.az!).toBeGreaterThan(20);
    expect(aim.az!).toBeLessThan(70);
    expect(aim.part).toBe('torso');
    expect(aim.allJ).toBeGreaterThan(100);
    expect(aim.headJ).toBeLessThan(0.15 * aim.allJ);
    const twin = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.6, faults: { hitNoAim: true } });
    expect(twin.az!).toBeGreaterThan(90);
  });

  it('the lead moves the first contact toward his front; its twin (no lead) meets him further back', async () => {
    const lead = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.6 });
    const twin = await aimRun(FIX(FAST), withAim({ aheadM: 0 }, 'ahead0'), { untilS: 0.6 });
    expect(twin.az! - lead.az!).toBeGreaterThan(5);
  });

  it('the aim turns his line only: his speed request is his approach\'s up to contact; its twin (the turn added without keeping his speed) speeds him up', async () => {
    const aim = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.6 });
    expect(aim.contactT).not.toBeNull();
    expect(aim.speedOff).toBeLessThan(1e-9);
    const v12 = await aimRun(FIX(FAST), WRAP_V12, { untilS: 0.6 });
    expect(aim.intents).not.toEqual(v12.intents);
    const twin = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.6, faults: { hitAimAdd: true } });
    expect(twin.speedOff).toBeGreaterThan(0.005);
  });

  it('the heading is held from about 0.1 s before contact (no swerve into it); its twin (no hold) keeps turning', async () => {
    const aim = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.6 });
    expect(aim.lastTurnDeg).toBeLessThan(1e-9);
    const twin = await aimRun(FIX(FAST), withAim({ holdS: 0 }, 'hold0'), { untilS: 0.6 });
    expect(twin.lastTurnDeg).toBeGreaterThan(1e-3);
  });

  it('the profile without the aim is WRAP_V12 on the hit; its twin (with it) is not', async () => {
    const v12 = await aimRun(FIX(FAST), WRAP_V12, { untilS: 0.9 });
    const none = await aimRun(FIX(FAST), { ...WRAP_V13, id: `${WRAP_V13.id}-noaim`, hit: { ...WRAP_V13.hit!, aim: undefined } }, { untilS: 0.9 });
    expect(none.kind).toBe('hit');
    expect(none.intents.length).toBeGreaterThan(100);
    expect(none.intents).toEqual(v12.intents);
    const v13 = await aimRun(FIX(FAST), WRAP_V13, { untilS: 0.9 });
    expect(v13.intents).not.toEqual(v12.intents);
  });

  it('a wrap is V12\'s exactly under V13 (the fast side wrap asking to wrap), and so is a hit with no crossing motion (head-on, under the speed rule); its twin (the crossing hit) is not', async () => {
    const wrapV12 = await aimRun(asking(FIX(FAST), 'wrap'), WRAP_V12, { untilS: 0.9 });
    const wrapV13 = await aimRun(asking(FIX(FAST), 'wrap'), WRAP_V13, { untilS: 0.9 });
    expect(wrapV13.kind).toBe('wrap');
    expect(wrapV13.intents).toEqual(wrapV12.intents);
    const frontV12 = await aimRun(FIX(FRONT), WRAP_V12_AUTO, { untilS: 0.9 });
    const frontV13 = await aimRun(FIX(FRONT), WRAP_V13_AUTO, { untilS: 0.9 });
    expect(frontV13.kind).toBe('hit');
    expect(frontV13.intents.length).toBeGreaterThan(100);
    expect(frontV13.intents).toEqual(frontV12.intents);
    const twinV12 = await aimRun(asking(FIX(FAST), undefined), WRAP_V12_AUTO, { untilS: 0.9 });
    const twinV13 = await aimRun(asking(FIX(FAST), undefined), WRAP_V13_AUTO, { untilS: 0.9 });
    expect(twinV13.kind).toBe('hit');
    expect(twinV13.intents).not.toEqual(twinV12.intents);
  });
});
