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
        'groundwork_search_locations',
        'groundwork_get_workspace',
        'groundwork_explain_candidate',
        'groundwork_analyze_restriction',
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
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'groundwork_get_workspace',
        ),
      ),
    )
    .toBe(true);

  const search = await executeWebMcpTool(page, 'groundwork_search_locations', {
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

  await executeWebMcpTool(page, 'groundwork_set_office', {
    label: 'San Francisco City Hall',
    longitude: -122.4192315,
    latitude: 37.7792763,
  });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'groundwork_add_bike_condition',
        ),
      ),
    )
    .toBe(true);

  await executeWebMcpTool(page, 'groundwork_add_bike_condition', { maxMinutes: 25 });
  await executeWebMcpTool(page, 'groundwork_add_access_condition', {
    category: 'grocery',
    maxMinutes: 10,
    groceryType: 'supermarket',
  });
  await executeWebMcpTool(page, 'groundwork_add_access_condition', {
    category: 'park',
    maxMinutes: 8,
  });
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'groundwork_start_preference_draw',
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (window as any).__groundworkDrawPromise = (async () => {
      const context = document.modelContext as typeof document.modelContext & {
        executeTool: (tool: unknown, inputJson: string) => Promise<string | null>;
      };
      const tool = (await context.getTools()).find(
        (candidate) => candidate.name === 'groundwork_start_preference_draw',
      );
      if (!tool) throw new Error('Drawing tool is unavailable.');
      const serialized = await context.executeTool(tool, '{}');
      return serialized ? JSON.parse(serialized) : null;
    })();
  });
  await expect(page.getByText(/Draw your preferred area/u)).toBeVisible();
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
    .poll(() => page.evaluate(async () => (window as any).__groundworkDrawPromise), {
      timeout: 15_000,
    })
    .toMatchObject({ ok: true });
  await expect(page.getByText(/Draw your preferred area/u)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'groundwork_combine_conditions',
        ),
      ),
    )
    .toBe(true);

  await executeWebMcpTool(page, 'groundwork_combine_conditions');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.modelContext!.getTools()).some(
          (tool) => tool.name === 'groundwork_rank_candidates',
        ),
      ),
    )
    .toBe(true);
  await executeWebMcpTool(page, 'groundwork_rank_candidates');

  const workspace = await executeWebMcpTool(page, 'groundwork_get_workspace');
  expect(workspace).toMatchObject({
    ok: true,
    data: {
      freshness: 'fresh',
      office: { label: 'San Francisco City Hall' },
    },
  });
  expect((workspace as any).data.conditions).toHaveLength(4);
  expect((workspace as any).data.candidates).toHaveLength(3);
  expect((workspace as any).data.feasibleAreaKm2).toBeGreaterThan(0);

  const candidate = (workspace as any).data.candidates[0];
  const explanation = await executeWebMcpTool(page, 'groundwork_explain_candidate', {
    id: candidate.id,
  });
  expect(explanation).toMatchObject({ ok: true, data: { id: candidate.id } });

  const restriction = await executeWebMcpTool(page, 'groundwork_analyze_restriction');
  expect(restriction).toMatchObject({ ok: true });
  expect((restriction as any).data.areaLostKm2).toBeGreaterThan(0);

  await executeWebMcpTool(page, 'groundwork_select_candidate', { id: candidate.id });
  await expect(page.getByTestId('candidate-list')).toBeVisible();
  await expect(page.locator('.candidate-card.selected')).toHaveCount(1);
  await expect(page.getByText('Results are up to date', { exact: true })).toBeVisible();
  await expect(page.locator('.error-toast')).toHaveCount(0);
});
