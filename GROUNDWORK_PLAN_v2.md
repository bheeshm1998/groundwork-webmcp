# Groundwork Implementation Plan (v2)

## Summary

Groundwork is a San Francisco–only, browser-side spatial workspace for finding
a home candidate area based on bike-commute time, grocery access, and park
access. It has two front ends onto the same state: a manual UI, and a set of
WebMCP tools a browser AI agent can call directly. Nothing runs on a server —
the app is a static bundle plus a versioned OSM dataset, all computation
happens in a Web Worker, and there is no LLM, database, or private API key.

This version keeps the v1 architecture (it was already good) but makes two
changes:

1. **Adds an explicit rationale for the WebMCP tool surface** — the granular,
   domain-named tools (`set_office`, `add_bike_condition`, ...) are a
   deliberate choice, not scope creep. See "Design Note" below.
2. **Splits every section into Core (needed for the demo) vs. Stretch (only
   if time remains)** — the bigger risk in v1 wasn't tool count, it was that
   production-hardening work (migrations, CSP headers, cross-browser CI,
   full a11y pass) was mixed in with demo-critical work at the same priority.

WebMCP status, checked against current sources: it's in a Chrome 149 origin
trial (through Chrome 156), still requires a token or local flag, and
agent-side adoption is early — no mainstream agent client calls
`modelContext` tools yet as of the last public audit. So the plan's
progressive-enhancement approach (full manual UI as the real fallback, WebMCP
as an enhancement) is still the correct call and doesn't need to change.

## Design Note: Why the WebMCP Tools Stay Domain-Specific

Two designs were on the table for the WebMCP surface:

**A — one generic tool over the command union**, mirroring the internal
`dispatchWorkspaceCommand` API exactly:

```js
groundwork_dispatch({
  type: "ADD_CONDITION",
  payload: { kind: "bike", maxMinutesEachWay: 15 }
})
```

**B — many narrow tools**, one per user-facing action:

```js
groundwork_add_bike_condition({ maxMinutesEachWay: 15 })
```

Design B is what this plan uses, for two reasons:

- **Call reliability.** An agent calling B only has to get one flat,
  well-named schema right. An agent calling A has to pick the correct
  discriminator *and* the correct nested shape for that variant, out of a
  ten-way union — more surface area for a malformed call, which is exactly
  the kind of failure you don't want mid-demo.
- **Availability as a signal, not an error.** The plan's capability rules
  (e.g. "bicycle creation requires an office") are implemented by simply not
  registering that tool yet. Under design B the agent literally can't see
  `add_bike_condition` until an office exists, so it never attempts it. Under
  design A, the single tool always exists, so the same rule can only be
  enforced by returning a validation error at call time — a worse failure
  mode for an agent to recover from, and a worse thing to have happen live.

This is standard MCP/tool-use practice generally, not something specific to
WebMCP: narrow, single-purpose tools with flat schemas outperform one
do-everything tool for agent reliability. Internally, everything still funnels
through the single `dispatchWorkspaceCommand` function — design B only
changes the *outward-facing* tool surface, not the state management.

Where this plan *did* already avoid over-specificity, and should stay that
way: `update_condition` and `delete_condition` are generic (operate by ID
across all condition types, since edit/delete doesn't need per-type
branching), and grocery + park share one `add_access_condition` tool rather
than getting one each. That's the right level of granularity — specific
enough to be unambiguous, generic enough to avoid needless duplication.

If a reviewer asks "why 18 tools," the answer is: each one is a real,
independently-meaningful user action that the manual UI also exposes: nothing
was invented solely to pad the WebMCP surface.

## Scope Tiers

**Core** — required to make the 90-second demo work convincingly, in Chrome,
with the WebMCP flag/token enabled. This is what gets built and polished
first.

**Stretch** — only if time remains after Core is solid end-to-end. Cutting
these does not weaken the demo.

| Area | Core | Stretch |
|---|---|---|
| Routing engine (Dijkstra over OSM graph) | Yes — needed for a visually credible isochrone shape | Turn penalties, elevation |
| Manual UI + WebMCP tools | Yes, both | — |
| Share links | Encode/decode + round trip | Schema migration across versions (just version-check + reject old versions cleanly for Core) |
| Undo | Single-level | Redo |
| Testing | Worker/algorithm unit tests + one Playwright run of the manual flow + one mocked WebMCP tool-execution test | Full cross-browser Playwright matrix, exhaustive edge-case suite, production Chrome smoke test with Model Context Tool Inspector |
| Accessibility | Legends/labels not color-only, basic keyboard nav on core flow | Full audit, screen-reader pass |
| Deployment hardening | Static Vercel deploy works | CSP, `Origin-Agent-Cluster`, `Permissions-Policy` headers, production origin-trial token config |
| Responsive layout | Usable on a laptop for the demo | Full small-screen polish |

