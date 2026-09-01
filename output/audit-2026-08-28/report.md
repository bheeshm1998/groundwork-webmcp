# Groundwork pre-ship audit

Date: 2026-08-28  
Verdict: **Do not ship this build yet.** The happy path runs, but several defects can produce spatially incorrect recommendations while presenting them as calculated facts. The WebMCP surface also has demo-breaking contract and lifecycle problems.

## Scope and checks

- Read all application source, worker code, data tooling, tests, configuration, product scope, and implementation plan.
- Exercised initial load, sample analysis, WebMCP calls, drawing entry, desktop/mobile layouts, editing, recalculation, undo, reset, and error states in the in-app browser.
- Ran `npm test` (17/17 passed), `npm run lint` (passed), `npm run build` (passed with a large-chunk warning), `npm audit --omit=dev` (0 vulnerabilities), and `npm run format:check` (failed on `AGENTS.md`).
- Preserved all pre-existing uncommitted changes.

## Release blockers

### 1. The shipped geography is synthetic demo data, not the OSM-backed analysis the product claims

**Reproduce:** Inspect `public/data/sf/graph.json`, `places.json`, `boundary.geojson`, and `metadata.json`. The graph is a 26×20 compact grid (374 bytes), the boundary is a 13-point approximation, place names are hand-authored demo records, metadata calls it an “OpenStreetMap-compatible demo extract,” and the source checksum is empty. The UI nevertheless presents “Analysis © OpenStreetMap contributors” and the product copy describes road-network calculations.

**Impact:** Judges may reasonably treat the core spatial result as fabricated or misleading. The grid also produces non-road-like bike reachability.

**Fix:** Run `data:build` against a pinned real PBF, populate and verify the SHA-256, ship a real SF boundary and OSM POIs, and display the dataset date/source in the UI. If time prevents that, explicitly label the result as synthetic demo data everywhere the calculated facts are shown.

### 2. A condition whose layer cannot be computed is silently ignored

**Reproduce:** Combine an 8-minute park condition with a preference polygon entirely outside SF. The preference layer is `null`, but `GeoEngine.analyze` filters missing layers before intersection. The audited engine returned **8.50 km²** instead of an empty result.

**Impact:** A hard user constraint can disappear while the app claims the remaining area satisfies every condition.

**Fix:** Require one valid layer per included condition. If any hard constraint produces no layer, return an empty feasible region (or a structured calculation error). Never `filter(Boolean)` hard constraints before intersection.

### 3. “Supermarket” candidate times and ranking use all groceries

**Reproduce:** Create a 15-minute grocery condition with `groceryType: "supermarket"`. The top audited candidate reported **1.67 minutes**, but its nearest supermarket was **14.79 minutes**; the shorter distance was to a non-supermarket grocery.

**Impact:** The displayed fact, slack score, ordering, and trade-off explanation can all be wrong.

**Fix:** Use the same filtered place set for candidate metrics/ranking that is used to construct the condition layer. Add a regression case where a grocery is much closer than the nearest supermarket.

### 4. Candidate coordinates can be outside the feasible region

**Reproduce:** Analyze a tiny 0.0098 km² preference polygon around a ranking scan point. The scan point is inside, but the emitted H3 cell center is outside; the engine returned that outside center as a candidate.

**Impact:** A pin can visibly fail the very conditions it is said to satisfy.

**Fix:** Generate candidate H3 cells from the feasible polygon and accept only cell centroids that pass a final `booleanPointInPolygon` check. Test narrow and boundary-touching polygons.

### 5. Editing a time limit commits twice and Undo does not undo the edit

**Reproduce:** In the sample, change bicycle time from 25 to 30 and press Enter. Two identical “Changed a condition to 30 minutes” entries appear because Enter commits and then blur commits again. Click Recalculate, then Undo. The field remains **30**, even though the activity says it was undone.

**Impact:** The visible safety mechanism is false reassurance.

**Fix:** Make Enter trigger only blur, or suppress the next blur commit. Define which commands consume the one-level undo slot: recalculation, ranking, selection, map view, and presentation-only visibility should not overwrite the last meaningful canonical edit. Assert the restored value/state, not merely the undo activity message.

