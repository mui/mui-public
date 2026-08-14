// Merges the triage with the LLM verdicts and renders the dashboard report for
// reusable-renovate-pr-report.yml.
import fs from 'node:fs';

const workDir = process.env.WORK_DIR;
const read = (name) => JSON.parse(fs.readFileSync(`${workDir}/${name}`, 'utf8'));

const triaged = read('triaged.json');
const cache = read('cache.json');
const announced = new Set(read('announced.json'));
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
    breaking:
      verdict?.breaking ??
      (pr.heuristicHit || (hasLlmVerdicts && pr.analysisCandidate) ? 'unclear' : 'no'),
    security: pr.security || Boolean(verdict?.security),
    reason: verdict?.reason ?? '',
    dependency: verdict?.dependency ?? '',
  };
});

const needsAttention = (pr) => pr.security || pr.breaking === 'yes' || pr.breaking === 'unclear';
const attention = analyzed.filter(needsAttention);
const rest = analyzed.filter((pr) => !needsAttention(pr));
const action = rest.filter((pr) => pr.blockers.length > 0);
const waiting = rest.filter((pr) => pr.blockers.length === 0 && pr.pending);
const ready = rest.filter((pr) => pr.blockers.length === 0 && !pr.pending);

const escape = (text) => text.replace(/\|/g, '\\|');
const link = (pr) => `[#${pr.number}](${pr.url})`;

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
  // The dependency only adds information next to a reason, and only for grouped updates.
  const detail = pr.reason ? [pr.dependency, pr.reason].filter(Boolean).join(': ') : '';
  return escape([flags.join(', '), detail].filter(Boolean).join(' — '));
};

const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const report = [
  process.env.STICKY_MARKER,
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
  `<sub>Updated by [${process.env.GITHUB_WORKFLOW}](${runUrl}).</sub>`,
];

// Only a PR that newly needs attention earns an interrupt; the sticky comment carries
// the rest. Keyed by head SHA, so a rebase that changes the update re-announces.
const fresh = attention.filter((pr) => !announced.has(`${pr.number}:${pr.sha}`));
if (fresh.length > 0) {
  fs.writeFileSync(
    `${workDir}/announce.md`,
    [
      process.env.ANNOUNCE_MARKER,
      `${process.env.MENTION} — ${fresh.length} Renovate PR(s) need a look:`,
      '',
      ...fresh.map((pr) => `- ${link(pr)} ${escape(pr.title)} — ${risk(pr)}`),
    ].join('\n'),
  );
}

// Carry only the still-open PRs forward, so the state comment can't grow without bound.
const state = {
  cache: Object.fromEntries(
    Object.entries(cache).filter(([key]) =>
      analyzed.some((pr) => key === `${pr.number}:${pr.sha}`),
    ),
  ),
  announced: attention.map((pr) => `${pr.number}:${pr.sha}`),
};

fs.writeFileSync(
  `${workDir}/report.md`,
  `${report.join('\n')}\n\n<!-- renovate-pr-report-state: ${JSON.stringify(state)} -->\n`,
);
fs.appendFileSync(
  process.env.GITHUB_OUTPUT,
  `attention-count=${attention.length}\naction-count=${action.length}\nready-count=${ready.length}\n`,
);
