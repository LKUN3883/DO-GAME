# Game Feel and UI Regression Baseline

## Scope

This suite records the current `main` behavior as the original-build baseline and runs in Chromium with the existing 60 Hz game loop. It does not alter gameplay code, tuning, existing assertions, or blueprint values. Automated measurements describe input/state/render timing; they do not establish that movement feels good to a player.

## Baseline metrics

Each input transition is sampled against the production logic-tick counter exposed by the existing test-only browser injection.

| Metric | Measurement |
|---|---|
| A/D response | Logic ticks from browser key event to first nonzero player displacement; record displacement and velocity on that tick. |
| Key release | Position at the first tick sampling keyup, then maximum additional displacement over six ticks; report both separately. |
| Direction reversal | Ticks from releasing one direction and pressing the other to first displacement in the new direction; record signed displacement and velocity. |
| Jump / land | Ticks to leave grounded state, apex tick, and ticks until grounded again. |
| Dash | Activation tick, active logic-tick count, total displacement, and whether landing resets dash availability. |
| Slide | Entry tick, duration, displacement, and exit state. |
| Grapple | Ticks in fly before pull/stuck, transition state, and release-to-none ticks. |
| Input blocking | Repeat the same transitions while grounded, airborne, dashing, sliding, pulling, near a wall, and after simulated blur. Record missed or delayed edges by state. |
| Display integrity | Viewport, Canvas dimensions, horizontal overflow, non-background pixel ratio, page errors, and a screenshot artifact for the same initial scene. |

The test report stores raw counts and positions in JSON. Movement values remain in the game's world units; frame counts use logic ticks, not display refresh events.

## Comparison protocol

1. Run the suite on the original `main` commit and retain its JSON and screenshot artifact.
2. Run the same test commit against each hand-feel/UI experimental commit without changing test assertions or inputs.
3. Keep browser version, viewport (1280×800), initial level, clock setup, and input order fixed.
4. Compare raw measurements and screenshots side by side. Report any intentional behavior changes as deltas; do not hide a regression by widening thresholds.
5. Add a new assertion only when the desired limit has been explicitly agreed. Until then, this suite asserts discrete correctness properties (e.g. movement starts on the first sampled input tick, release does not continue accumulating displacement, and state exits occur) and reports measured timing.

## UI and effects

The baseline screenshot is a visual reference, not a pixel-perfect golden image. For an experimental UI/effects build, the test verifies that the page and Canvas render a non-empty frame without overflow or browser errors, then retains its screenshot. Intentional visual changes are reviewed as paired screenshots; pixel diffs are not treated as automatic failures.

## Human evaluation

A player must still rate responsiveness, momentum, air control, action chaining, readability, and comfort on the target Windows setup. Automated frame counts and screenshots cannot substitute for that evaluation.

## Current status

- Original-build automated baseline: pending CI run for this test PR.
- Hand-feel experimental build: not supplied; joint comparison pending.
- UI/effects experimental build: not supplied; paired render comparison pending.
- Windows human evaluation: separate from this automated suite.
