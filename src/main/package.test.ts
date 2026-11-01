import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('electron-builder files', () => {
  it('never ships assets/photos', () => {
    const files: string[] = JSON.parse(readFileSync('package.json', 'utf8')).build.files;
    expect(files).toEqual(['dist/**/*', 'assets/pets/**/*', 'assets/placeholder/**/*', 'package.json']);
    for (const f of files) expect(f.startsWith('!') || !f.includes('photos')).toBe(true);
    expect(files.some((f) => f === 'assets/**/*' || f === 'assets/**' || f === 'assets/photos' || f === '**/*')).toBe(false);
  });
  it('explains the microphone prompt', () => {
    const mac = JSON.parse(readFileSync('package.json', 'utf8')).build.mac;
    expect(mac.extendInfo.NSMicrophoneUsageDescription).toMatch(/⌥ Space/);
  });
});
