import { describe, it, expect } from 'vitest';
import type { Root, Element, ElementContent, Text } from 'hast';
import { extendSyntaxTokens } from './extendSyntaxTokens';

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

describe('extendSyntaxTokens', () => {
  describe('number enhancement (di-num)', () => {
    it('adds di-num to integer constants', () => {
      const node = span('pl-c1', '42');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to float constants', () => {
      const node = span('pl-c1', '3.14');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to negative numbers', () => {
      const node = span('pl-c1', '-1');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to decimal starting with dot', () => {
      const node = span('pl-c1', '.5');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to hex constants', () => {
      const node = span('pl-c1', '0xFF');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to zero', () => {
      const node = span('pl-c1', '0');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-num']);
    });

    it('adds di-num to CSS numeric values with units', () => {
      const node = span('pl-c1', '100px');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toContain('di-num');
    });

    it('adds di-num to percentage values', () => {
      const node = span('pl-c1', '50%');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toContain('di-num');
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

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).toContain('di-num');
    });

    it('does not add di-num to named constants like color', () => {
      const node = span('pl-c1', 'color');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(node)).not.toContain('di-num');
    });

    it('does not add di-num to component names like Button', () => {
      const node = span('pl-c1', 'Button');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('does not add di-num to non-pl-c1 spans', () => {
      const node = span('pl-k', '42');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-k']);
    });

    it('does not add di-num to NaN', () => {
      const node = span('pl-c1', 'NaN');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('does not add di-num to Infinity', () => {
      const node = span('pl-c1', 'Infinity');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });
  });

  describe('boolean enhancement (di-bool)', () => {
    it('adds di-bool to true', () => {
      const node = span('pl-c1', 'true');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-bool']);
    });

    it('adds di-bool to false', () => {
      const node = span('pl-c1', 'false');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-bool']);
    });

    it('does not add di-bool to non-pl-c1 spans', () => {
      const node = span('pl-s', 'true');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s']);
    });
  });

  describe('nullish enhancement (di-n)', () => {
    it('adds di-n to null', () => {
      const node = span('pl-c1', 'null');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-n']);
    });

    it('adds di-n to undefined', () => {
      const node = span('pl-c1', 'undefined');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'di-n']);
    });

    it('does not add di-n to undefinedValue', () => {
      const node = span('pl-c1', 'undefinedValue');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1']);
    });

    it('adds di-n to empty double-quoted string', () => {
      const node = stringSpan('"', '');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s', 'di-n']);
    });

    it('adds di-n to empty single-quoted string', () => {
      const node = stringSpan("'", '');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s', 'di-n']);
    });

    it('does not add di-n to non-empty strings', () => {
      const node = stringSpan('"', 'hello');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s']);
    });

    it('does not add di-n to strings with spaces', () => {
      const node = stringSpan('"', ' ');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-s']);
    });
  });

  describe('additive behavior', () => {
    it('preserves existing pl-c1 class when adding di-num', () => {
      const node = span('pl-c1', '42');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toContain('pl-c1');
      expect(getClasses(node)).toContain('di-num');
    });

    it('preserves existing pl-c1 class when adding di-bool', () => {
      const node = span('pl-c1', 'true');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toContain('pl-c1');
      expect(getClasses(node)).toContain('di-bool');
    });

    it('preserves additional classes on the element', () => {
      const node = spanMultiClass(['pl-c1', 'custom-class'], '42');
      const tree = root([node]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(node)).toEqual(['pl-c1', 'custom-class', 'di-num']);
    });
  });

  describe('CSS attribute selector enhancement (di-da)', () => {
    it('adds di-da to pl-c1 span preceded by [ text node', () => {
      // Current starry-night: &[<span class="pl-c1">data-starting-style</span>]
      const attrSpan = span('pl-c1', 'data-starting-style');
      const tree = root([span('pl-ent', '&'), textNode('['), attrSpan, textNode(']')]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toContain('pl-c1');
      expect(getClasses(attrSpan)).toContain('di-da');
    });

    it('adds di-da to pl-e span preceded by [ text node (future starry-night)', () => {
      const attrSpan = span('pl-e', 'data-ending-style');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toContain('pl-e');
      expect(getClasses(attrSpan)).toContain('di-da');
    });

    it('adds di-da for any attribute name in brackets, not just data-*', () => {
      const attrSpan = span('pl-c1', 'open');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toContain('di-da');
    });

    it('does not add di-da to CSS class selectors', () => {
      // .my-class is a pl-e span not preceded by [
      const classSpan = span('pl-e', '.my-class');
      const tree = root([classSpan]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(classSpan)).toEqual(['pl-e']);
    });

    it('does not add di-da when not preceded by [', () => {
      const attrSpan = span('pl-c1', 'data-foo');
      const tree = root([textNode(' '), attrSpan, textNode(']')]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(attrSpan)).toEqual(['pl-c1']);
    });

    it('does not add di-da for non-CSS grammar scopes', () => {
      const attrSpan = span('pl-c1', 'data-foo');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(attrSpan)).not.toContain('di-da');
    });

    it('also applies constant enhancement alongside di-da for numeric attribute names', () => {
      // Hypothetical: [0] — the 0 is pl-c1 and numeric
      const attrSpan = span('pl-c1', '0');
      const tree = root([textNode('['), attrSpan, textNode(']')]);

      extendSyntaxTokens(tree, 'source.css');

      // Gets both di-num (from constant enhancement) and di-da (from CSS attr selector)
      expect(getClasses(attrSpan)).toContain('di-num');
      expect(getClasses(attrSpan)).toContain('di-da');
    });
  });

  describe('HTML/JSX attribute enhancement', () => {
    describe('attribute key (di-ak)', () => {
      it('adds di-ak to pl-e span inside a tag', () => {
        const attrName = span('pl-e', 'className');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          attrName,
          span('pl-k', '='),
          stringSpan('"', 'x'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(attrName)).toContain('pl-e');
        expect(getClasses(attrName)).toContain('di-ak');
      });

      it('does not add di-ak to pl-e span outside a tag', () => {
        const entitySpan = span('pl-e', 'something');
        const tree = root([entitySpan]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(entitySpan)).toEqual(['pl-e']);
      });

      it('does not add di-ak for non-HTML/JSX grammars', () => {
        const attrName = span('pl-e', 'className');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          attrName,
          span('pl-k', '='),
          stringSpan('"', 'x'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(attrName)).toEqual(['pl-e']);
      });

      it('adds di-ak in MDX grammar scope', () => {
        const attrName = span('pl-e', 'className');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          attrName,
          span('pl-k', '='),
          stringSpan('"', 'x'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.mdx');

        expect(getClasses(attrName)).toContain('di-ak');
      });

      it('resets after > so pl-e outside tag does not get di-ak', () => {
        const insideAttr = span('pl-e', 'className');
        const outsideEntity = span('pl-e', 'something');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          insideAttr,
          span('pl-k', '='),
          stringSpan('"', 'x'),
          textNode('>'),
          outsideEntity,
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(insideAttr)).toContain('di-ak');
        expect(getClasses(outsideEntity)).toEqual(['pl-e']);
      });
    });

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

        extendSyntaxTokens(tree, 'source.tsx');

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

        extendSyntaxTokens(tree, 'source.tsx');

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

        extendSyntaxTokens(tree, 'source.tsx');

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

        extendSyntaxTokens(tree, 'source.css');

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

        extendSyntaxTokens(tree, 'source.mdx');

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

        extendSyntaxTokens(tree, 'source.tsx');

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

      it('adds di-ae to pl-k span containing = inside a tag', () => {
        // Real TSX output: <span class="pl-e">className</span><span class="pl-k">=</span><span class="pl-s">...</span>
        const equalsSpan = span('pl-k', '=');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          span('pl-e', 'className'),
          equalsSpan,
          stringSpan('"', 'x'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(equalsSpan)).toContain('pl-k');
        expect(getClasses(equalsSpan)).toContain('di-ae');
      });

      it('does not add di-ae to pl-k = outside a tag', () => {
        const equalsSpan = span('pl-k', '=');
        const tree = root([
          span('pl-smi', 'x'),
          textNode(' '),
          equalsSpan,
          textNode(' '),
          stringSpan('"', 'test'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(equalsSpan)).toEqual(['pl-k']);
      });

      it('adds di-ae to pl-k = when next sibling is an expression (pl-pse)', () => {
        // JSX: <Component onClick={handler}>
        const equalsSpan = span('pl-k', '=');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'Component'),
          textNode(' '),
          span('pl-e', 'onClick'),
          equalsSpan,
          span('pl-pse', '{'),
          span('pl-smi', 'handler'),
          span('pl-pse', '}'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(equalsSpan)).toContain('di-ae');
      });

      it('adds di-ae to bare text = when next sibling is an expression (pl-pse)', () => {
        // JSX: <div className={styles.root}>
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' className='),
          span('pl-pse', '{'),
          span('pl-smi', 'styles'),
          textNode('.root'),
          span('pl-pse', '}'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        const aeSpan = tree.children.find(
          (child) =>
            child.type === 'element' && (child.properties.className as string[]).includes('di-ae'),
        );
        expect(aeSpan).toBeDefined();
      });

      it('does not add di-av when next sibling is an expression', () => {
        // di-av should only apply to string literals (pl-s), not expressions
        const expressionSpan = span('pl-pse', '{');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          span('pl-e', 'onClick'),
          span('pl-k', '='),
          expressionSpan,
          span('pl-smi', 'handler'),
          span('pl-pse', '}'),
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(expressionSpan)).toEqual(['pl-pse']);
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

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(valueSpan)).toContain('di-av');
        expect(getClasses(valueSpan)).toContain('pl-s');
      });

      it('does not add di-av outside tag context', () => {
        const valueSpan = stringSpan('"', 'test');
        const tree = root([textNode('x='), valueSpan]);

        extendSyntaxTokens(tree, 'source.tsx');

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

        extendSyntaxTokens(tree, 'source.tsx');

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

        extendSyntaxTokens(tree, 'source.mdx');

        expect(getClasses(valueSpan)).toContain('di-av');
        expect(getClasses(valueSpan)).toContain('pl-s');
      });

      it('adds di-av when = is a pl-k span', () => {
        const valueSpan = stringSpan('"', 'x');
        const tree = root([
          textNode('<'),
          span('pl-ent', 'div'),
          textNode(' '),
          span('pl-e', 'className'),
          span('pl-k', '='),
          valueSpan,
          textNode('>'),
        ]);

        extendSyntaxTokens(tree, 'source.tsx');

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
      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(numSpan)).toEqual(['pl-c1', 'di-num']);
      expect(getClasses(boolSpan)).toEqual(['pl-c1', 'di-bool']);
    });
  });

  describe('empty tree', () => {
    it('handles empty root gracefully', () => {
      const tree = root([]);
      extendSyntaxTokens(tree, 'source.tsx');
      expect(tree.children).toEqual([]);
    });

    it('handles root with only text nodes', () => {
      const tree = root([textNode('plain text')]);
      extendSyntaxTokens(tree, 'source.tsx');
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

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(numSpan)).toEqual(['pl-c1', 'di-num']);
      expect(getClasses(boolSpan)).toEqual(['pl-c1', 'di-bool']);
      expect(getClasses(nullSpan)).toEqual(['pl-c1', 'di-n']);
      expect(getClasses(emptyString)).toEqual(['pl-s', 'di-n']);
      expect(getClasses(namedConst)).toEqual(['pl-c1']);
    });
  });

  describe('parameter enhancement (di-p)', () => {
    it('adds di-p to pl-smi spans', () => {
      const param = span('pl-smi', 'useState');
      const tree = root([param]);

      extendSyntaxTokens(tree, 'source.tsx');

      expect(getClasses(param)).toContain('pl-smi');
      expect(getClasses(param)).toContain('di-p');
    });

    it('works for JavaScript grammars', () => {
      const param = span('pl-smi', 'myVar');
      const tree = root([param]);

      extendSyntaxTokens(tree, 'source.js');

      expect(getClasses(param)).toContain('di-p');
    });

    it('does not add di-p for CSS grammars (avoids mislabeling units)', () => {
      const unit = span('pl-smi', 'rem');
      const tree = root([unit]);

      extendSyntaxTokens(tree, 'source.css');

      expect(getClasses(unit)).not.toContain('di-p');
    });
  });

  describe('CSS property/value enhancement', () => {
    describe('CSS property name (di-cp)', () => {
      it('adds di-cp to pl-c1 before colon inside declaration block', () => {
        // .x { color: red; }
        const propName = span('pl-c1', 'color');
        const tree = root([textNode('{ '), propName, textNode(': '), span('pl-c1', 'red')]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(propName)).toContain('di-cp');
        expect(getClasses(propName)).not.toContain('di-cv');
      });

      it('does not add di-cp for non-CSS grammars', () => {
        const propName = span('pl-c1', 'color');
        const tree = root([textNode('{ '), propName, textNode(': '), span('pl-c1', 'red')]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(propName)).not.toContain('di-cp');
      });

      it('resets after semicolon', () => {
        // { color: red; display: flex; }
        const prop1 = span('pl-c1', 'color');
        const val1 = span('pl-c1', 'red');
        const prop2 = span('pl-c1', 'display');
        const val2 = span('pl-c1', 'flex');
        const tree = root([
          textNode('{ '),
          prop1,
          textNode(': '),
          val1,
          textNode('; '),
          prop2,
          textNode(': '),
          val2,
        ]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(prop1)).toContain('di-cp');
        expect(getClasses(val1)).toContain('di-cv');
        expect(getClasses(prop2)).toContain('di-cp');
        expect(getClasses(val2)).toContain('di-cv');
      });

      it('resets after closing brace', () => {
        // } .x { display: ...
        const prop = span('pl-c1', 'display');
        const tree = root([textNode('} .x { '), prop, textNode(': ')]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(prop)).toContain('di-cp');
      });

      it('does not add di-cp to selector tokens outside declaration blocks', () => {
        // [data-active] { color: red }
        const selectorAttr = span('pl-c1', 'data-active');
        const propName = span('pl-c1', 'color');
        const tree = root([
          textNode('['),
          selectorAttr,
          textNode('] { '),
          propName,
          textNode(': '),
          span('pl-c1', 'red'),
          textNode(' }'),
        ]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(selectorAttr)).not.toContain('di-cp');
        expect(getClasses(selectorAttr)).not.toContain('di-cv');
        expect(getClasses(propName)).toContain('di-cp');
      });
    });

    describe('CSS property value (di-cv)', () => {
      it('adds di-cv to pl-c1 after colon inside declaration block', () => {
        const propValue = span('pl-c1', 'red');
        const tree = root([textNode('{ '), span('pl-c1', 'color'), textNode(': '), propValue]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(propValue)).toContain('di-cv');
        expect(getClasses(propValue)).not.toContain('di-cp');
      });

      it('adds di-cv to multiple values after colon', () => {
        // { transition: transform 150ms }
        const transitionProp = span('pl-c1', 'transition');
        const numValue = span('pl-c1', '150');
        const tree = root([
          textNode('{ '),
          transitionProp,
          textNode(':\n    transform '),
          numValue,
          span('pl-k', 'ms'),
        ]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(transitionProp)).toContain('di-cp');
        expect(getClasses(numValue)).toContain('di-cv');
        expect(getClasses(numValue)).toContain('di-num');
      });

      it('does not add di-cv for non-CSS grammars', () => {
        const propValue = span('pl-c1', 'red');
        const tree = root([textNode('{ '), span('pl-c1', 'color'), textNode(': '), propValue]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(propValue)).not.toContain('di-cv');
      });
    });

    describe('CSS custom property (di-cvar)', () => {
      it('adds di-cvar to pl-v spans', () => {
        // var(--my-color)
        const customProp = span('pl-v', '--my-color');
        const tree = root([span('pl-c1', 'var'), textNode('('), customProp, textNode(')')]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(customProp)).toContain('pl-v');
        expect(getClasses(customProp)).toContain('di-cvar');
      });

      it('adds di-cvar to custom property definitions', () => {
        // --my-color: #fff;
        const customProp = span('pl-v', '--my-color');
        const tree = root([customProp, textNode(': '), span('pl-c1', '#fff')]);

        extendSyntaxTokens(tree, 'source.css');

        expect(getClasses(customProp)).toContain('di-cvar');
      });

      it('does not add di-cvar for non-CSS grammars', () => {
        const customProp = span('pl-v', '--my-color');
        const tree = root([customProp]);

        extendSyntaxTokens(tree, 'source.tsx');

        expect(getClasses(customProp)).not.toContain('di-cvar');
      });
    });
  });
});