Everything below is organized the same way, with `[Core]` / `[Stretch]` tags.

## Architecture and Key Changes

### Application shell and state `[Core]`

Primary dependencies (unchanged from v1):

- `maplibre-gl`, focused `@turf/*` packages, `h3-js`
- `@watergis/maplibre-gl-terradraw` for polygon creation/editing
- `zustand`, `zod`, `comlink`, `fflate`, `webmcp-types`
- Vitest, React Testing Library, and Playwright

```text
src/
  app/             Layout, panels, onboarding, error boundaries
  domain/          Workspace schemas, commands, capability rules
  store/           Zustand canonical and derived state
  map/             MapLibre sources, layers, markers, Terra Draw adapter
  geo-worker/      Routing, polygon analysis, ranking, worker RPC
  webmcp/          Feature detection, tool schemas, registration bridge
  sharing/         URL-fragment serialization and migrations
data/
  scripts/         Reproducible OSM extraction/preprocessing
public/data/sf/    Versioned graph, POIs, land boundary, metadata
tests/             Unit fixtures, integration tests, Playwright flows
```

UI, Core scope:

- Full-viewport map with visible data attribution.
- Onboarding card with a sample agent prompt and a one-click manual sample.
- Conditions panel: visibility, editing, deletion, stale-state indicators,
  recalculation.
- Feasible-area summary and three-candidate comparison table.
- Activity history, single-level undo, share control, "agent actions
  available" count.
- Legends/labels that don't rely on color alone.

Stretch: deep responsive polish beyond "usable on a laptop."

### Canonical command layer `[Core]`

Unchanged from v1 — this is the load-bearing part of the architecture and
should not be cut. Both manual controls and WebMCP tools call one
`dispatchWorkspaceCommand`; no component or tool handler mutates Zustand
directly.

Each successful meaningful command:

1. Validates input with Zod.
2. Captures the previous canonical workspace into the single undo slot.
3. Runs required worker calculations.
4. Atomically commits canonical and derived state.
5. Adds a deterministic activity entry with `actor: user | agent | system`.

Failed/cancelled commands commit nothing. Panning, zooming, candidate
selection, and link creation don't consume the undo slot. Undo restores the
prior snapshot, recalculates, clears the slot — no redo (redo is Stretch, and
only worth adding if judged demo time allows a "watch it undo and redo"
beat).

Hybrid recalculation, unchanged:

- Creating/editing the preference polygon immediately recomputes intersection
  and ranking.
- Hiding a layer is presentation-only; deleting it affects analysis.
- Moving the office or changing a network-dependent limit marks results
  stale.
- A visible Recalculate command (or WebMCP tool) refreshes stale results.
- After first combination, cheap polygon-only edits keep the feasible region
  current without a full recompute.

### Geographic data and worker engine `[Core]`

This is worth keeping at full fidelity even under time pressure — a
convincing, organically-shaped bike isochrone (vs. a circle) is most of the
demo's visual credibility, and it's the thing a browser agent narrates over.

Reproprocessing pipeline from a pinned California OSM PBF:

- Crop to the SF city boundary.
- Extract bicycle-accessible roads, directionality, bicycle access tags,
  supermarkets/groceries, park polygons.
- Default "proper grocery" to `shop=supermarket`; include `shop=grocery` only
  on request; exclude convenience stores by default.
- Immutable, versioned static assets with dataset date, schema version,
  bounding box, checksum, OSM attribution.
- Commit generated SF assets so Vercel never preprocesses at build/deploy
  time.

Road graph as compact typed-array binary assets:

- Node lon/lat arrays.
- Adjacency offsets, target-node indices, travel-time weights.
- Spatial grid index for snapping an office coordinate to the nearest usable
  node.
- Edge weights from length + a documented bicycle speed profile; respect
  access/bicycle/one-way tags; exclude motorways, forbidden/private roads,
  steps.
- No elevation or turn penalties `[Stretch, likely not worth it]` — real
  effort for a demo where nobody is checking your hill-climbing accuracy.

Worker operations via Comlink:

- Initialize/validate dataset.
- Snap coordinate to graph.
- Bounded Dijkstra for bicycle travel times.
- Reachable nodes + interpolated boundary points → H3 res-10 cells → GeoJSON.
- Buffer grocery points/park polygons at `minutes × 1.4 m/s`.
- Clean/clip/union/intersect via Turf.
- Rank candidates, calculate restriction explanations.
- Cancellation + structured progress/error responses.

Candidates: H3 res-10 cells whose centroids lie inside the fresh feasible
region. Ranking, unchanged and deterministic:

