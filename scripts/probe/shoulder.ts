// Probe: wrapped-target conversions with the shoulder pivot at x = 0.26 (spec placeholder) vs 0.20 / 0.22.
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { armsSetup } from '../../src/sim/fixtures/gate2';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
const line = (vr: number, plan: any, arms: any, tag: string): FixtureDef => {
  const def: FixtureDef = { ...G3.g3f3Side(vr, 'x', 7), gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, id: tag, durationS: 2.5 };
  const D = def.players.find((p) => p.id === 'D')!;
  D.controller = { kind: 'wrapAttempt', plan, approachSpeedMps: 7, closingGainPerS: 1000, matchRunnerVelocity: false, interceptLead: true, driveInMps: 7, approachLeanDeg: 12, approachVelocityWorld: v3(0, 0, 7), ...(process.argv[2] === 'fin' ? { finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0, minProgressMps: -100 } } : {}) } as any;
  D.arms = arms;
  return def;
};
const mk: [string, () => FixtureDef][] = [
  ['F10-R', () => ({ ...G3.balancedVariant(G2.g2f5()), gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, durationS: 2.6, diagnostics: { conversions: [{ playerId: 'R', atS: 1.2 }] } })],
  ['F10-RD', () => ({ ...G3.balancedVariant(G2.g2f5()), gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, durationS: 2.6, diagnostics: { conversions: [{ playerId: 'R', atS: 1.2 }, { playerId: 'D', atS: 1.2 }] } })],
  ['lineBoth-r4', () => line(4, { left: 'wrap', right: 'wrap' }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false }), 'lineBoth-r4')],
  ['lineBoth-r3', () => line(3, { left: 'wrap', right: 'wrap' }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false }), 'lineBoth-r3')],
  ['lineRight-r4', () => line(4, { left: 'none', right: 'wrap' }, armsSetup(null, 'forearmClamp', { acquisition: false }), 'lineRight-r4')],
  ['lineLeft-r4', () => line(4, { left: 'wrap', right: 'none' }, armsSetup('forearmClamp', null, { acquisition: false }), 'lineLeft-r4')],
  ['lineLeft-r3', () => line(3, { left: 'wrap', right: 'none' }, armsSetup('forearmClamp', null, { acquisition: false }), 'lineLeft-r3')],
];
for (const sx of [0.2]) {
  for (const [tag, f] of mk) {
    const def = f();
    for (const p of def.players) p.body = { ...p.body, shoulderRight: v3(sx, 0.5, 0) };
    const sim = await Simulation.create(def);
    sim.runToEnd();
    const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
    const rej = sim.events.filter((e) => e.type === 'handoffRejected').map((e) => `${e.playerId}:${e.data!.reasons}:${(e.data!.worstExternal as any)?.own}>${(e.data!.worstExternal as any)?.other}:${Number(e.data!.maxNewExternalPenetrationM).toFixed(3)}`);
    const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
    console.log(`sx ${sx}`, tag.padEnd(13), sim.result.padEnd(19), 'loss', loss.join(',').padEnd(14), sim.players.map((p) => p.id + ':' + p.representation).join(' '), 'wraps', ws.join(','), rej.length ? 'REJ ' + rej.join(' ') : '');
    sim.dispose();
  }
}
