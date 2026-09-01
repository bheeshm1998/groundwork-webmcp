import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED, SAMPLE_OFFICE } from './defaults';
import type { CanonicalWorkspace, DerivedAnalysis } from './schemas';
import { STORAGE_KEY } from '../sharing/share';
import { useWorkspaceStore } from '../store/workspace-store';

const worker = vi.hoisted(() => ({
  initialize: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock('../geo-worker/client', () => ({ getGeoWorker: () => worker }));

import { workspaceService } from './workspace-service';

const feasibleRegion: NonNullable<DerivedAnalysis['feasibleRegion']> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.41, 37.77],
        [-122.39, 37.77],
        [-122.39, 37.79],
        [-122.41, 37.79],
        [-122.41, 37.77],
      ],
    ],
  },
};

function analysisFor(canonical: CanonicalWorkspace): DerivedAnalysis {
  const combined = canonical.combined;
  return {
    layers: Object.fromEntries(canonical.conditions.map(({ id }) => [id, feasibleRegion])),
    feasibleRegion: combined ? feasibleRegion : null,
    feasibleAreaKm2: combined ? 0.48 : 0,
    candidates: combined
      ? [
          {
            id: 'candidate-1',
            name: 'South of Market — near 1st Street & Howard Street',
            coordinates: [-122.4, 37.78],
            score: 0.8,
            minimumSlack: 0.4,
            averageSlack: 0.6,
            bikeMinutes: 12,
            groceryMinutes: 6,
            parkMinutes: 5,
            nearestGrocery: 'Real grocery',
            nearestPark: 'Real park',
            comfortable: ['bike commute', 'grocery access', 'park access'],
            closeToFailing: null,
            tradeoff: 'Balanced fit.',
          },
        ]
      : [],
    restriction: combined
      ? {
          conditionId: canonical.conditions.at(-1)!.id,
          label: canonical.conditions.at(-1)!.label,
          areaLostKm2: 1.4,
          currentAreaKm2: 0.48,
          relaxedAreaKm2: 1.2,
          message: 'Park access is the strongest restriction.',
        }
      : null,
  };
}

function resetStore() {
  useWorkspaceStore.setState({
    canonical: structuredClone(EMPTY_CANONICAL),
    derived: structuredClone(EMPTY_DERIVED),
    activity: [],
    undo: null,
    operation: 'idle',
    analysisFreshness: 'not-combined',
    error: null,
    initialized: false,
  });
}

