import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';

export async function findTsConfig(cwd: string): Promise<string | undefined> {
  const filesToCheck = ['tsconfig.build.json', 'tsconfig.json'];

  for (const fileName of filesToCheck) {
    const filePath = path.join(cwd, fileName);
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(filePath, fs.constants.F_OK);
      return filePath;
    } catch {
      // Continue to next
    }
  }
  return undefined;
}

export async function findBabelConfigRoot(cwd: string): Promise<string | undefined> {
  // Check in current directory
  const localConfigs = [
    'babel.config.mjs',
    'babel.config.js',
    'babel.config.cjs',
    '.babelrc.js',
    '.babelrc.mjs',
  ];

  for (const config of localConfigs) {
    const configPath = path.join(cwd, config);
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(configPath, fs.constants.F_OK);
      return path.dirname(configPath);
    } catch {
      // Continue to next
    }
  }

  // Check in workspace root
  const workspaceRoot = await findWorkspaceDir(cwd);
  if (workspaceRoot && workspaceRoot !== cwd) {
    for (const config of localConfigs) {
      const configPath = path.join(workspaceRoot, config);
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.access(configPath, fs.constants.F_OK);
        return path.dirname(configPath);
      } catch {
        // Continue to next
      }
    }
  }

  return undefined;
}

export function generateBanner(packageInfo: {
  name: string;
  version: string;
  license?: string;
}): string {
  const lines = [`${packageInfo.name} v${packageInfo.version}`];

  if (packageInfo.license) {
    lines.push(`@license ${packageInfo.license}`);
  }

  return `/**\n * ${lines.join('\n * ')}\n */\n`;
}
