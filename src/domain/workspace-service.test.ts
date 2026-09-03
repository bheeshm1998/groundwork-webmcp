import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED } from './defaults';
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

const SF_DESTINATION = {
  id: 'city-hall',
  label: 'San Francisco City Hall',
  coordinates: [-122.4192315, 37.7792763] as [number, number],
};
const HYDERABAD_DESTINATION = {
  id: 'gachibowli',
  label: 'Gachibowli',
  coordinates: [78.3489, 17.4401] as [number, number],
};

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
            metrics: canonical.conditions
              .filter((condition) => condition.kind !== 'preference')
              .map((condition) => ({
                conditionId: condition.id,
                label: condition.label,
                minutes: 8,
                nearestPlaceName: condition.kind === 'access' ? 'Nearby place' : null,
                slack: 0.4,
              })),
            comfortable: canonical.conditions.map(({ label }) => label),
            closeToFailing: null,
            tradeoff: 'Balanced fit.',
          },
        ]
      : [],
    restriction: combined
      ? {
          conditionId: canonical.conditions.at(-1)?.id ?? 'combined',
          label: canonical.conditions.at(-1)?.label ?? 'Combined priorities',
          areaLostKm2: 1.4,
          currentAreaKm2: 0.48,
          relaxedAreaKm2: 1.2,
          message: 'One priority is the strongest restriction.',
        }
      : null,
  };
}

