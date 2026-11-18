# M1 input buffering and landing velocity prototype

Baseline: [PR #18](https://github.com/LKUN3883/DO-GAME/pull/18) HEAD `7aa8bab2e6eb20f3a0f1f493eda3ed29b22b4f2b`, itself a cumulative Draft above #17 (v1.1 controls) and #16 (terrain rope and slide-jump). User-approved long-term plan v1.1.1 calls for a **jump input buffer of 8–10 fixed logic frames** and natural high-speed transitions. The exact 9-frame choice and the implementation values below are **experimental decisions**, not immutable original spec.

## Purpose
Avoid losing Jump/Shift commands when pressed shortly before landing, and avoid instant horizontal-velocity discontinuity at the air-to-ground boundary. Input buffering is deliberately not applied to the old public build or other hashes.

## Opt-in mode
`#m1-buffer` enables the previous `#m1-jumps` family (double jump, per-wall kick, Shift Dash, fixed-length rope, slide-jump), plus:

1. **Nine simulation-tick landing prediction.** Falling player has downward/non-positive VY; one blocking/one-way platform top is below current feet and is predicted to be reached within 9 × 1/60 s. X support must overlap now or at predicted X; ignored one-ways do not count. This is an approximation, **not** ray-cast collision authority.
2. **Jump buffer.** If Jump is newly pressed just before such a landing and no *unused valid wall kick* is available, hold it up to 9 ticks rather than spending the air-jump. The next genuinely grounded tick executes one ground jump. It does not consume the extra air jump. If landing never occurs, the intent expires; holding Space does not repeat it.
3. **Wall-jump priority.** When a valid unused wall-kick face is available, Jump immediately kicks away instead of being delayed for the nearby floor. If a wall has already been used, an early jump may be buffered for ground use.
4. **Slide buffer.** If Dash has **already been used** in the current airtime and the player has a directional input, Shift pressed shortly before a predicted landing arms a ground slide. Otherwise the active airborne Shift Dash takes normal priority. A simultaneous pending ground jump has priority over pending ground slide.
5. **Ground velocity continuity.** Without a slide or Dash owner, gradually approach ground target VX instead of instantly replacing current VX. Experimental horizontal acceleration 70 units/s² when input held, friction 45 units/s² when neutral. Other non-owned aerial motion uses 45/5 respectively. Current speed is inherited, not reset on normal slide termination; no 3D, physics engine or 60Hz change.
6. **Lifecycle and safety.** Cached commands are cleared on execution, expiry, blur/hidden-tab input reset, or respawn; OneWay S+Jump interactions are not converted into unintended buffered bounce. Respawn key lock still blocks new button edges. Dash/grapple jump allowances and stale carry ownership remain governed by #18.

## Known constraints
- This prediction is based on nearby platform rectangles and approximate downward kinematics; edge cases at small geometry and unusually fast lateral motion remain to be tested; the true resolver still decides whether the character lands.
- Buffered Jump near ground deliberately delays an otherwise available air-jump to favor prompt ground re-jump. User playtest must judge whether 9 frames feels too forgiving or confusing.
- This is *not* global 9-frame buffering for all combat actions. Melee/Gun/Grapple buffering requires separate state-machine priorities.
- No new short Dash / slide timings yet, no coyote time, no rope wrap/corner dynamics, no true completed end-to-end v1.1 level.
- Legacy mode, `#m1-controls`, `#m1-jumps`, `#m1-swing`, `#grapple-momentum` are unchanged.
- There is no standalone playable Preview until an explicit preview deployment is verified. The public GitHub Pages URL still points at **main**, not this experiment.

## Required verification
- Node: buffered near-floor Jump/Shift, valid wall kick precedence, expiry on vanished floor, no auto repeat, no consumption of air jump on buffered landing, blur, respawn lock, legacy hash unchanged, deterministic state trace, gradual speed transition.
- Chromium: real keyboard Space and Shift events, landing buffered re-launch and slide, blur prevention, screenshot+JSON. Previous browser/Game Feel/grapple/whole-level acceptance suites must remain green across Ubuntu and Windows.
- Windows user human A/B only after merged feature baseline has an independent browser-accessible preview and a short script. Automated Chromium is never a substitute for real Windows input feel.

Do not merge this stacked Draft independently alongside #15/#16/#17/#18; integrate at most one reviewed cumulative branch after full acceptance.


## M1 fifth slice: 0.30s slide and 0.15s Dash (`#m1-timing`, 2026-11-17)

This cumulative branch extends `#m1-buffer` with the following **experimental tuning grounded in the uploaded v1.1 §§1.2 and 1.4**:

- Ground Shift slide: **18 fixed ticks** at 60Hz (0.30s, within 0.25–0.35s); 40% lower player collision body (height 1.2 vs 2), **six protected ticks** (0.10s). Fixed-countdown is used in this mode to avoid floating-point i-frame overrun.
- The slide speed eases **10→8 world units/s**, preserving velocity through slide→jump and at slide exit; low ceilings retain crouch if standing would penetrate solids.
- Air Shift Dash: **9 ticks** (0.15s) at 50 world units/s, maximum 7.5 units of motion; collision or landing ends it. The 60Hz Dash frame is subdivided into **<=0.25 unit** substeps and each slice uses the existing axis collision solver to prevent tunneling through thin walls.
- On natural airborne Dash expiry a bounded **8 units/s** directional velocity remains with air steering. On wall impact preserve only unblocked solver motion. On ground contact clear airborne carry. New jump/grapple still own their transition.
- Normal acceleration **70 world units/s²** approaches speed 8 in ~0.12s; neutral ground friction **100 world units/s²** stops from 8 in ~0.08s. Other modes retain the preceding tuning.

**Isolation:** `#m1-timing` alone enables these new rules. No-hash main gameplay and older `#m1-buffer`, `#m1-jumps`, `#m1-controls` profiles are unchanged. This is still not an engine swap, full 3-input melee/charged gun redesign, or a real Windows feel acceptance.

**QA:** added 14 Node VM cases for 18/9 tick boundaries, posture, protection, low ceiling, momentum, thin wall, downward collision, blur/respawn and old-profile isolation; plus 3 Chromium real-key scenarios with screenshots. Must pass Ubuntu/Windows Node and Chromium, legacy grapple and complete-playthrough before consideration.

**Known limitations:** shared legacy `p.iframe` is not yet separated into slide-specific vs received-damage invulnerability; rope wrapping around complex corners, dynamic environment geometry, sprite animations and Windows human A/B remain outside this slice. There is no independently deployed preview.

**GitHub bookkeeping correction:** an attempted *new* review file write landed on main unexpectedly and was reverted immediately. Main's post-revert **file tree matches the former stable main tree byte-for-byte**, but Git history contains the add/revert pair. This review section is now deliberately added by updating this existing file on the Draft branch only. Do not claim main's commit SHA is unchanged.

**Safe release rule:** this Draft stacks on #15/#16/#17/#18/#19; never merge every overlapping PR independently. Select one later reviewed integration path and obtain human Windows acceptance before treating M1 as ready.
