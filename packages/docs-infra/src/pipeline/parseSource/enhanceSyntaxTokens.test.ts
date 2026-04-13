import { describe, it, expect } from 'vitest';
import type { Root, Element, ElementContent, Text } from 'hast';
import { enhanceSyntaxTokens } from './enhanceSyntaxTokens';

/**
 * Helper to create a span element with a class and text content.
 */
function span(className: string, textValue: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [className] },
    children: [{ type: 'text', value: textValue }],
  };
}

/**
 * Helper to create a span with multiple classes.
 */
function spanMultiClass(classNames: string[], textValue: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [...classNames] },
    children: [{ type: 'text', value: textValue }],
  };
}

/**
 * Helper to create a text node.
 */
function textNode(value: string): Text {
  return { type: 'text', value };
}

/**
 * Helper to create a pl-s (string) span with pl-pds delimiters as starry-night would.
 * e.g. `"hello"` → `<span class="pl-s"><span class="pl-pds">"</span>hello<span class="pl-pds">"</span></span>`
 */
function stringSpan(quote: string, content: string): Element {
  const children: ElementContent[] = [
    span('pl-pds', quote),
    ...(content ? [textNode(content)] : []),
    span('pl-pds', quote),
  ];
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['pl-s'] },
    children,
  };
}

/**
 * Helper to wrap children in a Root node.
 */
function root(children: ElementContent[]): Root {
  return { type: 'root', children };
}

/**
 * Helper to get className array from an element.
 */
function getClasses(element: Element): string[] {
  const className = element.properties?.className;
  if (Array.isArray(className)) {
    return className.map(String);
  }
  return [];
}

