import { getOctokit } from '@/lib/github';

/**
 * Recursively searches for a comment containing the specified marker.
 * Searches page-by-page (newest first) and stops when found or no more pages exist.
 */
async function findCommentByMarker(
  owner: string,
  repoName: string,
  prNumber: number,
  marker: string,
  page = 1,
) {
  const octokit = getOctokit();
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo: repoName,
    issue_number: prNumber,
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
    page,
  });

  if (comments.length <= 0) {
    return null;
  }

  const foundComment = comments.find((comment) => comment.body && comment.body.includes(marker));
  if (foundComment) {
    return foundComment;
  }

  return findCommentByMarker(owner, repoName, prNumber, marker, page + 1);
}

/**
 * Creates or updates a comment on a pull request with the specified content.
 * Uses an HTML comment marker to identify and update existing comments.
 */
export async function upsertPrComment(
  repo: string,
  prNumber: number,
  markerId: string,
  body: string,
): Promise<void> {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format. Expected "owner/repo", got "${repo}"`);
  }

  const marker = `<!-- bundle-size-checker-id: ${markerId} -->`;
  const commentBody = `${marker}\n${body}`;

  const existingComment = await findCommentByMarker(owner, repoName, prNumber, marker);

  const octokit = getOctokit();
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
