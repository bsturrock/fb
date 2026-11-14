// Contact motion polish 2.4, staying on from behind (WRAP_V11: WRAP_V10 with no brake and no weight commit from behind,
// and `WrapBind.behind`, src/sim/controllers/wrap.ts `WrapBindBehind`; the rule in `Simulation.boundLegs`, clause (c)):
// from behind the tackler stays posed on the runner at the runner's velocity, and a runner whose tackler's drive from
// behind is alive with an arm's clamp or grip on him for `confirmS` goes down. No fixture uses it. Cases (i)-(iii) are
// constructed runs from the start (the fault switches are simulation options); (iv) resumes the rear wrap's capture taken
// under WRAP_V9 shortly before the hold (tests/wrap-behind.test.ts) to read the controller's every request. Each has its
// fault twin: the profile without the field or with one of its numbers changed, or the rule's or the anchor's test broken
// (`WrapDebug`). (v) resumes the rear wrap's capture under WRAP_V11 just after the runner is bound, to watch the
// tackler's arms as the runner falls away; its twin is the profile without `WrapBehind.letGoM`.
import { describe, expect, it } from 'vitest';
import { WRAP_V10, WRAP_V11, WRAP_V6, type WrapBindBehind, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { ControllerContext } from '../src/sim/controllers/base';
import type { PlayerIntent } from '../src/sim/contracts';
import { dot, horiz, len, norm, sub, vc, type Vec3 } from '../src/sim/vec';
import { asCaptured, create, FIX, pace } from './helpers';
import { loadState, resumeState } from './state';
import { jointQuats, SNAP_RADPS } from './visible';

const BB = WRAP_V11.bind!.behind!;
const REAR = 'tests/data/state/L3-F19-rear@42.json.gz';
/** The rear wrap under WRAP_V11 at 1.05 s, the runner bound (clause c) at 1.00 (scripts/capture-state.ts --wrap=v11). */
const REAR_V11 = 'tests/data/state/L3-F19-rear~wrapv11@63.json.gz';

/** A variant of `w` whose `bind.behind` is `behind` (undefined: none), its own id. */
function withBehind(w: WrapProfile, behind: WrapBindBehind | undefined, tag: string): WrapProfile {
  const { behind: _b, ...bind } = w.bind!;
  return { ...w, id: `${w.id}-${tag}`, bind: behind ? { ...bind, behind } : bind };
}

interface StayRun {
  /** The tackler's drive begun (its first decision with drive debug), and from behind (decided as it began). */
  driveT: number | null;
  behindDrive: boolean;
  /** Any substep whose tackler intent says `behind`; and his `ride` seen. */
  saidBehind: boolean;
  rode: boolean;
  /** The runner's 'boundLegs' loss (time, clause, the clock's age, holder), and his first loss of any kind. */
  bound: { t: number; clause: string; heldS: number; holder: string } | null;
  loss: { t: number; reason: string } | null;
  /** The runner up at `checkAt` (absent: half a second after the drive began). */
  upAt: boolean | null;
  /** His speed along his travel as the drive began, and the most after it while he is up. */
  v0: number | null;
  vMax: number;
  /** His posture request at his last supported substep: lean (rad), and how far along his horizontal velocity. */
  lean: number;
  along: number;
}

async function stayRun(id: string, wrap: WrapProfile, o: { rev?: boolean; faults?: WrapDebug; checkAt?: number; untilS?: number } = {}): Promise<StayRun> {
  let hook: (() => void) | null = null;
  const sim = await create({ ...FIX(id), wrap }, { onSubstep: () => hook?.(), ...(o.rev ? { reverseOrder: true } : {}), ...(o.faults ? { debug: { wrap: o.faults } } : {}) });
  const D = sim.players.find((p) => p.setup.controller.kind === 'wrapAttempt')!;
  const R = sim.players.find((p) => p.id === sim.def.focus![D.id])!;
  const out: StayRun = { driveT: null, behindDrive: false, saidBehind: false, rode: false, bound: null, loss: null, upAt: null, v0: null, vMax: -Infinity, lean: 0, along: 0 };
  let u: Vec3 | null = null;
  hook = () => {
    const dbg = !D.rag ? (D.intent.debug as { drive?: { behind?: true } } | undefined) : undefined;
    if (out.driveT === null && dbg?.drive) {
      out.driveT = sim.t;
      out.behindDrive = !!dbg.drive.behind;
    }
    if (!D.rag && D.intent.behind) out.saidBehind = true;
    if (!D.rag && D.intent.ride) out.rode = true;
    const at = o.checkAt ?? (out.driveT !== null ? out.driveT + 0.5 : Infinity);
    if (out.upAt === null && sim.t >= at - 1e-9) out.upAt = R.controlMode === 'supported';
    if (R.controlMode !== 'supported' || out.driveT === null) return;
    const v = horiz(vc(R.proxy.body.linvel()));
    u ??= norm(v);
    out.v0 ??= dot(v, u);
    out.vMax = Math.max(out.vMax, dot(v, u));
    const pr = R.intent.posture;
    out.lean = pr?.leanRad ?? 0;
    out.along = pr?.leanDirWorld ? dot(norm(horiz(pr.leanDirWorld)), norm(v)) : 0;
  };
  while (!sim.done && sim.t < (o.untilS ?? Infinity)) sim.stepTick();
  for (const e of sim.events) {
    if (e.type !== 'lossOfSupport' || e.playerId !== R.id) continue;
    const d = e.data as { reason: string; bind?: { clause: string; heldS: number; holder: string } };
    out.loss ??= { t: e.t, reason: d.reason };
    if (d.reason === 'boundLegs' && !out.bound) out.bound = { t: e.t, ...d.bind! };
  }
  sim.dispose();
  return out;
}

describe('contact motion polish 2.4, staying on from behind (WRAP_V11, WrapBind.behind)', () => {
  it('(i) a runner held from behind goes down (the rear wrap under WRAP_V11, both orders): the drive begins from behind, the tackler riding and saying so, and once it has held him with an arm for the confirm time the runner goes down, boundLegs clause (c) with the tackler as holder, before any other loss, his speed along his travel never 0.3 m/s over what it was as the drive began, his posture request leaning 12 deg along his travel meanwhile. The twin, the field absent (today): no intent says behind, no clause (c), and the runner is still up half a second into the drive', async () => {
    for (const rev of [false, true]) {
      const on = await stayRun('L3-F19-rear', WRAP_V11, { rev, untilS: 1.6 });
      const tag = rev ? 'rev' : 'fwd';
      expect(on.driveT, tag).not.toBeNull();
      expect(on.behindDrive, tag).toBe(true);
      expect(on.saidBehind && on.rode, tag).toBe(true);
      expect(on.bound, `${tag} ${JSON.stringify(on.loss)}`).not.toBeNull();
      expect(on.loss!.reason, tag).toBe('boundLegs');
      expect(on.bound!, tag).toMatchObject({ clause: 'c', holder: 'D' });
      expect(on.bound!.heldS, tag).toBeGreaterThanOrEqual(BB.confirmS - 1e-6);
      expect(on.bound!.t - on.driveT!, tag).toBeGreaterThanOrEqual(BB.confirmS - 1e-6);
      expect(on.bound!.t - on.driveT!, tag).toBeLessThan(BB.confirmS + 0.05);
      expect(on.vMax - on.v0!, tag).toBeLessThan(0.3);
      expect(on.lean, tag).toBeCloseTo((WRAP_V11.bind!.leanDeg * Math.PI) / 180, 9);
      expect(on.along, tag).toBeGreaterThan(0.99);
      const twin = await stayRun('L3-F19-rear', withBehind(WRAP_V11, undefined, 'unbound'), { rev, untilS: 1.6 });
      expect(twin.behindDrive, tag).toBe(true);
      expect(twin.saidBehind, tag).toBe(false);
      expect(twin.bound, tag).toBeNull();
      expect(twin.upAt, tag).toBe(true);
    }
  }, 120_000);

  it('(ii) a front or side holder never binds by (c) (the front wrap, the side wrap, the drag and the drag mirror, whose runners fall on their own within about 0.25 s of the drive, under WRAP_V11 with the confirm time cut to 0.05 s): the tackler drives and rides but his drive is never from behind, no intent says so, and no loss is clause (c). The fault twin: with the side test off (bindBehindAnySide, a riding holder with an arm on him counts) the front wrap, the drag and the drag mirror bind by it', async () => {
    const short = withBehind(WRAP_V11, { confirmS: 0.05, graceS: BB.graceS }, 'confirm005');
    for (const id of ['L3-F19-front', 'L3-F4-twoArm', 'L3-F5-drag', 'L3-F5-dragMirror']) {
      const on = await stayRun(id, short, { untilS: 2.5 });
      expect(on.driveT, id).not.toBeNull();
      expect(on.rode, id).toBe(true);
      expect(on.behindDrive || on.saidBehind, id).toBe(false);
      expect(on.loss, id).not.toBeNull();
      expect(on.bound?.clause, id).not.toBe('c');
    }
    for (const id of ['L3-F19-front', 'L3-F5-drag', 'L3-F5-dragMirror']) {
      const twin = await stayRun(id, short, { untilS: 2.5, faults: { bindBehindAnySide: true } });
      expect(twin.bound, `${id} ${JSON.stringify(twin.loss)}`).not.toBeNull();
      expect(twin.bound!.clause, id).toBe('c');
    }
  }, 120_000);

  it('(iii) a hold that does not last binds nothing (the rear wrap, the confirm time made longer than the drive from behind holds him with an arm, about 0.35 s): no clause (c), then or later. The fault twin: with a grace longer than the run (the clock never starts over) the same run binds him by (c)', async () => {
    const long = withBehind(WRAP_V11, { confirmS: 0.5, graceS: BB.graceS }, 'confirm05');
    const on = await stayRun('L3-F19-rear', long, { untilS: 2.5 });
    expect(on.saidBehind).toBe(true);
    expect(on.bound?.clause, JSON.stringify(on.loss)).not.toBe('c');
    const twin = await stayRun('L3-F19-rear', withBehind(WRAP_V11, { confirmS: 0.5, graceS: 10 }, 'confirm05-nograce'), { untilS: 2.5 });
    expect(twin.bound, JSON.stringify(twin.loss)).not.toBeNull();
    expect(twin.bound!.clause).toBe('c');
  }, 120_000);

  it('(iv) staying on never pushes: on the rear wrap under WRAP_V11 every decision of the drive from behind on a runner still up, in every mode of it, asks for exactly the runner\'s velocity (no brake, never more along his travel). The fault twin: with the push kept from behind (behindPush) it asks for more than a metre a second beyond his speed', async () => {
    const run = async (fault?: WrapDebug): Promise<{ over: number; dev: number }[]> => {
      const cap = loadState(REAR);
      const def = asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V11 }), ['wrap']);
      const sim = await resumeState(cap, { def, variant: ['wrap'] });
      const D = sim.players.find((p) => p.id === 'D')!;
      const c = D.controller as unknown as { decide(ctx: ControllerContext): PlayerIntent; fault?: WrapDebug };
      if (fault) c.fault = fault;
      const decide = c.decide.bind(c);
      const out: { over: number; dev: number }[] = [];
      c.decide = (ctx: ControllerContext): PlayerIntent => {
        const intent = decide(ctx);
        const me = ctx.observed.bodies[ctx.self]!;
        const tb = ctx.focus ? ctx.observed.bodies[ctx.focus] : undefined;
        const dv = (intent.debug as { drive?: { behind?: true } } | undefined)?.drive;
        if (tb && me.controlMode === 'supported' && tb.controlMode === 'supported' && dv?.behind) {
          const vR = horiz(tb.linearVelocity);
          const req = intent.locomotion.desiredVelocityWorld;
          out.push({ over: dot(req, norm(vR)) - len(vR), dev: len(sub(req, vR)) });
        }
        return intent;
      };
      while (!sim.done && sim.t < 1.3) {
        sim.stepTick();
        await pace();
      }
      sim.dispose();
      return out;
    };
    const on = await run();
    expect(on.length).toBeGreaterThan(10);
    for (const d of on) {
      expect(d.over).toBeLessThanOrEqual(1e-9);
      expect(d.dev).toBeLessThan(1e-9);
    }
    const twin = await run({ behindPush: true });
    expect(twin.length).toBeGreaterThan(10);
    expect(Math.max(...twin.map((d) => d.over))).toBeGreaterThan(1);
  }, 120_000);

  it('(v) a lost arm lets go instead of whipping overhead: resumed from the rear wrap under WRAP_V11 at 1.05 s (the runner bound at 1.00 and falling away ahead of the still-posed tackler), the tackler draws no joint snap while supported and every arm pose he draws to his switch is valid; both arms let go (release) before 1.2 s. The fault twin, the let-go off (`letGoM` absent): his left forearm clamp follows the runner overhead, its pose goes invalid, the push-out whips the shoulder in a drawn frame and the invalid pose is held', async () => {
    const run = async (wrap: WrapProfile): Promise<{ snaps: string[]; invalidS: number; releaseT: Partial<Record<'left' | 'right', number>> }> => {
      const cap = loadState(REAR_V11);
      const sim = await resumeState(cap, { def: asCaptured(cap, (d) => ({ ...d, wrap }), ['wrap']), variant: ['wrap'] });
      const D = sim.players.find((p) => p.id === 'D')!;
      const out = { snaps: [] as string[], invalidS: 0, releaseT: {} as Partial<Record<'left' | 'right', number>> };
      let prev: Record<string, { x: number; y: number; z: number; w: number }> | null = null;
      let t = sim.t;
      while (!sim.done && !D.rag && D.controlMode === 'supported') {
        sim.stepTick();
        const dt = sim.t - t;
        t = sim.t;
        if (D.rag || D.controlMode !== 'supported' || !D.pose) break;
        const Q = jointQuats(D.pose);
        if (prev)
          for (const [jn, q] of Object.entries(Q)) {
            const p = prev[jn]!;
            const w = (2 * Math.acos(Math.min(1, Math.abs(p.x * q.x + p.y * q.y + p.z * q.z + p.w * q.w)))) / dt;
            if (w > SNAP_RADPS) out.snaps.push(`${sim.t.toFixed(3)} ${jn} ${((w * dt * 180) / Math.PI).toFixed(0)} deg`);
          }
        prev = Q;
        const ob = sim.arms?.obs(D.id);
        for (const s of ['left', 'right'] as const) {
          if (ob?.[s] && !ob[s]!.poseValid) out.invalidS += dt;
          if (ob?.[s]?.action === 'release') out.releaseT[s] ??= sim.t;
        }
        await pace();
      }
      sim.dispose();
      return out;
    };
    const on = await run(WRAP_V11);
    expect(on.snaps).toEqual([]);
    expect(on.invalidS).toBe(0);
    for (const s of ['left', 'right'] as const) expect(on.releaseT[s], s).toBeLessThan(1.2);
    const { letGoM: _l, ...noLetGo } = WRAP_V11.drive!.behind!;
    const twin = await run({ ...WRAP_V11, id: `${WRAP_V11.id}-holdon`, drive: { ...WRAP_V11.drive!, behind: noLetGo } });
    expect(twin.snaps.some((s) => s.includes('leftShoulder')), JSON.stringify(twin.snaps)).toBe(true);
    expect(twin.invalidS).toBeGreaterThan(0.1);
  }, 120_000);

  it('the profile: WRAP_V11 is WRAP_V10 with no brake and no weight commit from behind and the field; WRAP_V10 and WRAP_V6 have no field', () => {
    expect(WRAP_V11.drive!.behind).toEqual({ minMps: 1, maxDeg: 60, brakeMps: 0, letGoM: 0.35 });
    expect(WRAP_V11.bind!.behind).toEqual({ confirmS: 0.25, graceS: 0.05 });
    expect(WRAP_V10.bind!.behind).toBeUndefined();
    expect(WRAP_V6.bind!.behind).toBeUndefined();
    expect({ ...WRAP_V11, id: WRAP_V10.id, drive: WRAP_V10.drive, bind: WRAP_V10.bind }).toEqual(WRAP_V10);
  });
});
