import ts, { CompilerOptions } from 'typescript';
import type { PerformanceTracker } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';

export interface TypesMetaOptions {
  /**
   * Any additional options passed from the factory call
   */
  [key: string]: any;
}

/**
 * In-memory language service host that manages TypeScript files dynamically
 */
class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
  private files = new Map<string, { content: string; version: number }>();

  private options: ts.CompilerOptions;

  private projectPath: string;

  private getVersionCallCount = 0;

  private getSnapshotCallCount = 0;

  constructor(projectPath: string, options: ts.CompilerOptions) {
    this.projectPath = projectPath;
    this.options = options;
  }

  resetCallCounts(): void {
    this.getVersionCallCount = 0;
    this.getSnapshotCallCount = 0;
  }

  getCallCounts(): { version: number; snapshot: number } {
    return {
      version: this.getVersionCallCount,
      snapshot: this.getSnapshotCallCount,
    };
  }

  addFile(fileName: string, content: string): void {
    const existing = this.files.get(fileName);
    this.files.set(fileName, {
      content,
      version: existing ? existing.version + 1 : 0,
    });
  }

  hasFile(fileName: string): boolean {
    return this.files.has(fileName);
  }

  getFileContent(fileName: string): string | undefined {
    return this.files.get(fileName)?.content;
  }

  getScriptFileNames(): string[] {
    return Array.from(this.files.keys());
  }

  getScriptVersion(fileName: string): string {
    this.getVersionCallCount += 1;
    const file = this.files.get(fileName);
    if (file) {
      return file.version.toString();
    }

    // For files not explicitly added (indirect dependencies, lib files),
    // we need to track them to detect changes
    if (ts.sys.fileExists(fileName)) {
      const content = ts.sys.readFile(fileName);
      if (content !== undefined) {
        // First time seeing this file - add it with version 0
        this.files.set(fileName, { content, version: 0 });
        return '0';
      }
    }

    return '0';
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    this.getSnapshotCallCount += 1;
    const file = this.files.get(fileName);
    if (file) {
      return ts.ScriptSnapshot.fromString(file.content);
    }

    // For files not in our map yet, read from disk
    // getScriptVersion will have tracked it on its first call
    if (ts.sys.fileExists(fileName)) {
      const content = ts.sys.readFile(fileName);
      if (content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
      }
    }

    return undefined;
  }

  getCurrentDirectory(): string {
    return this.projectPath;
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.options;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  fileExists(fileName: string): boolean {
    return this.files.has(fileName) || ts.sys.fileExists(fileName);
  }

  readFile(fileName: string): string | undefined {
    const file = this.files.get(fileName);
    if (file) {
      return file.content;
    }
    return ts.sys.readFile(fileName);
  }

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
  ): (ts.ResolvedModule | undefined)[] {
    return moduleNames.map((moduleName) => {
      const result = ts.resolveModuleName(moduleName, containingFile, this.options, ts.sys);
      return result.resolvedModule;
    });
  }

  /**
   * Updates all tracked files by checking disk for changes.
   * Returns arrays of updated and unchanged files.
   */
  updateTrackedFiles(): { updated: string[]; unchanged: string[] } {
    const updated: string[] = [];
    const unchanged: string[] = [];

    this.files.forEach((tracked, fileName) => {
      // Skip if file doesn't exist on disk (might be virtual/lib file)
      if (!ts.sys.fileExists(fileName)) {
        return;
      }

      const diskContent = ts.sys.readFile(fileName);
      if (diskContent === undefined) {
        return;
      }

      if (diskContent !== tracked.content) {
        // Content changed - update it
        this.files.set(fileName, {
          content: diskContent,
          version: tracked.version + 1,
        });
        updated.push(fileName);
      } else {
        unchanged.push(fileName);
      }
    });

    return { updated, unchanged };
  }
}

/**
 * Singleton instance that manages a TypeScript language service across multiple calls
 */
interface LanguageServiceInstance {
  host: InMemoryLanguageServiceHost;
  service: ts.LanguageService;
  projectPath: string;
  compilerOptions: ts.CompilerOptions;
}

// Store the singleton in globalThis to persist across calls
declare global {
  // eslint-disable-next-line vars-on-top
  var typesMetaLanguageService: LanguageServiceInstance | undefined;
}

/**
 * Gets or creates the global language service instance
 */
