import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED } from '../domain/defaults';
import type { Candidate, DerivedAnalysis } from '../domain/schemas';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';
import { WebMCPBridge } from './WebMCPBridge';

type RegisteredTool = {
  name: string;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
};

const tools = new Map<string, RegisteredTool>();
const destination = {
  id: 'city-hall',
  label: 'San Francisco City Hall',
  coordinates: [-122.4192315, 37.7792763] as [number, number],
};

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
  Object.defineProperty(document, 'modelContext', { configurable: true, value: modelContext });
}

const candidate: Candidate = {
  id: 'candidate-1',
  name: 'South of Market — near 1st Street & Howard Street',
  coordinates: [-122.4, 37.78],
  score: 0.8,
  minimumSlack: 0.4,
  averageSlack: 0.6,
  metrics: [
    {
      conditionId: 'travel-1',
      label: '30-minute drive to City Hall',
      minutes: 12,
      nearestPlaceName: null,
      slack: 0.6,
    },
  ],
  comfortable: ['30-minute drive to City Hall'],
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
    drawingReady: true,
    analysisFreshness: 'not-combined',
    error: null,
    initialized: true,
    activeAgentAction: null,
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

  it('registers only capabilities valid for an empty workspace', async () => {
    render(<WebMCPBridge />);

    await waitFor(() => expect(tools.has('get_workspace')).toBe(true));
    expect([...tools.keys()].sort()).toEqual([
      'add_destination',
      'add_place_condition',
      'create_share_link',
      'get_workspace',
      'request_user_drawing',
      'search_locations',
    ]);
  });

  it('translates validated tool inputs into the shared command path', async () => {
    const query = vi.spyOn(workspaceService, 'query').mockResolvedValue({
      ok: true,
      message: 'Location matches.',
      data: [],
    });
    const execute = vi.spyOn(workspaceService, 'execute').mockResolvedValue({
      ok: true,
      message: 'Added a travel priority.',
    });
    render(<WebMCPBridge />);
    await waitFor(() => expect(tools.has('search_locations')).toBe(true));

    await tools.get('search_locations')?.execute({ query: 'City Hall' });
    expect(query).toHaveBeenCalledWith({ type: 'search-locations', query: 'City Hall' });

    act(() => {
      useWorkspaceStore.setState({
        canonical: { ...structuredClone(EMPTY_CANONICAL), destinations: [destination] },
        undo: structuredClone(EMPTY_CANONICAL),
      });
    });
    await waitFor(() => expect(tools.has('add_travel_condition')).toBe(true));
    await tools.get('add_travel_condition')?.execute({
      destinationId: destination.id,
      mode: 'car',
      maxMinutes: 30,
    });

    expect(execute).toHaveBeenCalledWith(
      {
        type: 'add-travel',
        destinationId: destination.id,
        mode: 'car',
        maxMinutes: 30,
        actor: 'agent',
      },
      expect.any(AbortSignal),
    );
    await expect(
      tools.get('add_travel_condition')?.execute({
        destinationId: destination.id,
        mode: 'rocket',
        maxMinutes: 30,
      }),
    ).resolves.toEqual({ ok: false, message: 'Invalid tool input.' });
  });

  it('keeps registrations stable while an operation is in flight', async () => {
    useWorkspaceStore.setState({
      canonical: { ...structuredClone(EMPTY_CANONICAL), destinations: [destination] },
    });
    render(<WebMCPBridge />);
    await waitFor(() => expect(tools.has('add_travel_condition')).toBe(true));

    act(() => useWorkspaceStore.setState({ operation: 'calculating' }));
    expect(tools.has('add_travel_condition')).toBe(true);

    act(() =>
      useWorkspaceStore.setState({
        canonical: structuredClone(EMPTY_CANONICAL),
        operation: 'idle',
      }),
    );
    await waitFor(() => expect(tools.has('add_travel_condition')).toBe(false));
  });

  it('exposes result tools only when a fresh feasible region exists', async () => {
    const canonical = {
      ...structuredClone(EMPTY_CANONICAL),
      destinations: [destination],
      conditions: [
        {
          id: 'travel-1',
          kind: 'travel' as const,
          destinationId: destination.id,
          mode: 'car' as const,
          label: '30-minute drive to City Hall',
          visible: true,
          maxMinutes: 30,
        },
        {
          id: 'park-1',
          kind: 'access' as const,
          category: 'park' as const,
          mode: 'walk' as const,
          label: '8-minute walk to parks',
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

    await waitFor(() => expect(tools.has('rank_areas')).toBe(true));
    expect(tools.has('analyze_restriction')).toBe(true);
    expect(tools.has('explain_area')).toBe(true);
    expect(tools.has('select_area')).toBe(true);
    expect(tools.has('remove_area')).toBe(true);
    expect(tools.has('undo')).toBe(true);
    expect(tools.has('recalculate')).toBe(false);

    act(() => useWorkspaceStore.setState({ analysisFreshness: 'stale' }));
    await waitFor(() => expect(tools.has('recalculate')).toBe(true));
    expect(tools.has('rank_areas')).toBe(false);
  });
});
