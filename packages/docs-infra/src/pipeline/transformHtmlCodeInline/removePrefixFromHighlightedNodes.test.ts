import { describe, it, expect } from 'vitest';
import type { ElementContent, Text, Element } from 'hast';
import { removePrefixFromHighlightedNodes } from './removePrefixFromHighlightedNodes';

/**
 * Unit tests for removePrefixFromHighlightedNodes helper function.
 * Tests the internal prefix removal logic in isolation.
 */
describe('removePrefixFromHighlightedNodes', () => {
  describe('text node handling', () => {
    it('should remove prefix from single text node when prefix is shorter', () => {
      const children: ElementContent[] = [{ type: 'text', value: 'abcxyz' }];

      removePrefixFromHighlightedNodes(children, 3);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('xyz');
    });

    it('should remove entire text node when prefix equals node length', () => {
      const children: ElementContent[] = [{ type: 'text', value: 'abc' }];

      removePrefixFromHighlightedNodes(children, 3);

      expect(children).toHaveLength(0);
    });

    it('should remove multiple text nodes when prefix spans them', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'ab' },
        { type: 'text', value: 'cd' },
        { type: 'text', value: 'efxyz' },
      ];

      removePrefixFromHighlightedNodes(children, 6);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('xyz');
    });

    it('should handle empty string after removal', () => {
      const children: ElementContent[] = [{ type: 'text', value: 'abc' }];

      removePrefixFromHighlightedNodes(children, 3);

      expect(children).toHaveLength(0);
    });
  });

  describe('element node handling', () => {
    it('should remove prefix from text inside element', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'abcxyz' }],
        },
      ];

      removePrefixFromHighlightedNodes(children, 3);

      expect(children).toHaveLength(1);
      const element = children[0] as Element;
      expect(element.type).toBe('element');
      expect(element.children).toHaveLength(1);
      expect((element.children[0] as Text).value).toBe('xyz');
    });

    it('should remove entire element when its text node is fully consumed', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'abc' }],
        },
        { type: 'text', value: 'xyz' },
      ];

      removePrefixFromHighlightedNodes(children, 3);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('xyz');
    });

    it('should remove empty elements', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [],
        },
        { type: 'text', value: 'xyz' },
      ];

      removePrefixFromHighlightedNodes(children, 0);

      // Empty element should be removed when encountered
      expect(children).toHaveLength(2);
    });

    it('should handle prefix spanning multiple elements', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'ab' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'cd' }],
        },
        { type: 'text', value: 'xyz' },
      ];

      removePrefixFromHighlightedNodes(children, 4);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('xyz');
    });
  });

  describe('edge cases', () => {
    it('should handle zero-length prefix', () => {
      const children: ElementContent[] = [{ type: 'text', value: 'abc' }];

      removePrefixFromHighlightedNodes(children, 0);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('abc');
    });

    it('should handle prefix longer than all content', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'abc' },
        { type: 'text', value: 'def' },
      ];

      removePrefixFromHighlightedNodes(children, 10);

      // Should remove all content and stop
      expect(children).toHaveLength(0);
    });

    it('should handle empty children array', () => {
      const children: ElementContent[] = [];

      removePrefixFromHighlightedNodes(children, 5);

      expect(children).toHaveLength(0);
    });

    it('should stop at element with non-text first child', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'strong',
              properties: {},
              children: [{ type: 'text', value: 'abc' }],
            },
          ],
        },
        { type: 'text', value: 'xyz' },
      ];

      // Should stop when it encounters nested element as first child
      removePrefixFromHighlightedNodes(children, 5);

      // Cannot remove prefix from nested element structure, should leave as-is
      expect(children).toHaveLength(2);
    });

    it('should handle mixed content types', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'ab' },
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'cd' }],
        },
        { type: 'text', value: 'efxyz' },
      ];

      removePrefixFromHighlightedNodes(children, 6);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('xyz');
    });
  });

  describe('partial removal within nodes', () => {
    it('should partially remove from text node', () => {
      const children: ElementContent[] = [{ type: 'text', value: 'abcdef' }];

      removePrefixFromHighlightedNodes(children, 2);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('cdef');
    });

    it('should partially remove from text inside element', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'abcdef' }],
        },
      ];

      removePrefixFromHighlightedNodes(children, 2);

      expect(children).toHaveLength(1);
      const element = children[0] as Element;
      expect((element.children[0] as Text).value).toBe('cdef');
    });

    it('should handle removal across node boundary', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'abc' },
        { type: 'text', value: 'defghi' },
      ];

      removePrefixFromHighlightedNodes(children, 5);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('fghi');
    });
  });

  describe('complex scenarios', () => {
    it('should handle partial removal from multiple elements', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-k'] },
          children: [{ type: 'text', value: 'type' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: '_' }],
        },
        { type: 'text', value: ' = string' },
      ];

      // Remove "type _ = " (9 characters)
      removePrefixFromHighlightedNodes(children, 9);

      // Should only have "string" left
      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('string');
    });

    it('should handle element with multiple children where only first is removed', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [
            { type: 'text', value: 'ab' },
            { type: 'text', value: 'cd' },
            { type: 'text', value: 'ef' },
          ],
        },
        { type: 'text', value: 'xyz' },
      ];

      // Remove only 2 characters (the first text child)
      removePrefixFromHighlightedNodes(children, 2);

      // Element should remain with 2 children
      expect(children).toHaveLength(2);
      const element = children[0] as Element;
      expect(element.children).toHaveLength(2);
      expect((element.children[0] as Text).value).toBe('cd');
      expect((element.children[1] as Text).value).toBe('ef');
    });

    it('should handle element with multiple children where some are removed', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [
            { type: 'text', value: 'ab' },
            { type: 'text', value: 'cd' },
            { type: 'text', value: 'efgh' },
          ],
        },
      ];

      // Remove 5 characters: 'ab' (2) + 'cd' (2) + 'e' (1)
      removePrefixFromHighlightedNodes(children, 5);

      expect(children).toHaveLength(1);
      const element = children[0] as Element;
      expect(element.children).toHaveLength(1);
      expect((element.children[0] as Text).value).toBe('fgh');
    });

    it('should handle real-world TypeScript syntax highlighting structure', () => {
      // Simulates actual output from starry-night for "type _ = string | number"
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-k'] },
          children: [{ type: 'text', value: 'type' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-smi'] },
          children: [{ type: 'text', value: '_' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-k'] },
          children: [{ type: 'text', value: '=' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: 'string' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-k'] },
          children: [{ type: 'text', value: '|' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-c1'] },
          children: [{ type: 'text', value: 'number' }],
        },
      ];

      // Remove "type _ = " (9 characters including spaces)
      removePrefixFromHighlightedNodes(children, 9);

      // Should have: "string | number"
      expect(children.length).toBeGreaterThan(0);

      // Helper to get all text
      const getText = (nodes: ElementContent[]): string => {
        return nodes
          .map((node) => {
            if (node.type === 'text') {
              return node.value;
            }
            if (node.type === 'element') {
              return getText(node.children);
            }
            return '';
          })
          .join('');
      };

      expect(getText(children)).toBe('string | number');
    });

    it('should maintain element structure when removing prefix', () => {
      const children: ElementContent[] = [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['keyword'] },
          children: [{ type: 'text', value: 'const' }],
        },
        { type: 'text', value: ' ' },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['variable'] },
          children: [{ type: 'text', value: 'x' }],
        },
        { type: 'text', value: ' = 42' },
      ];

      // Remove "const " (6 characters)
      removePrefixFromHighlightedNodes(children, 6);

      // Should preserve the span around 'x'
      expect(children).toHaveLength(2);
      expect(children[0].type).toBe('element');
      const element = children[0] as Element;
      expect(element.properties?.className).toEqual(['variable']);
      expect((element.children[0] as Text).value).toBe('x');
      expect((children[1] as Text).value).toBe(' = 42');
    });
  });

  describe('boundary and invalid inputs', () => {
    it('should handle negative prefix length gracefully', () => {
      const children: ElementContent[] = [{ type: 'text', value: 'abc' }];

      removePrefixFromHighlightedNodes(children, -5);

      // Negative length should be treated as 0 (condition never met)
      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('abc');
    });

    it('should handle very large prefix length', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'a'.repeat(1000) },
        { type: 'text', value: 'b'.repeat(1000) },
      ];

      removePrefixFromHighlightedNodes(children, 1500);

      // Should remove first node entirely and part of second
      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('b'.repeat(500));
    });

    it('should handle unknown node types gracefully', () => {
      const children: ElementContent[] = [
        { type: 'comment' as any, value: 'comment' } as any,
        { type: 'text', value: 'xyz' },
      ];

      removePrefixFromHighlightedNodes(children, 5);

      // Should stop at unknown type and not crash
      expect(children).toHaveLength(2);
      expect(children[0].type).toBe('comment');
    });

    it('should handle single character text nodes', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'a' },
        { type: 'text', value: 'b' },
        { type: 'text', value: 'c' },
        { type: 'text', value: 'd' },
        { type: 'text', value: 'efg' },
      ];

      removePrefixFromHighlightedNodes(children, 4);

      expect(children).toHaveLength(1);
      expect((children[0] as Text).value).toBe('efg');
    });

    it('should handle prefix exactly matching total content length', () => {
      const children: ElementContent[] = [
        { type: 'text', value: 'abc' },
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [{ type: 'text', value: 'def' }],
        },
      ];

      removePrefixFromHighlightedNodes(children, 6);

      expect(children).toHaveLength(0);
    });
  });
});
