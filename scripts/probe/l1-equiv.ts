// Probe (plan 06): physical trace of the G4-F3-*-M drills vs the same requests with the run clips (L1-F5..F7), up to the first handoff.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
for (const [a, b] of [['G4-F3-twoArm-M', 'L1-F5-twoArm'], ['G4-F3-oneArm-M', 'L1-F6-oneArm'], ['G4-F3-failed-M', 'L1-F7-failed']]) {
  const da = allFixtures().find((d) => d.id === a)!, db = allFixtures().find((d) => d.id === b)!;
  const sa = await Simulation.create(da), sb = await Simulation.create(db);
  let firstDiff = -1, tH = Infinity, maxD = 0;
  while (!sa.done && !sb.done) {
    sa.stepTick(); sb.stepTick();
    if (sa.players.some((p) => p.handoff) || sb.players.some((p) => p.handoff)) { tH = sa.t; break; }
    const ra = sa.trace[sa.trace.length - 1].players, rb = sb.trace[sb.trace.length - 1].players;
    for (const id of Object.keys(ra)) {
      const pa = ra[id].p, pb = rb[id].p;
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      maxD = Math.max(maxD, d);
      if (d > 0 && firstDiff < 0) firstDiff = sa.t;
    }
  }
  console.log(a, b, 'firstHandoff', tH.toFixed(3), 'maxCoreDiff', maxD, 'firstDiffT', firstDiff);
  console.log('  ', a, sa.players.map(p=>p.handoff ? `${p.id}:${p.handoff.outcome}@${p.handoff.t.toFixed(3)}` : `${p.id}:-`).join(' '), '|', b, sb.players.map(p=>p.handoff ? `${p.id}:${p.handoff.outcome}@${p.handoff.t.toFixed(3)}` : `${p.id}:-`).join(' '));
}
