import { describe, expect, it } from 'vitest';
import { isRouteGroup, routeGroupName, stripRouteGroupSegments } from './stripRouteGroups';

describe('isRouteGroup', () => {
  it.each([
    ['(overview)', true],
    ['(a-b)', true],
    ['()', true],
    ['components', false],
    ['(components', false],
    ['components)', false],
    ['(draft)notes', false],
    ['', false],
  ])('%s -> %s', (segment, expected) => {
    expect(isRouteGroup(segment)).toBe(expected);
  });
});

describe('routeGroupName', () => {
  it.each([
    ['(overview)', 'overview'],
    ['(a-b)', 'a-b'],
    ['components', undefined],
    ['(draft)notes', undefined],
    ['(components', undefined],
    ['', undefined],
  ])('%s -> %s', (segment, expected) => {
    expect(routeGroupName(segment)).toBe(expected);
  });
});

describe('stripRouteGroupSegments', () => {
  it('removes a whole route-group segment', () => {
    expect(stripRouteGroupSegments('/react/(components)/accordion')).toBe('/react/accordion');
  });

  it('removes multiple consecutive route-group segments', () => {
    expect(stripRouteGroupSegments('/(public)/(content)/react')).toBe('/react');
  });

  it('strips a leading route-group segment with no preceding slash', () => {
    // The raw-regex form missed this (it required a slash before the group); the whole-segment
    // form handles a relative path whose first segment is a route group.
    expect(stripRouteGroupSegments('(public)/react')).toBe('react');
  });

  it('keeps a segment that only contains parentheses (not a whole route group)', () => {
    // Whole-segment rule: `(draft)notes` is not a route group, so it stays.
    expect(stripRouteGroupSegments('/(draft)notes/guide')).toBe('/(draft)notes/guide');
  });

  it('leaves paths without route groups untouched', () => {
    expect(stripRouteGroupSegments('/react/accordion')).toBe('/react/accordion');
  });
});
