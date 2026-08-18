// Classifies the Renovate PRs fetched by action.yml and decides which ones are worth
// an LLM pass over their release notes.
import fs from 'node:fs';
import { normalizeGitHubLogin } from './githubUtils.mjs';

const workDir = process.env.WORK_DIR;
const read = (name) => JSON.parse(fs.readFileSync(`${workDir}/${name}`, 'utf8'));
const write = (name, value) =>
  fs.writeFileSync(`${workDir}/${name}`, JSON.stringify(value, null, 2));

const maxAgeDays = Number(process.env.MAX_AGE_DAYS);
const cutoff = Date.now() - maxAgeDays * 86400000;

const botLogin = normalizeGitHubLogin(process.env.BOT_LOGIN);
const prs = read('prs.json')
  .flatMap((page) => page.data.repository.pullRequests.nodes)
  .filter(
    (pr) =>
      typeof pr.author?.login === 'string' && normalizeGitHubLogin(pr.author.login) === botLogin,
  )
  .filter((pr) => Date.parse(pr.createdAt) >= cutoff)
  .sort((a, b) => a.number - b.number);

// Renovate uses a Unicode arrow, but accept ASCII arrows from custom templates too.
const BUMP_RE = /`([^`]+)`\s*(?:→|->)\s*`([^`]+)`/g;
const BREAKING_RE =
  /breaking change|^#+ *breaking|\bmigration guide\b|\b(removed|dropped) support\b|^[-*].*\brenamed\b/im;
const ADVISORY_RE = /\b(CVE-\d{4}-\d+|GHSA(-[a-z0-9]{4}){3})\b/i;

const parseVersion = (value) => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value ?? '');
  return match ? match.slice(1, 4).map(Number) : null;
};

const classifyBump = (fromValue, toValue) => {
  const from = parseVersion(fromValue);
  const to = parseVersion(toValue);
  if (!from || !to) {
    return 'unknown';
  }
  if (from[0] !== to[0]) {
    return 'major';
  }
  if (from[1] !== to[1]) {
    // Pre-1.0, a minor bump carries the same risk as a major one.
    return from[0] === 0 ? 'major' : 'minor';
  }
  return 'patch';
};

const BUMP_RISK = ['patch', 'minor', 'unknown', 'major'];
const bumpLevel = (body) => {
  const bumps = [...(body ?? '').matchAll(BUMP_RE)].map((match) =>
    classifyBump(match[1], match[2]),
  );
  return bumps.reduce(
    (highest, bump) => (BUMP_RISK.indexOf(bump) > BUMP_RISK.indexOf(highest) ? bump : highest),
    bumps.length > 0 ? 'patch' : 'unknown',
  );
};

const classify = (pr) => {
  const commit = pr.commits.nodes[0]?.commit;
  const labels = pr.labels.nodes.map((label) => label.name.toLowerCase());
  const checks = commit?.statusCheckRollup?.state ?? 'MISSING';
  const blockers = [];
  if (pr.isDraft) {
    blockers.push('draft');
  }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    blockers.push('merge conflicts');
  }
  if (checks === 'FAILURE' || checks === 'ERROR') {
    blockers.push('CI failing');
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    blockers.push('changes requested');
  }
  if (pr.reviewDecision === 'REVIEW_REQUIRED') {
    blockers.push('review required');
  }
  const mergeStateBlocker = {
    BEHIND: 'base branch update',
    BLOCKED: 'merge blocked',
    HAS_HOOKS: 'pre-receive hooks',
    UNKNOWN: 'merge status pending',
  }[pr.mergeStateStatus];
  if (
    mergeStateBlocker &&
    !blockers.includes(mergeStateBlocker) &&
    (pr.mergeStateStatus !== 'BLOCKED' || blockers.length === 0)
  ) {
    blockers.push(mergeStateBlocker);
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    sha: commit?.oid ?? '',
    ageDays: Math.floor((Date.now() - Date.parse(pr.createdAt)) / 86400000),
    lockfileMaintenance: /lock file maintenance/i.test(pr.title),
    bump: bumpLevel(pr.body),
    heuristicHit: BREAKING_RE.test(pr.body ?? ''),
    pending: checks === 'PENDING' || checks === 'EXPECTED' || checks === 'MISSING',
    security:
      /\[security\]/i.test(pr.title) ||
      labels.some((label) => label.includes('security')) ||
      ADVISORY_RE.test(pr.body ?? ''),
    blockers,
    body: pr.body ?? '',
  };
};

const cache = read('cache.json');
const triaged = prs.map(classify).map((pr) => ({
  ...pr,
  analysisCandidate: !pr.lockfileMaintenance && (pr.bump !== 'patch' || pr.heuristicHit),
}));

// Cached verdicts already cover the same PR head.
const candidates = triaged.filter((pr) => pr.analysisCandidate && !cache[`${pr.number}:${pr.sha}`]);

write(
  'triaged.json',
  triaged.map(({ body, ...rest }) => rest),
);
write(
  'candidates.json',
  candidates.map((pr) => ({
    number: pr.number,
    title: pr.title,
    bump: pr.bump,
    // Cap the notes so one enormous changelog can't blow up the prompt.
    releaseNotes: pr.body.slice(0, 20000),
  })),
);

fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate-count=${candidates.length}\n`);
