/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock = 階段一的假後台（預設）；supabase = 階段二的真後台 */
  readonly VITE_BACKEND?: 'mock' | 'supabase';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
