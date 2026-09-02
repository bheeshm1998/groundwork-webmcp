import { useEffect, useRef } from 'react';
import type { MaybePromise, ModelContextTool } from '@mcp-b/webmcp-types';
import { z } from 'zod';
import { getCapabilities, type Capability } from '../domain/capabilities';
import { ACCESS_MODES, CoordinateSchema, PLACE_CATEGORIES, TRAVEL_MODES } from '../domain/schemas';
import { CITIES } from '../domain/cities';
import { workspaceService } from '../domain/workspace-service';
import { requestPreferenceDraw } from '../map/drawing';
import { useWorkspaceStore } from '../store/workspace-store';

const objectSchema = (properties: Readonly<Record<string, unknown>>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const travelMinutesProperty = {
  type: 'number',
  minimum: 5,
  maximum: 90,
  description: 'One-way network travel limit in minutes.',
};
const placeMinutesProperty = {
  type: 'number',
  minimum: 1,
  maximum: 45,
  description: 'One-way network travel limit in minutes.',
};
const updateMinutesProperty = {
  type: 'number',
  minimum: 1,
  maximum: 90,
  description: 'One-way minutes; travel conditions require 5–90 and place conditions 1–45.',
};

type SweetSpotTool = Omit<ModelContextTool<Record<string, unknown>>, 'execute'> & {
  execute: (
    input: Record<string, unknown>,
    registrationSignal: AbortSignal,
  ) => MaybePromise<unknown>;
};

async function safeToolResult<T>(operation: () => Promise<T> | T) {
  try {
    return await operation();
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof z.ZodError
          ? 'Invalid tool input.'
          : error instanceof Error && /cancel/iu.test(error.message)
            ? 'The operation was cancelled.'
            : 'The tool could not complete.',
    };
  }
}

async function runAgentAction<T>(label: string, operation: () => Promise<T> | T): Promise<T> {
  useWorkspaceStore.getState().commit({ activeAgentAction: label });
  try {
    return await operation();
  } finally {
    useWorkspaceStore.getState().commit({ activeAgentAction: null });
  }
}

const UpdateInputSchema = z
  .object({
    id: z.string().min(1),
    maxMinutes: z.number().min(1).max(90).optional(),
    destinationId: z.string().min(1).optional(),
    mode: z.enum(TRAVEL_MODES).optional(),
    category: z.enum(PLACE_CATEGORIES).optional(),
    groceryType: z.enum(['supermarket', 'supermarket_or_grocery']).optional(),
  })
  .refine(
    ({ maxMinutes, destinationId, mode, category, groceryType }) =>
      maxMinutes !== undefined ||
      destinationId !== undefined ||
      mode !== undefined ||
      category !== undefined ||
      groceryType !== undefined,
  );

