// Plan 16, the punch as a strike (controllers/block.ts `BlockStrike`, BLOCK_STRIKE_V1; the palm push's `extendMps`,
// arms.ts): a timed load, strike and drive. Two model-body defenders from the BL family's package (fixtures/blocking.ts
// `blockScene` on L3-F6-hold's registered definition), each on his base (`based`) with the strike (`withStrike`);
// constructed short runs. Each case has its fault twin: the strike thrown too early (the extension done before contact),
// a strike that never reloads, a load that ignores his speed, a punch that cannot be started again.
import { describe, expect, it } from 'vitest';
import type { ArmSide } from '../src/sim/contracts';
import type { Controller, ControllerContext } from '../src/sim/controllers/base';
import { BLOCK_STRIKE_V1, nextPunch, punchDepth, withStrike, type BlockController, type BlockStrike, type PunchCues, type PunchState } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { based, blockScene, type BlockMan, type BlockSceneOpts } from '../src/sim/fixtures/blocking';
import { Simulation, type PlayerRuntime } from '../src/sim/simulation';
import { dot, len, norm, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
/** Model body: the torso box's front is 0.215 m ahead of the origin. */
const CHEST_FRONT_M = 0.215;

const striker = (K: BlockStrike, o: Partial<BlockMan> = {}): BlockMan => ({ effort: 0.5, intent: 'hold', hands: 'under', profile: withStrike(based(), K), ...o });
const scene = (o: Partial<BlockSceneOpts> & { durationS: number }, K: BlockStrike = BLOCK_STRIKE_V1): FixtureDef =>
  blockScene({ id: 'BL-T-strike', title: 'plan 16 strike (test)', A: striker(K), B: striker(K, { hands: 'over' }), ...o }, FIX('L3-F6-hold'));
/** A strike variant (a nested patch of BLOCK_STRIKE_V1). */
const variant = (id: string, p: { load?: Partial<BlockStrike['load']>; strike?: Partial<BlockStrike['strike']> }): BlockStrike => ({
  ...BLOCK_STRIKE_V1,
  id,
  load: { ...BLOCK_STRIKE_V1.load, ...p.load },
  strike: { ...BLOCK_STRIKE_V1.strike, ...p.strike },
});

interface ManSample {
  root: number;
  punch?: PunchState;
  /** Each palm ahead of his own chest front along his facing (m), each arm's shoulder-to-palm length (m), held. */
  ahead: Record<ArmSide, number>;
  arm: Record<ArmSide, number>;
  held: Record<ArmSide, boolean>;
  /** Each palm's speed into his chest along the arm (palm less his chest's point under it, m/s). */
  closeMps: Record<ArmSide, number>;
  /** The two palms' push force (N). */
  force: number;
  /** The other man's speed away from him along the line (m/s). */
  hisAway: number;
  supported: boolean;
}
interface Sample {
  t: number;
  m: Record<string, ManSample>;
}
interface Run {
  s: Sample[];
  /** Each push's birth: man, time, elbow flexion (deg). */
  births: { id: string; t: number; flexDeg: number }[];
  ends: { id: string; t: number; reason: string }[];
}

const yawOf = (q: { x: number; y: number; z: number; w: number }): number => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));

