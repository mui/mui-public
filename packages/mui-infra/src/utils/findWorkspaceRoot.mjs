import * as path from 'node:path';
import * as url from 'node:url';
import * as fs from 'node:fs';

function findUpFile(fileName, cwd = process.cwd(), maxIterations = 5) {
  const pathName = path.join(cwd, fileName);
  if (fs.existsSync(pathName)) {
    return pathName;
  }
  if (maxIterations === 0) {
    return null;
  }
  return findUpFile(fileName, path.dirname(cwd), maxIterations - 1);
}

/**
 * Returns the full path of the root directory of the monorepo.
 */
export function findWorkspaceRoot() {
  // Use this when available. Avoids the need to check for the workspace file.
  if (process.env.NX_WORKSPACE_ROOT) {
    return process.env.NX_WORKSPACE_ROOT;
  }

  const workspaceFilePath = findUpFile('pnpm-workspace.yaml', process.cwd());
  if (workspaceFilePath) {
    return path.dirname(workspaceFilePath);
  }

  const currentDirectory = url.fileURLToPath(new URL('.', import.meta.url));
  const workspaceRoot = path.resolve(currentDirectory, '..');
  return workspaceRoot;
}
