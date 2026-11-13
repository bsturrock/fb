// Contact motion polish 1.2: the tackler's drive (WRAP_V5, `WrapProfile.drive`, src/sim/controllers/wrap.ts; the hold
// carried through his own loss, src/sim/conversion.ts). Measured on the front, rear and side wraps and the dragged
// defender, run with the profile; each case has its fault twin: the same run with the rule it checks broken
// (`SimDebug.wrap`) fails for that reason.
import { describe, expect, it } from 'vitest';
import { WRAP_V5, type WrapDebug } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { Simulation } from '../src/sim/simulation';
import { deg, dot, horiz, norm, sub, upOf, vc } from '../src/sim/vec';
import { FIX } from './helpers';

const drive = (id: string, o: Partial<FixtureDef> = {}): FixtureDef => ({ ...FIX(id), wrap: WRAP_V5, ...o });
const DV = WRAP_V5.drive!;
const SUB = 1 / 240;

interface DriveRun {
  /** First substep the defender drives (his controller's drive phase, `debug.drive`), the first after it without one, and the exit that ended it. */
  driveS: number | null;
  driveEndS: number | null;
  exit: string | null;
  /** The drive's time at its exit (s), and the carrier's lean then (deg). */
  exitAfterS: number | null;
  exitLeanDeg: number | null;
  /** While he drives on his feet: the mean drive force along the line to the carrier (N), his planner steps, his least trunk pitch (deg). */
  meanForceN: number;
  steps: number;
  minPitchDeg: number;
  /** Support loss of each player (time, reason). */
  loss: Record<'D' | 'R', { t: number; why: string } | null>;
  /** The defender's fall response: its arm tasks at its start. */
  fallTasks: string[] | null;
}

async function driveRun(def: FixtureDef, untilS: number, fault?: WrapDebug): Promise<DriveRun> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.(), ...(fault ? { debug: { wrap: fault } } : {}) });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const out: DriveRun = { driveS: null, driveEndS: null, exit: null, exitAfterS: null, exitLeanDeg: null, meanForceN: 0, steps: 0, minPitchDeg: Infinity, loss: { D: null, R: null }, fallTasks: null };
  let fSum = 0;
  let n = 0;
  let ev = 0;
  probe = () => {
    for (const id of ['D', 'R'] as const) {
      const pl = id === 'D' ? D : R;
      if (out.loss[id] === null && pl.controlMode !== 'supported') out.loss[id] = { t: sim.t, why: String(pl.handoff?.reason) };
    }
    const fe = sim.events.find((e) => e.type === 'fallResponse' && e.playerId === 'D');
    if (fe && out.fallTasks === null) {
      const ep = (sim as unknown as { fall: { episodes: Map<string, { arms: Record<string, { task: string }> }> } }).fall.episodes.get('D');
      out.fallTasks = ep ? [ep.arms.left!.task, ep.arms.right!.task] : [];
    }
    const dv = D.rag || D.controlMode !== 'supported' ? undefined : (D.intent.debug as { drive?: { s: number; leanDeg: number; exit: string | null; driving: boolean } } | undefined)?.drive;
    const driving = !!dv?.driving && out.exit === null;
    if (dv && out.driveS === null) out.driveS = sim.t;
    if (!dv && out.driveS !== null && out.driveEndS === null && D.controlMode === 'supported') out.driveEndS = sim.t;
    for (; ev < sim.events.length; ev++) if (driving && sim.events[ev]!.type === 'footSwing' && sim.events[ev]!.playerId === 'D') out.steps++;
    if (dv?.exit && out.exit === null) {
      out.exit = dv.exit;
      out.exitAfterS = dv.s;
      out.exitLeanDeg = dv.leanDeg;
    }
    if (driving) {
      const d = norm(horiz(sub(vc(R.rag ? R.rag.bodies.core.translation() : R.proxy.body.translation()), vc(D.proxy.body.translation()))));
      fSum += dot(D.applied.drive, d);
      n++;
      out.minPitchDeg = Math.min(out.minPitchDeg, deg(Math.acos(Math.min(1, upOf(D.proxy.body.rotation()).y))));
    }
  };
  while (!sim.done && sim.t < untilS - 1e-9) sim.stepTick();
  out.meanForceN = n ? fSum / n : 0;
  sim.dispose();
  return out;
}

