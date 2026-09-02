import { describe, expect, it } from 'vitest';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import area from '@turf/area';
import intersect from '@turf/intersect';
import { point } from '@turf/helpers';
import { featureCollection } from '@turf/helpers';
import type { AreaGeometry, CanonicalWorkspace } from '../domain/schemas';
import { GeoEngine } from './engine';
import { loadGraph, type CompactGraphSpec } from './graph';

const graph: CompactGraphSpec = {
  format: 'compact-grid-v1',
  minLng: -122.46,
  maxLng: -122.38,
  minLat: 37.73,
  maxLat: 37.8,
  columns: 12,
  rows: 12,
  bikeSpeedKph: 15,
  blocked: [],
};

const boundary: AreaGeometry = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.47, 37.72],
        [-122.37, 37.72],
        [-122.37, 37.81],
        [-122.47, 37.81],
        [-122.47, 37.72],
      ],
    ],
  },
};

const places = {
  categories: {
    grocery: [
      {
        id: 'g1',
        name: 'Supermarket',
        coordinates: [-122.415, 37.765] as [number, number],
        type: 'supermarket' as const,
      },
    ],
    school: [{ id: 's1', name: 'School', coordinates: [-122.425, 37.77] as [number, number] }],
    healthcare: [{ id: 'h1', name: 'Clinic', coordinates: [-122.42, 37.765] as [number, number] }],
    park: [{ id: 'p1', name: 'Park', coordinates: [-122.42, 37.77] as [number, number] }],
    cinema: [{ id: 'c1', name: 'Cinema', coordinates: [-122.41, 37.77] as [number, number] }],
  },
  search: [],
};

function workspace(): CanonicalWorkspace {
  return {
    destinations: [{ id: 'office', label: 'Office', coordinates: [-122.4, 37.79] }],
    conditions: [
      {
        id: 'bike',
        kind: 'travel',
        destinationId: 'office',
        mode: 'bike',
        label: '25-minute bike ride to Office',
        visible: true,
        maxMinutes: 25,
      },
      {
        id: 'grocery',
        kind: 'access',
        category: 'grocery',
        mode: 'walk',
        label: '10-minute grocery access',
        visible: true,
        maxMinutes: 10,
        groceryType: 'supermarket',
      },
      {
        id: 'park',
        kind: 'access',
        category: 'park',
        mode: 'walk',
        label: '8-minute park access',
        visible: true,
        maxMinutes: 8,
      },
    ],
    selectedCandidateId: null,
    removedCandidateIds: [],
    view: { center: [-122.42, 37.77], zoom: 12, bearing: 0, pitch: 0 },
    combined: true,
  };
}

