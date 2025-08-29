// @ts-check

import { octokit } from './github.js';

/**
 * Recursively searches for a comment containing the specified marker.
 * Searches page-by-page (newest first) and stops when found or no more pages exist.
 *
 * @param {string} owner - Repository owner
 * @param {string} repoName - Repository name
 * @param {number} prNumber - Pull request number
 * @param {string} marker - HTML comment marker to search for
 * @param {number} page - Current page number (default: 1)
 */
async function findCommentByMarker(owner, repoName, prNumber, marker, page = 1) {
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo: repoName,
    issue_number: prNumber,
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
    page,
  });

  // Base case: no comments on this page
  if (comments.length <= 0) {
    return null;
  }

  // Success case: found comment with marker
  const foundComment = comments.find((comment) => comment.body && comment.body.includes(marker));
  if (foundComment) {
    return foundComment;
  }

  return findCommentByMarker(owner, repoName, prNumber, marker, page + 1);
}

/**
 * Creates or updates a comment on a pull request with the specified content.
 * Uses an HTML comment marker to identify and update existing comments.
 * Searches page-by-page (newest first) and stops early when comment is found.
 *
 * @param {string} repo - The repository in format "owner/repo"
 * @param {number} prNumber - The pull request number
 * @param {string} id - Unique identifier to mark the comment for future updates
 * @param {string} content - The content to post or update in the comment
 * @returns {Promise<void>}
 */
export async function notifyPr(repo, prNumber, id, content) {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format. Expected "owner/repo", got "${repo}"`);
  }

  const marker = `<!-- bundle-size-checker-id: ${id} -->`;
  const commentBody = `${marker}\n${content}`;

  // Search for existing comment with our marker
  const existingComment = await findCommentByMarker(owner, repoName, prNumber, marker);

  if (existingComment) {
    // Update existing comment
    await octokit.issues.updateComment({
      owner,
      repo: repoName,
      comment_id: existingComment.id,
      body: commentBody,
    });
  } else {
    // Create new comment
    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: commentBody,
    });
  }
}