function resetStore(canonical: CanonicalWorkspace = structuredClone(EMPTY_CANONICAL)) {
  useWorkspaceStore.setState({
    cityId: 'sf',
    canonical,
    derived: structuredClone(EMPTY_DERIVED),
    activity: [],
    undo: null,
    operation: 'idle',
    analysisFreshness: 'not-combined',
    error: null,
    initialized: false,
    drawingReady: false,
    activeAgentAction: null,
    calculationLabel: null,
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
          label: SF_DESTINATION.label,
          coordinates: SF_DESTINATION.coordinates,
          kind: 'poi',
        },
        {
          id: 'non-latin-1',
          label: '三藩市以琳教會',
          coordinates: [-122.462, 37.766] as [number, number],
          kind: 'poi' as const,
        },
        {
          id: 'short-token-1',
          label: 'C& H Complete Auto Repair',
          coordinates: [-122.419, 37.764] as [number, number],
          kind: 'poi' as const,
        },
      ],
    });
    worker.isCoordinateSupported.mockReset().mockResolvedValue(true);
    geocoder.searchOnlineLocations.mockReset().mockResolvedValue([]);
    worker.analyze
      .mockReset()
      .mockImplementation(async (canonical: CanonicalWorkspace) => analysisFor(canonical));
  });

  it('runs a multi-condition agent scenario and returns the canonical vocabulary', async () => {
    await workspaceService.initialize();
    const search = await workspaceService.query({ type: 'search-locations', query: 'City Hall' });
    expect(search.data).toEqual([expect.objectContaining({ label: 'San Francisco City Hall' })]);

    await workspaceService.execute({
      type: 'add-destination',
      destination: SF_DESTINATION,
      actor: 'agent',
    });
    await workspaceService.execute({
      type: 'add-travel',
      destinationId: SF_DESTINATION.id,
      mode: 'car',
      maxMinutes: 30,
      actor: 'agent',
    });
    await workspaceService.execute({
      type: 'add-place',
      category: 'school',
      mode: 'walk',
      maxMinutes: 12,
      actor: 'agent',
    });
    await workspaceService.execute({
      type: 'add-place',
      category: 'school',
      mode: 'bike',
      maxMinutes: 20,
      actor: 'agent',
    });
    await workspaceService.execute({ type: 'combine', actor: 'agent' });
    await workspaceService.execute({ type: 'rank', actor: 'agent' });
    const summary = await workspaceService.query({ type: 'get-workspace' });

    expect(summary).toMatchObject({
      ok: true,
      data: {
        destinations: [SF_DESTINATION],
        freshness: 'fresh',
        feasibleAreaKm2: 0.48,
        candidates: [{ id: 'candidate-1' }],
        supportedAnalysis: {
          commuteModes: ['bike', 'walk', 'car'],
          nearbyCategories: ['grocery', 'school', 'healthcare', 'park', 'cinema'],
        },
      },
    });
    expect((summary.data as { conditions: unknown[] }).conditions).toHaveLength(3);
    expect(useWorkspaceStore.getState().activity.every(({ actor }) => actor === 'agent')).toBe(
      true,
    );
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('falls back to online OSM geocoding when the local extract has no strong match', async () => {
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

    expect(geocoder.searchOnlineLocations).toHaveBeenCalledWith(
      'sf',
      'Google San Francisco',
      undefined,
    );
    expect(result.data).toEqual([
      expect.objectContaining({ label: 'Google — 345 Spear Street, San Francisco, California' }),
    ]);
  });

  it('matches minor local typos without waiting for online geocoding', async () => {
    await workspaceService.initialize();

    const result = await workspaceService.query({
      type: 'search-locations',
      query: 'San Fransisco Cty Hall',
    });

    expect(result.data).toEqual([expect.objectContaining({ label: SF_DESTINATION.label })]);
    expect(geocoder.searchOnlineLocations).not.toHaveBeenCalled();
  });

  it('configures and analyzes a complete agent plan in one command', async () => {
    await workspaceService.initialize();
    const result = await workspaceService.execute({
      type: 'configure-plan',
      actor: 'agent',
      destinations: [
        {
          key: 'office',
          label: SF_DESTINATION.label,
          coordinates: SF_DESTINATION.coordinates,
        },
      ],
      conditions: [
        { kind: 'travel', destinationKey: 'office', mode: 'car', maxMinutes: 18 },
        { kind: 'access', category: 'grocery', mode: 'walk', maxMinutes: 8 },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      data: { feasibleAreaKm2: 0.48, candidates: [{ id: 'candidate-1' }], freshness: 'fresh' },
    });
    expect(worker.analyze).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().canonical.destinations).toEqual([
      expect.objectContaining({ label: SF_DESTINATION.label }),
    ]);
    expect(useWorkspaceStore.getState().canonical.conditions).toHaveLength(2);
  });

  it('returns created IDs directly from granular commands', async () => {
    await workspaceService.initialize();
    const destination = await workspaceService.execute({
      type: 'add-destination',
      destination: { label: SF_DESTINATION.label, coordinates: SF_DESTINATION.coordinates },
    });
    const createdDestination = (destination.data as { createdDestination: { id: string } | null })
      .createdDestination;
    expect(createdDestination?.id).toMatch(/^destination-/u);

    const condition = await workspaceService.execute({
      type: 'add-travel',
      destinationId: createdDestination!.id,
      mode: 'car',
      maxMinutes: 18,
    });
    expect(
      (condition.data as { createdCondition: { id: string } | null }).createdCondition?.id,
    ).toMatch(/^travel-/u);
  });

  it('loads Hyderabad independently and rejects coordinates from another city', async () => {
    await workspaceService.initialize('hyderabad');
    expect(worker.initialize).toHaveBeenCalledWith('hyderabad');
    expect(useWorkspaceStore.getState().canonical.view.center).toEqual(CITIES.hyderabad.center);

    await expect(
      workspaceService.execute({ type: 'add-destination', destination: SF_DESTINATION }),
    ).resolves.toMatchObject({
      ok: false,
      message: 'Choose a location inside the supported Hyderabad area.',
    });
    await expect(
      workspaceService.execute({
        type: 'add-destination',
        destination: HYDERABAD_DESTINATION,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('marks destination-dependent analysis stale until recalculated', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'add-destination', destination: SF_DESTINATION });
    await workspaceService.execute({
      type: 'add-travel',
      destinationId: SF_DESTINATION.id,
      mode: 'bike',
      maxMinutes: 25,
    });
    await workspaceService.execute({
      type: 'add-place',
      category: 'park',
      mode: 'walk',
      maxMinutes: 8,
    });
    await workspaceService.execute({ type: 'combine' });
    const travelId = useWorkspaceStore.getState().canonical.conditions[0]?.id ?? '';
    const analyzeCount = worker.analyze.mock.calls.length;

    await workspaceService.execute({
      type: 'update-condition',
      id: travelId,
      maxMinutes: 30,
    });
    expect(useWorkspaceStore.getState().analysisFreshness).toBe('stale');
    expect(useWorkspaceStore.getState().derived).toEqual(EMPTY_DERIVED);
    expect(worker.analyze).toHaveBeenCalledTimes(analyzeCount);

    await workspaceService.execute({ type: 'recalculate' });
    expect(useWorkspaceStore.getState().analysisFreshness).toBe('fresh');
    expect(worker.analyze).toHaveBeenCalledTimes(analyzeCount + 1);
  });

  it('rejects a travel priority without a current destination', async () => {
    await workspaceService.initialize();
    const result = await workspaceService.execute({
      type: 'add-travel',
      destinationId: 'missing',
      mode: 'car',
      maxMinutes: 30,
    });

    expect(result).toMatchObject({
      ok: false,
      message: 'Choose a current destination for this travel priority.',
    });
    expect(useWorkspaceStore.getState().canonical).toEqual(EMPTY_CANONICAL);
  });

  it('keeps two conditions of the same category', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({
      type: 'add-place',
      category: 'school',
      mode: 'walk',
      maxMinutes: 10,
    });
    await workspaceService.execute({
      type: 'add-place',
      category: 'school',
      mode: 'bike',
      maxMinutes: 20,
    });

    expect(useWorkspaceStore.getState().canonical.conditions).toHaveLength(2);
  });

  it('produces identical canonical state for user and agent edits', async () => {
    await workspaceService.initialize();
    const baseline: CanonicalWorkspace = {
      ...structuredClone(EMPTY_CANONICAL),
      conditions: [
        {
          id: 'school-1',
          kind: 'access',
          category: 'school',
          mode: 'walk',
          label: '10-minute walk to schools',
          visible: true,
          maxMinutes: 10,
        },
      ],
    };
    resetStore(structuredClone(baseline));
    await workspaceService.execute({
      type: 'update-condition',
      id: 'school-1',
      maxMinutes: 15,
      actor: 'user',
    });
    const userState = structuredClone(useWorkspaceStore.getState().canonical);

    resetStore(structuredClone(baseline));
    await workspaceService.execute({
      type: 'update-condition',
      id: 'school-1',
      maxMinutes: 15,
      actor: 'agent',
    });
    expect(useWorkspaceStore.getState().canonical).toEqual(userState);
  });

  it('removes dependent travel conditions with a destination', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'add-destination', destination: SF_DESTINATION });
    await workspaceService.execute({
      type: 'add-travel',
      destinationId: SF_DESTINATION.id,
      mode: 'walk',
      maxMinutes: 20,
    });

    await workspaceService.execute({ type: 'remove-destination', id: SF_DESTINATION.id });
    expect(useWorkspaceStore.getState().canonical.destinations).toEqual([]);
    expect(useWorkspaceStore.getState().canonical.conditions).toEqual([]);
  });

  it('undoes the most recent meaningful workspace change', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'add-destination', destination: SF_DESTINATION });
    await workspaceService.execute({ type: 'undo', actor: 'agent' });

    expect(useWorkspaceStore.getState().canonical.destinations).toEqual([]);
    expect(useWorkspaceStore.getState().undo).toBeNull();
  });

  it('does not commit an analysis after cancellation', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'add-destination', destination: SF_DESTINATION });
    let resolveAnalysis: ((analysis: DerivedAnalysis) => void) | undefined;
    worker.analyze.mockImplementationOnce(
      () => new Promise<DerivedAnalysis>((resolve) => (resolveAnalysis = resolve)),
    );
    const controller = new AbortController();
    const pending = workspaceService.execute(
      {
        type: 'add-travel',
        destinationId: SF_DESTINATION.id,
        mode: 'bike',
        maxMinutes: 25,
        actor: 'agent',
      },
      controller.signal,
    );

    controller.abort();
    resolveAnalysis?.(analysisFor(useWorkspaceStore.getState().canonical));
    await expect(pending).resolves.toEqual({ ok: false, message: 'The operation was cancelled.' });
    expect(useWorkspaceStore.getState().canonical.conditions).toHaveLength(0);
  });

  it('creates share links without private history or undo state', async () => {
    await workspaceService.initialize();
    await workspaceService.execute({ type: 'add-destination', destination: SF_DESTINATION });
    const result = await workspaceService.query({ type: 'create-share-link' });
    const url = new URL((result.data as { url: string }).url);
    const encoded = new URLSearchParams(url.hash.slice(1)).get('w');
    expect(encoded).not.toBeNull();
    const shared = decodeWorkspace(encoded ?? '');

    expect(shared.activity).toEqual([]);
    expect(shared.undo).toBeNull();
    expect(shared.canonical.destinations).toEqual([SF_DESTINATION]);
  });
});
