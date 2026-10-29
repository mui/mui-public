import ts from 'typescript';
import { parseFromProgram } from '@mui/internal-typescript-api-extractor';
import type * as tae from '@mui/internal-typescript-api-extractor';
import { PARSER_OPTIONS } from './constants';

const ROOT = '/virtual';
const LIB_PATH = `${ROOT}/lib.d.ts`;
const INSTALLED_LIB_PATH = `${ROOT}/node_modules/typescript/lib/lib.d.ts`;

export interface ParseTestSourcesOptions {
  /**
   * Declarations placed in the virtual default library. Types declared here are external
   * to the parsed sources, which is what makes the parser preserve constructs such as
   * `keyof` rather than expanding them away — a locally declared operand is expanded.
   * Omit to parse without a standard library at all.
   */
  lib?: string;
  /**
   * Places `lib` where TypeScript installs its libraries, under `node_modules`, so the parser
   * treats its types as external with a declaration source, as it does a real build's lib types.
   */
  installedLib?: boolean;
  /** Overrides merged over the pipeline's own extraction policy. */
  parserOptions?: tae.ParserOptions;
}

/**
 * Parses TypeScript sources the way the pipeline does, without touching the filesystem.
 *
 * Tests that assert on parsed exports should start from source rather than hand-built
 * nodes, so they stay honest about what `typescript-api-extractor` actually emits. The
 * extraction policy is the pipeline's own, so a shape the real build declines to resolve
 * is left unresolved here too.
 *
 * Sources are keyed by file name (e.g. `ComponentRootDataAttributes.ts`) and may import
 * each other by relative path. The first entry is the entrypoint.
 */
export function parseTestSources(
  sources: Record<string, string>,
  options: ParseTestSourcesOptions = {},
): tae.ExportNode[] {
  const { program, entrypoint } = createTestProgram(sources, options.lib, options.installedLib);

  return parseFromProgram(entrypoint, program, {
    ...PARSER_OPTIONS,
    ...options.parserOptions,
  }).exports;
}

/**
 * Builds a TypeScript program over in-memory sources, for tests that need the checker
 * itself rather than parsed exports. Sources are keyed and resolved as in
 * `parseTestSources`, and `entrypoint` is the path of the first one.
 */
export function createTestProgram(
  sources: Record<string, string>,
  lib?: string,
  installedLib = false,
): { program: ts.Program; entrypoint: string } {
  const sourceFiles = new Map<string, ts.SourceFile>();

  const libPath = installedLib ? INSTALLED_LIB_PATH : LIB_PATH;
  if (lib !== undefined) {
    sourceFiles.set(libPath, ts.createSourceFile(libPath, lib, ts.ScriptTarget.ESNext, true));
  }

  const entryPaths: string[] = [];
  for (const [name, text] of Object.entries(sources)) {
    const filePath = `${ROOT}/${name}`;
    sourceFiles.set(filePath, ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true));
    entryPaths.push(filePath);
  }

  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => sourceFiles.get(fileName),
    getDefaultLibFileName: () => libPath,
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

  return { program, entrypoint: entryPaths[0] };
}
