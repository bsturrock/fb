// Ladder: lab URL parameters for watching a run the full check's matrices make (scripts/check/legmx.ts, l4mx.ts):
//   order=rev          the players created in reverse order (SimOptions.reverseOrder), the matrices' reversed rows;
//   legs=v1|v2|v3      a fixture with a leg guard run under LEG_GUARD_V1 / V2 / V3 in place of its own (the triage's map);
//                      a fixture without one is run as it is;
//   hips=on|l4|v1|off  a ragdoll fixture run with the hip stops as they would flip (`hipStopsFor`: the 8d box with the
//                      approach zone, ladder rung 8g, on L4 too since rung 8k), the 8g L4 backstop outside the soft
//                      envelope (HIP_STOPS_L4_V1, the 8i assessment's L4 stops), the 8d box alone (HIP_STOPS_V1, rung
//                      8d), or without any;
//   pgs=<n>            n additional PGS iterations on the ragdoll's segments (rung 8a; 0: none; up to 16);
//   knees=off|140|145  the knee flexion stop at 140 or 145 (rung 8f), or none;
//   retry=on|off       a conversion rejected on an overlap deferred and tried again (CONVERSION_RETRY_V1, rung 8j), or not;
//   selfleg=on|off     the ragdoll's legs meeting each other and its trunk (own-leg contact, SELF_LEGS_V1, rung 9a), or not;
//   armtwist=on|off    the ragdoll shoulder's twist limit in the anatomical measure, holding with the arm overhead
//                      (SHOULDER_TWIST_ANAT_V1, rung 13a), or plan 09's, which fades out there;
//   born=on|off        a candidate overlapping another player converted with the overlapping collider pairs left out of
//                      the solve until separated (BORN_OVERLAP_V1, ladder 17: ragdoll rather than fall stiff), or
//                      refused (deferred) past the 1.5 cm tolerance as before; `on` keeps a born overlap already registered;
//   bornsep=on|off     the born overlap's held pairs pushed apart, capped (BORN_OVERLAP_V2, ladder 18: none deeper than
//                      born, parted in about 0.15 s; registered on L3, L4 and HC since 18c), or left to part as the
//                      bodies move (V1); a fixture without a born overlap (after `born`) is run as it is;
//   holdstill=on|off   a stationary hold keeping its feet planted (the footwork's HOLD_STILL_V1, rung 13b), or stepping
//                      home, settling and turning its feet as any stance; a fixture without footwork is run as it is;
//   latestep=on|off    a new step keeping the time its acceleration needs and a step out of time landing at a point
//                      fixed on the turf (the footwork's `compose.lateLanding`, polish 2, the leg gallop; no fixture
//                      registers it yet), or as before; a fixture without composed footwork is run as it is;
//   upperarm=on|off    the supported arms keeping the upper arm and elbow out of their own trunk too (the self-clearance
//                      profile's `upperArm`, rung 13c), or only the forearm and palm; a fixture without self-clearance is
//                      run as it is;
//   armswing=on|off    a supported arm another body has met keeping its clip swing (the self-clearance profile's
//                      `clipArmSwing`, rung 14b): no body-fixed alternative carried across the chest, its departure let
//                      go as the clip moves, its own trunk first; or as before. A fixture without self-clearance is run
//                      as it is;
//   armstay=on|off     a supported arm another body has met keeping its natural pose (the self-clearance profile's
//                      `metArmStay`, rung 16b): pressing a little into the other body, at most hanging at its side, never
//                      sent to a raised or forward alternative; or as before. Registered with `clipArmSwing` on L3, L4
//                      and HC (ladder 18e): `armstay=off&armswing=off` is the view before. A fixture without
//                      self-clearance is run as it is;
//   brace=on|v1|off    the ball carrier bracing for a hit he sees coming (CARRIER_BRACE_V2, contact motion M2: knees
//                      bent, hips down, chest forward, ball high and tight under the free hand), `v1` the same pose
//                      with V1's slow lean (the view before the M2 follow-up's lean), or not. Registered on the L3, L4
//                      and HC carriers: `brace=off` is the view before the brace. A fixture without locomotion
//                      composition (L3, L4, HC) or without a ball carrier is run as it is;
//   balclear=on|off    the referee's defensive influence clearing only once the runner has regained his balance (the
//                      rule profile's `balancedClear`), or on supported control alone. Registered on the L3, L4 and HC
//                      football rules: `balclear=off` is the view before. A fixture without football rules is run as it
//                      is;
//   wrap=on|v8|v7|v6|v5|v4|v3|v2|v1|off  the wrapping defender (contact motion M3). on (or v7): WRAP_V7, the ride-down
//                      (polish 1.2: with the hold he stays on his feet through the takedown, trunk following the carrier
//                      down, and leaves them near the ground) on WRAP_V5; v8: WRAP_V8, the bound-legs fall (polish 1.4,
//                      no fixture uses it: a carrier held round his hips or legs, or whose legs cannot step, goes down
//                      then, leaning toward his travel) on WRAP_V7; v6: WRAP_V6, the low strike of the deep crouch
//                      tackle (polish 1.4, no fixture uses it: trunk pitched 75 deg at his lowest stance, the shoulder
//                      into the carrier's hip, the arms round him under his pelvis) on WRAP_V8; v5: WRAP_V5 (the view
//                      before the ride-down flip), the drive (polish 1.2: with a hold he
//                      stays on his feet driving through the carrier and goes down with him) on WRAP_V4; v4: WRAP_V4 (the
//                      view before the drive flip: the hold lowers him and takes him down on a timer), the strike (polish
//                      1.1: hips lower, trunk pitched in on a hip hinge, the shoulder leading with the head to the
//                      carrier's side, arms wide from the shoulders) on WRAP_V3; v3: WRAP_V3 (the view before the strike flip), the cradle and
//                      the committed finish (a secure two-arm hold lowers him and takes him down with the carrier), his
//                      holds carried through the takedown onto his ragdoll arms; v2: WRAP_V2, the same takedown with his arms let go at it (the
//                      view before the hold flip); v1: WRAP_V1, the cradle only
//                      (arms carried ahead of the chest, opened wider than the carrier ahead of contact, closed on the
//                      first valid touch); off: the Gate 2 progression. A fixture without a wrapping defender (a
//                      `wrapAttempt` controller) is run as it is;
//   fall=on|v1|off     the falling player's reaction on an L3 or HC fixture (contact motion M4). on: FALL_REACT_V2 at every
//                      accepted conversion (the knees and hips flex, the free arm braces and, landed, bears load: the
//                      arm yields under the body and lets go when unloaded; the carry arm keeps the ball, a holding arm
//                      keeps its hold); v1: FALL_REACT_V1, the landed brace held on springs at its contact pose (before
//                      the palm-load flip); off: limp (a takedown's hold only under WRAP_V3, the M3 view). An L4 fixture (its own response, or its motor-off twin) or
//                      one without a ragdoll is run as it is. A view without the hip stops (hips=off) is limp: the
//                      response bounds the hips by them.
// The ragdoll parameters compose in that order (hips, pgs, knees, retry, selfleg, armtwist, born, then bornsep), so `hips=on&pgs=4&knees=140` is the
// assessments' variant to the id (`+hip-stops-v2+pgs4+knee140`). A fixture without a ragdoll profile, or already so, is
// run as it is.
// Lab only: a parameter changes the run on screen and its label, never a registered fixture. No DOM or renderer here, so
// a test can build the same run headless (tests/lab-params.test.ts).
import type { FixtureDef } from '../sim/fixture';
import {
  CONVERSION_RETRY_V1, HIP_STOPS_L4_V1, HIP_STOPS_V1, hipStopsFor, LEG_GUARD_V1, LEG_GUARD_V2, LEG_GUARD_V3, SELF_LEGS_V1, SHOULDER_TWIST_ANAT_V1, withAdditionalPgsIterations, withConversionRetry,
  withHipStops, withKneeStop, withBornOverlap, withoutBornOverlap, withBornSeparation, withoutBornSeparation, withoutConversionRetry, withoutHipStops, withoutKneeStop, withoutPgsIterations, withoutSelfLegs, withoutShoulderTwistLimit, withoutClipArmSwing, withoutMetArmStay, withoutUpperArmClearance, withSelfLegs, withShoulderTwistLimit,
  withClipArmSwing, withMetArmStay, withUpperArmClearance, withBalancedClear, withoutBalancedClear, type RagdollProfile,
} from '../sim/profiles';
import { HOLD_STILL_V1, withHoldStill, withLateLanding, withoutHoldStill, withoutLateLanding } from '../sim/footwork';
import { CARRIER_BRACE_V1, CARRIER_BRACE_V2 } from '../sim/brace';
import { WRAP_V1, WRAP_V2, WRAP_V3, WRAP_V4, WRAP_V5, WRAP_V6, WRAP_V7, WRAP_V8 } from '../sim/controllers/wrap';
import { FALL_REACT_V1, FALL_REACT_V2 } from '../sim/profiles';
import type { SimOptions } from '../sim/simulation';

