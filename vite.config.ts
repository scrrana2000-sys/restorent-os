/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

export default defineConfig(({ command, mode }) => {
  const isBuild = command === 'build' || mode === 'production';
  const base = process.env.VITE_BASE_PATH || (isBuild ? '/restorent-os/' : '/');

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'github-pages-spa-assets',
        closeBundle() {
          const distDir = path.resolve(__dirname, 'dist');
          const indexHtml = path.join(distDir, 'index.html');
          const notFoundHtml = path.join(distDir, '404.html');
          const noJekyll = path.join(distDir, '.nojekyll');

          if (fs.existsSync(distDir)) {
            fs.writeFileSync(noJekyll, '');
            if (fs.existsSync(indexHtml)) {
              fs.copyFileSync(indexHtml, notFoundHtml);
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
    server: {
      // Disable HMR WebSocket in AI Studio preview to prevent unhandled WebSocket closed exceptions
      // across sandboxed reverse-proxy environments. Set ENABLE_HMR=true if local HMR is desired.
      hmr: process.env.ENABLE_HMR === 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
