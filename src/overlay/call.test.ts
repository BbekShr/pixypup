import { describe, expect, it } from 'vitest';
import { alreadyHere, comeCommand, comeTarget, comeX, commandMustWait, isCome } from './call';

describe('come here', () => {
  it('centres the pet on the pointer and keeps it on screen', () => {
    expect(comeTarget(500, 100, 1440)).toBe(450);
    expect(comeTarget(10, 100, 1440)).toBe(0);
    expect(comeTarget(1435, 100, 1440)).toBe(1340);
    expect(comeTarget(null, 100, 1440)).toBe(670);
  });
  it('within 40 px of the pointer it is already there', () => {
    expect(alreadyHere(450, 100, 500, 1440)).toBe(true);
    expect(alreadyHere(450, 100, 539, 1440)).toBe(true);
    expect(alreadyHere(450, 100, 541, 1440)).toBe(false);
    expect(alreadyHere(670, 100, null, 1440)).toBe(true);
  });
  it('the pointer rides the command in window coordinates', () => {
    expect(comeCommand(1500.4, 1440)).toBe('come:60');
    expect(comeX('come:60')).toBe(60);
    expect(comeX('come:-20')).toBe(-20);
    for (const bad of ['come', 'come:', 'come:x', 'come:1e9', 'sit', 'come:5;']) expect(comeX(bad)).toBeNull();
    expect(isCome('come')).toBe(true);
    expect(isCome('come:7')).toBe(true);
    expect(isCome('comet')).toBe(false);
  });
  it('waits while falling, dragged or turning, otherwise runs now', () => {
    const idle = { falling: false, dragging: false, turning: false };
    expect(commandMustWait(idle)).toBe(false);
    for (const k of ['falling', 'dragging', 'turning'] as const) expect(commandMustWait({ ...idle, [k]: true })).toBe(true);
  });
});
