// Contact motion polish 2.1, the fall link (`WrapProfile.fallLink`, `FallLinkProfile`; src/sim/arms.ts): a forearm clamp
// the tackler has at his own switch goes on as a tension-only spring-damper from his ragdoll forearm to the patch it held,
// through the shared allocator, until it breaks. WRAP_V9 (WRAP_V8 with it) is used by no fixture. Each case resumes the
// drag (L3-F5-drag, the scene whose tackler switches with both clamps on, 0.82 s, before the referee's ending at 0.95 s;
// the rear wrap's switch comes after the ending, which ends every clamp first) captured under WRAP_V8 at 0.45 s. WRAP_V9
// differs from WRAP_V8 only in the arm system's `fallLink`, which the simulation sets at build (a field the V8 capture's
// arm system lacks, so the resume sets it as the build does); the twin is the same resume without it, or with a fault.
import { describe, expect, it } from 'vitest';
import { WRAP_V8, WRAP_V9 } from '../src/sim/controllers/wrap';
import type { ForceLedgerEntry } from '../src/sim/arms';
import { allFixtures } from '../src/sim/fixtures/index';
import { labRun } from '../src/lab/lab-params';
import type { FallLinkProfile } from '../src/sim/profiles';
import { poseOfRb } from '../src/sim/ragdoll';
import type { Simulation } from '../src/sim/simulation';
import { add, dot, len, scale, sub, toWorld, type Vec3 } from '../src/sim/vec';
import { asCaptured, FIX } from './helpers';
import { passiveEnergyMeter } from './passive-energy';
import { loadState, resumeState } from './state';

const SIDES = ['left', 'right'] as const;
/** L3-F5-drag under WRAP_V8 at 0.45 s (tick 27), before the tackler's hold is secure (0.48 s) and his switch (0.82 s). */
const DRAG_CAP = 'tests/data/state/L3-F5-drag~wrapv8@27.json.gz';
const FL = WRAP_V9.fallLink!;

interface LinkPriv {
  arms: { fallLink?: FallLinkProfile & { noBreak?: boolean }; keepLedger: boolean; ledger: ForceLedgerEntry[]; arms: Map<string, Record<string, { link?: { targetId: string; part: string; pointLocal: Vec3; ownerPart: string; ownerPointLocal: Vec3 } | null }>> };
}

interface LinkRun {
  /** The tackler's switch (s). */
  dSwitch: number | null;
  /** Per arm: held at his switch, and how long it stayed retained after it (null: to the run's end). */
  held: Record<string, { at: boolean; forS: number | null }>;
  /** The link's end events (arm, reason) and its largest stretch while it lived (m). */
  ends: { arm: string; reason: string }[];
  maxStretchM: number;
  /** The link entries of the ledger, and per substep each live link's work over the solve (J). */
  entries: ForceLedgerEntry[];
  workJ: number[];
  /** The run's end (s), the passive-energy meter's injecting solves per player, the conversions' audits. */
  endT: number;
  injecting: Record<string, number>;
  auditsOk: boolean;
}

/** The drag resumed at 0.45 s, with the fall link (`link`, as the build sets it for WRAP_V9) or without it, to `untilS`. */
async function linkRun(link: (FallLinkProfile & { noBreak?: boolean }) | null, untilS = 1.5): Promise<LinkRun> {
  const cap = loadState(DRAG_CAP);
  const def = asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V8 }));
  let probe: (() => void) | null = null;
  const sim: Simulation = await resumeState(cap, { def, opts: { onSubstep: () => probe?.() } });
  const A = (sim as unknown as LinkPriv).arms;
  if (link) A.fallLink = { ...link };
  A.keepLedger = true;
  const meter = passiveEnergyMeter(sim);
  const D = sim.players.find((p) => p.id === 'D')!;
  const rec = A.arms.get('D')!;
  const out: LinkRun = { dSwitch: null, held: { left: { at: false, forS: null }, right: { at: false, forS: null } }, ends: [], maxStretchM: 0, entries: [], workJ: [], endT: 0, injecting: {}, auditsOk: true };
  let ledgerAt = 0;
  probe = () => {
    if (D.rag && out.dSwitch === null) {
      out.dSwitch = sim.t;
      for (const s of SIDES) out.held[s].at = !!sim.arms!.retained('D', s);
    }
    if (out.dSwitch === null) return;
    for (const s of SIDES) if (out.held[s].at && out.held[s].forS === null && !sim.arms!.retained('D', s)) out.held[s].forS = sim.t - out.dSwitch;
    // this substep's link entries: the pair's work over the solve, each force over its own material point's motion
    for (; ledgerAt < A.ledger.length; ledgerAt++) {
      const e = A.ledger[ledgerAt];
      if (e.kind !== 'link') continue;
      out.entries.push(e);
      const L = rec[e.arm].link;
      if (!L) continue;
      const tgt = sim.players.find((p) => p.id === L.targetId)!;
      const pT = toWorld(poseOfRb(tgt.rag ? tgt.rag.bodies[L.part as 'core'] : tgt.proxy.body), L.pointLocal);
      const pO = toWorld(poseOfRb(D.rag!.bodies[L.ownerPart as 'core']), L.ownerPointLocal);
      out.workJ.push(dot(e.forceOnTarget, sub(pT, e.pointOnTarget)) + dot(e.forceOnOwner, sub(pO, e.pointOnOwner)));
      out.maxStretchM = Math.max(out.maxStretchM, len(sub(pT, pO)));
    }
    A.ledger.length = 0;
    ledgerAt = 0;
  };
  while (!sim.done && sim.t < untilS) sim.stepTick();
  out.endT = sim.t;
  for (const e of sim.events) if (e.playerId === 'D' && e.type === 'fallLinkEnd') out.ends.push({ arm: e.data!.arm as string, reason: e.data!.reason as string });
  for (const [id, r] of meter.runs()) out.injecting[id] = r.injecting;
  out.auditsOk = sim.players.every((p) => !p.handoff || p.handoff.audit?.ok !== false);
  meter.restore();
  sim.dispose();
  return out;
}

