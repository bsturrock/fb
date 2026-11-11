// Ladder: lab URL parameters for watching a run the full check's matrices make (scripts/check/legmx.ts, l4mx.ts):
//   order=rev        the players created in reverse order (SimOptions.reverseOrder), the matrices' reversed rows;
//   legs=v1|v2|v3    a fixture with a leg guard run under LEG_GUARD_V1 / V2 / V3 in place of its own (the triage's map);
//                    a fixture without one is run as it is;
//   hips=on|off      a ragdoll fixture run with the hard hip stops (HIP_STOPS_V1, ladder rung 8d) or without any, for a
//                    before / after view; a fixture without a ragdoll profile, or already so, is run as it is.
// Lab only: a parameter changes the run on screen and its label, never a registered fixture. No DOM or renderer here, so
// a test can build the same run headless (tests/lab-params.test.ts).
import type { FixtureDef } from '../sim/fixture';
import { LEG_GUARD_V1, LEG_GUARD_V2, LEG_GUARD_V3, withHipStops, withoutHipStops } from '../sim/profiles';
import type { SimOptions } from '../sim/simulation';

const LEGS = { v1: LEG_GUARD_V1, v2: LEG_GUARD_V2, v3: LEG_GUARD_V3 } as const;

export interface LabRun {
  def: FixtureDef;
  opts: SimOptions;
  /** What the parameters changed, for the on-screen label ('' when nothing). */
  label: string;
}

/** The run the lab makes of `def` under the page's parameters (`order`, `legs`, `hips`); unknown values are named in the label and ignored. */
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
    const r = out.ragdoll;
    if (h !== 'on' && h !== 'off') parts.push(`hips=${hips} ignored`);
    else if (!r) parts.push(`hips ${h} n/a (no ragdoll profile)`);
    else if ((h === 'on') === !!r.hipStops) parts.push(`hip stops ${h} (registered)`);
    else {
      out = { ...out, ragdoll: h === 'on' ? withHipStops(r) : withoutHipStops(r) };
      parts.push(`hip stops ${h}`);
    }
  }
  return { def: out, opts, label: parts.join(' · ') };
}
