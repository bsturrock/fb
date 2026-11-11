// Full check: the leg matrix (ported from the old tree's .scratch/cmp/legmx.ts). Every fixture with a leg-guard profile,
// both body orders, shard i of n: the run's result and, per player, its conversion time and end mode, the largest
// one-substep player-player contact impulse on the player and on its leg colliders (from the solve's contact records),
// and the leg ledger (largest one-substep leg impulse and when, substeps with an impulse while ungrounded, totals) --
// reported as "absent" on a tree without one. JSON lines {k, id, rev, ...} to the output file (k = registry index, for
// the merge's order). Env ONLY=<regex> limits the fixtures; LEGV2=1 runs them under LEG_GUARD_V2 (a tree that has it).
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import * as profiles from '../../src/sim/profiles';
import { LEG_REGIONS, round, shardArgs } from './lib';

const { i, n, out } = shardArgs();
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const v2 = (profiles as Record<string, unknown>).LEG_GUARD_V2;
if (process.env.LEGV2 && !v2) {
  console.error('LEGV2 is set but this tree has no LEG_GUARD_V2');
  process.exit(2);
}

interface Peak {
  ns: number;
  at: number | null;
}
const bump = (p: Peak, ns: number, t: number): void => {
  if (ns > p.ns) Object.assign(p, { ns, at: t });
};

const all = allFixtures();
const lines: string[] = [];
for (let k = 0; k < all.length; k++) {
  const d0 = all[k];
  if (!d0.legGuard || k % n !== i || (only && !only.test(d0.id))) continue;
  const d = process.env.LEGV2 ? { ...d0, legGuard: v2 as typeof d0.legGuard } : d0;
  for (const rev of [false, true]) {
    const contact = new Map<string, { all: Peak; leg: Peak }>();
    const led = new Map<string, { last: number; peak: Peak; ungrounded: number }>();
    let hasLedger = false;
    const sample = (s: Simulation): void => {
      const S = s as unknown as { legLedger?: unknown };
      // contact records of this substep's solve: player-player manifolds, summed per player (and its leg colliders)
      const tot = new Map<string, number>();
      const leg = new Map<string, number>();
      for (const c of s.contacts) {
        const pa = c.a.playerId;
        const pb = c.b.playerId;
        if (!pa || !pb || pa === pb) continue;
        for (const side of [c.a, c.b]) {
          const id = side.playerId!;
          tot.set(id, (tot.get(id) ?? 0) + c.impulse);
          if (LEG_REGIONS.has(side.region)) leg.set(id, (leg.get(id) ?? 0) + c.impulse);
        }
      }
      for (const p of s.players) {
        const o = contact.get(p.id) ?? { all: { ns: 0, at: null }, leg: { ns: 0, at: null } };
        contact.set(p.id, o);
        bump(o.all, tot.get(p.id) ?? 0, s.t);
        bump(o.leg, leg.get(p.id) ?? 0, s.t);
      }
      // the leg ledger (a later rung's feature): impulse added in this substep, per player
      if (!(S.legLedger instanceof Map)) return;
      hasLedger = true;
      for (const [id, L] of S.legLedger as Map<string, { impulseNs?: number }>) {
        const o = led.get(id) ?? { last: 0, peak: { ns: 0, at: null }, ungrounded: 0 };
        led.set(id, o);
        const now = L.impulseNs ?? 0;
        const j = now - o.last;
        o.last = now;
        bump(o.peak, j, s.t);
        if (j > 0 && !s.players.find((p) => p.id === id)?.grounded) o.ungrounded++;
      }
    };
    const sim = await Simulation.create(d, { ...(rev ? { reverseOrder: true } : {}), onSubstep: sample });
    while (!sim.done) sim.stepTick();
    const S = sim as unknown as { legLedger?: Map<string, Record<string, unknown>> };
    const num = (x: unknown): number | string | null => (typeof x === 'number' ? round(x) : null);
    const pl: Record<string, unknown> = {};
    for (const p of [...sim.players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const c = contact.get(p.id);
      const L = hasLedger ? S.legLedger!.get(p.id) : undefined;
      const o = led.get(p.id);
      pl[p.id] = {
        conv: p.handoff ? round(p.handoff.t) : null,
        mode: p.controlMode,
        contactPeakNs: round(c?.all.ns ?? 0),
        contactPeakAt: c?.all.at == null ? null : round(c.all.at),
        legContactPeakNs: round(c?.leg.ns ?? 0),
        legContactPeakAt: c?.leg.at == null ? null : round(c.leg.at),
        ledger: !hasLedger
          ? 'absent'
          : {
              peakNs: round(o?.peak.ns ?? 0),
              at: o?.peak.at == null ? null : round(o.peak.at),
              ungrounded: o?.ungrounded ?? 0,
              J: num(L?.impulseNs),
              sub: num(L?.substeps),
              injJ: num(L?.injectedJ),
              depth: num(L?.maxDepthM),
            },
      };
    }
    lines.push(JSON.stringify({ k, id: d.id, rev, legGuard: d.legGuard?.id ?? null, result: sim.result, pl }));
    sim.dispose();
  }
}
writeFileSync(out, lines.map((l) => l + '\n').join(''));
