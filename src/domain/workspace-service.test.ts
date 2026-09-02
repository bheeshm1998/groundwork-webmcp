import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED, SAMPLE_OFFICE } from './defaults';
import type { CanonicalWorkspace, DerivedAnalysis } from './schemas';
import { decodeWorkspace, STORAGE_KEY } from '../sharing/share';
import { useWorkspaceStore } from '../store/workspace-store';
import { CITIES } from './cities';

const worker = vi.hoisted(() => ({
  initialize: vi.fn(),
  isCoordinateSupported: vi.fn(),
  analyze: vi.fn(),
}));
const geocoder = vi.hoisted(() => ({ searchOnlineLocations: vi.fn() }));

vi.mock('../geo-worker/client', () => ({ getGeoWorker: () => worker }));
vi.mock('./geocoder', () => ({ searchOnlineLocations: geocoder.searchOnlineLocations }));

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
    cityId: 'sf',
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
        {
          id: 'market-1',
          label: SAMPLE_OFFICE.label,
          coordinates: SAMPLE_OFFICE.coordinates,
          kind: 'poi',
        },
      ],
    });
    worker.isCoordinateSupported.mockReset().mockResolvedValue(true);
    geocoder.searchOnlineLocations.mockReset().mockResolvedValue([]);
    worker.analyze
      .mockReset()
      .mockImplementation(async (canonical: CanonicalWorkspace) => analysisFor(canonical));
  });

  it('runs the agent location scenario and returns a compact workspace summary', async () => {
    await workspaceService.initialize();
    const search = await workspaceService.query({ type: 'search-locations', query: 'City Hall' });
    expect(search.data).toEqual([
      {
        id: 'market-1',
        label: SAMPLE_OFFICE.label,
        coordinates: SAMPLE_OFFICE.coordinates,
        kind: 'poi',
      },
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

  it('falls back to online OSM geocoding for company names absent from the local extract', async () => {
    geocoder.searchOnlineLocations.mockResolvedValue([
      {
        id: 'photon-N-123',
        label: 'Google — 345 Spear Street, San Francisco, California',
        coordinates: [-122.3895538, 37.7894073],
        kind: 'poi',
      },
    ]);
    await workspaceService.initialize();

    const result = await workspaceService.query({
      type: 'search-locations',
      query: 'Google San Francisco',
    });

    expect(geocoder.searchOnlineLocations).toHaveBeenCalledWith('sf', 'Google San Francisco');
    expect(result.data).toEqual([
      expect.objectContaining({
        label: 'Google — 345 Spear Street, San Francisco, California',
        coordinates: [-122.3895538, 37.7894073],
      }),
    ]);
  });

  it('loads Hyderabad independently and rejects coordinates from the other city', async () => {
    await workspaceService.initialize('hyderabad');

    expect(worker.initialize).toHaveBeenCalledWith('hyderabad');
    expect(useWorkspaceStore.getState().cityId).toBe('hyderabad');
    expect(useWorkspaceStore.getState().canonical.view.center).toEqual(CITIES.hyderabad.center);

    await expect(
      workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE }),
    ).resolves.toMatchObject({
      ok: false,
      message: 'Choose a location inside the supported Hyderabad area.',
    });
    await expect(
      workspaceService.execute({
        type: 'set-office',
        office: CITIES.hyderabad.sampleOffice,
      }),
    ).resolves.toMatchObject({ ok: true });
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
    expect(useWorkspaceStore.getState().derived).toEqual(EMPTY_DERIVED);
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

  it('does not commit an analysis after its caller cancels', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
    let resolveAnalysis!: (analysis: DerivedAnalysis) => void;
    worker.analyze.mockImplementationOnce(
      () => new Promise<DerivedAnalysis>((resolve) => (resolveAnalysis = resolve)),
    );
    const controller = new AbortController();
    const pending = workspaceService.execute(
      { type: 'add-bike', maxMinutes: 25, actor: 'agent' },
      controller.signal,
    );

    controller.abort();
    resolveAnalysis(analysisFor(useWorkspaceStore.getState().canonical));
    await expect(pending).resolves.toEqual({ ok: false, message: 'The operation was cancelled.' });
    expect(useWorkspaceStore.getState().canonical.conditions).toHaveLength(0);
    expect(useWorkspaceStore.getState().operation).toBe('idle');
  });

  it('creates share links without private history or an undo snapshot', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
    const result = await workspaceService.query({ type: 'create-share-link' });
    const url = new URL((result.data as { url: string }).url);
    const shared = decodeWorkspace(new URLSearchParams(url.hash.slice(1)).get('w')!);

    expect(shared.activity).toEqual([]);
    expect(shared.undo).toBeNull();
    expect(shared.canonical.office).toEqual(SAMPLE_OFFICE);
  });
});
