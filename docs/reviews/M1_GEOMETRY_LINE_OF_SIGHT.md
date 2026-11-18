# M1 geometry: rope line-of-sight and corner safety

**Status:** opt-in experimental `#m1-geometry` branch. Builds on [Draft PR #21](https://github.com/LKUN3883/DO-GAME/pull/21) and the earlier #16–#20 cumulative movement experiments. **No merge to main, no Pages deployment.**

## Problem and solution

The first M1 fixed-length rope corrects radial stretch and collision with a body. A rope can still remain visibly attached across a solid obstacle if the body stays within allowed rope length. That is mechanically inconsistent and may invite false traversal of level obstacles.

This follow-up performs **rope segment vs blocking AABB interior** tests at the beginning and end of a rope movement update. A player-to-anchor segment intersecting Solid, Wall or locked Door triggers `endGrapple('obstructed')` and normal cleanup **without a false inertia launch**. Open doors and OneWay platforms do not block the rope sightline, matching the current geometry categories.

### Design details
1. Liang–Barsky-like per-axis segment clipping detects intersection with each solid blocker, using an inset up to `EPS * 0.5`. That prevents surface-only tangency from being treated as entering the wall, without ignoring very thin wall interiors.
2. The attachment position for a new *solid-terrain* hook is moved back to the first visible AABB boundary on the line from player center to hook head. Existing OneWay hooks are unchanged.
3. Previous hook versions can embed the head center slightly into their target. The existing target is tolerated **only for a shallow final 0.55-world-unit penetration**; a rope running through a thick target or entering from its back side is obstructed.
4. Each movement tick checks the rope sightline **before physics** and **again after collision-aware projection**. If new wall geometry appears, a door locks, or the player turns around a corner without a supported rope-wrap model, the rope safely detaches.
5. This applies only when `#m1-geometry` is active. Previous experimental hashes retain identical behavior. `#m1-geometry` also inherits #20 short slide/Dash and #21 physical substep/coplanar wall-kick changes.
6. **Explicit scope limitation:** this is an obstruction safety fallback, *not* a rope-wrap/pivot-around-corner simulation. The player may experience an abrupt rope release on some corners; actual feel must be judged on Windows after obtaining the offline HTML preview.

### Evidence and QA
- Production VM Node tests cover tiny separating walls, valid face contact, shallow old-anchor tolerance vs deep embedding, newly locked Door, OneWay/Trigger pass-through, tangent-only contact, obstacle beyond anchor, diagonal thin wall, and old-hash isolation.
- Real Chromium keyboard test presses U to attach to a visible wall, inserts a new thin blocker, confirms rope auto-release with no false launch, and saves screenshots/JSON.
- The existing CI builds `test-artifacts/DO-GAME-M1-offline-preview.html` and executes a **file:// Chromium test** without external network dependencies on both Ubuntu and Windows. The HTML is a standalone experimental bundle from this branch, not the public GitHub Pages version.
- Every new HEAD must be matched to its own four-job Ubuntu/Windows Node + Chromium success. CI evidence is **not** equivalent to Windows human control-feel approval.

### Release guardrails
- User must **download the actual Actions artifact**, extract the HTML and double-click locally; appending a hash to the public Pages URL does not load experiment code.
- Do not claim rope-wrap support, completed M1, new charged gun or full v1.1 combat system.
- Don't merge overlapping #15–#21 branches individually; choose one reviewed integration branch later.
- Keep a truthful audit note: an earlier accidental documentation-only main commit was reverted; main HEAD changed, but its restored Git tree matches the original stable main. There is no new main modification in this geometry follow-up.
