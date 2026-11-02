import { Simulation, type SimOptions, type TraceRow } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';

export async function run(def: FixtureDef, opts: SimOptions = {}): Promise<Simulation> {
  const sim = await Simulation.create(def, opts);
  sim.runToEnd();
  return sim;
}

export const hyp = (x: number, z: number): number => Math.hypot(x, z);
export const speedH = (row: TraceRow, id: string): number => hyp(row.players[id].v[0], row.players[id].v[2]);

/** Max absolute difference between two traces for the given players (position/velocity/yaw). */
export function traceDiff(a: TraceRow[], b: TraceRow[], ids: string[]): { pos: number; vel: number; yaw: number; ticks: number } {
  const n = Math.min(a.length, b.length);
  let pos = 0;
  let vel = 0;
  let yaw = 0;
  for (let i = 0; i < n; i++)
    for (const id of ids) {
      const pa = a[i].players[id];
      const pb = b[i].players[id];
      for (let k = 0; k < 3; k++) {
        pos = Math.max(pos, Math.abs(pa.p[k] - pb.p[k]));
        vel = Math.max(vel, Math.abs(pa.v[k] - pb.v[k]));
      }
      let dy = Math.abs(pa.yaw - pb.yaw);
      if (dy > Math.PI) dy = 2 * Math.PI - dy;
      yaw = Math.max(yaw, dy);
    }
  return { pos, vel, yaw, ticks: Math.abs(a.length - b.length) };
}

export const firstContactT = (sim: Simulation): number | null => {
  const e = sim.events.find((x) => x.type === 'contactBegin');
  return e ? e.t : null;
};
