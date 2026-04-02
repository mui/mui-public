import { getOctokit } from '@/lib/github';

const COMMENT_MARKER = '<!-- ci-report-comment -->';
const SECTION_REGEX = /<!-- section:(\w+) -->\n([\s\S]*?)<!-- \/section:\1 -->/g;
const HEADER_REGEX = /<!-- header -->\n([\s\S]*?)<!-- \/header -->/;
const FOOTER_REGEX = /<!-- footer -->\n([\s\S]*?)<!-- \/footer -->/;

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  for (const match of body.matchAll(SECTION_REGEX)) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
}

function parseHeader(body: string): string | null {
  const match = HEADER_REGEX.exec(body);
  return match ? match[1].trim() : null;
}

function parseFooter(body: string): string | null {
  const match = FOOTER_REGEX.exec(body);
  return match ? match[1].trim() : null;
}

function renderComment(
  header: string | null,
  sections: Record<string, string>,
  footer: string | null,
): string {
  const parts: string[] = [COMMENT_MARKER];

  if (header) {
    parts.push(`<!-- header -->\n${header}\n<!-- /header -->`);
  }

  const sectionEntries = Object.entries(sections);
  if (sectionEntries.length > 0) {
    parts.push(
      sectionEntries
        .map(([id, content]) => `<!-- section:${id} -->\n${content}\n<!-- /section:${id} -->`)
        .join('\n\n'),
    );
  }

  if (footer) {
    parts.push(`<!-- footer -->\n${footer}\n<!-- /footer -->`);
  }

  return parts.join('\n\n');
}

let cachedBotLogin: string | null = null;

async function getBotLogin(): Promise<string> {
  if (cachedBotLogin) {
    return cachedBotLogin;
  }
  const octokit = getOctokit();
  const { data: user } = await octokit.users.getAuthenticated();
  cachedBotLogin = user.login;
  return cachedBotLogin;
}

/**
 * Recursively searches for a comment containing the comment marker that was
 * authored by the authenticated bot. Searches page-by-page and stops when
 * found or no more pages exist.
 */
async function findComment(owner: string, repoName: string, prNumber: number, page = 1) {
  const octokit = getOctokit();
  const botLogin = await getBotLogin();
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

  const found = comments.find(
    (comment) =>
      comment.user?.login === botLogin && comment.body && comment.body.includes(COMMENT_MARKER),
  );
  if (found) {
    return found;
  }

  return findComment(owner, repoName, prNumber, page + 1);
}

export interface UpsertPrCommentOptions {
  header?: string;
  footer?: string;
  defaultSections?: Record<string, string>;
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
  options?: UpsertPrCommentOptions,
): Promise<void> {
  const key = `${repo}/${prNumber}`;
  const prev = pendingUpdates.get(key) ?? Promise.resolve();
  const next = prev
    .finally(() => doUpsert(repo, prNumber, sections, options))
    .finally(() => {
      if (pendingUpdates.get(key) === next) {
        pendingUpdates.delete(key);
      }
    });
  pendingUpdates.set(key, next);
  return next;
}

async function doUpsert(
  repo: string,
  prNumber: number,
  sections: Record<string, string>,
  options?: UpsertPrCommentOptions,
): Promise<void> {
  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format. Expected "owner/repo", got "${repo}"`);
  }

  const octokit = getOctokit();
  const existingComment = await findComment(owner, repoName, prNumber);

  if (existingComment) {
    const existingBody = existingComment.body ?? '';
    const existingSections = parseSections(existingBody);
    const mergedSections = {
      ...options?.defaultSections,
      ...existingSections,
      ...sections,
    };
    const mergedHeader = options?.header ?? parseHeader(existingBody);
    const mergedFooter = options?.footer ?? parseFooter(existingBody);

    await octokit.issues.updateComment({
      owner,
      repo: repoName,
      comment_id: existingComment.id,
      body: renderComment(mergedHeader, mergedSections, mergedFooter),
    });
  } else {
    const mergedSections = { ...options?.defaultSections, ...sections };

    await octokit.issues.createComment({
      owner,
      repo: repoName,
      issue_number: prNumber,
      body: renderComment(options?.header ?? null, mergedSections, options?.footer ?? null),
    });
  }
}
