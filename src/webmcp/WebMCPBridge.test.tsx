import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED, SAMPLE_OFFICE } from '../domain/defaults';
import type { Candidate, DerivedAnalysis } from '../domain/schemas';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';
import { WebMCPBridge } from './WebMCPBridge';

type RegisteredTool = {
  name: string;
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<unknown> | unknown;
};

const tools = new Map<string, RegisteredTool>();

function installModelContext() {
  const modelContext = new EventTarget() as EventTarget & {
    registerTool: (tool: RegisteredTool, options?: { signal?: AbortSignal }) => Promise<void>;
    getTools: () => Promise<unknown[]>;
  };
  modelContext.registerTool = async (tool, options) => {
    tools.set(tool.name, tool);
    options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
  };
  modelContext.getTools = async () => [...tools.keys()];
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: modelContext,
  });
}

const candidate: Candidate = {
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

function resetStore() {
  useWorkspaceStore.setState({
    canonical: structuredClone(EMPTY_CANONICAL),
    derived: structuredClone(EMPTY_DERIVED),
    activity: [],
    undo: null,
    operation: 'idle',
    analysisFreshness: 'not-combined',
    error: null,
    initialized: true,
  });
}

describe('WebMCPBridge', () => {
  beforeEach(() => {
    tools.clear();
    resetStore();
    installModelContext();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (document as Document & { modelContext?: unknown }).modelContext;
  });

  it('registers only capabilities valid for the empty workspace', async () => {
    render(<WebMCPBridge />);

    await waitFor(() => expect(tools.has('groundwork_get_workspace')).toBe(true));
    expect([...tools.keys()].sort()).toEqual([
      'groundwork_add_access_condition',
      'groundwork_create_share_link',
      'groundwork_get_workspace',
      'groundwork_search_locations',
      'groundwork_set_office',
      'groundwork_start_preference_draw',
    ]);
  });

  it('translates validated WebMCP inputs into workspace commands and queries', async () => {
    const query = vi.spyOn(workspaceService, 'query').mockResolvedValue({
      ok: true,
      message: 'Location matches.',
      data: [],
    });
    const execute = vi.spyOn(workspaceService, 'execute').mockResolvedValue({
      ok: true,
      message: 'Created a 25-minute bicycle area.',
    });
    render(<WebMCPBridge />);
    await waitFor(() => expect(tools.has('groundwork_search_locations')).toBe(true));

    await tools
      .get('groundwork_search_locations')!
      .execute({ query: '1 Market' }, { signal: new AbortController().signal });
    expect(query).toHaveBeenCalledWith({ type: 'search-locations', query: '1 Market' });

    act(() => {
      useWorkspaceStore.setState({
        canonical: { ...structuredClone(EMPTY_CANONICAL), office: SAMPLE_OFFICE },
        undo: structuredClone(EMPTY_CANONICAL),
      });
    });
    await waitFor(() => expect(tools.has('groundwork_add_bike_condition')).toBe(true));
    await tools
      .get('groundwork_add_bike_condition')!
      .execute({ maxMinutes: 25 }, { signal: new AbortController().signal });

    expect(execute).toHaveBeenCalledWith({ type: 'add-bike', maxMinutes: 25, actor: 'agent' });
    await expect(
      tools
        .get('groundwork_add_bike_condition')!
        .execute({ maxMinutes: 'fast' }, { signal: new AbortController().signal }),
    ).resolves.toEqual({ ok: false, message: 'Invalid tool input.' });
  });

  it('exposes analysis and candidate tools only when derived results are ready', async () => {
    const canonical = {
      ...structuredClone(EMPTY_CANONICAL),
      office: SAMPLE_OFFICE,
      conditions: [
        {
          id: 'bike-1',
          kind: 'bike' as const,
          label: '25-minute bicycle area',
          visible: true,
          maxMinutes: 25,
        },
        {
          id: 'park-1',
          kind: 'access' as const,
          category: 'park' as const,
          label: '8-minute park access',
          visible: true,
          maxMinutes: 8,
        },
      ],
      combined: true,
    };
    const derived: DerivedAnalysis = {
      ...structuredClone(EMPTY_DERIVED),
      feasibleRegion,
      feasibleAreaKm2: 1.2,
      candidates: [candidate],
    };
    useWorkspaceStore.setState({
      canonical,
      derived,
      analysisFreshness: 'fresh',
      undo: structuredClone(EMPTY_CANONICAL),
    });
    render(<WebMCPBridge />);

    await waitFor(() => expect(tools.has('groundwork_rank_candidates')).toBe(true));
    expect(tools.has('groundwork_analyze_restriction')).toBe(true);
    expect(tools.has('groundwork_explain_candidate')).toBe(true);
    expect(tools.has('groundwork_select_candidate')).toBe(true);
    expect(tools.has('groundwork_remove_candidate')).toBe(true);
    expect(tools.has('groundwork_undo')).toBe(true);
    expect(tools.has('groundwork_recalculate')).toBe(false);

    act(() => useWorkspaceStore.setState({ analysisFreshness: 'stale' }));
    await waitFor(() => expect(tools.has('groundwork_recalculate')).toBe(true));
    expect(tools.has('groundwork_rank_candidates')).toBe(false);
    expect(tools.has('groundwork_analyze_restriction')).toBe(false);
  });
});
