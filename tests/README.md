# Validation

Run with Node (no third-party test dependencies):

```sh
node --check docs/game.js
node --test tests/grapple.test.cjs
node --test tests/*.test.cjs
```

The VM harness runs the real `docs/game.js` and loads the checked-in training
level; only browser APIs/render scheduling are stubbed. Grapple tests also use
small isolated fixtures for exact geometry and timing assertions.

## Grapple / blueprint chapter 14

29 targeted tests cover spawn size/aim/single-head gating, all four terrain
spawn blockers, 0.05 cm backtracking through 0.90 cm, failure without resources
or cooldown, final spawn origin, 28 cm/s flight, 40 cm range, target priorities,
nearest-center/Unicode id selection, clamped and moving local anchors, 10 cm/s
pull plus 3 cm/s input adjustment, gravity exclusion, jump/Dash restrictions,
terrain and OneWay collision, consecutive STUCK detection and counter reset,
attacks while pulling/stuck, inclusive proximity termination, same-tick
target death, release outside the canvas, blur, respawn and deterministic replay.

Player movement uses an anchor established on an earlier tick. A head moves and
establishes its anchor at stage 21.1.10, after character movement; pulling starts
on the next tick. Moving targets refresh the anchor before player movement and
again after target movement. Attachment supersedes an ongoing Dash/JumpAscend,
so neither can resume after release. End effects happen immediately, with head
and state cleared at cleanup. STUCK ignores proximity and disappearing terrain;
only release or anchored-character death ends it (respawn also clears all state).

## Baseline comparison (2026-10-21)

Starting point: `34f32508c3eb1f8dd1b04bbbc061ed6ff371d194`, the head of PR #2.
Its original smoke suite had 1 pass and 3 failures. After this change it has
2 passes and 2 failures: grounded A/D and the original grapple scenario pass.
The unchanged failures are the missing ordinary-enemy melee knockback and
missing active Boss health bar. These assertions remain enabled.

Together with the 29 targeted tests, the full suite has 31 passes and 2 known
failures. This is not full-game blueprint certification. Other PR #2 audit
items (global frame ordering, player/body separation, collision rollback,
enemy AI, respawn/checkpoints and unrelated UI) remain outside this repair.

No Chromium playtest was completed: Playwright is present in the editing
environment, but its browser executable is unavailable. Browser input bubbling,
canvas appearance and interactive feel still require a real-browser check.
