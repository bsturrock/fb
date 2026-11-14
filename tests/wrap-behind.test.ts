// Contact motion polish 2.2, the drive from behind (WRAP_V10: WRAP_V9 with `drive.behind`, src/sim/controllers/wrap.ts
// `WrapBehind`; registered on L3, L4 and HC since the behind flip). Each case resumes a state capture taken under WRAP_V9 (then registered) shortly before
// the tackler's secure hold (the rear wrap at 0.70 s, its hold secure at 0.74; the front wrap at 0.55 s, 0.62; the drag
// mirror at 0.50 s, 0.58) under WRAP_V10 or a variant of it, and reads every decision of the tackler's controller: what
// it observed and what it asked for. Each has its fault twin through the controller's fault object (`WrapDebug.behind*`,
// set on the resumed controller: given at the resume it would be a field the capture lacks), and (iii) the flag itself.
import { describe, expect, it } from 'vitest';
import { WRAP_V10, WRAP_V9, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { ControllerContext } from '../src/sim/controllers/base';
import type { PlayerIntent } from '../src/sim/contracts';
import { addScaled, dot, horiz, len, norm, scale, sub, type Vec3 } from '../src/sim/vec';
import { asCaptured, evs, pace } from './helpers';
import { loadState, resumeState } from './state';

const REAR = 'tests/data/state/L3-F19-rear@42.json.gz';
const FRONT = 'tests/data/state/L3-F19-front@33.json.gz';
const MIRROR = 'tests/data/state/L3-F5-dragMirror@30.json.gz';
const BH = WRAP_V10.drive!.behind!;
/** WRAP_V10 without the weight commit (the anchor alone): its request can be read over a whole drive from behind. */
const { commitS: _commit, ...BH_ANCHOR } = BH;
const ANCHOR: WrapProfile = { ...WRAP_V10, id: 'wrap-behind-v10-anchor', drive: { ...WRAP_V10.drive!, behind: BH_ANCHOR } };

interface DriveDebug {
  s: number;
  exit: string | null;
  behind?: true;
}

/** One decision of the tackler on his feet: the carrier's observed velocity and support, the line, the request. */
interface Decision {
  t: number;
  vR: Vec3;
  rUp: boolean;
  line: Vec3;
  req: Vec3;
  finish: string;
  drive?: DriveDebug;
  leave: boolean;
}

interface Run {
  ds: Decision[];
  /** The tackler's conversion (time, reason) and his fall links begun on the carrier. */
  dSwitch: { t: number; why: string } | null;
  links: number;
  maxV: number;
}

async function decisions(capPath: string, wrap: WrapProfile, fault?: WrapDebug, untilS = 1.6): Promise<Run> {
  const cap = loadState(capPath);
  const def = asCaptured(cap, (d) => ({ ...d, wrap }), ['wrap']);
  const sim = await resumeState(cap, { def, variant: ['wrap'] });
  const D = sim.players.find((p) => p.id === 'D')!;
  const c = D.controller as unknown as { decide(ctx: ControllerContext): PlayerIntent; fault?: WrapDebug; motor: { maximumRequestedSpeedMps: number } };
  if (fault) c.fault = fault;
  const decide = c.decide.bind(c);
  const out: Run = { ds: [], dSwitch: null, links: 0, maxV: c.motor.maximumRequestedSpeedMps };
  c.decide = (ctx: ControllerContext): PlayerIntent => {
    const intent = decide(ctx);
    const me = ctx.observed.bodies[ctx.self]!;
    const tb = ctx.focus ? ctx.observed.bodies[ctx.focus] : undefined;
    if (tb && me.controlMode === 'supported') {
      const dbg = intent.debug as { finish: string; drive?: DriveDebug } | undefined;
      out.ds.push({ t: ctx.t, vR: horiz(tb.linearVelocity), rUp: tb.controlMode === 'supported', line: norm(horiz(sub(tb.position, me.position))), req: { ...intent.locomotion.desiredVelocityWorld }, finish: dbg?.finish ?? '', ...(dbg?.drive ? { drive: { ...dbg.drive } } : {}), leave: intent.leaveSupport === 'takedown' });
    }
    return intent;
  };
  while (!sim.done && sim.t < untilS - 1e-9) {
    sim.stepTick();
    if (D.handoff && !out.dSwitch) out.dSwitch = { t: D.handoff.t, why: String(D.handoff.reason) };
    await pace();
  }
  out.links = evs(sim, 'fallLinkBegin', 'D').filter((e) => e.data.ok && e.data.target === 'R').length;
  sim.dispose();
  return out;
}

/** The decisions of a drive from behind on a carrier still up. */
const behindUp = (r: Run): Decision[] => r.ds.filter((d) => d.drive?.behind && d.rUp);
/** The request's speed along the carrier's travel over his own speed (m/s). */
const over = (d: Decision): number => dot(d.req, norm(d.vR)) - len(d.vR);

describe('contact motion polish 2.2, the drive from behind (WRAP_V10)', () => {
  it('(i) a drive from behind never asks for more than the carrier\'s speed along his travel: on the rear wrap (the anchor alone, no weight commit) every decision of the drive from behind on a carrier still up, in every mode of it (the drive\'s own, the finish\'s between its secure holds), asks for the carrier\'s velocity less 2 m/s along his travel. The fault twin: with the push kept from behind it asks for more than a metre a second beyond his speed', async () => {
    const r = await decisions(REAR, ANCHOR);
    const up = behindUp(r);
    expect(up.length, `${r.ds.length} decisions`).toBeGreaterThan(10);
    for (const d of up) {
      expect(over(d), `t ${d.t} ${d.finish}`).toBeLessThanOrEqual(1e-9);
      const sp = len(d.vR);
      const want = scale(d.vR, Math.max(0, sp - BH.brakeMps) / sp);
      expect(len(sub(d.req, want)), `t ${d.t} ${d.finish}`).toBeLessThan(1e-9);
    }
    const twin = await decisions(REAR, ANCHOR, { behindPush: true });
    const tw = behindUp(twin);
    expect(tw.length).toBeGreaterThan(10);
    expect(Math.max(...tw.map(over))).toBeGreaterThan(1);
  });

  it('(ii) the weight commit: on the rear wrap the tackler commits his weight as the drive from behind begins (exit r at commitS, the carrier still up), the takedown converting him and his hold carried by a fall link; never on the front wrap or the drag mirror, whose lines lie off the carrier\'s travel (their every request as under WRAP_V9). The fault twins: with exit (r) off he is still on his feet 0.1 s into the drive; with the line test off the front wrap and the drag mirror commit too', async () => {
    const r = await decisions(REAR, WRAP_V10);
    const first = r.ds.find((d) => d.drive);
    expect(first?.drive?.behind, JSON.stringify(first)).toBe(true);
    const commit = r.ds.find((d) => d.drive?.exit === 'r');
    expect(commit, JSON.stringify(first)).toBeDefined();
    expect(commit!.drive!.s).toBeGreaterThanOrEqual(BH.commitS! - 1e-9);
    expect(commit!.drive!.s).toBeLessThan(BH.commitS! + 0.01);
    expect(commit!.rUp).toBe(true);
    expect(commit!.leave).toBe(true);
    expect(r.dSwitch?.why).toBe('takedown');
    expect(r.dSwitch!.t - commit!.t).toBeLessThan(0.01);
    expect(r.links).toBeGreaterThan(0);
    const held = await decisions(REAR, WRAP_V10, { behindNoCommit: true }, 1.0);
    const start = held.ds.find((d) => d.drive)!;
    expect(held.ds.some((d) => d.drive?.exit === 'r')).toBe(false);
    expect(held.dSwitch === null || held.dSwitch.t > start.t + 0.1, JSON.stringify(held.dSwitch)).toBe(true);
    for (const cap of [FRONT, MIRROR]) {
      const a = await decisions(cap, WRAP_V10);
      expect(a.ds.some((d) => d.drive), cap).toBe(true);
      expect(a.ds.some((d) => d.drive?.behind || d.drive?.exit === 'r'), cap).toBe(false);
      const b = await decisions(cap, WRAP_V9);
      expect(a.ds.map((d) => [d.t, d.req]), cap).toEqual(b.ds.map((d) => [d.t, d.req]));
      const any = await decisions(cap, WRAP_V10, { behindAnyLine: true });
      expect(any.ds.some((d) => d.drive?.exit === 'r'), cap).toBe(true);
    }
  });

  it('(iii) without the flag the drive asks for what it asked: under WRAP_V9 every decision of the rear wrap\'s drive on a carrier still up is the carrier\'s velocity plus 3 m/s along the line through him (within the request\'s speed limit), exactly. The twin: the same state with the flag (the anchor) fails it', async () => {
    const push = (r: Run, d: Decision): Vec3 => {
      const v = addScaled(d.vR, d.line, WRAP_V9.drive!.extraMps);
      return len(v) > r.maxV ? scale(v, r.maxV / len(v)) : v;
    };
    const r = await decisions(REAR, WRAP_V9);
    const drv = r.ds.filter((d) => d.finish === 'drive+' && d.rUp);
    expect(drv.length).toBeGreaterThan(30);
    for (const d of drv) expect(len(sub(d.req, push(r, d))), `t ${d.t}`).toBeLessThan(1e-9);
    const twin = await decisions(REAR, ANCHOR);
    const tw = twin.ds.filter((d) => d.finish === 'drive+' && d.rUp);
    expect(tw.length).toBeGreaterThan(0);
    expect(Math.max(...tw.map((d) => len(sub(d.req, push(twin, d)))))).toBeGreaterThan(1);
  });
});
