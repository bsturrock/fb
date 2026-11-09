// Plan 13e idle acceptance. (1) Idle plays: on L3-F13-free with a second standing player 3 m beside it, 9 s, each free
// palm's path in the chest (core) frame against the cycle's at the player's phase (the procedural rest the pose aims at:
// the cycle's arm directions from the player's shoulder, at the walk profile's rest reach): worst distance after 0.3 s,
// how far each palm repeats after one period, how far it moves, and how far the two players' palms differ. (2) No
// marching: on every L3-F13 and L3-F15 fixture, the worst plant drift against the plan 07 tolerance, and every foot
// swing or release after the player has stood idle for 1 s (full idle weight, its own request zero; a conversion's
// release of both feet is not a step). (3) The head on the
// core against the cycle's measured bound. Exit 1 if any acceptance fails.
// Usage: npx vite-node scripts/probe/p13e-idle.ts
import { FIX, create } from '../../tests/runs';
import { allFixtures } from '../../src/sim/fixtures/index';
import { FOOTWORK_L3 } from '../../src/sim/footwork';
import { LOCOMOTION_L3_IDLE, sampleIdle } from '../../src/sim/locomotion';
import { chestArm } from '../../src/sim/run-clip';
import { shoulderLocal, sideSignX } from '../../src/sim/profiles';
import { add, dist, qConj, qMul, scale, sub, toLocal, v3, type Vec3 } from '../../src/sim/vec';
import type { FixtureDef } from '../../src/sim/fixture';

const C = LOCOMOTION_L3_IDLE.idle.cycle!;
const A = LOCOMOTION_L3_IDLE.walk;
let ok = true;

// (1) idle plays
const base = FIX('L3-F13-free');
const p0 = base.players[0];
const pair: FixtureDef = { ...base, id: 'L3-F13-free-pair', durationS: 9, players: [p0, { ...p0, id: 'P2', initial: { ...p0.initial, x: p0.initial.x + 3 } }] };
const sim = await create(pair);
const path: Record<string, Vec3[]> = {};
const worst: Record<string, number> = {};
let headDeg = 0;
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) {
    const core = sim.poseOf(pl);
    const smp = sampleIdle(C, sim.idlePhaseOf(pl));
    const mx = sideSignX(pl.body, 'left') > 0 ? 1 : -1;
    const hr = qMul(qConj(pl.pose!.segments.core.rotationWorld), pl.pose!.segments.head.rotationWorld);
    headDeg = Math.max(headDeg, (2 * Math.atan2(Math.hypot(hr.x, hr.y, hr.z), Math.abs(hr.w)) * 180) / Math.PI);
    for (const s of ['left', 'right'] as const) {
      const m = (c: Vec3): Vec3 => v3(c.x * mx, c.y, c.z);
      const r = chestArm(pl.body, sim.def.ragdoll!, s, m(smp.upper[s]), m(smp.fore[s]));
      const sh = shoulderLocal(pl.body, s);
      const want = add(sh, scale(sub(r.palmLocal, sh), A.restReach));
      const got = toLocal(core, pl.pose!.jointLandmarksWorld[`${s}Palm`]);
      const k = `${pl.id} ${s}`;
      (path[k] ??= []).push(got);
      if (sim.t > 0.3) worst[k] = Math.max(worst[k] ?? 0, dist(got, want));
    }
  }
}
const per = Math.round(C.periodS / sim.tickS);
const from = Math.round(0.5 / sim.tickS);
console.log(`(1) idle plays: ${pair.id}, ${sim.t.toFixed(2)} s, period ${C.periodS} s (${per} ticks)`);
for (const [k, ps] of Object.entries(path)) {
  let rep = 0;
  let span = 0;
  for (let i = from; i < ps.length; i++) {
    span = Math.max(span, dist(ps[i], ps[from]));
    if (i + per < ps.length) rep = Math.max(rep, dist(ps[i], ps[i + per]));
  }
  const pass = worst[k] <= 0.02 && rep < 0.001 && span > 0.005;
  ok &&= pass;
  console.log(`  ${k}: worst vs cycle ${(worst[k] * 1000).toFixed(2)} mm (accept 20), repeat ${(rep * 1000).toFixed(3)} mm, moves ${(span * 1000).toFixed(1)} mm ${pass ? '' : 'FAIL'}`);
}
for (const s of ['left', 'right']) {
  const a = path[`${p0.id} ${s}`];
  const b = path[`P2 ${s}`];
  const d = Math.max(...a.map((x, i) => dist(x, b[i])));
  ok &&= d > 0.005;
  console.log(`  ${s}: the two players differ by up to ${(d * 1000).toFixed(1)} mm`);
}
const headOk = headDeg <= C.headMaxDeg + 1e-3;
ok &&= headOk;
console.log(`(3) head on the core: worst ${headDeg.toFixed(3)} deg (cycle bound ${C.headMaxDeg}) ${headOk ? '' : 'FAIL'}`);
sim.dispose();

// (2) no marching
console.log('(2) no marching:');
for (const id of allFixtures().map((d) => d.id).filter((x) => /^L3-F1[35]-/.test(x))) {
  const def = FIX(id);
  const tol = (def.footwork ?? FOOTWORK_L3).plantTolM;
  const idleS = new Map<string, number>();
  let drift = 0;
  const after: string[] = [];
  const s2 = await create(def, {
    onSubstep: (s) => {
      for (const pl of s.players) {
        if (pl.rag || !pl.loco || !pl.feet) continue;
        const r = pl.intent.locomotion.desiredVelocityWorld;
        const idle = (pl.loco.idleW ?? 0) >= 0.99 && Math.hypot(r.x, r.z) === 0;
        idleS.set(pl.id, idle ? (idleS.get(pl.id) ?? 0) + s.dt : 0);
        for (const side of ['left', 'right'] as const) {
          const f = pl.feet.feet[side];
          if (f.mode === 'planted' && !f.tentative) drift = Math.max(drift, f.driftM);
        }
      }
    },
  });
  let seen = 0;
  while (!s2.done) {
    s2.stepTick();
    for (const e of s2.events.slice(seen)) if ((e.type === 'footSwing' || e.type === 'footRelease') && (e.data as { reason?: string })?.reason !== 'ragdoll' && (idleS.get(e.playerId!) ?? 0) >= 1) after.push(`${e.playerId} ${e.type} ${e.t.toFixed(4)}`);
    seen = s2.events.length;
  }
  const pass = drift <= tol && after.length === 0;
  ok &&= pass;
  console.log(`  ${id}: worst plant drift ${(drift * 1000).toFixed(2)} mm (tolerance ${tol * 1000} mm); steps after 1 s idle: ${after.join(', ') || 'none'} ${pass ? '' : 'FAIL'}`);
  s2.dispose();
}
console.log(ok ? 'PASS' : 'FAIL');
process.exitCode = ok ? 0 : 1;
