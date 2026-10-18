import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 的網址是 https://hannah-061.github.io/Homework2/，
// 所以「打包」時網頁要從 /Homework2/ 開始找檔案；本機開發則用根路徑 /。
// 若 repo 改名，改 VITE_BASE 或下面的預設值（見 docs/architecture.md 第 12 節）。
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? '/Homework2/' : '/'),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
