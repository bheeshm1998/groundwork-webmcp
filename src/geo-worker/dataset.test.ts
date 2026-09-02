import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CITIES, CITY_IDS } from '../domain/cities';
import { PLACE_CATEGORIES } from '../domain/schemas';
import type { PlacesData } from './engine';

describe('bundled city datasets', () => {
  it.each(CITY_IDS)(
    'contains every supported category and starter destination in %s',
    async (cityId) => {
      const directory = resolve(process.cwd(), 'public/data', cityId);
      const metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8')) as {
        assets: { places: string };
        counts: { places: Record<string, number> };
      };
      const places = JSON.parse(
        await readFile(resolve(directory, metadata.assets.places), 'utf8'),
      ) as PlacesData;

      for (const category of PLACE_CATEGORIES) {
        expect(places.categories[category].length).toBeGreaterThan(0);
        expect(metadata.counts.places[category]).toBe(places.categories[category].length);
      }
      const searchableNames = new Set(places.search.map(({ label }) => label));
      for (const destination of CITIES[cityId].promptDestinations) {
        expect(searchableNames.has(destination)).toBe(true);
      }
    },
  );
});
