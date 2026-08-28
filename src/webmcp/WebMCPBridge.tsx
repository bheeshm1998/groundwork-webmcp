import { useEffect } from 'react';
import { z } from 'zod';
import { getCapabilities } from '../domain/capabilities';
import { CoordinateSchema } from '../domain/schemas';
import { workspaceService } from '../domain/workspace-service';
import { requestPreferenceDraw } from '../map/drawing';
import { useWorkspaceStore } from '../store/workspace-store';

const objectSchema = (properties: object, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const minutesProperty = {
  type: 'number',
  minimum: 1,
  maximum: 90,
  description: 'One-way time limit in minutes.',
};

export function WebMCPBridge() {
  const canonical = useWorkspaceStore((state) => state.canonical);
  const derived = useWorkspaceStore((state) => state.derived);
  const freshness = useWorkspaceStore((state) => state.analysisFreshness);
  const hasUndo = useWorkspaceStore((state) => Boolean(state.undo));

  useEffect(() => {
    if (!document.modelContext) return;
    const capabilities = getCapabilities(canonical, derived, freshness, hasUndo);
    const controllers: AbortController[] = [];
    const register = (
      capability: Parameters<typeof capabilities.has>[0],
      tool: WebMCP.ModelContextTool,
    ) => {
      if (!capabilities.has(capability)) return;
      const controller = new AbortController();
      controllers.push(controller);
      void document.modelContext?.registerTool(tool, { signal: controller.signal });
    };

    register('get-workspace', {
      name: 'groundwork_get_workspace',
      title: 'Read Groundwork workspace',
      description:
        'Read a compact summary of the visible Groundwork map workspace and current results.',
      annotations: { readOnlyHint: true },
      execute: () => workspaceService.query({ type: 'get-workspace' }),
    });
    register('search-locations', {
      name: 'groundwork_search_locations',
      title: 'Search San Francisco locations',
      description:
        'Search for an office location inside San Francisco without changing the workspace.',
      inputSchema: objectSchema({ query: { type: 'string', minLength: 2 } }, ['query']),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) =>
        workspaceService.query({ type: 'search-locations', query: z.string().parse(input.query) }),
    });
    register('set-office', {
      name: 'groundwork_set_office',
      title: 'Set office',
      description: 'Set the office marker after resolving an unambiguous San Francisco location.',
      inputSchema: objectSchema(
        { label: { type: 'string' }, longitude: { type: 'number' }, latitude: { type: 'number' } },
        ['label', 'longitude', 'latitude'],
      ),
      execute: (input) =>
        workspaceService.execute({
          type: 'set-office',
          actor: 'agent',
          office: {
            label: z.string().parse(input.label),
            coordinates: CoordinateSchema.parse([input.longitude, input.latitude]),
          },
        }),
    });
    register('add-bike', {
      name: 'groundwork_add_bike_condition',
      title: 'Add bicycle condition',
      description: 'Create a deterministic bicycle travel area from the current office.',
      inputSchema: objectSchema({ maxMinutes: minutesProperty }, ['maxMinutes']),
      execute: (input) =>
        workspaceService.execute({
          type: 'add-bike',
          maxMinutes: z.number().parse(input.maxMinutes),
          actor: 'agent',
        }),
    });
    register('add-access', {
      name: 'groundwork_add_access_condition',
      title: 'Add nearby-place condition',
      description:
        'Create a straight-line walking estimate around groceries or parks in San Francisco.',
      inputSchema: objectSchema(
        {
          category: { type: 'string', enum: ['grocery', 'park'] },
          maxMinutes: minutesProperty,
          groceryType: { type: 'string', enum: ['supermarket', 'supermarket_or_grocery'] },
        },
        ['category', 'maxMinutes'],
      ),
      execute: (input) =>
        workspaceService.execute({
          type: 'add-access',
          actor: 'agent',
          category: z.enum(['grocery', 'park']).parse(input.category),
          maxMinutes: z.number().parse(input.maxMinutes),
          groceryType: input.groceryType
            ? z.enum(['supermarket', 'supermarket_or_grocery']).parse(input.groceryType)
            : undefined,
        }),
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
      inputSchema: objectSchema({ id: { type: 'string' }, maxMinutes: minutesProperty }, [
        'id',
        'maxMinutes',
      ]),
      execute: (input) =>
        workspaceService.execute({
          type: 'update-condition',
          actor: 'agent',
          id: z.string().parse(input.id),
          maxMinutes: z.number().parse(input.maxMinutes),
        }),
    });
    register('delete-condition', {
      name: 'groundwork_delete_condition',
      title: 'Delete condition',
      description: 'Delete one condition from the analysis by ID.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input) =>
        workspaceService.execute({
          type: 'delete-condition',
          id: z.string().parse(input.id),
          actor: 'agent',
        }),
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
        workspaceService.execute({
          type: 'set-visibility',
          actor: 'agent',
          id: z.string().parse(input.id),
          visible: z.boolean().parse(input.visible),
        }),
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
        workspaceService.execute({
          type: 'select-candidate',
          id: z.string().parse(input.id),
          actor: 'agent',
        }),
    });
    register('explain-candidate', {
      name: 'groundwork_explain_candidate',
      title: 'Explain candidate',
      description: 'Read calculated metrics and trade-offs for a candidate.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      annotations: { readOnlyHint: true },
      execute: (input) =>
        workspaceService.query({ type: 'explain-candidate', id: z.string().parse(input.id) }),
    });
    register('remove-candidate', {
      name: 'groundwork_remove_candidate',
      title: 'Remove candidate',
      description: 'Remove a candidate and fill its place with the next-ranked area.',
      inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
      execute: (input) =>
        workspaceService.execute({
          type: 'remove-candidate',
          id: z.string().parse(input.id),
          actor: 'agent',
        }),
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

    return () => controllers.forEach((controller) => controller.abort());
  }, [canonical, derived, freshness, hasUndo]);

  return null;
}
