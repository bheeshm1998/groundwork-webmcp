export type OsmTags = Record<string, string>;

const CAR_SPEEDS_KPH: Record<string, number> = {
  motorway: 90,
  motorway_link: 50,
  trunk: 80,
  trunk_link: 45,
  primary: 50,
  primary_link: 35,
  secondary: 40,
  secondary_link: 30,
  tertiary: 35,
  tertiary_link: 25,
  residential: 25,
  unclassified: 25,
  service: 15,
  living_street: 10,
};

function parseMaxspeed(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\d+(?:\.\d+)?/u);
  if (!match) return null;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const kilometersPerHour = /mph/iu.test(value) ? numeric * 1.609_344 : numeric;
  return Math.max(5, Math.min(130, kilometersPerHour));
}

export function carSpeed(tags: OsmTags): number {
  return parseMaxspeed(tags.maxspeed) ?? CAR_SPEEDS_KPH[tags.highway] ?? 20;
}

export function carDirections(tags: OsmTags): [boolean, boolean] {
  const excludedHighways = new Set([
    'footway',
    'path',
    'steps',
    'cycleway',
    'pedestrian',
    'bridleway',
    'corridor',
    'construction',
  ]);
  if (!tags.highway || excludedHighways.has(tags.highway)) return [false, false];
  if (
    ['no', 'private'].includes(tags.access) ||
    ['no', 'private'].includes(tags.vehicle) ||
    ['no', 'private'].includes(tags.motor_vehicle) ||
    ['no', 'private'].includes(tags.motorcar)
  ) {
    return [false, false];
  }
  const oneWay = tags['oneway:motor_vehicle'] ?? tags.oneway;
  if (oneWay === '-1') return [false, true];
  if (['yes', '1', 'true'].includes(oneWay) || tags.junction === 'roundabout') return [true, false];
  return [true, true];
}
