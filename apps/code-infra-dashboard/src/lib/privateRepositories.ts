import { Octokit } from '@octokit/rest';
import { repositories } from '@/constants';
import type { Repository } from '@/constants';
import { describeGitHubError } from './auth/describeGitHubError';
import { readSession } from './auth/session';
import { httpStatus } from '../utils/http';

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
    if (httpStatus(error) !== 404) {
      console.warn(
        `Could not confirm access to ${repo.owner}/${repo.name}: ${describeGitHubError(error)}`,
      );
    }
    return false;
  }
}

/**
 * The `candidates` the visitor may see: every public one, plus the private ones GitHub lets them
 * read (none when signed out). Server only.
 */
export async function listViewableRepositories(candidates: Repository[]): Promise<Repository[]> {
  const privateRepositories = candidates.filter((repo) => !repo.isPublic);
  const session = privateRepositories.length > 0 ? await readSession() : null;
  const readable = session
    ? await Promise.all(privateRepositories.map((repo) => canRead(session.token, repo)))
    : [];
  return candidates.filter((repo) => repo.isPublic || readable[privateRepositories.indexOf(repo)]);
}

/**
 * The repository, if the visitor may see its data: any public one, or a private one GitHub lets
 * them read. `undefined` otherwise, so that callers can't tell a private repository from one
 * that doesn't exist. Server only.
 */
export async function findViewableRepository(fullName: string): Promise<Repository | undefined> {
  const repo = repositories.get(fullName);
  return repo && (await listViewableRepositories([repo]))[0];
}
