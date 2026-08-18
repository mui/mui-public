// Merges the triage with the LLM verdicts, writes one sticky verdict comment per PR
// worth flagging, and renders the aggregate report for the job summary.
import fs from 'node:fs';
import { serializeVerdictState } from './reportState.mjs';

/**
 * @typedef {import('./triagePullRequests.mjs').TriagedPullRequest} TriagedPullRequest
 * @typedef {import('./reportState.mjs').Verdict} Verdict
 */

/**
 * @typedef {TriagedPullRequest & {
 *   analysisCandidate: boolean,
 *   verdict: Verdict | null,
 *   breaking: 'yes' | 'no' | 'unclear',
 *   reason: string,
 *   dependency: string,
 * }} AnalyzedPullRequest A triaged PR merged with its verdict, or the fail-closed fallback.
 */

const workDir = process.env.WORK_DIR;
const read = (name) => JSON.parse(fs.readFileSync(`${workDir}/${name}`, 'utf8'));

const triaged = read('triaged.json');
const cache = read('cache.json');
const verdictComments = read('verdict-comments.json');
const maxAgeDays = Number(process.env.MAX_AGE_DAYS);

const hasLlmVerdicts = fs.existsSync(`${workDir}/verdicts.json`);
const verdicts = hasLlmVerdicts ? read('verdicts.json') : [];
verdicts.forEach((verdict) => {
  const pr = triaged.find((candidate) => candidate.number === verdict.number);
  if (pr) {
    cache[`${pr.number}:${pr.sha}`] = verdict;
  }
});

const analyzed = triaged.map((pr) => {
  const verdict = cache[`${pr.number}:${pr.sha}`];
  return {
    ...pr,
    verdict: verdict ?? null,
    breaking:
      verdict?.breaking ??
      // A major without release notes leaves nothing to judge, so it fails closed too.
      (pr.heuristicHit ||
      pr.prerelease ||
      (pr.noChangelog && pr.bump === 'major') ||
      (hasLlmVerdicts && pr.analysisCandidate)
        ? 'unclear'
        : 'no'),
    security: pr.security || Boolean(verdict?.security),
    reason: verdict?.reason ?? '',
    dependency: verdict?.dependency ?? '',
  };
});

/**
 * A PR needs a human look when it fixes a vulnerability or may break consumers.
 * @param {AnalyzedPullRequest} pr
 * @returns {boolean}
 */
const needsAttention = (pr) => pr.security || pr.breaking === 'yes' || pr.breaking === 'unclear';
const attention = analyzed.filter(needsAttention);
const rest = analyzed.filter((pr) => !needsAttention(pr));
const action = rest.filter((pr) => pr.blockers.length > 0);
const waiting = rest.filter((pr) => pr.blockers.length === 0 && pr.pending);
const ready = rest.filter((pr) => pr.blockers.length === 0 && !pr.pending);

/**
 * Flattens text to one line and escapes HTML and Markdown-table characters.
 * @param {string} text
 * @returns {string}
 */
const escape = (text) =>
  text
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/\|/g, '\\|');
const link = (pr) => `[#${pr.number}](${pr.url})`;

/**
 * Renders the risk flags plus the verdict's dependency and reason as one line.
 * @param {AnalyzedPullRequest} pr
 * @returns {string}
 */
const risk = (pr) => {
  const flags = [];
  if (pr.security) {
    flags.push('security fix');
  }
  if (pr.breaking === 'yes') {
    flags.push('breaking change');
  }
  if (pr.breaking === 'unclear') {
    flags.push('possibly breaking');
  }
  if (pr.prerelease) {
    flags.push('pre-release');
  }
  if (pr.noChangelog && pr.bump === 'major') {
    flags.push('no release notes');
  }
  // The dependency only adds information next to a reason, and only for grouped updates.
  const detail = pr.reason ? [pr.dependency, pr.reason].filter(Boolean).join(': ') : '';
  return escape([flags.join(', '), detail].filter(Boolean).join(' — '));
};

const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// One sticky comment per PR worth flagging; quiet updates get none. The mention pings
// only when an edit first introduces it — GitHub does not re-notify on later updates.
fs.mkdirSync(`${workDir}/comments`, { recursive: true });
const targets = analyzed
  .filter((pr) => pr.analysisCandidate || pr.security)
  .map((pr) => {
    const body = [
      process.env.VERDICT_MARKER,
      '### Renovate update risk',
      '',
      `**${pr.bump} bump** — ${risk(pr) || 'no breaking changes found'}`,
      '',
      ...(needsAttention(pr) ? [`${process.env.MENTION} — this update needs a look.`, ''] : []),
      `<sub>Updated by [${process.env.GITHUB_WORKFLOW}](${runUrl}).</sub>`,
      serializeVerdictState({ sha: pr.sha, verdict: pr.verdict }),
    ].join('\n');
    const file = `comments/${pr.number}.md`;
    fs.writeFileSync(`${workDir}/${file}`, `${body}\n`);
    return { number: pr.number, file, commentId: verdictComments[pr.number] ?? null };
  });
fs.writeFileSync(`${workDir}/comment-targets.json`, JSON.stringify(targets));

/**
 * Renders a Markdown table of PRs for the job summary, with one custom column.
 * @param {AnalyzedPullRequest[]} rows
 * @param {string} header
 * @param {(pr: AnalyzedPullRequest) => string} cell
 * @returns {string[]}
 */
const table = (rows, header, cell) => {
  if (rows.length === 0) {
    return ['_None._', ''];
  }
  return [
    `| PR | Title | Bump | Age | ${header} |`,
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (pr) => `| ${link(pr)} | ${escape(pr.title)} | ${pr.bump} | ${pr.ageDays}d | ${cell(pr)} |`,
    ),
    '',
  ];
};

const report = [
  '### Renovate PR report',
  '',
  `${analyzed.length} open PR(s) by \`${process.env.BOT_LOGIN}\` created in the last ${maxAgeDays} day(s).`,
  '',
  `#### Needs attention (${attention.length})`,
  '',
  ...table(attention, 'Why', risk),
  `#### Needs action (${action.length})`,
  '',
  ...table(action, 'Blocked by', (pr) => escape(pr.blockers.join(', '))),
  `#### Ready to merge (${ready.length})`,
  '',
  ...table(ready, 'State', () => 'green'),
  `#### Waiting on CI (${waiting.length})`,
  '',
  ...table(waiting, 'State', () => 'checks running'),
];

fs.writeFileSync(`${workDir}/report.md`, `${report.join('\n')}\n`);
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  `attention-count=${attention.length}\naction-count=${action.length}\nready-count=${ready.length}\n`,
);
