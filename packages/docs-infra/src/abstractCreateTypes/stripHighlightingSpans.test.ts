import { describe, it, expect } from 'vitest';
import type { Root as HastRoot, Element as HastElement } from 'hast';
import { stripHighlightingSpans } from './stripHighlightingSpans';

describe('stripHighlightingSpans', () => {
  it('should return text-only trees unchanged', () => {
    const root: HastRoot = {
      type: 'root',
      children: [{ type: 'text', value: 'hello world' }],
    };
    expect(stripHighlightingSpans(root)).toEqual(root);
  });

  it('should unwrap span elements and keep their text content', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-k'] },
          children: [{ type: 'text', value: 'type' }],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([{ type: 'text', value: 'type' }]);
  });

  it('should unwrap nested spans', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['pl-k'] },
              children: [{ type: 'text', value: 'type' }],
            },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([{ type: 'text', value: 'type' }]);
  });

  it('should preserve link (a) elements', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: '#button-props' },
          children: [{ type: 'text', value: 'ButtonProps' }],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([
      {
        type: 'element',
        tagName: 'a',
        properties: { href: '#button-props' },
        children: [{ type: 'text', value: 'ButtonProps' }],
      },
    ]);
  });

  it('should unwrap spans inside links', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: '#props' },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['pl-smi'] },
              children: [{ type: 'text', value: 'Props' }],
            },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([
      {
        type: 'element',
        tagName: 'a',
        properties: { href: '#props' },
        children: [{ type: 'text', value: 'Props' }],
      },
    ]);
  });

  it('should preserve links that are wrapped in spans', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'a',
              properties: { href: '#ref' },
              children: [{ type: 'text', value: 'Ref' }],
            },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([
      {
        type: 'element',
        tagName: 'a',
        properties: { href: '#ref' },
        children: [{ type: 'text', value: 'Ref' }],
      },
    ]);
  });

  it('should preserve container elements like pre and code', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['pl-k'] },
                  children: [{ type: 'text', value: 'type' }],
                },
                { type: 'text', value: ' ' },
                {
                  type: 'element',
                  tagName: 'a',
                  properties: { href: '#my-type' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'span',
                      properties: { className: ['pl-smi'] },
                      children: [{ type: 'text', value: 'MyType' }],
                    },
                  ],
                },
                { type: 'text', value: ' = {}' },
              ],
            },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    const pre = result.children[0] as HastElement;
    expect(pre.tagName).toBe('pre');
    const code = pre.children[0] as HastElement;
    expect(code.tagName).toBe('code');
    expect(code.children).toEqual([
      { type: 'text', value: 'type ' },
      {
        type: 'element',
        tagName: 'a',
        properties: { href: '#my-type' },
        children: [{ type: 'text', value: 'MyType' }],
      },
      { type: 'text', value: ' = {}' },
    ]);
  });

  it('should handle spans with multiple children', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: {},
          children: [
            { type: 'text', value: 'hello' },
            { type: 'text', value: ' world' },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('should handle empty root', () => {
    const root: HastRoot = { type: 'root', children: [] };
    expect(stripHighlightingSpans(root)).toEqual({ type: 'root', children: [] });
  });

  it('should handle a realistic highlighted type signature with mixed content', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['frame'], dataFrameStartLine: 1, dataFrameEndLine: 3 },
                  children: [
                    {
                      type: 'element',
                      tagName: 'span',
                      properties: { className: ['line'], dataLn: 1 },
                      children: [
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
                          children: [{ type: 'text', value: 'Props' }],
                        },
                        { type: 'text', value: ' = {' },
                      ],
                    },
                    { type: 'text', value: '\n' },
                    {
                      type: 'element',
                      tagName: 'span',
                      properties: { className: ['line'], dataLn: 2 },
                      children: [
                        { type: 'text', value: '  ' },
                        {
                          type: 'element',
                          tagName: 'span',
                          properties: { className: ['pl-smi'] },
                          children: [{ type: 'text', value: 'disabled' }],
                        },
                        { type: 'text', value: ': ' },
                        {
                          type: 'element',
                          tagName: 'a',
                          properties: { href: '#boolean' },
                          children: [
                            {
                              type: 'element',
                              tagName: 'span',
                              properties: { className: ['pl-c1'] },
                              children: [{ type: 'text', value: 'boolean' }],
                            },
                          ],
                        },
                      ],
                    },
                    { type: 'text', value: '\n' },
                    {
                      type: 'element',
                      tagName: 'span',
                      properties: { className: ['line'], dataLn: 3 },
                      children: [
                        {
                          type: 'element',
                          tagName: 'span',
                          properties: { className: ['pl-k'] },
                          children: [{ type: 'text', value: '}' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = stripHighlightingSpans(root);
    const pre = result.children[0] as HastElement;
    const code = pre.children[0] as HastElement;

    // Frame preserved, line spans and highlighting spans stripped, text merged
    expect(code.children).toEqual([
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['frame'], dataFrameStartLine: 1, dataFrameEndLine: 3 },
        children: [
          { type: 'text', value: 'type Props = {\n  disabled: ' },
          {
            type: 'element',
            tagName: 'a',
            properties: { href: '#boolean' },
            children: [{ type: 'text', value: 'boolean' }],
          },
          { type: 'text', value: '\n}' },
        ],
      },
    ]);
  });

  it('should preserve frame spans with their data attributes', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: {
            className: ['frame'],
            dataFrameStartLine: 1,
            dataFrameEndLine: 5,
            dataFrameType: 'highlighted',
          },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['pl-k'] },
              children: [{ type: 'text', value: 'const' }],
            },
            { type: 'text', value: ' x = 1' },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    const frame = result.children[0] as HastElement;
    expect(frame.tagName).toBe('span');
    expect(frame.properties).toEqual({
      className: ['frame'],
      dataFrameStartLine: 1,
      dataFrameEndLine: 5,
      dataFrameType: 'highlighted',
    });
    expect(frame.children).toEqual([{ type: 'text', value: 'const x = 1' }]);
  });

  it('should preserve frame spans when className is a string (addLineGutters format)', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: {
            className: 'frame',
            dataFrameStartLine: 1,
            dataFrameEndLine: 3,
          },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['pl-en'] },
              children: [{ type: 'text', value: 'type' }],
            },
            { type: 'text', value: ' Foo = {}' },
          ],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    const frame = result.children[0] as HastElement;
    expect(frame.tagName).toBe('span');
    expect(frame.properties?.className).toBe('frame');
    expect(frame.properties?.dataFrameStartLine).toBe(1);
    expect(frame.children).toEqual([{ type: 'text', value: 'type Foo = {}' }]);
  });

  it('should strip line spans but preserve their content', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['line'], dataLn: 1 },
          children: [{ type: 'text', value: 'hello' }],
        },
      ],
    };
    const result = stripHighlightingSpans(root);
    expect(result.children).toEqual([{ type: 'text', value: 'hello' }]);
  });

  it('should not mutate the input tree', () => {
    const root: HastRoot = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['pl-k'] },
          children: [{ type: 'text', value: 'type' }],
        },
      ],
    };
    const originalJson = JSON.stringify(root);
    stripHighlightingSpans(root);
    expect(JSON.stringify(root)).toBe(originalJson);
  });
});
