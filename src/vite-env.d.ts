/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock'（階段一，預設）或 'supabase'（階段二） */
  readonly VITE_BACKEND?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
