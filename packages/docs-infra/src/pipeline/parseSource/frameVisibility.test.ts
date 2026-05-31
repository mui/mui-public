import { describe, expect, it } from 'vitest';
import { COLLAPSED_VISIBLE_FRAME_TYPES } from './frameVisibility';

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
