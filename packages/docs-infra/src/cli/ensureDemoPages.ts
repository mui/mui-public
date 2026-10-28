import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseAllCreateFactoryCalls } from '../pipeline/parseCreateFactoryCall/parseCreateFactoryCall';
import type { DemoPageRequirement } from './loadNextConfig';
import { findDemoIndexFiles } from './findDemoIndexFiles';
import { fileExists, formatWithPrettier } from './fileUtils';

const PAGE_TS_FILE_NAME = 'page.ts';
const PAGE_TSX_FILE_NAME = 'page.tsx';
const UNKNOWN_EXPORT_NAME = 'unknown';

export interface EnsureDemoPagesOptions {
  /** Workspace root used to resolve glob patterns. */
  baseDir: string;
  /** Patterns extracted from next.config that opted into `page.tsx` generation. */
  requirements: DemoPageRequirement[];
}

export interface EnsureDemoPagesResult {
  /** Total number of demo `index.ts` files matched across all patterns. */
  demoCount: number;
  /** Workspace-relative paths of files that were created. */
  updatedFiles: string[];
  /** Errors encountered during the run. */
  errors: { filePath: string; message: string }[];
}

/**
 * Generates the contents for an auto-created demo `page.tsx`. The page renders
 * the demo's named export from the sibling `index.ts` inside a `Page` component,
 * so the demo renders as its own route.
 *
 * Exported for tests and reuse.
 */
export function generatePageFileContent(exportName: string): string {
  return [
    `import * as React from 'react';`,
    `import { ${exportName} } from '.';`,
    ``,
    `export default function Page() {`,
    `  return <${exportName} />;`,
    `}`,
    ``,
  ].join('\n');
}

/**
 * Reads the demo's export name from a demo `index.ts` by reusing the same
 * `create*` factory parser the precomputed code highlighter loader uses to load
 * variants. Returns `null` when no named `export const X = create*(...)` is
 * found (e.g. an anonymous default export), since a re-export page needs a name
 * to import.
 *
 * Exported for tests.
 */
export async function findDemoExportName(source: string, filePath: string): Promise<string | null> {
  const factories = await parseAllCreateFactoryCalls(source, filePath, {
    allowExternalVariants: true,
  });
  const exportName = Object.keys(factories).find((name) => name !== UNKNOWN_EXPORT_NAME);
  return exportName ?? null;
}

/**
 * Ensures every demo `index.ts` matched by the configured demo patterns has a
 * sibling `page.tsx` that renders the demo as the route's default export.
 *
 * Existing `page.tsx`/`page.ts` files are left untouched so developers can
 * customise the page (e.g. wrap the demo with additional layout). Returns the
 * list of files that were created, plus any errors encountered.
 */
export async function ensureDemoPages(
  options: EnsureDemoPagesOptions,
): Promise<EnsureDemoPagesResult> {
  const { baseDir, requirements } = options;

  if (requirements.length === 0) {
    return { demoCount: 0, updatedFiles: [], errors: [] };
  }

  const patterns = requirements.map((entry) => entry.pattern);
  const indexFiles = await findDemoIndexFiles(baseDir, patterns);

  const updatedFiles: string[] = [];
  const errors: EnsureDemoPagesResult['errors'] = [];

  await Promise.all(
    Array.from(indexFiles.keys()).map(async (indexPath) => {
      try {
        const dir = path.dirname(indexPath);
        const pageTsPath = path.join(dir, PAGE_TS_FILE_NAME);
        const pageTsxPath = path.join(dir, PAGE_TSX_FILE_NAME);

        // Only generate the page when neither a .ts nor .tsx page exists. Existing
        // pages are left alone so developers can wrap the demo with extra layout.
        const [pageTsExists, pageTsxExists] = await Promise.all([
          fileExists(pageTsPath),
          fileExists(pageTsxPath),
        ]);
        if (pageTsExists || pageTsxExists) {
          return;
        }

        const indexSource = await readFile(indexPath, 'utf-8');
        const exportName = await findDemoExportName(indexSource, indexPath);
        if (!exportName) {
          errors.push({
            filePath: path.relative(baseDir, indexPath),
            message: 'Could not determine the demo export name from a create* factory call.',
          });
          return;
        }

        const generated = generatePageFileContent(exportName);
        const formatted = await formatWithPrettier(generated, pageTsxPath);
        await writeFile(pageTsxPath, formatted, 'utf-8');
        updatedFiles.push(path.relative(baseDir, pageTsxPath));
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
