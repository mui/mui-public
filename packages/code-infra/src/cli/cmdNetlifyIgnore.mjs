#!/usr/bin/env node

/* eslint-disable no-console */

/**
 * @typedef {Object} Args
 * @property {string[]} workspaces - List of workspace names to process
 * @property {boolean} [check] - Check mode - error if the generated content differs from current
 */

import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';

/**
 * Get transitive workspace dependencies for a list of workspace names
 * @param {string[]} workspaceNames - Array of workspace names
 * @param {string} workspaceRoot - The workspace root directory
 * @returns {Promise<string[]>} Array of relative paths to workspace dependencies
 */
async function getTransitiveDependencies(workspaceNames, workspaceRoot) {
  const allDependencies = new Set();

  for (const workspaceName of workspaceNames) {
    try {
      // Get all dependencies for this workspace (including transitive)
      const result =
        await $`pnpm ls --filter ${workspaceName} --parseable --only-projects --depth Infinity`;
      const dependencies = result.stdout.trim().split('\n').filter(Boolean);

      // Convert absolute paths to relative paths from workspace root
      for (const absPath of dependencies) {
        const relativePath = path.relative(workspaceRoot, absPath);
        if (relativePath && !relativePath.startsWith('..')) {
          allDependencies.add(relativePath);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get dependencies for workspace "${workspaceName}": ${errorMessage}`);
    }
  }

  return Array.from(allDependencies).sort();
}

/**
 * Generate the ignore command string for netlify.toml
 * @param {string[]} relativePaths - Array of relative paths to workspace dependencies
 * @returns {string} The ignore command string
 */
function generateIgnoreCommand(relativePaths) {
  return `  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF ${relativePaths.join(' ')} pnpm-lock.yaml"`;
}

/**
 * Update the netlify.toml file with the new ignore command
 * @param {string} tomlPath - Path to the netlify.toml file
 * @param {string} newIgnoreCommand - The new ignore command to set
 * @param {boolean} checkMode - If true, only check if update is needed
 * @returns {Promise<{updated: boolean, message: string}>} Result of the update operation
 */
async function updateNetlifyToml(tomlPath, newIgnoreCommand, checkMode = false) {
  // Check if netlify.toml exists
  try {
    await fs.access(tomlPath);
  } catch {
    throw new Error(`netlify.toml not found at ${tomlPath}`);
  }

  // Read the netlify.toml file
  const tomlContent = await fs.readFile(tomlPath, 'utf8');

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

  if (checkMode) {
    if (hasChanges) {
      return {
        updated: false,
        message: `netlify.toml at ${tomlPath} needs updating. Run without --check to update.`,
      };
    }
    return {
      updated: false,
      message: `netlify.toml at ${tomlPath} is up to date.`,
    };
  }

  // Write the updated file
  if (hasChanges) {
    await fs.writeFile(tomlPath, updatedContent, 'utf8');
    return {
      updated: true,
      message: `Updated netlify.toml at ${tomlPath}`,
    };
  }

  return {
    updated: false,
    message: `netlify.toml at ${tomlPath} is already up to date.`,
  };
}

/**
 * Find the netlify.toml file for a workspace
 * @param {string} workspaceRoot - The workspace root directory
 * @param {string[]} workspaceNames - Array of workspace names to search
 * @returns {Promise<string>} Path to the netlify.toml file
 */
async function findNetlifyToml(workspaceRoot, workspaceNames) {
  // Try to find netlify.toml in each workspace first
  for (const workspaceName of workspaceNames) {
    try {
      const result = await $`pnpm -r ls --depth -1 -F ${workspaceName} --json`;
      const packageInfo = JSON.parse(result.stdout);

      if (packageInfo && packageInfo.length > 0 && packageInfo[0].path) {
        const packagePath = packageInfo[0].path;
        const tomlPath = path.join(packagePath, 'netlify.toml');

        try {
          await fs.access(tomlPath);
          return tomlPath;
        } catch {
          // Continue searching
        }
      }
    } catch {
      // Continue searching
    }
  }

  // Fall back to the workspace root
  const rootTomlPath = path.join(workspaceRoot, 'netlify.toml');
  try {
    await fs.access(rootTomlPath);
    return rootTomlPath;
  } catch {
    throw new Error(
      `netlify.toml not found in any of the specified workspaces (${workspaceNames.join(', ')}) or workspace root`,
    );
  }
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

    try {
      // Get the workspace root
      const workspaceRoot = await findWorkspaceDir(process.cwd());
      if (!workspaceRoot) {
        throw new Error('Could not find workspace root directory');
      }

      // Get transitive dependencies for all specified workspaces
      console.log(`Getting transitive dependencies for: ${workspaces.join(', ')}`);
      const relativePaths = await getTransitiveDependencies(workspaces, workspaceRoot);

      if (relativePaths.length === 0) {
        console.warn('Warning: No workspace dependencies found');
      } else {
        console.log(`Found ${relativePaths.length} workspace dependencies`);
      }

      // Generate the new ignore command
      const newIgnoreCommand = generateIgnoreCommand(relativePaths);

      // Find the netlify.toml file
      const tomlPath = await findNetlifyToml(workspaceRoot, workspaces);
      console.log(`Found netlify.toml at: ${tomlPath}`);

      // Update or check the netlify.toml file
      const result = await updateNetlifyToml(tomlPath, newIgnoreCommand, check);

      console.log(result.message);

      if (check && result.updated === false && result.message.includes('needs updating')) {
        // Exit with error code in check mode if update is needed
        process.exit(1);
      }

      if (result.updated) {
        console.log('\nUpdated dependencies:');
        relativePaths.forEach((p) => console.log(`  ${p}`));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMessage}`);
      process.exit(1);
    }
  },
});
