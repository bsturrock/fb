// Probe (plan 06): leg target methods on the rest core. floor = floor-anchored heights; hip = clip hip->ankle vector
// from the player's hip (leg shape kept). After a minimal-lift floor solve: knee, shin tilt, lowest shoe point gap.
import { modelBody, modelRagdoll } from '../../src/sim/model/profiles';
import { runClipsBew } from '../../src/sim/model/run-clips';
import { sampleRunClip } from '../../src/sim/run-clip';
import { floorDepth, hingeChain, legShapes, twoBone } from '../../src/sim/pose';
import { hipLocal } from '../../src/sim/profiles';
import { add, closestOnSegment, norm, qRot, sub, toWorld, v3, type Pose, type Vec3 } from '../../src/sim/vec';
const P = runClipsBew();
const body = modelBody();
const R = modelRagdoll();
const core: Pose = { p: v3(0, 0.9495, 0), q: { x: 0, y: 0, z: 0, w: 1 } };
const clip = P.clips[Number(process.argv[2] ?? 0)];
const straight = (R.validation.straightBendDeg * Math.PI) / 180;
const leg = R.lengths.thigh + R.lengths.shin;
function lowY(shapes: ReturnType<typeof legShapes>): number {
  // lowest point of the leg shapes (m), unclamped
  let lo = Infinity;
  for (const s of shapes) {
    if (s.kind === 'capsule') lo = Math.min(lo, Math.min(s.a.y, s.b.y) - s.r);
    else if (s.kind === 'ball') lo = Math.min(lo, s.c.y - s.r);
    else {
      const ex = qRot(s.q, v3(1, 0, 0)), ey = qRot(s.q, v3(0, 1, 0)), ez = qRot(s.q, v3(0, 0, 1));
      lo = Math.min(lo, s.c.y - (Math.abs(ex.y) * s.he.x + Math.abs(ey.y) * s.he.y + Math.abs(ez.y) * s.he.z));
    }
  }
  return lo;
}
const stance = clip.record.stance;
const inSt = (u: number, [a, b]: [number, number]) => (a <= b ? u >= a && u < b : u >= a || u < b);
for (const method of ['floor', 'hip']) {
  console.log('== method', method);
  let maxGap = 0, sumGap = 0, n = 0, maxLift = 0;
  for (let i = 0; i < 32; i++) {
    const u = i / 32;
    const smp = sampleRunClip(clip, u);
    const out: string[] = [];
    for (const s of ['left', 'right'] as const) {
      const c = smp.leg[s];
      const hip = toWorld(core, hipLocal(body, s));
      const t0: Vec3 = method === 'floor' ? v3(c.ankle.x * leg, 0.1058 + c.ankle.y * leg, c.ankle.z * leg) : add(hip, v3((c.ankle.x - c.hip.x) * leg, (c.ankle.y - c.hip.y) * leg, (c.ankle.z - c.hip.z) * leg));
      const k = closestOnSegment(c.knee, c.hip, c.ankle).point;
      const pole = norm(sub(c.knee, k), v3(0, 0, 1));
      const ev = (lift: number) => {
        const r = twoBone(hip, add(t0, v3(0, lift, 0)), R.lengths.thigh, R.lengths.shin, pole);
        const ch = hingeChain(hip, r.mid, [r.end], [v3(0, 0, -1), v3(0, -1, 0)], straight);
        const sh = legShapes(R, s, hip, r.mid, ch.ends[0], ch.frameB);
        const shin = norm(sub(r.mid, ch.ends[0]));
        return { fd: floorDepth(sh), low: lowY(sh), knee: (ch.angleRad * 180) / Math.PI, tilt: (Math.atan2(shin.z, shin.y) * 180) / Math.PI, ankle: ch.ends[0] };
      };
      let lift = 0, best = ev(0);
      if (best.fd > 0.001) {
        let lo = 0;
        for (let l = 0.005; l <= 0.3; l += 0.005) {
          if (ev(l).fd <= 0.001) { let a = lo, b = l; for (let q = 0; q < 8; q++) { const m = (a + b) / 2; if (ev(m).fd <= 0.001) b = m; else a = m; } lift = b; best = ev(b); break; }
          lo = l;
        }
      }
      const st = inSt(u, stance[s]);
      if (st) { maxGap = Math.max(maxGap, best.low); sumGap += best.low; n++; }
      maxLift = Math.max(maxLift, lift);
      out.push(`${s[0]}${st ? '*' : ' '} lift ${lift.toFixed(3)} knee ${best.knee.toFixed(0).padStart(3)} tilt ${best.tilt.toFixed(0).padStart(3)} low ${best.low.toFixed(3)}`);
    }
    console.log(u.toFixed(3), out.join(' | '));
  }
  console.log('stance gap max', maxGap.toFixed(3), 'mean', (sumGap / n).toFixed(3), 'max lift', maxLift.toFixed(3));
}
