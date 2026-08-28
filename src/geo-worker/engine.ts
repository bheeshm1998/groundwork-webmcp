import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import buffer from '@turf/buffer';
import cleanCoords from '@turf/clean-coords';
import distance from '@turf/distance';
import intersect from '@turf/intersect';
import union from '@turf/union';
import { featureCollection, point } from '@turf/helpers';
import { cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell } from 'h3-js';
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
  try {
    const result = union(featureCollection(features));
    return result ? asArea(cleanCoords(result)) : null;
  } catch {
    return features[0] ?? null;
  }
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
  return safeIntersect(polygon, boundary) ?? polygon;
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

  analyze(canonical: CanonicalWorkspace): DerivedAnalysis {
    const layers: Record<string, AreaGeometry> = {};
    let bikeContext: BikeContext | undefined;
    for (const condition of canonical.conditions) {
      const result = this.computeConditionLayer(canonical, condition);
      if (result.layer) layers[condition.id] = result.layer;
      if (result.bike) bikeContext = result.bike;
    }

    const feasibleRegion = canonical.combined
      ? combineAreas(
          this.boundary,
          canonical.conditions
            .map((condition) => layers[condition.id])
            .filter(Boolean) as AreaGeometry[],
        )
      : null;
    const feasibleAreaKm2 = feasibleRegion ? area(feasibleRegion) / 1_000_000 : 0;
    const candidates = feasibleRegion ? this.rank(canonical, feasibleRegion, bikeContext) : [];
    const restriction =
      feasibleRegion || canonical.combined
        ? this.restriction(canonical, layers, feasibleRegion)
        : null;
    return { layers, feasibleRegion, feasibleAreaKm2, candidates, restriction };
  }

  private rank(
    canonical: CanonicalWorkspace,
    feasible: AreaGeometry,
    bikeContext?: BikeContext,
  ): Candidate[] {
    const bike = canonical.conditions.find(
      (condition): condition is Extract<Condition, { kind: 'bike' }> => condition.kind === 'bike',
    );
    const grocery = canonical.conditions.find(
      (condition): condition is Extract<Condition, { kind: 'access' }> =>
        condition.kind === 'access' && condition.category === 'grocery',
    );
    const park = canonical.conditions.find(
      (condition): condition is Extract<Condition, { kind: 'access' }> =>
        condition.kind === 'access' && condition.category === 'park',
    );
    const removed = new Set(canonical.removedCandidateIds);
    const seen = new Set<string>();
    const scored: Candidate[] = [];

    for (let lat = 37.715; lat <= 37.81; lat += 0.004) {
      for (let lng = -122.505; lng <= -122.36; lng += 0.004) {
        const coordinate: Coordinate = [lng, lat];
        if (!booleanPointInPolygon(point(coordinate), feasible)) continue;
        const id = latLngToCell(lat, lng, 10);
        if (seen.has(id) || removed.has(id)) continue;
        seen.add(id);
        const [cellLat, cellLng] = cellToLatLng(id);
        const center: Coordinate = [cellLng, cellLat];
        const bikeMinutes = bikeContext
          ? (bikeContext.distances[nearestNode(this.graph, center)] ?? Number.POSITIVE_INFINITY)
          : null;
        const groceryMinutes = grocery ? nearestMinutes(center, this.places.groceries) : null;
        const parkMinutes = park ? nearestMinutes(center, this.places.parks) : null;
        const margins: Array<{ label: string; slack: number }> = [];
        if (bike && bikeMinutes !== null)
          margins.push({
            label: 'bike commute',
            slack: (bike.maxMinutes - bikeMinutes) / bike.maxMinutes,
          });
        if (grocery && groceryMinutes !== null)
          margins.push({
            label: 'grocery access',
            slack: (grocery.maxMinutes - groceryMinutes) / grocery.maxMinutes,
          });
        if (park && parkMinutes !== null)
          margins.push({
            label: 'park access',
            slack: (park.maxMinutes - parkMinutes) / park.maxMinutes,
          });
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
        .map(({ id }) => layers[id])
        .filter(Boolean) as AreaGeometry[];
      const without = combineAreas(this.boundary, otherLayers);
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
      const relaxedCondition = {
        ...strongest.condition,
        maxMinutes: strongest.condition.maxMinutes + 5,
      } as Condition;
      const relaxedLayer = this.computeConditionLayer(canonical, relaxedCondition).layer;
      const relaxedLayers = canonical.conditions
        .map((condition) =>
          condition.id === strongest.condition.id ? relaxedLayer : layers[condition.id],
        )
        .filter(Boolean) as AreaGeometry[];
      const relaxed = combineAreas(this.boundary, relaxedLayers);
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
