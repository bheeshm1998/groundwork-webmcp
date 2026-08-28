import type { CanonicalWorkspace, DerivedAnalysis } from './schemas';

export const DATASET_VERSION = 'sf-demo-2026-08-27';
export const SF_CENTER: [number, number] = [-122.425, 37.7749];
export const SF_BOUNDS: [[number, number], [number, number]] = [
  [-122.53, 37.69],
  [-122.34, 37.83],
];

export const EMPTY_CANONICAL: CanonicalWorkspace = {
  office: null,
  conditions: [],
  selectedCandidateId: null,
  removedCandidateIds: [],
  view: { center: SF_CENTER, zoom: 11.6, bearing: 0, pitch: 0 },
  combined: false,
};

export const EMPTY_DERIVED: DerivedAnalysis = {
  layers: {},
  feasibleRegion: null,
  feasibleAreaKm2: 0,
  candidates: [],
  restriction: null,
};

export const SAMPLE_OFFICE = {
  label: '1 Market Street, San Francisco',
  coordinates: [-122.3949, 37.7936] as [number, number],
};