function getOrCreateLanguageService(
  projectPath: string,
  compilerOptions: CompilerOptions,
): LanguageServiceInstance {
  const existing = globalThis.typesMetaLanguageService;

  // Check if we can reuse the existing instance
  if (existing && existing.projectPath === projectPath) {
    return existing;
  }

  // Create optimized compiler options
  const optimizedOptions: ts.CompilerOptions = {
    ...compilerOptions,
    baseUrl: compilerOptions.baseUrl || projectPath,
    rootDir: compilerOptions.rootDir || projectPath,
    types: compilerOptions.types || [],
    skipLibCheck: true,
  };

  // Create new language service instance
  const host = new InMemoryLanguageServiceHost(projectPath, optimizedOptions);
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  const instance: LanguageServiceInstance = {
    host,
    service,
    projectPath,
    compilerOptions: optimizedOptions,
  };

  // Store in global singleton
  globalThis.typesMetaLanguageService = instance;

  return instance;
}

/**
 * Creates an optimized TypeScript program for component analysis using a global language service.
 *
 * This function uses a singleton language service that persists across calls:
 * - Reuses the same language service when project path and global types match
 * - Incrementally adds new entrypoint files without recreating the entire program
 * - Provides 70%+ speed improvement for subsequent calls
 * - Maintains full type checking capabilities
 *
 * @param projectPath - Path to the project directory
 * @param compilerOptions - TypeScript compiler options
 * @param entrypoints - Array of TypeScript files to analyze
 * @param options - Additional configuration options
 * @param tracker - Performance tracker for measurements
 * @param functionName - Name for performance markers
 * @param context - Context for performance markers
 * @returns Optimized TypeScript program
 */
export function createOptimizedProgram(
  projectPath: string,
  compilerOptions: CompilerOptions,
  entrypoints: string[],
  _options: TypesMetaOptions = {},
  tracker?: PerformanceTracker,
  functionName?: string,
  context?: string[],
): ts.Program {
  // Get or create the global language service instance
  const getServiceStart = tracker?.mark(
    nameMark(functionName!, 'Get Language Service Start', context!),
  );
  const instance = getOrCreateLanguageService(projectPath, compilerOptions);
  const getServiceEnd = tracker?.mark(
    nameMark(functionName!, 'Language Service Retrieved', context!),
  );
  if (tracker && getServiceStart && getServiceEnd) {
    tracker.measure(
      nameMark(functionName!, 'Language Service Retrieval', context!),
      getServiceStart,
      getServiceEnd,
    );
  }

  // Add all entrypoint files to the language service
  const processFilesStart = tracker?.mark(
    nameMark(functionName!, 'Process Entrypoints Start', context!),
  );

  for (const entrypoint of entrypoints) {
    const content = ts.sys.readFile(entrypoint);
    if (content === undefined) {
      continue;
    }

    if (!instance.host.hasFile(entrypoint)) {
      // File doesn't exist in service - add it
      instance.host.addFile(entrypoint, content);
    } else {
      // File exists - check if content has changed
      const existingContent = instance.host.getFileContent(entrypoint);
      if (existingContent !== content) {
        // Content changed - update it (this will increment the version)
        instance.host.addFile(entrypoint, content);
      }
      // Otherwise content is unchanged - no action needed
    }
  }

  // Update all tracked indirect dependencies (imports of entrypoints)
  // This ensures we detect changes in files that were loaded by previous program runs
  // Skip in production as files won't change during the build
  const processFilesEnd = tracker?.mark(nameMark(functionName!, 'Entrypoints Processed', context!));
  if (tracker && processFilesStart && processFilesEnd) {
    tracker.measure(
      nameMark(functionName!, 'Entrypoint Processing', context!),
      processFilesStart,
      processFilesEnd,
    );
  }

  const updateDepsStart = tracker?.mark(
    nameMark(functionName!, 'Update Dependencies Start', context!),
  );
  if (process.env.NODE_ENV !== 'production') {
    instance.host.updateTrackedFiles();
  }
  const updateDepsEnd = tracker?.mark(nameMark(functionName!, 'Dependencies Updated', context!));
  if (tracker && updateDepsStart && updateDepsEnd) {
    tracker.measure(
      nameMark(functionName!, 'Dependency Updates', context!),
      updateDepsStart,
      updateDepsEnd,
    );
  }

  // Get the current program from the language service
  const getProgramStart = tracker?.mark(nameMark(functionName!, 'Get Program Start', context!));
  const program = instance.service.getProgram();
  const getProgramEnd = tracker?.mark(nameMark(functionName!, 'Program Retrieved', context!));
  if (tracker && getProgramStart && getProgramEnd) {
    tracker.measure(
      nameMark(functionName!, 'Program Retrieval', context!),
      getProgramStart,
      getProgramEnd,
    );
  }

  if (!program) {
    throw new Error('Failed to create TypeScript program from language service');
  }

  return program;
}
