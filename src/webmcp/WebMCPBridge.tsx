import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { getCapabilities, type Capability } from '../domain/capabilities';
import { CoordinateSchema } from '../domain/schemas';
import { CITIES } from '../domain/cities';
import { workspaceService } from '../domain/workspace-service';
import { requestPreferenceDraw } from '../map/drawing';
import { useWorkspaceStore } from '../store/workspace-store';

const objectSchema = (properties: object, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const bikeMinutesProperty = {
  type: 'number',
  minimum: 5,
  maximum: 90,
  description: 'One-way time limit in minutes.',
};
const accessMinutesProperty = {
  type: 'number',
  minimum: 1,
  maximum: 45,
  description: 'One-way time limit in minutes.',
};
const updateMinutesProperty = {
  type: 'number',
  minimum: 1,
  maximum: 90,
  description: 'One-way time limit in minutes; bicycle conditions require at least 5.',
};

async function safeToolResult<T>(operation: () => Promise<T> | T) {
  try {
    return await operation();
  } catch (error) {
    return {
      ok: false,
      message: error instanceof z.ZodError ? 'Invalid tool input.' : 'The tool could not complete.',
    };
  }
}

export function WebMCPBridge() {
  const canonical = useWorkspaceStore((state) => state.canonical);
  const derived = useWorkspaceStore((state) => state.derived);
  const freshness = useWorkspaceStore((state) => state.analysisFreshness);
  const hasUndo = useWorkspaceStore((state) => Boolean(state.undo));
  const initialized = useWorkspaceStore((state) => state.initialized);
  const cityId = useWorkspaceStore((state) => state.cityId);
  const city = CITIES[cityId];
  const registrations = useRef(new Map<Capability, AbortController>());

  useEffect(() => {
    if (!document.modelContext || !initialized) return;
    const capabilities = getCapabilities(canonical, derived, freshness, hasUndo);
    const register = (
      capability: Parameters<typeof capabilities.has>[0],
      tool: WebMCP.ModelContextTool,
    ) => {
      if (!capabilities.has(capability) || registrations.current.has(capability)) return;
      const controller = new AbortController();
      registrations.current.set(capability, controller);
      void document.modelContext
        ?.registerTool(tool, { signal: controller.signal })
        .catch(() => registrations.current.delete(capability));
    };

    register('get-workspace', {
      name: 'groundwork_get_workspace',
      title: 'Read SweetSpot workspace',
      description:
        'Read a compact summary of the visible SweetSpot map workspace and current results.',
      annotations: { readOnlyHint: true },
      execute: () => workspaceService.query({ type: 'get-workspace' }),
    });
    register('search-locations', {
      name: 'groundwork_search_locations',
      title: `Search ${city.name} locations`,
      description: `Search for an office location inside ${city.name} without changing the workspace.`,
      inputSchema: objectSchema({ query: { type: 'string', minLength: 2 } }, ['query']),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.query({
            type: 'search-locations',
            query: z.string().min(2).parse(input.query),
          }),
        ),
    });
    register('set-office', {
      name: 'groundwork_set_office',
      title: 'Set office',
      description: `Set the office marker after resolving an unambiguous ${city.name} location.`,
      inputSchema: objectSchema(
        { label: { type: 'string' }, longitude: { type: 'number' }, latitude: { type: 'number' } },
        ['label', 'longitude', 'latitude'],
      ),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'set-office',
            actor: 'agent',
            office: {
              label: z.string().min(1).parse(input.label),
              coordinates: CoordinateSchema.parse([input.longitude, input.latitude]),
            },
          }),
        ),
    });
    register('add-bike', {
      name: 'groundwork_add_bike_condition',
      title: 'Add bicycle condition',
      description: 'Create a deterministic bicycle travel area from the current office.',
      inputSchema: objectSchema({ maxMinutes: bikeMinutesProperty }, ['maxMinutes']),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'add-bike',
            maxMinutes: z.number().min(5).max(90).parse(input.maxMinutes),
            actor: 'agent',
          }),
        ),
    });
    register('add-access', {
      name: 'groundwork_add_access_condition',
      title: 'Add nearby-place condition',
      description: `Create a pedestrian-network walking area from real OSM groceries or parks in ${city.name}.`,
      inputSchema: objectSchema(
        {
          category: { type: 'string', enum: ['grocery', 'park'] },
          maxMinutes: accessMinutesProperty,
          groceryType: { type: 'string', enum: ['supermarket', 'supermarket_or_grocery'] },
        },
        ['category', 'maxMinutes'],
      ),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'add-access',
            actor: 'agent',
            category: z.enum(['grocery', 'park']).parse(input.category),
            maxMinutes: z.number().min(1).max(45).parse(input.maxMinutes),
            groceryType: input.groceryType
              ? z.enum(['supermarket', 'supermarket_or_grocery']).parse(input.groceryType)
              : undefined,
          }),
        ),
    });
    register('start-draw', {
      name: 'groundwork_start_preference_draw',
      title: 'Ask the user to draw',
      description:
        'Put the live map into polygon drawing mode and wait for the user to draw the area they would consider.',
      execute: async (_input, { signal }) => {
        const geometry = await requestPreferenceDraw(signal);
        return {
          ok: true,
          message: 'The user preference area was added.',
          data: { geometryType: geometry.geometry.type },
        };
      },
    });
    register('update-condition', {
      name: 'groundwork_update_condition',
      title: 'Update condition',
      description:
        'Update the one-way time limit for an existing bicycle, grocery, or park condition.',
      inputSchema: objectSchema({ id: { type: 'string' }, maxMinutes: updateMinutesProperty }, [
        'id',
        'maxMinutes',
      ]),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'update-condition',
            actor: 'agent',
            id: z.string().min(1).parse(input.id),
            maxMinutes: z.number().min(1).max(90).parse(input.maxMinutes),
          }),
        ),
    });
    register('delete-condition', {
      name: 'groundwork_delete_condition',
      title: 'Delete condition',
      description: 'Delete one condition from the analysis by ID.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'delete-condition',
            id: z.string().min(1).parse(input.id),
            actor: 'agent',
          }),
        ),
    });
    register('set-visibility', {
      name: 'groundwork_set_layer_visibility',
      title: 'Show or hide layer',
      description: 'Show or hide a condition layer without changing the calculation.',
      inputSchema: objectSchema({ id: { type: 'string' }, visible: { type: 'boolean' } }, [
        'id',
        'visible',
      ]),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'set-visibility',
            actor: 'agent',
            id: z.string().min(1).parse(input.id),
            visible: z.boolean().parse(input.visible),
          }),
        ),
    });
    register('combine', {
      name: 'groundwork_combine_conditions',
      title: 'Combine conditions',
      description: 'Intersect all current conditions to create the feasible region.',
      execute: () => workspaceService.execute({ type: 'combine', actor: 'agent' }),
    });
    register('recalculate', {
      name: 'groundwork_recalculate',
      title: 'Recalculate analysis',
      description:
        'Refresh stale network-dependent results after the office or bicycle limit changes.',
      execute: () => workspaceService.execute({ type: 'recalculate', actor: 'agent' }),
    });
    register('rank', {
      name: 'groundwork_rank_candidates',
      title: 'Rank candidates',
      description: 'Rank three balanced candidate areas inside the fresh feasible region.',
      execute: () => workspaceService.execute({ type: 'rank', actor: 'agent' }),
    });
    register('analyze-restriction', {
      name: 'groundwork_analyze_restriction',
      title: 'Analyze strongest restriction',
      description:
        'Read the calculated condition that removes the largest otherwise-feasible area.',
      annotations: { readOnlyHint: true },
      execute: () => workspaceService.query({ type: 'analyze-restriction' }),
    });
    register('select-candidate', {
      name: 'groundwork_select_candidate',
      title: 'Select candidate',
      description: 'Select a ranked candidate by ID.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'select-candidate',
            id: z.string().min(1).parse(input.id),
            actor: 'agent',
          }),
        ),
    });
    register('explain-candidate', {
      name: 'groundwork_explain_candidate',
      title: 'Explain candidate',
      description: 'Read calculated metrics and trade-offs for a candidate.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      annotations: { readOnlyHint: true },
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.query({
            type: 'explain-candidate',
            id: z.string().min(1).parse(input.id),
          }),
        ),
    });
    register('remove-candidate', {
      name: 'groundwork_remove_candidate',
      title: 'Remove candidate',
      description: 'Remove a candidate and fill its place with the next-ranked area.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input) =>
        safeToolResult(() =>
          workspaceService.execute({
            type: 'remove-candidate',
            id: z.string().min(1).parse(input.id),
            actor: 'agent',
          }),
        ),
    });
    register('undo', {
      name: 'groundwork_undo',
      title: 'Undo last change',
      description: 'Undo the single most recent meaningful workspace change.',
      execute: () => workspaceService.execute({ type: 'undo', actor: 'agent' }),
    });
    register('create-share-link', {
      name: 'groundwork_create_share_link',
      title: 'Create share link',
      description: 'Return a URL containing the current workspace. Does not copy or navigate.',
      annotations: { readOnlyHint: true },
      execute: () => workspaceService.query({ type: 'create-share-link' }),
    });

    for (const [capability, controller] of registrations.current) {
      if (!capabilities.has(capability)) {
        controller.abort();
        registrations.current.delete(capability);
      }
    }
  }, [canonical, city.name, derived, freshness, hasUndo, initialized]);

  useEffect(
    () => () => {
      for (const controller of registrations.current.values()) controller.abort();
      registrations.current.clear();
    },
    [],
  );

  return null;
}
