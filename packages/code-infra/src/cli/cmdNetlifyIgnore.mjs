#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {Object} Args
 * @property {string[]} workspaces - List of workspace names to process
 * @property {boolean} [check] - Check mode - error if the generated content differs from current
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { toPosixPath } from '../utils/path.mjs';
import { getWorkspacePackages } from '../utils/pnpm.mjs';

/**
 * Get all workspace dependencies (direct and transitive) from a package
 * @param {string} packageName - Package name
 * @param {Map<string, string>} workspaceMap - Map of workspace name to path
 * @param {Map<string, Promise<Set<string>>>} cache - Cache of package resolution promises
 * @returns {Promise<Set<string>>} Set of workspace package names (dependencies only, not including the package itself)
 */
async function getWorkspaceDependenciesRecursive(packageName, workspaceMap, cache) {
  // Check cache first
  const cached = cache.get(packageName);
  if (cached) {
    return cached;
  }

  // Create the resolution promise
  const promise = (async () => {
    const packagePath = workspaceMap.get(packageName);
    if (!packagePath) {
      throw new Error(`Workspace "${packageName}" not found in the repository`);
    }

    const packageJsonPath = path.join(packagePath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(content);

    // Collect all dependency names
    /** @type {Set<string>} */
    const allDeps = new Set();
    if (packageJson.dependencies) {
      Object.keys(packageJson.dependencies).forEach((dep) => allDeps.add(dep));
    }
    if (packageJson.devDependencies) {
      Object.keys(packageJson.devDependencies).forEach((dep) => allDeps.add(dep));
    }
    if (packageJson.peerDependencies) {
      Object.keys(packageJson.peerDependencies).forEach((dep) => allDeps.add(dep));
    }

    // Filter to only workspace dependencies
    const workspaceDeps = Array.from(allDeps).filter((dep) => workspaceMap.has(dep));

    // Recursively process workspace dependencies in parallel
    const recursiveResults = await Promise.all(
      workspaceDeps.map(async (dep) => {
        return getWorkspaceDependenciesRecursive(dep, workspaceMap, cache);
      }),
    );

    // Merge all results using flatMap
    return new Set(recursiveResults.flatMap((result) => Array.from(result)).concat(workspaceDeps));
  })();

  // Store in cache before returning
  cache.set(packageName, promise);

  return promise;
}

/**
 * Get transitive workspace dependencies for a list of workspace names
 * @param {string[]} workspaceNames - Array of workspace names
 * @param {Map<string, string>} workspaceMap - Map of workspace name to path
 * @returns {Promise<Set<string>>} Set of workspace package names (including requested packages and all their dependencies)
 */
async function getTransitiveDependencies(workspaceNames, workspaceMap) {
  // Shared cache for all workspace dependency resolution
  const cache = new Map();

  // Validate all workspace names exist
  for (const workspaceName of workspaceNames) {
    if (!workspaceMap.has(workspaceName)) {
      throw new Error(`Workspace "${workspaceName}" not found in the repository`);
    }
  }

  // Process each requested workspace in parallel
  const workspaceResults = await Promise.all(
    workspaceNames.map((workspaceName) =>
      getWorkspaceDependenciesRecursive(workspaceName, workspaceMap, cache),
    ),
  );

  // Merge all results using flatMap and add the original package names
  return new Set(workspaceNames.concat(workspaceResults.flatMap((result) => Array.from(result))));
}

/**
 * Generate the ignore command string for netlify.toml
 * @param {string[]} paths - Array of paths to include in the ignore command
 * @param {string} packagePath - Absolute path to the package directory
 * @param {string} workspaceRoot - Absolute path to the workspace root
 * @returns {string} The ignore command string
 */
function generateIgnoreCommand(paths, packagePath, workspaceRoot) {
  const relFromBase = `${toPosixPath(path.relative(packagePath, workspaceRoot))}/`;
  const pathsStr = paths.join(' ');
  return `  ignore = "cd ${relFromBase} && git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF ${pathsStr}"`;
}

/**
 * Update the netlify.toml file with the new ignore command
 * @param {string} tomlPath - Path to the netlify.toml file
 * @param {string} newIgnoreCommand - The new ignore command to set
 * @param {boolean} checkMode - If true, only check if update is needed
 * @returns {Promise<boolean>} True if file was updated, false otherwise
 */
async function updateNetlifyToml(tomlPath, newIgnoreCommand, checkMode = false) {
  // Read the netlify.toml file
  let tomlContent;
  try {
    tomlContent = await fs.readFile(tomlPath, 'utf8');
  } catch (/** @type {any} */ error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(
        `netlify.toml not found at ${tomlPath}. Ensure this workspace has a netlify.toml file before running this command.`,
      );
    }
    throw error;
  }

  // Replace the ignore line with our new command
  let didReplace = false;
  const updatedContent = tomlContent.replace(/^\s*ignore\s*=.*$/m, () => {
    didReplace = true;
    return newIgnoreCommand;
  });

  if (!didReplace) {
    throw new Error(
      `No ignore line found in ${tomlPath}. Please add an ignore line before running this command.`,
    );
  }

  // Check if content changed
  const hasChanges = tomlContent !== updatedContent;

  if (hasChanges) {
    if (checkMode) {
      throw new Error(`netlify.toml at ${tomlPath} needs updating. Run without --check to update.`);
    }
    await fs.writeFile(tomlPath, updatedContent, 'utf8');
    console.log(`Updated netlify.toml at ${tomlPath}`);
    return true;
  }

  console.log(`netlify.toml at ${tomlPath} is already up to date.`);
  return false;
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'netlify-ignore <workspaces...>',
  describe:
    'Update netlify.toml ignore property with transitive workspace dependencies for the specified workspaces',
  builder: (yargs) => {
    return yargs
      .positional('workspaces', {
        type: 'string',
        array: true,
        describe: 'List of workspace names to process',
        demandOption: true,
      })
      .option('check', {
        type: 'boolean',
        default: false,
        describe: 'Check if the netlify.toml needs updating without modifying it',
      })
      .example('$0 netlify-ignore @mui/internal-docs-infra', 'Update netlify.toml for a workspace')
      .example(
        '$0 netlify-ignore @mui/internal-docs-infra @mui/internal-code-infra',
        'Update netlify.toml for multiple workspaces',
      )
      .example(
        '$0 netlify-ignore @mui/internal-docs-infra --check',
        'Check if netlify.toml needs updating',
      );
  },
  handler: async (argv) => {
    const { workspaces, check = false } = argv;

    // Get the workspace root
    const workspaceRoot = await findWorkspaceDir(process.cwd());
    if (!workspaceRoot) {
      throw new Error('Could not find workspace root directory');
    }

    // Get all workspace packages and create workspace map
    const allWorkspaces = await getWorkspacePackages({ cwd: workspaceRoot });
    const workspaceMap = new Map(
      allWorkspaces.flatMap((workspace) =>
        workspace.name ? [[workspace.name, workspace.path]] : [],
      ),
    );

    // Process each workspace concurrently
    await Promise.all(
      workspaces.map(async (workspaceName) => {
        const workspacePath = workspaceMap.get(workspaceName);
        if (!workspacePath) {
          throw new Error(`Workspace "${workspaceName}" not found`);
        }

        const tomlPath = path.join(workspacePath, 'netlify.toml');

        console.log(`Processing ${workspaceName}...`);

        // Get transitive dependencies for this specific workspace
        const dependencyNames = await getTransitiveDependencies([workspaceName], workspaceMap);

        // Convert package names to relative paths (normalize to POSIX separators for git)
        const relativePaths = Array.from(dependencyNames)
          .map((packageName) => {
            const packagePath = workspaceMap.get(packageName);
            if (!packagePath) {
              return null;
            }
            const relativePath = path.relative(workspaceRoot, packagePath);
            // Normalize to POSIX separators for git and cross-platform compatibility
            const posixPath = toPosixPath(relativePath);
            return posixPath && !posixPath.startsWith('..') ? posixPath : null;
          })
          .filter((p) => p !== null)
          .sort();

        // Add pnpm-lock.yaml to the paths
        const allPaths = [...relativePaths, 'pnpm-lock.yaml'];

        // Generate the ignore command for this workspace
        const newIgnoreCommand = generateIgnoreCommand(allPaths, workspacePath, workspaceRoot);

        // Update or check the netlify.toml file
        await updateNetlifyToml(tomlPath, newIgnoreCommand, check);
      }),
    );
  },
});
