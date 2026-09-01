import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import buffer from '@turf/buffer';
import cleanCoords from '@turf/clean-coords';
import distance from '@turf/distance';
import intersect from '@turf/intersect';
import pointOnFeature from '@turf/point-on-feature';
import union from '@turf/union';
import { featureCollection, point } from '@turf/helpers';
import { cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell, polygonToCells } from 'h3-js';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type {
  AreaGeometry,
  Candidate,
  CanonicalWorkspace,
  Condition,
  Coordinate,
  DerivedAnalysis,
  RestrictionResult,
} from '../domain/schemas';
import { dijkstra, loadGraph, nearestNode, type GraphData, type SerializedGraph } from './graph';

export interface PlaceRecord {
  id: string;
  name: string;
  coordinates: Coordinate;
  type?: 'supermarket' | 'grocery';
}

export interface PlacesData {
  groceries: PlaceRecord[];
  parks: PlaceRecord[];
  presets: Array<{ id: string; label: string; coordinates: Coordinate }>;
}

interface BikeContext {
  distances: Float32Array;
}

function asArea(feature: Feature<Polygon | MultiPolygon>): AreaGeometry {
  return feature as AreaGeometry;
}

function safeIntersect(a: AreaGeometry, b: AreaGeometry): AreaGeometry | null {
  try {
    const result = intersect(featureCollection([a, b]));
    return result ? asArea(cleanCoords(result)) : null;
  } catch {
    return null;
  }
}

function unionAreas(features: AreaGeometry[]): AreaGeometry | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0] ?? null;
  const result = union(featureCollection(features));
  if (!result) throw new Error('The access areas could not be merged safely.');
  return asArea(cleanCoords(result));
}

function combineAreas(boundary: AreaGeometry, features: AreaGeometry[]): AreaGeometry | null {
  let current: AreaGeometry | null = boundary;
  for (const feature of features) {
    current = current ? safeIntersect(current, feature) : null;
    if (!current) return null;
  }
  return current;
}

function nearestMinutes(origin: Coordinate, places: PlaceRecord[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (const place of places) {
    closest = Math.min(
      closest,
      distance(point(origin), point(place.coordinates), { units: 'kilometers' }) / 0.084,
    );
  }
  return closest;
}

function makeBikeArea(
  graph: GraphData,
  distances: Float32Array,
  boundary: AreaGeometry,
): AreaGeometry | null {
  const cells = new Set<string>();
  for (let index = 0; index < distances.length; index += 1) {
    if (!Number.isFinite(distances[index])) continue;
    const cell = latLngToCell(graph.lat[index]!, graph.lng[index]!, 10);
    for (const nearby of gridDisk(cell, 1)) cells.add(nearby);
  }
  if (cells.size === 0) return null;
  const coordinates = cellsToMultiPolygon([...cells], true) as MultiPolygon['coordinates'];
  const polygon: AreaGeometry = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates },
  };
  return safeIntersect(polygon, boundary);
}

function pointBuffers(
  places: PlaceRecord[],
  maxMinutes: number,
  boundary: AreaGeometry,
): AreaGeometry | null {
  const radiusKm = maxMinutes * 0.084;
  const areas = places
    .map((place) => buffer(point(place.coordinates), radiusKm, { units: 'kilometers', steps: 16 }))
    .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature))
    .map(asArea);
  const merged = unionAreas(areas);
  return merged ? safeIntersect(merged, boundary) : null;
}

export class GeoEngine {
  readonly graph: GraphData;
  private readonly conditionCache = new Map<
    string,
    { layer: AreaGeometry | null; bike?: BikeContext }
  >();

  constructor(
    graphSpec: SerializedGraph,
    readonly places: PlacesData,
    readonly boundary: AreaGeometry,
  ) {
    this.graph = loadGraph(graphSpec);
  }

  private computeConditionLayer(
    canonical: CanonicalWorkspace,
    condition: Condition,
  ): { layer: AreaGeometry | null; bike?: BikeContext } {
    if (condition.kind === 'preference') {
      return { layer: safeIntersect(condition.geometry as AreaGeometry, this.boundary) };
    }
    if (condition.kind === 'access') {
      const places =
        condition.category === 'park'
          ? this.places.parks
          : this.places.groceries.filter(
              (place) =>
                condition.groceryType === 'supermarket_or_grocery' || place.type === 'supermarket',
            );
      return { layer: pointBuffers(places, condition.maxMinutes, this.boundary) };
    }
    if (!canonical.office) return { layer: null };
    const origin = nearestNode(this.graph, canonical.office.coordinates);
    const distances = dijkstra(this.graph, origin, condition.maxMinutes);
    return { layer: makeBikeArea(this.graph, distances, this.boundary), bike: { distances } };
  }

