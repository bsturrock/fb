# Tackling Review, Coverage, and Implementation Order

Research and revision guide v1.1 • 2026-11-02

## 1. What this package builds

Build a low-poly Three.js tackle laboratory for a future coach-controlled, CPU-versus-CPU American football simulation. The four gates establish bounded movement, independently attempted shoulder connection and wrapping, finite balance, and articulated falling. They are implementation specifications, not a validated solver or a finished football game.

This revision follows a review of written primary coaching material from USA Football, the Seahawks' published teaching-resource description, and the official 2026 NFL rulebook. No coaching video was measured or claimed to have been watched. Numeric forces, angles, timings, and geometry in the specs are authored engineering choices.

The main correction to v1.0 is that ordinary wrapping cannot be represented solely as two hands attached to arbitrary torso points. The revised scope includes real shoulder-contact classification, closing forearm clamps, sustained bounded post-contact effort, and a football-oriented completion subset.

## 2. Can the four gates run in parallel?

**Core integration and acceptance run in order: Gate 1 → Gate 2 → Gate 3 → Gate 4.** Launching four independent implementations against an evolving shared physics loop is likely to create incompatible state ownership, force accounting, and handoff assumptions.

Some preparatory work can run in parallel after a shared contract is fixed:

| Workstream | May start when | Safe independent deliverable | Integration dependency |
| --- | --- | --- | --- |
| Player model/pose mapping | Coordinates and body/arm dimensions are agreed | Explicit landmarks, rig adapter, reference poses | Used by every gate; cannot own physical transforms |
| Fixture/UI tooling | Snapshot, config, and trace schema exist | Controls, overlays, export, trace viewer | Reads agreed state; does not change mechanics |
| Gate 2 reach/contact prototype | Gate 1 movement/body contract is stable | Isolated arms and clamp fixtures on the locked profile | Integrate shared force budget only after Gate 1 passes |
| Gate 3 balance prototype | Gate 1 dynamic-body/motor contract is stable | Isolated finite-torque recovery fixtures | Final tackle validation waits for Gate 2 contacts |
| Gate 4 ragdoll construction | Physical pose, mass, and segment IDs are stable | Isolated articulated body and handoff audit harness | Live transition/retention integration waits for Gates 2/3 |
| Research and visual reference collection | At any time | Sourced observations and timestamped clips if actually viewed | Findings become explicit spec/profile changes |

If multiple implementers are used, separate branches/worktrees and assign one owner to the shared simulation/contact loop. Independent branches may supply candidate modules; only one integrator merges changes to authoritative body state and force accumulation.

Freeze these before parallel implementation:

1. World/local axes, SI units, profile version, and physical origin versus COM.
2. Stable PlayerId, SegmentId, collider-region tags, and relationship IDs.
3. Snapshot → intent → bounded force/contact → solve → events update order.
4. Who clears forces; who budgets arm effort; how physics substeps consume inputs.
5. Achieved arm-pose contract and model mapping.
6. Supported/falling control modes and proxy/ragdoll representations.
7. Contact/grip/clamp lifecycle and transition ownership.
8. Rule profile and event/trace schemas.

Reopen a contract explicitly when a demonstrated incompatibility requires it. Do not create multiple physics backends to avoid integration.

## 3. Review findings and required changes

| Finding in v1.0 | Why it matters | v1.1 action |
| --- | --- | --- |
| Movement fixtures lacked a coached entry | A generic collision can succeed while approaching the wrong hip or overrunning the runner | Gate 1 adds limited tracking, speed gathering, leverage, and contact-side fixtures |
| Shoulder contact was implicit in a round capsule | Hand retention could be mistaken for correct connection; broad circular proxies can obstruct a plausible wrap | Gate 1 adds an upper-body contact profile and labels actual shoulder/head contact without bonus force |
| Two point grips stood in for most wrapping | A forearm can contain a runner while the palm is not gripping his torso | Gate 2 adds force-limited forearm clamp contacts with pressure-dependent friction and slip |
| A wrap flag could be overinterpreted | Geometric encirclement alone does not supply power | Classification stays observational; retention comes from individual contacts |
| No explicit post-contact technique policy | Holding then waiting for balance failure omits continuing effort and readjustment | Gate 3 adds bounded drive/reposition/resqueeze requests and runner-resistance comparisons |
| Posture was always upright until failing | It can look stiff and obscure preparation | Gate 3 adds a small bounded lean target; full dip/lift remains explicitly beyond the fixed-height proxy |
| Falling-owner clamps were treated like hand grips | Passive limbs should not receive a remote shoulder tether | Gate 4 transfers forearm clamps to real limb contact; only actual existing hand holds may use finite passive grasp links |
| Only torso/pelvis ground contact completed the drill | Other body contacts and held-up/out-of-bounds endings are relevant | Gate 4 keeps labCoreOnly and adds a separate footballTackleSubset rule profile |
| Deferred tackle types were easy to mistake for covered behavior | A passive roll is not a deliberate roll technique; low hand placement is not a thigh tackle | This guide lists prerequisites and follow-up fixtures explicitly |

