import { describe, it, expect } from 'vitest';
import type { Nodes as HastNodes } from 'hast';
import { applyTransform, applyTransforms } from './applyTransform';
import type { VariantSource, Transforms } from './types';

describe('applyTransform', () => {
  describe('applyTransform', () => {
    it('should apply transform to string source', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransform(source, transforms, 'syntax-highlight');
      expect(result).toBe('const x = 1; // highlighted');
    });

    it('should apply transform to HastNodes source', () => {
      const source: HastNodes = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'const x = 1;' }],
          },
        ],
      };
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransform(source, transforms, 'syntax-highlight');
      expect(result).toBe('const x = 1; // highlighted');
    });

    it('should apply transform to hastJson source', () => {
      const hastJson = JSON.stringify({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'const x = 1;' }],
          },
        ],
      });
      const source: VariantSource = { hastJson };
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransform(source, transforms, 'syntax-highlight');
      expect(result).toBe('const x = 1; // highlighted');
    });

    it('should apply complex delta transformations', () => {
      const source = 'line1\nline2\nline3';
      const transforms: Transforms = {
        'modify-lines': {
          delta: {
            1: ['line2 modified'],
            _t: 'a',
          },
        },
      };

      const result = applyTransform(source, transforms, 'modify-lines');
      expect(result).toContain('line2 modified');
    });

    it('should throw error for non-existent transform key', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      expect(() => applyTransform(source, transforms, 'non-existent')).toThrow(
        'Transform "non-existent" not found in transforms',
      );
    });

    it('should throw error when patch returns invalid result', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'invalid-transform': {
          delta: null as any,
        },
      };

      expect(() => applyTransform(source, transforms, 'invalid-transform')).toThrow();
    });

    it('should handle multiline source correctly', () => {
      const source = 'const x = 1;\nconst y = 2;\nconst z = 3;';
      const transforms: Transforms = {
        'add-comments': {
          delta: {
            0: ['const x = 1; // variable x'],
            1: ['const y = 2; // variable y'],
            2: ['const z = 3; // variable z'],
            _t: 'a',
          },
        },
      };

      const result = applyTransform(source, transforms, 'add-comments');
      expect(result).toContain('variable x');
      expect(result).toContain('variable y');
      expect(result).toContain('variable z');
    });
  });

  describe('applyTransforms', () => {
    it('should apply multiple transforms in sequence', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'first-transform': {
          delta: [['const x = 1; // first']],
        },
        'second-transform': {
          delta: [['const x = 1; // first // second']],
        },
      };

      const result = applyTransforms(source, transforms, ['first-transform', 'second-transform']);
      expect(result).toBe('const x = 1; // first // second');
    });

    it('should handle empty transform keys array', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransforms(source, transforms, []);
      expect(result).toBe('const x = 1;');
    });

    it('should apply single transform via array', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransforms(source, transforms, ['syntax-highlight']);
      expect(result).toBe('const x = 1; // highlighted');
    });

    it('should throw error for non-existent transform in sequence', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      expect(() =>
        applyTransforms(source, transforms, ['syntax-highlight', 'non-existent']),
      ).toThrow('Transform "non-existent" not found in transforms');
    });
  });
});
