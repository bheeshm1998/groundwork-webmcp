import { describe, expect, it, beforeEach } from 'vitest';
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
});
