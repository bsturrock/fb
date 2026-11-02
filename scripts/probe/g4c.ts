// G4-C scenario probes: push stalemate, give-way, grounded-then-touched, defender falls alone, F5 collisions.
import { Simulation } from '../../src/sim/simulation';
import { base4, bodyG4 } from '../../src/sim/fixtures/gate4';
import { RULES_FOOTBALL } from '../../src/sim/profiles';
import type { FixtureDef, PlayerSetup } from '../../src/sim/fixture';
import { v3, type Vec3 } from '../../src/sim/vec';
const pl = (id: 'R' | 'D', x: number, z: number, yawDeg: number, segs: { fromS: number; velocity: Vec3; facing: Vec3; effort?: number }[], velocity?: Vec3): PlayerSetup =>
  ({ id, role: id === 'R' ? 'runner' : 'defender', body: bodyG4(), initial: { x, z, yawDeg, velocity }, controller: { kind: 'script', segments: segs } });
const F = (id: string, players: PlayerSetup[], extra: Partial<FixtureDef> = {}): FixtureDef =>
  base4({ id, milestone: 'x', title: '', durationS: 4, rules: RULES_FOOTBALL('R', { sideline: false }), players, ...extra });
const X = v3(1, 0, 0), NX = v3(-1, 0, 0);
const cases: FixtureDef[] = [];
for (const sp of [1.5, 2.5]) cases.push(F(`stalemate-${sp}`, [pl('R', -0.45, 0, 90, [{ fromS: 0, velocity: v3(sp, 0, 0), facing: X, effort: 1 }]), pl('D', 0.45, 0, -90, [{ fromS: 0, velocity: v3(-sp, 0, 0), facing: NX, effort: 1 }])]));
cases.push(F('giveway', [pl('R', -0.45, 0, 90, [{ fromS: 0, velocity: v3(2.5, 0, 0), facing: X, effort: 1 }]), pl('D', 0.45, 0, -90, [{ fromS: 0, velocity: v3(-2.5, 0, 0), facing: NX, effort: 1 }, { fromS: 0.6, velocity: v3(0, 0, 3), facing: NX, effort: 1 }])]));
cases.push(F('groundedTouched', [pl('R', 0, 0, 90, [{ fromS: 0, velocity: v3(), facing: X }]), pl('D', 2.6, 0.0, -90, [{ fromS: 0, velocity: v3(), facing: NX }, { fromS: 1.6, velocity: v3(-1.2, 0, 0), facing: NX, effort: 0.6 }])], { diagnostics: { conversions: [{ playerId: 'R', atS: 0.3 }] }, durationS: 5 }));
cases.push(F('defFallsAlone', [pl('R', 0, 0, 90, [{ fromS: 0, velocity: v3(1, 0, 0), facing: X, effort: 1 }], v3(1, 0, 0)), pl('D', 0.4, -1.6, 0, [{ fromS: 0, velocity: v3(0, 0, 3), facing: v3(0, 0, 1), effort: 1 }], v3(0, 0, 3))], { diagnostics: { conversions: [{ playerId: 'D', atS: 0.3 }] }, durationS: 3 }));
cases.push(F('F5-standing', [pl('R', -1.6, 0, 90, [{ fromS: 0, velocity: v3(3, 0, 0), facing: X }], v3(3, 0, 0)), pl('D', 0, 0, -90, [{ fromS: 0, velocity: v3(), facing: NX, effort: 1 }])], { diagnostics: { conversions: [{ playerId: 'R', atS: 0.3 }] }, durationS: 3, rules: undefined }));
cases.push(F('F5-twoRag', [pl('R', -1.2, 0.1, 90, [{ fromS: 0, velocity: v3(3, 0, 0), facing: X }], v3(3, 0, 0)), pl('D', 1.2, -0.1, -90, [{ fromS: 0, velocity: v3(-3, 0, 0), facing: NX }], v3(-3, 0, 0))], { diagnostics: { conversions: [{ playerId: 'R', atS: 0.15 }, { playerId: 'D', atS: 0.15 }] }, durationS: 3, rules: undefined }));
for (const def of cases) {
  const sim = await Simulation.create(def);
  let rr = 0, rp = 0, minGap = 9;
  while (!sim.done) {
    sim.stepTick();
    for (const c of sim.contacts) if (c.a.playerId && c.b.playerId && c.a.playerId !== c.b.playerId) {
      if (sim.players.every((p) => p.rag)) rr++; else if (sim.players.some((p) => p.rag)) rp++;
      for (const p of c.points) minGap = Math.min(minGap, p.dist);
    }
  }
  const ev = sim.events.filter((e) => ['ruleEnding', 'lossOfSupport', 'handoffRejected', 'influenceBegin', 'influenceCleared', 'progressWindow', 'groundWithoutInfluence', 'representation'].includes(e.type)).map((e) => `${e.t.toFixed(2)}:${e.type}:${e.playerId ?? ''}:${(e.data as any).kind ?? (e.data as any).phase ?? (e.data as any).reasons ?? (e.data as any).region ?? (e.data as any).trigger ?? ''}${(e.data as any).reason ? '/' + (e.data as any).reason : ''}`);
  const R = sim.players.find((p) => p.id === 'R')!;
  console.log('==', def.id, sim.result, sim.t.toFixed(2), 'R', R.representation, R.controlMode, 'pairContacts rag-rag', rr, 'rag-proxy', rp, 'minDist', minGap.toFixed(3));
  console.log('   ', ev.join(' ').slice(0, 900));
  sim.dispose();
}