### 6. Offices outside San Francisco are accepted and snapped into the SF graph

**Reproduce:** Call `groundwork_set_office` with label “Outside San Francisco” and coordinates `[0, 0]`. It returns `ok: true`. With two bike conditions, the engine still produced a **0.296 km²** feasible area and SF candidates because the point is snapped to the nearest graph node.

**Impact:** The app can calculate plausible-looking SF results for an office on another continent.

**Fix:** Refine office coordinates against the SF boundary/bounds at every entry point, and reject graph snapping beyond a small maximum distance. Validate geocoder results and restored/shared workspaces too.

### 7. Drawing has no cancel path and can leave the workspace stuck

**Reproduce:** Click “Draw preference,” then decide not to finish. The button becomes disabled, the instruction pill remains, and there is no Cancel action. Escape/reset/unmount are not wired to `cancelPreferenceDraw`; a pending request can survive and block the next drawing request.

**Impact:** A central hackathon interaction can dead-end live.

**Fix:** Add explicit Cancel and Escape handling, cancel on reset/unmount/mode exit, and make drawing a complete state machine with start/finish/cancel/error transitions. Add an end-to-end cancellation test.

### 8. Drawn areas are not actually editable after creation or restoration

**Reproduce:** The map listens only to TerraDraw `finish`. It does not synchronize edit/change/delete events. Restored preference geometry is rendered as a Groundwork GeoJSON layer but is never loaded into TerraDraw, so it cannot be edited as promised.

**Impact:** The core “human corrects the agent on the same map” story breaks after the initial draw and on shared links.

**Fix:** Hydrate the canonical preference feature into TerraDraw, listen for edit/change/delete events, commit updated geometry, and reconcile control state with canonical state.

### 9. WebMCP advertises inputs that the domain rejects

**Reproduce:** `groundwork_add_access_condition` advertises `maxMinutes <= 90`, but access conditions allow only 45. Calling it with park/90 passes the tool schema and returns a raw Zod JSON error. Bike advertises a minimum of 1 while the domain minimum is 5; generic update has the same condition-specific mismatch.

**Impact:** A conforming agent call fails mid-demo and produces unreadable user-facing errors.

**Fix:** Use separate bike/access minute schemas and condition-aware validation for updates. Map validation issues to short domain messages; never show serialized Zod internals.

### 10. WebMCP write tools return the entire derived GeoJSON analysis

**Reproduce:** Call `groundwork_set_office` or another write tool. `WorkspaceService.execute` returns `data: derived`, so the WebMCP result includes layers, feasible polygons, and candidates. The test helper strips this data before assertions, hiding the real contract.

**Impact:** Real OSM polygons can create enormous tool results, waste context, slow the agent, or exceed tool limits. This contradicts the plan’s compact-result requirement.

**Fix:** Return compact write results only: `ok`, a message, freshness, area, candidate IDs/count, and changed entity IDs. Keep full GeoJSON inside the page.

### 11. WebMCP tools are torn down and re-registered on almost every state change

**Reproduce:** Run the ordinary sample/edit flow in a WebMCP browser. The audit recorded **36 console errors, all AbortErrors**, from aborting registrations. Map view changes also replace the entire canonical object and retrigger the effect.

**Impact:** Tool calls can race disappearing registrations, and a judge opening DevTools sees a broken console.

**Fix:** Maintain a stable registry and diff only capability-name changes. Handlers already read current state through the service, so they need not be recreated for every canonical/derived update. Catch and suppress expected abort rejections.

### 12. The audited production build contains no WebMCP origin-trial token

**Reproduce:** Run `npm run build` without an environment override and inspect `dist/index.html`; it contains `<meta http-equiv="origin-trial" content="" />`.

**Impact:** The central hackathon feature is unavailable on the deployed origin unless the Vercel environment is configured perfectly.

**Fix:** Make production builds fail when the token is missing, validate that the token is registered for the exact final origin, and run a deployed-origin smoke test that confirms `document.modelContext` and actual tool registration.

