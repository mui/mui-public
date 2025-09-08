import { describe, it, expect } from 'vitest';
import { createPathContext } from './examineVariant';
import type { VariantCode } from './types';

describe('examineVariant', () => {
  describe('createPathContext', () => {
    describe('basic functionality', () => {
      it('should handle variant without extraFiles', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
        };

        const result = createPathContext(variant);

        expect(result).toEqual({
          hasUrl: false,
          hasMetadata: false,
          maxSourceBackNavigation: 0,
          urlDirectory: [],
          rootLevel: '',
          pathInwardFromRoot: '',
          actualUrl: undefined,
        });
      });

      it('should handle variant with empty extraFiles', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {},
        };

        const result = createPathContext(variant);

        expect(result).toEqual({
          hasUrl: false,
          hasMetadata: false,
          maxSourceBackNavigation: 0,
          urlDirectory: [],
          rootLevel: '',
          pathInwardFromRoot: '',
          actualUrl: undefined,
        });
      });

      it('should handle variant with URL but no extraFiles', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///docs/components/button',
        };

        const result = createPathContext(variant);

        expect(result).toEqual({
          hasUrl: true,
          hasMetadata: false,
          maxSourceBackNavigation: 0,
          urlDirectory: ['docs', 'components', 'button'],
          rootLevel: 'docs',
          pathInwardFromRoot: '',
          actualUrl: 'file:///docs/components/button',
        });
      });
    });

    describe('maxSourceBackNavigation calculation', () => {
      it('should calculate maxSourceBackNavigation from extraFiles with relative paths', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../utils.js': 'export const helper = () => {};',
            '../../config.js': 'export const config = {};',
            './local.js': 'export const local = {};',
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(2);
        expect(result.pathInwardFromRoot).toBe('');
      });

      it('should ignore metadata files when calculating maxSourceBackNavigation', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../utils.js': 'export const helper = () => {};',
            '../../config.js': 'export const config = {};',
            '../../../metadata.json': {
              source: '{"name": "test"}',
              metadata: true,
            },
          },
        };

        const result = createPathContext(variant);

        // Should be 2 (from ../../config.js), not 3 (ignoring ../../../metadata.json)
        expect(result.maxSourceBackNavigation).toBe(2);
        expect(result.pathInwardFromRoot).toBe('');
      });

      it('should handle mixed file types in extraFiles', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../utils.js': 'export const helper = () => {};',
            './local.js': 'export const local = {};',
            'package.json': '{"name": "test"}',
            '../config/settings.js': {
              source: 'export const settings = {};',
            },
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(1);
        expect(result.pathInwardFromRoot).toBe('');
      });

      it('should return 0 when no back navigation paths exist', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            'utils.js': 'export const helper = () => {};',
            'config.js': 'export const config = {};',
            './local.js': 'export const local = {};',
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(0);
      });

      it('should only count consecutive back navigation at the start of paths', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../foo/../bar/utils.js': 'export const helper = () => {};',
            '../../baz/../qux.js': 'export const config = {};',
            '../simple.js': 'export const simple = {};',
          },
        };

        const result = createPathContext(variant);

        // Should be 2 (from ../../baz/../qux.js - only consecutive ../ at start)
        // ../foo/../bar/utils.js counts as 1 (only the first ../)
        // ../../baz/../qux.js counts as 2 (two consecutive ../ at start)
        expect(result.maxSourceBackNavigation).toBe(2);
      });

      it('should handle complex mixed forward/backward navigation patterns', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../foo/../../bar/utils.js': 'export const helper = () => {};',
            '../../forward/../back/config.js': 'export const config = {};',
            '../../../start/forward/../../../back.js': 'export const complex = {};',
          },
        };

        const result = createPathContext(variant);

        // Should be 4 (from ../../../start/forward/../../../back.js - actual resolved back steps)
        // ../foo/../../bar/utils.js resolves to 2 back steps (../foo/../../ = back 2, forward bar)
        // ../../forward/../back/config.js resolves to 2 back steps (../../forward/../ = back 2, forward back)
        // ../../../start/forward/../../../back.js resolves to 4 back steps (../../../start/forward/../../../ = back 4, forward back)
        expect(result.maxSourceBackNavigation).toBe(4);
      });
    });

    describe('hasMetadata detection', () => {
      it('should detect metadata files in extraFiles', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            'utils.js': 'export const helper = () => {};',
            'metadata.json': {
              source: '{"name": "test"}',
              metadata: true,
            },
          },
        };

        const result = createPathContext(variant);

        expect(result.hasMetadata).toBe(true);
      });

      it('should return false when no metadata files exist', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            'utils.js': 'export const helper = () => {};',
            'config.js': {
              source: 'export const config = {};',
            },
          },
        };

        const result = createPathContext(variant);

        expect(result.hasMetadata).toBe(false);
      });

      it('should return false when extraFiles is empty', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {},
        };

        const result = createPathContext(variant);

        expect(result.hasMetadata).toBe(false);
      });
    });

    describe('URL handling with path parsing', () => {
      it('should parse URL directory structure', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///docs/components/button/usage',
        };

        const result = createPathContext(variant);

        // Now implementation should parse URL structure
        expect(result.urlDirectory).toEqual(['docs', 'components', 'button', 'usage']);
        expect(result.rootLevel).toBe('docs');
        expect(result.pathInwardFromRoot).toBe('');
        expect(result.actualUrl).toBe('file:///docs/components/button/usage');
        expect(result.hasUrl).toBe(true);
      });

      it('should handle complex URL paths with parsing', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///docs/system/getting-started/installation',
        };

        const result = createPathContext(variant);

        // Now implementation should parse URL structure
        expect(result.urlDirectory).toEqual(['docs', 'system', 'getting-started', 'installation']);
        expect(result.rootLevel).toBe('docs');
        expect(result.pathInwardFromRoot).toBe('');
        expect(result.actualUrl).toBe('file:///docs/system/getting-started/installation');
      });

      it('should handle root-level URLs', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///',
        };

        const result = createPathContext(variant);

        expect(result.urlDirectory).toEqual([]);
        expect(result.rootLevel).toBe('');
        expect(result.pathInwardFromRoot).toBe('');
        expect(result.actualUrl).toBe('file:///');
        expect(result.hasUrl).toBe(true);
      });
    });

    describe('complex scenarios', () => {
      it('should handle variant with URL, extraFiles, and metadata', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///docs/components/button',
          extraFiles: {
            '../shared/utils.js': 'export const helper = () => {};',
            '../../config/theme.js': 'export const theme = {};',
            './button.stories.js': 'export default { title: "Button" };',
            'metadata.json': {
              source: '{"component": "Button"}',
              metadata: true,
            },
          },
        };

        const result = createPathContext(variant);

        expect(result).toEqual({
          hasUrl: true,
          hasMetadata: true,
          maxSourceBackNavigation: 2,
          urlDirectory: ['docs', 'components', 'button'],
          rootLevel: 'docs',
          pathInwardFromRoot: 'components/button',
          actualUrl: 'file:///docs/components/button',
        });
      });

      it('should calculate pathInwardFromRoot with maxSourceBackNavigation of 1', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///docs/components/button',
          extraFiles: {
            '../utils.js': 'export const helper = () => {};',
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(1);
        expect(result.pathInwardFromRoot).toBe('button');
        expect(result.urlDirectory).toEqual(['docs', 'components', 'button']);
        expect(result.rootLevel).toBe('docs');
      });

      it('should calculate pathInwardFromRoot with maxSourceBackNavigation of 3', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: 'file:///docs/system/getting-started/installation',
          extraFiles: {
            '../../../shared/utils.js': 'export const helper = () => {};',
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(3);
        expect(result.pathInwardFromRoot).toBe('system/getting-started/installation');
        expect(result.urlDirectory).toEqual(['docs', 'system', 'getting-started', 'installation']);
        expect(result.rootLevel).toBe('docs');
      });

      it('should handle variant with only metadata files in extraFiles', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../../../metadata.json': {
              source: '{"name": "test"}',
              metadata: true,
            },
            '../../../../package.json': {
              source: '{"name": "package"}',
              metadata: true,
            },
          },
        };

        const result = createPathContext(variant);

        // maxSourceBackNavigation should be 0 because only metadata files exist
        expect(result.maxSourceBackNavigation).toBe(0);
        expect(result.hasMetadata).toBe(true);
      });

      it('should handle variant with deep back navigation', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../utils.js': 'export const helper = () => {};',
            '../../config.js': 'export const config = {};',
            '../../../shared/theme.js': 'export const theme = {};',
            '../../../../packages/core/index.js': 'export * from "./core";',
            '../../../../../monorepo/utils.js': 'export const monorepo = {};',
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(5);
        expect(result.pathInwardFromRoot).toBe('');
      });
    });

    describe('edge cases', () => {
      it('should handle empty URL string', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: '',
        };

        const result = createPathContext(variant);

        expect(result.hasUrl).toBe(false);
        expect(result.actualUrl).toBeUndefined();
      });

      it('should handle null/undefined URL', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          url: undefined,
        };

        const result = createPathContext(variant);

        expect(result.hasUrl).toBe(false);
        expect(result.actualUrl).toBeUndefined();
      });

      it('should handle extraFiles with string values', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../utils.js': 'export const helper = () => {};',
            './config.js': 'export const config = {};',
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(1);
        expect(result.hasMetadata).toBe(false);
      });

      it('should handle extraFiles with object values without metadata', () => {
        const variant: VariantCode = {
          source: 'console.log("test");',
          extraFiles: {
            '../utils.js': {
              source: 'export const helper = () => {};',
            },
            './config.js': {
              source: 'export const config = {};',
            },
          },
        };

        const result = createPathContext(variant);

        expect(result.maxSourceBackNavigation).toBe(1);
        expect(result.hasMetadata).toBe(false);
      });
    });
  });
});
