# 16. Blocking

Status (2026-11-17): the rough first slice is in the lab (palm push, block controller with its engaged state, the `BL`
scenes), the base and the punch are built; what was built, the owner's rulings, the tracked defects and the lab links
are in the [handoff](../handoff/plan16.md). The user has looked at base and punch (2026-11-18); next is flat feet,
then item 3.

## What a viewer should see (user, 2026-11-17, after the first lab look: "as a start this looks ok")

- **Load low, explode up and forward**, the punch leading that effort. Arms in at the chest, loaded, then both hands
  explode out together, low to high, aimed at the centre of the chest (the chest pads), and drive in and up. The punch
  is the main weapon of the block.
- **The punch is timed.** "Can't extend and then make contact, needs to extend and hit chest with high impact": the
  hands land while the arms are still extending, never straight arms first that then close.
- **Inside control wins.** Whoever gets the centre, inside hand position has the leverage and generally wins. Inside
  leverage should "meaningfully push back the opponent and sort of lift them up off their feet (not literally) so
  they are easier to push": the loser is stood up and driven up and back.
- **Violent.** "They are punching in the chest and trying to drive their opponent up and back."
- **Feet flat on the ground, an athletic base** (second look, 2026-11-18: "a real problem"). No standing on the toes
  with the heels up, no tiptoe foot behind. Helmets touching is fine. Forearms through each other: better, still a
  problem.
- **A stronger base, not a wide one.** Close legs with bent knees right under the hips cannot withstand a block; but
  feet under the hips is good, "maybe slightly wider, not super wide". A foot goes back to brace when the push calls
  for it, not as the standing pose.
- **Two entries.** From a three-point stance (very low to high); and from running (the play developing, next-level
  blocks): still load low with the legs and explode low to high, less pronounced, since he is already moving and more
  upright.
- A man with both feet off the ground can be right in a situation but generally should not happen.
- **Dynamic, later.** Several punches, re-punching for inside position, sweeping the other man's hands,
  re-establishing position; a block sustains, but it is not one move into a static hold. Not to be built yet; the
  block must not be designed as a single action that cannot be re-punched.

Nobody falls unless genuinely overpowered. Not yet: shed moves, getting round, pass-rush choices, a ball.

## Direction

- **Rough and end to end first**, then polish what looks worst in the lab, together with the parked footwork queue
  (plan 15) and the parked tackle list.
- **Legs stay posed** (user). Where a pushed man must resist from his feet, a rule reads the planted feet.
- **A behaviour a brain can pick** (user: each player eventually gets an internal state machine). Own controller kind,
  small request, simulation rules keyed on the player's own state. No selection logic until asked.
- Arms in the existing three stages (authored source pose, one task, one final pass); no per-case guards.
- The men are held apart at arm's length by their hands, not chest to chest (from the probe).

## Left

1. **The base: done** (`BASE_V1`, `BASE_V2` on `BL`; see the handoff). A man resists what his planted feet give and
   steps a foot back when the push needs it.
2. **The punch as a strike: done** (`BLOCK_STRIKE_V1` on `BL`; see the handoff). Load, a strike timed to land on bent
   arms mid-extension, then the drive; restartable. Its poses still come from the stance, hinge and ready-hands
   requests; the user's animations replace them when they arrive.
   **Next: flat feet and an athletic base** (user's second look). The blocking stance and its steps keep the whole
   sole down: the crouch comes from hips back and a flat back within the ankle's range rather than heels lifting; feet
   a little wider than the hips, toes ahead; the brace foot lands flat; steps are short and flat-footed. The base
   rule then reads a real base behind the heel.
3. **Inside hands and the contest.** The winner gets under and stands the loser up: the loser's posture rises and
   what he can resist drops, so he is driven up and back. Both men aim for the centre of the chest, so they compete for the inside lane:
   who is inside is decided by who got there (timing, reach), not set per fixture as `under|over` is now. This is
   also the answer to forearm through forearm: one man's hands inside, the other's outside. The contest's advantage
   comes from inside hands and being lower; push strength from effort rather than requested speed; the loser gives
   ground in choppy steps and, overpowered, leans to a real fall.
4. **Entries:** a three-point stance start (very low to high) and a run-in (less pronounced load, more upright), as
   scenes.
5. **Polish** in the handoff's defect order, with the footwork and tackle queues.
6. **Milestone:** lab review by the user after 1 and 2, again after 3 and 4.

Later, on the user's word: the dynamic block (re-punch for inside position, hand sweeps, re-establishing).

Each is flag off first, then on, full-checked (`CLAUDE.md`). Later, when blocking meets a ball carrier: a blocker role
and the rules (`progressStopped`).

## Acceptance (viewer rules)

- Hands on the other man's chest or shoulders, not through him; elbows and shoulders anatomically possible.
- Feet: plan 15's rules (short steps, no gallop, a foot down when pushed, no foot inside the other man).
- An even match stays up for the whole run; the overpowered man gives ground before he falls, and falls as a ragdoll.
- No skate, snap or energy from nowhere; G, L1, L2 and RH byte-identical; existing L3, L4 and HC summaries
  byte-identical until a flip step says otherwise.
