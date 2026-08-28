import { wrap, type Remote } from 'comlink';
import type { GeoWorkerApi } from './api';

let client: Remote<GeoWorkerApi> | null = null;

export function getGeoWorker(): Remote<GeoWorkerApi> {
  if (!client) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    client = wrap<GeoWorkerApi>(worker);
  }
  return client;
}
