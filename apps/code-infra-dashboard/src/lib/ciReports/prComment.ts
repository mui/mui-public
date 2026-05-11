import { getOctokit } from '@/lib/github';

const COMMENT_MARKER = '<!-- ci-report-comment -->';

/**
 * Recursively searches for a comment containing the comment marker.
 * Searches page-by-page and stops when found or no more pages exist.
 */
async function findComment(owner: string, repoName: string, prNumber: number, page = 1) {
  const octokit = getOctokit();
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo: repoName,
    issue_number: prNumber,
    per_page: 100,
    page,
  });

  if (comments.length <= 0) {
    return null;
  }

  const found = comments.find((comment) => comment.body && comment.body.includes(COMMENT_MARKER));
  if (found) {
    return found;
  }

  return findComment(owner, repoName, prNumber, page + 1);
}

const pendingUpdates = new Map<string, Promise<void>>();

/**
 * Creates or updates the CI report comment on a pull request.
 *
 * Concurrent calls for the same PR are serialized to prevent race conditions.
 */
export function upsertPrComment(repo: string, prNumber: number, body: string): Promise<void> {
  const key = `${repo}/${prNumber}`;
  const prev = pendingUpdates.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => doUpsert(repo, prNumber, body))
    .finally(() => {
      if (pendingUpdates.get(key) === next) {
        pendingUpdates.delete(key);
      }
    });
  pendingUpdates.set(key, next);
  return next;
}

async function doUpsert(repo: string, prNumber: number, body: string): Promise<void> {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format. Expected "owner/repo", got "${repo}"`);
  }

  const octokit = getOctokit();
  const existingComment = await findComment(owner, repoName, prNumber);
  const commentBody = `${COMMENT_MARKER}\n\n${body}`;

  if (existingComment) {
    await octokit.issues.updateComment({
      owner,
      repo: repoName,
      comment_id: existingComment.id,
      body: commentBody,
    });
  } else {
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: commentBody,
    });
  }
}
