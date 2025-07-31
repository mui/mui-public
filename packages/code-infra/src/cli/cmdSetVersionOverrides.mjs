/**
 * Given a version specifier (dist-tag, range, exact version) fetch the exact
 * version and make sure this version is used throughout the repository.
 *
 * If you work on this file:
 * WARNING: This script can only use built-in modules since it has to run before
 * `pnpm install`
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Run a shell command
 * @param {string} cmdString - The full command string, e.g. 'pnpm install'
 * @param {object} [options] - Optional spawn options.
 * @returns {Promise<number>} - Resolves with exit code 0, rejects otherwise.
 */
function execute(cmdString, stream) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmdString, {
      shell: true,
      stdio: 'pipe',
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      if (stream) {
        process.stdout.write(chunk);
      }
      output += chunk.toString();
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stream) {
        process.stderr.write(chunk);
      }
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(
          Object.assign(new Error(`Command failed: ${cmdString}\n${stderr}`), { code, stderr }),
        );
      }
    });
  });
}

function getMajor(version) {
  const [major] = version.split('.');
  return Number(major);
}

async function resolveVersionSpec(pkg, specifier) {
  return execute(`pnpm info ${pkg}@${specifier} version`);
}

async function findDependencyVersion(pkg, specifier, dependency) {
  const spec = await execute(`pnpm info ${pkg}@${specifier} dependencies.${dependency}`);
  return resolveVersionSpec(dependency, spec);
}

async function main(versions) {
  const overrides = {};

  if (versions.react && versions.react !== 'stable') {
    overrides.react = await resolveVersionSpec('react', versions.react);
    overrides['react-dom'] = await resolveVersionSpec('react-dom', versions.react);
    overrides['react-is'] = await resolveVersionSpec('react-is', versions.react);
    overrides.scheduler = await findDependencyVersion('react-dom', versions.react, 'scheduler');

    const reactMajor = getMajor(overrides.react);
    if (reactMajor === 17) {
      overrides['@testing-library/react'] = await resolveVersionSpec(
        '@testing-library/react',
        '^12.1.0',
      );
    }
  }

  if (versions.typescript && versions.typescript !== 'stable') {
    overrides.typescript = await resolveVersionSpec('typescript', versions.typescript);
  }

  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, { encoding: 'utf8' }));
  Object.assign(packageJson.resolutions, overrides);
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}${os.EOL}`);

  console.log(`Using versions: ${JSON.stringify(overrides, null, 2)}`);

  if (Object.keys(overrides).length <= 0) {
    return;
  }

  await execute(`pnpm dedupe`, { stdio: 'inherit' });
}

main({
  react: process.env.REACT_VERSION,
  typescript: process.env.TYPESCRIPT_VERSION,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
