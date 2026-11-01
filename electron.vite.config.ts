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
      lib: { entry: { preload: resolve('src/main/preload.ts'), 'onboarding-preload': resolve('src/main/onboarding-preload.ts'), 'screen-preload': resolve('src/main/screen-preload.ts') } },
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
          screen: resolve('src/onboarding/screen.html'),
        },
      },
    },
  },
});
