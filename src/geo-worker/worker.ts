/// <reference lib="webworker" />
import { expose } from 'comlink';
import type { AreaGeometry } from '../domain/schemas';
import type { GeoWorkerApi } from './api';
import { GeoEngine, type PlacesData } from './engine';
import type { SerializedGraph } from './graph';

let engine: GeoEngine | null = null;

const api: GeoWorkerApi = {
  async initialize() {
    const [graphResponse, placesResponse, boundaryResponse, metadataResponse] = await Promise.all([
      fetch('/data/sf/graph.json'),
      fetch('/data/sf/places.json'),
      fetch('/data/sf/boundary.geojson'),
      fetch('/data/sf/metadata.json'),
    ]);
    if (
      ![graphResponse, placesResponse, boundaryResponse, metadataResponse].every(
        (response) => response.ok,
      )
    ) {
      throw new Error('The San Francisco analysis dataset could not be loaded.');
    }
    const [graph, loadedPlaces, boundary, loadedMetadata] = await Promise.all([
      graphResponse.json() as Promise<SerializedGraph>,
      placesResponse.json() as Promise<PlacesData>,
      boundaryResponse.json() as Promise<AreaGeometry>,
      metadataResponse.json() as Promise<{
        datasetVersion: string;
        source: string;
        attribution: string;
      }>,
    ]);
    engine = new GeoEngine(graph, loadedPlaces, boundary);
    return { metadata: loadedMetadata, presets: loadedPlaces.presets };
  },
  async analyze(canonical) {
    if (!engine) throw new Error('The analysis engine is not initialized.');
    return engine.analyze(canonical);
  },
};

expose(api);
