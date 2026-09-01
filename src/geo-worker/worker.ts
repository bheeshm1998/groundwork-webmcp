/// <reference lib="webworker" />
import { expose } from 'comlink';
import type { AreaGeometry } from '../domain/schemas';
import type { GeoWorkerApi } from './api';
import { GeoEngine, type PlacesData } from './engine';
import { decodeGraphBinary } from './graph';
import { gunzipSync } from 'fflate';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { DatasetMetadata } from './api';

let engine: GeoEngine | null = null;

const api: GeoWorkerApi = {
  async initialize() {
    const metadataResponse = await fetch('/data/sf/metadata.json');
    if (!metadataResponse.ok)
      throw new Error('The San Francisco dataset manifest could not be loaded.');
    const loadedMetadata = (await metadataResponse.json()) as DatasetMetadata;
    const [graphResponse, placesResponse, boundaryResponse, neighborhoodsResponse, labelsResponse] =
      await Promise.all([
        fetch(`/data/sf/${loadedMetadata.assets.graph}`),
        fetch(`/data/sf/${loadedMetadata.assets.places}`),
        fetch(`/data/sf/${loadedMetadata.assets.boundary}`),
        fetch(`/data/sf/${loadedMetadata.assets.neighborhoods}`),
        fetch(`/data/sf/${loadedMetadata.assets.nodeLabels}`),
      ]);
    if (
      ![
        graphResponse,
        placesResponse,
        boundaryResponse,
        neighborhoodsResponse,
        labelsResponse,
      ].every((response) => response.ok)
    ) {
      throw new Error('The San Francisco analysis dataset could not be loaded.');
    }
    const [graphBytes, loadedPlaces, boundary, neighborhoods, nodeLabels] = await Promise.all([
      graphResponse.arrayBuffer(),
      placesResponse.json() as Promise<PlacesData>,
      boundaryResponse.json() as Promise<AreaGeometry>,
      neighborhoodsResponse.json() as Promise<FeatureCollection<Polygon | MultiPolygon>>,
      labelsResponse.json() as Promise<Array<string | null>>,
    ]);
    const transportedGraph = new Uint8Array(graphBytes);
    const graphBinary =
      transportedGraph[0] === 0x1f && transportedGraph[1] === 0x8b
        ? gunzipSync(transportedGraph)
        : transportedGraph;
    const graph = decodeGraphBinary(graphBinary);
    engine = new GeoEngine(graph, loadedPlaces, boundary, neighborhoods, nodeLabels);
    return { metadata: loadedMetadata, search: loadedPlaces.search };
  },
  async analyze(canonical) {
    if (!engine) throw new Error('The analysis engine is not initialized.');
    return engine.analyze(canonical);
  },
};

expose(api);
