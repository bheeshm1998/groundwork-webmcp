import { expect, test } from '@playwright/test';

test('registers and executes the state-aware WebMCP surface', async ({ page }) => {
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
  const result = await page.evaluate(async () => {
    const tool = (window as any).__groundworkTools.get('groundwork_get_workspace');
    return tool.execute({}, { signal: new AbortController().signal });
  });
  expect(result.ok).toBe(true);
  expect(result.data.freshness).toBe('not-combined');
});
