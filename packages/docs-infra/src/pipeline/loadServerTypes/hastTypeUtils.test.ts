import { describe, it, expect } from 'vitest';
import type { Root as HastRoot, Element } from 'hast';
import {
  getHastTextContent,
  isUnionHast,
  isFunctionHast,
  isObjectHast,
  isArrayHast,
  isTupleHast,
  getShortTypeFromHast,
  shouldShowDetailedTypeFromHast,
  collectTypeReferences,
  replaceTypeReferences,
} from './hastTypeUtils';
import { formatInlineTypeAsHast } from './typeHighlighting';

describe('hastTypeUtils', () => {
  describe('getHastTextContent', () => {
    it('should extract text from text nodes', () => {
      const node = { type: 'text' as const, value: 'hello' };
      expect(getHastTextContent(node)).toBe('hello');
    });

    it('should extract text from element with text children', () => {
      const node: Element = {
        type: 'element',
        tagName: 'span',
        properties: {},
        children: [{ type: 'text', value: 'world' }],
      };
      expect(getHastTextContent(node)).toBe('world');
    });

    it('should concatenate text from nested children', () => {
      const node: HastRoot = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [
              { type: 'text', value: 'string' },
              { type: 'text', value: ' | ' },
              { type: 'text', value: 'number' },
            ],
          },
        ],
      };
      expect(getHastTextContent(node)).toBe('string | number');
    });

    it('should handle empty text nodes', () => {
      const node = { type: 'text' as const, value: '' };
      expect(getHastTextContent(node)).toBe('');
    });
  });

  describe('isUnionHast', () => {
    it('should return true for simple union types', async () => {
      const hast = await formatInlineTypeAsHast('string | number');
      expect(isUnionHast(hast)).toBe(true);
    });

    it('should return true for string literal unions', async () => {
      const hast = await formatInlineTypeAsHast('"a" | "b" | "c"');
      expect(isUnionHast(hast)).toBe(true);
    });

    it('should return true for union with null', async () => {
      const hast = await formatInlineTypeAsHast('string | null');
      expect(isUnionHast(hast)).toBe(true);
    });

    it('should return false for non-union types', async () => {
      const hast = await formatInlineTypeAsHast('string');
      expect(isUnionHast(hast)).toBe(false);
    });

    it('should return false for pipes inside parentheses', async () => {
      // (a | b) is a union but at the top level it's NOT a union
      // Just (a | b) alone should be considered a union
      const hast = await formatInlineTypeAsHast('(a | b)');
      // The union is inside parens, so no top-level union
      expect(isUnionHast(hast)).toBe(false);
    });

    it('should return true for union at top level with nested union', async () => {
      const hast = await formatInlineTypeAsHast('(a | b) | c');
      expect(isUnionHast(hast)).toBe(true);
    });

    it('should return false for pipes inside braces (object types)', async () => {
      const hast = await formatInlineTypeAsHast('{ a: string | number }');
      expect(isUnionHast(hast)).toBe(false);
    });

    it('should return true for object with top-level union', async () => {
      const hast = await formatInlineTypeAsHast('{ a: string } | null');
      expect(isUnionHast(hast)).toBe(true);
    });

    it('should return false for pipes inside angle brackets (generics)', async () => {
      const hast = await formatInlineTypeAsHast('Map<string | number, boolean>');
      expect(isUnionHast(hast)).toBe(false);
    });
  });

  describe('isFunctionHast', () => {
    it('should return true for arrow function type', async () => {
      const hast = await formatInlineTypeAsHast('() => void');
      expect(isFunctionHast(hast)).toBe(true);
    });

    it('should return true for arrow function with params', async () => {
      const hast = await formatInlineTypeAsHast('(event: Event) => void');
      expect(isFunctionHast(hast)).toBe(true);
    });

    it('should return true for arrow function with complex return', async () => {
      const hast = await formatInlineTypeAsHast('() => Promise<string>');
      expect(isFunctionHast(hast)).toBe(true);
    });

    it('should return false for non-function types', async () => {
      const hast = await formatInlineTypeAsHast('string');
      expect(isFunctionHast(hast)).toBe(false);
    });

    it('should return false for object types', async () => {
      const hast = await formatInlineTypeAsHast('{ name: string }');
      expect(isFunctionHast(hast)).toBe(false);
    });

    it('should return true for function in union', async () => {
      const hast = await formatInlineTypeAsHast('(() => void) | null');
      expect(isFunctionHast(hast)).toBe(true);
    });
  });

  describe('isObjectHast', () => {
    it('should return true for simple object type', async () => {
      const hast = await formatInlineTypeAsHast('{ name: string }');
      expect(isObjectHast(hast)).toBe(true);
    });

    it('should return true for object with multiple properties', async () => {
      const hast = await formatInlineTypeAsHast('{ x: number; y: number }');
      expect(isObjectHast(hast)).toBe(true);
    });

    it('should return false for non-object types', async () => {
      const hast = await formatInlineTypeAsHast('string');
      expect(isObjectHast(hast)).toBe(false);
    });

    it('should return false for array types', async () => {
      const hast = await formatInlineTypeAsHast('string[]');
      expect(isObjectHast(hast)).toBe(false);
    });

    it('should return false for function types', async () => {
      const hast = await formatInlineTypeAsHast('() => void');
      expect(isObjectHast(hast)).toBe(false);
    });

    it('should return false for object in union', async () => {
      const hast = await formatInlineTypeAsHast('{ a: string } | null');
      expect(isObjectHast(hast)).toBe(false);
    });
  });

  describe('isArrayHast', () => {
    it('should return true for array type', async () => {
      const hast = await formatInlineTypeAsHast('string[]');
      expect(isArrayHast(hast)).toBe(true);
    });

    it('should return true for number array', async () => {
      const hast = await formatInlineTypeAsHast('number[]');
      expect(isArrayHast(hast)).toBe(true);
    });

    it('should return false for non-array types', async () => {
      const hast = await formatInlineTypeAsHast('string');
      expect(isArrayHast(hast)).toBe(false);
    });

    it('should return false for tuple types', async () => {
      const hast = await formatInlineTypeAsHast('[string, number]');
      expect(isArrayHast(hast)).toBe(false);
    });

    it('should return false for Array generic', async () => {
      const hast = await formatInlineTypeAsHast('Array<string>');
      expect(isArrayHast(hast)).toBe(false);
    });
  });

  describe('isTupleHast', () => {
    it('should return true for tuple type', async () => {
      const hast = await formatInlineTypeAsHast('[string, number]');
      expect(isTupleHast(hast)).toBe(true);
    });

    it('should return true for triple tuple', async () => {
      const hast = await formatInlineTypeAsHast('[string, number, boolean]');
      expect(isTupleHast(hast)).toBe(true);
    });

    it('should return false for array type', async () => {
      const hast = await formatInlineTypeAsHast('string[]');
      expect(isTupleHast(hast)).toBe(false);
    });

    it('should return false for non-tuple types', async () => {
      const hast = await formatInlineTypeAsHast('string');
      expect(isTupleHast(hast)).toBe(false);
    });
  });

  describe('getShortTypeFromHast', () => {
    describe('event handlers', () => {
      it('should return "function" for onClick', async () => {
        const hast = await formatInlineTypeAsHast('(event: MouseEvent) => void');
        expect(getShortTypeFromHast('onClick', hast)).toBe('function');
      });

      it('should return "function" for onChange', async () => {
        const hast = await formatInlineTypeAsHast('(value: string) => void');
        expect(getShortTypeFromHast('onChange', hast)).toBe('function');
      });

      it('should return "function" for onOpenChange even with string type', async () => {
        // Event handler pattern takes priority over type analysis
        const hast = await formatInlineTypeAsHast('string');
        expect(getShortTypeFromHast('onSomething', hast)).toBe('function');
      });
    });

    describe('getters', () => {
      it('should return "function" for getValue', async () => {
        const hast = await formatInlineTypeAsHast('() => string');
        expect(getShortTypeFromHast('getValue', hast)).toBe('function');
      });

      it('should return "function" for getItemId', async () => {
        const hast = await formatInlineTypeAsHast('(item: T) => string');
        expect(getShortTypeFromHast('getItemId', hast)).toBe('function');
      });
    });

    describe('special props', () => {
      it('should return "string | function" for className', async () => {
        const hast = await formatInlineTypeAsHast('string | ((state: State) => string)');
        expect(getShortTypeFromHast('className', hast)).toBe('string | function');
      });

      it('should return "React.CSSProperties | function" for style', async () => {
        const hast = await formatInlineTypeAsHast('CSSProperties');
        expect(getShortTypeFromHast('style', hast)).toBe('React.CSSProperties | function');
      });

      it('should return "ReactElement | function" for render', async () => {
        const hast = await formatInlineTypeAsHast('ReactElement');
        expect(getShortTypeFromHast('render', hast)).toBe('ReactElement | function');
      });
    });

    describe('function types', () => {
      it('should return "function" for arrow functions', async () => {
        const hast = await formatInlineTypeAsHast('() => void');
        expect(getShortTypeFromHast('callback', hast)).toBe('function');
      });

      it('should return "function" for function with params', async () => {
        const hast = await formatInlineTypeAsHast('(a: string, b: number) => void');
        expect(getShortTypeFromHast('handler', hast)).toBe('function');
      });
    });

    describe('union types', () => {
      it('should return "Union" for complex union types with 3+ members', async () => {
        const hast = await formatInlineTypeAsHast('"a" | "b" | "c"');
        expect(getShortTypeFromHast('variant', hast)).toBe('Union');
      });

      it('should return undefined for simple union with null (short text)', async () => {
        const hast = await formatInlineTypeAsHast('string | null');
        expect(getShortTypeFromHast('value', hast)).toBeUndefined();
      });

      it('should return undefined for short 2-member union', async () => {
        const hast = await formatInlineTypeAsHast('"yes" | "no"');
        expect(getShortTypeFromHast('answer', hast)).toBeUndefined();
      });

      it('should return "Union" for long 2-member union', async () => {
        const hast = await formatInlineTypeAsHast(
          'ReactNode | PayloadChildRenderFunction<Payload>',
        );
        expect(getShortTypeFromHast('children', hast)).toBeUndefined(); // children is special-cased
        expect(getShortTypeFromHast('content', hast)).toBe('Union'); // but other props get Union
      });
    });

    describe('simple types', () => {
      it('should return undefined for string', async () => {
        const hast = await formatInlineTypeAsHast('string');
        expect(getShortTypeFromHast('name', hast)).toBeUndefined();
      });

      it('should return undefined for number', async () => {
        const hast = await formatInlineTypeAsHast('number');
        expect(getShortTypeFromHast('count', hast)).toBeUndefined();
      });

      it('should return undefined for boolean', async () => {
        const hast = await formatInlineTypeAsHast('boolean');
        expect(getShortTypeFromHast('disabled', hast)).toBeUndefined();
      });
    });
  });

  describe('shouldShowDetailedTypeFromHast', () => {
    describe('always show detailed for event handlers', () => {
      it('should return true for onClick', async () => {
        const hast = await formatInlineTypeAsHast('(event: MouseEvent) => void');
        expect(shouldShowDetailedTypeFromHast('onClick', hast)).toBe(true);
      });

      it('should return true for onChange', async () => {
        const hast = await formatInlineTypeAsHast('(value: string) => void');
        expect(shouldShowDetailedTypeFromHast('onChange', hast)).toBe(true);
      });
    });

    describe('always show detailed for getters', () => {
      it('should return true for getValue', async () => {
        const hast = await formatInlineTypeAsHast('() => string');
        expect(shouldShowDetailedTypeFromHast('getValue', hast)).toBe(true);
      });
    });

    describe('always show detailed for special props', () => {
      it('should return true for className', async () => {
        const hast = await formatInlineTypeAsHast('string');
        expect(shouldShowDetailedTypeFromHast('className', hast)).toBe(true);
      });

      it('should return true for render', async () => {
        const hast = await formatInlineTypeAsHast('ReactElement');
        expect(shouldShowDetailedTypeFromHast('render', hast)).toBe(true);
      });
    });

    describe('never show detailed for certain props', () => {
      it('should return false for ref props', async () => {
        const hast = await formatInlineTypeAsHast('React.RefObject<HTMLButtonElement>');
        expect(shouldShowDetailedTypeFromHast('buttonRef', hast)).toBe(false);
      });

      it('should return false for children', async () => {
        const hast = await formatInlineTypeAsHast('React.ReactNode');
        expect(shouldShowDetailedTypeFromHast('children', hast)).toBe(false);
      });
    });

    describe('simple types', () => {
      it('should return false for boolean', async () => {
        const hast = await formatInlineTypeAsHast('boolean');
        expect(shouldShowDetailedTypeFromHast('disabled', hast)).toBe(false);
      });

      it('should return false for string', async () => {
        const hast = await formatInlineTypeAsHast('string');
        expect(shouldShowDetailedTypeFromHast('name', hast)).toBe(false);
      });

      it('should return false for number', async () => {
        const hast = await formatInlineTypeAsHast('number');
        expect(shouldShowDetailedTypeFromHast('count', hast)).toBe(false);
      });
    });

    describe('union types', () => {
      it('should return true for complex unions (3+ members)', async () => {
        const hast = await formatInlineTypeAsHast('"primary" | "secondary" | "tertiary"');
        expect(shouldShowDetailedTypeFromHast('variant', hast)).toBe(true);
      });

      it('should return false for short simple unions', async () => {
        const hast = await formatInlineTypeAsHast('"yes" | "no"');
        expect(shouldShowDetailedTypeFromHast('answer', hast)).toBe(false);
      });
    });
  });

  describe('collectTypeReferences', () => {
    it('should find single identifier references', async () => {
      const hast = await formatInlineTypeAsHast('ButtonProps');
      const refs = collectTypeReferences(hast);
      expect(refs.length).toBe(1);
      expect(refs[0].name).toBe('ButtonProps');
    });

    it('should find dotted identifier references', async () => {
      const hast = await formatInlineTypeAsHast('Slider.Root.State');
      const refs = collectTypeReferences(hast);
      expect(refs.length).toBe(1);
      expect(refs[0].name).toBe('Slider.Root.State');
    });

    it('should find multiple references', async () => {
      const hast = await formatInlineTypeAsHast('ButtonProps | InputProps');
      const refs = collectTypeReferences(hast);
      expect(refs.length).toBe(2);
      expect(refs.map((r) => r.name).sort()).toEqual(['ButtonProps', 'InputProps']);
    });

    it('should handle references in generics', async () => {
      const hast = await formatInlineTypeAsHast('React.RefObject<HTMLElement>');
      const refs = collectTypeReferences(hast);
      // Should find React, RefObject, HTMLElement as references
      expect(refs.map((r) => r.name)).toContain('React.RefObject');
    });

    it('should return empty for intrinsic types', async () => {
      const hast = await formatInlineTypeAsHast('string');
      const refs = collectTypeReferences(hast);
      // string is highlighted as pl-c1, not pl-en
      expect(refs.length).toBe(0);
    });
  });

  describe('replaceTypeReferences', () => {
    it('should replace single reference with its definition', async () => {
      const hast = await formatInlineTypeAsHast('ButtonState');
      const highlightedExports = {
        ButtonState: await formatInlineTypeAsHast('{ active: boolean; pressed: boolean }'),
      };
      const result = replaceTypeReferences(hast, highlightedExports);
      const text = getHastTextContent(result);
      expect(text).toContain('active');
      expect(text).toContain('boolean');
    });

    it('should replace dotted reference', async () => {
      const hast = await formatInlineTypeAsHast('Slider.Root.State');
      const highlightedExports = {
        'Slider.Root.State': await formatInlineTypeAsHast('{ dragging: boolean }'),
      };
      const result = replaceTypeReferences(hast, highlightedExports);
      const text = getHastTextContent(result);
      expect(text).toContain('dragging');
    });

    it('should return original HAST if no matches', async () => {
      const hast = await formatInlineTypeAsHast('string');
      const highlightedExports = {
        SomeType: await formatInlineTypeAsHast('{ a: string }'),
      };
      const result = replaceTypeReferences(hast, highlightedExports);
      expect(getHastTextContent(result)).toBe('string');
    });

    it('should replace multiple references', async () => {
      const hast = await formatInlineTypeAsHast('ButtonState | InputState');
      const highlightedExports = {
        ButtonState: await formatInlineTypeAsHast('{ pressed: boolean }'),
        InputState: await formatInlineTypeAsHast('{ focused: boolean }'),
      };
      const result = replaceTypeReferences(hast, highlightedExports);
      const text = getHastTextContent(result);
      expect(text).toContain('pressed');
      expect(text).toContain('focused');
    });

    it('should not mutate original HAST', async () => {
      const hast = await formatInlineTypeAsHast('ButtonState');
      const originalText = getHastTextContent(hast);
      const highlightedExports = {
        ButtonState: await formatInlineTypeAsHast('{ active: boolean }'),
      };
      replaceTypeReferences(hast, highlightedExports);
      // Original should be unchanged
      expect(getHastTextContent(hast)).toBe(originalText);
    });
  });
});
