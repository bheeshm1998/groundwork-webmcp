import type { CanonicalWorkspace, DerivedAnalysis } from '../domain/schemas';
import type { PlacesData } from './engine';

export interface DatasetMetadata {
  datasetVersion: string;
  source: string;
  attribution: string;
}

export interface GeoWorkerApi {
  initialize(): Promise<{ metadata: DatasetMetadata; presets: PlacesData['presets'] }>;
  analyze(canonical: CanonicalWorkspace): Promise<DerivedAnalysis>;
}
