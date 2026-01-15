/* eslint-disable no-console */
import chalk from 'chalk';
import type { CommandModule } from 'yargs';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import {
  nameMark,
  performanceMeasure,
} from '../pipeline/loadPrecomputedCodeHighlighter/performanceLogger';
import { transformMarkdownMetadata } from '../pipeline/transformMarkdownMetadata/transformMarkdownMetadata';
import { parseCreateFactoryCall } from '../pipeline/loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { syncTypes } from '../pipeline/syncTypes/syncTypes';
import { terminateWorkerManager } from '../pipeline/syncTypes/workerManager';

type Args = {
  paths?: string[];
  command?: string;
  useVisibleDescription?: boolean;
  indexes?: boolean;
  types?: boolean;
};

const completeMessage = (message: string) => `✓ ${chalk.green(message)}`;

const functionName = 'Run Validate';

/**
 * Recursively find all files matching a specific name in a directory
 */
async function findFiles(dir: string, fileName: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const subResults = await findFiles(fullPath, fileName);
          results.push(...subResults);
        } else if (entry.isFile() && entry.name === fileName) {
          results.push(fullPath);
        }
      }),
    );
  } catch (error: any) {
    // Skip if directory doesn't exist
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return results;
}

const runValidate: CommandModule<{}, Args> = {
  command: 'validate [paths...]',
  describe: 'Ensures that committed files match expected output',
  builder: (yargs) => {
    return yargs
      .option('command', {
        type: 'string',
        description: 'Command to suggest when indexes are out of date',
        default: 'pnpm docs-infra validate',
      })
      .option('useVisibleDescription', {
        type: 'boolean',
        description:
          'Use the first visible paragraph as description in extracted index instead of meta tag',
        default: false,
      })
      .option('indexes', {
        type: 'boolean',
        description: 'Only validate page.mdx index files',
        default: false,
      })
      .option('types', {
        type: 'boolean',
        description: 'Only validate types.ts files',
        default: false,
      })
      .positional('paths', {
        type: 'string',
        array: true,
        description:
          'Optional paths to validate (e.g., docs-infra/components docs-infra/functions)',
        default: [],
      }) as any;
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const {
      paths = [],
      command = 'pnpm docs-infra validate',
      useVisibleDescription = false,
      indexes: indexesOnly = false,
      types: typesOnly = false,
    } = args;
    const ci = Boolean(process.env.CI);

    // If neither flag is set, run both. If one is set, run only that one.
    const runIndexes = !typesOnly || indexesOnly;
    const runTypes = !indexesOnly || typesOnly;

    console.log(chalk.cyan('Validating committed files match expected output...'));

    const startMark = nameMark(functionName, 'Start Validation', []);
    let currentMark = startMark;
    performance.mark(currentMark);

    // Build search directories based on provided paths
    let searchDirs: string[];
    if (paths.length > 0) {
      searchDirs = paths.flatMap((p) => [path.join(cwd, 'src/app', p), path.join(cwd, 'app', p)]);
    } else {
      searchDirs = [path.join(cwd, 'src/app'), path.join(cwd, 'app')];
    }

    let hasErrors = false;
    let totalUpdatedFiles = 0;
    const updatedFilePaths: string[] = [];

    let indexesMark = currentMark;

    // === Validate page.mdx index files ===
    if (runIndexes) {
      const markerDir = '.next/cache/docs-infra/index-updates';
      const markerDirPath = path.join(cwd, markerDir);

      try {
        await rm(markerDirPath, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }

      const pageMdxFilesPerDir = await Promise.all(
        searchDirs.map((dir) => findFiles(dir, 'page.mdx')),
      );
      const pageMdxFiles = pageMdxFilesPerDir.flat();

      console.log(chalk.yellow(`\nProcessing ${pageMdxFiles.length} indexed page.mdx files...`));

      // Auto-detect include paths based on which directories actually contain files
      const hasSrcAppFiles = pageMdxFilesPerDir
        .slice(0, Math.ceil(searchDirs.length / 2))
        .some((files) => files.length > 0);
      const hasAppFiles = pageMdxFilesPerDir
        .slice(Math.ceil(searchDirs.length / 2))
        .some((files) => files.length > 0);

      const includePatterns: string[] = [];
      if (hasSrcAppFiles) {
        includePatterns.push('src/app');
      }
      if (hasAppFiles) {
        includePatterns.push('app');
      }
      if (includePatterns.length === 0) {
        includePatterns.push('app');
      }

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: includePatterns,
            exclude: [],
            baseDir: cwd,
            onlyUpdateIndexes: true,
            markerDir,
            useVisibleDescription,
          },
        });

      await Promise.all(
        pageMdxFiles.map(async (filePath) => {
          try {
            const content = await readFile(filePath, 'utf-8');
            const vfile = { path: filePath, value: content };
            await processor.run(processor.parse(vfile), vfile);
          } catch (error) {
            hasErrors = true;
            console.error(chalk.red(`Error processing ${filePath}:`), error);
          }
        }),
      );

      const updatedIndexes = await findFiles(markerDirPath, 'page.mdx');
      if (updatedIndexes.length > 0) {
        console.log(chalk.yellow('\nUpdated index files:'));
        updatedIndexes.forEach((markerPath) => {
          const relativePath = path.relative(markerDirPath, markerPath);
          console.log(chalk.gray(`  ${relativePath}`));
          updatedFilePaths.push(relativePath);
        });
        totalUpdatedFiles += updatedIndexes.length;
      }

      indexesMark = performanceMeasure(
        currentMark,
        { mark: 'Validated Indexes', measure: 'Validating Indexes' },
        [functionName],
        true,
      );
      currentMark = indexesMark;
    }

    let typesMark = currentMark;

    // === Validate types.ts files ===
    if (runTypes) {
      // Use same marker directory structure for index updates from types
      const typesMarkerDir = '.next/cache/docs-infra/types-index-updates';
      const typesMarkerDirPath = path.join(cwd, typesMarkerDir);

      try {
        await rm(typesMarkerDirPath, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }

      const typesFilesPerDir = await Promise.all(
        searchDirs.map((dir) => findFiles(dir, 'types.ts')),
      );
      const typesFiles = typesFilesPerDir.flat();

      console.log(chalk.yellow(`\nProcessing ${typesFiles.length} types.md files...`));

      const updatedTypesFiles: string[] = [];

      await Promise.all(
        typesFiles.map(async (typesFilePath) => {
          try {
            const content = await readFile(typesFilePath, 'utf-8');
            const typesMetaCall = await parseCreateFactoryCall(content, typesFilePath, {
              allowExternalVariants: true,
            });

            if (!typesMetaCall) {
              // Not a types file with createTypesMeta call, skip
              return;
            }

            const typesMarkdownPath = typesFilePath.replace(/\.ts$/, '.md');
            const result = await syncTypes({
              typesMarkdownPath,
              rootContext: cwd,
              variants: typesMetaCall.variants,
              globalTypes: typesMetaCall.structuredOptions?.globalTypes?.[0]?.map((s: any) =>
                s.replace(/['"]/g, ''),
              ),
              watchSourceDirectly: Boolean(typesMetaCall.structuredOptions?.watchSourceDirectly),
              // Update parent index pages with component exports
              updateParentIndex: {
                baseDir: cwd,
                markerDir: typesMarkerDir,
              },
            });

            if (result.updated) {
              const relativePath = path.relative(cwd, typesMarkdownPath);
              updatedTypesFiles.push(relativePath);
            }
          } catch (error) {
            hasErrors = true;
            const relativePath = path.relative(cwd, typesFilePath);
            console.error(chalk.red(`Error processing ${relativePath}:`), error);
          }
        }),
      );

      if (updatedTypesFiles.length > 0) {
        console.log(chalk.yellow('\nUpdated types.md files:'));
        updatedTypesFiles.forEach((relativePath) => {
          console.log(chalk.gray(`  ${relativePath}`));
          updatedFilePaths.push(relativePath);
        });
        totalUpdatedFiles += updatedTypesFiles.length;
      }

      // Check for index files updated by types
      const updatedIndexesFromTypes = await findFiles(typesMarkerDirPath, 'page.mdx');
      if (updatedIndexesFromTypes.length > 0) {
        console.log(chalk.yellow('\nUpdated index files (from types):'));
        updatedIndexesFromTypes.forEach((markerPath) => {
          const relativePath = path.relative(typesMarkerDirPath, markerPath);
          console.log(chalk.gray(`  ${relativePath}`));
          updatedFilePaths.push(relativePath);
        });
        totalUpdatedFiles += updatedIndexesFromTypes.length;
      }

      typesMark = performanceMeasure(
        currentMark,
        { mark: 'Validated Types', measure: 'Validating Types' },
        [functionName],
        true,
      );
      currentMark = typesMark;
    }

    // Terminate the worker manager to allow the process to exit
    terminateWorkerManager();

    // === Summary ===
    if (totalUpdatedFiles === 0) {
      console.log(chalk.green('\nNo files needed updating\n'));
    } else {
      console.log(chalk.yellow(`\nTotal: ${totalUpdatedFiles} files updated\n`));
    }

    const totalDuration =
      performance.measure(nameMark(functionName, 'Validation', []), startMark, currentMark)
        .duration / 1000;

    // Build timing breakdown based on what was run
    const timingParts: string[] = [];
    if (runIndexes) {
      const indexesDuration =
        performance.measure(nameMark(functionName, 'Indexes Duration', []), startMark, indexesMark)
          .duration / 1000;
      timingParts.push(`indexes: ${indexesDuration.toFixed(2)}s`);
    }
    if (runTypes) {
      const typesDuration =
        performance.measure(
          nameMark(functionName, 'Types Duration', []),
          runIndexes ? indexesMark : startMark,
          typesMark,
        ).duration / 1000;
      timingParts.push(`types: ${typesDuration.toFixed(2)}s`);
    }

    const timingBreakdown = timingParts.length > 0 ? ` [${timingParts.join(', ')}]` : '';

    console.log(
      completeMessage(
        `${totalUpdatedFiles} files updated in ${totalDuration.toFixed(2)}s${timingBreakdown}`,
      ),
    );

    if (hasErrors) {
      console.error(chalk.red('\n✗ Validation failed with errors\n'));
      process.exit(1);
    }

    if (ci && totalUpdatedFiles > 0) {
      let pathsArg = '';

      if (paths.length > 0) {
        pathsArg = ` ${paths.join(' ')}`;
      } else {
        // Derive paths from the updated files
        const derivedPaths = new Set<string>();
        updatedFilePaths.forEach((filePath) => {
          const dir = path.dirname(filePath);
          const cleanDir = dir.replace(/^(src\/)?app\//, '');
          if (cleanDir) {
            derivedPaths.add(cleanDir);
          }
        });

        if (derivedPaths.size > 0) {
          pathsArg = ` ${Array.from(derivedPaths)
            .map((p) => (/^[a-zA-Z0-9/_.-]+$/.test(p) ? p : `"${p}"`))
            .join(' ')}`;
        }
      }

      console.error(chalk.red('\n✗ Generated files are out of date. Run this command locally:\n'));
      console.error(chalk.cyan(`  ${command}${pathsArg}`));
      console.error(chalk.red('\nThen commit the results.\n'));
      process.exit(1);
    }

    // Force exit to ensure the process terminates even if there are lingering handles
    process.exit(0);
  },
};

export default runValidate;
