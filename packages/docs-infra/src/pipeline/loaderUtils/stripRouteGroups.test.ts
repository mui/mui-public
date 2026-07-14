import { describe, expect, it } from 'vitest';
import {
  isRouteGroup,
  routeGroupName,
  stripRouteGroups,
  stripRouteGroupSegments,
} from './stripRouteGroups';

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

describe('stripRouteGroups', () => {
  it('removes a single route-group segment', () => {
    expect(stripRouteGroups('/react/(components)/accordion')).toBe('/react/accordion');
  });

  it('removes multiple route-group segments', () => {
    expect(stripRouteGroups('/(public)/(content)/react')).toBe('/react');
  });

  it('leaves paths without route groups untouched', () => {
    expect(stripRouteGroups('/react/accordion')).toBe('/react/accordion');
  });

  it('strips a parenthesized prefix from a larger segment (differs from isRouteGroup)', () => {
    // The raw-string form is used for path matching, where stripping the leading `(draft)` is the
    // intended behavior. `isRouteGroup('(draft)notes')` is false, so the per-segment callers keep it.
    expect(stripRouteGroups('/(draft)notes')).toBe('notes');
  });
});

describe('stripRouteGroupSegments', () => {
  it('removes a whole route-group segment', () => {
    expect(stripRouteGroupSegments('/react/(components)/accordion')).toBe('/react/accordion');
  });

  it('removes multiple consecutive route-group segments', () => {
    expect(stripRouteGroupSegments('/(public)/(content)/react')).toBe('/react');
  });

  it('keeps a segment that only contains parentheses (differs from stripRouteGroups)', () => {
    // Whole-segment rule: `(draft)notes` is not a route group, so it stays — unlike the raw-string
    // `stripRouteGroups`, which would drop the leading `(draft)`.
    expect(stripRouteGroupSegments('/(draft)notes/guide')).toBe('/(draft)notes/guide');
  });

  it('leaves paths without route groups untouched', () => {
    expect(stripRouteGroupSegments('/react/accordion')).toBe('/react/accordion');
  });
});
