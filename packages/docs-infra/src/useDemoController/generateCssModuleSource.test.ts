import { describe, it, expect } from 'vitest';
import { generateCssModuleSource } from './generateCssModuleSource';
import { importCode } from './importCode';

describe('generateCssModuleSource', () => {
  it('emits a named export and a default object for an identifier-safe class', () => {
    expect(generateCssModuleSource({ button: 'button-x7f2a' })).toBe(
      "export const button = 'button-x7f2a';\nexport default { 'button': 'button-x7f2a' };\n",
    );
  });

  it('skips the named export for hyphenated names but keeps them in the default object', () => {
    const source = generateCssModuleSource({ 'my-button': 'my-button-x7f2a' });
    expect(source).not.toContain('export const');
    expect(source).toContain("'my-button': 'my-button-x7f2a'");
  });

  it('skips the named export for reserved words but keeps them in the default object', () => {
    const source = generateCssModuleSource({ default: 'default-x7f2a' });
    expect(source).not.toContain('export const default');
    expect(source).toContain("'default': 'default-x7f2a'");
  });

  it('emits an empty default object for empty exports', () => {
    expect(generateCssModuleSource({})).toBe('export default {};\n');
  });

  it('escapes quotes and backslashes in values', () => {
    const source = generateCssModuleSource({ tricky: "a'b\\c" });
    expect(source).toContain("\\'");
    expect(source).toContain('\\\\');
  });

  it('produces source that the runner can import (default = the class map)', () => {
    const exports = generateCssModuleSource({ button: 'button-x7f2a', 'my-button': 'mb-x7f2a' });
    const moduleExports = importCode(exports);
    // Named import resolves to the scoped name.
    expect(moduleExports.button).toBe('button-x7f2a');
    // Default import resolves to the full class map.
    expect(moduleExports.default).toEqual({ button: 'button-x7f2a', 'my-button': 'mb-x7f2a' });
  });
});
