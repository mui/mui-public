import ts, { CompilerOptions } from 'typescript';
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs';
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
import type { PerformanceTracker } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';

export interface TypesMetaOptions {
  /**
   * Any additional options passed from the factory call
   */
  [key: string]: any;
}

/**
 * In-memory language service host that manages TypeScript files dynamically.
 *
 * Root files are replaced (not accumulated) on each call via `setRootFiles()`,
 * so the TypeScript program only contains the dependencies of the component
 * currently being analyzed. The file content cache (`files`) persists across
 * calls, allowing the DocumentRegistry to reuse parsed SourceFiles.
 *
 * Implements `getProjectVersion()` so the language service can skip per-file
 * version checks when nothing has changed.
 *
 * Uses filesystem watchers (one per directory) to detect changes efficiently
 * during development, instead of re-reading every tracked file from disk.
 */
class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
  /**
   * Content and version cache for ALL files (entrypoints + transitive dependencies).
   * Used by getScriptVersion and getScriptSnapshot to serve cached data.
   * Persists across calls so the DocumentRegistry can reuse parsed SourceFiles.
   */
  private files = new Map<string, { content: string; version: number }>();

  /**
   * Current entrypoints for this call. Replaced (not accumulated) on each
   * `createOptimizedProgram` invocation so the program only contains the
   * dependencies of the component currently being analyzed.
   */
  private rootFiles: string[] = [];

  /**
   * Monotonically increasing version string returned by `getProjectVersion()`.
   * TypeScript's language service checks this first — if unchanged it skips
   * per-file version checks entirely, avoiding O(n) `getScriptVersion` calls.
   */
  private projectVersion = 0;

  private options: ts.CompilerOptions;

  private projectPath: string;

  private getVersionCallCount = 0;

  private getSnapshotCallCount = 0;

  /** Set of file paths that have been flagged as changed by fs watchers */
  private changedFiles = new Set<string>();

  /** Active directory watchers, keyed by directory path */
  private dirWatchers = new Map<string, fs.FSWatcher>();

  /** Directories where watcher setup failed — these need polling fallback */
  private unwatchedDirs = new Set<string>();

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

  /**
   * Ensures a directory watcher exists for the given file's parent directory.
   * When any file in that directory changes, all tracked files in that directory
   * are added to the changedFiles set.
   *
   * If watcher setup fails, the directory is added to `unwatchedDirs` so
   * `updateChangedFiles` can fall back to polling for files in that directory.
   */
  private ensureWatcher(fileName: string): void {
    const dir = path.dirname(fileName);
    if (this.dirWatchers.has(dir) || this.unwatchedDirs.has(dir)) {
      return;
    }

    try {
      const watcher = fs.watch(dir, (eventType, changedName) => {
        if (!changedName) {
          return;
        }
        const changedPath = path.join(dir, changedName);
        // Only flag files we're actually tracking
        if (this.files.has(changedPath)) {
          this.changedFiles.add(changedPath);
        }
      });
      // Prevent the watcher from keeping the process alive
      watcher.unref();
      this.dirWatchers.set(dir, watcher);
    } catch {
      // Watcher setup failed — fall back to polling for this directory
      this.unwatchedDirs.add(dir);
    }
  }

  /**
   * Replaces the current root files with the given entrypoints.
   * Only bumps the project version when entrypoints or their contents change,
   * so the language service can skip per-file version checks on unchanged calls.
   */
  setRootFiles(entrypoints: string[]): void {
    let changed = entrypoints.length !== this.rootFiles.length;

    for (const fileName of entrypoints) {
      // Set up the watcher BEFORE reading so we don't miss changes
      // that happen between the read and the watch registration.
      this.ensureWatcher(fileName);

      const content = ts.sys.readFile(fileName);
      if (content === undefined) {
        continue;
      }

      const existing = this.files.get(fileName);
      if (existing && existing.content === content) {
        // Content unchanged — keep existing version so TS reuses SourceFile
        continue;
      }

      changed = true;
      this.files.set(fileName, {
        content,
        version: existing ? existing.version + 1 : 0,
      });
    }

    // Only bump if root file list or content actually changed
    if (changed || !this.rootFilesMatch(entrypoints)) {
      this.rootFiles = entrypoints;
      this.projectVersion += 1;
    }
  }

  /**
   * Checks whether the given entrypoints match the current root files (same order).
   */
  private rootFilesMatch(entrypoints: string[]): boolean {
    if (entrypoints.length !== this.rootFiles.length) {
      return false;
    }
    for (let i = 0; i < entrypoints.length; i += 1) {
      if (entrypoints[i] !== this.rootFiles[i]) {
        return false;
      }
    }
    return true;
  }

  getProjectVersion(): string {
    return this.projectVersion.toString();
  }

  getScriptFileNames(): string[] {
    return this.rootFiles;
  }

  getScriptVersion(fileName: string): string {
    this.getVersionCallCount += 1;
    const file = this.files.get(fileName);
    if (file) {
      return file.version.toString();
    }

    // For files not explicitly added (indirect dependencies, lib files),
    // cache their content for snapshot queries but do NOT add to rootFiles.
    // TypeScript discovers these through module resolution, not root file list.
    // Watch BEFORE read to avoid missing changes in between.
    if (ts.sys.fileExists(fileName)) {
      this.ensureWatcher(fileName);
      const content = ts.sys.readFile(fileName);
      if (content !== undefined) {
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
   * Updates files that have changed since the last call.
   *
   * For directories with active watchers, only re-reads files the OS flagged.
   * For directories where watchers failed, polls all tracked files in those
   * directories to detect changes (fallback behavior).
   */
  updateChangedFiles(): { updated: string[]; unchanged: number } {
    const updated: string[] = [];

    // Poll files in unwatched directories — these need a full check
    if (this.unwatchedDirs.size > 0) {
      this.files.forEach((tracked, fileName) => {
        const dir = path.dirname(fileName);
        if (!this.unwatchedDirs.has(dir)) {
          return;
        }
        // Add to changedFiles so the same update logic handles it below
        this.changedFiles.add(fileName);
      });
    }

    // Drain the changed set — re-read flagged files
    this.changedFiles.forEach((fileName) => {
      const tracked = this.files.get(fileName);
      if (!tracked) {
        return;
      }

      const diskContent = ts.sys.readFile(fileName);
      if (diskContent === undefined) {
        return;
      }

      if (diskContent !== tracked.content) {
        this.files.set(fileName, {
          content: diskContent,
          version: tracked.version + 1,
        });
        updated.push(fileName);
      }
    });

    const unchangedCount = this.changedFiles.size - updated.length;
    this.changedFiles.clear();

    return { updated, unchanged: unchangedCount };
  }

  /**
   * Closes all directory watchers. Call when the language service is no longer needed.
   */
  closeWatchers(): void {
    this.dirWatchers.forEach((watcher) => {
      watcher.close();
    });
    this.dirWatchers.clear();
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

  // Dispose previous instance to avoid leaking watchers and TS language service state
  if (existing) {
    existing.host.closeWatchers();
    existing.service.dispose();
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
 * - Reuses the same language service and DocumentRegistry across calls
 * - Sets root files to only the current entrypoints (not accumulated)
 * - Caches file contents so the DocumentRegistry can reuse parsed SourceFiles
 * - Components with heavy dependencies (e.g. date-fns) don't slow down other components
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

  // Set root files to only the current entrypoints (not accumulated)
  // The language service reuses cached SourceFiles from the DocumentRegistry
  const processFilesStart = tracker?.mark(
    nameMark(functionName!, 'Process Entrypoints Start', context!),
  );

  instance.host.setRootFiles(entrypoints);

  // Update files that filesystem watchers have flagged as changed
  if (process.env.NODE_ENV !== 'production') {
    instance.host.updateChangedFiles();
  }

  const processFilesEnd = tracker?.mark(nameMark(functionName!, 'Entrypoints Processed', context!));
  if (tracker && processFilesStart && processFilesEnd) {
    tracker.measure(
      nameMark(functionName!, 'Entrypoint Processing', context!),
      processFilesStart,
      processFilesEnd,
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
