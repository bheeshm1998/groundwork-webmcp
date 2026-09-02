/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPTILER_KEY?: string;
  readonly VITE_GEOCODER_URL?: string;
  readonly VITE_WEBMCP_ORIGIN_TRIAL_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*?worker&url' {
  const workerUrl: string;
  export default workerUrl;
}