  private cachedConditionLayer(
    canonical: CanonicalWorkspace,
    condition: Condition,
  ): { layer: AreaGeometry | null; bike?: BikeContext } {
    const key = JSON.stringify({
      condition,
      office: condition.kind === 'bike' ? canonical.office?.coordinates : undefined,
    });
    const cached = this.conditionCache.get(key);
    if (cached) return cached;
    const computed = this.computeConditionLayer(canonical, condition);
    this.conditionCache.set(key, computed);
    if (this.conditionCache.size > 50) {
      const oldest = this.conditionCache.keys().next().value;
      if (oldest) this.conditionCache.delete(oldest);
    }
    return computed;
  }

  analyze(canonical: CanonicalWorkspace): DerivedAnalysis {
    const layers: Record<string, AreaGeometry> = {};
    const bikeContexts: Record<string, BikeContext> = {};
    for (const condition of canonical.conditions) {
      const result = this.cachedConditionLayer(canonical, condition);
      if (result.layer) layers[condition.id] = result.layer;
      if (result.bike) bikeContexts[condition.id] = result.bike;
    }

    const hasMissingCondition = canonical.conditions.some((condition) => !layers[condition.id]);
    const feasibleRegion =
      canonical.combined && !hasMissingCondition
        ? combineAreas(
            this.boundary,
            canonical.conditions.map((condition) => layers[condition.id]!),
          )
        : null;
    const feasibleAreaKm2 = feasibleRegion ? area(feasibleRegion) / 1_000_000 : 0;
    const candidates = feasibleRegion ? this.rank(canonical, feasibleRegion, bikeContexts) : [];
    const restriction =
      feasibleRegion || canonical.combined
        ? this.restriction(canonical, layers, feasibleRegion)
        : null;
    return { layers, feasibleRegion, feasibleAreaKm2, candidates, restriction };
  }

