import { describe, expect, it } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED } from './defaults';
import { getCapabilities } from './capabilities';

describe('capabilities', () => {
  it('keeps access conditions independent from the office', () => {
    const capabilities = getCapabilities(EMPTY_CANONICAL, EMPTY_DERIVED, 'not-combined', false);
    expect(capabilities.has('add-access')).toBe(true);
    expect(capabilities.has('add-bike')).toBe(false);
  });

  it('exposes recalculation only for stale analysis', () => {
    expect(getCapabilities(EMPTY_CANONICAL, EMPTY_DERIVED, 'stale', false).has('recalculate')).toBe(
      true,
    );
    expect(getCapabilities(EMPTY_CANONICAL, EMPTY_DERIVED, 'fresh', false).has('recalculate')).toBe(
      false,
    );
  });

  it('keeps recovery mutations available after a rejected command', () => {
    const capabilities = getCapabilities(
      EMPTY_CANONICAL,
      EMPTY_DERIVED,
      'not-combined',
      false,
      'error',
    );
    expect(capabilities.has('set-office')).toBe(true);
    expect(capabilities.has('add-access')).toBe(true);
  });
});
