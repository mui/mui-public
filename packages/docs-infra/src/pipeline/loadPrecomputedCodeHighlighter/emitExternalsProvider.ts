import { writeFile, mkdir, access, readFile, constants } from 'fs/promises';
import { dirname, join, relative, basename, parse } from 'path';

export interface LoaderContext {
  resourcePath: string;
  addDependency(dependency: string): void;
  emitFile?(name: string, content: string): void;
}

export interface ExternalsProviderInfo {
  fileName: string;
  content: string;
  relativePath: string;
}

/**
 * Creates a relative import path from source file to target file
 */
function createRelativePath(fromFile: string, toFile: string): string {
  const relativePath = relative(dirname(fromFile), toFile);
  // Ensure the path starts with ./ for relative imports
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

/**
 * Creates a structured path for generated externals files based on the source file location
 * Example: app/components/checkbox/demos/basic/index.ts -> generated/demo-externals/app/components/checkbox/demos/basic.tsx
 */
async function createGeneratedFilePath(
  resourcePath: string,
  projectRoot: string,
): Promise<{ filePath: string; relativePath: string }> {
  // Remove the project root from the resource path to get the relative path
  const relativePath = resourcePath.replace(projectRoot, '').replace(/^\//, '');

  // Parse the path to determine the target filename
  const parsedPath = parse(relativePath);
  let targetFilename: string;
  let targetDir: string;

  // If the file is named 'index', use the parent directory name instead
  if (parsedPath.name === 'index') {
    const parentDir = basename(parsedPath.dir);
    targetFilename = `${parentDir}.tsx`;
    // Remove the last directory level since we're using it as the filename
    targetDir = dirname(parsedPath.dir);
  } else {
    targetFilename = `${parsedPath.name}.tsx`;
    targetDir = parsedPath.dir;
  }

  // Create the generated file path
  const generatedFilePath = join(
    projectRoot,
    'generated',
    'demo-externals',
    targetDir,
    targetFilename,
  );

  // Create relative import path from source file to generated file
  const relativeImportPath = createRelativePath(resourcePath, generatedFilePath);

  return {
    filePath: generatedFilePath,
    relativePath: relativeImportPath,
  };
}

/**
 * Determines the appropriate build directory for temporary files
 * to avoid checking generated files into source control.
 */
async function getBuildDirectory(resourcePath: string): Promise<string> {
  const projectRoot = await findProjectRoot(resourcePath);

  // Common build directory patterns, in order of preference
  const buildDirs = [
    '.next/cache/externals', // Next.js cache directory
    '.turbo/cache/externals', // Turbopack cache directory
    'node_modules/.cache/mui-docs-infra/externals', // Node modules cache
    '.cache/mui-docs-infra/externals', // Generic cache directory
  ];

  // Recursive function to try each directory
  const tryDirectories = async (dirs: string[], index = 0): Promise<string | null> => {
    if (index >= dirs.length) {
      return null;
    }

    const buildDir = dirs[index];
    const fullPath = join(projectRoot, buildDir);

    try {
      // Try to create the directory - if successful, use it
      await mkdir(fullPath, { recursive: true });
      return fullPath;
    } catch {
      // Try the next directory
      return tryDirectories(dirs, index + 1);
    }
  };

  // Try each directory in sequence
  const result = await tryDirectories(buildDirs);
  if (result) {
    return result;
  }

  // Fallback to .cache directory in project root
  const fallbackDir = join(projectRoot, '.cache/mui-docs-infra/externals');
  await mkdir(fallbackDir, { recursive: true });
  return fallbackDir;
}

/**
 * Finds the project root by looking for 'app' directory or common project markers
 */
async function findProjectRoot(startPath: string): Promise<string> {
  const rootDir = '/'; // Unix filesystem root

  // Helper function to check if a path exists
  const pathExists = async (path: string): Promise<boolean> => {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  };

  // Recursive function to search upwards
  const searchUpwards = async (
    currentDir: string,
    searchFn: (dir: string) => Promise<boolean>,
  ): Promise<string | null> => {
    if (currentDir === rootDir) {
      return null;
    }

    if (await searchFn(currentDir)) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      return null;
    }

    return searchUpwards(parentDir, searchFn);
  };

  const startDir = dirname(startPath);

  // First, try to find the 'app' directory
  const appDirResult = await searchUpwards(startDir, async (dir) => {
    const appPath = join(dir, 'app');
    return pathExists(appPath);
  });

  if (appDirResult) {
    return appDirResult;
  }

  // If 'app' directory not found, look for other project markers
  const markersResult = await searchUpwards(startDir, async (dir) => {
    const markers = ['package.json', '.git', 'next.config.js', 'next.config.mjs', 'turbo.json'];

    // Check if any marker exists in this directory
    const checks = await Promise.all(markers.map((marker) => pathExists(join(dir, marker))));

    return checks.some((exists) => exists);
  });

  if (markersResult) {
    return markersResult;
  }

  // Fallback to directory containing the source file
  return dirname(startPath);
}

/**
 * Ensures that the generated demo externals directory is added to .gitignore
 * to prevent accidentally committing these generated files.
 */
async function ensureGitignoreEntry(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entryToAdd = '/generated/demo-externals';
  const whitelistPattern = '!/generated/demo-externals';
  const whitelistComment = '# mui-docs-infra: allow generated demo externals';

  let gitignoreContent = '';
  let needsUpdate = false;
  let isExplicitlyWhitelisted = false;

  // Check if .gitignore exists and read it
  let gitignoreExists = false;
  try {
    await access(gitignorePath, constants.F_OK);
    gitignoreExists = true;
  } catch {
    // File doesn't exist
    gitignoreExists = false;
  }

  if (gitignoreExists) {
    try {
      gitignoreContent = await readFile(gitignorePath, 'utf8');

      // Check if the user has explicitly whitelisted the directory
      const lines = gitignoreContent.split('\n');
      isExplicitlyWhitelisted = lines.some((line) => {
        const trimmed = line.trim();
        return (
          trimmed === whitelistPattern ||
          trimmed === whitelistComment ||
          trimmed.includes('mui-docs-infra: allow generated demo externals')
        );
      });

      if (!isExplicitlyWhitelisted) {
        // Check if the ignore entry already exists
        const hasIgnoreEntry = lines.some((line) => {
          const trimmed = line.trim();
          return (
            trimmed === entryToAdd ||
            trimmed === 'generated/demo-externals' ||
            trimmed === '/generated/demo-externals/' ||
            trimmed === 'generated/demo-externals/'
          );
        });

        if (!hasIgnoreEntry) {
          needsUpdate = true;
        }
      }
    } catch {
      // If we can't read the file, we'll create a new one (unless explicitly whitelisted)
      if (!isExplicitlyWhitelisted) {
        needsUpdate = true;
      }
    }
  } else {
    // No .gitignore exists, we need to create one
    needsUpdate = true;
  }

  if (needsUpdate && !isExplicitlyWhitelisted) {
    // Add the entry to .gitignore
    const newContent = gitignoreContent
      ? `${gitignoreContent.endsWith('\n') ? '' : '\n'}${entryToAdd}\n`
      : `${entryToAdd}\n`;

    try {
      await writeFile(gitignorePath, gitignoreContent + newContent);

      console.warn(
        `[mui-docs-infra] Added '${entryToAdd}' to .gitignore to prevent committing generated externals files. ` +
          `If you want to commit these files, add '${whitelistPattern}' or '${whitelistComment}' to your .gitignore.`,
      );
    } catch (error) {
      console.warn(
        `[mui-docs-infra] Could not update .gitignore file at ${gitignorePath}. ` +
          `Consider manually adding '${entryToAdd}' to prevent committing generated files. Error: ${error}`,
      );
    }
  }
}

/**
 * Emits an externals provider file using the best available method:
 * 1. Use emitFile if available (webpack)
 * 2. Fall back to structured filesystem writing to generated/demo-externals/ (turbopack/other bundlers)
 *
 * @param loaderContext - The loader context with emitFile capability
 * @param externalsProviderInfo - The externals provider file information
 * @returns The import path to use for the generated file
 */
export async function emitExternalsProvider(
  loaderContext: LoaderContext,
  externalsProviderInfo: ExternalsProviderInfo,
): Promise<string> {
  // Method 1: Use emitFile if available (webpack)
  if (loaderContext.emitFile) {
    // Extract just the filename from the full path
    const fileName =
      externalsProviderInfo.fileName.split('/').pop() || externalsProviderInfo.fileName;
    loaderContext.emitFile(fileName, externalsProviderInfo.content);

    // Return the relative path for import
    return externalsProviderInfo.relativePath;
  }

  // Method 2: Fall back to structured filesystem writing
  const projectRoot = await findProjectRoot(loaderContext.resourcePath);
  const { filePath: generatedFilePath, relativePath } = await createGeneratedFilePath(
    loaderContext.resourcePath,
    projectRoot,
  );

  // Ensure the directory exists
  await mkdir(dirname(generatedFilePath), { recursive: true });

  // Ensure .gitignore includes the generated directory
  await ensureGitignoreEntry(projectRoot);

  // Write the externals provider file
  await writeFile(generatedFilePath, externalsProviderInfo.content);

  // Add dependency so bundler watches for changes
  loaderContext.addDependency(generatedFilePath);

  return relativePath;
}

// Export helper functions for testing
export const testHelpers = {
  createRelativePath,
  createGeneratedFilePath,
  getBuildDirectory,
  findProjectRoot,
  ensureGitignoreEntry,
};
