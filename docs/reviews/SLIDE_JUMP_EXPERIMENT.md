# PR #15: slide-jump momentum experiment

Branch: `experiment/slide-jump-momentum-20261116`.
Reviewed algorithm revision: `a08419b7bc719def80ac637c1e0ea5c3472b0e67`.
This experiment remains opt-in via `#slide-jump-momentum`; it requires review before adoption.

## Experimental parameters and blueprint deviations

Values are in game world units (the production source labels these cm).
These are experimental values, not newly approved blueprint constants.

| Parameter | Value | Behavior |
| --- | --- | --- |
| Logic step | 1/60 s | Existing fixed production step |
| Launch horizontal speed | Actual slide `vx` on jump sampling tick | Preserved exactly, including its sign; ordinary slide starts at magnitude 10 |
| Directional acceleration limit | 90 units/s² | At most 1.5 units/s per logic tick, integrated from current velocity |
| Directional target | `input_x * 8` units/s | Existing normal movement target; clamp prevents overshooting it |
| Neutral drag | 5 units/s² | At most 1/12 units/s per logic tick toward zero; A+D also uses neutral drag |
| Momentum duration | Whole airborne action | Replaces the previous experimental fixed 0.18 s blend |
| Ownership transitions | Landing, successful Dash, grapple pull, respawn/reset | Clear old momentum state; rejected Dash does not own movement |
| Focus loss | Release raw inputs; retain airborne momentum | Neutral drag continues; blur is not an artificial instant air brake |

The 0.18 s fixed blend is obsolete and is not used by the reviewed algorithm.
The airborne acceleration bound applies to unobstructed momentum steering.
Dash, grapple takeover, collision response and ordinary ground control intentionally
have their existing velocity rules; their discontinuities are not evidence of a
steering-integration failure. In particular, the tick after landing returns to
ordinary ground control, which can set horizontal velocity to zero immediately.

## Verification repairs

The original Chromium Game Feel helper advanced the clock by 17 ms per call.
That can execute two 60 Hz logic ticks, making first-tick assertions fail and
silently skipping intermediate velocity samples. A local run of the unmodified
revision reproduced `2 !== 1` on the air Dash response assertion (7/8 passed).
The helper now advances 1 ms at a time and asserts exactly one production logic
tick per sample. No assertion thresholds were relaxed or failing tests removed.

The original blur JSON claimed `blurCarryCleared: true` while the assertion
required the carry state to remain valid. The metric now records the observed
`blurCarryPreserved` and raw input count. Reports use the actual candidate SHA
in Actions instead of labeling an experiment as `original-main-baseline`.

## Coverage and retained evidence

Run the existing full Node suite and all Chromium suites:

```sh
npm ci
npm test
npm run test:browser
GAME_FEEL_BUILD=$(git rev-parse HEAD) GAME_FEEL_RESULTS=test-artifacts/game-feel-baseline.json GAME_FEEL_SCREENSHOT=test-artifacts/game-feel-baseline.png node --test tests/game-feel.test.cjs
npm run test:browser:grapple
npm run test:playthrough
```

Game Feel now covers exact launch inheritance, D→A→D, per-frame acceleration
bounds, both slide directions, switches beyond 0.18 s, A+D cancellation, neutral
drag, sustained reversal, natural landing without Dash, real D+S→Space→air Dash→
landing, grapple takeover/release, blur, death/respawn, reset, default-hash
compatibility and thin wall/ceiling contacts. Isolated floor/wall fixtures are
explicitly marked; these are automation scenarios, not human play acceptance.

The test-only server records each opt-in production logic tick after collision
and state transitions, without changing the production module on disk. JSON and
CSV contain position, velocity, sampled horizontal input, action ownership,
grounding, respawn lock and terrain penetration. Mirrored pages retain separate
traces. Screenshots retain the slide-jump launch, active Dash and baseline Canvas.
Actions uploads CSV together with existing JSON, screenshots and native-RAF
browser results on both Ubuntu and Windows.

No production physics change was needed during this verification pass. Windows
human A/B assessment of momentum, air control and landing transitions remains
pending commander review. A separate delivery report records exact local and CI
results for the final fix commit.
