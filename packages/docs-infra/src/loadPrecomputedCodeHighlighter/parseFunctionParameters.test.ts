import { describe, it, expect } from 'vitest';
import { parseFunctionParameters } from './parseFunctionParameters';

describe('parseFunctionParameters', () => {
  it('should split simple comma-separated values', () => {
    const input = 'a, b, c';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['a', 'b', 'c']);
    expect(result.objects).toEqual([null, null, null]);
  });

  it('should handle nested objects with commas and extract them', () => {
    const input = 'a, { x: 1, y: 2 }, c';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['a', '{ x: 1, y: 2 }', 'c']);
    expect(result.objects).toEqual([null, '{ x: 1, y: 2 }', null]);
  });

  it('should handle nested parentheses', () => {
    const input = 'func(a, b), other, func2(x, y)';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['func(a, b)', 'other', 'func2(x, y)']);
    expect(result.objects).toEqual([null, null, null]);
  });

  it('should handle strings with commas', () => {
    const input = '"hello, world", other, \'test, string\'';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['"hello, world"', 'other', "'test, string'"]);
    expect(result.objects).toEqual([null, null, null]);
  });

  it('should handle single-line comments', () => {
    const input = 'a, // comment with, comma\nb, c';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['a', '// comment with, comma\nb', 'c']);
    expect(result.objects).toEqual([null, null, null]);
  });

  it('should handle multi-line comments', () => {
    const input = 'a, /* comment with, comma */ b, c';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['a', '/* comment with, comma */ b', 'c']);
    expect(result.objects).toEqual([null, null, null]);
  });

  it('should handle template literals', () => {
    const input = '`template, with comma`, other, `another, template`';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['`template, with comma`', 'other', '`another, template`']);
    expect(result.objects).toEqual([null, null, null]);
  });

  it('should handle complex nested structures and extract objects', () => {
    const input =
      'import.meta.url, { Component1, Component2: AliasName }, { name: "Test, Demo", slug: "test" }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual([
      'import.meta.url',
      '{ Component1, Component2: AliasName }',
      '{ name: "Test, Demo", slug: "test" }',
    ]);
    expect(result.objects).toEqual([
      null,
      '{ Component1, Component2: AliasName }',
      '{ name: "Test, Demo", slug: "test" }',
    ]);
  });

  it('should handle empty input', () => {
    const input = '';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual([]);
    expect(result.objects).toEqual([]);
  });

  it('should handle single parameter', () => {
    const input = 'singleParam';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['singleParam']);
    expect(result.objects).toEqual([null]);
  });

  it('should handle escaped quotes in strings', () => {
    const input = '"string with \\"escaped\\" quotes", other';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['"string with \\"escaped\\" quotes"', 'other']);
    expect(result.objects).toEqual([null, null]);
  });

  it('should extract object with leading whitespace', () => {
    const input = 'url,    { name: "test" }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', '{ name: "test" }']);
    expect(result.objects).toEqual([null, '{ name: "test" }']);
  });

  it('should handle nested objects', () => {
    const input = 'url, { outer: { inner: "value" }, other: true }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', '{ outer: { inner: "value" }, other: true }']);
    expect(result.objects).toEqual([null, '{ outer: { inner: "value" }, other: true }']);
  });

  it('should skip leading comments in object extraction', () => {
    const input = 'url, // comment\n{ name: "test" }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', '// comment\n{ name: "test" }']);
    expect(result.objects).toEqual([null, '{ name: "test" }']);
  });

  it('should handle multi-line comments in object extraction', () => {
    const input = 'url, /* comment */ { name: "test" }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', '/* comment */ { name: "test" }']);
    expect(result.objects).toEqual([null, '{ name: "test" }']);
  });

  it('should return null for non-object input', () => {
    const input = 'url, not an object';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', 'not an object']);
    expect(result.objects).toEqual([null, null]);
  });

  it('should handle deeply nested objects', () => {
    const input = 'url, { a: { b: { c: { d: "deep" } } } }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', '{ a: { b: { c: { d: "deep" } } } }']);
    expect(result.objects).toEqual([null, '{ a: { b: { c: { d: "deep" } } } }']);
  });

  it('should skip mixed whitespace and comments in object extraction', () => {
    const input = 'url, \n\t// comment\n /* block */ \t { name: "test" }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual(['url', '// comment\n /* block */ \t { name: "test" }']);
    expect(result.objects).toEqual([null, '{ name: "test" }']);
  });

  // Test case specific to createFactory calls
  it('should handle typical createFactory call parameters', () => {
    const input = 'import.meta.url, { Default: BasicDemo, WithProps }, { name: "My Demo" }';
    const result = parseFunctionParameters(input);
    expect(result.parts).toEqual([
      'import.meta.url',
      '{ Default: BasicDemo, WithProps }',
      '{ name: "My Demo" }',
    ]);
    expect(result.objects).toEqual([
      null,
      '{ Default: BasicDemo, WithProps }',
      '{ name: "My Demo" }',
    ]);
  });
});
