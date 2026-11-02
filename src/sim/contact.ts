// Geometric classification of solved player-player contacts. Classification is observational: it adds no impulse.
import type { ArmSide, ColliderRegion, ContactRec, ContactRegionClass, PlayerContactObs, PlayerId } from './contracts';
import { shoulderLocal, type BodyProfile } from './profiles';
import { dist, neg, toWorld, type Pose, type Vec3 } from './vec';

export interface ClassifyInput {
  pose: Pose;
  body: BodyProfile;
  selectedShoulder?: ArmSide;
}

export function classifyPoint(region: ColliderRegion, point: Vec3, who: ClassifyInput | undefined): ContactRegionClass {
  switch (region) {
    case 'head':
      return 'head';
    case 'torso': {
      if (!who) return 'torso';
      const r = who.body.shoulderPatchRadiusM;
      const dl = dist(point, toWorld(who.pose, shoulderLocal(who.body, 'left')));
      const dr = dist(point, toWorld(who.pose, shoulderLocal(who.body, 'right')));
      const sel = who.selectedShoulder;
      if (sel) {
        const dSel = sel === 'left' ? dl : dr;
        const dOther = sel === 'left' ? dr : dl;
        if (dSel <= r) return 'shoulder:selected';
        if (dOther <= r) return 'shoulder:other';
        return 'torso';
      }
      if (Math.min(dl, dr) <= r) return dl <= dr ? 'shoulder:left' : 'shoulder:right';
      return 'torso';
    }
    case 'pelvis':
      return 'pelvis';
    case 'support':
      return 'support';
    case 'capsule':
      return 'capsule';
    default:
      return 'limb';
  }
}

const PRIORITY: ContactRegionClass[] = [
  'head',
  'shoulder:selected',
  'shoulder:other',
  'shoulder:left',
  'shoulder:right',
  'torso',
  'pelvis',
  'support',
  'capsule',
  'limb',
];
const rank = (c: ContactRegionClass): number => PRIORITY.indexOf(c);

/**
 * Per-player observations of player-player manifolds. Every real manifold point is classified; the reported class is
 * the highest-priority one (head first, so a head strike can never be hidden behind a shoulder label).
 */
export function observePlayerContacts(
  contacts: ContactRec[],
  who: Record<PlayerId, ClassifyInput>,
): Record<PlayerId, PlayerContactObs[]> {
  const out: Record<PlayerId, PlayerContactObs[]> = {};
  for (const id of Object.keys(who)) out[id] = [];
  for (const c of contacts) {
    const pa = c.a.playerId;
    const pb = c.b.playerId;
    if (!pa || !pb || pa === pb) continue;
    let ca: ContactRegionClass = 'limb';
    let cb: ContactRegionClass = 'limb';
    let pta = c.points[0].pointWorld;
    let ptb = c.points[0].pointWorld;
    let first = true;
    for (const p of c.points) {
      const xa = classifyPoint(c.a.region, p.pointWorld, who[pa]);
      const xb = classifyPoint(c.b.region, p.pointWorld, who[pb]);
      if (first || rank(xa) < rank(ca)) {
        ca = xa;
        pta = p.pointWorld;
      }
      if (first || rank(xb) < rank(cb)) {
        cb = xb;
        ptb = p.pointWorld;
      }
      first = false;
    }
    out[pa]?.push({
      other: pb,
      ownRegion: c.a.region,
      ownClass: ca,
      otherRegion: c.b.region,
      otherClass: cb,
      pointWorld: pta,
      normalFromOther: neg(c.normalAB),
      impulse: c.impulse,
    });
    out[pb]?.push({
      other: pa,
      ownRegion: c.b.region,
      ownClass: cb,
      otherRegion: c.a.region,
      otherClass: ca,
      pointWorld: ptb,
      normalFromOther: c.normalAB,
      impulse: c.impulse,
    });
  }
  return out;
}
