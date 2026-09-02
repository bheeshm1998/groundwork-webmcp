# SweetSpot

SweetSpot is a fully client-side location-planning workspace for San Francisco and Hyderabad. A person or a connected WebMCP agent can add up to four destinations, create walking, cycling, or free-flow driving travel limits, add network-based access conditions for groceries, schools, healthcare, parks, and cinemas, draw a personal boundary, and combine those constraints into ranked candidate areas.

The map and the control panels are two views of the same state. Destinations and conditions can be created, edited, hidden, dragged, or removed manually; WebMCP tools perform the same domain operations. The activity panel identifies whether each change came from the user or agent and shows an in-flight agent action, including when the agent is waiting for a drawing.

SweetSpot is a planning aid, not a routing guarantee or housing-listing service. It does not model live traffic, elevation, temporary closures, opening hours, accessibility, or housing availability.

## Data and calculations

The committed dataset contains fetched public records only:

- OpenStreetMap streets, named search locations, groceries, schools, healthcare facilities, parks, and cinemas from checksum-pinned city extracts. OSM data is licensed under ODbL 1.0.
- DataSF Analysis Neighborhoods (`j2bu-swwd`) and Bay Area County Polygons (`wamw-vt4s`), filtered to San Francisco.
- OpenStreetMap's Hyderabad administrative boundary and GHMC ward polygons recorded on those relations.

Both cities use the `sweetspot-graph-v3` binary format. Every directed edge stores separate walking, cycling, and driving weights. Driving uses OSM road access, directionality, highway class, and available `maxspeed` tags to estimate free-flow time; pedestrian-only ways and other non-drivable edges are excluded. Place access runs over the street network, with sampled perimeter access for mapped park, school, and healthcare areas.

Each city has an independent manifest: [`public/data/sf/metadata.json`](public/data/sf/metadata.json) and [`public/data/hyderabad/metadata.json`](public/data/hyderabad/metadata.json). They record source URLs, extract dates, SHA-256 checksums, versioned asset filenames, per-category counts, and graph sizes. The build stops if a source cannot be fetched, an extract is unexpectedly small, a required category is empty, or the city-specific graph budget is exceeded. There is no synthetic fallback.

Destination search uses the bundled city index first. Names or addresses absent from the extract fall back to a city-bounded Photon-compatible OpenStreetMap geocoder. Set `VITE_GEOCODER_URL` to a supported or self-hosted Photon endpoint for production traffic.

## Rebuild the datasets

Requirements: Node.js 22+ and npm. For the preferred Geofabrik workflow, install `osmium-tool`, download a timestamped PBF, verify it, and set `OSM_PBF_PATH` and `OSM_PBF_SOURCE_URL`. Without `osmium`, the builder uses the existing checksum-pinned Overpass response in `data/source`.

```sh
npm install
npm run data:build
npm run data:build:hyderabad
```

The default target is San Francisco. Pass `--city hyderabad` or use `data:build:hyderabad` for Hyderabad. Neither build path substitutes generated coordinates or place records.

## Run and verify

```sh
npm install
npm run dev
npm test
npm run lint
npm run format:check
npm run build
npm run test:e2e
```

## WebMCP

SweetSpot initializes `@mcp-b/webmcp-polyfill` before React mounts. The polyfill supplies `document.modelContext` only when the browser does not provide the native API, so a compatible MCP-B extension, relay, or native browser assistant can discover the page's tools.

The 19 capability-gated tools are:

`get_workspace`, `search_locations`, `add_destination`, `remove_destination`, `add_travel_condition`, `add_place_condition`, `request_user_drawing`, `update_condition`, `delete_condition`, `set_layer_visibility`, `combine_conditions`, `recalculate`, `rank_areas`, `analyze_restriction`, `select_area`, `explain_area`, `remove_area`, `undo`, and `create_share_link`.

Availability follows the live workspace. For example, combining is unavailable until at least two conditions exist, ranking is unavailable before a feasible region exists, and `request_user_drawing` remains in flight until the person finishes or cancels the drawing.

For a Chrome origin-trial release, obtain a token for the exact final HTTPS origin and set:

```sh
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=your_exact_origin_token
npm run build:release
```

`build:release` intentionally fails when the token is missing. Local development needs no token because the MCP-B compatibility runtime is available at `localhost`.

## License

Application code is MIT licensed. Bundled OpenStreetMap-derived data remains subject to ODbL 1.0 and attribution; DataSF source licensing is recorded in the dataset manifest.
