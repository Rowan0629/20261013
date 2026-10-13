import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 的網址是 https://rowan0629.github.io/20261013/，網站放在 /20261013/ 底下。
// 正式建置要帶這段路徑，否則網頁找不到自己的 JS 與 CSS，會變成空白頁。
// 本機開發（npm run dev）直接用根目錄就好。
const REPO_BASE = '/20261013/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? REPO_BASE : '/',
  plugins: [react()],
}));
