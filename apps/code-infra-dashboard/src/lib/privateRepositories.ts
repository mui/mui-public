import { Octokit } from '@octokit/rest';
import { repositories } from '@/constants';
import type { Repository } from '@/constants';
import { describeGitHubError } from './auth/describeGitHubError';
import { readSession } from './auth/session';

/**
 * GitHub decides who sees a private repository: whoever its API lets read it with their token.
 * Any failure counts as no access, so that one repository's check can't fail a whole page.
 */
async function canRead(token: string, repo: Repository): Promise<boolean> {
  try {
    await new Octokit({ auth: token }).rest.repos.get({ owner: repo.owner, repo: repo.name });
    return true;
  } catch (error) {
    // GitHub answers 404 for a repository the token can't read.
    if (!(error instanceof Error && 'status' in error && error.status === 404)) {
      console.warn(
        `Could not confirm access to ${repo.owner}/${repo.name}: ${describeGitHubError(error)}`,
      );
    }
    return false;
  }
}

/**
 * The private repositories among `candidates` that the visitor may see: none when signed out,
 * else those GitHub lets them read. Server only.
 */
export async function listViewablePrivateRepositories(
  candidates: Repository[],
): Promise<Repository[]> {
  const privateRepositories = candidates.filter((repo) => !repo.isPublic);
  const session = privateRepositories.length > 0 ? await readSession() : null;
  if (!session) {
    return [];
  }
  const readable = await Promise.all(
    privateRepositories.map((repo) => canRead(session.token, repo)),
  );
  return privateRepositories.filter((repo, index) => readable[index]);
}

/**
 * The repository, if the visitor may see its data: any public one, or a private one GitHub lets
 * them read. `undefined` otherwise, so that callers can't tell a private repository from one
 * that doesn't exist. Server only.
 */
export async function findViewableRepository(fullName: string): Promise<Repository | undefined> {
  const repo = repositories.get(fullName);
  if (!repo || repo.isPublic) {
    return repo;
  }
  const [viewable] = await listViewablePrivateRepositories([repo]);
  return viewable;
}
