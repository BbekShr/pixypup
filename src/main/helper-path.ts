import { app } from 'electron';
import { join } from 'node:path';

export function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'pixyhelper')
    : join(app.getAppPath(), 'native', 'bin', 'pixyhelper');
}