## High-impact correctness and resilience issues

### 13. Duplicate conditions produce incorrect candidate scores

**Reproduce:** Add 10-minute and 2-minute supermarket conditions. The engine intersects both, but ranking uses only the first matching condition. The audited candidate reported minimum slack **0.803** while its actual slack against the 2-minute constraint was **0.017**.

**Fix:** Either prevent duplicate bike/category constraints or score every active condition independently. Do not combine `.find(...)` with a bike context captured from a different condition.

### 14. A non-empty feasible region can produce zero recommendations

**Reproduce:** Combine narrow 1-minute supermarket conditions. The engine returned **0.11 km²** of feasible area but no candidates because the fixed 0.004-degree scan skipped every small region.

**Fix:** Polyfill the feasible polygon with H3 cells (or derive interior/centroid fallbacks) rather than sampling a coarse latitude/longitude lattice. Explain genuinely empty candidate sets in the UI.

### 15. Map/style failure becomes a silent blank canvas

**Reproduce:** In the audited in-app WebMCP browser, both initial and completed sample states showed a blank base map while controls, results, and “connected” status appeared normal. There is no map `error` handling or fallback style.

**Fix:** Listen for MapLibre style/source/tile errors, fall back to a minimal local style while retaining analysis overlays, and show retry/status copy. Add a test that blocks the style URL.

### 16. Reset and “Run sample” irreversibly destroy existing work without warning

**Reproduce:** Populate a workspace, then click Reset or Run sample. Reset clears local storage, hash, activity, and undo in one click; Run sample begins by calling Reset.

**Fix:** Confirm destructive replacement when the workspace is non-empty, or preserve the prior canonical state as a recoverable undo snapshot. Rename the sample action to make replacement explicit once work exists.

### 17. Controls remain active during calculations and failed clicks are silent

**Reproduce:** While sample/recalculation is running, click another add/delete/reset action. The service returns “Another calculation is still running,” but most callers discard the result and the UI shows no feedback.

**Fix:** Disable all mutating controls while calculating/drawing as appropriate, surface command failures consistently, and decide whether agent commands should queue or receive a structured retryable error.

### 18. Persistence failure breaks atomic command semantics

**Reproduce:** Exhaust or deny localStorage. Most commands commit state before `persist()`; if storage throws, the service returns failure after the visible state has already changed. `set-view` persistence is outside a try/catch and can become an unhandled rejection.

**Fix:** Serialize/validate before commit, treat persistence as a separately reported non-fatal status, and wrap every storage access. Do not claim a failed command left state untouched if it did not.

### 19. Share links ignore dataset-version mismatches

**Reproduce:** Alter a valid share payload’s `datasetVersion` and open it. The app accepts and recalculates it against the current dataset without warning.

**Fix:** Compare restored and loaded dataset versions before analysis; reject or clearly warn, with an explicit migration policy.

### 20. Immutable caching is applied to unversioned data URLs

**Reproduce:** `vercel.json` serves `/data/sf/*` with one-year `immutable`, but data files always use stable names such as `graph.json` and `places.json`.

**Fix:** Put the dataset version/hash in filenames or directories and reference those URLs from metadata, or remove immutable caching and require revalidation.

### 21. Geometry union failures silently collapse to the first POI

**Reproduce:** `unionAreas` catches every Turf error and returns `features[0]`. Any topology/library failure therefore turns citywide grocery/park coverage into coverage around one arbitrary place with no error.

**Fix:** Surface a structured calculation failure or repair/retry geometry. Never substitute the first feature for the union.

### 22. Candidate and condition commands accept stale/nonexistent IDs as successful changes

**Reproduce:** Execute delete-condition with a missing ID, select-candidate with an arbitrary ID, or remove-candidate with a nonexistent ID. Several paths report success, add activity, and overwrite undo despite no valid target.

**Fix:** Validate target existence and current eligibility inside `WorkspaceService`, not only through capability visibility. Return clear not-found/conflict errors and do not consume undo.

### 23. Candidate selection can become stale after recalculation

**Reproduce:** Select a candidate, then change conditions so ranking returns different IDs. `selectedCandidateId` remains in canonical state even though no result or map pin is selected.