describe('WorkspaceService', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    resetStore();
    worker.initialize.mockReset().mockResolvedValue({
      metadata: { datasetVersion: 'test-dataset' },
      search: [
        { id: 'market-1', label: SAMPLE_OFFICE.label, coordinates: SAMPLE_OFFICE.coordinates },
      ],
    });
    worker.analyze
      .mockReset()
      .mockImplementation(async (canonical: CanonicalWorkspace) => analysisFor(canonical));
  });

  it('runs the agent location scenario and returns a compact workspace summary', async () => {
    await workspaceService.initialize();
    const search = await workspaceService.query({ type: 'search-locations', query: 'City Hall' });
    expect(search.data).toEqual([
      { id: 'market-1', label: SAMPLE_OFFICE.label, coordinates: SAMPLE_OFFICE.coordinates },
    ]);

    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE, actor: 'agent' });
    await workspaceService.execute({ type: 'add-bike', maxMinutes: 25, actor: 'agent' });
    await workspaceService.execute({
      type: 'add-access',
      category: 'grocery',
      maxMinutes: 10,
      groceryType: 'supermarket',
      actor: 'agent',
    });
    await workspaceService.execute({
      type: 'add-access',
      category: 'park',
      maxMinutes: 8,
      actor: 'agent',
    });
    await workspaceService.execute({ type: 'combine', actor: 'agent' });
    const ranked = await workspaceService.execute({ type: 'rank', actor: 'agent' });
    const summary = await workspaceService.query({ type: 'get-workspace' });

    expect(ranked.ok).toBe(true);
    expect(summary).toMatchObject({
      ok: true,
      data: {
        office: SAMPLE_OFFICE,
        freshness: 'fresh',
        feasibleAreaKm2: 0.48,
        candidates: [{ id: 'candidate-1' }],
      },
    });
    expect((summary.data as { conditions: unknown[] }).conditions).toHaveLength(3);
    expect(useWorkspaceStore.getState().activity).toHaveLength(6);
    expect(useWorkspaceStore.getState().activity.every(({ actor }) => actor === 'agent')).toBe(
      true,
    );
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('marks bike-dependent combined analysis stale until it is recalculated', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
    await workspaceService.execute({ type: 'add-bike', maxMinutes: 25 });
    await workspaceService.execute({ type: 'add-access', category: 'park', maxMinutes: 8 });
    await workspaceService.execute({ type: 'combine' });
    const bike = useWorkspaceStore.getState().canonical.conditions[0];
    expect(bike).toBeDefined();
    const bikeId = bike!.id;
    const analyzeCount = worker.analyze.mock.calls.length;

    await workspaceService.execute({ type: 'update-condition', id: bikeId, maxMinutes: 30 });
    expect(useWorkspaceStore.getState().analysisFreshness).toBe('stale');
    expect(worker.analyze).toHaveBeenCalledTimes(analyzeCount);

    await workspaceService.execute({ type: 'recalculate' });
    expect(useWorkspaceStore.getState().analysisFreshness).toBe('fresh');
    expect(worker.analyze).toHaveBeenCalledTimes(analyzeCount + 1);
  });

  it('rejects invalid command ordering without mutating the canonical workspace', async () => {
    await workspaceService.initialize();
    const result = await workspaceService.execute({ type: 'add-bike', maxMinutes: 25 });

    expect(result).toEqual({
      ok: false,
      message: 'Set an office before adding a bicycle condition.',
    });
    expect(useWorkspaceStore.getState().canonical).toEqual(EMPTY_CANONICAL);
    expect(useWorkspaceStore.getState().operation).toBe('error');
  });

  it('undoes the most recent meaningful workspace change', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
    expect(useWorkspaceStore.getState().canonical.office).toEqual(SAMPLE_OFFICE);

    const undone = await workspaceService.execute({ type: 'undo', actor: 'agent' });
    expect(undone.ok).toBe(true);
    expect(useWorkspaceStore.getState().canonical.office).toBeNull();
    expect(useWorkspaceStore.getState().undo).toBeNull();
    expect(useWorkspaceStore.getState().activity.at(-1)).toMatchObject({
      actor: 'agent',
      message: 'Undid the most recent workspace change.',
    });
  });

  it('keeps the last edit undoable across recalculation and ranking', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
    await workspaceService.execute({ type: 'add-bike', maxMinutes: 25 });
    await workspaceService.execute({ type: 'add-access', category: 'park', maxMinutes: 8 });
    await workspaceService.execute({ type: 'combine' });
    const bikeId = useWorkspaceStore.getState().canonical.conditions[0]!.id;

    await workspaceService.execute({ type: 'update-condition', id: bikeId, maxMinutes: 30 });
    await workspaceService.execute({ type: 'recalculate' });
    await workspaceService.execute({ type: 'rank' });
    await workspaceService.execute({ type: 'select-candidate', id: 'candidate-1' });
    await workspaceService.execute({ type: 'undo' });

    const bike = useWorkspaceStore.getState().canonical.conditions.find(({ id }) => id === bikeId);
    expect(bike).toMatchObject({ kind: 'bike', maxMinutes: 25 });
  });

  it('replaces duplicate condition categories instead of creating ambiguous constraints', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({
      type: 'add-access',
      category: 'grocery',
      maxMinutes: 10,
      groceryType: 'supermarket',
    });
    await workspaceService.execute({
      type: 'add-access',
      category: 'grocery',
      maxMinutes: 5,
      groceryType: 'supermarket_or_grocery',
    });

    expect(useWorkspaceStore.getState().canonical.conditions).toHaveLength(1);
    expect(useWorkspaceStore.getState().canonical.conditions[0]).toMatchObject({
      category: 'grocery',
      maxMinutes: 5,
      groceryType: 'supermarket_or_grocery',
    });
  });

  it('rejects nonexistent condition and candidate IDs without consuming undo', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
    const undoBefore = structuredClone(useWorkspaceStore.getState().undo);

    await expect(
      workspaceService.execute({ type: 'delete-condition', id: 'missing' }),
    ).resolves.toMatchObject({ ok: false, message: 'Condition not found.' });
    await expect(
      workspaceService.execute({ type: 'select-candidate', id: 'missing' }),
    ).resolves.toMatchObject({ ok: false, message: 'Candidate not found.' });
    await expect(
      workspaceService.execute({ type: 'remove-candidate', id: 'missing' }),
    ).resolves.toMatchObject({ ok: false, message: 'Candidate not found.' });
    expect(useWorkspaceStore.getState().undo).toEqual(undoBefore);
  });
});
