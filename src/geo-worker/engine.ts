import area from '@turf/area';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import cleanCoords from '@turf/clean-coords';
import distance from '@turf/distance';
import intersect from '@turf/intersect';
import pointOnFeature from '@turf/point-on-feature';
import { featureCollection, point } from '@turf/helpers';
import {
  cellToLatLng,
  cellsToMultiPolygon,
  gridDisk,
  gridPathCells,
  latLngToCell,
  polygonToCells,
} from 'h3-js';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type {
  AreaGeometry,
  Candidate,
  CanonicalWorkspace,
  Condition,
  Coordinate,
  DerivedAnalysis,
  RestrictionResult,
  PlaceCategory,
  TravelMode,
} from '../domain/schemas';
import {
  dijkstra,
  multiSourceDijkstra,
  nearestNode,
  nearestNodeForMode,
  reverseGraph,
  weightsForMode,
  type GraphData,
} from './graph';

export interface PlaceRecord {
  id: string;
  name: string;
  coordinates: Coordinate;
  accessPoints?: Coordinate[];
  type?: 'supermarket' | 'grocery' | 'convenience';
}

export interface PlacesData {
  categories: Record<PlaceCategory, PlaceRecord[]>;
  search: Array<{ id: string; label: string; coordinates: Coordinate; kind: 'poi' | 'street' }>;
}

interface TravelContext {
  distances: Float32Array;
}

