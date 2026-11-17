// Contact motion polish 2.1, the fall link (`WrapProfile.fallLink`, `FallLinkProfile`; src/sim/arms.ts): a forearm clamp
// the tackler has at his own switch goes on as a tension-only spring-damper from his ragdoll forearm to the patch it held,
// through the shared allocator, until it breaks. WRAP_V9 (WRAP_V8 with it), registered on L3, L4 and HC from the hold flip to the behind flip (WRAP_V10 carries it, WRAP_V11 from the stay-on flip and WRAP_V12 from the hit flip, WRAP_V13 since the aim flip). Cases (a) to (c) resume
// the low wrap of the two-defender scene (L3-F10-bothLow, whose tackler D switches with both clamps on at 1.20 s and
// holds to the run's end, 2.60 s) captured under WRAP_V8 at 1.10 s on the contact stepping model (plan 15 step 5b: they
// resumed the drag, L3-F5-drag, whose tackler on the model switches with one clamp on); (g) the rear wrap, whose switch
// comes after the ending (the hold through the whistle, `throughEnding`, carries his holds to it), captured under
// WRAP_V8 at 2.10 s; (f) a G4 defender holding without riding at the ending; (i) the simultaneous low wrap (HC-F1-low,
// the born yield, `bornYield`) captured under WRAP_V8 at 1.167 s. WRAP_V9 differs from WRAP_V8 only in the arm system's `fallLink`, which the
// simulation sets at build (a field the V8 capture's arm system lacks, so the resume sets it as the build does); the twin
// is the same resume without it, without one of its fields, or with a fault.
import { describe, expect, it } from 'vitest';
import { WRAP_V13, WRAP_V8, WRAP_V9 } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import type { EffortLedgerEntry, ForceLedgerEntry } from '../src/sim/arms';
import { allFixtures } from '../src/sim/fixtures/index';
import { labRun } from '../src/lab/lab-params';
import type { FallLinkProfile } from '../src/sim/profiles';
import { poseOfRb } from '../src/sim/ragdoll';
import type { SimOptions, Simulation } from '../src/sim/simulation';
import { add, dot, len, scale, sub, toWorld, type Vec3 } from '../src/sim/vec';
import { asCaptured, FIX } from './helpers';
import { passiveEnergyMeter } from './passive-energy';
import { loadState, resumeState } from './state';
import { heldBornBar } from './visible-bar';

const SIDES = ['left', 'right'] as const;
/** L3-F10-bothLow under WRAP_V8 at 1.10 s (tick 66), before the tackler's switch (1.20 s) with both clamps on. */
const LOW_CAP = 'tests/data/state/L3-F10-bothLow~wrapv8@66.json.gz';
/**
 * L3-F19-rear under WRAP_V8 at 2.10 s (tick 126): the tackler riding the fallen carrier down with a ride patch on each
 * arm, 0.1 s before the referee's ending (groundDown, 2.20 s) and about 0.2 s before his own switch (the takedown).
 */
const REAR_CAP = 'tests/data/state/L3-F19-rear~wrapv8@126.json.gz';
/** G4-F7-limbFirst at 1.50 s (tick 90): its defender, supported and not riding, holds the carrier with both clamps at the ending (groundDown, 1.57 s). */
const LIMB_CAP = 'tests/data/state/G4-F7-limbFirst@90.json.gz';
const FL = WRAP_V9.fallLink!;
/** WRAP_V9's link pulling through born pairs (the twin of (i)), and its first try, slack while any born pair is held. */
const { bornYield: _yield, ...FL_PULL } = FL;
const FL_DEAD = { ...FL_PULL, bornDead: true };
/**
 * HC-F1-low under WRAP_V8 at 1.167 s (tick 70), before the diagnostic conversion of both players at 1.20 s, where the
 * carrier's left upper arm is switched in 9 cm inside the tackler's torso (a born pair) as the tackler's two clamps
 * become links.
 */
const BORN_CAP = 'tests/data/state/HC-F1-low~wrapv8@70.json.gz';

interface LinkPriv {
  arms: { fallLink?: FallLinkProfile & { noBreak?: boolean; bornDead?: boolean }; keepLedger: boolean; ledger: ForceLedgerEntry[]; effortLedger: EffortLedgerEntry[]; passive?: { budgetFraction: number }; fallingBudgetFraction: number; profile: { hold: { perArmCeilingN: number; ownerBudgetN: number } }; arms: Map<string, Record<string, { link?: { targetId: string; part: string; pointLocal: Vec3; ownerPart: string; ownerPointLocal: Vec3; restM?: number; letOutM?: number } | null }>> };
}

