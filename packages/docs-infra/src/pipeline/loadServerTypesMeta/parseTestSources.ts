import ts from 'typescript';
import { parseFromProgram } from 'typescript-api-extractor';
import type * as tae from 'typescript-api-extractor';

const ROOT = '/virtual';
const LIB_PATH = `${ROOT}/lib.d.ts`;

export interface ParseTestSourcesOptions {
  /**
   * Declarations placed in the virtual default library. Types declared here are external
   * to the parsed sources, which is what makes the parser preserve constructs such as
   * `keyof` rather than expanding them away — a locally declared operand is expanded.
   * Omit to parse without a standard library at all.
   */
  lib?: string;
  /** Extraction policy forwarded to the parser. */
  parserOptions?: tae.ParserOptions;
}

/**
 * Parses TypeScript sources the way the pipeline does, without touching the filesystem.
 *
 * Tests that assert on parsed exports should start from source rather than hand-built
 * nodes, so they stay honest about what `typescript-api-extractor` actually emits.
 *
 * Sources are keyed by file name (e.g. `ComponentRootDataAttributes.ts`) and may import
 * each other by relative path. The first entry is the entrypoint.
 */
export function parseTestSources(
  sources: Record<string, string>,
  options: ParseTestSourcesOptions = {},
): tae.ExportNode[] {
  const { lib, parserOptions } = options;
  const sourceFiles = new Map<string, ts.SourceFile>();

  if (lib !== undefined) {
    sourceFiles.set(LIB_PATH, ts.createSourceFile(LIB_PATH, lib, ts.ScriptTarget.ESNext, true));
  }

  const entryPaths: string[] = [];
  for (const [name, text] of Object.entries(sources)) {
    const filePath = `${ROOT}/${name}`;
    sourceFiles.set(filePath, ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true));
    entryPaths.push(filePath);
  }

  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => sourceFiles.get(fileName),
    getDefaultLibFileName: () => LIB_PATH,
    writeFile: () => {},
    getCurrentDirectory: () => ROOT,
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => sourceFiles.has(fileName),
    readFile: (fileName) => sourceFiles.get(fileName)?.text,
  };

  const program = ts.createProgram(
    entryPaths,
    {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      rootDir: ROOT,
      noLib: lib === undefined,
    },
    host,
  );

  return parseFromProgram(entryPaths[0], program, {
    includeExternalTypes: false,
    ...parserOptions,
  }).exports;
}
