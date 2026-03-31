import { getOctokit } from '@/lib/github';

const COMMENT_MARKER = '<!-- ci-report-comment -->';
const SECTION_REGEX = /<!-- section:(\w+) -->\n([\s\S]*?)<!-- \/section:\1 -->/g;

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  for (const match of body.matchAll(SECTION_REGEX)) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
}

function renderSections(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([id, content]) => `<!-- section:${id} -->\n${content}\n<!-- /section:${id} -->`)
    .join('\n\n');
}

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
 * Creates or updates a comment on a pull request with section-based content.
 * Each section is independently updatable — only the provided sections are
 * modified, others are preserved.
 *
 * Concurrent calls for the same PR are serialized to prevent race conditions.
 */
export function upsertPrComment(
  repo: string,
  prNumber: number,
  sections: Record<string, string>,
): Promise<void> {
  const key = `${repo}/${prNumber}`;
  const prev = pendingUpdates.get(key) ?? Promise.resolve();
  const next = prev.finally(() => doUpsert(repo, prNumber, sections));
  pendingUpdates.set(key, next);
  return next;
}

async function doUpsert(
  repo: string,
  prNumber: number,
  sections: Record<string, string>,
): Promise<void> {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format. Expected "owner/repo", got "${repo}"`);
  }

  const octokit = getOctokit();
  const existingComment = await findComment(owner, repoName, prNumber);

  if (existingComment) {
    const existingSections = parseSections(existingComment.body ?? '');
    const mergedSections = { ...existingSections, ...sections };
    const body = `${COMMENT_MARKER}\n\n${renderSections(mergedSections)}`;

    await octokit.issues.updateComment({
      owner,
      repo: repoName,
      comment_id: existingComment.id,
      body,
    });
  } else {
    const body = `${COMMENT_MARKER}\n\n${renderSections(sections)}`;

    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body,
    });
  }
}