Every revised gate is self-contained about its active requirements. This guide explains the package-wide decisions and source basis. Gates 1–4 remain the implementation authority for their mechanics.

## 4. Coaching observations and simulation translation

### 4.1 Approach and leverage

USA Football's leverage material describes approach in relation to assignment, field location, and other players [S2, S4]. Preparation timing also varies with the available space and approach [S8].

Simulation translation:

- Give the tackler an assigned leverage side; do not always chase the runner's current center.
- Observe a near-hip landmark and predict a short interception point.
- Limit braking and turning; gathering is a speed/posture request, not a teleport or universal stop.
- Use one small controller in open-field, side, rear, and confined fixtures. A poor entry must be able to miss.
- Teammate help can later influence the chosen side. Team recognition/communication is not implemented here.

### 4.2 Shoulder connection and form

The form-tackle material describes an upper-body shoulder target, a preparation/rise action, and continued retention and drive [S5]. The selected prototype must show which shoulder actually connects and where the head is, rather than naming every collision a technically good tackle.

Simulation translation:

- Track shoulder and head landmarks independently from the target.
- Tag the real contact location/region and whether the selected shoulder reached it.
- Prefer a neutral, clear head position in the controller/pose request; a helmet-first collision is a recorded technique failure, not a stronger hit.
- Keep the same-side step/shoulder relationship readable in the reference pose.
- Physical feet remain approximate. Visual step timing cannot manufacture extra drive.
- The fixed-height proxy cannot reproduce a full physical crouch, upward leg extension, or lifting of the runner. Those are declared limitations; no hidden upward impulse substitutes for them.

### 4.3 Arm closure, squeeze, retention, and reworking a hold

USA Football distinguishes initial contact from retaining control and improving the connection; its glossary also discusses renewed closure and regripping [S3, S7, S9].

Simulation translation:

- Separate a hand surface hold from a forearm clamp.
- A clamp requires actual forearm/body contact and a bounded closing request.
- Closing pressure permits finite tangential retention. Less pressure or a poor angle can allow slipping.
- A runner may move the defender even while retained.
- One arm can lose contact while the other continues working.
- A failed first connection can be followed by a bounded new attempt. There is no automatic reattachment.
- Two same-front contacts are not proof of circumferential wrapping.

### 4.4 Continued effort and finish

The advanced acceleration material separates sustained ground-driven effort from rotational finishing [S10]. The finish material includes retaining and improving a connection when the initial shoulder fit is imperfect [S9].

Simulation translation:

- A supported tackler continues using the same finite locomotion and arm actuators.
- Allow limited side adjustment to improve an existing hold.
- Continue the runner's independent movement/facing intentions.
- Compare sustained effort against an otherwise identical case with that effort removed.
- A named finish never injects an extra impulse, lowers an opponent's balance score, or guarantees falling.
- Planned roll finishing requires another controlled-action increment. Passive tumbling alone does not demonstrate it.

### 4.5 How a tackle can end

For the selected NFL-oriented rules subset, the 2026 rulebook recognizes opponent-contact ground endings beyond the core, restraint ending progress, and boundary endings [S11]. The subset implementation in Gate 4 is intentionally smaller than complete officiating.

Simulation translation:

- Record the earliest qualifying ground/boundary/progress event.
- Do not require ragdoll mode before recognizing a physically observed ending.
- Record the ball position at that event, not after settling.
- Separate physics, referee observation, and tackle-credit statistics.
- A player remaining upright but genuinely restrained can produce a progress-stop event; a freely stationary runner cannot.
- A momentary hand support on the floor does not by itself end the selected ground-contact subset.

## 5. Tackling coverage matrix

Required means demonstrated by the four-gate package, not merely supported by a data type.

