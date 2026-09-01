import { expect, test, type Page } from '@playwright/test';

async function executeWebMcpTool(page: Page, name: string, input: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tool = (window as any).__groundworkTools.get(toolName);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${toolName}`);
      const result = await tool.execute(toolInput, { signal: new AbortController().signal });
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
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      { execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => unknown }
    >();
    const modelContext = new EventTarget() as EventTarget & {
      registerTool: (
        tool: {
          name: string;
          execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => unknown;
        },
        options?: { signal?: AbortSignal },
      ) => Promise<void>;
      getTools: () => Promise<unknown[]>;
    };
    modelContext.registerTool = async (tool, options) => {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    };
    modelContext.getTools = async () => [...tools.keys()];
    Object.defineProperty(document, 'modelContext', { configurable: true, value: modelContext });
    Object.defineProperty(window, '__groundworkTools', { value: tools });
  });

  await page.goto('/');
  await expect(page.getByText('WebMCP connected')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__groundworkTools.has('groundwork_get_workspace')),
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
      page.evaluate(() => (window as any).__groundworkTools.has('groundwork_add_bike_condition')),
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
      page.evaluate(() => (window as any).__groundworkTools.has('groundwork_combine_conditions')),
    )
    .toBe(true);

  await executeWebMcpTool(page, 'groundwork_combine_conditions');
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__groundworkTools.has('groundwork_rank_candidates')),
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
  expect((workspace as any).data.conditions).toHaveLength(3);
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
  await expect(page.getByText('fresh', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
