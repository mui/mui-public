import { describe, expect, it } from 'vitest';
import { COLLAPSED_VISIBLE_FRAME_TYPES, resolveCollapsedFrameType } from './frameVisibility';

describe('COLLAPSED_VISIBLE_FRAME_TYPES', () => {
  it('contains exactly the four collapsed-visible frame types', () => {
    expect([...COLLAPSED_VISIBLE_FRAME_TYPES].sort()).toEqual(
      ['highlighted', 'focus', 'padding-top', 'padding-bottom'].sort(),
    );
  });

  it('reports membership via .has() for each included type', () => {
    for (const type of ['highlighted', 'focus', 'padding-top', 'padding-bottom']) {
      expect(COLLAPSED_VISIBLE_FRAME_TYPES.has(type)).toBe(true);
    }
  });

  it('reports false via .has() for excluded types', () => {
    for (const type of ['normal', 'highlighted-unfocused', 'comment']) {
      expect(COLLAPSED_VISIBLE_FRAME_TYPES.has(type)).toBe(false);
    }
  });
});

describe('resolveCollapsedFrameType', () => {
  it('returns the frame type unchanged when collapseToEmpty is false', () => {
    for (const type of ['focus', 'highlighted', 'padding-top', 'padding-bottom', 'normal']) {
      expect(resolveCollapsedFrameType(type, false)).toBe(type);
    }
    expect(resolveCollapsedFrameType(undefined, false)).toBe(undefined);
  });

  it('demotes each collapsed-visible type to a hidden equivalent when collapseToEmpty', () => {
    expect(resolveCollapsedFrameType('focus', true)).toBe('focus-unfocused');
    expect(resolveCollapsedFrameType('highlighted', true)).toBe('highlighted-unfocused');
    expect(resolveCollapsedFrameType('padding-top', true)).toBe('normal');
    expect(resolveCollapsedFrameType('padding-bottom', true)).toBe('normal');
  });

  it('leaves already-hidden and non-region frame types untouched when collapseToEmpty', () => {
    for (const type of ['normal', 'highlighted-unfocused', 'focus-unfocused', 'comment']) {
      expect(resolveCollapsedFrameType(type, true)).toBe(type);
    }
    expect(resolveCollapsedFrameType(undefined, true)).toBe(undefined);
  });

  it('never produces a collapsed-visible type when collapseToEmpty', () => {
    for (const type of [
      'focus',
      'highlighted',
      'padding-top',
      'padding-bottom',
      'normal',
      'focus-unfocused',
      'highlighted-unfocused',
      'comment',
    ]) {
      const resolved = resolveCollapsedFrameType(type, true);
      expect(resolved === undefined || !COLLAPSED_VISIBLE_FRAME_TYPES.has(resolved)).toBe(true);
    }
  });
});
