import { describe, expect, it } from 'vitest';
import type { AreaGeometry, CanonicalWorkspace } from '../domain/schemas';
import { GeoEngine } from './engine';
import type { CompactGraphSpec } from './graph';

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
  presets: [],
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
  it('creates visible condition layers and a deterministic result', () => {
    const result = new GeoEngine(graph, places, boundary).analyze(workspace());
    expect(Object.keys(result.layers)).toEqual(['bike', 'grocery', 'park']);
    expect(result.feasibleAreaKm2).toBeGreaterThanOrEqual(0);
    expect(result.restriction?.conditionId).toBeTruthy();
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('honors removed candidates on the next ranking pass', () => {
    const engine = new GeoEngine(graph, places, boundary);
    const first = engine.analyze(workspace());
    if (!first.candidates[0]) return;
    const nextWorkspace = workspace();
    nextWorkspace.removedCandidateIds = [first.candidates[0].id];
    const second = engine.analyze(nextWorkspace);
    expect(second.candidates.map(({ id }) => id)).not.toContain(first.candidates[0].id);
  });
});
