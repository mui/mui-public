import { describe, it, expect, beforeAll } from 'vitest';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import transformHtmlCodeInlineHighlighted, {
  ensureStarryNightInitialized,
} from './transformHtmlCodeInlineHighlighted';

/**
 * Integration tests for transformHtmlCodeInlineHighlighted.
 * These tests cover real-world user scenarios where the plugin is used
 * to apply syntax highlighting to inline code elements in documentation.
 */
describe('transformHtmlCodeInlineHighlighted', () => {
  beforeAll(async () => {
    await ensureStarryNightInitialized();
  });

  /**
   * Helper function to process HTML string through the plugin.
   * Parses HTML → applies highlighting → serializes back to HTML.
   */
  async function processHtml(input: string): Promise<string> {
    const result = await unified()
      .use(rehypeParse, { fragment: true })
      .use(transformHtmlCodeInlineHighlighted)
      .use(rehypeStringify)
      .process(input);

    return String(result);
  }

  /**
   * Helper to extract text content from HTML string.
   * This does NOT decode HTML entities - it extracts exactly what's in the text nodes.
   */
  function getTextContent(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  describe('inline code highlighting in MDX documentation', () => {
    it('highlights TypeScript variable declarations', async () => {
      // Documenting a TypeScript constant with type annotation
      const input = '<code class="language-ts">const x: string = "hello"</code>';

      const output = await processHtml(input);

      expect(output).toContain('<span');
      expect(output).toContain('class=');
      expect(getTextContent(output)).toBe('const x: string = "hello"');
    });

    it('highlights JavaScript function expressions', async () => {
      // Showing a JavaScript example in API documentation
      const input = '<code class="language-js">function test() { return 42; }</code>';

      const output = await processHtml(input);

      expect(output).toContain('<span');
      expect(getTextContent(output)).toBe('function test() { return 42; }');
    });

    it('highlights JSX element syntax', async () => {
      // Demonstrating a React component usage inline
      const input = '<code class="language-tsx">&#x3C;Button onClick={handler} /></code>';

      const output = await processHtml(input);

      expect(output).toContain('<span');
      // Note: rehype-parse doesn't decode HTML entities in text content
      expect(getTextContent(output)).toBe('&#x3C;Button onClick={handler} />');
    });

    it('highlights JSON key-value pairs', async () => {
      // Documenting a configuration object
      const input = '<code class="language-json">{ "key": "value" }</code>';

      const output = await processHtml(input);

      expect(output).toContain('<span');
      expect(getTextContent(output)).toBe('{ "key": "value" }');
    });

    it('preserves plain text without language specification', async () => {
      // Using inline code for emphasis without syntax highlighting
      const input = '<code>plain text</code>';

      const output = await processHtml(input);

      expect(output).toBe('<code>plain text</code>');
      expect(output).not.toContain('<span');
    });

    it('preserves inline code with unsupported language', async () => {
      // Using a language that isn't in the grammar list
      const input = '<code class="language-python">print("hello")</code>';

      const output = await processHtml(input);

      expect(output).toBe('<code class="language-python">print("hello")</code>');
      expect(output).not.toContain('<span');
    });
  });

  describe('type expression highlighting with prefix', () => {
    it('highlights simple type unions for prop documentation', async () => {
      // Documenting a prop type that accepts multiple primitive values
      const input =
        '<code class="language-ts" data-highlighting-prefix="type _ = ">string | number</code>';

      const output = await processHtml(input);

      expect(getTextContent(output)).toBe('string | number');
      expect(getTextContent(output)).not.toContain('type _ =');
      expect(output).not.toContain('data-highlighting-prefix');
      expect(output).toContain('<span');
    });

    it('highlights complex object types with nested properties', async () => {
      // Documenting a component prop that accepts an object type
      const input =
        '<code class="language-ts" data-highlighting-prefix="type _ = ">{ foo: string; bar: number } | undefined</code>';

      const output = await processHtml(input);
      const textContent = getTextContent(output);

      expect(textContent).toContain('foo');
      expect(textContent).toContain('string');
      expect(textContent).toContain('bar');
      expect(textContent).toContain('number');
      expect(textContent).toContain('undefined');
      expect(textContent).not.toContain('type _ =');
      expect(output).toContain('<span');
      expect(output).not.toContain('data-highlighting-prefix');
    });

    it('highlights string literal types for specific values', async () => {
      // Showing a specific string value that a prop accepts
      const input =
        '<code class="language-ts" data-highlighting-prefix="const x = ">"hello"</code>';

      const output = await processHtml(input);

      expect(getTextContent(output)).toBe('"hello"');
      expect(getTextContent(output)).not.toContain('const x =');
      expect(output).toContain('<span');
      expect(output).not.toContain('data-highlighting-prefix');
    });

    it('highlights array types in return value documentation', async () => {
      // Documenting a function return type
      const input =
        '<code class="language-ts" data-highlighting-prefix="type _ = ">Array&#x3C;string></code>';

      const output = await processHtml(input);

      // HTML entities remain as-is in text content
      expect(getTextContent(output)).toBe('Array&#x3C;string>');
      expect(getTextContent(output)).not.toContain('type _ =');
      expect(output).toContain('<span');
    });

    it('highlights function types for callback props', async () => {
      // Documenting a callback prop signature
      const input =
        '<code class="language-ts" data-highlighting-prefix="type _ = ">(event: React.MouseEvent) => void</code>';

      const output = await processHtml(input);
      const textContent = getTextContent(output);

      expect(textContent).toContain('event');
      expect(textContent).toContain('React.MouseEvent');
      expect(textContent).toContain('void');
      expect(textContent).not.toContain('type _ =');
      expect(output).toContain('<span');
    });

    it('highlights intersection types for combined constraints', async () => {
      // Documenting a prop that combines multiple type constraints
      const input =
        '<code class="language-ts" data-highlighting-prefix="type _ = ">BaseProps &#x26; { variant: "primary" }</code>';

      const output = await processHtml(input);
      const textContent = getTextContent(output);

      expect(textContent).toContain('BaseProps');
      expect(textContent).toContain('variant');
      expect(textContent).toContain('"primary"');
      expect(textContent).not.toContain('type _ =');
      expect(output).toContain('<span');
    });

    it('works correctly when no prefix is provided', async () => {
      // Highlighting code that doesn't need a prefix
      const input = '<code class="language-ts">string | number</code>';

      const output = await processHtml(input);

      expect(getTextContent(output)).toBe('string | number');
      expect(output).toContain('<span');
    });
  });

  describe('edge cases and special characters', () => {
    it('handles code with HTML entities', async () => {
      // MDX often encodes special characters as HTML entities
      const input = '<code class="language-ts">value &#x3C; 10 &#x26;&#x26; value > 0</code>';

      const output = await processHtml(input);

      // HTML entities remain encoded in text content
      expect(getTextContent(output)).toBe('value &#x3C; 10 &#x26;&#x26; value > 0');
      expect(output).toContain('<span');
    });

    it('handles empty code elements', async () => {
      // Edge case: empty code tag
      const input = '<code class="language-ts"></code>';

      const output = await processHtml(input);

      // Should not crash, should return unchanged
      expect(output).toBe('<code class="language-ts"></code>');
    });

    it('handles code with only whitespace', async () => {
      // Edge case: code tag with only spaces
      const input = '<code class="language-ts">   </code>';

      const output = await processHtml(input);

      // Should preserve whitespace
      expect(getTextContent(output)).toBe('   ');
    });

    it('handles multi-line code snippets', async () => {
      // Some inline code might span multiple lines
      const input = '<code class="language-ts">{\n  foo: string;\n  bar: number;\n}</code>';

      const output = await processHtml(input);
      const textContent = getTextContent(output);

      expect(textContent).toContain('foo');
      expect(textContent).toContain('bar');
      expect(textContent).toContain('\n');
      expect(output).toContain('<span');
    });

    it('handles prefix removal with multi-byte characters', async () => {
      // Prefix with Unicode characters
      const input =
        '<code class="language-ts" data-highlighting-prefix="const 变量 = ">"value"</code>';

      const output = await processHtml(input);

      expect(getTextContent(output)).toBe('"value"');
      expect(getTextContent(output)).not.toContain('const');
      expect(getTextContent(output)).not.toContain('变量');
    });
  });
});
