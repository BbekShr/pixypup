// SAM 3.1 image segmentation over the Responses API.
// Wire format (dev.meta.ai/docs/sam/reading-segmentation): one box token + one mask token per
// match, mask payload base85. Decoding is delegated to Meta's official @meta-sam/parser.

import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from '@meta-sam/parser';
import type { MetaClient, StreamEvent } from './meta-client.js';

export const SAM_MODEL = 'sam-3.1';

export interface Box {
  /** Source-image pixels, half-open: [left, right) x [top, bottom). */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SamMatch {
  objectId: string;
  box: Box;
  confidence?: number;
  /** Row-major 0/1 raster of maskWidth x maskHeight covering `box`. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
}

export function samRequestBody(prompt: string, imageUrl: string) {
  return {
    model: SAM_MODEL,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageUrl },
        ],
      },
    ],
    metadata: { include_confidence: 'true' },
    stream: true,
  };
}

/** Turn a Responses event stream into matches. Exported so tests can feed fixtures. */
export async function matchesFromEvents(events: AsyncIterable<StreamEvent>): Promise<SamMatch[]> {
  const parsed = parseImageStream(events as AsyncIterable<ResponsesEvent>);
  const result = await parsed.finalResult;
  if (result.outcome.status !== 'completed') {
    throw new Error(`SAM stream ended early: ${JSON.stringify(result.outcome)}`);
  }
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`SAM output unreadable: ${errors.map((d) => d.message).join('; ')}`);
  }
  return recordsOfKind(result.records, 'mask').map((rec) => ({
    objectId: rec.objectId,
    box: { ...rec.bounds },
    confidence: rec.confidence,
    mask: decodeMaskToRaster(rec.mask),
    maskWidth: rec.mask.width,
    maskHeight: rec.mask.height,
  }));
}

/** Segment every instance of `prompt` (a short noun phrase) in an image URL or data URL. */
export async function segment(client: MetaClient, prompt: string, imageUrl: string): Promise<SamMatch[]> {
  return matchesFromEvents(client.postStream('/responses', samRequestBody(prompt, imageUrl)));
}

/** Largest match by box area, or null. Good enough for "the dog in this photo". */
export function largest(matches: readonly SamMatch[]): SamMatch | null {
  let best: SamMatch | null = null;
  let bestArea = -1;
  for (const m of matches) {
    const area = (m.box.right - m.box.left) * (m.box.bottom - m.box.top);
    if (area > bestArea) {
      best = m;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Sample the mask at a box-relative pixel (nearest neighbour). The raster is smaller than the
 * box, so callers scale through this instead of indexing directly.
 */
export function maskAt(m: SamMatch, boxX: number, boxY: number): number {
  const bw = m.box.right - m.box.left;
  const bh = m.box.bottom - m.box.top;
  const mx = Math.min(m.maskWidth - 1, Math.floor((boxX * m.maskWidth) / bw));
  const my = Math.min(m.maskHeight - 1, Math.floor((boxY * m.maskHeight) / bh));
  return m.mask[my * m.maskWidth + mx] ?? 0;
}