**Fix:** After analysis, retain selection only if the ID still exists; otherwise clear it and record/explain the state change.

### 24. Restriction advice can recommend impossible values

**Reproduce:** Use a condition at its maximum (45 access or 90 bike). Restriction analysis blindly adds five minutes and reports the result even though the UI/domain cannot accept that value.

**Fix:** Clamp or suppress the numeric relaxation at schema limits and propose a different actionable relaxation.

### 25. Shared fragments can expand without a decompressed-size cap

**Reproduce:** `decodeWorkspace` limits the compressed fragment to 8 KB, then calls `inflateSync` before checking decompressed size. A highly compressible hostile fragment can allocate far more memory than the input length suggests.

**Fix:** Enforce a small decompressed byte limit with streaming/bounded inflate, then parse. Also cap coordinate depth and preference vertices.

### 26. Preference polygons are not capped for local persistence

**Reproduce:** Draw a very detailed polygon. Share encoding simplifies it, but autosave stores the full unsimplified geometry and the schema has no 200-vertex cap promised by the plan.

**Fix:** Validate, clean, simplify, and cap geometry when it enters canonical state—not only when sharing.

### 27. The OSM builder mishandles important real-world data cases

**Reproduce:** Read `build-osm-assets.ts`: `oneway=-1` is treated as bidirectional; bicycle forward/backward overrides are not handled; groceries are collected only from nodes; park polygon “centers” are vertex averages that can fall outside concave parks.

**Fix:** Implement OSM one-way direction semantics, bicycle overrides, way/relation POIs, and use a point-on-surface/representative-point algorithm. Add small fixture tests for each tag pattern.

### 28. The calculation pipeline repeats expensive work and has no cancellation

**Reproduce:** Run sample. Every added condition recomputes all existing layers; Combine already ranks candidates; the subsequent Rank command recomputes and ranks everything again. Worker calls do not receive abort signals despite the plan.

**Fix:** Cache layers by condition/input hash, separate combine from rank if the product needs two steps, remove the redundant sample rank, and thread AbortSignals/progress through Comlink.

## UI, UX, and accessibility issues

### 29. Candidate cards do not identify actual places or expose promised explanations

**Reproduce:** Run sample. Results are only “Candidate 1/2/3”; no neighbourhood/address/coordinates are shown. `comfortable` and `closeToFailing` are calculated but never rendered. Clicking a card only changes a border.

**Fix:** Show a recognizable location label (neighbourhood/nearest intersection or coordinates), the comfortably-met and near-limit conditions, and a visible selected/detail state.

### 30. Selected candidate state is not announced to assistive technology

**Reproduce:** Select a candidate. The only state change is CSS on the article; the button has no `aria-pressed`/`aria-current` and no status announcement.

**Fix:** Use a selectable-control pattern with `aria-pressed` or radio semantics, and announce the selected candidate/details.

### 31. Several controls and labels are too small

**Reproduce:** Visibility buttons are explicitly 11×11 px. Actor labels are 8 px, action counts 9 px, and assumption/candidate-remove text 10 px. Add buttons all have the accessible name “Add”; candidate removal buttons all say “Remove.”

**Fix:** Give interactive targets at least 24×24 CSS px (prefer 44×44 on touch), raise essential text size, and use unique names such as “Add park condition” and “Remove Candidate 2.”

### 32. Manual-mode capability copy is misleading

**Reproduce:** In an unsupported browser the header says “Manual mode,” but Activity still says “N agent actions available.” The count reflects theoretical capabilities, not registered agent tools.

**Fix:** Show agent-action count only when tool registration succeeds; otherwise label it “workspace actions” or explain manual mode.

### 33. Search has no meaningful validation, progress, or empty state

**Reproduce:** Submit an empty search: every local preset matches because every string contains `""`. Submit a one-character/no-result query: the UI silently shows nothing. There is no loading state and the manual input does not mirror the tool’s minimum length.

**Fix:** Trim and validate before filtering, require at least two characters, show searching/no-results/provider-fallback states, and disable repeat submission while pending.