describe('GeoEngine', () => {
  it('builds one connected bicycle polygon by interpolating reachable edge cutoffs', () => {
    const bikeOnly = workspace();
    bikeOnly.conditions = [bikeOnly.conditions[0]!];
    bikeOnly.combined = false;
    const result = new GeoEngine(loadGraph(graph), places, boundary).analyze(bikeOnly);
    const layer = result.layers.bike!;

    expect(layer).toBeDefined();
    expect(layer.geometry.type === 'Polygon' || layer.geometry.coordinates.length === 1).toBe(true);
  });

  it('creates visible condition layers and a deterministic result', () => {
    const result = new GeoEngine(loadGraph(graph), places, boundary).analyze(workspace());
    expect(Object.keys(result.layers)).toEqual(['bike', 'grocery', 'park']);
    expect(result.feasibleAreaKm2).toBeGreaterThanOrEqual(0);
    expect(result.restriction?.conditionId).toBeTruthy();
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('keeps two conditions of the same category in the feasible analysis and metrics', () => {
    const twoSchools = workspace();
    twoSchools.conditions = [
      {
        id: 'school-near',
        kind: 'access',
        category: 'school',
        mode: 'walk',
        label: '10-minute walk to schools',
        visible: true,
        maxMinutes: 10,
      },
      {
        id: 'school-wide',
        kind: 'access',
        category: 'school',
        mode: 'bike',
        label: '20-minute bike ride to schools',
        visible: true,
        maxMinutes: 20,
      },
    ];
    const result = new GeoEngine(loadGraph(graph), places, boundary).analyze(twoSchools);

    expect(Object.keys(result.layers)).toEqual(['school-near', 'school-wide']);
    expect(result.feasibleRegion).not.toBeNull();
    for (const candidate of result.candidates) {
      expect(candidate.metrics.map(({ conditionId }) => conditionId)).toEqual([
        'school-near',
        'school-wide',
      ]);
    }
  });

  it('intersects travel areas from two destinations', () => {
    const twoDestinations = workspace();
    twoDestinations.destinations = [
      { id: 'north', label: 'North', coordinates: [-122.4, 37.79] },
      { id: 'south', label: 'South', coordinates: [-122.44, 37.74] },
    ];
    twoDestinations.conditions = [
      {
        id: 'north-trip',
        kind: 'travel',
        destinationId: 'north',
        mode: 'car',
        label: '20-minute drive to North',
        visible: true,
        maxMinutes: 20,
      },
      {
        id: 'south-trip',
        kind: 'travel',
        destinationId: 'south',
        mode: 'bike',
        label: '20-minute bike ride to South',
        visible: true,
        maxMinutes: 20,
      },
    ];
    const result = new GeoEngine(loadGraph(graph), places, boundary).analyze(twoDestinations);
    const northLayer = result.layers['north-trip'];
    const southLayer = result.layers['south-trip'];

    expect(northLayer).toBeDefined();
    expect(southLayer).toBeDefined();
    if (!northLayer || !southLayer) return;
    const expected = intersect(featureCollection([northLayer, southLayer]));
    expect(result.feasibleRegion).not.toBeNull();
    expect(result.feasibleRegion ? area(result.feasibleRegion) : 0).toBeCloseTo(
      expected ? area(expected) : 0,
      4,
    );
  });

  it('honors removed candidates on the next ranking pass', () => {
    const engine = new GeoEngine(loadGraph(graph), places, boundary);
    const first = engine.analyze(workspace());
    if (!first.candidates[0]) return;
    const nextWorkspace = workspace();
    nextWorkspace.removedCandidateIds = [first.candidates[0].id];
    const second = engine.analyze(nextWorkspace);
    expect(second.candidates.map(({ id }) => id)).not.toContain(first.candidates[0].id);
  });

  it('fails closed when any hard condition cannot produce a layer', () => {
    const noSupermarkets = {
      ...places,
      categories: {
        ...places.categories,
        grocery: [
          {
            id: 'grocery-only',
            name: 'Small grocery',
            coordinates: [-122.415, 37.765] as [number, number],
            type: 'grocery' as const,
          },
        ],
      },
    };
    const result = new GeoEngine(loadGraph(graph), noSupermarkets, boundary).analyze(workspace());

    expect(result.layers.grocery).toBeUndefined();
    expect(result.feasibleRegion).toBeNull();
    expect(result.feasibleAreaKm2).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('uses only supermarkets for supermarket candidate metrics', () => {
    const baseline = new GeoEngine(loadGraph(graph), places, boundary).analyze(workspace());
    const withNearbyGrocery = new GeoEngine(
      loadGraph(graph),
      {
        ...places,
        categories: {
          ...places.categories,
          grocery: [
            ...places.categories.grocery,
            {
              id: 'g2',
              name: 'Nearby grocery',
              coordinates: [-122.42, 37.77] as [number, number],
              type: 'grocery' as const,
            },
          ],
        },
      },
      boundary,
    ).analyze(workspace());

    expect(
      withNearbyGrocery.candidates.map((candidate) =>
        candidate.metrics.find(({ conditionId }) => conditionId === 'grocery'),
      ),
    ).toEqual(
      baseline.candidates.map((candidate) =>
        candidate.metrics.find(({ conditionId }) => conditionId === 'grocery'),
      ),
    );
  });

  it('returns an interior candidate for a feasible region smaller than an H3 cell', () => {
    const tiny = workspace();
    tiny.conditions = [
      {
        id: 'preference',
        kind: 'preference',
        label: 'Tiny preference',
        visible: true,
        geometry: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.4202, 37.7698],
                [-122.4198, 37.7698],
                [-122.4198, 37.7702],
                [-122.4202, 37.7702],
                [-122.4202, 37.7698],
              ],
            ],
          },
        },
      },
      {
        id: 'park',
        kind: 'access',
        category: 'park',
        mode: 'walk',
        label: '45-minute park access',
        visible: true,
        maxMinutes: 45,
      },
    ];
    const result = new GeoEngine(loadGraph(graph), places, boundary).analyze(tiny);

    expect(result.feasibleAreaKm2).toBeGreaterThan(0);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(booleanPointInPolygon(point(candidate.coordinates), result.feasibleRegion!)).toBe(
        true,
      );
    }
  });

  it('names candidates from the containing DataSF neighborhood and nearest named cross-street', () => {
    const neighborhoods = {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { nhood: 'Mission' },
          geometry: boundary.geometry,
        },
      ],
    };
    const labels = new Array(loadGraph(graph).lng.length).fill(null) as Array<string | null>;
    labels[55] = 'Valencia Street & 18th Street';
    const result = new GeoEngine(loadGraph(graph), places, boundary, neighborhoods, labels).analyze(
      workspace(),
    );

    expect(result.candidates[0]?.name).toMatch(/^Mission — near Valencia Street & 18th Street$/u);
  });
});
