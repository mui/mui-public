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

type Args = {
  paths?: string[];
  command?: string;
  useVisibleDescription?: boolean;
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
    } = args;
    const ci = Boolean(process.env.CI);

    await Promise.all([
      (async () => {
        console.log(chalk.cyan('Validating committed files match expected output...'));

        const startMark = nameMark(functionName, 'Start Validation', []);
        let currentMark = startMark;
        performance.mark(currentMark);

        const markerDir = '.next/cache/docs-infra/index-updates';
        const markerDirPath = path.join(cwd, markerDir);

        // Remove the marker directory if it exists
        try {
          await rm(markerDirPath, { recursive: true, force: true });
        } catch (error) {
          // Ignore errors if directory doesn't exist
        }

        // Find all page.mdx files in src/app/ or app/ directories
        let searchDirs: string[];

        if (paths.length > 0) {
          // If paths are provided, search in those specific paths
          searchDirs = paths.flatMap((p) => [
            path.join(cwd, 'src/app', p),
            path.join(cwd, 'app', p),
          ]);
        } else {
          // Otherwise search all app directories
          searchDirs = [path.join(cwd, 'src/app'), path.join(cwd, 'app')];
        }

        const pageMdxFilesPerDir = await Promise.all(
          searchDirs.map((dir) => findFiles(dir, 'page.mdx')),
        );
        const pageMdxFiles = pageMdxFilesPerDir.flat();

        console.log(chalk.yellow(`\nProcessing ${pageMdxFiles.length} page.mdx files...\n`));

        // Process each file through the unified pipeline
        // Auto-detect include paths based on which directories actually contain files
        const hasSrcAppFiles = pageMdxFilesPerDir
          .slice(0, Math.ceil(searchDirs.length / 2)) // First half are src/app paths
          .some((files) => files.length > 0);
        const hasAppFiles = pageMdxFilesPerDir
          .slice(Math.ceil(searchDirs.length / 2)) // Second half are app paths
          .some((files) => files.length > 0);

        const includePatterns: string[] = [];
        if (hasSrcAppFiles) {
          includePatterns.push('src/app');
        }
        if (hasAppFiles) {
          includePatterns.push('app');
        }
        // Fallback to 'app' if neither has files (shouldn't happen but be safe)
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

        let hasErrors = false;

        await Promise.all(
          pageMdxFiles.map(async (filePath) => {
            try {
              const content = await readFile(filePath, 'utf-8');
              const vfile = { path: filePath, value: content };
              // Use run() instead of process() since we don't need HTML output
              await processor.run(processor.parse(vfile), vfile);
            } catch (error) {
              hasErrors = true;
              console.error(chalk.red(`Error processing ${filePath}:`), error);
            }
          }),
        );

        // Find all marker files to see which indexes were updated
        const updatedIndexes = await findFiles(markerDirPath, 'page.mdx');

        if (updatedIndexes.length > 0) {
          console.log(chalk.yellow('\nUpdated index files:'));
          updatedIndexes.forEach((markerPath) => {
            // Convert marker path back to actual index path
            const relativePath = path.relative(markerDirPath, markerPath);
            console.log(chalk.gray(`  ${relativePath}`));
          });
          console.log(chalk.yellow(`\nTotal: ${updatedIndexes.length} indexes updated\n`));
        } else {
          console.log(chalk.green('\nNo indexes needed updating\n'));
        }

        const generatedFiles = updatedIndexes.length;

        currentMark = performanceMeasure(
          currentMark,
          { mark: 'Validated Files', measure: 'Validating Files' },
          [functionName],
          true,
        );

        console.log(
          completeMessage(
            `${generatedFiles} index files updated in ${(performance.measure(nameMark(functionName, 'Validation', []), startMark, currentMark).duration / 1000).toPrecision(3)}s`,
          ),
        );

        if (hasErrors) {
          console.error(chalk.red('\n✗ Validation failed with errors\n'));
          process.exit(1);
        }

        if (ci && generatedFiles > 0) {
          let pathsArg = '';

          if (paths.length > 0) {
            // Use the paths that were provided
            pathsArg = ` ${paths.join(' ')}`;
          } else {
            // Derive paths from the updated indexes
            const updatedPaths = new Set<string>();
            updatedIndexes.forEach((markerPath) => {
              const relativePath = path.relative(markerDirPath, markerPath);
              // Extract the directory path (e.g., 'app/docs-infra/components/page.mdx' -> 'docs-infra/components')
              const dir = path.dirname(relativePath);
              // Remove 'app/' or 'src/app/' prefix if present
              const cleanDir = dir.replace(/^(src\/)?app\//, '');
              if (cleanDir) {
                updatedPaths.add(cleanDir);
              }
            });

            if (updatedPaths.size > 0) {
              pathsArg = ` ${Array.from(updatedPaths)
                .map((p) => (/^[a-zA-Z0-9/_.-]+$/.test(p) ? p : `"${p}"`))
                .join(' ')}`;
            }
          }

          console.error(chalk.red('\n✗ Index files are out of date. Run this command locally:\n'));
          console.error(chalk.cyan(`  ${command}${pathsArg}`));
          console.error(chalk.red('\nThen commit the results.\n'));
          process.exit(1);
        }
      })(),
    ]);
  },
};

export default runValidate;
