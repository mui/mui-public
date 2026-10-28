// Strips TypeScript syntax (types, interfaces, enums, decorators, etc.) from
// source while preserving line numbers and JSX. Backed by `sucrase`, which is
// a single-pass, allocation-light alternative to `@babel/standalone`.
//
// Why sucrase
// -----------
// The previous `@babel/standalone` + `prettier/standalone` implementation
// pulled ~3 MB of parser/printer code into every Next.js worker and held
// large parser state across calls. In a production build with hundreds of
// demos that drove webpack workers past `--max-old-space-size` even at
// concurrency=1. Sucrase ships a focused TS/JSX stripper (~200 KB) that
// rewrites in place, so transform output reuses input layout and there is no
// AST cache to bleed memory across files.

import { transform } from 'sucrase';

/**
 * Strips TypeScript types and decorators from code (including JSX in TSX),
 * preserving line numbers so source maps and diff tooling stay aligned.
 *
 * @param code - The source code string to transform.
 * @param filename - The name of the file (e.g. "foo.ts" or "Foo.tsx").
 *                   Determines whether TSX/JSX parsing is enabled.
 * @returns The transformed code with TypeScript syntax removed.
 */
export async function removeTypes(code: string, filename = 'file.ts'): Promise<string> {
  const isTSX = /\.tsx$/i.test(filename);

  const result = transform(code, {
    filePath: filename,
    transforms: isTSX ? ['typescript', 'jsx'] : ['typescript'],
    jsxRuntime: 'preserve',
    preserveDynamicImport: true,
    disableESTransforms: true,
  });

  return result.code;
}
