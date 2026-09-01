# Groundwork assumptions and constraints

Last reviewed: 2026-08-28

## Product scope

- Groundwork is a hackathon demonstration of a human-and-agent spatial decision workflow, not a production routing, real-estate, safety, or accessibility service.
- The supported analysis area is the San Francisco bounding box `[-122.53, 37.69]` to `[-122.34, 37.83]`. Office coordinates outside it are rejected.
- A workspace may contain one bicycle condition, one grocery condition, one park condition, and one preference drawing. Setting the same type again replaces the prior condition so scoring and explanations remain unambiguous.
- At least two conditions are required to create a combined feasible region.

## Shipped data

- The committed `public/data/sf` files are a small deterministic synthetic hackathon dataset. They are not a real OpenStreetMap street graph or a complete POI inventory.
- UI results and map attribution explicitly say “Demo data” or “Synthetic demo analysis.” Results must not be presented as real-world travel guarantees.
- A production-quality dataset requires a pinned California OSM PBF, a recorded SHA-256, `osmium-tool`, and `npm run data:build`. The builder supports directional bicycle edges and polygon grocery/park representative points, but generated output still requires a data-quality review before use.
- Share links are rejected when their dataset version differs from the loaded dataset; there is no cross-version migration.

## Calculation assumptions

- Walking access is straight-line distance at 1.4 m/s. It does not account for street connectivity, crossings, elevation, barriers, entrances, accessibility, or opening hours.
- Bicycle minutes use the bundled graph’s modeled edge times and nearest graph node. They do not model traffic, elevation, rider ability, surface quality, construction, or live closures.
- Grocery type is enforced consistently in both feasible-area construction and candidate scoring. “Supermarket” excludes records typed only as grocery.
- Every hard condition must produce a valid layer. If any layer is missing or cannot intersect the supported boundary, the combined feasible region is empty rather than silently dropping that condition.
- Candidate points are generated from H3 cells whose centers are inside the feasible polygon. Regions smaller than a cell use a Turf point-on-feature fallback; the final coordinate is checked against the feasible geometry.
- Candidate ranking maximizes the weakest normalized margin first and average margin second. It is deterministic but is not a statistical recommendation or market ranking.
- Condition layers are cached in the worker for the 50 most recent exact inputs. Calculations are synchronous inside the worker and cannot currently be cancelled mid-operation; the UI prevents conflicting mutations while one runs.

## Workspace and input limits

- Bicycle limits are 5–90 minutes. Grocery and park limits are 1–45 minutes.
- Preference geometry is limited to valid closed Polygon/MultiPolygon rings and 500 vertices total. Share fragments are limited to 8,192 compressed URL characters and 256,000 decompressed bytes.
- Activity keeps the most recent 40 entries. Undo stores one meaningful canonical change. Recalculation, ranking, candidate selection, map movement, and layer visibility do not consume that undo slot.
- Reset requires confirmation, keeps a one-session undo snapshot, clears the share hash, and clears persisted state. Running the sample over existing work also requires explicit replacement confirmation.
- If browser persistence fails, the in-memory change remains active and Groundwork reports that it could not autosave. A reload can then lose that session-only change.

## Browser, map, and WebMCP constraints

- Base-map tiles and optional geocoding require network access. Analysis data and calculations remain local. A failed map/style load shows a retryable fallback while panel results remain usable.
- Without `VITE_MAPTILER_KEY`, Groundwork uses OpenFreeMap and only the bundled location presets are guaranteed for search. Public MapTiler keys must be origin-restricted.
- Browsers without `document.modelContext` run in manual mode. The page does not claim agent tools are registered in that mode.
- A deployed WebMCP release requires `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` for the exact final origin. `npm run build:release` and the Vercel build fail if it is absent. Ordinary `npm run build` intentionally remains available for local/manual verification and omits an empty origin-trial tag.
- WebMCP write results are compact summaries; full GeoJSON stays inside the page. Capability changes are diffed so unrelated state updates do not abort and re-register stable tools.

## Release constraints

- The current project is suitable only for a clearly labeled hackathon demo while the synthetic dataset remains committed.
- Before representing Groundwork as real-world analysis: replace the dataset, pin and record its source checksum, review POI coverage and network directionality, run a deployed-origin WebMCP smoke test, and validate results against an independent routing source.
