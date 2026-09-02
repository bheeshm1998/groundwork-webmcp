import { describe, expect, it } from 'vitest';
import { CanonicalWorkspaceSchema, DestinationSchema, PolygonFeatureSchema } from './schemas';
import { EMPTY_CANONICAL } from './defaults';

describe('workspace schemas', () => {
  it('accepts global destination coordinates and rejects invalid longitude/latitude values', () => {
    expect(
      DestinationSchema.parse({ id: 'hyd', label: 'Hyderabad', coordinates: [78.4867, 17.385] }),
    ).toEqual({
      id: 'hyd',
      label: 'Hyderabad',
      coordinates: [78.4867, 17.385],
    });
    expect(() =>
      DestinationSchema.parse({ id: 'bad', label: 'Invalid', coordinates: [181, 91] }),
    ).toThrow();
  });

  it('rejects combined workspaces with too few conditions and accepts duplicate categories', () => {
    expect(() =>
      CanonicalWorkspaceSchema.parse({
        ...EMPTY_CANONICAL,
        combined: true,
        conditions: [
          {
            id: 'park',
            kind: 'access',
            category: 'park',
            mode: 'walk',
            label: 'Park',
            visible: true,
            maxMinutes: 8,
          },
        ],
      }),
    ).toThrow();
    expect(
      CanonicalWorkspaceSchema.parse({
        ...EMPTY_CANONICAL,
        conditions: [
          {
            id: 'park-1',
            kind: 'access',
            category: 'park',
            mode: 'walk',
            label: 'Park 1',
            visible: true,
            maxMinutes: 8,
          },
          {
            id: 'park-2',
            kind: 'access',
            category: 'park',
            mode: 'bike',
            label: 'Park 2',
            visible: true,
            maxMinutes: 10,
          },
        ],
      }).conditions,
    ).toHaveLength(2);
  });

  it('rejects unclosed and oversized preference geometry', () => {
    expect(() =>
      PolygonFeatureSchema.parse({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
          ],
        },
      }),
    ).toThrow();

    const ring = Array.from({ length: 500 }, (_, index) => [index / 1_000, 0]);
    ring.push(ring[0]!);
    expect(() =>
      PolygonFeatureSchema.parse({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [ring] },
      }),
    ).toThrow();
  });

  it('rejects zero-area and self-intersecting preference polygons', () => {
    const feature = (coordinates: number[][]) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [coordinates] },
    });

    expect(() =>
      PolygonFeatureSchema.parse(
        feature([
          [0, 0],
          [1, 0],
          [2, 0],
          [0, 0],
        ]),
      ),
    ).toThrow();
    expect(() =>
      PolygonFeatureSchema.parse(
        feature([
          [0, 0],
          [1, 1],
          [0, 1],
          [1, 0],
          [0, 0],
        ]),
      ),
    ).toThrow();
  });
});
