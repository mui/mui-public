import type { Element } from 'hast';
import { describe, it, expect } from 'vitest';
import { extractTypeProps } from './extractTypeProps';
import { getHastTextContent } from './hastTypeUtils';
import { formatDetailedTypeAsHast } from './typeHighlighting';

/**
 * Finds all comment frames (span.frame[data-frame-type="comment"]) in the code element's children.
 */
function findCommentFrames(code: Element): Element[] {
  return code.children.filter(
    (child): child is Element =>
      child.type === 'element' && child.properties?.dataFrameType === 'comment',
  );
}

/**
 * Finds all non-comment frames in the code element's children.
 */
function findNormalFrames(code: Element): Element[] {
  return code.children.filter(
    (child): child is Element =>
      child.type === 'element' && child.properties?.dataFrameType !== 'comment',
  );
}

/**
 * Gets the code element from a HAST root (root > pre > code).
 */
function getCodeElement(hast: {
  children: Array<{ type: string; children?: unknown[] }>;
}): Element {
  const pre = hast.children[0] as Element;
  return pre.children[0] as Element;
}

/**
 * Helper: highlights a type declaration string into HAST,
 * then runs extractTypeProps on it.
 */
async function extract(code: string) {
  const hast = await formatDetailedTypeAsHast(code);
  return extractTypeProps(hast);
}