/** Every link entry's force pair equal and opposite at its two points (the offenders' steps). */
function unpaired(entries: ForceLedgerEntry[]): number[] {
  return entries.filter((e) => len(add(e.forceOnTarget, e.forceOnOwner)) > 1e-9 * Math.max(1, len(e.forceOnTarget))).map((e) => e.step);
}

/** The largest net work the links have done so far, over the run (J): a link that starts at zero length stores nothing to give back. */
function maxNetWorkJ(workJ: number[]): number {
  let cum = 0;
  let max = 0;
  for (const w of workJ) max = Math.max(max, (cum += w));
  return max;
}

describe('polish 2.1, the fall link (WRAP_V9)', () => {
  it('(a) holds: the drag\'s tackler keeps both arms on the carrier from his switch to the end of the run (0.6 s; the link never stretched past its separation); without the link each arm lets go within 0.2 s of it (0.10 and 0.13 s, solved contact lapsing)', async () => {
    const on = await linkRun(FL);
    expect(on.dSwitch).not.toBeNull();
    const tail = on.endT - on.dSwitch!;
    expect(tail).toBeGreaterThan(0.5);
    for (const s of SIDES) {
      expect(on.held[s].at, s).toBe(true);
      expect(on.held[s].forS, s).toBeNull();
    }
    expect(on.ends).toEqual([]);
    expect(on.maxStretchM).toBeGreaterThan(0);
    expect(on.maxStretchM).toBeLessThanOrEqual(FL.maxSeparationM);
    // twin: no link
    const off = await linkRun(null);
    expect(off.dSwitch).toBeCloseTo(on.dSwitch!, 9);
    for (const s of SIDES) {
      expect(off.held[s].at, s).toBe(true);
      expect(off.held[s].forS, s).not.toBeNull();
      expect(off.held[s].forS!, s).toBeLessThan(0.2);
    }
    expect(off.entries).toEqual([]);
  }, 60_000);

  it('(b) breakable: a link asked more than its ceilings (budget 5%: 50 N an arm) lets go on overload, one too soft to hold him (300 N/m) on separation past 25 cm; with the break rules off neither does', async () => {
    const weak = await linkRun({ ...FL, budgetFraction: 0.05 }, 1.2);
    expect(weak.ends.length).toBeGreaterThan(0);
    expect(weak.ends.every((e) => e.reason === 'overload')).toBe(true);
    const weakTwin = await linkRun({ ...FL, budgetFraction: 0.05, noBreak: true }, 1.2);
    expect(weakTwin.ends).toEqual([]);
    expect(weakTwin.entries.some((e) => e.raw > e.allocated)).toBe(true);
    // a link too soft to hold him (300 N/m, no damping) stretches past its 25 cm
    const soft = await linkRun({ ...FL, stiffness: 300, damping: 0 }, 1.5);
    expect(soft.ends.length).toBeGreaterThan(0);
    expect(soft.ends.some((e) => e.reason === 'separation')).toBe(true);
    const softTwin = await linkRun({ ...FL, stiffness: 300, damping: 0, noBreak: true }, 1.5);
    expect(softTwin.ends).toEqual([]);
    expect(softTwin.maxStretchM).toBeGreaterThan(FL.maxSeparationM);
  }, 120_000);

  it('(c) conservation: every link force has its equal and opposite, under the per-arm ceiling; the links\' net work never goes positive (they give back no more than they stored); the energy meter and the conversion audits stay clean. The checks\' twins: the owner\'s force dropped, or the pull made a push, fail them', async () => {
    const on = await linkRun(FL);
    expect(on.entries.length).toBeGreaterThan(100);
    expect(on.entries.some((e) => e.actual > 100)).toBe(true);
    expect(unpaired(on.entries)).toEqual([]);
    expect(on.entries.every((e) => e.actual <= Math.min(700, 1000 * FL.budgetFraction) + 1e-9)).toBe(true);
    expect(on.workJ.reduce((a, w) => a + w, 0)).toBeLessThan(0);
    expect(maxNetWorkJ(on.workJ)).toBeLessThan(0.01);
    expect(on.injecting).toEqual({ D: 0, R: 0 });
    expect(on.auditsOk).toBe(true);
    // the checks' twins on the same entries: a force on the target alone, and the pull reversed (its work's sign)
    expect(unpaired(on.entries.map((e) => ({ ...e, forceOnOwner: scale(e.forceOnOwner, 0) }))).length).toBeGreaterThan(100);
    expect(maxNetWorkJ(on.workJ.map((w) => -w))).toBeGreaterThan(1);
  }, 60_000);

  it('(d) WRAP_V9 is no fixture\'s; the lab\'s wrap=v9 selects it on a wrapping defender (wrap=v8 stays WRAP_V8)', () => {
    expect(allFixtures().some((d) => d.wrap?.fallLink || d.wrap?.id === WRAP_V9.id)).toBe(false);
    const on = FIX('L3-F5-drag');
    expect(labRun(on, new URLSearchParams('wrap=v9'))).toEqual({ def: { ...on, wrap: WRAP_V9 }, opts: {}, label: 'wrap v9' });
    expect(labRun(on, new URLSearchParams('wrap=v8')).def.wrap).toBe(WRAP_V8);
  });
});
