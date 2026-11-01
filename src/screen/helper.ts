import { execFile } from 'node:child_process';

export type RunResult = { code: number; stdout: Buffer; stderr: string };
export type Run = (
  args: string[],
  opts?: { binary?: boolean; timeoutMs?: number },
) => Promise<RunResult>;

// Never rejects: any failure (missing binary, timeout) is a non-zero code, so callers return null/[].
export function makeRun(helperPath: string): Run {
  return (args, opts) =>
    new Promise((resolve) => {
      execFile(
        helperPath,
        args,
        { timeout: opts?.timeoutMs ?? 4000, maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
        (err, stdout, stderr) => {
          const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
          resolve({ code, stdout: stdout ?? Buffer.alloc(0), stderr: (stderr ?? '').toString() });
        },
      );
    });
}

export function parseJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}
