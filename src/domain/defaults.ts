import type { CanonicalWorkspace, DerivedAnalysis } from './schemas';
import { CITIES, DEFAULT_CITY_ID, type CityId } from './cities';

export const DATASET_VERSION = 'sf-osm-datasf-2026-09-03-v3';

export function emptyCanonical(cityId: CityId = DEFAULT_CITY_ID): CanonicalWorkspace {
  const city = CITIES[cityId];
  return {
    destinations: [],
    conditions: [],
    selectedCandidateId: null,
    removedCandidateIds: [],
    view: { center: city.center, zoom: city.zoom, bearing: 0, pitch: 0 },
    combined: false,
  };
}

export const EMPTY_CANONICAL: CanonicalWorkspace = emptyCanonical();

export const EMPTY_DERIVED: DerivedAnalysis = {
  layers: {},
  feasibleRegion: null,
  feasibleAreaKm2: 0,
  candidates: [],
  restriction: null,
};
