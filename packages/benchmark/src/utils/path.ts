import { access } from 'node:fs/promises';

/** True if `target` exists on disk. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