/** Runs a scene, sampling both men every substep; `at` is called each substep with the simulation. */
async function run(def: FixtureDef, at?: (sim: Simulation) => void): Promise<Run> {
  const s: Sample[] = [];
  const lastPalm = new Map<string, { at: Vec3; t: number }>();
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      at?.(sim);
      const row: Sample = { t: sim.t, m: {} };
      for (const p of sim.players) {
        const other = sim.players.find((o) => o !== p)!;
        const up = (x: PlayerRuntime) => x.controlMode === 'supported' && !x.rag;
        if (!up(p) || !up(other)) {
          row.m[p.id] = { root: NaN, ahead: { left: 0, right: 0 }, arm: { left: 0, right: 0 }, held: { left: false, right: false }, closeMps: { left: 0, right: 0 }, force: 0, hisAway: 0, supported: up(p) };
          continue;
        }
        const b = p.proxy.body;
        const o = sim.arms!.obs(p.id)!;
        const yaw = yawOf(b.rotation());
        const fwd = v3(Math.sin(yaw), 0, Math.cos(yaw));
        const line = norm(v3(other.proxy.body.translation().x - b.translation().x, 0, other.proxy.body.translation().z - b.translation().z));
        const m: ManSample = { root: b.translation().y, ahead: { left: 0, right: 0 }, arm: { left: 0, right: 0 }, held: { left: false, right: false }, closeMps: { left: 0, right: 0 }, force: 0, hisAway: dot(other.proxy.body.linvel(), line), supported: true };
        if (p.block?.punch) m.punch = { ...p.block.punch };
        for (const side of SIDES) {
          const a = o[side]!;
          m.ahead[side] = dot(sub(a.palmContactWorld, b.translation()), fwd) - CHEST_FRONT_M;
          m.arm[side] = len(sub(a.palmContactWorld, a.shoulderWorld));
          m.held[side] = !!sim.arms!.pushOf(p.id, side);
          const k = `${p.id}:${side}`;
          const was = lastPalm.get(k);
          if (was && sim.t > was.t) {
            const cv = other.proxy.body.velocityAtPoint(a.palmContactWorld);
            const pv = scale(sub(a.palmContactWorld, was.at), 1 / (sim.t - was.t));
            m.closeMps[side] = dot(sub(pv, v3(cv.x, cv.y, cv.z)), norm(sub(a.palmContactWorld, a.shoulderWorld)));
          }
          lastPalm.set(k, { at: { ...a.palmContactWorld }, t: sim.t });
          const f = sim.arms!.lastForce.get(`${p.id}:${side}`);
          if (f && f.kind === 'push') m.force += f.actual;
        }
        row.m[p.id] = m;
      }
      s.push(row);
    },
  });
  await runSim(sim, Infinity);
  const births = sim.events.filter((e) => e.type === 'pushBegin').map((e) => ({ id: e.playerId!, t: e.t, flexDeg: Number((e.data as Record<string, unknown>).flexDeg) }));
  const ends = sim.events.filter((e) => e.type === 'pushEnd').map((e) => ({ id: e.playerId!, t: e.t, reason: String((e.data as Record<string, unknown>).reason) }));
  sim.dispose();
  return { s, births, ends };
}

/**
 * One man's first strike: the load's sink (root at the start less its least before the strike), the palms' greatest
 * distance ahead of his chest as the strike began, the first contact (time, elbow flexion, the fraction of the extension
 * done: (arm length then - as the strike began) / (0.72 reach - that), the palm's speed into his chest as it landed), the root's rise from the strike's start to 0.1 s
 * after contact, the palms' peak force in 0.1 s after contact and the other man's speed gained away from him in it.
 */
function strikeOf(r: Run, id: string) {
  const s = r.s.filter((x) => x.m[id]?.supported);
  const k0 = s.findIndex((x) => x.m[id].punch?.phase === 'strike');
  const first = r.births.find((b) => b.id === id);
  if (k0 < 0 || !first) return null;
  const start = s[k0];
  const kc = s.findIndex((x) => x.t >= first.t - 1e-9 && SIDES.some((side) => x.m[id].held[side]));
  const c = s[kc];
  // the palm's speed into him the substep before it landed (the last free one)
  const handMps = Math.max(...SIDES.filter((side) => c.m[id].held[side]).map((side) => s[kc - 1].m[id].closeMps[side]));
  const within = s.filter((x) => x.t >= first.t - 1e-9 && x.t <= first.t + 0.1 + 1e-9);
  const L0 = (start.m[id].arm.left + start.m[id].arm.right) / 2;
  const Lc = Math.min(...SIDES.filter((side) => c.m[id].held[side]).map((side) => c.m[id].arm[side]));
  return {
    sinkM: s[0].m[id].root - Math.min(...s.slice(0, k0 + 1).map((x) => x.m[id].root)),
    loadedAheadM: Math.max(start.m[id].ahead.left, start.m[id].ahead.right),
    contactT: first.t,
    strikeT: start.t,
    flexDeg: first.flexDeg,
    handMps,
    extFrac: (Lc - L0) / (0.72 - L0),
    riseM: Math.max(...within.map((x) => x.m[id].root)) - start.m[id].root,
    peakN: Math.max(...within.map((x) => x.m[id].force)),
    hitDvMps: within.at(-1)!.m[id].hisAway - c.m[id].hisAway,
  };
}

