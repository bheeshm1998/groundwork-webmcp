# Groundwork assumptions and constraints

Last reviewed: 2026-09-01

## Product scope

- Groundwork is a client-side spatial decision aid, not a live routing, real-estate listing, safety, or accessibility service.
- The supported analysis area is the San Francisco bounding box `[-122.53, 37.69]` to `[-122.34, 37.83]`. Office coordinates outside it are rejected.
- A workspace may contain one bicycle condition, one grocery condition, one park condition, and one preference drawing. Setting the same type again replaces the prior condition so scoring and explanations remain unambiguous.
- At least two conditions are required to create a combined feasible region.

## Shipped data

- The committed `public/data/sf` assets contain a checksum-pinned OpenStreetMap extract plus official DataSF city/county and Analysis Neighborhood polygons. There is no synthetic fallback.
- Every asset filename is versioned. `metadata.json` records source URLs, extract dates, SHA-256 checksums, counts, graph format, and the dataset version.
- The street network contracts degree-2 vertices and is shipped as a custom gzip-compressed binary. The build fails at 2 MB or larger.
- Groceries include named OSM `shop=supermarket`, `shop=grocery`, and `shop=convenience` records. Parks use named `leisure=park` records. Nodes, ways, and relations are included; polygon records use a point on their surface.
- If `osmium-tool` is unavailable, the build uses a saved and checksummed Overpass response. Fetch, validation, unexpectedly small extract, and graph-budget failures stop the build; generated coordinates or place records are never substituted.
- Share links are rejected when their dataset version differs from the loaded dataset; there is no cross-version migration.

## Calculation assumptions

- Walking access uses multi-source Dijkstra from every applicable POI over pedestrian-eligible OSM edges at a modeled 4.8 km/h. It accounts for the extracted street connectivity, but not elevation, untagged barriers, entrance choice, accessibility, opening hours, or temporary closures.
- Bicycle minutes use directional OSM-eligible edges and modeled road-class speeds. Reachable polygons sample full and partially reachable edges, interpolating the exact time cutoff before polygonization. They do not model traffic, elevation, rider ability, surface quality, construction, or live closures.
- Grocery type is enforced consistently in both feasible-area construction and candidate scoring. “Supermarket” excludes records typed only as grocery.
- Every hard condition must produce a valid layer. If any layer is missing or cannot intersect the supported boundary, the combined feasible region is empty rather than silently dropping that condition.
- Candidate points are generated from H3 cells whose centers are inside the feasible polygon, kept at least 300 m apart, and named with the containing DataSF Analysis Neighborhood plus nearest named OSM cross-street. Regions smaller than a cell use a Turf point-on-feature fallback; the final coordinate is checked against the feasible geometry.
- Candidate ranking maximizes the weakest normalized margin first and average margin second. It is deterministic but is not a statistical recommendation or market ranking.
- Condition layers are cached in the worker for the 50 most recent exact inputs. Calculations are synchronous inside the worker and cannot currently be cancelled mid-operation; the UI prevents conflicting mutations while one runs.

## Workspace and input limits

- Bicycle limits are 5–90 minutes. Grocery and park limits are 1–45 minutes.
- Preference geometry is limited to valid closed Polygon/MultiPolygon rings and 500 vertices total. Share fragments are limited to 8,192 compressed URL characters and 256,000 decompressed bytes.
- Activity keeps the most recent 40 entries. Undo stores one meaningful canonical change. Recalculation, ranking, candidate selection, map movement, and layer visibility do not consume that undo slot.
- Reset requires confirmation, keeps a one-session undo snapshot, clears the share hash, and clears persisted state. Running the sample over existing work also requires explicit replacement confirmation.
- If browser persistence fails, the in-memory change remains active and Groundwork reports that it could not autosave. A reload can then lose that session-only change.

## Browser, map, and WebMCP constraints

- Base-map tiles require network access. Analysis, pedestrian/bicycle routing, candidate naming, and search remain local. A failed map/style load shows a retryable fallback while panel results remain usable.
- Search uses the bundled OSM index of named POIs and street names. `VITE_MAPTILER_KEY` changes only the base-map provider; public keys must be origin-restricted.
- Browsers without `document.modelContext` run in manual mode. The page does not claim agent tools are registered in that mode.
- A deployed WebMCP release requires `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` for the exact final origin. `npm run build:release` and the Vercel build fail if it is absent. Ordinary `npm run build` intentionally remains available for local/manual verification and omits an empty origin-trial tag.
- WebMCP write results are compact summaries; full GeoJSON stays inside the page. Capability changes are diffed so unrelated state updates do not abort and re-register stable tools.

## Release constraints

- Before describing a release as current, rebuild and review the source checksums, POI coverage, graph directionality, and DataSF boundary versions.
- A release still requires a deployed-origin WebMCP smoke test and comparison against an independent routing source. Real source data removes fabrication; it does not turn modeled travel time into a guarantee.
