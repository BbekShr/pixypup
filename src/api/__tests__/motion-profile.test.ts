import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { profileOk, validateManifest } from '../manifest.js';
import { MetaClient } from '../meta-client.js';
import { motionProfile, sanitizeProfile } from '../motion-profile.js';
import { STRIDE_PLAUSIBLE, defaultProfile } from '../profile-defaults.js';

const fixture = (n: string) => readFileSync(new URL(`./fixtures/profiles/${n}.json`, import.meta.url), 'utf8');
const answer = (r: string) => JSON.parse((JSON.parse(r) as { output: { content?: { text?: string }[] }[] }).output.flatMap((i) => i.content ?? [])[0]!.text!);

function fake(body: string, calls: { tools?: unknown }[] = []) {
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new Error("aborted");
    calls.push(JSON.parse(init?.body as string));
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return new MetaClient({ apiKey: 'k', fetchImpl });
}
const png = Buffer.from('x');
const wrap = (j: unknown) => JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(j) }] }] });

describe('real Spark profiles (fixtures)', () => {
  it.each([
    ['husky', 'husky'],
    ['pakkun', 'dog'],
  ])('%s parses into a valid profile that fits a manifest', async (file, species) => {
    const p = await motionProfile(fake(fixture(file)), png, 'Rex', species);
    expect(p).not.toBeNull();
    expect(profileOk(p)).toBe(true);
    const manifest = { pet: 'Rex', species, profile: p, poses: { idle: { frames: ['idle_0.png'], fps: 2, footY: 0.9 } } };
    expect(() => validateManifest(manifest)).not.toThrow();
  });
});

describe('sanitizeProfile', () => {
  const good = () => answer(fixture('husky'));
  it('clamps numbers into range', () => {
    const g = good();
    g.gait = { ...g.gait, cadenceHz: 99, bounce: -3, pitchDeg: 500, speedBody: 0 };
    const p = sanitizeProfile(g, 'husky');
    expect(p.gait).toMatchObject({ cadenceHz: 8, bounce: 0, pitchDeg: 25, speedBody: 0.05 });
    expect(profileOk(p)).toBe(true);
  });
  it('replaces an implausible strideBody with the default and keeps a plausible one', () => {
    const g = good();
    g.gait.strideBody = 9;
    expect(sanitizeProfile(g, 'husky').gait.strideBody).toBe(defaultProfile('husky').gait.strideBody);
    g.gait.strideBody = STRIDE_PLAUSIBLE.quadruped[1];
    expect(sanitizeProfile(g, 'husky').gait.strideBody).toBe(STRIDE_PLAUSIBLE.quadruped[1]);
  });
  it('rejects a bad enum, too few fidgets, and a missing locomotion', () => {
    expect(() => sanitizeProfile({ ...good(), locomotion: 'teleport' }, 'husky')).toThrow();
    expect(() => sanitizeProfile({ ...good(), fidgets: ['groom', 'dance'] }, 'husky')).toThrow();
    expect(() => sanitizeProfile({ ...good(), cycle: { kind: 'moonwalk', prompt: 'x' } }, 'husky')).toThrow();
  });
  it('rejects URLs, @ and emoji in text, but a bad role falls back to the default role', () => {
    expect(() => sanitizeProfile({ ...good(), styleHints: 'see https://x.io' }, 'husky')).toThrow();
    expect(() => sanitizeProfile({ ...good(), energy: 'fun \u{1F415}' }, 'husky')).toThrow();
    const g = good();
    g.roles.voice = { label: 'x'.repeat(40), prompt: 'Pose: a', bubble: '' };
    expect(sanitizeProfile(g, 'dog').roles.voice).toEqual(defaultProfile('dog').roles.voice);
  });
  it('flyers get an air block; walkers never do', () => {
    const g = { ...good(), locomotion: 'fly', air: { minLiftBody: 5, maxLiftBody: 1, flutterHz: 3, perches: true, sway: 2 } };
    const p = sanitizeProfile(g, 'bird');
    expect(p.air).toMatchObject({ minLiftBody: 5, flutterHz: 3, perches: true, sway: 1 });
    expect(p.air!.maxLiftBody).toBeGreaterThan(p.air!.minLiftBody);
    expect(profileOk(p)).toBe(true);
    expect(sanitizeProfile({ ...good(), air: AIR }, 'husky').air).toBeUndefined();
  });
});
const AIR = { minLiftBody: 1, maxLiftBody: 2, flutterHz: 3, perches: true, sway: 0.2 };

describe('motionProfile', () => {
  it('returns null on a failed response, bad JSON, a network error and an abort', async () => {
    expect(await motionProfile(fake(JSON.stringify({ status: 'failed' })), png, 'Rex', 'dog')).toBeNull();
    expect(await motionProfile(fake(wrap({ locomotion: 'nope' })), png, 'Rex', 'dog')).toBeNull();
    const boom = new MetaClient({ apiKey: 'k', fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(await motionProfile(boom, png, 'Rex', 'dog')).toBeNull();
    const ac = new AbortController();
    ac.abort();
    expect(await motionProfile(fake(fixture('husky')), png, 'Rex', 'dog', ac.signal)).toBeNull();
  });
  it('sends no tools unless webSearch is on, and asks at effort low with the image', async () => {
    const calls: { tools?: unknown; reasoning?: unknown; input?: { content: { type: string; text?: string }[] }[] }[] = [];
    await motionProfile(fake(fixture('husky'), calls), png, 'Rex', 'husky');
    expect(calls[0]!.tools).toBeUndefined();
    expect(calls[0]!.reasoning).toEqual({ effort: 'low' });
    expect(calls[0]!.input![0]!.content.map((c) => c.type)).toEqual(['input_text', 'input_image']);
    expect(calls[0]!.input![0]!.content[0]!.text).toContain('a husky');
    await motionProfile(fake(fixture('husky'), calls), png, 'Rex', 'husky', undefined, { webSearch: true });
    expect(calls[1]!.tools).toEqual([{ type: 'web_search' }]);
  });
});

