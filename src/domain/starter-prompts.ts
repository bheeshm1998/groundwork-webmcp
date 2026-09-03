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
  const focusedPrompt =
    city.id === 'sf'
      ? `Help me find a genuinely focused area in ${city.name}: within an 8-minute ${travel('bike')} of ${primary}, a 5-minute walk of a supermarket, and a 4-minute walk of ${places('park')}. Build the complete plan, show three geographically distinct options, and explain each trade-off.`
      : `Help me find a focused area in ${city.name}: within an 18-minute ${travel('car')} of ${primary}, an 8-minute walk of a supermarket, and a 10-minute ${travel('bike')} of ${places('healthcare')}. Build the complete plan, show three geographically distinct options, and explain each trade-off.`;
  return [
    focusedPrompt,
    `Find a fair compromise in ${city.name}: within a 22-minute ${travel('car')} of ${primary} and a 22-minute ${travel('car')} of ${secondary}, with ${places('healthcare')} within a 10-minute walk. Show three distinct neighborhoods and tell me which condition limits the search most.`,
    `Plan a car-light lifestyle in ${city.name}: within a 15-minute ${travel('bike')} of ${lifestyle}, a 7-minute walk of ${places('park')}, and a 12-minute ${travel('bike')} of ${places('cinema')}. If you need a personal boundary, pause and ask me to draw it on the map.`,
  ];
}
