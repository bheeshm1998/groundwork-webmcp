# SweetSpot assumptions and constraints

Last reviewed: 2026-09-03

## Product scope

- SweetSpot is a client-side spatial decision aid, not a live routing, real-estate listing, safety, or accessibility service.
- Users choose San Francisco or Hyderabad before opening the planner. A workspace belongs to one city, and every destination, condition, calculation, and result must remain inside that city's boundary.
- A workspace supports zero to four destinations and zero to twenty conditions. Several travel conditions can reference one destination, and several place conditions can use the same category.
- Travel conditions use `walk`, `bike`, or `car` and a 5–90 minute limit. Place conditions use `walk` or `bike`, a 1–45 minute limit, and one of `grocery`, `school`, `healthcare`, `park`, or `cinema`. Grocery conditions may include every grocery record or supermarkets only.
- At least two visible conditions are required to create a combined feasible region. A personal Polygon or MultiPolygon drawing can be one of those conditions.

## Shipped data

- The San Francisco assets contain a checksum-pinned OpenStreetMap extract plus official DataSF city/county and Analysis Neighborhood polygons. The Hyderabad assets contain a separate checksum-pinned OSM extract, the Hyderabad administrative boundary, and GHMC ward polygons. There is no synthetic fallback.
- Version `sf-osm-datasf-2026-09-02-v3` contains 473 groceries, 285 schools, 155 healthcare facilities, 304 parks, and 16 cinemas.
- Version `hyderabad-osm-2026-09-02-v3` contains 447 groceries, 503 schools, 1,620 healthcare facilities, 469 parks, and 119 cinemas.
- Every asset filename is versioned. Each `metadata.json` records source URLs, extract dates, SHA-256 checksums, per-category counts, graph format, and dataset version.
- The contracted `sweetspot-graph-v3` binary stores walking, cycling, and car weights for every directed edge. The compressed graph budget is 2 MB for San Francisco and 8 MB for Hyderabad.
- Nodes, ways, and relations are included for place records. Search uses named OSM POIs and street names. Mapped school, healthcare, and park areas use sampled perimeter access rather than an arbitrary interior center.
- If `osmium-tool` is unavailable, the build uses the saved and checksummed Overpass response. Fetch, validation, unexpectedly small extract, missing-category, and graph-budget failures stop the build; generated coordinates and place records are never substituted.
- Share links store the city and are rejected if their dataset version differs from the loaded city's version. There is no cross-version migration.

## Calculation assumptions

- Walking and cycling place access use multi-source Dijkstra over mode-eligible OSM edges. Walking is modeled at 4.8 km/h; cycling uses directional road-class speeds.
- Travel limits represent a trip from each candidate area to its selected destination. The destination-oriented search uses a reversed graph so OSM one-way direction is applied in the trip's actual direction.
- Car travel is a free-flow estimate. It uses drivable highway classes, access tags, one-way tags, and parsable `maxspeed` values. It excludes known pedestrian-only and non-drivable ways. It does not model current or historical congestion, turn penalties, signals, parking, road incidents, or temporary closures.
- Reachable polygons include fully reachable edges and interpolate partially reachable edge cutoffs before polygonization. Access areas are network-based, not straight-line buffers.
- Grocery subtype filtering is enforced in feasible-area calculation and candidate metrics. “Supermarket” excludes records typed only as grocery or convenience.
- Every hard condition must produce a valid layer. A missing layer or failed intersection makes the feasible region empty; the engine never silently drops that condition.
- Candidate points come from H3 cell centers inside the feasible polygon, stay at least 300 m apart, and use the containing DataSF neighborhood or GHMC ward plus the nearest named cross-street. Very small regions use a Turf point-on-feature fallback checked against the final geometry.
- Candidate metrics are generated from the actual active conditions. A result can therefore show several travel or place metrics of the same kind without fixed “office/grocery/park” fields.
- Ranking maximizes the weakest normalized margin first and average margin second. It is deterministic, but it is not a statistical recommendation or market ranking.
- The worker caches the 50 most recent exact condition inputs. Calculations are synchronous inside the worker and cannot be interrupted mid-algorithm; an aborted WebMCP request is prevented from committing after the worker returns.

## Workspace and input limits

- Destination search and coordinates are boundary-checked. Up to four destinations may be dragged manually after creation.
- Preference geometry is limited to valid, closed Polygon/MultiPolygon rings and 500 total vertices. Share fragments are limited to 8,192 compressed URL characters and 256,000 decompressed bytes.
- Activity keeps the most recent 40 entries and labels user and agent actions. Undo stores one meaningful canonical change. Recalculation, ranking, selection, map movement, and layer visibility do not consume that undo slot.
- Local autosave includes activity and the one-step undo snapshot. Public share links contain only the canonical plan and intentionally omit private history and undo state.
- Update recalculates stale analysis. Reset requires a second click, keeps a one-session undo snapshot, clears the share hash, and clears persisted state.
- If browser persistence fails, the in-memory change remains active and SweetSpot reports that autosave failed. Reloading can then lose that session-only change.

## Browser, map, and WebMCP constraints

- Base-map tiles require network access. Analysis, graph routing, candidate naming, and bundled search remain local. A failed map/style load shows a retryable fallback while the panels remain usable.
- `VITE_MAPTILER_KEY` changes only the base-map provider; public keys must be origin-restricted. Search can fall back to the configured Photon-compatible endpoint when the local index has no match.
- Browsers without native `document.modelContext` use the pinned MCP-B polyfill. It exposes the registration surface but does not itself connect an AI client.
- Tool descriptions state accepted enums, units, and limits. Tool availability is derived from live workspace state, and WebMCP writes call the same service used by manual controls.
- `request_user_drawing` deliberately suspends while the person draws or cancels. The visible activity strip reports that waiting state.
- A deployed Chrome origin-trial release requires `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` for the exact final origin. `build:release` fails without it; ordinary local builds omit an empty token.

## Release constraints

- Before describing a release as current, rebuild and review both cities' source checksums, category coverage, graph directionality, and boundary versions.
- A release requires unit, lint, formatting, build, end-to-end, local browser, and deployed-origin browser checks. Real source data removes fabrication; modeled travel time still is not a guarantee.
