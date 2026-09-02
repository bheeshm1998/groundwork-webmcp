import type { Coordinate } from './schemas';

export const CITY_IDS = ['sf', 'hyderabad'] as const;
export type CityId = (typeof CITY_IDS)[number];

export interface CityConfig {
  id: CityId;
  name: string;
  country: string;
  dataPath: string;
  center: Coordinate;
  zoom: number;
  bounds: [[number, number], [number, number]];
  mapBounds: [[number, number], [number, number]];
  promptDestinations: readonly [string, string, string];
  neighborhoodAttribution: string;
}

export const CITIES: Record<CityId, CityConfig> = {
  sf: {
    id: 'sf',
    name: 'San Francisco',
    country: 'United States',
    dataPath: '/data/sf',
    center: [-122.425, 37.7749],
    zoom: 11.6,
    bounds: [
      [-122.53, 37.69],
      [-122.34, 37.83],
    ],
    mapBounds: [
      [-122.56, 37.67],
      [-122.31, 37.85],
    ],
    promptDestinations: [
      'San Francisco City Hall',
      'San Francisco Ferry Building',
      'Golden Gate Park',
    ],
    neighborhoodAttribution: 'Neighborhoods DataSF',
  },
  hyderabad: {
    id: 'hyderabad',
    name: 'Hyderabad',
    country: 'India',
    dataPath: '/data/hyderabad',
    center: [78.4867, 17.385],
    zoom: 10.5,
    bounds: [
      [78.29, 17.2],
      [78.67, 17.56],
    ],
    mapBounds: [
      [78.24, 17.15],
      [78.72, 17.61],
    ],
    promptDestinations: ['Gachibowli', 'Charminar', 'HITEC City Road'],
    neighborhoodAttribution: 'Neighborhoods OpenStreetMap',
  },
};

export const DEFAULT_CITY_ID: CityId = 'sf';

export function parseCityId(value: string | null | undefined): CityId | null {
  return CITY_IDS.includes(value as CityId) ? (value as CityId) : null;
}

export function cityFromLocation(): CityId {
  return parseCityId(new URLSearchParams(window.location.search).get('city')) ?? DEFAULT_CITY_ID;
}

export function coordinateIsInCity(cityId: CityId, [longitude, latitude]: Coordinate): boolean {
  const [[west, south], [east, north]] = CITIES[cityId].bounds;
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
