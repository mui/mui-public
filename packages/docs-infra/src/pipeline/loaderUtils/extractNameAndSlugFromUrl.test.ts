import { describe, it, expect } from 'vitest';
import { extractNameAndSlugFromUrl } from './extractNameAndSlugFromUrl';

describe('extractNameAndSlugFromUrl', () => {
  describe('with index files', () => {
    it('should extract name from parent directory when file is index.ts', () => {
      const url = 'file:///app/components/checkbox/demos/advanced-keyboard/index.ts';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Advanced Keyboard',
        slug: 'advanced-keyboard',
      });
    });

    it('should handle index.tsx files', () => {
      const url = 'file:///src/components/button/index.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Button',
        slug: 'button',
      });
    });

    it('should handle index.js files', () => {
      const url = '/utils/helper-functions/index.js';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Helper Functions',
        slug: 'helper-functions',
      });
    });

    it('should handle index.jsx files', () => {
      const url = '/components/modal-dialog/index.jsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Modal Dialog',
        slug: 'modal-dialog',
      });
    });

    it('should handle index.mjs and index.cjs files', () => {
      expect(extractNameAndSlugFromUrl('/utils/api-client/index.mjs')).toEqual({
        name: 'Api Client',
        slug: 'api-client',
      });

      expect(extractNameAndSlugFromUrl('/utils/legacy-helper/index.cjs')).toEqual({
        name: 'Legacy Helper',
        slug: 'legacy-helper',
      });
    });

    it('should handle index files with double extensions', () => {
      expect(extractNameAndSlugFromUrl('/styles/theme/index.module.css')).toEqual({
        name: 'Theme',
        slug: 'theme',
      });

      expect(extractNameAndSlugFromUrl('/types/api/index.d.ts')).toEqual({
        name: 'Api',
        slug: 'api',
      });

      expect(extractNameAndSlugFromUrl('/components/button/index.test.tsx')).toEqual({
        name: 'Button',
        slug: 'button',
      });

      expect(extractNameAndSlugFromUrl('/utils/helpers/index.spec.js')).toEqual({
        name: 'Helpers',
        slug: 'helpers',
      });
    });
  });

  describe('with non-index files', () => {
    it('should extract name from filename when not index file', () => {
      const url = '/src/components/button-group.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Button Group',
        slug: 'button-group',
      });
    });

    it('should handle various file extensions', () => {
      expect(extractNameAndSlugFromUrl('/utils/data-processor.js')).toEqual({
        name: 'Data Processor',
        slug: 'data-processor',
      });

      expect(extractNameAndSlugFromUrl('/styles/theme-provider.css')).toEqual({
        name: 'Theme Provider',
        slug: 'theme-provider',
      });

      expect(extractNameAndSlugFromUrl('/docs/getting-started.md')).toEqual({
        name: 'Getting Started',
        slug: 'getting-started',
      });
    });

    it('should handle files without extensions', () => {
      const url = '/bin/build-script';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Build Script',
        slug: 'build-script',
      });
    });

    it('should handle files with double extensions', () => {
      expect(extractNameAndSlugFromUrl('/styles/theme.module.css')).toEqual({
        name: 'Theme',
        slug: 'theme',
      });

      expect(extractNameAndSlugFromUrl('/types/api.d.ts')).toEqual({
        name: 'Api',
        slug: 'api',
      });

      expect(extractNameAndSlugFromUrl('/components/button.test.tsx')).toEqual({
        name: 'Button',
        slug: 'button',
      });

      expect(extractNameAndSlugFromUrl('/utils/helpers.spec.js')).toEqual({
        name: 'Helpers',
        slug: 'helpers',
      });

      expect(extractNameAndSlugFromUrl('/build/webpack.config.dev.js')).toEqual({
        name: 'Webpack',
        slug: 'webpack',
      });
    });
  });

  describe('with different URL formats', () => {
    it('should handle file:// URLs', () => {
      const url = 'file:///C:/Users/dev/project/src/multi-step-form/index.ts';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Multi Step Form',
        slug: 'multi-step-form',
      });
    });

    it('should handle Windows-style backslash paths', () => {
      const url = 'file:///C:\\Users\\dev\\project\\src\\multi-step-form\\index.ts';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Multi Step Form',
        slug: 'multi-step-form',
      });
    });

    it('should handle Windows paths with forward slashes', () => {
      const url = 'file:///C:/Users/dev/project/src/button-group.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Button Group',
        slug: 'button-group',
      });
    });

    it('should handle regular paths without protocol', () => {
      const url = '/app/components/data-table.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Data Table',
        slug: 'data-table',
      });
    });

    it('should handle URLs ending with slash', () => {
      const url = 'https://example.com/docs/getting-started/';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Getting Started',
        slug: 'getting-started',
      });
    });

    it('should handle deeply nested paths', () => {
      const url = '/very/deep/nested/path/to/complex-widget/index.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Complex Widget',
        slug: 'complex-widget',
      });
    });
  });

  describe('with special characters and cases', () => {
    it('should handle numbers in names', () => {
      const url = '/components/grid-12-column.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Grid 12 Column',
        slug: 'grid-12-column',
      });
    });

    it('should handle single words', () => {
      const url = '/components/modal.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Modal',
        slug: 'modal',
      });
    });

    it('should handle underscores by converting to hyphens in slug', () => {
      const url = '/utils/custom_helper.js';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Custom Helper', // Now properly converts underscores to spaces in title
        slug: 'custom-helper',
      });
    });

    it('should handle mixed case names', () => {
      const url = '/components/customButton.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Custom Button',
        slug: 'custom-button',
      });
    });

    it('should handle camelCase names with multiple words', () => {
      const url = '/components/advancedDataTable.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Advanced Data Table',
        slug: 'advanced-data-table',
      });
    });

    it('should handle camelCase names with numbers', () => {
      const url = '/components/grid12Column.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Grid 12 Column',
        slug: 'grid-12-column',
      });
    });

    it('should handle camelCase with acronyms', () => {
      const url = '/components/apiDataProvider.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Api Data Provider',
        slug: 'api-data-provider',
      });
    });

    it('should handle camelCase index files', () => {
      const url = '/components/multiStepForm/index.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Multi Step Form',
        slug: 'multi-step-form',
      });
    });

    it('should handle names starting with numbers', () => {
      const url = '/layouts/12-column-grid.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: '12 Column Grid',
        slug: '12-column-grid',
      });
    });
  });

  describe('error cases', () => {
    it('should throw error for empty URL', () => {
      expect(() => extractNameAndSlugFromUrl('')).toThrow(
        'Could not extract meaningful segment from URL',
      );
    });

    it('should throw error for root index file without parent', () => {
      expect(() => extractNameAndSlugFromUrl('index.ts')).toThrow(
        'Cannot extract name from index file without parent directory',
      );
    });

    it('should throw error for URL with only slashes', () => {
      expect(() => extractNameAndSlugFromUrl('///')).toThrow(
        'Could not extract meaningful segment from URL',
      );
    });

    it('should throw error for file:// URL with only protocol', () => {
      expect(() => extractNameAndSlugFromUrl('file://')).toThrow(
        'Could not extract meaningful segment from URL',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle URLs with query parameters', () => {
      const url = '/components/button.tsx?variant=primary';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Button',
        slug: 'button',
      });
    });

    it('should handle URLs with hash fragments', () => {
      const url = '/docs/api-reference.md#methods';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Api Reference',
        slug: 'api-reference',
      });
    });

    it('should handle relative paths', () => {
      const url = './components/relative-component.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Relative Component',
        slug: 'relative-component',
      });
    });

    it('should handle camelCase with query parameters', () => {
      const url = '/components/customButton.tsx?theme=dark';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Custom Button',
        slug: 'custom-button',
      });
    });

    it('should handle single letter camelCase words', () => {
      const url = '/utils/aBigFunction.js';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'A Big Function',
        slug: 'a-big-function',
      });
    });

    it('should handle PascalCase (first letter uppercase)', () => {
      const url = '/components/CustomButton.tsx';
      const result = extractNameAndSlugFromUrl(url);

      expect(result).toEqual({
        name: 'Custom Button', // Should still work with PascalCase
        slug: 'custom-button',
      });
    });

    it('should not mutate the original input string', () => {
      const originalUrl = '/components/advancedDataTable.tsx';
      const urlCopy = originalUrl; // Reference to same string

      extractNameAndSlugFromUrl(originalUrl);

      // The original string should remain unchanged
      expect(originalUrl).toBe(urlCopy);
      expect(originalUrl).toBe('/components/advancedDataTable.tsx');
    });

    it('should not mutate input strings with special characters', () => {
      const originalUrl = 'file:///app/components/multi-step_form/index.ts';
      const urlBefore = originalUrl;

      extractNameAndSlugFromUrl(originalUrl);

      // The original string should remain unchanged
      expect(originalUrl).toBe(urlBefore);
      expect(originalUrl).toBe('file:///app/components/multi-step_form/index.ts');
    });

    it('should return completely new string objects', () => {
      const url = '/components/myComponent.tsx';
      const result = extractNameAndSlugFromUrl(url);

      // The returned name and slug should be different objects than the input
      expect(result.name).not.toBe(url);
      expect(result.slug).not.toBe(url);

      // Even if we modify the result, the original URL is unaffected
      const originalUrl = url;
      result.name = 'Modified Name';
      result.slug = 'modified-slug';

      expect(url).toBe(originalUrl);
      expect(url).toBe('/components/myComponent.tsx');
    });
  });
});
