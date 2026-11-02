// Self-contact filter check: are same-owner ragdoll pairs solved?
import { Simulation } from '../../src/sim/simulation';
import * as G4 from '../../src/sim/fixtures/gate4';
const sim = await Simulation.create(G4.g4f5Standing());
const ph: any = sim.physics;
let calls = 0, rejected = 0;
const orig = ph.hooks.filterContactPair;
ph.hooks.filterContactPair = (a: number, b: number, c: number, d: number) => { calls++; const r = orig(a, b, c, d); if (r === null) rejected++; return r; };
let self = 0, selfImp = 0;
while (!sim.done) { sim.stepTick(); for (const c of sim.contacts) if (c.a.playerId && c.a.playerId === c.b.playerId) { self++; selfImp += c.impulse; } }
console.log({ calls, rejected, self, selfImp });
