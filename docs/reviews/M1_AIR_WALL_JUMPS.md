# M1: free air jump and wall-kick experiment

Base: PR #17 HEAD `a0603e845d1ba0376b21c1696392d943446a5cea`. This branch includes the #16 rope / #15 slide-jump work. It is an opt-in prototype, NOT a merge or release approval.

## Product source vs implementation decisions

User design v1.1 sections 1.2, 1.4 and 1.5 require double jump, one wall kick per wall, Space/W separated from Dash, free second jump and Dash not consuming jumps. Long-term plan v1.1.1 places these in M1. The following details are explicit implementation decisions for this experiment; the source does not supply their exact tuning:

- Enable only with `#m1-jumps`. This inherits the new J/K/U/Shift controls and M1 rope. All older hash modes keep their existing behavior.
- Ground launch plus one extra airborne jump. Walking off a ledge leaves one air jump, not two. Neither costs ST. No auto-repeat: a fresh combined W/Space press edge is required.
- Wall contact is a blocking Solid/Wall/locked-Door vertical face. Open doors, OneWay sides, floors/ceilings, remote walls and grazing corners do not qualify.
- A wall allowance is keyed by collider ID + face normal, once per airborne excursion. Landing or respawn resets it. Adjacent colliders forming one authored wall should eventually share a surface ID; this prototype does not yet merge geometry into semantic wall surfaces.
- Wall kick does not spend or refill the free air jump. Dash and rope also do not refill it. If a contacted wall was already used, an unspent ordinary air jump may still be used; it is not another wall kick.
- Contact gap <= 0.02 world units, vertical overlap > 0.25. Prototype vertical impulse reuses 53.334 from the old ground jump; horizontal kick is 10 away from the wall. Air steering reuses slide tuning: 90 units/s^2 with input, 5 neutral drag. These are experiment values, not final feel approval.
- Priorities: ground jump, unused contacted-wall kick, remaining ordinary air jump. On the same frame, a successful jump wins over Shift Dash. Active rope retains ownership until released; jumping while attached does not spend jump allowance.
- Successful airborne jump can take over an active Dash without refunding Dash usage. It preserves CURRENT VX (or supplies wall-kick VX), clears slide/slide_jump/grapple_inertia, and starts one bounded airborne carry state. Dash and grapple takeover clear that carry; old launch VX never resumes.
- Landing resets jump and wall allowances. Respawn/reset removes the extension. Blur clears input without refilling allowances or inventing a jump. Existing respawn input-lock semantics are retained.

## Verification and limits

`tests/m1-jumps.test.cjs` executes production game.js in a Node VM with isolated geometry, without replacing movement/collision functions. It adds 24 checks including mirrored walls, repeated jumps, Dash independence, wall type eligibility, low ceiling, current-VX inheritance, rope handoff, landing/death/blur cleanup, legacy profiles and deterministic full-state traces.

`tests/m1-jumps.browser.cjs` adds five real Chromium keyboard-event scenarios using an explicitly isolated room. It retains JSON and three Canvas screenshots under test-artifacts. Existing browser, Game Feel, grapple and full-playthrough suites remain enabled. package.json includes both new suites in the existing cross-platform jobs.

Local Node: 24/24 passed. Local Chromium navigation was blocked by host policy (`ERR_BLOCKED_BY_ADMINISTRATOR`); that attempt is NOT a browser pass and no browser assertions ran locally. The authoritative browser result must come from this commit's GitHub CI, reported separately.

No Windows human test, full level-design validation, animation/VFX acceptance, input buffering, coyote time, short slide, 0.15 s Dash, charge gun, gamepad implementation, or engine migration is claimed. Existing rope corner-wrap/thin-obstacle and continuous landing-momentum concerns remain open. A reliable independent preview is still required before asking the user for human A/B.

## M1 progress summary

- #14/#15 established separate release/slide momentum experiments; #16 integrated a terrain rope constraint and cross-action cleanup.
- #17 separated jump and Shift Dash, with J/K/U aliases and matching instructions.
- This slice adds the missing air/wall jump actions and boundary tests. It does not declare M1 complete.
- Next: input buffering, short movement timings/ground transitions, rope complex-geometry testing, and one reproducible preview build. PixiJS evaluation remains later.

Do not independently merge the cumulative #15/#16/#17/this branch. Select one reviewed integration route; leave main and the public Pages build unchanged until explicitly approved.