interface LinkRun {
  /** The tackler's switch (s). */
  dSwitch: number | null;
  /** Per arm: held at his switch, and how long it stayed retained after it (null: to the run's end). */
  held: Record<string, { at: boolean; forS: number | null }>;
  /** The link's end events (arm, reason, how long after his switch) and its largest stretch while it lived (m). */
  ends: { arm: string; reason: string; afterS: number }[];
  maxStretchM: number;
  /** The link entries of the ledger, and per substep each live link's work over the solve (J). */
  entries: ForceLedgerEntry[];
  workJ: number[];
  /** The run's end (s), the passive-energy meter's injecting solves per player, the conversions' audits. */
  endT: number;
  injecting: Record<string, number>;
  auditsOk: boolean;
  /** The referee's ending (s; null: none in the run). */
  endingT: number | null;
  /** The arms the ending kept (`holdThroughEnding`: arm and clamp), and the holds it ended ('playEnded': event type and arm). */
  kept: { arm: string; clamp: string | null }[];
  playEnded: { type: string; arm: string; t: number }[];
  /** Holds begun by anyone after the ending (clamp, grip or ride patch; type, player, arm). */
  begunAfter: string[];
  /** The clamps the links went on from (`fallLinkBegin`, ok). */
  linkFrom: string[];
  /** The tackler's clamp entries of the ledger after the ending, and the clamps the simulation counts at the run's end. */
  clampEntries: ForceLedgerEntry[];
  clampsAtEnd: number;
  /** His arm effort entries after his switch, and a ragdoll owner's per-arm ceiling without a link (N). */
  effort: EffortLedgerEntry[];
  ragdollPerArmN: number;
}

interface RunOpts {
  /** The capture (default: the low wrap's). */
  cap?: string;
  /** The definition it resumes under (default: the capture's with WRAP_V8). */
  asWrap8?: boolean;
  /** The twin of (f): every supported owner counted as riding from the resume on (`WrapDebug.rideHoldUnridden`). */
  allRide?: boolean;
}

/**
 * A capture resumed (default: the low wrap at 1.10 s) with the fall link (`link`, as the build sets it for WRAP_V9) or
 * without it, to `untilS` or the run's end.
 */
