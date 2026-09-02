# SweetSpot assumptions and constraints

Last reviewed: 2026-09-02

## Product scope

- SweetSpot is a client-side spatial decision aid, not a live routing, real-estate listing, safety, or accessibility service.
- Users choose either San Francisco or Hyderabad before opening the planner. Each workspace belongs to one city and cannot combine conditions across cities.
- The dataset fetch bounds are `[-122.53, 37.69]` to `[-122.34, 37.83]` for San Francisco and `[78.29, 17.20]` to `[78.67, 17.56]` for Hyderabad. Search entries and office coordinates are additionally checked against the selected city's actual boundary polygon; calculated regions are clipped to that same polygon.
- A workspace may contain one bicycle condition, one grocery condition, one park condition, and one preference drawing. Setting the same type again replaces the prior condition so scoring and explanations remain unambiguous.
- At least two conditions are required to create a combined feasible region.

## Shipped data

- The committed `public/data/sf` assets contain a checksum-pinned OpenStreetMap extract plus official DataSF city/county and Analysis Neighborhood polygons. `public/data/hyderabad` contains a separate checksum-pinned OSM extract, the Hyderabad administrative boundary, and GHMC ward polygons. There is no synthetic fallback.
- Every asset filename is versioned. `metadata.json` records source URLs, extract dates, SHA-256 checksums, counts, graph format, and the dataset version.
- The street network contracts degree-2 vertices and is shipped as a custom gzip-compressed binary. The build budget is 2 MB for San Francisco and 8 MB for the larger Hyderabad graph.
- Groceries include named OSM `shop=supermarket`, `shop=grocery`, and `shop=convenience` records. Parks use named `leisure=park` records. Nodes, ways, and relations are included. Search labels use a point on each polygon's surface; park routing samples up to 12 points around its mapped perimeter so a large park is not represented by an arbitrary interior point.
- If `osmium-tool` is unavailable, the build uses a saved and checksummed Overpass response. Fetch, validation, unexpectedly small extract, and graph-budget failures stop the build; generated coordinates or place records are never substituted.
- Share links store the city and are rejected when their dataset version differs from that city's loaded dataset; there is no cross-version migration.

## Calculation assumptions

- Walking access uses multi-source Dijkstra from every applicable grocery point and sampled park perimeter point over pedestrian-eligible OSM edges at a modeled 4.8 km/h. It accounts for the extracted street connectivity, but not elevation, untagged barriers, mapped gate restrictions, accessibility, opening hours, or temporary closures.
- Bicycle minutes use directional OSM-eligible edges and modeled road-class speeds. The routing graph is reversed for the search so minutes represent travel from each candidate home to the destination, including one-way streets in the correct commute direction. Reachable polygons sample full and partially reachable edges, interpolating the exact time cutoff before polygonization. They do not model traffic, elevation, rider ability, surface quality, construction, or live closures.
- Grocery type is enforced consistently in both feasible-area construction and candidate scoring. “Supermarket” excludes records typed only as grocery.
- Every hard condition must produce a valid layer. If any layer is missing or cannot intersect the supported boundary, the combined feasible region is empty rather than silently dropping that condition.
- Candidate points are generated from H3 cells whose centers are inside the feasible polygon, kept at least 300 m apart, and named with the containing DataSF Analysis Neighborhood or GHMC ward plus the nearest named OSM cross-street. Regions smaller than a cell use a Turf point-on-feature fallback; the final coordinate is checked against the feasible geometry.
- Candidate ranking maximizes the weakest normalized margin first and average margin second. It is deterministic but is not a statistical recommendation or market ranking.
- Condition layers are cached in the worker for the 50 most recent exact inputs. Calculations are synchronous inside the worker and cannot be interrupted mid-algorithm; the UI prevents conflicting mutations, and an aborted WebMCP request is prevented from committing after the worker returns.

## Workspace and input limits

- Bicycle limits are 5–90 minutes. Grocery and park limits are 1–45 minutes.
- Preference geometry is limited to valid closed Polygon/MultiPolygon rings and 500 vertices total. Share fragments are limited to 8,192 compressed URL characters and 256,000 decompressed bytes.
- Activity keeps the most recent 40 entries. Undo stores one meaningful canonical change. Recalculation, ranking, candidate selection, map movement, and layer visibility do not consume that undo slot.
- Local autosave includes activity and the one-step undo snapshot. Public share links include only the current canonical plan and intentionally omit private history and undo state.
- Reset requires confirmation, keeps a one-session undo snapshot, clears the share hash, and clears persisted state. Running the sample over existing work also requires explicit replacement confirmation.
- If browser persistence fails, the in-memory change remains active and SweetSpot reports that it could not autosave. A reload can then lose that session-only change.

## Browser, map, and WebMCP constraints

- Base-map tiles require network access. Analysis, pedestrian/bicycle routing, candidate naming, and search remain local. A failed map/style load shows a retryable fallback while panel results remain usable.
- Search uses the bundled OSM index of named POIs and street names. `VITE_MAPTILER_KEY` changes only the base-map provider; public keys must be origin-restricted.
- Browsers without native `document.modelContext` use the pinned MCP-B polyfill. This makes the tool-registration surface available but does not by itself connect an AI client; discovery still requires a compatible MCP-B extension/relay or a native browser assistant.
- A deployed WebMCP release requires `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` for the exact final origin. `npm run build:release` and the Vercel build fail if it is absent. Ordinary `npm run build` intentionally remains available for local/manual verification and omits an empty origin-trial tag.
- WebMCP write results are compact summaries; full GeoJSON stays inside the page. Capability changes are diffed so unrelated state updates do not abort and re-register stable tools.

## Release constraints

- Before describing a release as current, rebuild and review each city's source checksums, POI coverage, graph directionality, and boundary versions.
- A release still requires a deployed-origin WebMCP smoke test and comparison against an independent routing source. Real source data removes fabrication; it does not turn modeled travel time into a guarantee.
