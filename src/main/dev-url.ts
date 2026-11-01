import { app } from 'electron';

/** Dev server URL, never honoured in a packaged build: an env var must not point IPC-preloaded windows at another origin. */
export const devRendererUrl = (packaged = app.isPackaged, env = process.env): string | undefined =>
  packaged ? undefined : env['ELECTRON_RENDERER_URL'];