async function linkRun(link: (FallLinkProfile & { noBreak?: boolean; bornDead?: boolean }) | null, untilS = Infinity, o: RunOpts = {}): Promise<LinkRun> {
  const cap = loadState(o.cap ?? LOW_CAP);
  const def = o.asWrap8 === false ? asCaptured(cap) : asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V8 }));
  const own = 'D';
  let probe: (() => void) | null = null;
  const sim: Simulation = await resumeState(cap, { def, opts: { onSubstep: () => probe?.() } });
  // (set on the resumed options, which the arm host reads each substep: a fault at the resume would reach the
  // defender's controller too, a field its capture lacks)
  if (o.allRide) (sim.opts as SimOptions).debug = { ...sim.opts.debug, wrap: { ...sim.opts.debug?.wrap, rideHoldUnridden: true } };
  const A = (sim as unknown as LinkPriv).arms;
  if (link) A.fallLink = { ...link };
  A.keepLedger = true;
  const meter = passiveEnergyMeter(sim);
  const D = sim.players.find((p) => p.id === own)!;
  const rec = A.arms.get(own)!;
  const out: LinkRun = { dSwitch: null, held: { left: { at: false, forS: null }, right: { at: false, forS: null } }, ends: [], maxStretchM: 0, entries: [], workJ: [], endT: 0, injecting: {}, auditsOk: true, endingT: null, kept: [], playEnded: [], begunAfter: [], linkFrom: [], clampEntries: [], clampsAtEnd: 0, effort: [], ragdollPerArmN: Math.min(A.profile.hold.perArmCeilingN, A.profile.hold.ownerBudgetN * (A.passive?.budgetFraction ?? A.fallingBudgetFraction)) };
  let ledgerAt = 0;
  // (the ending is recorded in a substep's rule observer, after its solve: the ledger from the next substep is after it)
  let afterEnding = false;
  probe = () => {
    if (afterEnding) for (const e of A.ledger) if (e.kind === 'clamp' && e.owner === own) out.clampEntries.push(e);
    if (sim.ending) afterEnding = true;
    if (D.rag && out.dSwitch === null) {
      out.dSwitch = sim.t;
      for (const s of SIDES) out.held[s].at = !!sim.arms!.retained(own, s);
    }
    if (out.dSwitch === null) {
      A.ledger.length = 0;
      A.effortLedger.length = 0;
      return;
    }
    for (const e of A.effortLedger) if (e.owner === own) out.effort.push(e);
    A.effortLedger.length = 0;
    for (const s of SIDES) if (out.held[s].at && out.held[s].forS === null && !sim.arms!.retained(own, s)) out.held[s].forS = sim.t - out.dSwitch;
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
  out.endingT = sim.ending?.t ?? null;
  out.clampsAtEnd = sim.counts().clamps;
  for (const e of sim.events) {
    const arm = e.data?.arm as string;
    if (e.playerId === own && e.type === 'fallLinkEnd') out.ends.push({ arm, reason: e.data!.reason as string, afterS: e.t - (out.dSwitch ?? e.t) });
    if (e.playerId === own && e.type === 'fallLinkBegin' && e.data!.ok) out.linkFrom.push(e.data!.clamp as string);
    if (e.playerId === own && e.type === 'holdThroughEnding') out.kept.push({ arm, clamp: e.data!.clamp as string | null });
    if (e.playerId === own && (e.type === 'clampEnd' || e.type === 'rideHoldEnd') && e.data!.reason === 'playEnded') out.playEnded.push({ type: e.type, arm, t: e.t });
    if (out.endingT !== null && e.t > out.endingT + 1e-9 && (e.type === 'clampBegin' || e.type === 'gripBegin' || e.type === 'rideHoldBegin')) out.begunAfter.push(`${e.type} ${e.playerId} ${arm}`);
  }
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
  it('(a) holds: the low wrap\'s tackler keeps both arms on the carrier from his switch to the end of the run (1.4 s; the link never stretched past its separation); without the link each arm lets go (0.10 and 0.34 s after it, solved contact lapsing)', async () => {
    const on = await linkRun(FL);
    expect(on.dSwitch).not.toBeNull();
    const tail = on.endT - on.dSwitch!;
    expect(tail).toBeGreaterThan(1);
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
    }
    expect(off.entries).toEqual([]);
  }, 60_000);

  it('(b) breakable: a link asked more than its ceilings (budget 5%: 50 N an arm) lets go on overload, one too soft to hold him (300 N/m) on separation past 25 cm; with the break rules off neither does', async () => {
    const weak = await linkRun({ ...FL, budgetFraction: 0.05 }, 1.5);
    expect(weak.ends.length).toBeGreaterThan(0);
    expect(weak.ends.every((e) => e.reason === 'overload')).toBe(true);
    const weakTwin = await linkRun({ ...FL, budgetFraction: 0.05, noBreak: true }, 1.5);
    expect(weakTwin.ends).toEqual([]);
    expect(weakTwin.entries.some((e) => e.raw > e.allocated)).toBe(true);
    // a link too soft to hold him (300 N/m, no damping) stretches past its 25 cm
    const soft = await linkRun({ ...FL, stiffness: 300, damping: 0 });
    expect(soft.ends.length).toBeGreaterThan(0);
    expect(soft.ends.some((e) => e.reason === 'separation')).toBe(true);
    const softTwin = await linkRun({ ...FL, stiffness: 300, damping: 0, noBreak: true });
    expect(softTwin.ends).toEqual([]);
    expect(softTwin.maxStretchM).toBeGreaterThan(FL.maxSeparationM);
  }, 120_000);

  it('(c) conservation: every link force has its equal and opposite, under the per-arm ceiling; the links\' net work never goes positive (they give back no more than they stored); the energy meter and the conversion audits stay clean; the effort ledger records a linked arm\'s ceiling as the link\'s, and his allocation within it. The checks\' twins: the owner\'s force dropped, or the pull made a push, fail them; the ragdoll\'s own per-arm ceiling (the record before) is exceeded', async () => {
    const on = await linkRun(FL);
    expect(on.entries.length).toBeGreaterThan(100);
    expect(on.entries.some((e) => e.actual > 100)).toBe(true);
    expect(unpaired(on.entries)).toEqual([]);
    expect(on.entries.every((e) => e.actual <= Math.min(700, 1000 * FL.budgetFraction) + 1e-9)).toBe(true);
    expect(on.workJ.reduce((a, w) => a + w, 0)).toBeLessThan(0);
    expect(maxNetWorkJ(on.workJ)).toBeLessThan(0.01);
    expect(on.injecting).toEqual({ D: 0, R: 0 });
    expect(on.auditsOk).toBe(true);
    // (both arms linked to the end: every effort entry is a linked arm's)
    expect(on.effort.length).toBeGreaterThan(100);
    expect(on.effort.every((e) => e.perArmN === Math.min(700, 1000 * FL.budgetFraction))).toBe(true);
    expect(on.effort.every((e) => e.allocatedN <= e.perArmN + 1e-6)).toBe(true);
    // the checks' twins on the same entries: a force on the target alone, and the pull reversed (its work's sign); the
    // allocation against the ceiling a ragdoll arm without a link has
    expect(unpaired(on.entries.map((e) => ({ ...e, forceOnOwner: scale(e.forceOnOwner, 0) }))).length).toBeGreaterThan(100);
    expect(maxNetWorkJ(on.workJ.map((w) => -w))).toBeGreaterThan(1);
    expect(on.ragdollPerArmN).toBeLessThan(700);
    expect(on.effort.some((e) => e.allocatedN > on.ragdollPerArmN + 1e-6)).toBe(true);
  }, 60_000);

  it('(f) scope: a defender holding the carrier without riding him (G4-F7-limbFirst) lets go at the whistle with the hold through it on, as without the link, and nothing is acquired after; twin: the same owner counted as riding (the ride hold\'s `rideHoldUnridden`) keeps his clamps through it', async () => {
    const on = await linkRun(FL, 3, { cap: LIMB_CAP, asWrap8: false });
    expect(on.endingT).not.toBeNull();
    expect(on.dSwitch).toBeNull();
    expect(on.kept).toEqual([]);
    expect(on.playEnded.map((e) => e.arm).sort()).toEqual(['left', 'right']);
    expect(on.playEnded.every((e) => Math.abs(e.t - on.endingT!) < 1e-9)).toBe(true);
    expect(on.begunAfter).toEqual([]);
    expect(on.clampEntries).toEqual([]);
    expect(on.clampsAtEnd).toBe(0);
    const none = await linkRun(null, 3, { cap: LIMB_CAP, asWrap8: false });
    expect(none.playEnded).toEqual(on.playEnded);
    expect(none.endT).toBeCloseTo(on.endT, 9);
    // twin: counted as riding, the same defender keeps both clamps through the ending and they go on loading the carrier
    const rider = await linkRun(FL, 3, { cap: LIMB_CAP, asWrap8: false, allRide: true });
    expect(rider.kept.map((k) => k.arm).sort()).toEqual(['left', 'right']);
    expect(rider.playEnded).toEqual([]);
    expect(rider.clampEntries.length).toBeGreaterThan(0);
  }, 60_000);

  it('(g) conservation through the whistle (the rear wrap): the kept clamps\' forces after the ending and the link\'s are each paired, under the per-arm ceiling and the owner budget; the link\'s net work never goes positive; the energy meter and the audits stay clean. The checks\' twins: the owner\'s force dropped, the pull made a push', async () => {
    const on = await linkRun(FL, 3, { cap: REAR_CAP });
    expect(on.entries.length).toBeGreaterThan(20);
    expect(unpaired(on.entries)).toEqual([]);
    expect(on.entries.every((e) => e.actual <= Math.min(700, 1000 * FL.budgetFraction) + 1e-9)).toBe(true);
    expect(maxNetWorkJ(on.workJ)).toBeLessThan(0.01);
    expect(on.clampEntries.length).toBeGreaterThan(20);
    expect(unpaired(on.clampEntries)).toEqual([]);
    expect(on.clampEntries.every((e) => e.actual <= 700 + 1e-9)).toBe(true);
    const perStep = new Map<number, number>();
    for (const e of on.clampEntries) perStep.set(e.step, (perStep.get(e.step) ?? 0) + e.actual);
    expect(Math.max(...perStep.values())).toBeLessThanOrEqual(1000 + 1e-9);
    expect(on.injecting).toEqual({ D: 0, R: 0 });
    expect(on.auditsOk).toBe(true);
    // the checks' twins on the same entries
    expect(unpaired(on.clampEntries.map((e) => ({ ...e, forceOnOwner: scale(e.forceOnOwner, 0) }))).length).toBeGreaterThan(20);
    expect(unpaired(on.entries.map((e) => ({ ...e, forceOnOwner: scale(e.forceOnOwner, 0) }))).length).toBeGreaterThan(20);
    expect(maxNetWorkJ(on.workJ.map((w) => -w))).toBeGreaterThan(0.01);
  }, 60_000);

  it('(i) born yield: in the simultaneous low wrap (HC-F1-low, both switched at 1.20 s) the tackler\'s links begin with the carrier\'s left upper arm born 9 cm in his torso; giving way to the separation of that pair, born at their own switch, they let out their slack, no limb stays visibly in the other body (as under WRAP_V8), and they live on until the patch is out of reach, never on stretch. Twins: pulling through it the links hold the arm in his torso (over 5 cm for over 0.1 s); slack without letting out (the first try), they end on stretch', async () => {
    const cap = loadState(BORN_CAP);
    const def = asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V8 }));
    // (the arm system's link profile set on the resume, as `linkRun` does: null is WRAP_V8's arms, no link)
    const look = async (link: (FallLinkProfile & { bornDead?: boolean }) | null) => {
      const bar = heldBornBar();
      const sim = await resumeState(cap, { def, opts: { onSubstep: bar.substep } });
      const A = (sim as unknown as LinkPriv).arms;
      A.fallLink = link ? { ...link } : undefined;
      let letOutM = 0;
      while (!sim.done) {
        sim.stepTick();
        for (const s of SIDES) letOutM = Math.max(letOutM, A.arms.get('D')![s].link?.letOutM ?? 0);
      }
      const links = sim.events.filter((e) => e.type === 'fallLinkBegin' && e.playerId === 'D' && e.data?.ok).map((e) => e.data!.arm as string).sort();
      const ends = sim.events.filter((e) => e.type === 'fallLinkEnd' && e.playerId === 'D').map((e) => e.data!.reason as string);
      const out = { links, ends, letOutM, breaches: bar.of('R')!.breaches(), deepest: bar.of('R')!.deepest().d };
      sim.dispose();
      return out;
    };
    const on = await look(FL);
    const pull = await look(FL_PULL);
    const dead = await look(FL_DEAD);
    const v8 = await look(null);
    const said = JSON.stringify({ on, pull, dead, v8 });
    expect(on.links, said).toEqual(['left', 'right']);
    expect(pull.links, said).toEqual(['left', 'right']);
    expect(v8.links, said).toEqual([]);
    expect(on.deepest, said).toBeGreaterThan(0.05);
    expect(on.breaches, said).toEqual([]);
    expect(v8.breaches, said).toEqual([]);
    expect(pull.breaches.length, said).toBeGreaterThan(0);
    expect(pull.breaches.join(' '), said).toMatch(/R leftUpperArm:upperArm in D:core:torso/);
    // alive through the separation: only the reach rule ends them, with the slack let out; the first try's dead slack ends them on stretch
    expect(on.letOutM, said).toBeGreaterThan(0.1);
    expect(on.ends.includes('separation'), said).toBe(false);
    expect(dead.ends.length, said).toBeGreaterThan(0);
    expect(dead.ends.every((r) => r === 'separation'), said).toBe(true);
    expect(dead.letOutM, said).toBe(0);
  }, 180_000);

  it('(d) the hold flip: every L3, L4 and HC wrap fixture registers the fall link (WRAP_V13 since the aim flip, on WRAP_V12, WRAP_V11, WRAP_V10 and WRAP_V9); the lab\'s wrap=v8 runs it with WRAP_V8 (before the flip), wrap=on takes it back; WRAP_V6 stays unregistered; G, L1, L2 and RH register no wrap', () => {
    const on = FIX('L3-F5-drag');
    expect(on.wrap).toBe(WRAP_V13);
    expect(on.wrap!.fallLink).toBe(WRAP_V9.fallLink);
    const v8: FixtureDef = { ...on, wrap: WRAP_V8 };
    const v9: FixtureDef = { ...on, wrap: WRAP_V9 };
    expect(labRun(on, new URLSearchParams('wrap=v8'))).toEqual({ def: v8, opts: {}, label: 'wrap v8' });
    expect(labRun(v8, new URLSearchParams('wrap=on'))).toEqual({ def: on, opts: {}, label: 'wrap on' });
    expect(labRun(v8, new URLSearchParams('wrap=v9'))).toEqual({ def: v9, opts: {}, label: 'wrap v9' });
    expect(labRun(v9, new URLSearchParams('wrap=v9'))).toEqual({ def: v9, opts: {}, label: 'wrap v9 (registered)' });
    const all = allFixtures();
    expect(all.filter((d) => d.wrap && d.wrap.id !== WRAP_V13.id).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap && !/^(L3|L4|HC)-/.test(d.id)).map((d) => d.id)).toEqual([]);
    expect(all.filter((d) => d.wrap?.fallLink).length).toBeGreaterThan(0);
  });
});
