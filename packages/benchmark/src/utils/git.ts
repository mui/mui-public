import { execa } from 'execa';

/**
 * Resolves a committish to the commit it names.
 *
 * `^{commit}` peels an annotated tag to its commit: `git rev-parse v1.2.3` returns the tag *object*,
 * whose SHA is not the commit's, so the same commit reached by a tag and by its SHA would look like
 * two different builds. `--verify` turns an unknown ref into a non-zero exit rather than an echoed
 * argument.
 *
 * Shared because two callers resolve a ref — the baseline, and `packRef` to key its cache — and a
 * commit they disagreed about would be built twice.
 */
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
