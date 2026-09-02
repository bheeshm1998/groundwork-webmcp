import { describe, expect, it, beforeEach } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import { DATASET_VERSION, EMPTY_CANONICAL } from '../domain/defaults';
import {
  clearLocalWorkspace,
  decodeWorkspace,
  encodeWorkspace,
  readLocalWorkspace,
  saveLocalWorkspace,
} from './share';

const payload = {
  schemaVersion: 1 as const,
  cityId: 'sf' as const,
  datasetVersion: DATASET_VERSION,
  canonical: EMPTY_CANONICAL,
  activity: [],
  undo: null,
};

describe('workspace sharing', () => {
  beforeEach(clearLocalWorkspace);

  it('round trips a compressed workspace', () => {
    const encoded = encodeWorkspace(payload);
    expect(encoded.length).toBeLessThan(8_192);
    expect(decodeWorkspace(encoded)).toEqual(payload);
  });

  it('rejects corrupt fragments without mutating storage', () => {
    expect(() => decodeWorkspace('not-a-valid-workspace')).toThrow(/invalid/u);
    expect(readLocalWorkspace()).toBeNull();
  });

  it('validates local persistence', () => {
    saveLocalWorkspace(payload);
    expect(readLocalWorkspace()).toEqual(payload);
  });

  it('rejects highly compressed fragments that expand beyond the safe limit', () => {
    const compressed = deflateSync(strToU8('x'.repeat(300_000)));
    const encoded = btoa(String.fromCharCode(...compressed))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '');

    expect(encoded.length).toBeLessThan(8_192);
    expect(() => decodeWorkspace(encoded)).toThrow(/invalid|too large|unsupported/u);
  });
});
