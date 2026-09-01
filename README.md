# Groundwork

Groundwork is a fully client-side San Francisco housing-location workspace. It combines bicycle commute limits, pedestrian access to groceries and parks, and a personal map boundary; then it ranks separated candidate areas with explainable margins. The same workflow is available manually and through 17 capability-gated WebMCP tools.

Groundwork is a planning aid, not a routing guarantee or housing listing service. It does not model live traffic, elevation, temporary closures, opening hours, accessibility, or housing availability.

## Data

The committed dataset contains only fetched public records:

- OpenStreetMap streets, named POIs, supermarkets, groceries, convenience stores, and parks, obtained from a pinned San Francisco Overpass extract when `osmium` is unavailable. OSM data is licensed under ODbL 1.0.
- DataSF Analysis Neighborhoods (`j2bu-swwd`).
- DataSF Bay Area County Polygons (`wamw-vt4s`), filtered to San Francisco for the analysis boundary.

[`public/data/sf/metadata.json`](public/data/sf/metadata.json) records every source URL, extract date, SHA-256, versioned asset filename, record count, and graph size. The build stops if a source cannot be fetched, an extract is unexpectedly small, or the contracted graph is 2 MB or larger after gzip. There is no synthetic fallback.

## Rebuild the dataset

Requirements: Node.js 22+ and npm. For the preferred Geofabrik workflow, install `osmium-tool`, download a timestamped Northern California PBF from Geofabrik, verify it, and set both `OSM_PBF_PATH` and `OSM_PBF_SOURCE_URL` (the exact timestamped download URL). On machines without `osmium`, the builder uses the Overpass fallback and stores the checksum-pinned raw response in `data/source`.

```sh
npm install
npm run data:build
```

The PBF path performs an `osmium extract` to the San Francisco bounding box, filters the required street/POI tags, and exports the source geometry. If `osmium` is unavailable, the documented Overpass path is used; neither path substitutes generated coordinates or records.

## Run and test

```sh
npm install
npm run dev
npm test
npm run build
npm run test:e2e
```

## Enable WebMCP

Use a browser build that exposes `document.modelContext`. For a production release, obtain an origin-trial token for the exact final HTTPS origin and set:

```sh
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=your_exact_origin_token
npm run build:release
```

`build:release` intentionally fails when the token is missing. The application remains usable in manual mode when WebMCP is unavailable. Existing WebMCP tool names and signatures are stable.

## License

Application code is MIT licensed. Bundled OpenStreetMap-derived data remains subject to ODbL 1.0 and attribution; DataSF source licensing is recorded in the dataset manifest.
