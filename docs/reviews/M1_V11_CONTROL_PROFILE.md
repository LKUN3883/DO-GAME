# M1 v1.1 control migration / isolated input-profile experiment

**Source of authority:** [Long-term plan v1.1.1, D-01](https://chatgpt.com/space/page_5149e3e8c6c88191a7c0e897cdf81d8b) and user v1.1 battle/level blueprint.
**Code base:** Draft [M1 rope integration PR #16](https://github.com/LKUN3883/DO-GAME/pull/16) HEAD `fa393e2b182d0598cb1fa95afafd32b935494eb5`.
**Target:** Complete the *input mapping* part of M1 without changing the old public version, existing movement numbers, weapon damage, or rate of fire.

## Mode comparison

| Input | No URL hash (current stable behavior) | Experimental `#m1-controls` |
|---|---|---|
| A / D | Move | Move |
| W / Space | Jump; second press in air triggers Dash | **Jump only**; second press does not trigger Dash |
| Shift | No action | **Ground while moving: slide; airborne: Dash** |
| S | Crouch when stationary; start slide while moving | Crouch (including while moving), S + jump = pass down through OneWay |
| F / J | F melee; J unused | **J melee**, F unused |
| LMB / K | LMB sustained fire; K unused | **K OR LMB** feeds existing sustained fire (charge gun not yet implemented) |
| RMB / U | RMB grappling; U unused | **U OR RMB** grappling; release only after both sources release |
| Mouse | Aim | Aim |

The new experimental hash inherits M1 wall rope, detached velocity and slide-jump handoffs. Older experiment hashes `#m1-swing`, `#slide-jump-momentum` and `#grapple-momentum` keep their prior behavior.

## State ownership and input priority

1. The input sampler creates a separate virtual `Dash` input for Shift. The corresponding press can never also be a `Jump` press.
2. Shift on grounded + direction (inside `prepareStance`) starts slide. With the player airborne, and while not grappling/Dashing, Shift may start air Dash if unused and sufficiently resourced.
3. S preserves crouch and OneWay descent, without starting slide. If the character is already sliding, the slide state retains ownership until jump, normal end or another action takes over.
4. Air Dash takeover clears old slide-jump and grapple-release movement carry; rope takeover clears Dash and old carry.
5. `KeyU || Mouse2` and `KeyK || Mouse0` are combined **logical holds**, not separate grapples/guns; releasing one while the other remains held does not fake a button release event.
6. Blur/hidden tab clears raw keys; respawn input lock continues to mask new virtual Dash as well as existing virtual controls.
7. In default legacy mode `input.Dash` is always false; F/Space/S behavior is unchanged.

## Explicitly out of scope

- No double-jump or wall-jump *yet*: second Space in air currently does nothing, instead of incorrectly triggering Dash.
- No input buffering yet; v1.1 target 8–10 logical ticks is a future independent PR.
- No new 0.15 s Dash/0.25–0.35 s slide timings yet; legacy timing values remain until dedicated mechanics tests.
- No charged single-shot K gun yet; K and LMB are aliases for the existing rapid-fire implementation. This interim behavior is intentionally marked in the UI.
- No close-range execution, resource model migration or 3D/PixiJS engine migration.
- Not an end-user deployment: the experimental branch and `#m1-controls` are not published at the stable GitHub Pages URL.

## Verification

- New Chromium game-feel cases: S crouches without starting slide; Shift ground slides; Space jumps and repeated midair Space does not Dash; airborne Shift Dash works and clears stale slide-jump state; J/K/U aliases; simultaneous U+RMB hold; blur clearing; normal hash legacy controls.
- All existing Node, Chromium browser, grapple and complete playthrough tests must remain green on Ubuntu and Windows.
- More thorough rebind ergonomics and real Windows user feel remain separate G4 acceptance, **not claimed by automation**.

**Merge discipline:** Keep Draft; since PR #16 and this PR share production file paths, do not merge both as independent complete solutions. Integrate exactly one approved M1 baseline after G4/approval.
