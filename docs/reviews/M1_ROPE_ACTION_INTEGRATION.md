# M1 / P0: Rope physics and action-state integration experiment

**Status:** Draft experimental branch, no main merge authorization.
**Plan:** [v1.1.1](https://chatgpt.com/space/page_5149e3e8c6c88191a7c0e897cdf81d8b); user playtest issue [#12](https://github.com/LKUN3883/DO-GAME/issues/12).
**Base:** PR #15 commit `c1ebaf417e58acec90369964cb9bfe875f3095db`; combined on top of frozen main `0e19d27b16e7bedf8cb0204b271362b5b3afcced`.

## Branch behavior and toggles

| URL suffix | Behavior |
|---|---|
| none | exact original release-zeroing and original 60 Hz run/jump/Dash/slide + linear pull |
| `#slide-jump-momentum` | PR #15 carry/air control only |
| `#grapple-momentum` | PR #14 midair release carry only |
| `#m1-swing` | integrated slide-jump, terrain rope constraint, release carry and steering |

The flag is only a prototype mechanism, not an approved input/user setting.

## Movement ownership table

| Transition | State cleared / inherited | Expected postcondition |
|---|---|---|
| Ground slide → jump | slide cleared; slide_jump gets actual launch VX | first jump tick preserves slide VX |
| Slide-jump → air Dash | slide_jump and grapple_inertia cleared | Dash owns velocity; old carry does not reappear |
| Slide-jump or air Dash → terrain rope | Dash, slide_jump, slide, forced ascent and prior grapple carry cleared | new fixed rope controls movement |
| Rope slack ↔ taut | maintain same rope length; constrain only outward radial speed when taut | tangential speed continues, wall does not force STUCK |
| Rope → RMB release | detach; preserve VX/VY only when airborne and deliberate release | A/D slowly controls horizontal motion |
| Rope → target death/timeout/respawn | cancel without false launch | no leftover anchor or carry |
| Airborne → landing | clear grapple_inertia and slide_jump | normal ground movement takes over |
| Input blur | raw key states cleared; no phantom keydown | sustained drift may continue until drag slows it; physical inertia is not input |
| Death / respawn | clear grapple, Dash, slide-jump, grapple_inertia | respawn lock prevents accidental re-entry |

## Rope solver details

1. The grapple head keeps old 28-world-unit/s flight and original target hit order.
2. Only terrain/one-way attachments on `#m1-swing` become a rope; character targets retain the old pull.
3. Store `rope_length = max(1.25, distance(player, anchor))` at impact.
4. Semi-implicit velocity update at 60 Hz: gravity 180 units/s²; horizontal steering 32 units/s²; neutral horizontal damping 0.15/s; fall cap -30; overall speed cap 35.
5. When on/beyond the rope circle, eliminate the *outward radial velocity component only*. Advance through the existing X/Y collision solver.
6. If positional stretch exceeds the rope circle, correct inward using collision-aware axis motion. A blocked horizontal correction does not imply blocking the vertical component.
7. Taut state uses a straight tensioned segment. Slack state draws a sagging quadratic curve.
8. When RMB is deliberately released in midair, preserve velocity and hand it to bounded air steering (45 units/s² active, 5 units/s² neutral drag) until landing, Dash or respawn.

These candidate constants are **not** frozen blueprint changes. Collision tolerance and tension behavior require further automated geometry coverage and actual Windows play feel.

## Risk and missing M1 criteria

- Rope cannot yet wrap around corners. Moving-enemy rope is not active in this prototype.
- No v1.1-specific double jump, wall kick, independent Shift air Dash, input buffer, camera/trail VFX, rope winding or variable rope length in this sub-PR.
- The near-wall collision solver is old AABB axis logic; geometry corner cases and unusually thin obstacles need extended tests.
- PR #14/#15 changes overlap; combining features must be reviewed as **one** integrated movement baseline. Keep other Draft PRs unmerged.
- A successful CI demonstrates test fixtures, not human responsiveness, rope feel or final shipping readiness.

## Planned automated evidence

- Old default behavior unchanged
- Slide → jump → air Dash → rope takeover → release → respawn state ownership
- Real RMB hook into wall, rope length limit, wall nonpenetration and no STUCK, tangential movement
- Both existing branch #15 tests and Node smoke / Chromium / grapple / full playthrough on Ubuntu & Windows
- Captured trajectories and screen snapshots

**Next:** address any failing assertions and regressions. Only after stable CI, prepare an isolated Windows real-player A/B trial initiated by the commander; no automatic merge.
