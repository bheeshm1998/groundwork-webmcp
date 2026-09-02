import type { CanonicalWorkspace, Coordinate, DerivedAnalysis } from '../domain/schemas';
import type { CityId } from '../domain/cities';
import type { PlacesData } from './engine';

export interface DatasetMetadata {
  datasetVersion: string;
  attribution: string;
  generatedAt: string;
  method: string;
  sources: Array<{ name: string; url: string; extractDate: string; sha256: string }>;
  assets: {
    graph: string;
    places: string;
    neighborhoods: string;
    boundary: string;
    nodeLabels: string;
  };
}

export interface GeoWorkerApi {
  initialize(cityId: CityId): Promise<{ metadata: DatasetMetadata; search: PlacesData['search'] }>;
  isCoordinateSupported(coordinate: Coordinate): Promise<boolean>;
  analyze(canonical: CanonicalWorkspace): Promise<DerivedAnalysis>;
}
