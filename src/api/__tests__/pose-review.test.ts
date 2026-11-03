import { describe, expect, it } from 'vitest';
import { MetaClient } from '../meta-client.js';
import { reviewPoses } from '../pose-review.js';

describe('reviewPoses issue', () => {
  it('coerces issue to a capped string', async () => {
    const poses = [{ name: 'sit', same_pet: 9, pose_matches: 9, anatomy: 9, tails: 1 }, { name: 'idle', same_pet: 9, pose_matches: 9, anatomy: 9, tails: 1, issue: 'y'.repeat(900) }];
    const text = JSON.stringify({ poses });
    const res = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
    const client = new MetaClient({ apiKey: 'k', fetchImpl: (async () => new Response(JSON.stringify(res))) as unknown as typeof fetch });
    const out = await reviewPoses(client, 'r', [{ name: 'sit', image: 'i' }, { name: 'idle', image: 'i' }]);
    expect(out?.get('sit')?.issue).toBe('');
    expect(out?.get('idle')?.issue).toBe('y'.repeat(300));
  });
});
