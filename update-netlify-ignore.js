#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Get the package name from command line arguments
const packageName = process.argv[2];

if (!packageName) {
  console.error(
    'Error: Package name is required. Usage: node update-netlify-ignore.js <package-name>',
  );
  process.exit(1);
}

const workspaceRoot = __dirname;

// Find the package directory using pnpm
try {
  const packageInfo = JSON.parse(
    execSync(`pnpm -r ls --depth -1 -F ${packageName} --json`, {
      encoding: 'utf8',
    }),
  );

  if (!packageInfo || packageInfo.length === 0 || !packageInfo[0].path) {
    throw new Error(`Package ${packageName} not found`);
  }

  const packagePath = packageInfo[0].path;

  // Get the package dependencies
  const dependencies = execSync(`pnpm ls --filter ${packageName} --parseable --only-projects`, {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');

  // Convert absolute paths to relative paths from workspace root
  const relativePaths = dependencies.map((absPath) => path.relative(workspaceRoot, absPath));

  // Path to the netlify.toml file
  const tomlPath = path.join(packagePath, 'netlify.toml');

  // Check if netlify.toml exists
  if (!fs.existsSync(tomlPath)) {
    console.error(`Error: netlify.toml not found in ${packagePath}`);
    process.exit(1);
  }

  // Read the netlify.toml file
  const tomlContent = fs.readFileSync(tomlPath, 'utf8');

  // Replace the ignore line with our new command using relative paths
  const updatedContent = tomlContent.replace(
    /^\s*ignore\s*=.*$/m,
    `  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF ${relativePaths.join(' ')} pnpm-*.yaml"`,
  );

  // Write the updated file
  fs.writeFileSync(tomlPath, updatedContent);

  // eslint-disable-next-line no-console
  console.log(`Updated netlify.toml for ${packageName} with relative dependencies:`);
  // eslint-disable-next-line no-console
  console.log(relativePaths.join('\n'));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
