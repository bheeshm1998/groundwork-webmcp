import { initializeWebMCPPolyfill } from '@mcp-b/webmcp-polyfill';
import type { ModelContext as WebMcpModelContext } from '@mcp-b/webmcp-types';

type PolyfilledModelContext = WebMcpModelContext & {
  readonly __isWebMCPPolyfill?: boolean;
};

export type WebMcpRuntime = 'native' | 'polyfill' | 'unavailable';

export function initializeWebMcpRuntime(): void {
  initializeWebMCPPolyfill();
}

export function getWebMcpRuntime(): WebMcpRuntime {
  const context = document.modelContext as PolyfilledModelContext | undefined;
  if (!context) return 'unavailable';
  return context.__isWebMCPPolyfill ? 'polyfill' : 'native';
}

export function getWebMcpStatusLabel(): string {
  const runtime = getWebMcpRuntime();
  if (runtime === 'native') return 'Native browser assistant tools ready';
  if (runtime === 'polyfill') return 'MCP-B browser assistant tools ready';
  return 'Browser assistant tools unavailable';
}
