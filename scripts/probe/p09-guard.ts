// Plan 09 review: would a pre-solve impact guard (geometric closing speed per limb, or the last solve's contact impulse)
// have removed every effort power overrun, and how many substeps would it hold off? Offline estimate: a guarded
// joint's realized power is dropped, the others kept as measured.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
import { FallResponse } from '../../src/sim/fall-response';
import { dot, sub, vc } from '../../src/sim/vec';
const GROUP: Record<string, string> = { core: 'core', head: 'core', leftUpperArm: 'leftArm', leftForearm: 'leftArm', rightUpperArm: 'rightArm', rightForearm: 'rightArm', leftThigh: 'leftLeg', leftShin: 'leftLeg', rightThigh: 'rightLeg', rightShin: 'rightLeg' };
const JG = (j: string): string => (j.includes('Shoulder') || j.includes('Elbow') ? (j.startsWith('left') ? 'leftArm' : 'rightArm') : j.startsWith('left') ? 'leftLeg' : 'rightLeg');
const CEIL = 157.5;
type Row = { id: string; key: string; closing: Record<string, number>; impulse: Record<string, number>; joints: { joint: string; w: number }[] };
const rows: Row[] = [];
const origReq = FallResponse.prototype.request;
let simRef: any = null;
let fid = '';
const feats = new Map<string, Row>();
FallResponse.prototype.request = function (ep, contacts, arms) {
  const s = simRef;
  const closing: Record<string, number> = {};
  const impulse: Record<string, number> = {};
  const rag = ep.rag;
  const ext: { c: any; body: any }[] = [{ c: s.physics.floorCollider, body: null }];
  for (const o of s.players) if (o.id !== ep.playerId) for (const c of s.activeColliders(o)) ext.push({ c, body: c.parent() });
  for (const rc of rag.colliders) {
    const g = GROUP[rc.segment];
    const own = rc.collider;
    const body = rag.bodies[rc.segment];
    for (const e of ext) {
      const r = e.c.shape.contactShape(e.c.translation(), e.c.rotation(), own.shape, own.translation(), own.rotation(), 0.1);
      if (!r) continue;
      const vOwn = vc(body.velocityAtPoint(r.point2));
      const vOther = e.body ? vc(e.body.velocityAtPoint(r.point1)) : { x: 0, y: 0, z: 0 };
      const cl = -dot(sub(vOwn, vOther), vc(r.normal1));
      if (r.distance - cl * s.physics.dt * 1.5 < 0.002) closing[g] = Math.max(closing[g] ?? 0, cl);
    }
  }
  for (const c of contacts)
    for (const t of [c.a, c.b]) if (t.playerId === ep.playerId) {
      const seg = t.key.split(':')[0];
      const g = GROUP[seg] ?? 'core';
      impulse[g] = Math.max(impulse[g] ?? 0, c.impulse);
    }
  feats.set(`${ep.playerId}@${s.steps}`, { id: fid, key: `${ep.playerId}@${s.steps}`, closing, impulse, joints: [] });
  return origReq.call(this, ep, contacts, arms);
};
for (const def of fallFixtures()) {
  fid = def.id;
  feats.clear();
  const sim = await Simulation.create(def, { trace: false });
  simRef = sim;
  sim.runToEnd();
  if (sim.fall) for (const e of sim.fall.ledger) feats.get(`${e.owner}@${e.step}`)?.joints.push({ joint: e.joint, w: e.realizedW });
  for (const r of feats.values()) if (r.joints.length) rows.push(r);
  sim.dispose();
}
const evalRule = (name: string, guard: (r: Row, g: string) => boolean): void => {
  let guarded = 0;
  let over = 0;
  const left: string[] = [];
  for (const r of rows) {
    const gs = new Set(['core', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].filter((g) => guard(r, g)));
    const all = gs.has('core');
    if (gs.size) guarded++;
    const pos = r.joints.filter((j) => !(all || gs.has(JG(j.joint)))).reduce((a, j) => a + Math.max(0, j.w), 0);
    if (pos > CEIL) {
      over++;
      left.push(`${r.id} ${r.key} ${pos.toFixed(0)}`);
    }
  }
  console.log(`${name}: guarded ${guarded}/${rows.length} substeps, over ${over}${left.length ? ' ' + left.join(', ') : ''}`);
};
evalRule('none', () => false);
for (const v of [0.25, 0.5, 1, 1.5, 2]) evalRule(`closing>${v}`, (r, g) => (r.closing[g] ?? 0) > v);
for (const J of [2, 5, 10]) evalRule(`impulse>${J}`, (r, g) => (r.impulse[g] ?? 0) > J);
for (const v of [0.5, 1]) for (const J of [5, 10]) evalRule(`closing>${v}|impulse>${J}`, (r, g) => (r.closing[g] ?? 0) > v || (r.impulse[g] ?? 0) > J);