/** A controller that returns another's intent with its context changed (the tests' wrappers; not in committed source). */
const wrapCtx = (inner: Controller, f: (ctx: ControllerContext) => ControllerContext): Controller =>
  Object.assign(Object.create(Object.getPrototypeOf(inner)), inner, { decide: (ctx: ControllerContext) => inner.decide.call(inner, f(ctx)) });

describe('plan 16, the punch as a strike (BLOCK_STRIKE_V1)', () => {
  it('(a) timed: striking a man who stands (a script man 0.67 m of chest gap off) he sinks at least 6 cm with his palms in at his chest (within 0.2 m of its unpitched front), throws the strike, and his palms land on bent arms (elbow at least 55 deg, under 85 % of the extension, within 0.2 s) at speed (2 m/s into the chest), a hit (two palms past 420 N within 0.1 s, the man moved 0.2 m/s), the hips rising 3 cm; thrown too early (the extension done before contact) the palms land on straight arms, slowly, with no hit', async () => {
    const early = variant('test-strike-early', { strike: { contactM: 2, straightM: 0.8 } });
    for (const [K, timed] of [
      [BLOCK_STRIKE_V1, true],
      [early, false],
    ] as const) {
      const d = scene({ durationS: 1.2 }, K);
      const stands = { ...d, players: [d.players[0], { ...d.players[1], controller: { kind: 'script' as const, segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1), effort: 1 }] } }] };
      const x = strikeOf(await run(stands), 'A');
      expect(x, 'a strike and a contact').not.toBeNull();
      if (!timed) {
        expect(x!.flexDeg, 'elbow at contact thrown too early (deg)').toBeLessThan(40);
        expect(x!.handMps, 'palm speed into him at contact thrown too early (m/s)').toBeLessThan(1);
        expect(x!.peakN, 'peak force within 0.1 s of contact thrown too early (N)').toBeLessThan(420);
        continue;
      }
      expect(x!.sinkM, "the load's sink (m)").toBeGreaterThan(0.06);
      // (ahead of his unpitched chest front: the load's trunk pitch carries the drawn chest about 0.1 m forward of it)
      expect(x!.loadedAheadM, 'palms ahead of his chest as the strike began (m)').toBeLessThan(0.2);
      expect(x!.flexDeg, 'elbow at contact (deg)').toBeGreaterThan(55);
      expect(x!.extFrac, 'fraction of the extension done at contact').toBeLessThan(0.85);
      expect(x!.contactT - x!.strikeT, 'strike to contact (s)').toBeLessThan(0.2);
      expect(x!.handMps, 'palm speed into him at contact (m/s)').toBeGreaterThan(2);
      expect(x!.peakN, 'peak force within 0.1 s of contact (N)').toBeGreaterThan(420);
      expect(x!.hitDvMps, "the man's speed gained away (m/s)").toBeGreaterThan(0.2);
      expect(x!.riseM, "the hips' rise from the strike to 0.1 s after contact (m)").toBeGreaterThan(0.03);
    }
  }, 180_000);

  it('(b) a miss reloads: a strike at a man taken out of reach as it is thrown (a script man moved 0.6 m back) goes back to the load (no palm held out on a straight arm past 0.25 s); a strike that never reloads holds straight arms out', async () => {
    const never = variant('test-strike-never-reload', { strike: { straightM: 0.8, maxS: 10 } });
    for (const [K, reloads] of [
      [BLOCK_STRIKE_V1, true],
      [never, false],
    ] as const) {
      const d = scene({ durationS: 1.4 }, K);
      const stands = { ...d, players: [d.players[0], { ...d.players[1], controller: { kind: 'script' as const, segments: [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1), effort: 1 }] } }] };
      // the constructed miss: B set 0.6 m further off (+z) the substep A's strike begins
      let moved = false;
      const r = await run(stands, (sim) => {
        const A = sim.players.find((p) => p.id === 'A')!;
        if (moved || A.block?.punch?.phase !== 'strike') return;
        moved = true;
        const b = sim.players.find((p) => p.id === 'B')!.proxy.body;
        const t = b.translation();
        b.setTranslation({ x: t.x, y: t.y, z: t.z + 0.6 }, true);
      });
      expect(moved, 'B moved off as the strike began').toBe(true);
      const s = r.s.filter((x) => x.m.A?.supported);
      expect(s.some((x) => x.m.A.punch?.phase === 'strike'), 'A strikes').toBe(true);
      // the longest run of substeps with a free arm out at 0.68 m or more
      let run0 = 0;
      let longest = 0;
      for (const x of s) {
        const out = SIDES.some((side) => !x.m.A.held[side] && x.m.A.arm[side] >= 0.68);
        run0 = out ? run0 + 1 : 0;
        longest = Math.max(longest, run0);
      }
      const outS = longest / 240;
      const reloaded = s.some((x, i) => i > 0 && s[i - 1].m.A.punch?.phase === 'strike' && x.m.A.punch?.phase === 'load');
      if (reloads) {
        expect(reloaded, 'A back to the load after the miss').toBe(true);
        expect(outS, 'longest free straight arm (s)').toBeLessThan(0.25);
      } else expect(outS, 'longest free straight arm, never reloading (s)').toBeGreaterThan(0.25);
    }
  }, 180_000);

  it('(c) a moving man loads less: 1 standing, 0.4 at 1.5 m/s and faster, and closing he begins the load earlier; walking in at 1.5 m/s he sinks less than half as far in his load as the man he meets (who set standing); loading as deep moving, he sinks as far', async () => {
    const K = BLOCK_STRIKE_V1;
    expect(punchDepth(K, 0)).toBe(1);
    expect(punchDepth(K, 1.5)).toBeCloseTo(0.4, 9);
    expect(punchDepth(K, 3)).toBeCloseTo(0.4, 9);
    const cues = (o: Partial<PunchCues>): PunchCues => ({ t: 0, serial: 0, gap: 1.3, closingMps: 0, engaged: false, reachM: 1, loaded: false, anyOn: false, straight: false, speedMps: 0, ...o });
    expect(nextPunch(K, 0.8, undefined, cues({})), 'standing at 1.3 m: no load yet').toBeUndefined();
    expect(nextPunch(K, 0.8, undefined, cues({ closingMps: 3, speedMps: 3 }))?.phase, 'closing at 3 m/s at 1.3 m: the load').toBe('load');
    const deep = variant('test-strike-deep-moving', { load: { movingDepth: 1 } });
    for (const [Kx, less] of [
      [K, true],
      [deep, false],
    ] as const) {
      const r = await run(scene({ durationS: 2.2, sepM: 3, A: striker(Kx, { walkInMps: 1.5 }), B: striker(Kx, { hands: 'over', fromS: 1 }) }));
      const sink = (id: string) => {
        const s = r.s.filter((x) => x.m[id]?.supported);
        const k0 = s.findIndex((x) => x.m[id].punch?.phase === 'load');
        const k1 = s.findIndex((x) => x.m[id].punch?.phase === 'strike');
        expect(k0 >= 0 && k1 > k0, `${id}: a load then a strike`).toBe(true);
        return { depth: s[k0].m[id].punch!.depth, sinkM: s[k0].m[id].root - Math.min(...s.slice(k0, k1 + 1).map((x) => x.m[id].root)) };
      };
      const a = sink('A');
      const b = sink('B');
      if (less) {
        expect(a.depth, "A's load depth").toBeLessThan(0.6);
        expect(b.depth, "B's load depth").toBeGreaterThan(0.95);
        expect(a.sinkM, "A's sink against B's (m)").toBeLessThan(0.5 * b.sinkM);
      } else expect(a.sinkM, "A's sink loading as deep (m) against B's").toBeGreaterThan(0.5 * b.sinkM);
    }
  }, 180_000);

  it('(d) the punch starts again: engaged and driving, his request counting up the punch (a brain re-punching) takes his palms off, loads (sinks 3 cm) and strikes them on again, timed (elbow at least 55 deg), and he drives on; a punch that cannot be started again (the new number ignored) leaves the palms on', async () => {
    for (const oneShot of [false, true]) {
      let done = false;
      const at = (sim: Simulation) => {
        if (done || sim.t < 2) return;
        done = true;
        const A = sim.players.find((p) => p.id === 'A')!;
        (A.controller as BlockController).spec.request.punch = 1;
        // the fault: the controller sees his punch as already the new one (a one-shot that never begins again)
        if (oneShot)
          A.controller = wrapCtx(A.controller, (ctx) => {
            const b = ctx.observed.block?.A;
            return b?.punch ? { ...ctx, observed: { ...ctx.observed, block: { ...ctx.observed.block, A: { ...b, punch: { ...b.punch, n: 1 } } } } } : ctx;
          });
      };
      const r = await run(scene({ durationS: 3.3 }), at);
      const after = r.s.filter((x) => x.t >= 2 && x.m.A?.supported);
      const phases = new Set(after.map((x) => `${x.m.A.punch?.n}:${x.m.A.punch?.phase}`));
      // the new punch's palms (the first born after 2 s; a later one is the drive's re-arm)
      const reborn = r.births.filter((b) => b.id === 'A' && b.t > 2).slice(0, 2);
      if (oneShot) {
        expect(reborn.length, "A's palms born again after the new punch, one-shot").toBe(0);
        expect(phases.has('1:load'), 'A loading again, one-shot').toBe(false);
        continue;
      }
      expect(r.ends.some((e) => e.id === 'A' && e.t >= 2 - 1e-6 && e.reason === 'voluntary'), "A's palms taken off").toBe(true);
      for (const ph of ['1:load', '1:strike', '1:drive']) expect(phases.has(ph), `A's punch 1 ${ph.slice(2)}`).toBe(true);
      expect(reborn.length, "A's palms born again").toBeGreaterThan(0);
      expect(Math.min(...reborn.map((b) => b.flexDeg)), "A's elbow at the new contact (deg)").toBeGreaterThan(55);
      const before = after[0].m.A.root;
      expect(before - Math.min(...after.filter((x) => x.m.A.punch?.phase === 'load').map((x) => x.m.A.root)), "A's sink in the new load (m)").toBeGreaterThan(0.03);
      expect(after.at(-1)!.m.A.punch?.phase, "A's punch at the end").toBe('drive');
      expect(after.at(-1)!.m.A.held.left && after.at(-1)!.m.A.held.right, "A's palms on at the end").toBe(true);
    }
  }, 180_000);

  it('(e) the phases: loaded, thrown only from range (reach 0.55 m, not closer than 0.5: at 0.45 he waits); a strike landed whose palms come off goes to the drive (the block\'s hands re-arm), one that never landed and straightened loads again; with no floor (minReachM 0) the too-close strike is thrown', () => {
    const K = BLOCK_STRIKE_V1;
    const cues = (o: Partial<PunchCues>): PunchCues => ({ t: 1, serial: 0, gap: 0.6, closingMps: 0, engaged: false, reachM: 0.55, loaded: true, anyOn: false, straight: false, speedMps: 0, ...o });
    const load: PunchState = { n: 0, phase: 'load', since: 0, depth: 1 };
    expect(nextPunch(K, 0.8, load, cues({}))?.phase, 'loaded at 0.55 m').toBe('strike');
    expect(nextPunch(K, 0.8, load, cues({ reachM: 0.45 }))?.phase, 'loaded at 0.45 m').toBe('load');
    const bare = variant('test-strike-no-floor', { strike: { minReachM: 0 } });
    expect(nextPunch(bare, 0.8, load, cues({ reachM: 0.45 }))?.phase, 'loaded at 0.45 m, no floor').toBe('strike');
    const landed: PunchState = { n: 0, phase: 'strike', since: 1, depth: 1, onT: 1.02 };
    expect(nextPunch(K, 0.8, landed, cues({ t: 1.05, anyOn: false, straight: true }))?.phase, 'landed, palms off').toBe('drive');
    expect(nextPunch(K, 0.8, landed, cues({ t: 1.05, anyOn: true }))?.phase, 'landed, on, not yet through').toBe('strike');
    const thrown: PunchState = { n: 0, phase: 'strike', since: 1, depth: 1 };
    expect(nextPunch(K, 0.8, thrown, cues({ t: 1.05, straight: true }))?.phase, 'never landed, straight').toBe('load');
  });
});
