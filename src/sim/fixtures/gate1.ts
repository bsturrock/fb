// Gate 1 fixtures: requests and starting conditions only. Post-contact trajectories are never scripted.
import type { ArmSide } from '../contracts';
import type { FixtureDef, PlayerSetup } from '../fixture';
import { PRACTICE_AREA } from '../fixture';
import type { CoachedEntrySpec } from '../controllers/coached';
import { vHeading } from '../controllers/base';
import {
  DEFAULT_MOTOR, SOLVER_G1, STANCE_G1_LOCKED, legacyCapsule, upperBodyCompound, type BodyProfile,
} from '../profiles';
import { UP, cross, dot, norm, sub, v3, type Vec3 } from '../vec';

const base = (over: Partial<FixtureDef> & Pick<FixtureDef, 'id' | 'milestone' | 'title' | 'players' | 'durationS'>): FixtureDef => ({
  gate: 1,
  solver: SOLVER_G1,
  stance: STANCE_G1_LOCKED,
  motor: DEFAULT_MOTOR,
  settleS: 0.1,
  area: PRACTICE_AREA,
  ...over,
});

// ------------------------------------------------------------------ G1-A
export function g1f1(): FixtureDef {
  return base({
    id: 'G1-F1',
    milestone: 'G1-A',
    title: 'Free movement and finite stopping',
    notes: 'Request +Z 4 m/s for 1.5 s, then zero for 1.0 s.',
    durationS: 2.5,
    players: [
      {
        id: 'P1',
        role: 'runner',
        body: legacyCapsule(),
        initial: { x: 0, z: -5, yawDeg: 0 },
        controller: {
          kind: 'script',
          segments: [
            { fromS: 0, velocity: v3(0, 0, 4) },
            { fromS: 1.5, velocity: v3(), facing: 'hold' },
          ],
        },
      },
    ],
  });
}

/** G1-F6 (airborne half): starts 0.3 m above resting height and requests horizontal movement. */
export function g1f6Airborne(profile: 'legacy' | 'compound' = 'legacy'): FixtureDef {
  return base({
    id: `G1-F6-airborne-${profile}`,
    milestone: 'G1-A',
    title: 'Unsupported start: no ground drive while airborne',
    durationS: 1.2,
    players: [
      {
        id: 'P1',
        role: 'runner',
        body: profile === 'legacy' ? legacyCapsule() : upperBodyCompound(),
        initial: { x: 0, z: -2, yawDeg: 0, lift: 0.3 },
        controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(0, 0, 4) }] },
      },
    ],
  });
}

// ------------------------------------------------------------------ G1-B
const bodyOf = (kind: 'legacy' | 'compound', massKg = 100): BodyProfile =>
  kind === 'legacy' ? legacyCapsule(massKg) : upperBodyCompound({ massKg });

/** Two players facing each other along X; drive and yaw disabled (effort 0) for the whole impact fixture. */
function glide(
  id: string,
  milestone: string,
  title: string,
  opts: { kind: 'legacy' | 'compound'; zOffset: number; speed: number; xStart: number; durationS?: number },
): FixtureDef {
  const off = { kind: 'script' as const, segments: [{ fromS: 0, velocity: v3(), facing: 'hold' as const, effort: 0, yawEffort: 0 }] };
  return base({
    id,
    milestone,
    title,
    durationS: opts.durationS ?? 2.5,
    players: [
      {
        id: 'D',
        role: 'defender',
        body: bodyOf(opts.kind),
        initial: { x: -opts.xStart, z: 0, yawDeg: 90, velocity: v3(opts.speed, 0, 0) },
        controller: off,
      },
      {
        id: 'R',
        role: 'runner',
        body: bodyOf(opts.kind),
        initial: { x: opts.xStart, z: opts.zOffset, yawDeg: -90, velocity: v3(-opts.speed, 0, 0) },
        controller: off,
      },
    ],
  });
}