interface AccessContext {
  distances: Float32Array;
  owners: Int32Array;
  places: PlaceRecord[];
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

function combineAreas(boundary: AreaGeometry, features: AreaGeometry[]): AreaGeometry | null {
  let current: AreaGeometry | null = boundary;
  for (const feature of features) {
    current = current ? safeIntersect(current, feature) : null;
    if (!current) return null;
  }
  return current;
}

function makeNetworkArea(
  graph: GraphData,
  distances: Float32Array,
  cutoffMinutes: number,
  mode: TravelMode,
  boundary: AreaGeometry,
): AreaGeometry | null {
  const cells = new Set<string>();
  const coveredSegments = new Set<string>();
  const weights = weightsForMode(graph, mode);
  for (let index = 0; index < distances.length; index += 1) {
    const reachedAt = distances[index]!;
    if (!Number.isFinite(reachedAt)) continue;
    for (let edge = graph.offsets[index]!; edge < graph.offsets[index + 1]!; edge += 1) {
      const weight = weights[edge]!;
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const target = graph.targets[edge]!;
      const fraction = Math.max(0, Math.min(1, (cutoffMinutes - reachedAt) / weight));
      if (fraction <= 0) continue;
      const from: Coordinate = [graph.lng[index]!, graph.lat[index]!];
      const to: Coordinate = [graph.lng[target]!, graph.lat[target]!];
      const partial: Coordinate = [
        from[0] + (to[0] - from[0]) * fraction,
        from[1] + (to[1] - from[1]) * fraction,
      ];
      const startCell = latLngToCell(from[1], from[0], 10);
      const endCell = latLngToCell(partial[1], partial[0], 10);
      if (fraction === 1) {
        const segmentKey =
          startCell < endCell ? `${startCell}:${endCell}` : `${endCell}:${startCell}`;
        if (coveredSegments.has(segmentKey)) continue;
        coveredSegments.add(segmentKey);
      }
      let path: string[];
      try {
        path = gridPathCells(startCell, endCell);
      } catch {
        const segmentKm = distance(point(from), point(partial), { units: 'kilometers' });
        const samples = Math.max(1, Math.ceil(segmentKm / 0.08));
        path = Array.from({ length: samples + 1 }, (_, sample) => {
          const progress = sample / samples;
          return latLngToCell(
            from[1] + (partial[1] - from[1]) * progress,
            from[0] + (partial[0] - from[0]) * progress,
            10,
          );
        });
      }
      for (const cell of path) {
        for (const nearby of gridDisk(cell, 1)) cells.add(nearby);
      }
    }
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

export class GeoEngine {
  readonly graph: GraphData;
  private readonly reverseTravelGraph: GraphData;
  private readonly nodeBuckets = new Map<string, number[]>();
  private readonly conditionCache = new Map<
    string,
    { layer: AreaGeometry | null; travel?: TravelContext; access?: AccessContext }
  >();

  constructor(
    graph: GraphData,
    readonly places: PlacesData,
    readonly boundary: AreaGeometry,
    readonly neighborhoods: FeatureCollection<Polygon | MultiPolygon> = {
      type: 'FeatureCollection',
      features: [],
    },
    readonly nodeLabels: Array<string | null> = [],
  ) {
    this.graph = graph;
    this.reverseTravelGraph = reverseGraph(graph);
    for (let index = 0; index < graph.lng.length; index += 1) {
      const cell = latLngToCell(graph.lat[index]!, graph.lng[index]!, 10);
      const bucket = this.nodeBuckets.get(cell);
      if (bucket) bucket.push(index);
      else this.nodeBuckets.set(cell, [index]);
    }
  }

  containsCoordinate(coordinate: Coordinate): boolean {
    return booleanPointInPolygon(point(coordinate), this.boundary);
  }

  private nearestReachedNode(coordinate: Coordinate, distances: Float32Array): number {
    const origin = latLngToCell(coordinate[1], coordinate[0], 10);
    const visited = new Set<string>();
    let closest = -1;
    let closestSquared = Number.POSITIVE_INFINITY;
    let firstMatchRadius = -1;
    const lngScale = Math.cos(coordinate[1] * (Math.PI / 180));
    for (let radius = 0; radius <= 6; radius += 1) {
      let cells: string[];
      try {
        cells = gridDisk(origin, radius);
      } catch {
        break;
      }
      for (const cell of cells) {
        if (visited.has(cell)) continue;
        visited.add(cell);
        for (const index of this.nodeBuckets.get(cell) ?? []) {
          if (!Number.isFinite(distances[index]!)) continue;
          const dx = (this.graph.lng[index]! - coordinate[0]) * lngScale;
          const dy = this.graph.lat[index]! - coordinate[1];
          const squared = dx * dx + dy * dy;
          if (squared < closestSquared) {
            closestSquared = squared;
            closest = index;
          }
        }
      }
      if (closest >= 0) {
        if (firstMatchRadius < 0) firstMatchRadius = radius;
        else if (radius > firstMatchRadius) return closest;
      }
    }

    // Feasible points normally find a road node in the first two rings. Retain
    // a correctness fallback for disconnected or unusually sparse datasets.
    for (let index = 0; index < distances.length; index += 1) {
      if (!Number.isFinite(distances[index]!)) continue;
      const dx = (this.graph.lng[index]! - coordinate[0]) * lngScale;
      const dy = this.graph.lat[index]! - coordinate[1];
      const squared = dx * dx + dy * dy;
      if (squared < closestSquared) {
        closestSquared = squared;
        closest = index;
      }
    }
    return closest;
  }

  private computeConditionLayer(
    canonical: CanonicalWorkspace,
    condition: Condition,
  ): { layer: AreaGeometry | null; travel?: TravelContext; access?: AccessContext } {
    if (condition.kind === 'preference') {
      return { layer: safeIntersect(condition.geometry as AreaGeometry, this.boundary) };
    }
    if (condition.kind === 'access') {
      const categoryPlaces = this.places.categories[condition.category];
      const places =
        condition.category === 'grocery'
          ? categoryPlaces.filter(
              (place) =>
                condition.groceryType === 'supermarket_or_grocery' || place.type === 'supermarket',
            )
          : categoryPlaces;
      const originPlaces: PlaceRecord[] = [];
      const origins = places.flatMap((place) =>
        (place.accessPoints?.length ? place.accessPoints : [place.coordinates]).map(
          (coordinate) => {
            originPlaces.push(place);
            return nearestNodeForMode(this.reverseTravelGraph, coordinate, condition.mode);
          },
        ),
      );
      const access = {
        ...multiSourceDijkstra(
          this.reverseTravelGraph,
          origins,
          condition.maxMinutes,
          condition.mode,
        ),
        places: originPlaces,
      };
      return {
        layer: makeNetworkArea(
          this.reverseTravelGraph,
          access.distances,
          condition.maxMinutes,
          condition.mode,
          this.boundary,
        ),
        access,
      };
    }
    const destination = canonical.destinations.find(({ id }) => id === condition.destinationId);
    if (!destination) return { layer: null };
    const origin = nearestNodeForMode(
      this.reverseTravelGraph,
      destination.coordinates,
      condition.mode,
    );
    const distances = dijkstra(
      this.reverseTravelGraph,
      origin,
      condition.maxMinutes,
      condition.mode,
    );
    return {
      layer: makeNetworkArea(
        this.reverseTravelGraph,
        distances,
        condition.maxMinutes,
        condition.mode,
        this.boundary,
      ),
      travel: { distances },
    };
  }

  private cachedConditionLayer(
    canonical: CanonicalWorkspace,
    condition: Condition,
  ): { layer: AreaGeometry | null; travel?: TravelContext; access?: AccessContext } {
    const key = JSON.stringify({
      condition,
      destination:
        condition.kind === 'travel'
          ? canonical.destinations.find(({ id }) => id === condition.destinationId)?.coordinates
          : undefined,
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
    const travelContexts: Record<string, TravelContext> = {};
    const accessContexts: Record<string, AccessContext> = {};
    for (const condition of canonical.conditions) {
      const result = this.cachedConditionLayer(canonical, condition);
      if (result.layer) layers[condition.id] = result.layer;
      if (result.travel) travelContexts[condition.id] = result.travel;
      if (result.access) accessContexts[condition.id] = result.access;
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
    const candidates = feasibleRegion
      ? this.rank(canonical, feasibleRegion, travelContexts, accessContexts)
      : [];
    const restriction =
      feasibleRegion || canonical.combined
        ? this.restriction(canonical, layers, feasibleRegion)
        : null;
    return { layers, feasibleRegion, feasibleAreaKm2, candidates, restriction };
  }

  private rank(
    canonical: CanonicalWorkspace,
    feasible: AreaGeometry,
    travelContexts: Record<string, TravelContext>,
    accessContexts: Record<string, AccessContext>,
  ): Candidate[] {
    const measurableConditions = canonical.conditions.filter(
      (condition): condition is Exclude<Condition, { kind: 'preference' }> =>
        condition.kind !== 'preference',
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
      const metrics = measurableConditions.flatMap((condition) => {
        if (condition.kind === 'travel') {
          const context = travelContexts[condition.id];
          const node = context ? this.nearestReachedNode(center, context.distances) : -1;
          const minutes = node >= 0 && context ? context.distances[node] : undefined;
          if (minutes === undefined || !Number.isFinite(minutes)) return [];
          return [
            {
              conditionId: condition.id,
              label: condition.label,
              minutes,
              nearestPlaceName: null,
              slack: (condition.maxMinutes - minutes) / condition.maxMinutes,
            },
          ];
        }
        const context = accessContexts[condition.id];
        const node = context ? this.nearestReachedNode(center, context.distances) : -1;
        if (!context || node < 0) return [];
        const minutes = context.distances[node];
        if (minutes === undefined || !Number.isFinite(minutes)) return [];
        const owner = context.owners[node];
        return [
          {
            conditionId: condition.id,
            label: condition.label,
            minutes,
            nearestPlaceName:
              owner !== undefined && owner >= 0 ? (context.places[owner]?.name ?? null) : null,
            slack: (condition.maxMinutes - minutes) / condition.maxMinutes,
          },
        ];
      });
      if (metrics.length !== measurableConditions.length) continue;
      const normalized = metrics.map(({ slack }) => Math.max(0, Math.min(1, slack)));
      const minimumSlack = normalized.length ? Math.min(...normalized) : 0;
      const averageSlack = normalized.length
        ? normalized.reduce((sum, value) => sum + value, 0) / normalized.length
        : 0;
      const weakest = metrics.toSorted((a, b) => a.slack - b.slack)[0];
      const comfortable = metrics.filter(({ slack }) => slack >= 0.25).map(({ label }) => label);
      scored.push({
        id,
        name: '',
        coordinates: center,
        score: minimumSlack * 0.7 + averageSlack * 0.3,
        minimumSlack,
        averageSlack,
        metrics,
        comfortable,
        closeToFailing: weakest && weakest.slack <= 0.1 ? weakest.label : null,
        tradeoff: weakest
          ? `${weakest.label} has the least remaining margin${weakest.nearestPlaceName ? `; nearest matching place is ${weakest.nearestPlaceName}` : ''}.`
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
            }) >= 0.3,
        )
      ) {
        selected.push(candidate);
      }
      if (selected.length === 3) break;
    }
    for (const candidate of selected) candidate.name = this.candidateName(candidate.coordinates);
    return selected;
  }

  private candidateName(coordinate: Coordinate) {
    const neighborhood = this.neighborhoods.features.find((feature) =>
      booleanPointInPolygon(point(coordinate), feature),
    )?.properties?.nhood as string | undefined;
    let nearestLabel: string | null = null;
    let nearestSquared = Number.POSITIVE_INFINITY;
    const lngScale = Math.cos(coordinate[1] * (Math.PI / 180));
    for (let index = 0; index < this.nodeLabels.length; index += 1) {
      const label = this.nodeLabels[index];
      if (!label?.includes(' & ')) continue;
      const dx = (this.graph.lng[index]! - coordinate[0]) * lngScale;
      const dy = this.graph.lat[index]! - coordinate[1];
      const squared = dx * dx + dy * dy;
      if (squared < nearestSquared) {
        nearestSquared = squared;
        nearestLabel = label;
      }
    }
    if (!nearestLabel) nearestLabel = this.nodeLabels[nearestNode(this.graph, coordinate)] ?? null;
    return [neighborhood, nearestLabel ? `near ${nearestLabel}` : null].filter(Boolean).join(' — ');
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
    if (strongest.loss < 0.000_001 && canonical.conditions.length > 1) {
      return {
        conditionId: 'combined',
        label: 'Combined priorities',
        areaLostKm2: 0,
        currentAreaKm2,
        relaxedAreaKm2: null,
        message:
          'No single priority is the limiting factor; the current result comes from their combined overlap.',
      };
    }

    let relaxedAreaKm2: number | null = null;
    if (strongest.condition.kind !== 'preference') {
      const maxMinutes = strongest.condition.kind === 'travel' ? 90 : 45;
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
