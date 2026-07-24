import ts from 'typescript';
import { parseFromProgram } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';

const ROOT = '/virtual';

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  rootDir: ROOT,
  noLib: true,
};

/**
 * Parses TypeScript sources the way the pipeline does, without touching the filesystem.
 *
 * Tests that assert on parsed exports should start from source rather than hand-built
 * nodes, so they stay honest about what `typescript-api-extractor` actually emits.
 *
 * Sources are keyed by file name (e.g. `ComponentRootDataAttributes.ts`) and may import
 * each other by relative path. The first entry is the entrypoint.
 */
export function parseSources(sources: Record<string, string>): tae.ExportNode[] {
  const sourceFiles = new Map<string, ts.SourceFile>();

  for (const [name, text] of Object.entries(sources)) {
    const filePath = `${ROOT}/${name}`;
    sourceFiles.set(filePath, ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true));
  }

  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => sourceFiles.get(fileName),
    getDefaultLibFileName: () => `${ROOT}/lib.d.ts`,
    writeFile: () => {},
    getCurrentDirectory: () => ROOT,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => sourceFiles.has(fileName),
    readFile: (fileName) => sourceFiles.get(fileName)?.text,
  };

  const fileNames = Array.from(sourceFiles.keys());
  const program = ts.createProgram(fileNames, COMPILER_OPTIONS, host);

  return parseFromProgram(fileNames[0], program, { includeExternalTypes: false }).exports;
}
