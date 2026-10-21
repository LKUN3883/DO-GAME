# Validation

Run the logic suite with Node, and the browser suites with Playwright:

```sh
node --check docs/game.js
node --test tests/grapple.test.cjs
npm test
npm ci
npx playwright install --with-deps chromium
npm run test:browser
npm run test:browser:grapple
npm run test:playthrough
```

The VM harness runs the real `docs/game.js` and loads the checked-in training
level; only browser APIs/render scheduling are stubbed. Grapple tests also use
small isolated fixtures for exact geometry and timing assertions.

## Grapple / blueprint chapter 14

35 targeted tests cover spawn size/aim/single-head gating, all four terrain
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

## Validation status (2026-10-21)

Integrated PR #2 through `65ecb0c3994b502c2f1a93a74b76b3b4285cf918`,
including collision rollback, first-contact Dash termination, window mouseup for
both buttons, damage-stage knockback, ten Chromium regressions, and the
user-approved Boss camera correction already recorded by that PR. Grapple
parameters remain unchanged. All Node tests share `tests/game-harness.cjs`.

`npm test` passes 58 tests: 35 grapple tests plus the 23 upstream logic tests.
GitHub Actions runs these tests and both browser suites on the repair branches
and on PRs targeting main/the base repair branch.

## Actual Chromium coverage

The local Playwright download failed because its CDN returned a 195-byte
"Site Unavailable" HTML page in place of the ZIP. GitHub's Ubuntu runner
successfully installed Chromium 151.0.7922.34 and Playwright 1.62.1.

`tests/browser/playtest.cjs` runs six native-RAF scenarios in real Chromium:
movement/release/A+D, jump plus single-use air Dash and landing, wall grapple
pull/release, floor-anchored STUCK with attacks and outside-canvas release,
Dash wall contact, and one Boss melee hit per swing. It uses actual HTTP,
ES modules, fetch, Canvas, keyboard/mouse events and the running production
loop. The server adds state-observation hooks; it does not replace physics.
The wall, quiet and Boss fixtures isolate scenarios; the movement and jump
scenarios use the unmodified training level. Screenshots and per-tick JSON are
uploaded as the `chromium-playtest` workflow artifact.

The six scenarios passed at `003e46a86d35ccaa19bf5b4bba4897398c5a6fee`:
https://github.com/LKUN3883/DO-GAME/actions/runs/39608705271
The first run's STUCK melee assertion failed because a synthetic test tap was
shorter than one sampled logic frame (trace: no melee frames and ST stayed at
100). Holding action keys across at least two ticks fixed the test. The game
input definition was not changed or buffered to accommodate the test.

`tests/browser.test.cjs` retains the ten upstream Chromium regressions with
an explicitly paused Playwright clock, including OneWay, blocked shooting,
blur, diagonal Dash contact, Boss melee and the approved Boss camera bounds.
CI runs both suites on the integrated version; check the current run for its
result. Headless browser automation and screenshot inspection are not a full
human playthrough or an assessment of game feel. Mobile, other browsers,
complete progression, Boss attack cycles and other remaining audit items have
not been certified by these tests.

## Final pre-merge review

The current branch integrates PR #2 through `65ecb0c`, including its Boss
attack/death/WIN fixes and input-only progression script. The workflow runs
58 logic tests, 10 upstream browser regressions, six native-RAF grapple
scenarios, and the input-driven complete-level progression on the combined
code. Consult the latest workflow run for the final integrated result.

Three new failing regressions reproduced two issues before the final fixes:
melee knockback left both PULL/STUCK anchors stale at render time, and pulling
off the ground retained a paused slide. Cleanup now refreshes surviving local
anchors after damage/knockback; active slides continue timing during a pull
and end on loss of ground, wall stop or their original 0.9s expiry. No grapple
parameters were changed.
