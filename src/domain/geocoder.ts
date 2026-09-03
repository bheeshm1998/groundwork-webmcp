import { CITIES, coordinateIsInCity, type CityId } from './cities';
import type { Coordinate, LocationResult } from './schemas';

const DEFAULT_GEOCODER_URL = 'https://photon.komoot.io/api/';
const GEOCODER_TIMEOUT_MS = 6_000;

interface PhotonFeature {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function resultLabel(properties: NonNullable<PhotonFeature['properties']>): string | null {
  const address = [
    [properties.housenumber, properties.street].filter(Boolean).join(' '),
    properties.city ?? properties.district,
    properties.state,
    properties.postcode,
    properties.country,
  ].filter(Boolean);
  const addressLabel = [...new Set(address)].join(', ');
  if (properties.name && addressLabel) return `${properties.name} — ${addressLabel}`;
  return properties.name ?? addressLabel ?? null;
}

export async function searchOnlineLocations(
  cityId: CityId,
  query: string,
  signal?: AbortSignal,
): Promise<LocationResult[]> {
  const endpoint = import.meta.env.VITE_GEOCODER_URL?.trim() || DEFAULT_GEOCODER_URL;
  const city = CITIES[cityId];
  const [[west, south], [east, north]] = city.bounds;

  try {
    const url = new URL(endpoint);
    url.searchParams.set('q', `${query.trim()}, ${city.name}`);
    url.searchParams.set('limit', '8');
    url.searchParams.set('lang', 'en');
    url.searchParams.set('lat', String(city.center[1]));
    url.searchParams.set('lon', String(city.center[0]));
    url.searchParams.set('bbox', `${west},${south},${east},${north}`);
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(GEOCODER_TIMEOUT_MS)])
        : AbortSignal.timeout(GEOCODER_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as PhotonResponse;
    const results: LocationResult[] = [];
    for (const feature of payload.features ?? []) {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties;
      if (!isCoordinate(coordinates) || !properties) continue;
      const coordinate: Coordinate = [coordinates[0], coordinates[1]];
      if (!coordinateIsInCity(cityId, coordinate)) continue;
      const label = resultLabel(properties);
      if (!label) continue;
      results.push({
        id:
          properties.osm_type && properties.osm_id
            ? `photon-${properties.osm_type}-${properties.osm_id}`
            : `photon-${coordinate.join('-')}`,
        label,
        coordinates: coordinate,
        kind: ['street', 'highway'].includes(properties.type ?? '') ? 'street' : 'poi',
      });
    }
    return results;
  } catch {
    return [];
  }
}
