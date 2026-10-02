// Unit test for the Renovate target comparator. Cases come from real fleet PRs so
// supersession and group ordering match what Renovate actually opens.

import { describe, it, expect } from 'vitest';
import { compareVersions } from './versions.mjs';

describe('compareVersions', () => {
  it.each([
    // [older, newer, source PR]
    ['11.26.0', '12.4.1', 'base-ui#5699 pnpm'],
    ['11.25.0', '11.26.0', 'base-ui-charts#1037 pnpm'],
    ['11.27.0', '12.4.1', 'mui-x#23584 vs #23516 pnpm'],
    ['9.0.7', '10.0.1', 'base-ui#5695 lerna'],
    ['16.2.10', '16.3.3', 'base-ui-mosaic#504 next'],
    ['1.62.1', '1.63.0', 'base-ui#5677 @playwright/test'],
    ['4.1.11', '5.0.0', 'base-ui#5704 vitest'],
    ['14.6.3', '14.6.7', 'base-ui#5670 @testing-library/user-event'],
    ['0.12.1-canary.42', '0.12.1-canary.45', 'base-ui#5043 @mui/internal-docs-infra'],
    ['0.12.1-canary.46', '0.12.1-canary.48', 'base-ui-charts#1044 @mui/internal-docs-infra'],
    ['0.0.4-canary.114', '0.0.4-canary.115', 'base-ui-mosaic#510 @mui/internal-code-infra'],
    ['2.0.18-canary.25', '2.0.18-canary.36', 'base-ui#5439 @mui/internal-test-utils'],
    ['0.0.3-canary.7', '0.0.3-canary.23', 'base-ui#5439 @mui/internal-benchmark'],
    ['7.0.0-dev.20260602.1', '7.0.0-dev.20260707.2', 'base-ui-plus#156 @typescript/native-preview'],
  ])('orders %s before %s (%s)', (older, newer) => {
    expect(compareVersions(older, newer)).toBe(-1);
    expect(compareVersions(newer, older)).toBe(1);
  });

  it.each([
    ['^3.1.7', '^4.1.4', 'base-ui#5692 fast-uri override'],
    ['~22.7.9', '~23.2.1', 'base-ui#5698 nx override'],
    ['^4.3.2', '^5.4.2', 'base-ui#5694 js-yaml@4 override'],
    ['^3.3.18', '^6.0.1', 'base-ui#5697 nanoid@3 override'],
    ['^7.29.7', '^8.0.5', 'base-ui#5689 @babel/runtime'],
    ['^0.12.1-canary.44', '^0.12.1-canary.48', 'mui-x#23549 @mui/internal-docs-infra'],
    ['^4.1.0', '^5.0.0', 'material-ui#49136 vitest'],
  ])('ignores range prefixes: %s before %s (%s)', (older, newer) => {
    expect(compareVersions(older, newer)).toBe(-1);
  });

  it('sorts a prerelease before its release', () => {
    expect(compareVersions('5.0.0-canary.1', '5.0.0')).toBe(-1);
    expect(compareVersions('0.12.1-canary.48', '0.12.1')).toBe(-1);
  });

  it('compares numeric prerelease segments numerically, not lexically', () => {
    expect(compareVersions('0.12.1-canary.9', '0.12.1-canary.10')).toBe(-1);
    expect(compareVersions('2.0.18-canary.36', '2.0.18-canary.4')).toBe(1);
  });

  it('treats equal versions as equal regardless of prefix', () => {
    expect(compareVersions('12.4.1', '12.4.1')).toBe(0);
    expect(compareVersions('^12.4.1', '12.4.1')).toBe(0);
    expect(compareVersions('0.12.1-canary.48', '0.12.1-canary.48')).toBe(0);
  });

  it('pads missing segments with zero', () => {
    expect(compareVersions('12.4', '12.4.0')).toBe(0);
    expect(compareVersions('12', '12.0.1')).toBe(-1);
  });
});