export const g1f2 = (kind: 'legacy' | 'compound' = 'legacy'): FixtureDef =>
  glide(`G1-F2-${kind}`, 'G1-B', 'Symmetric mutual impact (motors off)', { kind, zOffset: 0, speed: 2, xStart: 2 });
/** No-contact control for F2: identical except the runner is displaced 3 m in Z. */
export const g1f2Control = (kind: 'legacy' | 'compound' = 'legacy'): FixtureDef =>
  glide(`G1-F2-control-${kind}`, 'G1-B', 'F2 no-contact control', { kind, zOffset: 3, speed: 2, xStart: 2 });
export const g1f3 = (kind: 'legacy' | 'compound' = 'legacy'): FixtureDef =>
  glide(`G1-F3-${kind}`, 'G1-B', 'Off-center impact, 0.35 m Z offset (motors off)', { kind, zOffset: 0.35, speed: 2, xStart: 2 });

/** Both players keep requesting opposing travel for the whole trial (well past 2 s after contact). */
export function g1f4(opts: { kind?: 'legacy' | 'compound'; massD?: number; massR?: number; id?: string; milestone?: string } = {}): FixtureDef {
  const kind = opts.kind ?? 'legacy';
  return base({
    id: opts.id ?? `G1-F4-${kind}`,
    milestone: opts.milestone ?? 'G1-B',
    title: 'Both players continue trying (opposing requests)',
    durationS: 3.5,
    players: [
      {
        id: 'D',
        role: 'defender',
        body: bodyOf(kind, opts.massD ?? 100),
        initial: { x: -2.5, z: 0, yawDeg: 90 },
        controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(3, 0, 0) }] },
      },
      {
        id: 'R',
        role: 'runner',
        body: bodyOf(kind, opts.massR ?? 100),
        initial: { x: 2.5, z: 0, yawDeg: -90 },
        controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(-3, 0, 0) }] },
      },
    ],
  });
}

export const g1f5 = (swap: boolean): FixtureDef =>
  g1f4({
    id: swap ? 'G1-F5-swapped' : 'G1-F5',
    massD: swap ? 85 : 120,
    massR: swap ? 120 : 85,
  });

// ------------------------------------------------------------------ G1-C
export const g1f6Impact = (kind: 'legacy' | 'compound' = 'legacy', speed = 8): FixtureDef =>
  glide(`G1-F6-impact-${kind}-${speed}`, 'G1-C', `High-speed impact, ${speed} m/s per body (motors off)`, {
    kind,
    zOffset: 0,
    speed,
    xStart: 3,
    durationS: 1.0,
  });

/** F7 reproducibility fixture: the F4 opposing-request contest (cosmetics carried separately). */
export const g1f7 = (palette = 'default'): FixtureDef => ({
  ...g1f4({ kind: 'compound', id: 'G1-F7', milestone: 'G1-C' }),
  cosmetic: { palette },
});

// ------------------------------------------------------------------ G1-D coached entry
/** The shoulder that keeps the head on the leverage side for a tackler facing `toRunner`. */
export function consistentShoulder(toRunner: Vec3, leverage: Vec3): ArmSide {
  const right = cross(UP, norm(toRunner));
  return dot(right, leverage) > 0 ? 'left' : 'right';
}

export type Approach = 'front' | 'oblique' | 'side' | 'rear' | 'late';
export interface CoachedCase {
  approach: Approach;
  leverage: 'insideOut' | 'outsideIn';
  mirror?: boolean;
  headingChange?: boolean;
  runnerSpeed?: number;
  shoulder?: ArmSide | 'consistent';
  fit?: CoachedEntrySpec['fit'];
  lateralExtraM?: number;
  defenderBody?: BodyProfile;
  runnerBody?: BodyProfile;
  observationDelayS?: number;
  id?: string;
  title?: string;
  durationS?: number;
}

