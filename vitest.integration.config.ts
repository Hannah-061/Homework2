import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// 整合測試：會真的連到 Supabase 專案（用 .env.local 裡的網址與公開金鑰）。
// 執行：npm run test:integration
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.ts'],
    env: loadEnv(mode, process.cwd(), 'VITE_'),
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
}));
