import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      {
        name: 'groundwork-origin-trial-token',
        transformIndexHtml(html) {
          if (!env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN) {
            return html.replace(
              /\s*<meta http-equiv="origin-trial" content="__WEBMCP_ORIGIN_TRIAL_TOKEN__" \/>/u,
              '',
            );
          }
          return html.replace('__WEBMCP_ORIGIN_TRIAL_TOKEN__', env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN);
        },
      },
    ],
    worker: { format: 'es' },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  };
});
