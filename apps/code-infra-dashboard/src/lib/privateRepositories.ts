import { Octokit } from '@octokit/rest';
import { unstable_cache } from 'next/cache';
import { repositories } from '@/constants';
import type { Repository } from '@/constants';
import { readSession } from './auth/session';
import { getOctokit } from './github';

/**
 * What a private repository gets, since none is configured in the (public) source: the CI report
 * comments only appear for repositories that upload reports.
 */
const PRIVATE_DEFAULTS = {
  packages: [],
  prComment: { bundleSize: true, benchmark: true },
  circleCi: { workflows: ['pipeline'] },
} satisfies Partial<Repository>;

function hasStatus(error: unknown, statuses: number[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    statuses.includes(error.status)
  );
}

async function fetchPrivateRepositories(): Promise<Repository[]> {
  const octokit = getOctokit();
  let installed;
  try {
    installed = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
      per_page: 100,
    });
  } catch (error) {
    // Only a GitHub App installation can list its repositories; deploys authenticated otherwise
    // (a token, or nothing) are refused and see the public repositories only. Anything else is
    // thrown, so that a passing GitHub failure isn't cached as "no private repositories".
    if (hasStatus(error, [401, 403])) {
      return [];
    }
    throw error;
  }
  return installed
    .filter((repo) => repo.private && repo.owner.login === 'mui')
    .map((repo) => ({
      owner: repo.owner.login,
      name: repo.name,
      displayName: repo.name,
      description: repo.description ?? '',
      ...PRIVATE_DEFAULTS,
    }));
}

/** The private repositories the dashboard's GitHub App is installed on. Server only. */
export const listPrivateRepositories = unstable_cache(
  fetchPrivateRepositories,
  ['private-repositories'],
  { revalidate: 3600 },
);

/** A public repository, or a private one the GitHub App is installed on. Server only. */
export async function findRepository(fullName: string): Promise<Repository | undefined> {
  return (
    repositories.get(fullName) ??
    (await listPrivateRepositories()).find((repo) => `${repo.owner}/${repo.name}` === fullName)
  );
}

/**
 * GitHub decides who sees a private repository: whoever its API lets read it with their token.
 * Any failure counts as no access, so that one repository's check can't fail a whole page.
 */
async function canRead(token: string, repo: Repository): Promise<boolean> {
  try {
    await new Octokit({ auth: token }).rest.repos.get({ owner: repo.owner, repo: repo.name });
    return true;
  } catch (error) {
    if (!hasStatus(error, [401, 403, 404])) {
      console.warn(`Could not check access to ${repo.owner}/${repo.name}:`, error);
    }
    return false;
  }
}

/**
 * The private repositories the visitor may see: none when signed out, else those GitHub lets them
 * read. Server only.
 */
export async function listViewablePrivateRepositories(): Promise<Repository[]> {
  const session = await readSession();
  if (!session) {
    return [];
  }
  const privateRepositories = await listPrivateRepositories();
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
  const publicRepository = repositories.get(fullName);
  if (publicRepository) {
    return publicRepository;
  }
  const session = await readSession();
  if (!session) {
    return undefined;
  }
  const repo = await findRepository(fullName);
  return repo && (await canRead(session.token, repo)) ? repo : undefined;
}
