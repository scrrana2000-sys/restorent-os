/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig} from 'vite';

export default defineConfig(({ command, mode }) => {
  // Default base is root ('/') for the Cloud Run deployment, where the Express server in
  // server.ts serves the built app from the domain root. The GitHub Pages workflow
  // (.github/workflows/deploy.yml) explicitly overrides this with VITE_BASE_PATH=/restorent-os/
  // for that project-subpage build, so it is unaffected by this default.
  const base = process.env.VITE_BASE_PATH || '/';

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
      middlewareMode: true,
      hmr: process.env.ENABLE_HMR === 'true' ? { overlay: true } : false,
      watch: {
        ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      },
    },
  };
});
