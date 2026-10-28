import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCreateFactoryCall } from '../pipeline/parseCreateFactoryCall/parseCreateFactoryCall';
import { serializeFunctionArguments } from '../pipeline/parseCreateFactoryCall/serializeFunctionArguments';
import type { ImportsAndComments } from '../pipeline/loaderUtils';
import type { DemoClientRequirement } from './loadNextConfig';
import { findDemoIndexFiles } from './findDemoIndexFiles';
import { fileExists, formatWithPrettier } from './fileUtils';

const CLIENT_FILE_NAME = 'client.ts';
const CLIENT_PROVIDER_IDENTIFIER = 'ClientProvider';
const CLIENT_RELATIVE_IMPORT = './client';

export interface EnsureDemoClientsOptions {
  /** Workspace root used to resolve glob patterns. */
  baseDir: string;
  /**
   * Directory used to resolve relative `requireClient` import specifiers.
   * Typically the directory containing `next.config.{js,mjs,ts}`. When
   * omitted, defaults to `baseDir`.
   */
  configDir?: string;
  /** Patterns + import specifiers extracted from next.config. */
  requirements: DemoClientRequirement[];
}

export interface EnsureDemoClientsResult {
  /** Total number of demo `index.ts` files matched across all patterns. */
  demoCount: number;
  /** Workspace-relative paths of files that were created or modified. */
  updatedFiles: string[];
  /** Errors encountered during the run. */
  errors: { filePath: string; message: string }[];
}

/**
 * Generates the contents for an auto-created demo `client.ts`.
 * Exported for tests and reuse.
 */
export function generateClientFileContent(requireClient: string): string {
  const escaped = requireClient.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return [
    `'use client';`,
    ``,
    `import { createDemoClient } from '${escaped}';`,
    ``,
    `const ${CLIENT_PROVIDER_IDENTIFIER} = createDemoClient(import.meta.url);`,
    ``,
    `export default ${CLIENT_PROVIDER_IDENTIFIER};`,
    ``,
  ].join('\n');
}

/**
 * Returns the import specifier to use inside an auto-generated `client.ts` for
 * a given requirement.
 *
 * - Bare specifiers (e.g. `@/foo`, `package/x`) pass through unchanged.
 * - Relative specifiers (`./foo`, `../foo`) are resolved against `configDir`
 *   and rewritten to be relative to `clientDir`, ensuring the generated file
 *   imports the same module regardless of how deep it sits in the workspace.
 */
export function resolveRequireClientSpecifier(
  requireClient: string,
  configDir: string,
  clientDir: string,
): string {
  if (!requireClient.startsWith('./') && !requireClient.startsWith('../')) {
    return requireClient;
  }
  const absoluteTarget = path.resolve(configDir, requireClient);
  let rewritten = path.relative(clientDir, absoluteTarget);
  if (path.sep !== '/') {
    rewritten = rewritten.split(path.sep).join('/');
  }
  if (!rewritten.startsWith('.')) {
    rewritten = `./${rewritten}`;
  }
  return rewritten;
}

/**
 * Result of mutating an `index.ts` file.
 */
export interface IndexUpdate {
  /** New file contents, or `null` when the file is already wired correctly. */
  content: string | null;
}

/**
 * Patches a demo `index.ts` so it imports `ClientProvider` from `./client`
 * and passes it through to the `create*` factory call.
 *
 * Reuses the same `parseCreateFactoryCall` + `serializeFunctionArguments`
 * helpers the precomputed code highlighter loader uses, so quirky source
 * (trailing commas, comments containing `create*` tokens, multi-line option
 * objects) is parsed structurally instead of via ad-hoc regexes.
 *
 * Exported for tests.
 */
export async function addClientProviderToIndex(
  source: string,
  filePath: string,
): Promise<IndexUpdate> {
  let parsed;
  try {
    parsed = await parseCreateFactoryCall(source, filePath, {
      allowExternalVariants: true,
      allowMultipleFactories: true,
    });
  } catch {
    // Structural problems (missing imports, malformed args, etc.) are surfaced
    // by the regular pipeline. Skip the file here so we don't mangle it further.
    return { content: null };
  }

  if (!parsed) {
    return { content: null };
  }

  const {
    argumentsStartIndex,
    argumentsEndIndex,
    structuredUrl,
    structuredVariants,
    structuredOptions,
    importsAndComments,
  } = parsed;

  const hasMetaProperty = !!(
    structuredOptions &&
    Object.prototype.hasOwnProperty.call(structuredOptions, CLIENT_PROVIDER_IDENTIFIER)
  );
  const hasImport = hasClientProviderImport(importsAndComments);

  if (hasImport && hasMetaProperty) {
    return { content: null };
  }

  let next = source;

  if (!hasMetaProperty) {
    // Preserve existing options order, then append `ClientProvider` as a shorthand.
    // `serializeObject` emits shorthand when the value matches the key, so passing
    // the identifier name as a string produces `{ ..., ClientProvider }`.
    const newOptions: Record<string, any> = { ...(structuredOptions ?? {}) };
    newOptions[CLIENT_PROVIDER_IDENTIFIER] = CLIENT_PROVIDER_IDENTIFIER;

    const args: any[] =
      structuredVariants !== undefined
        ? [structuredUrl, structuredVariants, newOptions]
        : [structuredUrl, newOptions];

    const serialized = serializeFunctionArguments(args);
    next = `${next.slice(0, argumentsStartIndex)}${serialized}${next.slice(argumentsEndIndex)}`;
  }

  if (!hasImport) {
    next = insertClientProviderImport(next, importsAndComments);
  }

  return { content: next === source ? null : next };
}