describe('contact motion polish 1.2: the drive (WRAP_V5)', () => {
  it('stays on his feet and drives through the carrier: on the rear wrap he drives over a second on his feet, his drive force along the line to the carrier over 400 N on average, stepping, the trunk pitched past 25 deg (the strike\'s posture kept), and takes him down with him. The fault twin: a limp drive (no extra speed, effort 0) pushes nothing', async () => {
    const r = await driveRun(drive('L3-F19-rear'), 2.5);
    expect(r.driveS, JSON.stringify(r)).not.toBeNull();
    expect(r.exitAfterS!, JSON.stringify(r)).toBeGreaterThan(1);
    expect(r.meanForceN, JSON.stringify(r)).toBeGreaterThan(400);
    expect(r.steps, JSON.stringify(r)).toBeGreaterThanOrEqual(2);
    expect(r.minPitchDeg, JSON.stringify(r)).toBeGreaterThan(25);
    expect(r.loss.D?.why, JSON.stringify(r)).toBe('takedown');
    const limp = await driveRun(drive('L3-F19-rear'), 2.5, { driveLimp: true });
    expect(limp.driveS, JSON.stringify(limp)).not.toBeNull();
    expect(limp.meanForceN, JSON.stringify(limp)).toBeLessThan(50);
  }, 60000);

  it('leaves his feet only for a reason: with the front wrap\'s carrier going over (lean past 30 deg) he goes with him at once (exit b), and so with the rear wrap\'s, pushed over forward after more than the stall time (his lean growing); with the side wrap\'s carrier already down when the hold is secure, at once (exit a); with no carrier counting as going over (constructed: a progress rule nothing meets) the rear wrap\'s drive takes his weight at the stall time (exit d). The fault twins: not following, the front wrap\'s defender is still up 0.3 s after his carrier is down; with no stall, the constructed drive goes on past the stall time and its limit is not what ends it', async () => {
    const front = await driveRun(drive('L3-F19-front'), 1.5);
    expect(front.exit, JSON.stringify(front)).toBe('b');
    expect(front.exitLeanDeg!, JSON.stringify(front)).toBeGreaterThanOrEqual(DV.goLeanDeg);
    expect(front.loss.D?.why, JSON.stringify(front)).toBe('takedown');
    expect(front.loss.D!.t - front.loss.R!.t, JSON.stringify(front)).toBeLessThan(0.05);
    const rear = await driveRun(drive('L3-F19-rear'), 2.5);
    expect(rear.exit, JSON.stringify(rear)).toBe('b');
    expect(rear.exitAfterS!, JSON.stringify(rear)).toBeGreaterThan(DV.stallS);
    expect(rear.loss.R, JSON.stringify(rear)).not.toBeNull();
    expect(Math.abs(rear.loss.D!.t - rear.loss.R!.t), JSON.stringify(rear)).toBeLessThan(0.05);
    const side = await driveRun(drive('L3-F4-twoArm'), 1.2);
    expect(side.exit, JSON.stringify(side)).toBe('a');
    expect(side.exitAfterS, JSON.stringify(side)).toBe(0);
    expect(side.loss.D?.why, JSON.stringify(side)).toBe('takedown');
    expect(side.loss.D!.t - side.driveS!, JSON.stringify(side)).toBeLessThanOrEqual(2 * SUB + 1e-6);
    const stay = await driveRun(drive('L3-F19-front'), 1.5, { noFollow: true });
    expect(stay.loss.R, JSON.stringify(stay)).not.toBeNull();
    expect(stay.loss.D === null || stay.loss.D.t - stay.loss.R!.t > 0.3, JSON.stringify(stay)).toBe(true);
    const still = drive('L3-F19-rear', { wrap: { ...WRAP_V5, drive: { ...DV, progress: { ...DV.progress, leanDeg: 90, riseDeg: 90 } } } });
    const stall = await driveRun(still, 2.5);
    expect(stall.exit, JSON.stringify(stall)).toBe('d');
    expect(stall.exitAfterS!, JSON.stringify(stall)).toBeGreaterThanOrEqual(DV.stallS - SUB);
    expect(stall.exitAfterS!, JSON.stringify(stall)).toBeLessThanOrEqual(DV.stallS + SUB);
    expect(stall.loss.D?.why, JSON.stringify(stall)).toBe('takedown');
    const noStall = await driveRun(still, 2.5, { noStall: true });
    expect(noStall.exit, JSON.stringify(noStall)).not.toBe('d');
    expect(noStall.exitAfterS ?? Infinity, JSON.stringify(noStall)).toBeGreaterThan(DV.stallS + 0.1);
  }, 90000);

  it('keeps his hold through his own loss: the dragged defender (L3-F5-drag without a fall response of its own, so only the takedown\'s hold) loses his support driving and his holding arm keeps its hold on his ragdoll. The fault twin: with the loss not carried he starts no response and lets go', async () => {
    const def = drive('L3-F5-drag', { fallResponse: undefined });
    const r = await driveRun(def, 1.2);
    expect(r.driveS, JSON.stringify(r)).not.toBeNull();
    expect(r.loss.D?.why, JSON.stringify(r)).toBe('lossOfSupport');
    expect(r.fallTasks, JSON.stringify(r)).toContain('hold');
    const twin = await driveRun(def, 1.2, { noLossHold: true });
    expect(twin.loss.D?.why, JSON.stringify(twin)).toBe('lossOfSupport');
    expect(twin.fallTasks, JSON.stringify(twin)).toBeNull();
  }, 60000);

  it('a hold lost during the drive ends it: the rear wrap\'s arms let go 0.3 s into the drive, the drive ends within the hold\'s grace and he never takes the carrier down. The fault twin: a hold that never starts over (graceS without end) drives on and takes him down', async () => {
    const base = await driveRun(drive('L3-F19-rear'), 1.5);
    const off = base.driveS! + 0.3;
    const offDef = (w = WRAP_V5): FixtureDef => {
      const d = drive('L3-F19-rear', { wrap: w });
      return { ...d, players: d.players.map((p) => (p.id === 'D' && p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, armsOffAfterS: off } } : p)) };
    };
    const broken = await driveRun(offDef(), 2.5);
    expect(broken.exit, JSON.stringify(broken)).toBeNull();
    expect(broken.driveEndS! - off, JSON.stringify(broken)).toBeLessThanOrEqual(WRAP_V5.commit!.graceS + 3 * SUB + 1e-6);
    expect(broken.loss.D?.why ?? null, JSON.stringify(broken)).not.toBe('takedown');
    const twin = await driveRun(offDef({ ...WRAP_V5, commit: { ...WRAP_V5.commit!, graceS: Infinity } }), 2.5);
    expect(twin.driveEndS, JSON.stringify(twin)).toBeNull();
    expect(twin.loss.D?.why, JSON.stringify(twin)).toBe('takedown');
  }, 60000);
});
