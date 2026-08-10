import { describe, expect, it } from 'vitest';
import { formatMaterialUiDocPath } from './formatMaterialUiDocPath';

describe('formatMaterialUiDocPath', () => {
  it.each([
    ['buttons', 'react-button'],
    ['radio-buttons', 'react-radio-button'],
    ['tabs', 'react-tabs'],
    ['icons', 'icons'],
    ['transitions', 'transitions'],
  ])('should map the %s source directory to %s', (sourceDirectory, routeSegment) => {
    expect(
      formatMaterialUiDocPath(`docs/data/material/components/${sourceDirectory}/ExampleDemo.tsx`),
    ).toBe(`/material-ui/${routeSegment}/`);
  });

  it('should map non-component Material UI pages without duplicating the product prefix', () => {
    expect(formatMaterialUiDocPath('docs/data/material/guides/testing/testing.md')).toBe(
      '/material-ui/guides/testing',
    );
  });

  it('should map root Material UI data files to the product root', () => {
    expect(formatMaterialUiDocPath('docs/data/material/pages.ts')).toBe('/material-ui/');
  });

  it('should map shared documentation data to its containing directory', () => {
    expect(formatMaterialUiDocPath('docs/data/about/teamMembers.json')).toBe('/about');
  });

  it('should return null for an unknown component directory', () => {
    expect(
      formatMaterialUiDocPath('docs/data/material/components/example/ExampleDemo.tsx'),
    ).toBeNull();
  });

  it('should return null for unsupported files', () => {
    expect(formatMaterialUiDocPath('docs/data/material/components/tabs/preview.png')).toBeNull();
    expect(formatMaterialUiDocPath('packages/mui-material/src/Tabs/Tabs.tsx')).toBeNull();
  });
});