1. Normalized slack for bike, grocery, park limits.
2. Sort by highest minimum slack.
3. Tie-break by average slack, then stable H3 cell ID.
4. Prefer candidates ≥250 m apart; relax only if fewer than three qualify.
5. Slack ≥25% = comfortable, ≤10% = close to failing.

Restriction strength: area lost when each condition is added to the
intersection of all others. For a time-based winner, show the recomputed
feasible area after +5 minutes. If the preference polygon is strongest,
recommend editing it rather than inventing a numeric relaxation.

### Map, geocoding, and resilience `[Core]`

MapTiler via direct REST calls, public `VITE_MAPTILER_KEY` restricted to
approved deployment origins (not a secret).

Two-stage location selection:

- `search_locations(query)` → up to five SF-bounded candidates, no state
  change.
- `set_office(label, coordinates)` commits the selection.
- Ambiguous searches return choices for user or agent; out-of-bound results
  rejected.
- Bundled 1 Market Street preset + direct map placement as fallback if
  geocoding fails.

MapLibre's worker bundled via Vite's `?worker&url` pattern. Hosted-tile
failure → minimal blank fallback style, local analysis overlays retained.
Road-graph failure → bike tools disabled, proximity/drawing still usable.

### WebMCP interface `[Core]`

A pure capability selector drives both the UI action count and which WebMCP
tools are currently registered. Tools register through a small adapter with
individual abort controllers, and unregister only when their prerequisite
state disappears. See the Design Note above for why this stays granular
rather than collapsing into one dispatcher tool.

| Tool | Requires | Kind |
|---|---|---|
| `groundwork_get_workspace` | — | read |
| `groundwork_search_locations` | — | read |
| `groundwork_set_office` | valid search result or coordinate | write |
| `groundwork_add_bike_condition` | office set | write |
| `groundwork_add_access_condition` | office set | write |
| `groundwork_start_preference_draw` | — | write (mode trigger) |
| `groundwork_update_condition` | condition exists | write |
| `groundwork_delete_condition` | condition exists | write |
| `groundwork_set_layer_visibility` | layer exists | write (presentation only) |
| `groundwork_combine_conditions` | ≥2 included condition layers | write |
| `groundwork_recalculate` | stale dependent results | write |
| `groundwork_rank_candidates` | fresh feasible region | write |
| `groundwork_analyze_restriction` | fresh feasible region | read |
| `groundwork_select_candidate` | candidates exist | write |
| `groundwork_explain_candidate` | candidates exist | read |
| `groundwork_remove_candidate` | candidates exist | write |
| `groundwork_undo` | undo slot populated | write |
| `groundwork_create_share_link` | — | write |

Tool results: compact structured summaries, metrics, IDs, user-safe errors —
never full road graphs or large GeoJSON payloads. Geocoder-derived text
marked untrusted. Read-only tools get the appropriate WebMCP annotation.
Long-running calls propagate the WebMCP abort signal to the worker.

### Sharing and persistence

`[Core]` Versioned `WorkspaceShareV1` Zod schema: dataset/schema versions,
office, condition definitions, preference geometry, removed candidates,
selected candidate, map view, activity entries, optional undo snapshot,
combination/ranking-activated flag. Derived isochrones/feasible polygons are
never serialized — rebuilt deterministically from the versioned definitions.
JSON → deflate → base64url via `fflate`, stored in `#w=...` so workspace
contents never hit Vercel.

Preference polygons simplified, capped at 200 vertices. Keep fragments under
8 KB. On import: validate before mutation; for Core, if the schema version
doesn't match, reject cleanly with a clear message rather than attempting a
migration.

`[Stretch]` Migrate known older schema versions instead of rejecting them;
warn on dataset-version mismatch instead of hard-reject.

`[Core]` Validated canonical state autosaves to local storage. A share
fragment takes precedence over local state; Reset Workspace clears the
autosave.

## Public Types and Data Flow

Unchanged — these contracts are good and concrete enough to build against
directly.

```ts
type Condition =
  | BikeCondition
  | GroceryAccessCondition
  | ParkAccessCondition
  | PreferenceAreaCondition;

type WorkspaceCommand =
  | SetOfficeCommand
  | AddConditionCommand
  | UpdateConditionCommand
  | DeleteConditionCommand
  | CommitPreferenceAreaCommand
  | CombineCommand
  | RecalculateCommand
  | RankCandidatesCommand
  | RemoveCandidateCommand
  | UndoCommand;

interface WorkspaceState {
  schemaVersion: 1;
  datasetVersion: string;
  canonical: CanonicalWorkspace;
  derived: DerivedAnalysis;
  activity: ActivityEntry[];
  undo: CanonicalWorkspace | null;
  status: "idle" | "calculating" | "stale" | "error";
}

interface GeoWorkerApi {
  initialize(): Promise<DatasetMetadata>;
  computeBikeReach(input: BikeReachInput): Promise<BikeReachResult>;
  computeProximity(input: ProximityInput): Promise<ProximityResult>;
  combine(input: CombineInput): Promise<FeasibleRegionResult>;
  rank(input: RankInput): Promise<CandidateResult[]>;
  analyzeRestriction(input: RestrictionInput): Promise<RestrictionResult>;
}
```

