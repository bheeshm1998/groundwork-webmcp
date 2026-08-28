import { z } from 'zod';
import type { Feature, MultiPolygon, Point, Polygon } from 'geojson';

export type AreaGeometry = Feature<Polygon | MultiPolygon>;
export type PointFeature = Feature<Point>;

export const CoordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type Coordinate = z.infer<typeof CoordinateSchema>;

export const PolygonFeatureSchema = z.object({
  type: z.literal('Feature'),
  properties: z.record(z.string(), z.unknown()).nullable(),
  geometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.unknown()),
  }),
});

const ConditionBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  visible: z.boolean().default(true),
});

export const BikeConditionSchema = ConditionBaseSchema.extend({
  kind: z.literal('bike'),
  maxMinutes: z.number().min(5).max(90),
});

export const AccessConditionSchema = ConditionBaseSchema.extend({
  kind: z.literal('access'),
  category: z.enum(['grocery', 'park']),
  maxMinutes: z.number().min(1).max(45),
  groceryType: z.enum(['supermarket', 'supermarket_or_grocery']).optional(),
});

export const PreferenceConditionSchema = ConditionBaseSchema.extend({
  kind: z.literal('preference'),
  geometry: PolygonFeatureSchema,
});

export const ConditionSchema = z.discriminatedUnion('kind', [
  BikeConditionSchema,
  AccessConditionSchema,
  PreferenceConditionSchema,
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const OfficeSchema = z.object({
  label: z.string().min(1),
  coordinates: CoordinateSchema,
});
export type Office = z.infer<typeof OfficeSchema>;

export const MapViewSchema = z.object({
  center: CoordinateSchema,
  zoom: z.number().min(1).max(22),
  bearing: z.number().default(0),
  pitch: z.number().default(0),
});
export type MapViewState = z.infer<typeof MapViewSchema>;

export const ActivityEntrySchema = z.object({
  id: z.string(),
  actor: z.enum(['user', 'agent', 'system']),
  message: z.string(),
  timestamp: z.number(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const CanonicalWorkspaceSchema = z.object({
  office: OfficeSchema.nullable(),
  conditions: z.array(ConditionSchema),
  selectedCandidateId: z.string().nullable(),
  removedCandidateIds: z.array(z.string()),
  view: MapViewSchema,
  combined: z.boolean(),
});
export type CanonicalWorkspace = z.infer<typeof CanonicalWorkspaceSchema>;

export interface Candidate {
  id: string;
  coordinates: Coordinate;
  score: number;
  minimumSlack: number;
  averageSlack: number;
  bikeMinutes: number | null;
  groceryMinutes: number | null;
  parkMinutes: number | null;
  comfortable: string[];
  closeToFailing: string | null;
  tradeoff: string;
}

export interface RestrictionResult {
  conditionId: string;
  label: string;
  areaLostKm2: number;
  currentAreaKm2: number;
  relaxedAreaKm2: number | null;
  message: string;
}

export interface DerivedAnalysis {
  layers: Record<string, AreaGeometry>;
  feasibleRegion: AreaGeometry | null;
  feasibleAreaKm2: number;
  candidates: Candidate[];
  restriction: RestrictionResult | null;
}

export const WorkspaceShareSchema = z.object({
  schemaVersion: z.literal(1),
  datasetVersion: z.string(),
  canonical: CanonicalWorkspaceSchema,
  activity: z.array(ActivityEntrySchema).max(40),
  undo: CanonicalWorkspaceSchema.nullable(),
});
export type WorkspaceShare = z.infer<typeof WorkspaceShareSchema>;

export type OperationState = 'idle' | 'calculating' | 'drawing' | 'error';
export type AnalysisFreshness = 'not-combined' | 'fresh' | 'stale';

export type WorkspaceCommand =
  | { type: 'set-office'; office: Office; actor?: ActivityEntry['actor'] }
  | { type: 'add-bike'; maxMinutes: number; actor?: ActivityEntry['actor'] }
  | {
      type: 'add-access';
      category: 'grocery' | 'park';
      maxMinutes: number;
      groceryType?: 'supermarket' | 'supermarket_or_grocery';
      actor?: ActivityEntry['actor'];
    }
  | { type: 'add-preference'; geometry: AreaGeometry; actor?: ActivityEntry['actor'] }
  | { type: 'update-condition'; id: string; maxMinutes: number; actor?: ActivityEntry['actor'] }
  | { type: 'delete-condition'; id: string; actor?: ActivityEntry['actor'] }
  | { type: 'set-visibility'; id: string; visible: boolean; actor?: ActivityEntry['actor'] }
  | { type: 'combine'; actor?: ActivityEntry['actor'] }
  | { type: 'recalculate'; actor?: ActivityEntry['actor'] }
  | { type: 'rank'; actor?: ActivityEntry['actor'] }
  | { type: 'select-candidate'; id: string | null; actor?: ActivityEntry['actor'] }
  | { type: 'remove-candidate'; id: string; actor?: ActivityEntry['actor'] }
  | { type: 'set-view'; view: MapViewState }
  | { type: 'undo'; actor?: ActivityEntry['actor'] }
  | { type: 'reset'; actor?: ActivityEntry['actor'] };

export type WorkspaceQuery =
  | { type: 'get-workspace' }
  | { type: 'search-locations'; query: string }
  | { type: 'explain-candidate'; id: string }
  | { type: 'analyze-restriction' }
  | { type: 'create-share-link' };

export interface CommandResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

export interface LocationResult {
  id: string;
  label: string;
  coordinates: Coordinate;
}