| Football situation | Status in v1.1 | Required observation or future prerequisite |
| --- | --- | --- |
| Front/oblique upper-body shoulder-and-wrap entry | Required | Real shoulder region, independent arms, bounded force |
| Side/rear arm-only recovery attempt | Required | May hold, slip, improve position, or miss without a shoulder-success prerequisite |
| Forearm wrap with no palm glued to the torso | Required | Pressure/friction retention; actual around-body arm geometry |
| One-arm retention and failed/partial wrap | Required | Independent contact and release |
| Supported drive and bounded side readjustment | Required | Same actuators stay active after contact |
| Runner continuing through or turning against a hold | Required fixture input | Actual response; no advanced autonomous runner policy required |
| Glancing body contact without a secure hold | Required | Deflection or miss, with no magnetic acquisition |
| Dragged tackler, mutual displacement, either player falling | Required | Shared mechanics and honest control loss |
| Contact-driven fall with retained or broken contacts | Required | Valid handoff and continuing external collision |
| Relevant ground, progress-stop, and configured sideline ending | Required subset profile | Actual geometry/history and recorded ball spot |
| Low thigh/leg-control tackle | Follow-up | A lowerable shoulder/posture model, separate leg surfaces, and represented step/leg restriction |
| Deliberate thigh-and-roll finish | Follow-up | Low connection plus finite controlled rotational finish; not an automatic ragdoll trigger |
| Full dip/rise and physical lifting | Follow-up | A posture/support model that can transmit the vertical action |
| Diving/ankle or shoestring attempt | Follow-up | Flight/launch control, reachable low contact, landing and recovery |
| Stiff-arm, arm chop, deliberate spin/juke | Follow-up | Causal limb contact and bounded runner/defender action policies |
| Gang/compression tackle, second defender | Follow-up | Shared multi-owner contacts, effort accounting, crowding and transition fixtures |
| Breaking free and regaining feet/get-up | Follow-up | Supported recovery/active-ragdoll transition policy |
| Hands clasping each other around the runner | Follow-up | Actual self-hand contact and a finite internal grasp; no remote opponent attachment |
| Strip attempt, fumble, recovery, touchdown/spot adjudication | Follow-up | Physical ball/possession and complete relevant rules |
| Full foul enforcement and tackle-credit statistics | Follow-up | Dedicated rule/stat observers; cannot rewrite contact outcomes |

Low tackle target selection must not be faked by lowering only a hand goal while the shoulder remains upright at chest height. A single rigid standing proxy cannot truthfully claim independent restriction of two moving legs. The architecture leaves room for those capabilities without requiring them in the initial four gates.

USA Football publishes separate upper-body form, thigh/drive, and thigh/roll instruction [S1, S6]. Therefore this package must not be marketed as demonstrating all tackle types when it demonstrates the upper-body foundation.

## 6. Technique preference and rule eligibility

This is a game-design specification, not instructions for conducting physical tackling drills.

The initial controller's eligible retention regions are the runner's torso/hip surfaces below the neck. It must not deliberately seek a facemask, helmet opening, collar, or nameplate grip. Head contact stays physically possible if the attempt is poor; it is logged and shown rather than erased.

The official rules describe a particular grasp-plus-body-drop/leg-trapping combination for the hip-drop foul, and separate collar restrictions [S11]. Do not equate every rolling fall with that foul.

Required here: target-eligibility policy and enough contact/body-motion trace to inspect unintended technique. Production foul classification and penalties remain deferred. Do not cancel valid forces or teleport bodies to make an accidental configuration appear compliant.

## 7. Appearance and variation acceptance

At normal speed, inspect purpose and rhythm. At slow speed, inspect mechanics.

The result should visibly distinguish:

- Controlled approach versus late braking/overrun.
- A shoulder that fits versus a glancing miss.
- Arms reaching around a surface versus reaching straight through it.
- Closure with sustained pressure versus a loose, slipping hold.
- Continued grounded drive versus a defender being carried.
- Improving a partial hold versus magically resetting to a standard pose.
- A balance recovery versus an actual fall.
- An articulated fall versus an animation reset.

Test mirrored approaches, differing runner headings, body dimensions, speeds, and cap-limited effort. Repeating identical initial conditions and a fixed seed may produce the same result; forced novelty and joint noise are not requirements.

Source material does not supply the exact forces or thresholds used here. Attribute-to-capability mappings and physical coefficients must be calibrated through these observable fixtures.

### 7.1 Later technique and attribute increments

After the foundation passes, develop one of these at a time:

