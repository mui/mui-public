/**
 * Args that resolve a committish to the commit it names.
 *
 * `^{commit}` peels an annotated tag to its commit: `git rev-parse v1.2.3` returns the tag *object*,
 * whose SHA is not the commit's, so the same commit reached by a tag and by its SHA would look like
 * two different builds. `--verify` turns an unknown ref into a non-zero exit rather than an echoed
 * argument.
 *
 * Shared because two callers resolve a ref — the ref resolver, and `packRef` to key its cache — and
 * they disagreed about this.
 */
export function revParseCommitArgs(ref: string): string[] {
  return ['rev-parse', '--verify', `${ref}^{commit}`];
}
