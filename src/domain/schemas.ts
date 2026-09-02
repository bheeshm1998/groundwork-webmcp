import { z } from 'zod';
import type { Feature, MultiPolygon, Point, Polygon } from 'geojson';
import { CITY_IDS } from './cities';

export type AreaGeometry = Feature<Polygon | MultiPolygon>;
export type PointFeature = Feature<Point>;

export const CoordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type Coordinate = z.infer<typeof CoordinateSchema>;

export const CityIdSchema = z.enum(CITY_IDS);

const LinearRingSchema = z
  .array(CoordinateSchema)
  .min(4)
  .max(500)
  .refine(
    (ring) => ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1],
    'Polygon rings must be closed.',
  );
const PolygonCoordinatesSchema = z.array(LinearRingSchema).min(1);

function ringArea(ring: Coordinate[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]!;
    const next = ring[index + 1]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea / 2);
}

function orientation(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  );
}

function ringSelfIntersects(ring: Coordinate[]): boolean {
  const segmentCount = ring.length - 1;
  for (let first = 0; first < segmentCount; first += 1) {
    for (let second = first + 1; second < segmentCount; second += 1) {
      if (second === first + 1 || (first === 0 && second === segmentCount - 1)) continue;
      if (segmentsCross(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!)) {
        return true;
      }
    }
  }
  return false;
}

export const PolygonFeatureSchema = z
  .object({
    type: z.literal('Feature'),
    properties: z.record(z.string(), z.unknown()).nullable(),
    geometry: z.discriminatedUnion('type', [
      z.object({ type: z.literal('Polygon'), coordinates: PolygonCoordinatesSchema }),
      z.object({
        type: z.literal('MultiPolygon'),
        coordinates: z.array(PolygonCoordinatesSchema).min(1),
      }),
    ]),
  })
  .superRefine((feature, context) => {
    const rings =
      feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat();
    const vertexCount = rings.reduce((total, ring) => total + ring.length, 0);
    if (vertexCount > 500) {
      context.addIssue({
        code: 'custom',
        path: ['geometry', 'coordinates'],
        message: 'Drawings are limited to 500 vertices.',
      });
    }
    for (const [index, ring] of rings.entries()) {
      const uniqueVertices = new Set(ring.slice(0, -1).map(([lng, lat]) => `${lng},${lat}`));
      if (uniqueVertices.size < 3 || ringArea(ring) < 1e-12) {
        context.addIssue({
          code: 'custom',
          path: ['geometry', 'coordinates', index],
          message: 'Each polygon ring must enclose a non-zero area.',
        });
      } else if (ringSelfIntersects(ring)) {
        context.addIssue({
          code: 'custom',
          path: ['geometry', 'coordinates', index],
          message: 'Polygon rings cannot cross themselves.',
        });
      }
    }
  }) as z.ZodType<AreaGeometry>;

const ConditionBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  visible: z.boolean().default(true),
});

export const TRAVEL_MODES = ['bike', 'walk', 'car'] as const;
export const ACCESS_MODES = ['walk', 'bike'] as const;
export const PLACE_CATEGORIES = ['grocery', 'school', 'healthcare', 'park', 'cinema'] as const;

export const TravelModeSchema = z.enum(TRAVEL_MODES);
export type TravelMode = z.infer<typeof TravelModeSchema>;
export const AccessModeSchema = z.enum(ACCESS_MODES);
export type AccessMode = z.infer<typeof AccessModeSchema>;
export const PlaceCategorySchema = z.enum(PLACE_CATEGORIES);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

export const TravelConditionSchema = ConditionBaseSchema.extend({
  kind: z.literal('travel'),
  destinationId: z.string().min(1),
  mode: TravelModeSchema,
  maxMinutes: z.number().min(5).max(90),
});