describe('extractTypeProps', () => {
  describe('single-line JSDoc comments', () => {
    it('should extract a single-line comment from a property', async () => {
      const code = `{
  /** Display text */
  label: string;
}`;

      const result = await extract(code);

      expect(result.properties).toEqual({
        label: {
          description: 'Display text',
          typeText: 'string',
          optional: false,
        },
      });
      // Comment text should be inside comment frames, not removed
      const text = getHastTextContent(result.hast);
      expect(text).toContain('Display text');
      expect(text).toContain('label');

      // Verify comment frames exist at code.children level
      const codeEl = getCodeElement(result.hast);
      const commentFrames = findCommentFrames(codeEl);
      expect(commentFrames.length).toBeGreaterThan(0);
    });

    it('should extract multiple single-line comments', async () => {
      const code = `{
  /** Display text */
  label: string;
  /** Prevents interaction */
  disabled?: boolean;
}`;

      const result = await extract(code);

      expect(result.properties).toEqual({
        label: {
          description: 'Display text',
          typeText: 'string',
          optional: false,
        },
        disabled: {
          description: 'Prevents interaction',
          typeText: 'boolean',
          optional: true,
        },
      });
    });
  });

  describe('multi-line JSDoc comments', () => {
    it('should extract a multi-line comment', async () => {
      const code = `{
  /**
   * The rendering mode
   * for the component
   */
  mode: string;
}`;

      const result = await extract(code);

      expect(result.properties.mode).toEqual({
        description: 'The rendering mode\nfor the component',
        typeText: 'string',
        optional: false,
      });
    });
  });

  describe('JSDoc tags', () => {
    it('should extract @default tag', async () => {
      const code = `{
  /**
   * Request timeout in milliseconds
   * @default 3000
   */
  timeout?: number;
}`;

      const result = await extract(code);

      expect(result.properties.timeout).toEqual({
        description: 'Request timeout in milliseconds',
        typeText: 'number',
        optional: true,
        defaultValue: '3000',
      });
    });

    it('should extract @deprecated tag', async () => {
      const code = `{
  /**
   * The rendering mode
   * @deprecated Use renderMode instead
   */
  mode: string;
}`;

      const result = await extract(code);

      expect(result.properties.mode).toEqual({
        description: 'The rendering mode',
        typeText: 'string',
        optional: false,
        deprecated: 'Use renderMode instead',
      });
    });

    it('should extract @see tags', async () => {
      const code = `{
  /**
   * The rendering mode
   * @see https://example.com/modes
   */
  mode: string;
}`;

      const result = await extract(code);

      expect(result.properties.mode).toEqual({
        description: 'The rendering mode',
        typeText: 'string',
        optional: false,
        see: ['https://example.com/modes'],
      });
    });

    it('should extract @example tag with multi-line code', async () => {
      const code = `{
  /**
   * Template function
   * @example
   * template: (a, b) =>
   *   renderHtml(a, b)
   */
  template?: (a: string, b: string) => string;
}`;

      const result = await extract(code);

      expect(result.properties.template?.example).toBe('template: (a, b) =>\n  renderHtml(a, b)');
    });

    it('should extract multiple tags from one comment', async () => {
      const code = `{
  /**
   * The rendering mode
   * @see https://example.com/modes
   * @deprecated Use renderMode instead
   */
  mode: string;
}`;

      const result = await extract(code);

      expect(result.properties.mode).toEqual({
        description: 'The rendering mode',
        typeText: 'string',
        optional: false,
        see: ['https://example.com/modes'],
        deprecated: 'Use renderMode instead',
      });
    });
  });

  describe('deep extraction (nested objects)', () => {
    it('should extract comments from nested object properties', async () => {
      const code = `{
  /** Visual configuration */
  appearance: {
    /** Color scheme name */
    theme: string;
  };
}`;

      const result = await extract(code);

      expect(result.properties.appearance).toBeDefined();
      expect(result.properties.appearance.description).toBe('Visual configuration');
      expect(result.properties['appearance.theme']).toBeDefined();
      expect(result.properties['appearance.theme'].description).toBe('Color scheme name');
      expect(result.properties['appearance.theme'].typeText).toBe('string');
    });

    it('should handle multiple levels of nesting', async () => {
      const code = `{
  /** Top level */
  outer: {
    /** Middle level */
    middle: {
      /** Deep level */
      inner: boolean;
    };
  };
}`;

      const result = await extract(code);

      expect(result.properties.outer).toBeDefined();
      expect(result.properties['outer.middle']).toBeDefined();
      expect(result.properties['outer.middle.inner']).toEqual({
        description: 'Deep level',
        typeText: 'boolean',
        optional: false,
      });
    });

    it('should handle siblings at same depth', async () => {
      const code = `{
  /** Group A */
  groupA: {
    /** Item A1 */
    a1: string;
    /** Item A2 */
    a2: number;
  };
  /** Group B */
  groupB: {
    /** Item B1 */
    b1: boolean;
  };
}`;

      const result = await extract(code);

      expect(result.properties['groupA.a1']?.description).toBe('Item A1');
      expect(result.properties['groupA.a2']?.description).toBe('Item A2');
      expect(result.properties['groupB.b1']?.description).toBe('Item B1');
      // Should NOT have cross-contaminated paths
      expect(result.properties['groupA.b1']).toBeUndefined();
    });
  });

  describe('comment frame splitting', () => {
    it('should split into alternating comment and non-comment frames', async () => {
      const code = `{
  /** Display text */
  label: string;
  /** Prevents interaction */
  disabled?: boolean;
}`;

      const result = await extract(code);

      const codeEl = getCodeElement(result.hast);
      const commentFrames = findCommentFrames(codeEl);
      const normalFrames = findNormalFrames(codeEl);
      expect(commentFrames).toHaveLength(2);
      expect(normalFrames.length).toBeGreaterThanOrEqual(2);
      expect(getHastTextContent(commentFrames[0])).toContain('Display text');
      expect(getHastTextContent(commentFrames[1])).toContain('Prevents interaction');

      // All frames should have frame properties
      for (const frame of [...commentFrames, ...normalFrames]) {
        expect(frame.properties?.className).toBe('frame');
        expect(frame.properties?.dataFrameStartLine).toBeDefined();
        expect(frame.properties?.dataFrameEndLine).toBeDefined();
      }
    });

    it('should put multi-line JSDoc comments in a single comment frame', async () => {
      const code = `{
  /**
   * The rendering mode
   * @deprecated Use renderMode instead
   */
  mode: string;
}`;

      const result = await extract(code);

      const codeEl = getCodeElement(result.hast);
      const commentFrames = findCommentFrames(codeEl);
      expect(commentFrames).toHaveLength(1);
      const commentText = getHastTextContent(commentFrames[0]);
      expect(commentText).toContain('rendering mode');
      expect(commentText).toContain('deprecated');
    });

    it('should not split when there are no comments', async () => {
      const code = `{
  label: string;
  disabled?: boolean;
}`;

      const result = await extract(code);

      const codeEl = getCodeElement(result.hast);
      // Should remain a single frame (no splitting needed)
      expect(codeEl.children).toHaveLength(1);
      expect(findCommentFrames(codeEl)).toHaveLength(0);
    });

    it('should preserve total text content after splitting', async () => {
      const code = `{
  /** Has comment */
  label: string;
  noComment: number;
  /** Also has comment */
  disabled?: boolean;
}`;

      const result = await extract(code);

      const text = getHastTextContent(result.hast);
      expect(text).toContain('Has comment');
      expect(text).toContain('label');
      expect(text).toContain('noComment');
      expect(text).toContain('Also has comment');
      expect(text).toContain('disabled');
    });
  });

  describe('edge cases', () => {
    it('should handle code with no comments', async () => {
      const code = `{
  label: string;
  disabled?: boolean;
}`;

      const result = await extract(code);

      expect(result.properties).toEqual({
        label: { typeText: 'string', optional: false },
        disabled: { typeText: 'boolean', optional: true },
      });
    });

    it('should handle properties without comments between commented ones', async () => {
      const code = `{
  /** Has comment */
  label: string;
  noComment: number;
  /** Also has comment */
  disabled?: boolean;
}`;

      const result = await extract(code);

      expect(Object.keys(result.properties)).toEqual(['label', 'noComment', 'disabled']);
      expect(result.properties.label.description).toBe('Has comment');
      expect(result.properties.noComment.description).toBeUndefined();
      expect(result.properties.noComment.typeText).toBe('number');
      expect(result.properties.disabled.description).toBe('Also has comment');
    });

    it('should handle complex type expressions', async () => {
      const code = `{
  /** Event handler */
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}`;

      const result = await extract(code);

      expect(result.properties.onChange).toBeDefined();
      expect(result.properties.onChange.description).toBe('Event handler');
      expect(result.properties.onChange.optional).toBe(true);
    });

    it('should handle union types', async () => {
      const code = `{
  /** Size variant */
  size?: "small" | "medium" | "large";
}`;

      const result = await extract(code);

      expect(result.properties.size).toBeDefined();
      expect(result.properties.size.description).toBe('Size variant');
      expect(result.properties.size.optional).toBe(true);
    });

    it('should handle nested objects without comments on parent', async () => {
      const code = `{
  appearance: {
    /** Color scheme name */
    theme: string;
  };
}`;

      const result = await extract(code);

      expect(result.properties.appearance).toBeDefined();
      expect(result.properties.appearance.description).toBeUndefined();
      expect(result.properties['appearance.theme']).toBeDefined();
      expect(result.properties['appearance.theme'].description).toBe('Color scheme name');
    });

    it('should handle non-object types', async () => {
      const code = `"horizontal" | "vertical"`;

      const result = await extract(code);

      expect(result.properties).toEqual({});
    });

    it('should handle inline object types in union branches', async () => {
      const code = `(
  | { reason: 'trigger-press'; event: MouseEvent | KeyboardEvent }
  | { reason: 'none'; event: Event }
) & {
  cancel: () => void;
}`;

      const result = await extract(code);

      expect(result.properties.reason).toBeDefined();
      expect(result.properties.reason.typeText).toBe("'trigger-press' | 'none'");
      expect(result.properties.event).toBeDefined();
      expect(result.properties.event.typeText).toBe('MouseEvent | KeyboardEvent | Event');
      expect(result.properties.cancel).toBeDefined();
      expect(result.properties.cancel.typeText).toBe('() => void');
    });

    it('should handle union branches with JSDoc on intersection properties', async () => {
      const code = `(
  | { reason: 'trigger-press' }
  | { reason: 'none' }
) & {
  /** Cancels the event */
  cancel: () => void;
}`;

      const result = await extract(code);

      expect(result.properties.reason).toBeDefined();
      expect(result.properties.reason.typeText).toBe("'trigger-press' | 'none'");
      expect(result.properties.cancel).toBeDefined();
      expect(result.properties.cancel.description).toBe('Cancels the event');
    });

    it('should handle pure union of objects', async () => {
      const code = `
  | { reason: 'trigger-press'; event: MouseEvent }
  | { reason: 'none'; event: Event }`;

      const result = await extract(code);

      expect(result.properties.reason).toBeDefined();
      expect(result.properties.reason.typeText).toBe("'trigger-press' | 'none'");
      expect(result.properties.event).toBeDefined();
      expect(result.properties.event.typeText).toBe('MouseEvent | Event');
    });

    it('should handle pure intersection of objects', async () => {
      const code = `{ active: boolean } & { label: string }`;

      const result = await extract(code);

      expect(result.properties.active).toBeDefined();
      expect(result.properties.active.typeText).toBe('boolean');
      expect(result.properties.label).toBeDefined();
      expect(result.properties.label.typeText).toBe('string');
    });

    it('should handle multi-line intersection of objects', async () => {
      const code = `{ active: boolean } & {
  label: string;
}`;

      const result = await extract(code);

      expect(result.properties.active).toBeDefined();
      expect(result.properties.active.typeText).toBe('boolean');
      expect(result.properties.label).toBeDefined();
      expect(result.properties.label.typeText).toBe('string');
    });

    it('should deduplicate identical types when merging union branches', async () => {
      const code = `(
  | { event: MouseEvent }
  | { event: MouseEvent }
)`;

      const result = await extract(code);

      expect(result.properties.event).toBeDefined();
      expect(result.properties.event.typeText).toBe('MouseEvent');
    });

    it('should deduplicate overlapping type members across branches', async () => {
      const code = `(
  | { event: MouseEvent | KeyboardEvent }
  | { event: KeyboardEvent | TouchEvent }
)`;

      const result = await extract(code);

      expect(result.properties.event).toBeDefined();
      expect(result.properties.event.typeText).toBe('MouseEvent | KeyboardEvent | TouchEvent');
    });

    it('should not corrupt types containing | inside parentheses or generics', async () => {
      const code = `(
  | { handler: (a: string | number) => void }
  | { handler: (a: boolean | null) => void }
)`;

      const result = await extract(code);

      expect(result.properties.handler).toBeDefined();
      expect(result.properties.handler.typeText).toBe(
        '(a: string | number) => void | (a: boolean | null) => void',
      );
    });

    it('should not corrupt types containing | inside tuple brackets', async () => {
      const code = `(
  | { value: [string | number, boolean | null] }
  | { value: [Date | RegExp] }
)`;

      const result = await extract(code);

      expect(result.properties.value).toBeDefined();
      expect(result.properties.value.typeText).toBe(
        '[string | number, boolean | null] | [Date | RegExp]',
      );
    });

    it('should correctly split and dedup function-type unions with arrows', async () => {
      const code = `(
  | { onChange: (value: string) => void }
  | { onChange: (value: number) => void }
  | { onChange: (value: string) => void }
)`;

      const result = await extract(code);

      expect(result.properties.onChange).toBeDefined();
      // Third branch duplicates the first — should be deduped
      expect(result.properties.onChange.typeText).toBe(
        '(value: string) => void | (value: number) => void',
      );
    });

    it('should not corrupt types containing | inside string literals', async () => {
      const code = `(
  | { label: 'small | medium' }
  | { label: 'large | xlarge' }
)`;

      const result = await extract(code);

      expect(result.properties.label).toBeDefined();
      expect(result.properties.label.typeText).toBe("'small | medium' | 'large | xlarge'");
    });

    it('should not incorrectly dedup branches sharing inner-union fragments', async () => {
      const code = `(
  | { handler: (value: string | number) => void }
  | { handler: (value: string | boolean) => void }
)`;

      const result = await extract(code);

      expect(result.properties.handler).toBeDefined();
      // Both branches share "(value: string" prefix but are distinct types
      expect(result.properties.handler.typeText).toBe(
        '(value: string | number) => void | (value: string | boolean) => void',
      );
    });

    it('should not split inner unions inside object-literal subtypes', async () => {
      const code = `(
  | { style: { a: string | number } }
  | { style: { a: boolean } }
)`;

      const result = await extract(code);

      expect(result.properties.style).toBeDefined();
      // The inner `|` inside `{ a: string | number }` must not be treated as a top-level separator
      expect(result.properties.style.typeText).toBe('{ a: string | number } | { a: boolean }');
    });

    it('should not split template-literal types with embedded pipes', async () => {
      // Template-literal types are rendered as pl-s spans by Starry Night,
      // so inner pipes appear inside quoted strings in the extracted type text.
      // This verifies that embedded pipes inside string-typed branches
      // are not mistakenly split during merge/dedup.
      const code = `(
  | { label: 'hello | world' }
  | { label: \`template | literal\` }
)`;

      const result = await extract(code);

      expect(result.properties.label).toBeDefined();
      // Both branches contain inner `|` — neither should be split
      expect(result.properties.label.typeText).toBe("'hello | world' | 'template | literal'");
    });

    it('should handle single-quoted property keys', async () => {
      const code = `{
  /** Accessible label */
  'aria-label'?: string;
}`;

      const result = await extract(code);

      expect(result.properties['aria-label']).toBeDefined();
      expect(result.properties['aria-label'].description).toBe('Accessible label');
      expect(result.properties['aria-label'].optional).toBe(true);
    });

    it('should handle double-quoted property keys', async () => {
      const code = `{
  /** Test identifier */
  "data-testid"?: string;
}`;

      const result = await extract(code);

      expect(result.properties['data-testid']).toBeDefined();
      expect(result.properties['data-testid'].description).toBe('Test identifier');
      expect(result.properties['data-testid'].optional).toBe(true);
    });
  });
});