describe('enhanceSyntaxTokens', () => {
  describe('number enhancement (di-num)', () => {
    it('adds di-num to integer constants', () => {
      const node = span('pl-c1', '42');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to float constants', () => {
      const node = span('pl-c1', '3.14');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to negative numbers', () => {
      const node = span('pl-c1', '-1');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to decimal starting with dot', () => {
      const node = span('pl-c1', '.5');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to hex constants', () => {
      const node = span('pl-c1', '0xFF');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to zero', () => {
      const node = span('pl-c1', '0');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to CSS numeric values with units', () => {
      const node = span('pl-c1', '100px');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to percentage values', () => {
      const node = span('pl-c1', '50%');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num when unit is nested as pl-smi child', () => {
      // Starry-night tokenizes `1rem` as `<span class="pl-c1">1<span class="pl-smi">rem</span></span>`
      const node: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['pl-c1'] },
        children: [textNode('1'), span('pl-smi', 'rem')],
      };
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('does not add di-num to named constants like color', () => {
      const node = span('pl-c1', 'color');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('does not add di-num to component names like Button', () => {
      const node = span('pl-c1', 'Button');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('does not add di-num to non-pl-c1 spans', () => {
      const node = span('pl-k', '42');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-k']);
    });

    it('does not add di-num to NaN', () => {
      const node = span('pl-c1', 'NaN');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('does not add di-num to Infinity', () => {
      const node = span('pl-c1', 'Infinity');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });
  });

  describe('boolean enhancement (di-bool)', () => {
    it('adds di-bool to true', () => {
      const node = span('pl-c1', 'true');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-bool']);
    });

    it('adds di-bool to false', () => {
      const node = span('pl-c1', 'false');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-bool']);
    });

    it('does not add di-bool to non-pl-c1 spans', () => {
      const node = span('pl-s', 'true');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s']);
    });
  });

  describe('nullish enhancement (di-n)', () => {
    it('adds di-n to null', () => {
      const node = span('pl-c1', 'null');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-n']);
    });

    it('adds di-n to undefined', () => {
      const node = span('pl-c1', 'undefined');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-n']);
    });

    it('does not add di-n to undefinedValue', () => {
      const node = span('pl-c1', 'undefinedValue');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('adds di-n to empty double-quoted string', () => {
      const node = stringSpan('"', '');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s', 'di-n']);
    });

    it('adds di-n to empty single-quoted string', () => {
      const node = stringSpan("'", '');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s', 'di-n']);
    });

    it('does not add di-n to non-empty strings', () => {
      const node = stringSpan('"', 'hello');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s']);
    });

    it('does not add di-n to strings with spaces', () => {
      const node = stringSpan('"', ' ');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s']);
    });
  });

  describe('additive behavior', () => {
    it('preserves existing pl-c1 class when adding di-num', () => {
      const node = span('pl-c1', '42');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toContain('pl-c1');
      expect(getClasses(node)).toContain('di-num');
    });

    it('preserves existing pl-c1 class when adding di-bool', () => {
      const node = span('pl-c1', 'true');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toContain('pl-c1');
      expect(getClasses(node)).toContain('di-bool');
    });

    it('preserves additional classes on the element', () => {
      const node = spanMultiClass(['pl-c1', 'custom-class'], '42');
      const tree = root([node]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'custom-class', 'di-num']);
    });
  });

  describe('CSS attribute selector enhancement (di-da)', () => {
    it('adds di-da to pl-c1 span preceded by [ text node', () => {
      // Current starry-night: &[<span class="pl-c1">data-starting-style</span>]
      const attrSpan = span('pl-c1', 'data-starting-style');
      const tree = root([span('pl-ent', '&'), textNode('['), attrSpan, textNode(']')]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toContain('pl-c1');
      expect(getClasses(attrSpan)).toContain('di-da');
    });

    it('adds di-da to pl-e span preceded by [ text node (future starry-night)', () => {
      const attrSpan = span('pl-e', 'data-ending-style');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toContain('pl-e');
      expect(getClasses(attrSpan)).toContain('di-da');
    });

    it('adds di-da for any attribute name in brackets, not just data-*', () => {
      const attrSpan = span('pl-c1', 'open');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toContain('di-da');
    });

    it('does not add di-da to CSS class selectors', () => {
      // .my-class is a pl-e span not preceded by [
      const classSpan = span('pl-e', '.my-class');
      const tree = root([classSpan]);

      enhanceSyntaxTokens(tree, 'source.css');

      expect(getClasses(classSpan)).toEqual(['pl-e']);
    });

    it('does not add di-da when not preceded by [', () => {
      const attrSpan = span('pl-c1', 'data-foo');
      const tree = root([textNode(' '), attrSpan, textNode(']')]);

      enhanceSyntaxTokens(tree, 'source.css');

      // Should still get di-num since data-foo starts with 'd', not a digit
      // Actually data-foo doesn't start with a digit, so no di-num either
      expect(getClasses(attrSpan)).toEqual(['pl-c1']);
    });

    it('does not add di-da for non-CSS grammar scopes', () => {
      const attrSpan = span('pl-c1', 'data-foo');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(attrSpan)).not.toContain('di-da');
    });

    it('also applies constant enhancement alongside di-da for numeric attribute names', () => {
      // Hypothetical: [0] — the 0 is pl-c1 and numeric
      const attrSpan = span('pl-c1', '0');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      enhanceSyntaxTokens(tree, 'source.css');

      // Gets both di-num (from constant enhancement) and di-da (from CSS attr selector)
      expect(getClasses(attrSpan)).toContain('di-num');
      expect(getClasses(attrSpan)).toContain('di-da');
    });
  });

  describe('HTML/JSX attribute enhancement', () => {
    describe('attribute equals (di-ae)', () => {
      it('wraps = in a di-ae span inside a tag context', () => {
        // <div className="test">
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          stringSpan('"', 'test'),
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        const children = tree.children;
        const aeSpan = children.find(
          (child) =>
            child.type === 'element' &&
            child.tagName === 'span' &&
            Array.isArray(child.properties?.className) &&
            (child.properties.className as string[]).includes('di-ae'),
        ) as Element | undefined;

        expect(aeSpan).toBeDefined();
        expect(aeSpan!.children).toEqual([{ type: 'text', value: '=' }]);
      });

      it('preserves text before = when splitting', () => {
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          stringSpan('"', 'test'),
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        // Should have text ' className' before the di-ae span
        const children = tree.children;
        const beforeText = children.find(
          (child) => child.type === 'text' && child.value === ' className',
        );
        expect(beforeText).toBeDefined();
      });

      it('does not wrap = outside a tag context', () => {
        // const x = "test" — = is pl-k in assignment context, not plain text
        // But testing with plain text = outside tags to be safe
        const tree = root([textNode('x='), stringSpan('"', 'test')]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        // No < was seen, so insideTag is false, no di-ae should exist
        const children = tree.children;
        const aeSpan = children.find(
          (child) =>
            child.type === 'element' &&
            child.tagName === 'span' &&
            Array.isArray(child.properties?.className) &&
            (child.properties.className as string[]).includes('di-ae'),
        ) as Element | undefined;

        expect(aeSpan).toBeUndefined();
      });

      it('does not wrap = for non-HTML/JSX grammars', () => {
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          stringSpan('"', 'test'),
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.css');

        const children = tree.children;
        const aeSpan = children.find(
          (child) =>
            child.type === 'element' &&
            child.tagName === 'span' &&
            Array.isArray(child.properties?.className) &&
            (child.properties.className as string[]).includes('di-ae'),
        ) as Element | undefined;

        expect(aeSpan).toBeUndefined();
      });

      it('wraps = in MDX grammar scope', () => {
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          stringSpan('"', 'test'),
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.mdx');

        const children = tree.children;
        const aeSpan = children.find(
          (child) =>
            child.type === 'element' &&
            child.tagName === 'span' &&
            Array.isArray(child.properties?.className) &&
            (child.properties.className as string[]).includes('di-ae'),
        ) as Element | undefined;

        expect(aeSpan).toBeDefined();
      });

      it('resets tag context after >', () => {
        // <div> x="test"
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode('> x='),
          stringSpan('"', 'test'),
        ]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        // After > the tag context is closed, so = should NOT be wrapped
        const children = tree.children;
        const aeSpan = children.find(
          (child) =>
            child.type === 'element' &&
            child.tagName === 'span' &&
            Array.isArray(child.properties?.className) &&
            (child.properties.className as string[]).includes('di-ae'),
        ) as Element | undefined;

        expect(aeSpan).toBeUndefined();
      });
    });

    describe('attribute value (di-av)', () => {
      it('adds di-av to pl-s span that is an attribute value', () => {
        const valueSpan = stringSpan('"', 'test');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          valueSpan,
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(valueSpan)).toContain('di-av');
        expect(getClasses(valueSpan)).toContain('pl-s');
      });

      it('does not add di-av outside tag context', () => {
        const valueSpan = stringSpan('"', 'test');
        const tree = root([textNode('x='), valueSpan]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(valueSpan)).toEqual(['pl-s']);
      });

      it('handles multiple attributes in a single tag', () => {
        const idValue = stringSpan('"', 'main');
        const classValue = stringSpan('"', 'test');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' id='),
          idValue,
          textNode(' className='),
          classValue,
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(idValue)).toContain('di-av');
        expect(getClasses(classValue)).toContain('di-av');
      });

      it('adds di-av to attribute values in MDX grammar scope', () => {
        const valueSpan = stringSpan('"', 'test');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          valueSpan,
          textNode('>'),
        ]);

        enhanceSyntaxTokens(tree, 'source.mdx');

        expect(getClasses(valueSpan)).toContain('di-av');
        expect(getClasses(valueSpan)).toContain('pl-s');
      });
    });
  });

  describe('nested structures', () => {
    it('enhances tokens inside frame/line structures', () => {
      const numSpan = span('pl-c1', '42');
      const boolSpan = span('pl-c1', 'true');
      const line: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['line'], dataLn: 1 },
        children: [span('pl-k', 'const'), textNode(' x = '), numSpan],
      };
      const line2: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['line'], dataLn: 2 },
        children: [span('pl-k', 'const'), textNode(' y = '), boolSpan],
      };
      const frame: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'] },
        children: [line, textNode('\n'), line2],
      };

      const tree = root([frame]);
      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(numSpan)).toEqual(['pl-c1', 'di-num']);
      expect(getClasses(boolSpan)).toEqual(['pl-c1', 'di-bool']);
    });
  });

  describe('empty tree', () => {
    it('handles empty root gracefully', () => {
      const tree = root([]);
      enhanceSyntaxTokens(tree, 'source.tsx');
      expect(tree.children).toEqual([]);
    });

    it('handles root with only text nodes', () => {
      const tree = root([textNode('plain text')]);
      enhanceSyntaxTokens(tree, 'source.tsx');
      expect(tree.children).toEqual([{ type: 'text', value: 'plain text' }]);
    });
  });

  describe('combined enhancements', () => {
    it('applies multiple enhancements in the same tree', () => {
      const numSpan = span('pl-c1', '42');
      const boolSpan = span('pl-c1', 'true');
      const nullSpan = span('pl-c1', 'null');
      const emptyString = stringSpan('"', '');
      const namedConst = span('pl-c1', 'Button');

      const tree = root([
        numSpan,
        textNode(', '),
        boolSpan,
        textNode(', '),
        nullSpan,
        textNode(', '),
        emptyString,
        textNode(', '),
        namedConst,
      ]);

      enhanceSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(numSpan)).toEqual(['pl-c1', 'di-num']);
      expect(getClasses(boolSpan)).toEqual(['pl-c1', 'di-bool']);
      expect(getClasses(nullSpan)).toEqual(['pl-c1', 'di-n']);
      expect(getClasses(emptyString)).toEqual(['pl-s', 'di-n']);
      expect(getClasses(namedConst)).toEqual(['pl-c1']);
    });
  });
});