/**
 * Returns true when the source already pulls in a default-export `ClientProvider`
 * from `./client` (the only form the generated `client.ts` produces).
 */
function hasClientProviderImport(importsAndComments: ImportsAndComments | undefined): boolean {
  if (!importsAndComments) {
    return false;
  }
  for (const entry of Object.values(importsAndComments.relative)) {
    if (!entry.url.endsWith('/client') && !entry.url.endsWith('/client.ts')) {
      continue;
    }
    if (
      entry.names.some(
        (name) => name.type === 'default' && name.name === CLIENT_PROVIDER_IDENTIFIER,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Inserts `import ClientProvider from './client';` on its own line right after the
 * last existing import statement. Falls back to the top of the file (after a
 * leading directive like `'use client'`) when no imports exist.
 */
function insertClientProviderImport(
  source: string,
  importsAndComments: ImportsAndComments | undefined,
): string {
  const importLine = `import ${CLIENT_PROVIDER_IDENTIFIER} from '${CLIENT_RELATIVE_IMPORT}';`;

  // Find the rightmost path-quote position across all imports the parser saw.
  let lastPathEnd = -1;
  if (importsAndComments) {
    for (const entry of Object.values(importsAndComments.relative)) {
      for (const pos of entry.positions) {
        if (pos.end > lastPathEnd) {
          lastPathEnd = pos.end;
        }
      }
    }
    for (const entry of Object.values(importsAndComments.externals)) {
      for (const pos of entry.positions) {
        if (pos.end > lastPathEnd) {
          lastPathEnd = pos.end;
        }
      }
    }
  }

  if (lastPathEnd === -1) {
    // No imports — insert after a leading directive if present, otherwise at the top.
    const directiveMatch = source.match(/^['"][^'"\n]+['"]\s*;?\s*\n/);
    const insertAt = directiveMatch ? directiveMatch[0].length : 0;
    const needsLeadingNewline = insertAt > 0 && source[insertAt - 1] !== '\n';
    return `${source.slice(0, insertAt)}${needsLeadingNewline ? '\n' : ''}${importLine}\n\n${source.slice(insertAt)}`;
  }

  // Walk forward past an optional `;` and to the end of the current line so the
  // new import lands on its own line right after the existing statement.
  let cursor = lastPathEnd;
  while (cursor < source.length && source[cursor] !== '\n') {
    cursor += 1;
  }
  return `${source.slice(0, cursor)}\n${importLine}${source.slice(cursor)}`;
}

/**
 * Ensures every demo `index.ts` matched by the configured demo patterns has a
 * sibling `client.ts` and that the `index.ts` wires it up via `ClientProvider`.
 *
 * Returns the list of files that were created or modified, plus any errors
 * encountered.
 */
export async function ensureDemoClients(
  options: EnsureDemoClientsOptions,
): Promise<EnsureDemoClientsResult> {
  const { baseDir, configDir = baseDir, requirements } = options;

  if (requirements.length === 0) {
    return { demoCount: 0, updatedFiles: [], errors: [] };
  }

  // Group requirements by import specifier so each pattern uses its declared value.
  const patterns = requirements.map((entry) => entry.pattern);
  const requireClientByPattern = new Map<string | RegExp, string>(
    requirements.map((entry) => [entry.pattern, entry.requireClient]),
  );

  const indexFiles = await findDemoIndexFiles(baseDir, patterns);

  const updatedFiles: string[] = [];
  const errors: EnsureDemoClientsResult['errors'] = [];

  await Promise.all(
    Array.from(indexFiles.entries()).map(async ([indexPath, pattern]) => {
      const requireClient = requireClientByPattern.get(pattern);
      if (!requireClient) {
        return;
      }
      try {
        const dir = path.dirname(indexPath);
        const clientPath = path.join(dir, CLIENT_FILE_NAME);

        const [clientExists, indexSource] = await Promise.all([
          fileExists(clientPath),
          readFile(indexPath, 'utf-8'),
        ]);

        // Only generate the client.ts when it does not yet exist. Existing files
        // are left alone so developers can customise the import path or wrap the
        // ClientProvider with additional logic.
        if (!clientExists) {
          const resolvedSpecifier = resolveRequireClientSpecifier(requireClient, configDir, dir);
          const generated = generateClientFileContent(resolvedSpecifier);
          const expectedClientContent = await formatWithPrettier(generated, clientPath);
          await writeFile(clientPath, expectedClientContent, 'utf-8');
          updatedFiles.push(path.relative(baseDir, clientPath));
        }

        const update = await addClientProviderToIndex(indexSource, indexPath);
        if (update.content !== null) {
          const formatted = await formatWithPrettier(update.content, indexPath);
          await writeFile(indexPath, formatted, 'utf-8');
          updatedFiles.push(path.relative(baseDir, indexPath));
        }
      } catch (error: any) {
        errors.push({
          filePath: path.relative(baseDir, indexPath),
          message: error?.message ?? String(error),
        });
      }
    }),
  );

  updatedFiles.sort();
  return { demoCount: indexFiles.size, updatedFiles, errors };
}
