import { expect, test, type Page } from '@playwright/test';

async function executeWebMcpTool(page: Page, name: string, input: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const modelContext = document.modelContext as typeof document.modelContext & {
        executeTool: (
          tool: Awaited<ReturnType<NonNullable<typeof document.modelContext>['getTools']>>[number],
          inputJson: string,
        ) => Promise<string | null>;
      };
      const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${toolName}`);
      const serialized = await modelContext.executeTool(tool, JSON.stringify(toolInput));
      const result = serialized ? JSON.parse(serialized) : null;
      const dataTools = new Set([
        'search_locations',
        'get_workspace',
        'explain_area',
        'analyze_restriction',
      ]);
      return dataTools.has(toolName) ? result : { ok: result.ok, message: result.message };
    },
    { toolName: name, toolInput: input },
  );
}

test('uses WebMCP to find and rank a bikeable, walkable area', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/app');
  await expect(page.getByTitle('MCP-B browser assistant tools ready')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some((tool) => tool.name === 'get_workspace'),
      ),
    )
    .toBe(true);

  const search = await executeWebMcpTool(page, 'search_locations', {
    query: 'San Francisco City Hall',
  });
  expect(search).toMatchObject({
    ok: true,
    data: [
      {
        label: 'San Francisco City Hall',
        coordinates: [-122.4192315, 37.7792763],
      },
    ],
  });

  await executeWebMcpTool(page, 'add_destination', {
    label: 'San Francisco City Hall',
    longitude: -122.4192315,
    latitude: 37.7792763,
  });
  const afterDestination = (await executeWebMcpTool(page, 'get_workspace')) as {
    data: { destinations: Array<{ id: string }> };
  };
  const destinationId = afterDestination.data.destinations[0]?.id;
  if (!destinationId) throw new Error('The destination was not added.');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'add_travel_condition',
        ),
      ),
    )
    .toBe(true);

  await executeWebMcpTool(page, 'add_travel_condition', {
    destinationId,
    mode: 'car',
    maxMinutes: 30,
  });
  await executeWebMcpTool(page, 'add_place_condition', {
    category: 'grocery',
    mode: 'walk',
    maxMinutes: 10,
    groceryType: 'supermarket',
  });
  await executeWebMcpTool(page, 'add_place_condition', {
    category: 'park',
    mode: 'walk',
    maxMinutes: 8,
  });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'request_user_drawing',
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (window as Window & { __sweetSpotDrawPromise?: Promise<unknown> }).__sweetSpotDrawPromise =
      (async () => {
        const context = document.modelContext as typeof document.modelContext & {
          executeTool: (tool: unknown, inputJson: string) => Promise<string | null>;
        };
        const tool = (await context.getTools()).find(
          (candidate) => candidate.name === 'request_user_drawing',
        );
        if (!tool) throw new Error('Drawing tool is unavailable.');
        const serialized = await context.executeTool(tool, '{}');
        return serialized ? JSON.parse(serialized) : null;
      })();
  });
  await expect(page.getByText(/agent is waiting for you/u)).toBeVisible();
  const mapBounds = await page.getByRole('region', { name: 'Map' }).boundingBox();
  if (!mapBounds) throw new Error('The analysis map has no visible bounds.');
  await page.mouse.click(
    mapBounds.x + mapBounds.width * 0.3,
    mapBounds.y + mapBounds.height * 0.33,
  );
  await page.mouse.click(
    mapBounds.x + mapBounds.width * 0.63,
    mapBounds.y + mapBounds.height * 0.36,
  );
  await page.mouse.dblclick(
    mapBounds.x + mapBounds.width * 0.45,
    mapBounds.y + mapBounds.height * 0.62,
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (window as Window & { __sweetSpotDrawPromise?: Promise<unknown> })
              .__sweetSpotDrawPromise,
        ),
      {
        timeout: 15_000,
      },
    )
    .toMatchObject({ ok: true });
  await expect(page.getByText(/Draw your preferred area/u)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'combine_conditions',
        ),
      ),
    )
    .toBe(true);

  await executeWebMcpTool(page, 'combine_conditions');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some((tool) => tool.name === 'rank_areas'),
      ),
    )
    .toBe(true);
  await executeWebMcpTool(page, 'rank_areas');

  const workspace = await executeWebMcpTool(page, 'get_workspace');
  expect(workspace).toMatchObject({
    ok: true,
    data: {
      freshness: 'fresh',
      destinations: [{ label: 'San Francisco City Hall' }],
    },
  });
  const workspaceData = (
    workspace as {
      data: {
        conditions: unknown[];
        candidates: Array<{ id: string; metrics: unknown[] }>;
        feasibleAreaKm2: number;
      };
    }
  ).data;
  expect(workspaceData.conditions).toHaveLength(4);
  expect(workspaceData.candidates).toHaveLength(3);
  expect(workspaceData.feasibleAreaKm2).toBeGreaterThan(0);

  const candidate = workspaceData.candidates[0];
  if (!candidate) throw new Error('No candidate was ranked.');
  expect(candidate.metrics).toHaveLength(3);
  const explanation = await executeWebMcpTool(page, 'explain_area', {
    id: candidate.id,
  });
  expect(explanation).toMatchObject({ ok: true, data: { id: candidate.id } });

  const restriction = await executeWebMcpTool(page, 'analyze_restriction');
  expect(restriction).toMatchObject({ ok: true });
  expect((restriction as { data: { areaLostKm2: number } }).data.areaLostKm2).toBeGreaterThan(0);

  await executeWebMcpTool(page, 'select_area', { id: candidate.id });
  await expect(page.getByTestId('candidate-list')).toBeVisible();
  await expect(page.locator('.candidate-card.selected')).toHaveCount(1);
  await expect(page.getByText('Results are up to date', { exact: true })).toBeVisible();
  await expect(page.locator('.error-toast')).toHaveCount(0);
});
