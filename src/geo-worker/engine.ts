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
} from '../domain/schemas';
import {
  dijkstra,
  multiSourceDijkstra,
  nearestNode,
  nearestNodeForMode,
  reverseGraph,
  type GraphData,
  type TravelMode,
} from './graph';

export interface PlaceRecord {
  id: string;
  name: string;
  coordinates: Coordinate;
  accessPoints?: Coordinate[];
  type?: 'supermarket' | 'grocery' | 'convenience';
}

export interface PlacesData {
  groceries: PlaceRecord[];
  parks: PlaceRecord[];
  search: Array<{ id: string; label: string; coordinates: Coordinate; kind: 'poi' | 'street' }>;
}

interface BikeContext {
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
  const weights = mode === 'bike' ? graph.bikeWeights : graph.walkWeights;
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
  private readonly reverseBikeGraph: GraphData;
  private readonly nodeBuckets = new Map<string, number[]>();
  private readonly conditionCache = new Map<
    string,
    { layer: AreaGeometry | null; bike?: BikeContext; access?: AccessContext }
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
    this.reverseBikeGraph = reverseGraph(graph);
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
  ): { layer: AreaGeometry | null; bike?: BikeContext; access?: AccessContext } {
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
      const originPlaces: PlaceRecord[] = [];
      const origins = places.flatMap((place) =>
        (place.accessPoints?.length ? place.accessPoints : [place.coordinates]).map(
          (coordinate) => {
            originPlaces.push(place);
            return nearestNodeForMode(this.graph, coordinate, 'walk');
          },
        ),
      );
      const access = {
        ...multiSourceDijkstra(this.graph, origins, condition.maxMinutes, 'walk'),
        places: originPlaces,
      };
      return {
        layer: makeNetworkArea(
          this.graph,
          access.distances,
          condition.maxMinutes,
          'walk',
          this.boundary,
        ),
        access,
      };
    }
    if (!canonical.office) return { layer: null };
    const origin = nearestNodeForMode(this.reverseBikeGraph, canonical.office.coordinates, 'bike');
    const distances = dijkstra(this.reverseBikeGraph, origin, condition.maxMinutes);
    return {
      layer: makeNetworkArea(
        this.reverseBikeGraph,
        distances,
        condition.maxMinutes,
        'bike',
        this.boundary,
      ),
      bike: { distances },
    };
  }

  private cachedConditionLayer(
    canonical: CanonicalWorkspace,
    condition: Condition,
  ): { layer: AreaGeometry | null; bike?: BikeContext; access?: AccessContext } {
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
    const accessContexts: Record<string, AccessContext> = {};
    for (const condition of canonical.conditions) {
      const result = this.cachedConditionLayer(canonical, condition);
      if (result.layer) layers[condition.id] = result.layer;
      if (result.bike) bikeContexts[condition.id] = result.bike;
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
      ? this.rank(canonical, feasibleRegion, bikeContexts, accessContexts)
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
    bikeContexts: Record<string, BikeContext>,
    accessContexts: Record<string, AccessContext>,
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
            ...bikeConditions.map((condition) => {
              const context = bikeContexts[condition.id];
              const node = context ? this.nearestReachedNode(center, context.distances) : -1;
              return node >= 0 ? context!.distances[node]! : Number.POSITIVE_INFINITY;
            }),
          )
        : null;
      const groceryAccess = groceryConditions[0]
        ? accessContexts[groceryConditions[0].id]
        : undefined;
      const parkAccess = parkConditions[0] ? accessContexts[parkConditions[0].id] : undefined;
      const groceryNode = groceryAccess
        ? this.nearestReachedNode(center, groceryAccess.distances)
        : -1;
      const parkNode = parkAccess ? this.nearestReachedNode(center, parkAccess.distances) : -1;
      const groceryMinutes = groceryNode >= 0 ? groceryAccess!.distances[groceryNode]! : null;
      const parkMinutes = parkNode >= 0 ? parkAccess!.distances[parkNode]! : null;
      const groceryOwner = groceryNode >= 0 ? groceryAccess!.owners[groceryNode]! : -1;
      const parkOwner = parkNode >= 0 ? parkAccess!.owners[parkNode]! : -1;
      const nearestGrocery =
        groceryOwner >= 0 ? (groceryAccess?.places[groceryOwner]?.name ?? null) : null;
      const nearestPark = parkOwner >= 0 ? (parkAccess?.places[parkOwner]?.name ?? null) : null;
      const margins: Array<{ label: string; slack: number }> = [];
      for (const bike of bikeConditions) {
        const context = bikeContexts[bike.id];
        const node = context ? this.nearestReachedNode(center, context.distances) : -1;
        const minutes = node >= 0 ? context!.distances[node]! : Number.POSITIVE_INFINITY;
        margins.push({
          label: 'bike commute',
          slack: (bike.maxMinutes - minutes) / bike.maxMinutes,
        });
      }
      for (const grocery of groceryConditions) {
        const context = accessContexts[grocery.id];
        const node = context ? this.nearestReachedNode(center, context.distances) : -1;
        const minutes = node >= 0 ? context!.distances[node]! : Number.POSITIVE_INFINITY;
        margins.push({
          label: 'grocery access',
          slack: (grocery.maxMinutes - minutes) / grocery.maxMinutes,
        });
      }
      for (const park of parkConditions) {
        const context = accessContexts[park.id];
        const node = context ? this.nearestReachedNode(center, context.distances) : -1;
        const minutes = node >= 0 ? context!.distances[node]! : Number.POSITIVE_INFINITY;
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
        name: '',
        coordinates: center,
        score: minimumSlack * 0.7 + averageSlack * 0.3,
        minimumSlack,
        averageSlack,
        bikeMinutes: bikeMinutes !== null && Number.isFinite(bikeMinutes) ? bikeMinutes : null,
        groceryMinutes:
          groceryMinutes !== null && Number.isFinite(groceryMinutes) ? groceryMinutes : null,
        parkMinutes: parkMinutes !== null && Number.isFinite(parkMinutes) ? parkMinutes : null,
        nearestGrocery,
        nearestPark,
        comfortable,
        closeToFailing: weakest && weakest.slack <= 0.1 ? weakest.label : null,
        tradeoff: weakest
          ? `${weakest.label} has the least remaining margin${nearestGrocery ? `; nearest grocery is ${nearestGrocery}` : ''}${nearestPark ? ` and nearest park is ${nearestPark}` : ''}.`
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
