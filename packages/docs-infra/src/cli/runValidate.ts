/* eslint-disable no-console */
import chalk from 'chalk';
import type { CommandModule } from 'yargs';
import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
import { Worker } from 'node:worker_threads';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
  performanceMeasure,
} from '../pipeline/loadPrecomputedCodeHighlighter/performanceLogger';
import { terminateWorkerManager } from '../pipeline/loadServerTypesMeta/workerManager';
import { extractDocsInfraOptionsFromNextConfig } from './loadNextConfig';
import type { ValidateTask, ValidateResult } from './validateWorker';

type Args = {
  paths?: string[];
  command?: string;
  indexes?: boolean;
  types?: boolean;
  perf?: boolean;
  notableMs?: number;
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
      .option('perf', {
        type: 'boolean',
        description: 'Log performance timing for each pipeline step',
        default: false,
      })
      .option('notableMs', {
        type: 'number',
        description: 'Only log performance measures that exceed this threshold (ms)',
        default: 100,
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
      indexes: indexesOnly = false,
      types: typesOnly = false,
      perf: perfEnabled = false,
      notableMs: performanceNotableMs = 100,
    } = args;
    const ci = Boolean(process.env.CI);
    const { ordering, useVisibleDescription = false } =
      await extractDocsInfraOptionsFromNextConfig(cwd);

    // If neither flag is set, run both. If one is set, run only that one.
    const runIndexes = !typesOnly || indexesOnly;
    const runTypes = !indexesOnly || typesOnly;

    console.log(chalk.cyan('Validating committed files match expected output...'));

    // Set up performance observer to log inner pipeline measures (syncTypes, worker, etc.)
    let observer: PerformanceObserver | undefined;
    if (perfEnabled) {
      observer = new PerformanceObserver(createPerformanceLogger(performanceNotableMs, true));
      observer.observe({ entryTypes: ['measure'], buffered: true });
    }

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

    // === Create worker pool ===
    const workerCount = Math.max(1, availableParallelism() - 1);
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const workerPath = path.join(currentDir, 'validateWorker.mjs');

    const workers: Worker[] = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(new Worker(workerPath));
    }

    // Round-robin task distribution with promise tracking
    let nextWorkerIndex = 0;
    const pendingResults = new Map<number, (result: ValidateResult) => void>();
    let taskIdCounter = 0;

    for (const worker of workers) {
      worker.on('message', (result: ValidateResult) => {
        const resolve = pendingResults.get(result.taskId);
        if (resolve) {
          pendingResults.delete(result.taskId);
          resolve(result);
        }
      });

      const rejectPending = (reason: string) => {
        pendingResults.forEach((resolve, taskId) => {
          resolve({ type: 'index', taskId, success: false, error: reason });
        });
        pendingResults.clear();
      };

      worker.on('error', (error) => {
        console.error(chalk.red('[ValidateWorker] Worker error:'), error);
        rejectPending(`Worker error: ${error.message}`);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          rejectPending(`Worker exited with code ${code}`);
        }
      });
    }

    function postTask(task: ValidateTask): Promise<ValidateResult> {
      return new Promise((resolve) => {
        pendingResults.set(task.taskId, resolve);
        workers[nextWorkerIndex].postMessage(task);
        nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
      });
    }

    function logWorkerPerfEntries(result: ValidateResult): void {
      if (result.perfEntries) {
        for (const entry of result.perfEntries) {
          logPerformance(entry as PerformanceEntry, performanceNotableMs, true);
        }
      }
    }

    console.log(chalk.gray(`  Using ${workerCount} worker${workerCount > 1 ? 's' : ''}`));

    let indexesMark = currentMark;
    let typesMark = currentMark;

    try {
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

        const processorOptions = {
          include: includePatterns,
          exclude: [] as string[],
          baseDir: cwd,
          onlyUpdateIndexes: true,
          markerDir,
          useVisibleDescription,
        };

        const indexResults = await Promise.all(
          pageMdxFiles.map((filePath) => {
            const taskId = taskIdCounter;
            taskIdCounter += 1;
            return postTask({
              type: 'index',
              taskId,
              filePath,
              perf: perfEnabled,
              processorOptions,
            });
          }),
        );

        for (const result of indexResults) {
          logWorkerPerfEntries(result);
          if (!result.success) {
            hasErrors = true;
            console.error(chalk.red(`Error processing index file:`), result.error);
          }
        }

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

      typesMark = currentMark;

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

        const typesResults = await Promise.all(
          typesFiles.map((filePath) => {
            const taskId = taskIdCounter;
            taskIdCounter += 1;
            return postTask({
              type: 'types',
              taskId,
              filePath,
              perf: perfEnabled,
              rootContext: cwd,
              syncTypesOptions: {
                updateParentIndex: {
                  baseDir: cwd,
                  markerDir: typesMarkerDir,
                },
                ordering,
              },
            });
          }),
        );

        for (let i = 0; i < typesResults.length; i += 1) {
          const result = typesResults[i];
          logWorkerPerfEntries(result);
          if (!result.success) {
            hasErrors = true;
            const relativePath = path.relative(cwd, typesFiles[i]);
            console.error(chalk.red(`Error processing ${relativePath}:`), result.error);
          } else if (result.type === 'types' && result.updated) {
            const relativePath = path.relative(cwd, result.updatedPath!);
            updatedTypesFiles.push(relativePath);
          }
        }

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
    } finally {
      // Terminate worker pool
      await Promise.all(workers.map((w) => w.terminate()));

      // Terminate the types meta worker manager to allow the process to exit
      terminateWorkerManager();
    }

    if (observer) {
      // Flush any remaining performance entries before disconnecting
      const pendingEntries = observer.takeRecords();
      for (const entry of pendingEntries) {
        logPerformance(entry, performanceNotableMs, true);
      }
      observer.disconnect();
    }

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

      // Show git diff so we can spot indeterministic output
      try {
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync('git', ['diff'], { maxBuffer: 1024 * 1024 });
        if (stdout) {
          console.error(chalk.yellow('\ngit diff:\n'));
          console.error(stdout);
        }
      } catch {
        // git may not be available; continue with the error message
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
