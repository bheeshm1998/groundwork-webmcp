import { describe, expect, it } from 'vitest';
import { CanonicalWorkspaceSchema, OfficeSchema, PolygonFeatureSchema } from './schemas';
import { EMPTY_CANONICAL } from './defaults';

describe('workspace schemas', () => {
  it('rejects offices outside the supported San Francisco bounds', () => {
    expect(() => OfficeSchema.parse({ label: 'Elsewhere', coordinates: [0, 0] })).toThrow();
  });

  it('rejects combined workspaces with too few or duplicate condition types', () => {
    expect(() =>
      CanonicalWorkspaceSchema.parse({
        ...EMPTY_CANONICAL,
        combined: true,
        conditions: [
          {
            id: 'park',
            kind: 'access',
            category: 'park',
            label: 'Park',
            visible: true,
            maxMinutes: 8,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      CanonicalWorkspaceSchema.parse({
        ...EMPTY_CANONICAL,
        conditions: [
          {
            id: 'park-1',
            kind: 'access',
            category: 'park',
            label: 'Park 1',
            visible: true,
            maxMinutes: 8,
          },
          {
            id: 'park-2',
            kind: 'access',
            category: 'park',
            label: 'Park 2',
            visible: true,
            maxMinutes: 10,
          },
        ],
      }),
    ).toThrow();
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
});