const LEGS = { v1: LEG_GUARD_V1, v2: LEG_GUARD_V2, v3: LEG_GUARD_V3 } as const;
const HIPS = ['on', 'l4', 'v1', 'off'];
const KNEES = ['off', '140', '145'];
const RETRY = ['on', 'off'];
const SELFLEG = ['on', 'off'];
const ARMTWIST = ['on', 'off'];
const BORN = ['on', 'off'];
const BORNSEP = ['on', 'off'];
const HOLDSTILL = ['on', 'off'];
const LATESTEP = ['on', 'off'];
const UPPERARM = ['on', 'off'];
const ARMSWING = ['on', 'off'];
const ARMSTAY = ['on', 'off'];
const BRACE = ['on', 'v1', 'off'];
const BALCLEAR = ['on', 'off'];
const WRAP = ['on', 'v8', 'v7', 'v6', 'v5', 'v4', 'v3', 'v2', 'v1', 'off'];
const FALL = ['on', 'v1', 'off'];
/** Additional PGS iterations the lab takes (the assessments ran 1 to 8). */
const PGS_MAX = 16;

export interface LabRun {
  def: FixtureDef;
  opts: SimOptions;
  /** What the parameters changed, for the on-screen label ('' when nothing). */
  label: string;
}

/**
 * One ragdoll parameter `key`=`raw`, a value it takes when `valid`: `next` the profile it asks for, named in the label as
 * `name`, with '(registered)' when the profile is already so.
 */
