import { loadEnv } from 'vite';

const fileEnvironment = loadEnv('production', process.cwd(), '');
const token = (
  process.env.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN ?? fileEnvironment.VITE_WEBMCP_ORIGIN_TRIAL_TOKEN
)?.trim();

if (!token) {
  console.error(
    'Release build blocked: VITE_WEBMCP_ORIGIN_TRIAL_TOKEN is required for the deployed WebMCP demo.',
  );
  process.exit(1);
}

console.log('Release environment is configured.');
