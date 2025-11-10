/**
 * Tests for mergeCodeMetadata functionality
 */

import { describe, it, expect } from 'vitest';
import { mergeCodeMetadata, extractCodeMetadata } from './mergeCodeMetadata';
import type { VariantCode } from '../../CodeHighlighter/types';

describe('mergeCodeMetadata', () => {
  describe('basic functionality', () => {
    it('should merge metadata files without metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          'helper.js': { source: 'export const helper = () => {};' },
          'existing-meta.json': { source: '{}', metadata: true },
        },
      };

      const additionalMetadata = {
        'new-config.json': { source: '{"new": true}' },
      };

      const result = mergeCodeMetadata(variant, additionalMetadata);

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['helper.js']).toBeDefined();

      // All metadata files should be positioned at maxBackNavigation level
      // With existing extraFiles providing maxBackNavigation = 1 (from ../existing-meta.json)
      expect(result.extraFiles!['existing-meta.json']).toBeDefined();
      expect(result.extraFiles!['new-config.json']).toBeDefined();
    });

    it('should merge metadata files with metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/components/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
        metadataPrefix: 'src/',
        extraFiles: {
          'utils.js': { source: 'export const utils = () => {};' },
          '../theme.css': { source: '.theme {}', metadata: true },
        },
      };

      const additionalMetadata = {
        'config.json': { source: '{"config": true}' },
      };

      const result = mergeCodeMetadata(variant, additionalMetadata);

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['utils.js']).toBeDefined();

      expect(result.extraFiles!['../theme.css']).toBeDefined();
      expect(result.extraFiles!['../config.json']).toBeDefined();

      // Original paths should be removed
      expect(result.extraFiles!['config.json']).toBeUndefined();
    });
  });

  describe('metadataPrefix handling', () => {
    it('should ignore URL structure and only use extraFiles for maxBackNavigation', () => {
      const variant: VariantCode = {
        url: 'file:///deeply/nested/path/components/ui/Button/index.tsx',
        fileName: 'index.tsx',
        source: 'export default function Button() { return <button>Click me</button>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      // URL has deep path but no extraFiles, so maxBackNavigation = 0
      // Metadata should be at root level regardless of URL depth
      expect(result.extraFiles!['config.json']).toBeDefined();
    });

    it('should add single level metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata, { metadataPrefix: 'src/' });

      // maxBackNavigation (0) + metadataPrefix depth (1) = 1 level -> ../
      expect(result.extraFiles!['../config.json']).toBeDefined();
    });

    it('should add multi-level metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata, { metadataPrefix: 'src/app/' });

      // maxBackNavigation (0) + metadataPrefix depth (2) = 2 levels -> ../../
      expect(result.extraFiles!['../../config.json']).toBeDefined();
    });

    it('should ignore trailing slashes in metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result1 = mergeCodeMetadata(variant, metadata, { metadataPrefix: 'src/' });
      const result2 = mergeCodeMetadata(variant, metadata, { metadataPrefix: 'src' });

      // Both should produce the same result
      expect(result1.extraFiles!['../config.json']).toBeDefined();
      expect(result2.extraFiles!['../config.json']).toBeDefined();
    });

    it('should re-extract and reposition metadata when metadataPrefix changes', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        metadataPrefix: 'src/',
        extraFiles: {
          'helper.js': { source: 'export const helper = () => {};' },
          '../theme.css': { source: '.theme {}', metadata: true },
          '../config.json': { source: '{}', metadata: true },
        },
      };

      const additionalMetadata = {
        'new-config.json': { source: '{"new": true}' },
      };

      // Change metadataPrefix from 'src/' to 'src/app/'
      const result = mergeCodeMetadata(variant, additionalMetadata, { metadataPrefix: 'src/app/' });

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['helper.js']).toBeDefined();

      // All metadata should be repositioned to new prefix depth
      // maxBackNavigation (0) + new metadataPrefix depth (2) = 2 levels -> ../../
      expect(result.extraFiles!['../../theme.css']).toBeDefined();
      expect(result.extraFiles!['../../config.json']).toBeDefined();
      expect(result.extraFiles!['../../new-config.json']).toBeDefined();

      // Old metadata paths should not exist
      expect(result.extraFiles!['../theme.css']).toBeUndefined();
      expect(result.extraFiles!['../config.json']).toBeUndefined();

      // Result should have the new metadataPrefix
      expect(result.metadataPrefix).toBe('src/app/');
    });
  });

  describe('existing extraFiles with back navigation', () => {
    it('should use maxBackNavigation from existing extraFiles when available', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          '../helper.js': { source: 'export const helper = () => {};' },
          '../../config.json': { source: '{}' },
        },
      };

      const metadata = {
        'new-config.json': { source: '{}' },
        'theme.css': { source: '.theme {}', metadata: true },
      };

      const result = mergeCodeMetadata(variant, metadata);

      // maxBackNavigation should be 2 (from ../../config.json)
      // So metadata should go to ../../
      expect(result.extraFiles!['../../new-config.json']).toBeDefined();
      expect(result.extraFiles!['../../theme.css']).toBeDefined();

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['../helper.js']).toBeDefined();
      expect(result.extraFiles!['../../config.json']).toBeDefined();
    });

    it('should combine maxBackNavigation with metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          '../helper.js': { source: 'export const helper = () => {};' },
          '../../config.json': { source: '{}' },
        },
      };

      const metadata = {
        'new-config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata, { metadataPrefix: 'src/' });

      // maxBackNavigation (2) + metadataPrefix (1) = 3 levels -> ../../../
      expect(result.extraFiles!['../../../new-config.json']).toBeDefined();

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['../helper.js']).toBeDefined();
      expect(result.extraFiles!['../../config.json']).toBeDefined();
    });
  });

  describe('metadata path preservation', () => {
    it('should preserve original paths in additional metadata', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'path/to/config.json': { source: '{}' },
        '../another/theme.css': { source: '.theme {}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      // Should preserve the original paths but position them at maxBackNavigation level (0)
      expect(result.extraFiles!['path/to/config.json']).toBeDefined();
      expect(result.extraFiles!['../another/theme.css']).toBeDefined();
    });

    it('should preserve paths from existing metadata files in variant', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          'helper.js': { source: 'export const helper = () => {};' },
          'some/path/existing.json': { source: '{}', metadata: true },
        },
      };

      const result = mergeCodeMetadata(variant, {});

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['helper.js']).toBeDefined();

      // Metadata files should preserve their paths but be repositioned at maxBackNavigation level (0)
      expect(result.extraFiles!['some/path/existing.json']).toBeDefined();
    });

    it('should maintain relative structure between metadata files', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        '../package.json': { source: '{"name": "test"}' },
        'theme.css': { source: '.theme {}' },
        'config/settings.json': { source: '{"setting": true}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      // All metadata files should preserve their paths and be positioned at maxBackNavigation level (0)
      expect(result.extraFiles!['../package.json']).toBeDefined();
      expect(result.extraFiles!['theme.css']).toBeDefined();
      expect(result.extraFiles!['config/settings.json']).toBeDefined();
    });

    it('should maintain relative structure with metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          '../utils.js': { source: 'export const utils = () => {};' },
        },
      };

      const metadata = {
        '../package.json': { source: '{"name": "test"}' },
        'theme.css': { source: '.theme {}' },
      };

      const result = mergeCodeMetadata(variant, metadata, { metadataPrefix: 'src/' });

      // maxBackNavigation (1 from ../utils.js) + metadataPrefix (1 from src/) = 2 levels -> ../../
      expect(result.extraFiles!['../../../package.json']).toBeDefined();
      expect(result.extraFiles!['../../theme.css']).toBeDefined();

      // Non-metadata files should remain unchanged
      expect(result.extraFiles!['../utils.js']).toBeDefined();
    });
  });

  describe('metadata flag handling', () => {
    it('should preserve metadata flag on existing files', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          'existing.json': { source: '{}', metadata: true },
        },
      };

      const result = mergeCodeMetadata(variant, {});

      const repositionedFile = result.extraFiles!['existing.json'];
      expect(repositionedFile).toBeDefined();
      if (typeof repositionedFile === 'object' && 'metadata' in repositionedFile) {
        expect(repositionedFile.metadata).toBe(true);
      } else {
        throw new Error('Expected repositioned file to be an object with metadata property');
      }
    });

    it('should add metadata flag to additional files', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      const metadataFile = result.extraFiles!['config.json'];
      expect(metadataFile).toBeDefined();
      if (typeof metadataFile === 'object' && 'metadata' in metadataFile) {
        expect(metadataFile.metadata).toBe(true);
      } else {
        throw new Error('Expected metadata file to be an object with metadata property');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle variant with no extraFiles', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      expect(result.extraFiles!['config.json']).toBeDefined();
    });

    it('should handle empty metadata files', () => {
      const variant: VariantCode = {
        url: 'file:///lib/MyComponent.tsx',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
        extraFiles: {
          'helper.js': { source: 'export const helper = () => {};' },
        },
      };

      const result = mergeCodeMetadata(variant, {});

      // Should return unchanged extraFiles
      expect(result.extraFiles!['helper.js']).toBeDefined();
      expect(Object.keys(result.extraFiles!)).toHaveLength(1);
    });

    it('should handle variant with no URL', () => {
      const variant: VariantCode = {
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      // With no URL and no extraFiles, should place at root level
      expect(result.extraFiles!['config.json']).toBeDefined();
    });

    it('should handle invalid URLs gracefully', () => {
      const variant: VariantCode = {
        url: 'not-a-valid-url',
        fileName: 'MyComponent.tsx',
        source: 'export default function MyComponent() { return <div>Hello</div>; }',
      };

      const metadata = {
        'config.json': { source: '{}' },
      };

      const result = mergeCodeMetadata(variant, metadata);

      // Should fallback to root level when URL parsing fails
      expect(result.extraFiles!['config.json']).toBeDefined();
    });
  });

  describe('extractCodeMetadata', () => {
    describe('basic functionality', () => {
      it('should extract metadata files without metadataPrefix', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          extraFiles: {
            'helper.js': { source: 'export const helper = () => {};' },
            'config.json': { source: '{}', metadata: true },
            'theme.css': { source: '.theme {}', metadata: true },
          },
        };

        const result = extractCodeMetadata(variant);

        // Non-metadata files should remain in variant
        expect(result.variant.extraFiles!['helper.js']).toBeDefined();

        // Metadata files should be extracted
        expect(result.metadata['config.json']).toBeDefined();
        expect(result.metadata['theme.css']).toBeDefined();

        // Metadata files should not have metadata flag
        const configFile = result.metadata['config.json'];
        const themeFile = result.metadata['theme.css'];
        expect(
          typeof configFile === 'object' && 'metadata' in configFile
            ? configFile.metadata
            : undefined,
        ).toBeUndefined();
        expect(
          typeof themeFile === 'object' && 'metadata' in themeFile ? themeFile.metadata : undefined,
        ).toBeUndefined();

        // Metadata should not remain in variant
        expect(result.variant.extraFiles!['config.json']).toBeUndefined();
        expect(result.variant.extraFiles!['theme.css']).toBeUndefined();
      });

      it('should extract metadata files with metadataPrefix', () => {
        const variant: VariantCode = {
          url: 'file:///lib/components/Button/index.tsx',
          fileName: 'index.tsx',
          source: 'export default function Button() { return <button>Click me</button>; }',
          metadataPrefix: 'src/',
          extraFiles: {
            'utils.js': { source: 'export const utils = () => {};' },
            '../theme.css': { source: '.theme {}', metadata: true },
            '../config.json': { source: '{}', metadata: true },
          },
        };

        const result = extractCodeMetadata(variant);

        // Non-metadata files should remain in variant
        expect(result.variant.extraFiles!['utils.js']).toBeDefined();

        // Metadata files should be extracted and scoped correctly
        // maxBackNavigation (1 from ../theme.css) + metadataPrefix (1 from src/) = remove ../../
        // So ../theme.css becomes theme.css, ../config.json becomes config.json
        expect(result.metadata['theme.css']).toBeDefined();
        expect(result.metadata['config.json']).toBeDefined();

        // Original metadata paths should not remain in variant
        expect(result.variant.extraFiles!['../theme.css']).toBeUndefined();
        expect(result.variant.extraFiles!['../config.json']).toBeUndefined();
      });
    });

    describe('path scoping', () => {
      it('should scope metadata paths correctly with maxBackNavigation', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          extraFiles: {
            '../helper.js': { source: 'export const helper = () => {};' },
            '../config.json': { source: '{}', metadata: true },
            '../theme.css': { source: '.theme {}', metadata: true },
          },
        };

        const result = extractCodeMetadata(variant);

        // Non-metadata files should remain in variant
        expect(result.variant.extraFiles!['../helper.js']).toBeDefined();

        expect(result.metadata['config.json']).toBeDefined();
        expect(result.metadata['theme.css']).toBeDefined();

        // Original metadata paths should not remain in variant
        expect(result.variant.extraFiles!['../config.json']).toBeUndefined();
        expect(result.variant.extraFiles!['../theme.css']).toBeUndefined();
      });

      it('should scope metadata paths with metadataPrefix and maxBackNavigation', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          metadataPrefix: 'src/',
          extraFiles: {
            '../helper.js': { source: 'export const helper = () => {};' },
            '../../config.json': { source: '{}', metadata: true },
            '../../theme.css': { source: '.theme {}', metadata: true },
          },
        };

        const result = extractCodeMetadata(variant);

        // Non-metadata files should remain in variant
        expect(result.variant.extraFiles!['../helper.js']).toBeDefined();

        // Metadata should be scoped by removing maxBackNavigation (1) + metadataPrefix (1) = ../
        // So ../../config.json becomes config.json
        expect(result.metadata['config.json']).toBeDefined();
        expect(result.metadata['theme.css']).toBeDefined();

        // Original metadata paths should not remain in variant
        expect(result.variant.extraFiles!['../../config.json']).toBeUndefined();
        expect(result.variant.extraFiles!['../../theme.css']).toBeUndefined();
      });

      it('should preserve relative structure in extracted metadata', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          extraFiles: {
            '../package.json': { source: '{"name": "test"}', metadata: true },
            'theme.css': { source: '.theme {}', metadata: true },
            'config/settings.json': { source: '{"setting": true}', metadata: true },
          },
        };

        const result = extractCodeMetadata(variant);

        expect(result.metadata['../package.json']).toBeDefined();
        expect(result.metadata['theme.css']).toBeDefined();
        expect(result.metadata['config/settings.json']).toBeDefined();
      });
    });

    describe('edge cases', () => {
      it('should handle variant with no extraFiles', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
        };

        const result = extractCodeMetadata(variant);

        expect(result.variant.extraFiles).toEqual({});
        expect(result.metadata).toEqual({});
      });

      it('should handle variant with no metadata files', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          extraFiles: {
            'helper.js': { source: 'export const helper = () => {};' },
            'utils.ts': { source: 'export const utils = () => {};' },
          },
        };

        const result = extractCodeMetadata(variant);

        // All files should remain in variant
        expect(result.variant.extraFiles!['helper.js']).toBeDefined();
        expect(result.variant.extraFiles!['utils.ts']).toBeDefined();

        // No metadata should be extracted
        expect(result.metadata).toEqual({});
      });

      it('should handle metadata files that dont match the expected back navigation pattern', () => {
        const variant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          metadataPrefix: 'src/',
          extraFiles: {
            'config.json': { source: '{}', metadata: true }, // No back navigation prefix
          },
        };

        const result = extractCodeMetadata(variant);

        // Metadata should still be extracted even if it doesn't match expected pattern
        expect(result.metadata['config.json']).toBeDefined();
        expect(result.variant.extraFiles!['config.json']).toBeUndefined();
      });
    });

    describe('round-trip compatibility', () => {
      it('should be inverse of mergeCodeMetadata', () => {
        const originalVariant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          extraFiles: {
            'helper.js': { source: 'export const helper = () => {};' },
          },
        };

        const metadata = {
          'config.json': { source: '{}' },
          'theme.css': { source: '.theme {}' },
        };

        // Merge metadata into variant
        const merged = mergeCodeMetadata(originalVariant, metadata);

        // Extract metadata back out
        const extracted = extractCodeMetadata(merged);

        // Should get back the original structure
        expect(extracted.variant.extraFiles!['helper.js']).toBeDefined();
        expect(extracted.metadata['config.json']).toBeDefined();
        expect(extracted.metadata['theme.css']).toBeDefined();

        // Content should match
        const extractedConfigFile = extracted.metadata['config.json'];
        const extractedThemeFile = extracted.metadata['theme.css'];
        expect(
          typeof extractedConfigFile === 'object' && 'source' in extractedConfigFile
            ? extractedConfigFile.source
            : extractedConfigFile,
        ).toBe('{}');
        expect(
          typeof extractedThemeFile === 'object' && 'source' in extractedThemeFile
            ? extractedThemeFile.source
            : extractedThemeFile,
        ).toBe('.theme {}');
      });

      it('should be inverse of mergeCodeMetadata with metadataPrefix', () => {
        const originalVariant: VariantCode = {
          url: 'file:///lib/MyComponent.tsx',
          fileName: 'MyComponent.tsx',
          source: 'export default function MyComponent() { return <div>Hello</div>; }',
          extraFiles: {
            '../helper.js': { source: 'export const helper = () => {};' },
          },
        };

        const metadata = {
          'config.json': { source: '{}' },
          '../package.json': { source: '{"name": "test"}' },
        };

        // Merge metadata with prefix
        const merged = mergeCodeMetadata(originalVariant, metadata, { metadataPrefix: 'src/' });

        // Extract metadata back out
        const extracted = extractCodeMetadata(merged);

        // Should preserve the relative structure
        expect(extracted.variant.extraFiles!['../helper.js']).toBeDefined();
        expect(extracted.metadata['config.json']).toBeDefined();
        expect(extracted.metadata['../package.json']).toBeDefined();
      });
    });
  });
});