  private rank(
    canonical: CanonicalWorkspace,
    feasible: AreaGeometry,
    bikeContexts: Record<string, BikeContext>,
  ): Candidate[] {
    const bikeConditions = canonical.conditions.filter(
      (condition): condition is Extract<Condition, { kind: 'bike' }> => condition.kind === 'bike',
    );
    const groceryConditions = canonical.conditions.filter(
      (condition): condition is Extract<Condition, { kind: 'access' }> =>
        condition.kind === 'access' && condition.category === 'grocery',
    );
    const parkConditions = canonical.conditions.filter(
      (condition): condition is Extract<Condition, { kind: 'access' }> =>
        condition.kind === 'access' && condition.category === 'park',
    );
    const removed = new Set(canonical.removedCandidateIds);
    const scored: Candidate[] = [];
    const seeds = new Map<string, Coordinate>();
    const polygons: Polygon['coordinates'][] =
      feasible.geometry.type === 'Polygon'
        ? [feasible.geometry.coordinates]
        : feasible.geometry.coordinates;

    for (const coordinates of polygons) {
      const polygonFeature: AreaGeometry = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates },
      };
      for (const cell of polygonToCells(coordinates, 10, true)) {
        if (removed.has(cell)) continue;
        const [latitude, longitude] = cellToLatLng(cell);
        const coordinate: Coordinate = [longitude, latitude];
        if (booleanPointInPolygon(point(coordinate), polygonFeature)) seeds.set(cell, coordinate);
      }
      const representative = pointOnFeature(polygonFeature).geometry.coordinates as Coordinate;
      const representativeCell = latLngToCell(representative[1], representative[0], 10);
      if (
        !removed.has(representativeCell) &&
        !seeds.has(representativeCell) &&
        booleanPointInPolygon(point(representative), polygonFeature)
      ) {
        seeds.set(representativeCell, representative);
      }
    }

    for (const [id, center] of seeds) {
      const bikeMinutes = bikeConditions.length
        ? Math.max(
            ...bikeConditions.map((condition) =>
              bikeContexts[condition.id]
                ? (bikeContexts[condition.id]!.distances[nearestNode(this.graph, center)] ??
                  Number.POSITIVE_INFINITY)
                : Number.POSITIVE_INFINITY,
            ),
          )
        : null;
      const groceryMinutes = groceryConditions.length
        ? Math.max(
            ...groceryConditions.map((condition) =>
              nearestMinutes(
                center,
                this.places.groceries.filter(
                  (place) =>
                    condition.groceryType === 'supermarket_or_grocery' ||
                    place.type === 'supermarket',
                ),
              ),
            ),
          )
        : null;
      const parkMinutes = parkConditions.length ? nearestMinutes(center, this.places.parks) : null;
      const margins: Array<{ label: string; slack: number }> = [];
      for (const bike of bikeConditions) {
        const context = bikeContexts[bike.id];
        const minutes = context
          ? (context.distances[nearestNode(this.graph, center)] ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY;
        margins.push({
          label: 'bike commute',
          slack: (bike.maxMinutes - minutes) / bike.maxMinutes,
        });
      }
      for (const grocery of groceryConditions) {
        const minutes = nearestMinutes(
          center,
          this.places.groceries.filter(
            (place) =>
              grocery.groceryType === 'supermarket_or_grocery' || place.type === 'supermarket',
          ),
        );
        margins.push({
          label: 'grocery access',
          slack: (grocery.maxMinutes - minutes) / grocery.maxMinutes,
        });
      }
      for (const park of parkConditions) {
        const minutes = nearestMinutes(center, this.places.parks);
        margins.push({
          label: 'park access',
          slack: (park.maxMinutes - minutes) / park.maxMinutes,
        });
      }
      const normalized = margins.map(({ slack }) => Math.max(0, Math.min(1, slack)));
      const minimumSlack = normalized.length ? Math.min(...normalized) : 0;
      const averageSlack = normalized.length
        ? normalized.reduce((sum, value) => sum + value, 0) / normalized.length
        : 0;
      const weakest = margins.toSorted((a, b) => a.slack - b.slack)[0];
      const comfortable = margins.filter(({ slack }) => slack >= 0.25).map(({ label }) => label);
      scored.push({
        id,
        coordinates: center,
        score: minimumSlack * 0.7 + averageSlack * 0.3,
        minimumSlack,
        averageSlack,
        bikeMinutes: bikeMinutes !== null && Number.isFinite(bikeMinutes) ? bikeMinutes : null,
        groceryMinutes,
        parkMinutes,
        comfortable,
        closeToFailing: weakest && weakest.slack <= 0.1 ? weakest.label : null,
        tradeoff: weakest
          ? `Strong overall fit; ${weakest.label} has the least remaining margin.`
          : 'Inside the current preference area.',
      });
    }

    scored.sort(
      (a, b) =>
        b.minimumSlack - a.minimumSlack ||
        b.averageSlack - a.averageSlack ||
        a.id.localeCompare(b.id),
    );
    const selected: Candidate[] = [];
    for (const candidate of scored) {
      if (
        selected.every(
          (existing) =>
            distance(point(existing.coordinates), point(candidate.coordinates), {
              units: 'kilometers',
            }) >= 0.25,
        )
      ) {
        selected.push(candidate);
      }
      if (selected.length === 3) break;
    }
    for (const candidate of scored) {
      if (selected.length === 3) break;
      if (!selected.some(({ id }) => id === candidate.id)) selected.push(candidate);
    }
    return selected;
  }

  private restriction(
    canonical: CanonicalWorkspace,
    layers: Record<string, AreaGeometry>,
    feasible: AreaGeometry | null,
  ): RestrictionResult | null {
    if (canonical.conditions.length === 0) return null;
    const currentAreaKm2 = feasible ? area(feasible) / 1_000_000 : 0;
    const losses = canonical.conditions.map((condition) => {
      const otherLayers = canonical.conditions
        .filter(({ id }) => id !== condition.id)
        .map(({ id }) => layers[id]);
      const without = otherLayers.some((layer) => !layer)
        ? null
        : combineAreas(this.boundary, otherLayers as AreaGeometry[]);
      return {
        condition,
        loss: Math.max(0, (without ? area(without) / 1_000_000 : 0) - currentAreaKm2),
      };
    });
    losses.sort((a, b) => b.loss - a.loss || a.condition.id.localeCompare(b.condition.id));
    const strongest = losses[0];
    if (!strongest) return null;

    let relaxedAreaKm2: number | null = null;
    if (strongest.condition.kind !== 'preference') {
      const maxMinutes = strongest.condition.kind === 'bike' ? 90 : 45;
      if (strongest.condition.maxMinutes >= maxMinutes) {
        return {
          conditionId: strongest.condition.id,
          label: strongest.condition.label,
          areaLostKm2: strongest.loss,
          currentAreaKm2,
          relaxedAreaKm2: null,
          message: `${strongest.condition.label} is the strongest restriction and is already at the supported maximum.`,
        };
      }
      const relaxedCondition = {
        ...strongest.condition,
        maxMinutes: Math.min(maxMinutes, strongest.condition.maxMinutes + 5),
      } as Condition;
      const relaxedLayer = this.cachedConditionLayer(canonical, relaxedCondition).layer;
      const relaxedLayers = canonical.conditions.map((condition) =>
        condition.id === strongest.condition.id ? relaxedLayer : layers[condition.id],
      );
      const relaxed = relaxedLayers.some((layer) => !layer)
        ? null
        : combineAreas(this.boundary, relaxedLayers as AreaGeometry[]);
      relaxedAreaKm2 = relaxed ? area(relaxed) / 1_000_000 : 0;
    }

    return {
      conditionId: strongest.condition.id,
      label: strongest.condition.label,
      areaLostKm2: strongest.loss,
      currentAreaKm2,
      relaxedAreaKm2,
      message:
        strongest.condition.kind === 'preference'
          ? `${strongest.condition.label} is the strongest restriction. Edit the drawn boundary to explore more area.`
          : `${strongest.condition.label} is the strongest restriction. Adding five minutes would change the matching area from ${currentAreaKm2.toFixed(2)} km² to ${(relaxedAreaKm2 ?? 0).toFixed(2)} km².`,
    };
  }
}
