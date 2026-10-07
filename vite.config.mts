import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'frontend'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(import.meta.dirname, 'frontend/src/app'),
      '@pages': path.resolve(import.meta.dirname, 'frontend/src/pages'),
      '@shared': path.resolve(import.meta.dirname, 'frontend/src/shared')
    }
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'renderer-dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(moduleId) {
          const normalizedModuleId = moduleId.replaceAll('\\', '/');
          if (
            normalizedModuleId.includes('/node_modules/react/') ||
            normalizedModuleId.includes('/node_modules/react-dom/')
          ) {
            return 'vendor-react';
          }
          return undefined;
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