/**
 * Runner carries downfield along +X. The sideline is +Z (mirrored: -Z). Inside-out keeps the runner's inside
 * (toward the middle of the field) so the leverage side points away from the sideline; outside-in is the opposite.
 */
export function coachedFixture(c: CoachedCase): FixtureDef {
  const m = c.mirror ? -1 : 1;
  const sideline = v3(0, 0, m);
  const lev = c.leverage === 'insideOut' ? v3(0, 0, -m) : sideline;
  const rs = c.runnerSpeed ?? 3;
  const runnerStart = v3(-5, 0, 0);
  // The runner drifts 12 degrees toward the sideline so inside-out and outside-in are not mere mirror images.
  const runnerHeading = 90 - 12 * m;
  const starts: Record<Approach, { p: Vec3; v?: Vec3 }> = {
    front: { p: v3(1.5, 0, 0.4 * lev.z) },
    oblique: { p: v3(1, 0, 3 * lev.z) },
    side: { p: v3(-2, 0, 4 * lev.z) },
    rear: { p: v3(-7.5, 0, 0.8 * lev.z) },
    // Fast, close, crossing entry: finite braking/turning may overrun or miss.
    late: { p: v3(-2.6, 0, 2.0 * lev.z), v: v3(-1.0, 0, -6.0 * lev.z) },
  };
  const s = starts[c.approach];
  const toRunner = sub(runnerStart, s.p);
  const yawD = (Math.atan2(toRunner.x, toRunner.z) * 180) / Math.PI;
  const shoulder = !c.shoulder || c.shoulder === 'consistent' ? consistentShoulder(toRunner, lev) : c.shoulder;
  const runnerSegments = [{ fromS: 0, velocity: vHeading(rs, runnerHeading) }];
  if (c.headingChange) runnerSegments.push({ fromS: 0.9, velocity: vHeading(rs, runnerHeading - 35 * m) });
  const defender: PlayerSetup = {
    id: 'D',
    role: 'defender',
    body: c.defenderBody ?? upperBodyCompound(),
    selectedShoulder: shoulder,
    initial: { x: s.p.x, z: s.p.z, yawDeg: yawD, velocity: s.v },
    controller: {
      kind: 'coachedEntry',
      target: 'R',
      leverageSideWorld: lev,
      shoulder,
      fit: c.fit,
      lateralExtraM: c.lateralExtraM,
      observationDelayS: c.observationDelayS ?? 0,
    },
  };
  const runner: PlayerSetup = {
    id: 'R',
    role: 'runner',
    body: c.runnerBody ?? upperBodyCompound(),
    initial: { x: runnerStart.x, z: runnerStart.z, yawDeg: runnerHeading, velocity: vHeading(rs, runnerHeading) },
    controller: { kind: 'script', segments: runnerSegments },
  };
  const id =
    c.id ??
    `G1-F8-${c.approach}-${c.leverage}${c.mirror ? '-mirror' : ''}${c.headingChange ? '-turn' : ''}`;
  return base({
    id,
    milestone: 'G1-D',
    title: c.title ?? `Coached entry: ${c.approach}, ${c.leverage}${c.mirror ? ', mirrored' : ''}${c.headingChange ? ', runner turns' : ''}`,
    durationS: c.durationS ?? 3.0,
    focus: { D: 'R' },
    players: [defender, runner],
  });
}

export const g1f8Cases = (): FixtureDef[] => {
  const out: FixtureDef[] = [];
  for (const approach of ['front', 'oblique', 'side', 'rear'] as Approach[])
    for (const leverage of ['insideOut', 'outsideIn'] as const)
      for (const mirror of [false, true]) out.push(coachedFixture({ approach, leverage, mirror }));
  out.push(coachedFixture({ approach: 'oblique', leverage: 'insideOut', headingChange: true }));
  out.push(coachedFixture({ approach: 'oblique', leverage: 'insideOut', headingChange: true, mirror: true }));
  out.push(coachedFixture({ approach: 'late', leverage: 'insideOut', id: 'G1-F8-late-overrun', title: 'Late, fast entry (may overrun/miss)' }));
  out.push(coachedFixture({ approach: 'front', leverage: 'insideOut', observationDelayS: 0.08, id: 'G1-F8-front-delay80ms' }));
  return out;
};