export const AccessConditionSchema = ConditionBaseSchema.extend({
  kind: z.literal('access'),
  category: PlaceCategorySchema,
  mode: AccessModeSchema,
  maxMinutes: z.number().min(1).max(45),
  groceryType: z.enum(['supermarket', 'supermarket_or_grocery']).optional(),
});

export const PreferenceConditionSchema = ConditionBaseSchema.extend({
  kind: z.literal('preference'),
  geometry: PolygonFeatureSchema,
});

export const ConditionSchema = z.discriminatedUnion('kind', [
  TravelConditionSchema,
  AccessConditionSchema,
  PreferenceConditionSchema,
]);
export type Condition = z.infer<typeof ConditionSchema>;

export const DestinationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  coordinates: CoordinateSchema,
});
export type Destination = z.infer<typeof DestinationSchema>;

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

export const CanonicalWorkspaceSchema = z
  .object({
    destinations: z.array(DestinationSchema).max(4),
    conditions: z.array(ConditionSchema).max(20),
    selectedCandidateId: z.string().nullable(),
    removedCandidateIds: z.array(z.string()).max(1_000),
    view: MapViewSchema,
    combined: z.boolean(),
  })
  .superRefine((workspace, context) => {
    if (workspace.combined && workspace.conditions.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['combined'],
        message: 'At least two conditions are required for a combined analysis.',
      });
    }
    const destinationIds = new Set(workspace.destinations.map(({ id }) => id));
    for (const [index, condition] of workspace.conditions.entries()) {
      if (condition.kind === 'travel' && !destinationIds.has(condition.destinationId)) {
        context.addIssue({
          code: 'custom',
          path: ['conditions', index, 'destinationId'],
          message: 'Travel conditions must reference a current destination.',
        });
      }
    }
  });
export type CanonicalWorkspace = z.infer<typeof CanonicalWorkspaceSchema>;

export interface CandidateMetric {
  conditionId: string;
  label: string;
  minutes: number;
  nearestPlaceName: string | null;
  slack: number;
}

export interface Candidate {
  id: string;
  name: string;
  coordinates: Coordinate;
  score: number;
  minimumSlack: number;
  averageSlack: number;
  metrics: CandidateMetric[];
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
  cityId: CityIdSchema.optional(),
  datasetVersion: z.string(),
  canonical: CanonicalWorkspaceSchema,
  activity: z.array(ActivityEntrySchema).max(40),
  undo: CanonicalWorkspaceSchema.nullable(),
});
export type WorkspaceShare = z.infer<typeof WorkspaceShareSchema>;

export type OperationState = 'idle' | 'calculating' | 'drawing' | 'error';
export type AnalysisFreshness = 'not-combined' | 'fresh' | 'stale';

export type WorkspaceCommand =
  | {
      type: 'add-destination';
      destination: Omit<Destination, 'id'> & { id?: string };
      actor?: ActivityEntry['actor'];
    }
  | { type: 'update-destination'; destination: Destination; actor?: ActivityEntry['actor'] }
  | { type: 'remove-destination'; id: string; actor?: ActivityEntry['actor'] }
  | {
      type: 'add-travel';
      destinationId: string;
      mode: TravelMode;
      maxMinutes: number;
      actor?: ActivityEntry['actor'];
    }
  | {
      type: 'add-place';
      category: PlaceCategory;
      mode: AccessMode;
      maxMinutes: number;
      groceryType?: 'supermarket' | 'supermarket_or_grocery';
      actor?: ActivityEntry['actor'];
    }
  | { type: 'add-preference'; geometry: AreaGeometry; actor?: ActivityEntry['actor'] }
  | {
      type: 'update-condition';
      id: string;
      maxMinutes?: number;
      destinationId?: string;
      mode?: TravelMode;
      category?: PlaceCategory;
      groceryType?: 'supermarket' | 'supermarket_or_grocery';
      actor?: ActivityEntry['actor'];
    }
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
  | { type: 'explain-area'; id: string }
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
  kind: 'poi' | 'street';
}
