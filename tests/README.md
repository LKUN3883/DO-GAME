# Integrated validation

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run test:browser
npm run test:browser:grapple
npm run test:playthrough
```

Set `CHROMIUM_EXECUTABLE_PATH` to use an existing browser executable.

- Logic: 81 tests across movement/combat, Boss, 35 grapple cases, five PR #4 respawn/body cases, two joint integration cases, and final acceptance/timing/stress cases. Uses real game code and level JSON with browser globals stubbed.
- Controlled Chromium: 14 scenarios, real Canvas/fetch/ES modules/input, paused clock with explicit RAF advancement; isolated fixtures are marked.
- Native-RAF Chromium: six scenarios with actual running RAF and keyboard/mouse events, screenshots and frame traces in ignored `browser-results/`.
- Input-driven progression: reads state snapshots and writes only keyboard/mouse events from default spawn; no teleport, stat refill, invulnerability or enemy removal. Checks all enemies/Boss cleared, unlocked exit and WIN. This is tool-assisted automation rather than human/blind play.

Current local results: all suites pass; latest progression reaches WIN in about 53.9s controller time without a death. CI executes the same commands on the integrated candidate and archives existing browser screenshots/traces.

Detailed source revisions, coverage, design clarifications and platform limits: [final acceptance](../docs/reviews/FINAL_ACCEPTANCE.md).