export const g1f9Fit = (): FixtureDef =>
  coachedFixture({ approach: 'front', leverage: 'insideOut', runnerSpeed: 2, id: 'G1-F9-fit', title: 'Compatible shoulder fit, head clear' });
export const g1f9Glance = (): FixtureDef =>
  coachedFixture({
    approach: 'front',
    leverage: 'insideOut',
    runnerSpeed: 2,
    lateralExtraM: 0.05,
    id: 'G1-F9-glance',
    title: 'Offset glancing entry (+0.05 m lateral beyond the head-clear fit)',
  });
export const g1f9Poor = (): FixtureDef =>
  coachedFixture({
    approach: 'front',
    leverage: 'insideOut',
    runnerSpeed: 2,
    fit: 'diagnosticHeadOn',
    // Upright locked torsos shield a centred head, so the diagnostic uses a forward-head posture profile.
    defenderBody: upperBodyCompound({ headForwardM: 0.1, tag: 'forwardHead' }),
    id: 'G1-F9-poor',
    title: 'Deliberately poor diagnostic approach (head-on aim, forward head)',
  });

export const F10_BODIES = (): { tag: string; body: BodyProfile }[] => [
  { tag: '80kg-std', body: upperBodyCompound({ massKg: 80 }) },
  { tag: '100kg-std', body: upperBodyCompound({ massKg: 100 }) },
  { tag: '135kg-std', body: upperBodyCompound({ massKg: 135 }) },
  {
    tag: '135kg-wide',
    body: upperBodyCompound({ massKg: 135, torsoHalf: v3(0.3, 0.31, 0.19), shoulder: { x: 0.3, y: 0.52 }, tag: 'wide' }),
  },
  {
    tag: '80kg-narrow',
    body: upperBodyCompound({ massKg: 80, torsoHalf: v3(0.21, 0.26, 0.14), shoulder: { x: 0.22, y: 0.45 }, tag: 'narrow' }),
  },
];

export const g1f10Cases = (): FixtureDef[] => {
  const out: FixtureDef[] = [];
  for (const d of F10_BODIES())
    out.push(
      coachedFixture({
        approach: 'front',
        leverage: 'insideOut',
        runnerSpeed: 2,
        defenderBody: d.body,
        id: `G1-F10-defender-${d.tag}`,
        title: `Profile sensitivity: defender ${d.tag}`,
      }),
    );
  for (const r of [F10_BODIES()[3], F10_BODIES()[4]])
    out.push(
      coachedFixture({
        approach: 'front',
        leverage: 'insideOut',
        runnerSpeed: 2,
        runnerBody: r.body,
        id: `G1-F10-runner-${r.tag}`,
        title: `Profile sensitivity: runner ${r.tag}`,
      }),
    );
  return out;
};

export function gate1Fixtures(): FixtureDef[] {
  return [
    g1f1(),
    g1f6Airborne('legacy'),
    g1f6Airborne('compound'),
    g1f2('legacy'),
    g1f2Control('legacy'),
    g1f2('compound'),
    g1f3('legacy'),
    g1f3('compound'),
    g1f4({ kind: 'legacy' }),
    g1f4({ kind: 'compound' }),
    g1f5(false),
    g1f5(true),
    g1f6Impact('legacy', 8),
    g1f6Impact('compound', 8),
    g1f7(),
    ...g1f8Cases(),
    g1f9Fit(),
    g1f9Glance(),
    g1f9Poor(),
    ...g1f10Cases(),
  ];
}