1. Low shoulder entry: a body/posture representation that can actually lower the shoulder, plus separate leg target geometry. Validate low connection before adding a roll.
2. Leg-control finish: represent how contact restricts a step or leg motion; a rigid whole-body capsule cannot establish that effect by naming a grip thigh.
3. Deliberate rotational finish: add a finite controlled transition between supported action and passive falling. Record where rotational work/ground reaction comes from; do not inject an arbitrary spin impulse when a technique is selected.
4. Multi-defender tackle: begin with two defenders and one runner, shared contacts, no duplicated runner resistance, and simultaneous conversions. Only then expand pileups/team pursuit.
5. Evasion/hand fighting: runner stiff-arm, spin or juke and defender arm-clearing attempts need causal limb contact and failed attempts, not evasion/shed rolls.

Expose attributes through observable capabilities:

| Input | Appropriate initial mapping |
| --- | --- |
| Height/build/arm span | Explicit landmarks, collision dimensions, contact band, and reach |
| Mass | Actual total mass and inertia distribution |
| Speed/quickness | Request speed, finite drive/braking, turn/reach rate |
| Strength | Explicit actuator ceilings and bounded closure/pull |
| Tackling technique | Observation timing, target error, shoulder/arm selection and readjustment quality |
| Runner resistance/technique | Bounded drive, posture/facing choice, retention escape actions |

If execution error is used, sample it once per meaningful attempt or observation and retain it coherently. Do not roll independent joint noise each frame. Avoid counting a composite tackling rating as an extra force multiplier after its strength/accuracy components have already been applied.

These mappings are extension contracts, not a requirement to calibrate a full rating/fatigue system before the four gates can pass.

A useful later wrap extension is a selfClasp relationship when the defender's achieved hands actually meet. A breakable internal hand-to-hand constraint can preserve a closed arm loop during falling without welding the defender to the runner. It must require reachable geometry and real self-contact; a wrap that cannot reach that configuration remains a forearm clamp. This is an optional mechanical design proposal, not an assertion that every football wrap uses clasped hands.

## 8. Source register

Sources were read/retrieved on 2026-11-02. Some Football Development pages render only a JavaScript shell when opened directly; their indexed primary-source text was used alongside USA Football's public pages and PDFs. No unavailable video content or proprietary curriculum is assumed.

| ID | Primary source | Relevant material |
| --- | --- | --- |
| S1 | [USA Football shoulder tackling](https://usafootball.com/coaches-organizations/shoulder-tackling) | Overall progression and distinct tackle families |
| S2 | [USA Football ADM practice plan, printed page 7](https://assets.usafootball.com/documents/rookietackle/resources/ADM-Practice-Plans-Rookie-and-11.pdf) | Assignment leverage, preparation, shoulder entry, closure and finish |
| S3 | [USA Football Advanced Tackling glossary](https://assets.usafootball.com/documents/Advanced-Tackling-System-Glossary.pdf) | Connection, pressure, ground drive, reworking a hold, rotational action |
| S4 | [USA Football leverage](https://footballdevelopment.com/shoulder-tackling/leverage/) | Approach relative to assignment/field/opponent |
| S5 | [USA Football form tackle overview](https://footballdevelopment.com/shoulder-tackling/form-tackle/form-tackle-overview/) | Upper-body target and shoulder-centered form |
| S6 | [USA Football thigh and drive overview](https://www.footballdevelopment.com/shoulder-tackling/thigh-and-drive/thigh-and-drive-overview/) and [thigh and roll](https://www.footballdevelopment.com/shoulder-tackling/thigh-and-roll/) | Different lower-body connections and finishes |
| S7 | [USA Football advanced connect](https://footballdevelopment.com/advanced-tackling/connect/) | Shoulder accuracy and maintaining connection against resistance |
| S8 | [USA Football advanced prepare](https://footballdevelopment.com/advanced-tackling/prepare/) | Preparation timing and variable approaches |
| S9 | [USA Football advanced finish](https://footballdevelopment.com/advanced-tackling/finish/) | Continued work, imperfect shoulder contact, and hold improvement |
| S10 | [USA Football advanced accelerate](https://footballdevelopment.com/advanced-tackling/accelerate/) | Ground drive and rotational finishing distinction |
| S11 | [Official 2026 NFL rules PDF](https://static.www.nfl.com/image/upload/fl_attachment/league/tqivdkzt9mu6wdgsh1ku.pdf) | Rule 7-2-1 and Rule 12-2; rulebook takes precedence over simplified glossary pages |
| S12 | [Seahawks teaching-resource article](https://www.seahawks.com/news/seahawks-tackling-video-to-change-the-game-124566) | Provenance and optional visual-reference route; video not analyzed for this review |

All simulation translations, force laws, control policies, and fixture thresholds in this package are design proposals inferred from those principles. They require implementation, measurement, and visual review.
