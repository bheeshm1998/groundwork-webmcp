import type { CityConfig } from './cities';
import { CATEGORY_LABELS, MODE_PHRASES } from './options';
import type { PlaceCategory, TravelMode } from './schemas';

function travel(mode: TravelMode): string {
  return MODE_PHRASES[mode];
}

function places(category: PlaceCategory): string {
  return CATEGORY_LABELS[category].toLowerCase();
}

export function buildStarterPrompts(city: CityConfig): string[] {
  const [primary, secondary, lifestyle] = city.promptDestinations;
  return [
    `I'm moving to ${city.name}. Find me areas within a 30-minute ${travel('car')} of ${primary}, within a 10-minute walk of a supermarket, and within a 15-minute ${travel('bike')} of ${places('school')}. Then show me the three best areas and explain the trade-offs.`,
    `Help us find areas in ${city.name} that are within a 35-minute ${travel('car')} of ${primary} and a 30-minute ${travel('car')} of ${secondary}, with ${places('healthcare')} within a 12-minute walk. Rank the three strongest options.`,
    `Explore a lifestyle-led plan in ${city.name}: areas within a 25-minute ${travel('bike')} of ${lifestyle}, an 8-minute walk of ${places('park')}, and a 15-minute ${travel('bike')} of ${places('cinema')}. Show the three best-balanced areas and explain what is closest to its limit.`,
  ];
}
