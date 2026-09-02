import type { AccessMode, Condition, PlaceCategory, TravelMode } from './schemas';

export const MODE_LABELS: Record<TravelMode, string> = {
  bike: 'Bicycle',
  walk: 'Walk',
  car: 'Drive',
};

export const MODE_PHRASES: Record<TravelMode, string> = {
  bike: 'bike ride',
  walk: 'walk',
  car: 'drive',
};

export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  grocery: 'Groceries',
  school: 'Schools',
  healthcare: 'Healthcare',
  park: 'Parks',
  cinema: 'Cinemas',
};

export function travelConditionLabel(
  maxMinutes: number,
  mode: TravelMode,
  destinationLabel: string,
): string {
  return `${maxMinutes}-minute ${MODE_PHRASES[mode]} to ${destinationLabel}`;
}

export function placeConditionLabel(
  maxMinutes: number,
  mode: AccessMode,
  category: PlaceCategory,
  groceryType?: 'supermarket' | 'supermarket_or_grocery',
): string {
  const place =
    category === 'grocery' && groceryType === 'supermarket'
      ? 'supermarket'
      : CATEGORY_LABELS[category].toLowerCase();
  return `${maxMinutes}-minute ${MODE_PHRASES[mode]} to ${place}`;
}

export function conditionMetricLabel(
  condition: Exclude<Condition, { kind: 'preference' }>,
): string {
  if (condition.kind === 'travel') return condition.label;
  return condition.label;
}
