import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchOnlineLocations } from './geocoder';

describe('searchOnlineLocations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns bounded Photon company and address matches into location results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [-122.3895538, 37.7894073] },
            properties: {
              osm_type: 'N',
              osm_id: 123,
              type: 'office',
              name: 'Google',
              housenumber: '345',
              street: 'Spear Street',
              city: 'San Francisco',
              state: 'California',
              postcode: '94105',
              country: 'United States',
            },
          },
          {
            geometry: { coordinates: [124.3773942, 10.6440895] },
            properties: { osm_type: 'N', osm_id: 999, name: 'Google outside the city' },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchOnlineLocations('sf', 'Google San Francisco')).resolves.toEqual([
      {
        id: 'photon-N-123',
        label: 'Google — 345 Spear Street, San Francisco, California, 94105, United States',
        coordinates: [-122.3895538, 37.7894073],
        kind: 'poi',
      },
    ]);
    const requested = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requested.searchParams.get('q')).toBe('Google San Francisco, San Francisco');
    expect(requested.searchParams.get('bbox')).toBe('-122.53,37.69,-122.34,37.83');
  });

  it('fails closed when the online geocoder is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(searchOnlineLocations('sf', 'missing place')).resolves.toEqual([]);
  });
});
