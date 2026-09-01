import { describe, expect, it } from 'vitest';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
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
  groceries: [
    {
      id: 'g1',
      name: 'Supermarket',
      coordinates: [-122.415, 37.765] as [number, number],
      type: 'supermarket' as const,
    },
  ],
  parks: [{ id: 'p1', name: 'Park', coordinates: [-122.42, 37.77] as [number, number] }],
  search: [],
};

function workspace(): CanonicalWorkspace {
  return {
    office: { label: 'Office', coordinates: [-122.4, 37.79] },
    conditions: [
      { id: 'bike', kind: 'bike', label: '25-minute bicycle area', visible: true, maxMinutes: 25 },
      {
        id: 'grocery',
        kind: 'access',
        category: 'grocery',
        label: '10-minute grocery access',
        visible: true,
        maxMinutes: 10,
        groceryType: 'supermarket',
      },
      {
        id: 'park',
        kind: 'access',
        category: 'park',
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
      groceries: [
        {
          id: 'grocery-only',
          name: 'Small grocery',
          coordinates: [-122.415, 37.765] as [number, number],
          type: 'grocery' as const,
        },
      ],
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
        groceries: [
          ...places.groceries,
          {
            id: 'g2',
            name: 'Nearby grocery',
            coordinates: [-122.42, 37.77] as [number, number],
            type: 'grocery' as const,
          },
        ],
      },
      boundary,
    ).analyze(workspace());

    expect(withNearbyGrocery.candidates.map(({ groceryMinutes }) => groceryMinutes)).toEqual(
      baseline.candidates.map(({ groceryMinutes }) => groceryMinutes),
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
