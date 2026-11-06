// Plan 07 item 3 probe: per-substep foot geometry around a clip-to-procedural crossing (hip-ankle distance, flat-shoe
// plant reach, horizontal ankle-hip offset along travel, shoe pitch, clip swing progress, request). Usage:
// vite-node scripts/probe/p07-crossgeo.ts [id] [from] [to]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import type { FootPlanInput } from '../../src/sim/footwork';
import { qRot, v3 } from '../../src/sim/vec';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const id = pos[0] ?? 'L2-F3-runStop';
const from = Number(pos[1] ?? 3.13);
const to = Number(pos[2] ?? 3.2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const proto = Object.getPrototypeOf(sim) as { footInput: (...a: unknown[]) => FootPlanInput };
const orig = proto.footInput;
const r3 = (x: number): string => x.toFixed(3);
proto.footInput = function (this: Simulation, ...a: unknown[]): FootPlanInput {
  const inp = orig.apply(this, a);
  if (inp.t >= from && inp.t <= to) {
    const p = this.players[0];
    const parts = (['left', 'right'] as const).map((s) => {
      const f = p.feet!.feet[s];
      const hip = inp.hips[s];
      const fwd = qRot(f.footQ, v3(0, 0, 1));
      const pitch = (Math.asin(Math.max(-1, Math.min(1, -fwd.y))) * 180) / Math.PI;
      const flat = Math.hypot(f.featureW.x - hip.x, inp.groundY + inp.soleM - hip.y, f.featureW.z - hip.z);
      const ank = Math.hypot(f.ankleW.x - hip.x, f.ankleW.y - hip.y, f.ankleW.z - hip.z);
      const dx = (f.ankleW.x - hip.x) * Math.sign(inp.vel.x || 1);
      const lat = f.ankleW.z - hip.z;
      return `${s[0]} hipY ${r3(hip.y)} lat ${r3(lat)} ${f.mode[0]}${f.source[0]}${f.wait ? 'w' : ' '} gap ${r3(f.gapM)} hipAnk ${r3(ank)} flat ${r3(flat)} dx ${r3(dx)} pitch ${pitch.toFixed(1)} csp ${f.clipSwingP === null ? '-' : r3(f.clipSwingP)} cswp ${inp.clip?.swingP?.[s] ?? '-'}`;
    });
    console.log(`${inp.t.toFixed(4)} w ${inp.clip ? r3(inp.clip.weight) : '0'} | ${parts.join(' | ')}`);
  }
  return inp;
};
while (!sim.done && sim.t < to) sim.stepTick();
sim.dispose();
