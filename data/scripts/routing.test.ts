import { describe, expect, it } from 'vitest';
import { carDirections, carSpeed } from './routing';

describe('OSM car routing policy', () => {
  it.each(['footway', 'path', 'steps', 'cycleway'])('does not traverse %s edges', (highway) => {
    expect(carDirections({ highway })).toEqual([false, false]);
  });

  it('respects access and one-way restrictions', () => {
    expect(carDirections({ highway: 'residential', motor_vehicle: 'no' })).toEqual([false, false]);
    expect(carDirections({ highway: 'primary', oneway: 'yes' })).toEqual([true, false]);
    expect(carDirections({ highway: 'primary', oneway: '-1' })).toEqual([false, true]);
  });

  it('uses tagged maximum speeds when present', () => {
    expect(carSpeed({ highway: 'residential', maxspeed: '20 mph' })).toBeCloseTo(32.19, 1);
    expect(carSpeed({ highway: 'motorway' })).toBe(90);
  });
});