Note this is exactly the union that a design-A generic dispatcher would have
exposed directly to the agent (see Design Note). Keeping it as an *internal*
contract while exposing granular tools externally gets the benefits of both:
one place internally that fully describes "everything the app can do," and a
reliable, self-documenting surface for the agent.

Lifecycle, unchanged:

```text
Browser agent or manual UI
  → Zod-validated workspace command
  → canonical Zustand state
  → cancellable worker computation
  → atomic derived-state commit
  → MapLibre layers, panels, and activity history
  → optional compressed URL-fragment share
```

Candidate explanations are deterministic summaries of calculated values. The
external agent may phrase them conversationally, but the page distinguishes
measured values from agent-authored prose.

## Build Sequence

### Core path (build and demo this first, end to end)

1. Scaffold strict TS/Vite project, schemas, command dispatcher, Zustand
   slices, layout, error boundaries.
2. SF preprocessing pipeline, dataset metadata, licensing, worker loading.
3. Routing, proximity polygons, intersection, candidate ranking, restriction
   analysis against small deterministic fixtures.
4. MapLibre + MapTiler search, office dragging, Terra Draw, manual controls,
   stale-state behavior, activity/undo.
5. WebMCP bridge, dynamic capability rules, share encoding, local
   persistence, unsupported-browser guidance.
6. Run the scripted 90-second demo end to end, in both manual mode and via
   an agent calling WebMCP tools, and fix whatever breaks.

### Stretch (only after step 6 above is solid)

7. Accessibility hardening beyond the Core baseline, full responsive polish.
8. Vercel security headers (CSP, `Origin-Agent-Cluster`,
   `Permissions-Policy`), production origin-trial token config.
9. Schema migration across share-link versions.
10. Full cross-browser Playwright matrix and exhaustive edge-case coverage.

## Testing Strategy

`[Core]`

- Vitest: directed/forbidden bike edges, snapping, Dijkstra cutoffs,
  monotonic expansion with larger limits; grocery/park buffers, polygon
  cleanup, intersections, empty results, leave-one-out restriction
  calculations; balanced-slack ranking, spacing, stable ties, candidate
  removal; Zod boundaries and command atomicity for the commands actually
  used in the demo script; single-level undo; capability
  selection/registration for the tools the demo exercises.
- Playwright: one full run of the manual demo flow in Chromium; one run
  mocking `document.modelContext` and driving the same flow through WebMCP
  tools.

`[Stretch]`

- Ambiguous/out-of-bounds geocoding, provider-failure fallback, empty
  feasible region, drag→stale→recalculate, full candidate-comparison and
  shared-link-reload coverage, share migration/corrupted-fragment handling.
- A separate production Chrome smoke test using the real origin trial token
  and the Model Context Tool Inspector.

## Acceptance Targets

`[Core, demo-critical]`

- Worker initialization under 2 s; first 30-minute bicycle analysis under
  2 s on a typical modern laptop.
- Cheap intersection/ranking updates under 500 ms.
- The complete scripted demo flow fits in 90 seconds.
- No main-thread long task above 100 ms during analysis (a stutter during a
  live demo is the failure mode most worth guarding against).

`[Stretch]`

- Graph asset ≤8 MB compressed.
- Share fragment <8 KB for the supported workspace limits.

## Assumptions and Boundaries

- v1 supports San Francisco only and rejects analysis origins outside its
  dataset boundary — this is fine as-is; regional scope is a reasonable
  hackathon constraint and orthogonal to the tool-design question.
- WebMCP/browser-agent conversation is external to Groundwork; the page does
  not present a misleading in-app chat box.
- Full manual controls provide the same functionality in unsupported
  browsers.
- All conditions are hard inclusion constraints; outside the preference
  polygon is excluded. Arbitrary negative exclusion layers are deferred.
- Walking access is straight-line distance at 1.4 m/s, visibly labeled as an
  estimate.
- Bicycle results use deterministic OSM network travel-time estimates — no
  live traffic, hills, or real-estate data.
- MapTiler is the only runtime network dependency beyond the static Vercel
  deployment.
- OSM and provider attribution stay visible; dataset generation records
  source/licence metadata.
