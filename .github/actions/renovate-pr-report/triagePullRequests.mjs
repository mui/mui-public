// Classifies the Renovate PRs fetched by action.yml and decides which ones are worth
// an LLM pass over their release notes.
import fs from 'node:fs';
import { isSameGitHubActor } from './githubUtils.mjs';

const workDir = process.env.WORK_DIR;
const read = (name) => JSON.parse(fs.readFileSync(`${workDir}/${name}`, 'utf8'));
const write = (name, value) =>
  fs.writeFileSync(`${workDir}/${name}`, JSON.stringify(value, null, 2));

const maxAgeDays = Number(process.env.MAX_AGE_DAYS);
const cutoff = Date.now() - maxAgeDays * 86400000;

const botActor = read('trusted-actors.json').bot;
const prs = read('prs.json')
  .flatMap((page) => page.data.repository.pullRequests.nodes)
  .filter((pr) => isSameGitHubActor({ id: pr.author?.id, type: pr.author?.type }, botActor))
  .filter((pr) => Date.parse(pr.createdAt) >= cutoff)
  .sort((a, b) => a.number - b.number);

// Renovate uses a Unicode arrow, but accept ASCII arrows from custom templates too.
const BUMP_RE = /`([^`]+)`\s*(?:→|->)\s*`([^`]+)`/g;
const BREAKING_RE =
  /breaking change|^#+ *breaking|\bmigration guide\b|\b(removed|dropped|no longer) supports?\b|^[-*].*\brenamed\b|\b(feat|fix|perf|refactor|chore|build)(\([^)\n]*\))?!:|\brequires? node\b|\bminimum( supported| required)? (node )?version\b|\bpeer dependenc|\bpure esm\b|\besm[- ]only\b|\bchanged? default\b/im;
const ADVISORY_RE = /\b(CVE-\d{4}-\d+|GHSA(-[a-z0-9]{4}){3})\b/i;
const PRERELEASE_RE = /-(alpha|beta|canary|dev|next|pre|rc)\b/i;
const RELEASE_NOTES_RE = /^#+ *release notes/im;

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
const bumpLevel = (changes) => {
  const bumps = changes.map((change) => classifyBump(change.from, change.to));
  return bumps.reduce(
    (highest, bump) => (BUMP_RISK.indexOf(bump) > BUMP_RISK.indexOf(highest) ? bump : highest),
    bumps.length > 0 ? 'patch' : 'unknown',
  );
};

const classify = (pr) => {
  const commit = pr.commits.nodes[0]?.commit;
  const labels = pr.labels.nodes.map((label) => label.name.toLowerCase());
  const checks = commit?.statusCheckRollup?.state;
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

  const changes = [...(pr.body ?? '').matchAll(BUMP_RE)].map((match) => ({
    from: match[1],
    to: match[2],
  }));

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    sha: commit?.oid ?? '',
    ageDays: Math.floor((Date.now() - Date.parse(pr.createdAt)) / 86400000),
    lockfileMaintenance: /lock file maintenance/i.test(pr.title),
    bump: bumpLevel(changes),
    prerelease: changes.some((change) => PRERELEASE_RE.test(change.to)),
    noChangelog: !RELEASE_NOTES_RE.test(pr.body ?? ''),
    heuristicHit: BREAKING_RE.test(pr.body ?? ''),
    pending: checks === 'PENDING' || checks === 'EXPECTED',
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
  analysisCandidate:
    !pr.lockfileMaintenance && (pr.bump !== 'patch' || pr.heuristicHit || pr.prerelease),
}));

// Cached verdicts already cover the same PR head.
const candidates = triaged.filter((pr) => pr.analysisCandidate && !cache[`${pr.number}:${pr.sha}`]);

write(
  'triaged.json',
  triaged.map(({ body, ...rest }) => rest),
);
// One file per PR so the model can page through long release notes selectively
// instead of ingesting every changelog through a single read.
fs.mkdirSync(`${workDir}/notes`, { recursive: true });
for (const pr of candidates) {
  fs.writeFileSync(`${workDir}/notes/${pr.number}.md`, pr.body);
}
write(
  'candidates.json',
  candidates.map((pr) => ({
    number: pr.number,
    title: pr.title,
    bump: pr.bump,
    notesFile: `notes/${pr.number}.md`,
  })),
);

fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate-count=${candidates.length}\n`);