function ragdollParam(out: FixtureDef, key: string, raw: string, valid: boolean, parts: string[], name: string, next: (r: RagdollProfile) => RagdollProfile): FixtureDef {
  const r = out.ragdoll;
  if (!valid) parts.push(`${key}=${raw} ignored`);
  else if (!r) parts.push(`${key} ${raw} n/a (no ragdoll profile)`);
  else {
    const n = next(r);
    parts.push(n.id === r.id ? `${name} (registered)` : name);
    if (n.id !== r.id) return { ...out, ragdoll: n };
  }
  return out;
}

/** The run the lab makes of `def` under the page's parameters (`order`, `legs`, `hips`, `pgs`, `knees`, `retry`, `selfleg`, `armtwist`, `born`, `bornsep`, `holdstill`, `latestep`, `upperarm`, `armswing`, `armstay`, `brace`, `balclear`, `wrap`, `fall`); unknown values are named in the label and ignored. */
export function labRun(def: FixtureDef, params: URLSearchParams): LabRun {
  const parts: string[] = [];
  const opts: SimOptions = {};
  const order = params.get('order');
  if (order === 'rev') {
    opts.reverseOrder = true;
    parts.push('order rev');
  } else if (order !== null && order !== '' && order !== 'fwd') parts.push(`order=${order} ignored`);
  let out = def;
  const legs = params.get('legs');
  if (legs !== null && legs !== '') {
    const g = LEGS[legs.toLowerCase() as keyof typeof LEGS];
    if (!g) parts.push(`legs=${legs} ignored`);
    else if (!def.legGuard) parts.push(`legs ${legs.toUpperCase()} n/a (no leg guard)`);
    else {
      if (g.id !== def.legGuard.id) out = { ...def, legGuard: g };
      parts.push(`legs ${legs.toUpperCase()}${g.id === def.legGuard.id ? ' (registered)' : ''}`);
    }
  }
  const hips = params.get('hips');
  if (hips !== null && hips !== '') {
    const h = hips.toLowerCase();
    out = ragdollParam(out, 'hips', hips, HIPS.includes(h), parts, `hip stops ${h}`, (r) => {
      if (h === 'off') return withoutHipStops(r);
      const S = h === 'on' ? hipStopsFor(r) : h === 'l4' ? HIP_STOPS_L4_V1 : HIP_STOPS_V1;
      return r.hipStops?.id === S.id ? r : withHipStops(withoutHipStops(r), S);
    });
  }
  const pgs = params.get('pgs');
  if (pgs !== null && pgs !== '') {
    const n = /^\d+$/.test(pgs) ? Number(pgs) : NaN;
    out = ragdollParam(out, 'pgs', pgs, n >= 0 && n <= PGS_MAX, parts, `pgs +${n}`, (r) => {
      if ((r.additionalPgsIterations ?? 0) === n) return r;
      const base = withoutPgsIterations(r);
      return n === 0 ? base : withAdditionalPgsIterations(base, n);
    });
  }
  const knees = params.get('knees');
  if (knees !== null && knees !== '') {
    const k = knees.toLowerCase();
    out = ragdollParam(out, 'knees', knees, KNEES.includes(k), parts, `knee stop ${k}`, (r) => {
      if (k === 'off') return withoutKneeStop(r);
      return r.kneeFlexionStopDeg === Number(k) ? r : withKneeStop(withoutKneeStop(r), Number(k));
    });
  }
  const retry = params.get('retry');
  if (retry !== null && retry !== '') {
    const v = retry.toLowerCase();
    out = ragdollParam(out, 'retry', retry, RETRY.includes(v), parts, `conversion retry ${v}`, (r) => {
      if (v === 'off') return withoutConversionRetry(r);
      return r.conversionRetry?.id === CONVERSION_RETRY_V1.id ? r : withConversionRetry(withoutConversionRetry(r));
    });
  }
  const selfleg = params.get('selfleg');
  if (selfleg !== null && selfleg !== '') {
    const v = selfleg.toLowerCase();
    out = ragdollParam(out, 'selfleg', selfleg, SELFLEG.includes(v), parts, `own-leg contact ${v}`, (r) => {
      if (v === 'off') return withoutSelfLegs(r);
      return r.selfLegs?.id === SELF_LEGS_V1.id ? r : withSelfLegs(withoutSelfLegs(r));
    });
  }
  const armtwist = params.get('armtwist');
  if (armtwist !== null && armtwist !== '') {
    const v = armtwist.toLowerCase();
    out = ragdollParam(out, 'armtwist', armtwist, ARMTWIST.includes(v), parts, `shoulder twist limit ${v === 'on' ? 'anatomical' : 'plan 09'}`, (r) => {
      if (v === 'off') return withoutShoulderTwistLimit(r);
      return r.shoulderTwistLimit?.id === SHOULDER_TWIST_ANAT_V1.id ? r : withShoulderTwistLimit(withoutShoulderTwistLimit(r));
    });
  }
  const born = params.get('born');
  if (born !== null && born !== '') {
    const v = born.toLowerCase();
    out = ragdollParam(out, 'born', born, BORN.includes(v), parts, `born overlap ${v}`, (r) => {
      if (v === 'off') return withoutBornOverlap(r);
      return r.bornOverlap ? r : withBornOverlap(r);
    });
  }
  const bornsep = params.get('bornsep');
  if (bornsep !== null && bornsep !== '') {
    const v = bornsep.toLowerCase();
    if (!BORNSEP.includes(v)) parts.push(`bornsep=${bornsep} ignored`);
    else if (!out.ragdoll?.bornOverlap) parts.push('bornsep n/a (no born overlap)');
    else out = ragdollParam(out, 'bornsep', bornsep, true, parts, `born separation ${v}`, (r) => (v === 'off' ? withoutBornSeparation(r) : withBornSeparation(r)));
  }
  const holdstill = params.get('holdstill');
  if (holdstill !== null && holdstill !== '') {
    const v = holdstill.toLowerCase();
    if (!HOLDSTILL.includes(v)) parts.push(`holdstill=${holdstill} ignored`);
    else if (!out.footwork) parts.push('holdstill n/a (no footwork)');
    else {
      const f = v === 'off' ? withoutHoldStill(out.footwork) : out.footwork.holdStill?.id === HOLD_STILL_V1.id ? out.footwork : withHoldStill(withoutHoldStill(out.footwork));
      parts.push(`hold still ${v}${f === out.footwork ? ' (registered)' : ''}`);
      if (f !== out.footwork) out = { ...out, footwork: f };
    }
  }
  const latestep = params.get('latestep');
  if (latestep !== null && latestep !== '') {
    const v = latestep.toLowerCase();
    if (!LATESTEP.includes(v)) parts.push(`latestep=${latestep} ignored`);
    else if (!out.footwork?.compose) parts.push('latestep n/a (no composed footwork)');
    else {
      const f = v === 'off' ? withoutLateLanding(out.footwork) : withLateLanding(out.footwork);
      parts.push(`late step ${v}${f === out.footwork ? ' (registered)' : ''}`);
      if (f !== out.footwork) out = { ...out, footwork: f };
    }
  }
  const upperarm = params.get('upperarm');
  if (upperarm !== null && upperarm !== '') {
    const v = upperarm.toLowerCase();
    if (!UPPERARM.includes(v)) parts.push(`upperarm=${upperarm} ignored`);
    else if (!out.selfClearance) parts.push('upperarm n/a (no self-clearance)');
    else {
      const sc = v === 'off' ? withoutUpperArmClearance(out.selfClearance) : withUpperArmClearance(out.selfClearance);
      parts.push(`upper arm self-clearance ${v}${sc === out.selfClearance ? ' (registered)' : ''}`);
      if (sc !== out.selfClearance) out = { ...out, selfClearance: sc };
    }
  }
  const armswing = params.get('armswing');
  if (armswing !== null && armswing !== '') {
    const v = armswing.toLowerCase();
    if (!ARMSWING.includes(v)) parts.push(`armswing=${armswing} ignored`);
    else if (!out.selfClearance) parts.push('armswing n/a (no self-clearance)');
    else {
      const sc = v === 'off' ? withoutClipArmSwing(out.selfClearance) : withClipArmSwing(out.selfClearance);
      parts.push(`clip arm swing ${v}${sc === out.selfClearance ? ' (registered)' : ''}`);
      if (sc !== out.selfClearance) out = { ...out, selfClearance: sc };
    }
  }
  const armstay = params.get('armstay');
  if (armstay !== null && armstay !== '') {
    const v = armstay.toLowerCase();
    if (!ARMSTAY.includes(v)) parts.push(`armstay=${armstay} ignored`);
    else if (!out.selfClearance) parts.push('armstay n/a (no self-clearance)');
    else {
      const sc = v === 'off' ? withoutMetArmStay(out.selfClearance) : withMetArmStay(out.selfClearance);
      parts.push(`met arm stay ${v}${sc === out.selfClearance ? ' (registered)' : ''}`);
      if (sc !== out.selfClearance) out = { ...out, selfClearance: sc };
    }
  }
  const brace = params.get('brace');
  if (brace !== null && brace !== '') {
    const v = brace.toLowerCase();
    if (!BRACE.includes(v)) parts.push(`brace=${brace} ignored`);
    else if (!out.locomotion || !out.players.some((p) => p.role === 'runner')) parts.push('brace n/a (no composed ball carrier)');
    else {
      const want = v === 'off' ? undefined : v === 'v1' ? CARRIER_BRACE_V1 : CARRIER_BRACE_V2;
      const b = want && out.brace?.id === want.id ? out.brace : want;
      parts.push(`carrier brace ${v}${b === out.brace ? ' (registered)' : ''}`);
      if (b !== out.brace) {
        out = { ...out, brace: b };
        if (!b) delete out.brace;
      }
    }
  }
  const balclear = params.get('balclear');
  if (balclear !== null && balclear !== '') {
    const v = balclear.toLowerCase();
    if (!BALCLEAR.includes(v)) parts.push(`balclear=${balclear} ignored`);
    else if (out.rules?.kind !== 'footballTackleSubset') parts.push('balclear n/a (no football rules)');
    else {
      const r = v === 'off' ? withoutBalancedClear(out.rules) : withBalancedClear(out.rules);
      parts.push(`balanced clear ${v}${r === out.rules ? ' (registered)' : ''}`);
      if (r !== out.rules) out = { ...out, rules: r };
    }
  }
  const wrap = params.get('wrap');
  if (wrap !== null && wrap !== '') {
    const v = wrap.toLowerCase();
    if (!WRAP.includes(v)) parts.push(`wrap=${wrap} ignored`);
    else if (!out.players.some((p) => p.controller.kind === 'wrapAttempt')) parts.push('wrap n/a (no wrapping defender)');
    else {
      const want = v === 'off' ? undefined : v === 'v1' ? WRAP_V1 : v === 'v2' ? WRAP_V2 : v === 'v3' ? WRAP_V3 : v === 'v4' ? WRAP_V4 : v === 'v5' ? WRAP_V5 : v === 'v6' ? WRAP_V6 : v === 'v8' ? WRAP_V8 : WRAP_V7;
      const w = want && out.wrap?.id === want.id ? out.wrap : want;
      parts.push(`wrap ${v}${w === out.wrap ? ' (registered)' : ''}`);
      if (w !== out.wrap) {
        out = { ...out, wrap: w };
        if (!w) delete out.wrap;
      }
    }
  }
  const fall = params.get('fall');
  if (fall !== null && fall !== '') {
    const v = fall.toLowerCase();
    if (!FALL.includes(v)) parts.push(`fall=${fall} ignored`);
    else if (!/^(L3|HC)-/.test(out.id)) parts.push('fall n/a (not an L3 or HC fixture)');
    else if (!out.ragdoll) parts.push('fall n/a (no ragdoll profile)');
    else {
      const want = v === 'on' ? FALL_REACT_V2 : v === 'v1' ? FALL_REACT_V1 : undefined;
      parts.push(`fall ${v}${want === out.fallResponse ? ' (registered)' : ''}`);
      if (want !== out.fallResponse) {
        out = { ...out, fallResponse: want };
        if (!want) delete out.fallResponse;
      }
    }
  }
  // contact motion M4: the reaction bounds an L3 or HC hip by its hard stops alone (the ragdoll has no hip envelope), so a
  // view without them (hips=off, the view before the visible flip) is limp, as every fall was then
  if ((out.fallResponse === FALL_REACT_V1 || out.fallResponse === FALL_REACT_V2) && out.ragdoll && !out.ragdoll.hipStops && !out.ragdoll.envelope?.hip) {
    parts.push('fall off (no hip stops)');
    const { fallResponse, ...rest } = out;
    void fallResponse;
    out = rest;
  }
  return { def: out, opts, label: parts.join(' · ') };
}
