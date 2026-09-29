import { execa } from 'execa';

/** Resolves a committish to the commit it names, peeling an annotated tag to its commit. */
export async function resolveCommit(repoRoot: string, ref: string): Promise<string> {
  const result = await execa('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not resolve git ref "${ref}": ${String(result.stderr).trim()}`);
  }
  return result.stdout.trim();
}
