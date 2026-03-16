// eslint-disable-next-line n/prefer-node-protocol
import { parentPort } from 'worker_threads';
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { transformMarkdownMetadata } from '../pipeline/transformMarkdownMetadata/transformMarkdownMetadata';
import { parseCreateFactoryCall } from '../pipeline/loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { syncTypes } from '../pipeline/syncTypes/syncTypes';
import type { SyncTypesOptions } from '../pipeline/syncTypes/syncTypes';

interface IndexTask {
  type: 'index';
  taskId: number;
  filePath: string;
  perf?: boolean;
  processorOptions: {
    include: string[];
    exclude: string[];
    baseDir: string;
    onlyUpdateIndexes: boolean;
    markerDir: string;
    useVisibleDescription: boolean;
  };
}

interface TypesTask {
  type: 'types';
  taskId: number;
  filePath: string;
  perf?: boolean;
  syncTypesOptions: Omit<SyncTypesOptions, 'typesMarkdownPath' | 'rootContext' | 'variants'>;
  rootContext: string;
}

interface SerializedPerfEntry {
  name: string;
  duration: number;
}

interface IndexResult {
  type: 'index';
  taskId: number;
  success: boolean;
  perfEntries?: SerializedPerfEntry[];
  error?: string;
}

interface TypesResult {
  type: 'types';
  taskId: number;
  success: boolean;
  updated?: boolean;
  updatedPath?: string;
  perfEntries?: SerializedPerfEntry[];
  error?: string;
}

export type ValidateTask = IndexTask | TypesTask;
export type ValidateResult = IndexResult | TypesResult;

function collectPerfEntries(): SerializedPerfEntry[] {
  const entries = performance.getEntriesByType('measure').map((entry) => ({
    name: entry.name,
    duration: entry.duration,
  }));
  performance.clearMeasures();
  return entries;
}

if (parentPort) {
  // Serialize task processing so performance.clearMeasures() in collectPerfEntries()
  // cannot clear measures belonging to a concurrent in-flight task.
  let taskQueue: Promise<void> = Promise.resolve();

  parentPort.on('message', (task: ValidateTask) => {
    taskQueue = taskQueue.then(async () => {
      if (task.type === 'index') {
        try {
          const processor = unified()
            .use(remarkParse)
            .use(remarkMdx)
            .use(transformMarkdownMetadata, {
              extractToIndex: task.processorOptions,
            });

          const content = await readFile(task.filePath, 'utf-8');
          const vfile = { path: task.filePath, value: content };
          await processor.run(processor.parse(vfile), vfile);

          parentPort!.postMessage({
            type: 'index',
            taskId: task.taskId,
            success: true,
            perfEntries: task.perf ? collectPerfEntries() : undefined,
          } satisfies IndexResult);
        } catch (error) {
          parentPort!.postMessage({
            type: 'index',
            taskId: task.taskId,
            success: false,
            perfEntries: task.perf ? collectPerfEntries() : undefined,
            error: String(error),
          } satisfies IndexResult);
        }
      } else if (task.type === 'types') {
        try {
          const content = await readFile(task.filePath, 'utf-8');
          const typesMetaCall = await parseCreateFactoryCall(content, task.filePath, {
            allowExternalVariants: true,
          });

          if (!typesMetaCall) {
            parentPort!.postMessage({
              type: 'types',
              taskId: task.taskId,
              success: true,
              updated: false,
              perfEntries: task.perf ? collectPerfEntries() : undefined,
            } satisfies TypesResult);
            return;
          }

          const typesMarkdownPath = task.filePath.replace(/\.ts$/, '.md');
          const excludeFromIndex = Boolean(typesMetaCall.structuredOptions?.excludeFromIndex);

          const result = await syncTypes({
            typesMarkdownPath,
            rootContext: task.rootContext,
            variants: typesMetaCall.variants,
            watchSourceDirectly: Boolean(typesMetaCall.structuredOptions?.watchSourceDirectly),
            updateParentIndex: excludeFromIndex
              ? undefined
              : task.syncTypesOptions.updateParentIndex,
            ordering: task.syncTypesOptions.ordering,
          });

          parentPort!.postMessage({
            type: 'types',
            taskId: task.taskId,
            success: true,
            updated: result.updated,
            updatedPath: result.updated ? typesMarkdownPath : undefined,
            perfEntries: task.perf ? collectPerfEntries() : undefined,
          } satisfies TypesResult);
        } catch (error) {
          parentPort!.postMessage({
            type: 'types',
            taskId: task.taskId,
            success: false,
            perfEntries: task.perf ? collectPerfEntries() : undefined,
            error: String(error),
          } satisfies TypesResult);
        }
      }
    });
  });
}
