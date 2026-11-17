# M1 / Fifth slice: short slide, fixed-duration air Dash, collision-safe handoff

**Starting base:** [PR #19](https://github.com/LKUN3883/DO-GAME/pull/19) HEAD `0bf5aa3f10a3bd6c24eed5bec6a28bd7017f89aa`. This is a cumulative experimental branch inheriting #18 jump extension, #17 control split and #16 rope. No main deployment or merge authorization.

## Source and intended scope

The user-provided 《战斗与关卡设计总纲·整合优化版 v1.1》 §§1.2, 1.4 specifies:

- A/D time to full speed **0.12s**, neutral glide **0.08s**.
- Ground Shift = slide **0.25–0.35s**, 40% lowered posture, **0.10s** invulnerability.
- Air Shift = air Dash **0.15s**, immediately terminates on landing. Jump/air Dash use separate keys and Dash does not spend double jump.
- Slide → jump retains launch momentum. The priority is movement-flow continuity.

This fifth slice chooses a **0.30s** slide in the allowed range and a **0.15s** air Dash at fixed 60Hz. The exact exit velocities and collision step are *prototype tuning*, not values dictated by the document.

## Opt-in mode `#m1-timing`

The new hash inherits all features of `#m1-buffer` (including `#m1-jumps`, new controls, rope, nine-tick early landing inputs) plus:

1. **18-tick slide:** Shift+direction on ground enters a 1.2-high posture (standing body height 2, i.e., lowered by 40%) for 18 simulation ticks at 60Hz. Player maintains foot position by preserving the body bottom during resizing. Horizontal slide velocity decreases from 10 toward 8 instead of to zero.
2. **Six protected slide ticks:** `p.iframe` is set to at least 0.10s; in this mode its countdown uses integer 60Hz frame rounding to avoid an extra frame from float residue. Existing longer damage invulnerability is never shortened.
3. **Safe slide exit:** at 18 ticks the slide owner ends, but current VX remains. If overhead blocks standing, the player stays 1 unit high crouched; otherwise stands at height 2 without penetrating terrain. A normal jump during slide clears it and inherits current slide VX.
4. **Nine-tick air Dash:** Shift in air starts a 50-units/s Dash of distance 7.5 units (9 × 50/60). Previous experimental modes continue the original 6-unit Dash. Dash terminates at 9 ticks, immediately upon solid/one-way contact or landing.
5. **Thin-wall-safe movement:** Dash advances with <=0.25-unit physics slices (the ordinary 60Hz frame moves up to ~0.833 units). Each slice calls the *existing* axis collision solver and stops at first collision; this prevents high-speed tunneling through thin terrain and preserves an unblocked tangential component.
6. **No snap-to-zero after Dash:** Natural airborne Dash expiry inherits a bounded 8-unit/s velocity along the Dash direction and enables the existing air-steering owner. Collision-triggered exit preserves what the collision solver did not block; landing clears airborne carry. Starting a new jump/grapple still wins ownership and never resurrects stale slide/Dash movement.
7. **0.12s run-up, 0.08s ground stop:** run acceleration remains 70 units/s², reaching 8 in 7 frames (~0.117s); neutral ground friction becomes 100 units/s², stopping from speed 8 in 5 ticks (~0.083s). Air steering friction remains the previous experimental value.

## QA responsibilities and boundaries

- Existing code only runs these changes under `#m1-timing`. Legacy main, `#m1-buffer`, `#m1-jumps`, `#m1-controls`, etc., are regression-tested unchanged.
- Node VM tests: exact 18/9 tick duration, protected frames and expiration, 40% posture, low-ceiling exit, slide-jump, natural Dash momentum, mirrored/imminent wall collision, thin terrain, downward Dash landing, blur/respawn cleanup and legacy isolation.
- Chromium tests: real-key 18-tick slide, 9-tick Dash, thin-wall stop and steering away, screenshot/JSON artifacts.
- Existing Node, Chromium Game Feel, rope, browser regression and whole-playthrough remain required across Ubuntu and Windows.

**Limitations:** dash collision still relies on the original AABB resolver for diagonal/separation edge cases; dynamic/rotating level geometry, rope wrapping, multiple adjacent wall IDs, exact camera feedback and real Windows input feel remain outside this PR. Slide invulnerability shares the legacy `p.iframe` model; future v1.1 damage rules should distinguish slide-specific invulnerability from enemy damage invulnerability. No new sprite animation/VFX or charge gun is claimed.

**No merge or Pages changes.** #15/#16/#17/#18/#19 and this PR form one cumulative experimental movement chain. Never merge each as independent patches. Main remains the original stable build until a single integrated branch is reviewed, evidence checked and human Windows A/B is completed.
