/// <reference lib="webworker" />
import { expose } from 'comlink';
import type { AreaGeometry } from '../domain/schemas';
import type { GeoWorkerApi } from './api';
import { GeoEngine, type PlacesData } from './engine';
import { decodeGraphBinary } from './graph';
import { gunzipSync } from 'fflate';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { DatasetMetadata } from './api';
import { CITIES } from '../domain/cities';

let engine: GeoEngine | null = null;

const api: GeoWorkerApi = {
  async initialize(cityId) {
    const city = CITIES[cityId];
    const metadataResponse = await fetch(`${city.dataPath}/metadata.json`);
    if (!metadataResponse.ok)
      throw new Error(`The ${city.name} dataset manifest could not be loaded.`);
    const loadedMetadata = (await metadataResponse.json()) as DatasetMetadata;
    const [graphResponse, placesResponse, boundaryResponse, neighborhoodsResponse, labelsResponse] =
      await Promise.all([
        fetch(`${city.dataPath}/${loadedMetadata.assets.graph}`),
        fetch(`${city.dataPath}/${loadedMetadata.assets.places}`),
        fetch(`${city.dataPath}/${loadedMetadata.assets.boundary}`),
        fetch(`${city.dataPath}/${loadedMetadata.assets.neighborhoods}`),
        fetch(`${city.dataPath}/${loadedMetadata.assets.nodeLabels}`),
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
      throw new Error(`The ${city.name} analysis dataset could not be loaded.`);
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
    return {
      metadata: loadedMetadata,
      search: loadedPlaces.search.filter(({ coordinates }) =>
        engine!.containsCoordinate(coordinates),
      ),
    };
  },
  async isCoordinateSupported(coordinate) {
    if (!engine) throw new Error('The analysis engine is not initialized.');
    return engine.containsCoordinate(coordinate);
  },
  async analyze(canonical, onProgress) {
    if (!engine) throw new Error('The analysis engine is not initialized.');
    return engine.analyze(canonical, onProgress);
  },
};

expose(api);