export function WebMCPBridge() {
  const canonical = useWorkspaceStore((state) => state.canonical);
  const derived = useWorkspaceStore((state) => state.derived);
  const freshness = useWorkspaceStore((state) => state.analysisFreshness);
  const hasUndo = useWorkspaceStore((state) => Boolean(state.undo));
  const initialized = useWorkspaceStore((state) => state.initialized);
  const cityId = useWorkspaceStore((state) => state.cityId);
  const operation = useWorkspaceStore((state) => state.operation);
  const drawingReady = useWorkspaceStore((state) => state.drawingReady);
  const city = CITIES[cityId];
  const registrations = useRef(new Map<Capability, AbortController>());

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext || !initialized) return;
    const capabilities = getCapabilities(
      canonical,
      derived,
      freshness,
      hasUndo,
      operation,
      drawingReady,
    );
    const register = (capability: Capability, tool: SweetSpotTool) => {
      if (!capabilities.has(capability) || registrations.current.has(capability)) return;
      const controller = new AbortController();
      registrations.current.set(capability, controller);
      const browserTool: ModelContextTool<Record<string, unknown>> = {
        ...tool,
        execute: (input) => tool.execute(input, controller.signal),
      };
      const { inputSchema, ...toolWithoutSchema } = browserTool;
      const registration = inputSchema
        ? modelContext.registerTool(
            { ...toolWithoutSchema, inputSchema },
            { signal: controller.signal },
          )
        : modelContext.registerTool(toolWithoutSchema, { signal: controller.signal });
      void registration.catch(() => registrations.current.delete(capability));
    };

    register('get_workspace', {
      name: 'get_workspace',
      title: 'Read SweetSpot workspace',
      description:
        'Read the authoritative visible destinations, conditions, supported enums, and results. Call before recommending an area. Distance limits are unsupported: convert them to travel minutes, disclose the conversion, and never claim an absent constraint.',
      annotations: { readOnlyHint: true },
      execute: () =>
        runAgentAction('Reading the workspace', () =>
          workspaceService.query({ type: 'get-workspace' }),
        ),
    });
    register('search_locations', {
      name: 'search_locations',
      title: `Search ${city.name} locations`,
      description: `Search local and online OpenStreetMap results inside ${city.name} without changing the workspace. Ask before choosing among ambiguous matches; never guess coordinates.`,
      inputSchema: objectSchema({ query: { type: 'string', minLength: 2 } }, ['query']),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) =>
        runAgentAction('Searching locations', () =>
          safeToolResult(() =>
            workspaceService.query({
              type: 'search-locations',
              query: z.string().min(2).parse(input.query),
            }),
          ),
        ),
    });
    register('add_destination', {
      name: 'add_destination',
      title: 'Add destination',
      description: `Add one resolved ${city.name} destination. A workspace supports up to 4 destinations.`,
      inputSchema: objectSchema(
        { label: { type: 'string' }, longitude: { type: 'number' }, latitude: { type: 'number' } },
        ['label', 'longitude', 'latitude'],
      ),
      execute: (input, signal) =>
        runAgentAction('Adding a destination', () =>
          safeToolResult(() =>
            workspaceService.execute(
              {
                type: 'add-destination',
                actor: 'agent',
                destination: {
                  label: z.string().min(1).parse(input.label),
                  coordinates: CoordinateSchema.parse([input.longitude, input.latitude]),
                },
              },
              signal,
            ),
          ),
        ),
    });
    register('remove_destination', {
      name: 'remove_destination',
      title: 'Remove destination',
      description: 'Remove a destination by ID, along with travel conditions that reference it.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input, signal) =>
        runAgentAction('Removing a destination', () =>
          safeToolResult(() =>
            workspaceService.execute(
              { type: 'remove-destination', id: z.string().min(1).parse(input.id), actor: 'agent' },
              signal,
            ),
          ),
        ),
    });
    register('add_travel_condition', {
      name: 'add_travel_condition',
      title: 'Add travel condition',
      description: `Add a one-way network travel condition to one destination. mode must be ${TRAVEL_MODES.join(', ')}; maxMinutes must be 5–90. Car times are free-flow estimates without live traffic.`,
      inputSchema: objectSchema(
        {
          destinationId: { type: 'string' },
          mode: { type: 'string', enum: [...TRAVEL_MODES] },
          maxMinutes: travelMinutesProperty,
        },
        ['destinationId', 'mode', 'maxMinutes'],
      ),
      execute: (input, signal) =>
        runAgentAction('Adding a travel priority', () =>
          safeToolResult(() =>
            workspaceService.execute(
              {
                type: 'add-travel',
                actor: 'agent',
                destinationId: z.string().min(1).parse(input.destinationId),
                mode: z.enum(TRAVEL_MODES).parse(input.mode),
                maxMinutes: z.number().min(5).max(90).parse(input.maxMinutes),
              },
              signal,
            ),
          ),
        ),
    });
    register('add_place_condition', {
      name: 'add_place_condition',
      title: 'Add place condition',
      description: `Add network access to real OSM places in ${city.name}. category must be ${PLACE_CATEGORIES.join(', ')}; mode must be ${ACCESS_MODES.join(', ')}; maxMinutes must be 1–45. groceryType may be supermarket or supermarket_or_grocery.`,
      inputSchema: objectSchema(
        {
          category: { type: 'string', enum: [...PLACE_CATEGORIES] },
          mode: { type: 'string', enum: [...ACCESS_MODES] },
          maxMinutes: placeMinutesProperty,
          groceryType: { type: 'string', enum: ['supermarket', 'supermarket_or_grocery'] },
        },
        ['category', 'mode', 'maxMinutes'],
      ),
      execute: (input, signal) =>
        runAgentAction('Adding a place priority', () =>
          safeToolResult(() =>
            workspaceService.execute(
              {
                type: 'add-place',
                actor: 'agent',
                category: z.enum(PLACE_CATEGORIES).parse(input.category),
                mode: z.enum(ACCESS_MODES).parse(input.mode),
                maxMinutes: z.number().min(1).max(45).parse(input.maxMinutes),
                groceryType: input.groceryType
                  ? z.enum(['supermarket', 'supermarket_or_grocery']).parse(input.groceryType)
                  : undefined,
              },
              signal,
            ),
          ),
        ),
    });
    register('request_user_drawing', {
      name: 'request_user_drawing',
      title: 'Ask the user to draw',
      description:
        'Put the shared map into polygon mode and wait until the user finishes drawing an area they would consider.',
      execute: (_input, signal) =>
        runAgentAction('Waiting for you to draw', () =>
          safeToolResult(async () => {
            const geometry = await requestPreferenceDraw(signal);
            const result = await workspaceService.execute(
              { type: 'add-preference', geometry, actor: 'agent' },
              signal,
            );
            return result.ok
              ? { ...result, data: { geometryType: geometry.geometry.type } }
              : result;
          }),
        ),
    });
    register('update_condition', {
      name: 'update_condition',
      title: 'Update condition',
      description: `Update any editable fields on a condition by ID. Travel modes: ${TRAVEL_MODES.join(', ')} with 5–90 minutes. Place categories: ${PLACE_CATEGORIES.join(', ')} using walk or bike with 1–45 minutes.`,
      inputSchema: objectSchema(
        {
          id: { type: 'string' },
          maxMinutes: updateMinutesProperty,
          destinationId: { type: 'string' },
          mode: { type: 'string', enum: [...TRAVEL_MODES] },
          category: { type: 'string', enum: [...PLACE_CATEGORIES] },
          groceryType: { type: 'string', enum: ['supermarket', 'supermarket_or_grocery'] },
        },
        ['id'],
      ),
      execute: (input, signal) =>
        runAgentAction('Updating a priority', () =>
          safeToolResult(() => {
            const parsed = UpdateInputSchema.parse(input);
            return workspaceService.execute(
              { type: 'update-condition', ...parsed, actor: 'agent' },
              signal,
            );
          }),
        ),
    });
    register('delete_condition', {
      name: 'delete_condition',
      title: 'Delete condition',
      description: 'Delete one condition by ID. Up to 20 conditions may exist in a workspace.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input, signal) =>
        runAgentAction('Deleting a priority', () =>
          safeToolResult(() =>
            workspaceService.execute(
              { type: 'delete-condition', id: z.string().min(1).parse(input.id), actor: 'agent' },
              signal,
            ),
          ),
        ),
    });
    register('set_layer_visibility', {
      name: 'set_layer_visibility',
      title: 'Show or hide layer',
      description: 'Show or hide a condition layer without changing its calculation.',
      inputSchema: objectSchema({ id: { type: 'string' }, visible: { type: 'boolean' } }, [
        'id',
        'visible',
      ]),
      execute: (input, signal) =>
        runAgentAction('Changing layer visibility', () =>
          safeToolResult(() =>
            workspaceService.execute(
              {
                type: 'set-visibility',
                actor: 'agent',
                id: z.string().min(1).parse(input.id),
                visible: z.boolean().parse(input.visible),
              },
              signal,
            ),
          ),
        ),
    });
    register('combine_conditions', {
      name: 'combine_conditions',
      title: 'Combine conditions',
      description:
        'Intersect all current conditions. At least 2 and no more than 20 are supported.',
      execute: (_input, signal) =>
        runAgentAction('Combining priorities', () =>
          workspaceService.execute({ type: 'combine', actor: 'agent' }, signal),
        ),
    });
    register('recalculate', {
      name: 'recalculate',
      title: 'Recalculate analysis',
      description: 'Refresh stale network results after a destination or travel condition changes.',
      execute: (_input, signal) =>
        runAgentAction('Updating matching areas', () =>
          workspaceService.execute({ type: 'recalculate', actor: 'agent' }, signal),
        ),
    });
    register('rank_areas', {
      name: 'rank_areas',
      title: 'Rank areas',
      description: 'Rank the 3 strongest balanced areas inside the fresh feasible region.',
      execute: (_input, signal) =>
        runAgentAction('Ranking areas', () =>
          workspaceService.execute({ type: 'rank', actor: 'agent' }, signal),
        ),
    });
    register('analyze_restriction', {
      name: 'analyze_restriction',
      title: 'Analyze strongest restriction',
      description: 'Read the condition that removes the largest otherwise-feasible area.',
      annotations: { readOnlyHint: true },
      execute: () =>
        runAgentAction('Analyzing restrictions', () =>
          workspaceService.query({ type: 'analyze-restriction' }),
        ),
    });
    register('select_area', {
      name: 'select_area',
      title: 'Select area',
      description: 'Select one ranked area by ID.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input, signal) =>
        runAgentAction('Selecting an area', () =>
          safeToolResult(() =>
            workspaceService.execute(
              { type: 'select-candidate', id: z.string().min(1).parse(input.id), actor: 'agent' },
              signal,
            ),
          ),
        ),
    });
    register('explain_area', {
      name: 'explain_area',
      title: 'Explain area',
      description: 'Read every calculated condition metric and trade-off for one ranked area.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      annotations: { readOnlyHint: true },
      execute: (input) =>
        runAgentAction('Explaining an area', () =>
          safeToolResult(() =>
            workspaceService.query({
              type: 'explain-area',
              id: z.string().min(1).parse(input.id),
            }),
          ),
        ),
    });
    register('remove_area', {
      name: 'remove_area',
      title: 'Remove area',
      description: 'Remove one ranked area and fill its place with the next strongest option.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input, signal) =>
        runAgentAction('Removing an area', () =>
          safeToolResult(() =>
            workspaceService.execute(
              { type: 'remove-candidate', id: z.string().min(1).parse(input.id), actor: 'agent' },
              signal,
            ),
          ),
        ),
    });
    register('undo', {
      name: 'undo',
      title: 'Undo last change',
      description: 'Undo the single most recent meaningful workspace change.',
      execute: (_input, signal) =>
        runAgentAction('Undoing the last change', () =>
          workspaceService.execute({ type: 'undo', actor: 'agent' }, signal),
        ),
    });
    register('create_share_link', {
      name: 'create_share_link',
      title: 'Create share link',
      description: 'Return a URL containing the current workspace. This does not copy or navigate.',
      annotations: { readOnlyHint: true },
      execute: () =>
        runAgentAction('Creating a share link', () =>
          workspaceService.query({ type: 'create-share-link' }),
        ),
    });

    if (operation !== 'calculating' && operation !== 'drawing') {
      for (const [capability, controller] of registrations.current) {
        if (!capabilities.has(capability)) {
          controller.abort();
          registrations.current.delete(capability);
        }
      }
    }
  }, [canonical, city.name, derived, drawingReady, freshness, hasUndo, initialized, operation]);

  useEffect(
    () => () => {
      for (const controller of registrations.current.values()) controller.abort();
      registrations.current.clear();
    },
    [],
  );

  return null;
}
