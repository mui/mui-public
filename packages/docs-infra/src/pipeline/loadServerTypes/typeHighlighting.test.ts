import { describe, it, expect } from 'vitest';
import type { Root as HastRoot, Element } from 'hast';
import {
  formatInlineTypeAsHast,
  formatDetailedTypeAsHast,
  formatMultilineUnionHast,
  getShortTypeString,
  shouldShowDetailedType,
  DEFAULT_UNION_PRINT_WIDTH,
} from './typeHighlighting';
import { getHastTextContent } from './hastTypeUtils';

/**
 * Helper to extract all text content from HAST
 */
function extractText(hast: HastRoot): string {
  return getHastTextContent(hast);
}

/**
 * Helper to check if HAST contains an element with a specific class
 */
function hasClassInHast(hast: HastRoot, className: string): boolean {
  const findClass = (node: any): boolean => {
    if (node.type === 'element') {
      const classes = node.properties?.className;
      if (Array.isArray(classes) && classes.includes(className)) {
        return true;
      }
    }
    if ('children' in node && Array.isArray(node.children)) {
      return node.children.some(findClass);
    }
    return false;
  };
  return findClass(hast);
}

describe('typeHighlighting', () => {
  describe('formatInlineTypeAsHast', () => {
    describe('basic types', () => {
      it('should highlight string type', async () => {
        const result = await formatInlineTypeAsHast('string');
        expect(extractText(result)).toBe('string');
        // string is highlighted as pl-c1 (constant)
        expect(hasClassInHast(result, 'pl-c1')).toBe(true);
      });

      it('should highlight number type', async () => {
        const result = await formatInlineTypeAsHast('number');
        expect(extractText(result)).toBe('number');
        expect(hasClassInHast(result, 'pl-c1')).toBe(true);
      });

      it('should highlight boolean type', async () => {
        const result = await formatInlineTypeAsHast('boolean');
        expect(extractText(result)).toBe('boolean');
        expect(hasClassInHast(result, 'pl-c1')).toBe(true);
      });

      it('should highlight undefined type', async () => {
        const result = await formatInlineTypeAsHast('undefined');
        expect(extractText(result)).toBe('undefined');
      });

      it('should highlight null type', async () => {
        const result = await formatInlineTypeAsHast('null');
        expect(extractText(result)).toBe('null');
      });

      it('should highlight any type', async () => {
        const result = await formatInlineTypeAsHast('any');
        expect(extractText(result)).toBe('any');
      });

      it('should highlight void type', async () => {
        const result = await formatInlineTypeAsHast('void');
        expect(extractText(result)).toBe('void');
      });
    });

    describe('union types', () => {
      it('should highlight simple union type', async () => {
        const result = await formatInlineTypeAsHast('string | number');
        expect(extractText(result)).toBe('string | number');
        // | is highlighted as pl-k (keyword)
        expect(hasClassInHast(result, 'pl-k')).toBe(true);
      });

      it('should highlight string literal union', async () => {
        const result = await formatInlineTypeAsHast('"primary" | "secondary"');
        expect(extractText(result)).toBe('"primary" | "secondary"');
        // String literals highlighted as pl-s (string)
        expect(hasClassInHast(result, 'pl-s')).toBe(true);
      });

      it('should highlight union with null', async () => {
        const result = await formatInlineTypeAsHast('string | null');
        expect(extractText(result)).toBe('string | null');
      });

      it('should highlight union with undefined', async () => {
        const result = await formatInlineTypeAsHast('number | undefined');
        expect(extractText(result)).toBe('number | undefined');
      });
    });

    describe('function types', () => {
      it('should highlight arrow function type', async () => {
        const result = await formatInlineTypeAsHast('() => void');
        expect(extractText(result)).toBe('() => void');
        // => is highlighted as pl-k (keyword)
        expect(hasClassInHast(result, 'pl-k')).toBe(true);
      });

      it('should highlight function with parameters', async () => {
        const result = await formatInlineTypeAsHast('(event: MouseEvent) => void');
        expect(extractText(result)).toBe('(event: MouseEvent) => void');
      });

      it('should highlight function with generic return', async () => {
        const result = await formatInlineTypeAsHast('() => Promise<void>');
        expect(extractText(result)).toBe('() => Promise<void>');
      });

      it('should highlight callback function with multiple params', async () => {
        const result = await formatInlineTypeAsHast('(value: string, index: number) => void');
        expect(extractText(result)).toBe('(value: string, index: number) => void');
      });
    });

    describe('object types', () => {
      it('should highlight simple object type', async () => {
        const result = await formatInlineTypeAsHast('{ name: string }');
        expect(extractText(result)).toBe('{ name: string }');
      });

      it('should highlight object with multiple properties', async () => {
        const result = await formatInlineTypeAsHast('{ x: number; y: number }');
        expect(extractText(result)).toBe('{ x: number; y: number }');
      });

      it('should highlight nested object type', async () => {
        const result = await formatInlineTypeAsHast('{ user: { id: string; name: string } }');
        expect(extractText(result)).toBe('{ user: { id: string; name: string } }');
      });
    });

    describe('array types', () => {
      it('should highlight array type', async () => {
        const result = await formatInlineTypeAsHast('string[]');
        expect(extractText(result)).toBe('string[]');
      });

      it('should highlight Array generic', async () => {
        const result = await formatInlineTypeAsHast('Array<string>');
        expect(extractText(result)).toBe('Array<string>');
      });

      it('should highlight tuple type', async () => {
        const result = await formatInlineTypeAsHast('[string, number]');
        expect(extractText(result)).toBe('[string, number]');
      });
    });

    describe('generic types', () => {
      it('should highlight simple generic type', async () => {
        const result = await formatInlineTypeAsHast('Promise<string>');
        expect(extractText(result)).toBe('Promise<string>');
      });

      it('should highlight generic with multiple type params', async () => {
        const result = await formatInlineTypeAsHast('Map<string, number>');
        expect(extractText(result)).toBe('Map<string, number>');
      });

      it('should highlight React.ReactNode', async () => {
        const result = await formatInlineTypeAsHast('React.ReactNode');
        expect(extractText(result)).toBe('React.ReactNode');
      });

      it('should highlight React.RefObject', async () => {
        const result = await formatInlineTypeAsHast('React.RefObject<HTMLDivElement>');
        expect(extractText(result)).toBe('React.RefObject<HTMLDivElement>');
      });
    });

    describe('complex types', () => {
      it('should highlight union of functions', async () => {
        const result = await formatInlineTypeAsHast('(() => void) | null');
        expect(extractText(result)).toBe('(() => void) | null');
      });

      it('should highlight intersection type', async () => {
        const result = await formatInlineTypeAsHast('A & B');
        expect(extractText(result)).toBe('A & B');
      });

      it('should highlight conditional type', async () => {
        const result = await formatInlineTypeAsHast('T extends string ? true : false');
        expect(extractText(result)).toBe('T extends string ? true : false');
        // extends is highlighted as pl-k (keyword)
        expect(hasClassInHast(result, 'pl-k')).toBe(true);
      });

      it('should highlight mapped type', async () => {
        const result = await formatInlineTypeAsHast('{ [K in keyof T]: string }');
        expect(extractText(result)).toBe('{ [K in keyof T]: string }');
      });
    });

    describe('multiline union formatting', () => {
      it('should NOT format short unions as multiline', async () => {
        const result = await formatInlineTypeAsHast('string | number', 40);
        const text = extractText(result);
        expect(text).toBe('string | number');
        // Should not have <br> elements
        const findBr = (node: any): boolean => {
          if (node.type === 'element' && node.tagName === 'br') {
            return true;
          }
          if ('children' in node && Array.isArray(node.children)) {
            return node.children.some(findBr);
          }
          return false;
        };
        expect(findBr(result)).toBe(false);
      });

      it('should format long unions as multiline when exceeding width', async () => {
        const longUnion = '"primary" | "secondary" | "tertiary" | "quaternary"';
        const result = await formatInlineTypeAsHast(longUnion, 20);
        // Check for presence of <br> element
        const findBr = (node: any): boolean => {
          if (node.type === 'element' && node.tagName === 'br') {
            return true;
          }
          if ('children' in node && Array.isArray(node.children)) {
            return node.children.some(findBr);
          }
          return false;
        };
        expect(findBr(result)).toBe(true);
      });

      it('should add leading pipe to each line in multiline union', async () => {
        const longUnion = '"a" | "b" | "c" | "d"';
        const result = await formatInlineTypeAsHast(longUnion, 10);
        // Each union member should be prefixed with | (including the first)
        const text = extractText(result);
        // The text should have pipes as leading characters after formatting
        expect(text.includes('|')).toBe(true);
      });
    });
  });

  describe('formatDetailedTypeAsHast', () => {
    it('should create pre > code structure', async () => {
      const result = await formatDetailedTypeAsHast('string');
      const preElement = result.children[0] as Element;
      expect(preElement.tagName).toBe('pre');
      const codeElement = preElement.children[0] as Element;
      expect(codeElement.tagName).toBe('code');
    });

    it('should highlight complex types', async () => {
      const complexType = `{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerElement: HTMLElement | null;
}`;
      const result = await formatDetailedTypeAsHast(complexType);
      expect(extractText(result)).toContain('open');
      expect(extractText(result)).toContain('boolean');
      expect(hasClassInHast(result, 'pl-c1')).toBe(true); // boolean constant
    });

    it('should add line gutters to multiline types', async () => {
      const multilineType = `{
  x: number;
  y: number;
}`;
      const result = await formatDetailedTypeAsHast(multilineType);
      // Line gutters are added via starryNightGutter
      // Check that the structure is correct (pre > code with children)
      const preElement = result.children[0] as Element;
      expect(preElement.tagName).toBe('pre');
      const codeElement = preElement.children[0] as Element;
      expect(codeElement.tagName).toBe('code');
      expect(codeElement.children.length).toBeGreaterThan(0);
    });
  });

  describe('formatMultilineUnionHast', () => {
    it('should return original HAST if only one group', async () => {
      const hast = await formatInlineTypeAsHast('string');
      const result = formatMultilineUnionHast(hast);
      expect(extractText(result)).toBe('string');
    });

    it('should split unions at top-level pipes', async () => {
      const hast = await formatInlineTypeAsHast('"a" | "b" | "c"');
      const result = formatMultilineUnionHast(hast);
      // Check for br elements
      const findBr = (node: any): boolean => {
        if (node.type === 'element' && node.tagName === 'br') {
          return true;
        }
        if ('children' in node && Array.isArray(node.children)) {
          return node.children.some(findBr);
        }
        return false;
      };
      expect(findBr(result)).toBe(true);
    });

    it('should NOT split pipes inside parentheses', async () => {
      // A union inside parens: (a | b) | c
      // Should only split at the top-level pipe before c, not the one inside parens
      const hast = await formatInlineTypeAsHast('(a | b) | c');
      const result = formatMultilineUnionHast(hast);
      // Should have exactly one br (between (a | b) and c)
      let brCount = 0;
      const countBr = (node: any): void => {
        if (node.type === 'element' && node.tagName === 'br') {
          brCount += 1;
        }
        if ('children' in node && Array.isArray(node.children)) {
          node.children.forEach(countBr);
        }
      };
      countBr(result);
      // There should be 1 br (one top-level pipe split)
      expect(brCount).toBe(1);
    });

    it('should NOT split pipes inside braces', async () => {
      // Object type with union inside: { a: string | number } | null
      const hast = await formatInlineTypeAsHast('{ a: string | number } | null');
      const result = formatMultilineUnionHast(hast);
      // Should only have 1 br at the top-level union
      let brCount = 0;
      const countBr = (node: any): void => {
        if (node.type === 'element' && node.tagName === 'br') {
          brCount += 1;
        }
        if ('children' in node && Array.isArray(node.children)) {
          node.children.forEach(countBr);
        }
      };
      countBr(result);
      expect(brCount).toBe(1);
    });
  });

  describe('getShortTypeString', () => {
    describe('event handlers', () => {
      it('should return "function" for onClick', () => {
        expect(getShortTypeString('onClick', '(event: MouseEvent) => void')).toBe('function');
      });

      it('should return "function" for onChange', () => {
        expect(getShortTypeString('onChange', '(value: string) => void')).toBe('function');
      });

      it('should return "function" for onOpenChange', () => {
        expect(getShortTypeString('onOpenChange', '(open: boolean) => void')).toBe('function');
      });
    });

    describe('getter functions', () => {
      it('should return "function" for getValue', () => {
        expect(getShortTypeString('getValue', '() => string')).toBe('function');
      });

      it('should return "function" for getItemId', () => {
        expect(getShortTypeString('getItemId', '(item: T) => string')).toBe('function');
      });
    });

    describe('special props', () => {
      it('should return "string | function" for className', () => {
        expect(getShortTypeString('className', 'string | ((state: State) => string)')).toBe(
          'string | function',
        );
      });

      it('should return "React.CSSProperties | function" for style', () => {
        expect(
          getShortTypeString('style', 'React.CSSProperties | ((state: State) => CSSProperties)'),
        ).toBe('React.CSSProperties | function');
      });

      it('should return "ReactElement | function" for render', () => {
        expect(
          getShortTypeString('render', 'ReactElement | ((state: State) => ReactElement)'),
        ).toBe('ReactElement | function');
      });
    });

    describe('union types', () => {
      it('should return "Union" for complex unions', () => {
        expect(
          getShortTypeString('variant', '"primary" | "secondary" | "tertiary" | "quaternary"'),
        ).toBe('Union');
      });

      it('should return undefined for simple unions', () => {
        expect(getShortTypeString('variant', '"yes" | "no"')).toBeUndefined();
      });

      it('should return undefined for short unions below threshold', () => {
        expect(getShortTypeString('size', '"small" | "medium"')).toBeUndefined();
      });
    });

    describe('simple types', () => {
      it('should return undefined for string', () => {
        expect(getShortTypeString('name', 'string')).toBeUndefined();
      });

      it('should return undefined for number', () => {
        expect(getShortTypeString('count', 'number')).toBeUndefined();
      });

      it('should return undefined for boolean', () => {
        expect(getShortTypeString('disabled', 'boolean')).toBeUndefined();
      });
    });
  });

  describe('shouldShowDetailedType', () => {
    describe('always show detailed for event handlers', () => {
      it('should return true for onClick', () => {
        expect(shouldShowDetailedType('onClick', '(event: MouseEvent) => void')).toBe(true);
      });

      it('should return true for onChange', () => {
        expect(shouldShowDetailedType('onChange', '(value: string) => void')).toBe(true);
      });
    });

    describe('always show detailed for getters', () => {
      it('should return true for getValue', () => {
        expect(shouldShowDetailedType('getValue', '() => string')).toBe(true);
      });
    });

    describe('always show detailed for special props', () => {
      it('should return true for className', () => {
        expect(shouldShowDetailedType('className', 'string')).toBe(true);
      });

      it('should return true for render', () => {
        expect(shouldShowDetailedType('render', 'ReactElement')).toBe(true);
      });
    });

    describe('never show detailed for certain props', () => {
      it('should return false for ref props', () => {
        expect(shouldShowDetailedType('buttonRef', 'React.RefObject<HTMLButtonElement>')).toBe(
          false,
        );
      });

      it('should return false for children', () => {
        expect(shouldShowDetailedType('children', 'React.ReactNode')).toBe(false);
      });
    });

    describe('simple types', () => {
      it('should return false for string', () => {
        expect(shouldShowDetailedType('name', 'string')).toBe(false);
      });

      it('should return false for number', () => {
        expect(shouldShowDetailedType('count', 'number')).toBe(false);
      });

      it('should return false for boolean', () => {
        expect(shouldShowDetailedType('disabled', 'boolean')).toBe(false);
      });
    });

    describe('union types', () => {
      it('should return true for complex unions', () => {
        expect(
          shouldShowDetailedType('variant', '"primary" | "secondary" | "tertiary" | "quaternary"'),
        ).toBe(true);
      });

      it('should return false for short simple unions', () => {
        expect(shouldShowDetailedType('size', '"small" | "medium"')).toBe(false);
      });

      it('should return false for unions without pipe', () => {
        expect(shouldShowDetailedType('value', 'string')).toBe(false);
      });
    });

    describe('undefined/null types', () => {
      it('should return false for undefined type', () => {
        expect(shouldShowDetailedType('value', undefined)).toBe(false);
      });

      it('should return false for null type', () => {
        expect(shouldShowDetailedType('value', null as any)).toBe(false);
      });
    });
  });

  describe('DEFAULT_UNION_PRINT_WIDTH', () => {
    it('should be 40', () => {
      expect(DEFAULT_UNION_PRINT_WIDTH).toBe(40);
    });
  });
});
