import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      lib: { entry: resolve('src/main/main.ts') },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: { entry: resolve('src/main/preload.ts') },
    },
  },
  renderer: {
    root: 'src',
    build: {
      outDir: resolve('dist/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          overlay: resolve('src/overlay/index.html'),
          onboarding: resolve('src/onboarding/index.html'),
        },
      },
    },
  },
});