### 34. Small nonzero results can be shown as `0.00 km²`

**Reproduce:** Create a feasible area below 0.005 km². `toFixed(2)` displays `0.00 km²`, implying there is no area even if candidates exist.

**Fix:** Switch units/precision for small values, e.g. `<0.01 km²` or square metres.

### 35. Activity history is not sufficiently auditable

**Reproduce:** Edit/delete/hide/remove actions. Messages say “a condition” or “a candidate” without identifying which. The Enter bug can also create duplicate entries. Timestamps are stored but never shown.

**Fix:** Include the target label/ID and old→new value, deduplicate commits, and optionally show relative timestamps.

### 36. The mobile journey separates setup, map, and results by excessive scrolling

**Reproduce:** At 390×844, the setup/conditions block is about 917 px tall, followed by a 58vh map and then results. Users cannot see the condition they changed and its result together; the blank-map failure consumes most of a screen.

**Fix:** Collapse onboarding after the first action, add a compact sticky summary/result jump, and reduce map height when no tiles/result are available. Preserve easy access to conditions and candidates.

### 37. Production CSP blocks the selected Google fonts

**Reproduce:** `styles.css` imports `fonts.googleapis.com`, but the CSP allows styles only from self and fonts from self/data/MapTiler. Production falls back silently to system fonts.

**Fix:** Self-host the fonts (preferred) or explicitly allow the required Google style/font origins.

### 38. There is no application/map error boundary or recovery action

**Reproduce:** Fail the lazy map chunk, worker import, or a render-time exception. `App` has no error boundary despite the implementation plan listing one; initialization failures leave a full-screen error state without retry.

**Fix:** Add boundaries around the app/map and explicit Retry/continue-without-bike paths.

## Tooling and test gaps

### 39. The production bundle has a large map chunk

**Reproduce:** `npm run build` warns that `MapView` is 1.25 MB minified (312 KB gzip), plus separate 476 KB and 570 KB workers.

**Fix:** Measure first-load timing on the target demo hardware/network, split optional drawing code, and prefetch the map chunk after shell readiness if it improves the live demo.

### 40. Existing tests pass while core behavior is broken

**Reproduce:** All 17 unit tests pass. The undo end-to-end assertion checks only the activity message, not that 30 returns to 25. Engine tests allow zero candidates and do not assert containment, supermarket filtering, empty hard constraints, duplicates, or real dataset integrity. WebMCP tests mock registration in a way that cannot expose real AbortErrors and intentionally strip large write results.

**Fix:** Add regression tests for every blocker above and make the manual test assert restored canonical/UI values, not narrative copy alone.

### 41. The repository’s format gate fails

**Reproduce:** `npm run format:check` fails on `AGENTS.md`.

**Fix:** Format the file or intentionally exclude it from Prettier if repository instructions should remain plain text.

## Evidence screenshots

1. Initial desktop — unhealthy: shell loads, map remains blank. `01-initial-desktop.png`
2. Sample desktop — mixed: calculated cards appear, map remains blank and panels require independent scrolling. `02-sample-desktop.png`
3. Agent validation — broken: advertised input yields raw Zod JSON in the UI. `03-agent-schema-error.png`
4. Drawing — broken: drawing mode has no cancel and remains stuck. `04-drawing-stuck.png`
5. Mobile flow — poor: setup, blank map, and results are separated by a long internal scroll. `05-mobile-fullpage.png`, `06-mobile-map-results.png`
6. Undo — broken: activity says undo succeeded while bicycle time remains 30. `07-undo-noop.png`

## Recommended hackathon fix order

1. Replace/disclose the synthetic dataset; fix hard-constraint intersection, supermarket scoring, candidate containment, out-of-bounds offices, and duplicate-condition ranking.
2. Fix time-edit double commits and undo semantics.
3. Stabilize WebMCP registration, schemas, compact results, and deployed token verification.
4. Make draw/cancel/edit/restore reliable; add map failure fallback.
5. Protect destructive actions and add regression tests for the actual state changes.
6. Tighten candidate identity/details, accessibility targets, and mobile flow.
