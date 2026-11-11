// State seed for one ragdoll player: capture (bodies, collider local poses, landmarks, limp foot, envelope, carry seat,
// fall episode) and apply it to another simulation's converted ragdoll of the same profile. Probe library.
const plain = (x: any) => JSON.parse(JSON.stringify(x));
const V = (v: any) => ({ x: v.x, y: v.y, z: v.z });
const Q = (q: any) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
export function captureSeed(sim: any, id: string): any {
  const pl = sim.players.find((p: any) => p.id === id);
  const r = pl.rag, ep = pl.fall;
  const bodies: any = {};
  for (const s of Object.keys(r.bodies)) {
    const b = r.bodies[s];
    const cols: any[] = [];
    for (let i = 0; i < b.numColliders(); i++) { const c = b.collider(i); cols.push({ t: V(c.translationWrtParent()), r: Q(c.rotationWrtParent()) }); }
    bodies[s] = { p: V(b.translation()), q: Q(b.rotation()), v: V(b.linvel()), w: V(b.angvel()), cols };
  }
  return {
    source: { fixture: sim.def.id, steps: sim.steps, t: sim.t },
    profile: r.profile.id,
    bodies,
    colliderLocals: r.colliders.map((c: any) => plain(c.local)),
    selfLocals: r.self ? r.self.arms.map((c: any) => plain(c.local)) : null,
    landmarks: plain(r.landmarks),
    anklePitchDeg: plain(r.anklePitchDeg ?? null),
    limpFoot: r.limpFoot ? { targetDeg: r.limpFoot.targetDeg, rateDegPerS: plain(r.limpFoot.rateDegPerS), heldSubsteps: plain(r.limpFoot.heldSubsteps) } : null,
    envelope: r.envelope ? plain(r.envelope) : null,
    carry: r.carry ? plain(r.carry) : null,
    fall: { tS: sim.t - ep.t0, role: ep.role, knee0: plain(ep.knee0), hipDir0: plain(ep.hipDir0), arms: plain(ep.arms), coreDown: ep.coreDown, exhausted: ep.exhausted, done: ep.done, stats: plain(ep.stats) },
  };
}
export function applySeed(sim: any, id: string, seed: any): void {
  // a fresh copy: the episode keeps (and mutates) the objects it is given, and a seed may be applied more than once
  const S = plain(seed);
  const pl = sim.players.find((p: any) => p.id === id);
  const r = pl.rag, ep = pl.fall;
  if (!r || !ep) throw new Error('seed: the host player has no ragdoll or fall episode yet');
  if (r.profile.id !== S.profile) throw new Error(`seed: ragdoll profile ${r.profile.id} is not the seed's ${S.profile}`);
  for (const s of Object.keys(S.bodies)) {
    const b = r.bodies[s], B = S.bodies[s];
    if (b.numColliders() !== B.cols.length) throw new Error(`seed: ${s} has ${b.numColliders()} colliders, the seed ${B.cols.length}`);
    B.cols.forEach((c: any, i: number) => { b.collider(i).setTranslationWrtParent(c.t); b.collider(i).setRotationWrtParent(c.r); });
    b.recomputeMassPropertiesFromColliders();
    b.setTranslation(B.p, true); b.setRotation(B.q, true); b.setLinvel(B.v, true); b.setAngvel(B.w, true);
  }
  r.colliders.forEach((c: any, i: number) => (c.local = S.colliderLocals[i]));
  if (r.self && S.selfLocals) r.self.arms.forEach((c: any, i: number) => (c.local = S.selfLocals[i]));
  for (const k of Object.keys(S.landmarks)) r.landmarks[k] = S.landmarks[k];
  if (S.anklePitchDeg) r.anklePitchDeg = S.anklePitchDeg;
  if (r.limpFoot && S.limpFoot) Object.assign(r.limpFoot, { targetDeg: S.limpFoot.targetDeg, rateDegPerS: S.limpFoot.rateDegPerS, heldSubsteps: S.limpFoot.heldSubsteps });
  if (r.envelope && S.envelope) S.envelope.forEach((e: any, i: number) => Object.assign(r.envelope[i], e));
  if (S.carry) r.carry = S.carry;
  Object.assign(ep, { t0: sim.t - S.fall.tS, knee0: S.fall.knee0, hipDir0: S.fall.hipDir0, arms: S.fall.arms, coreDown: S.fall.coreDown, exhausted: S.fall.exhausted, done: S.fall.done, stats: S.fall.stats });
  // the last solve's contact records belong to the host's own state, not the seed's (the seed is taken where none of the
  // source's was over the guard impulse); the next solve reads fresh ones
  sim.contacts = [];
}
