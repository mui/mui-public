// Downloads the failing jobs' log tails for every analysis candidate whose CI is red,
// so the LLM pass can diagnose which dependency broke it. GitHub Actions logs come from
// the jobs API with the action's token; CircleCI logs from its public v1.1 API
// (MUI's projects are public). Every fetch failure degrades to a stub section, so a
// missing log never fails the report.
import fs from 'node:fs';
import { parseCircleCiJob, parseGitHubJob, tailText } from './failureLogUtils.mjs';

const workDir = process.env.WORK_DIR;
const repo = process.env.GH_REPO;
const read = (name) => JSON.parse(fs.readFileSync(`${workDir}/${name}`, 'utf8'));

const MAX_LINES = 200;
const MAX_CHARS = 15000;

const fetchText = async (url, headers = {}) => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
};

const fetchGitHubJobLog = async (jobId) =>
  fetchText(`https://api.github.com/repos/${repo}/actions/jobs/${jobId}/logs`, {
    authorization: `Bearer ${process.env.GH_TOKEN}`,
  });

const fetchCircleCiJobLog = async (jobNumber) => {
  const job = JSON.parse(
    await fetchText(`https://circleci.com/api/v1.1/project/github/${repo}/${jobNumber}`),
  );
  const failedActions = (job.steps ?? [])
    .flatMap((step) => step.actions ?? [])
    .filter((action) => (action.failed || action.status === 'failed') && action.output_url);
  const outputs = await Promise.all(
    failedActions.map(async (action) =>
      JSON.parse(await fetchText(action.output_url))
        .map((chunk) => chunk.message)
        .join(''),
    ),
  );
  return outputs.join('\n');
};

const fetchCheckLog = async (check) => {
  try {
    const gitHubJob = parseGitHubJob(check.url);
    if (gitHubJob) {
      return tailText(await fetchGitHubJobLog(gitHubJob), MAX_LINES, MAX_CHARS);
    }
    const circleCiJob = parseCircleCiJob(check.url);
    if (circleCiJob) {
      return tailText(await fetchCircleCiJobLog(circleCiJob), MAX_LINES, MAX_CHARS);
    }
    return 'Logs unavailable for this check system.';
  } catch (error) {
    return `Logs unavailable: ${error.message}`;
  }
};

const candidates = read('candidates.json');
const triaged = read('triaged.json');

fs.mkdirSync(`${workDir}/failures`, { recursive: true });
await Promise.all(
  candidates
    .filter((candidate) => candidate.failureFile)
    .map(async (candidate) => {
      const pr = triaged.find((entry) => entry.number === candidate.number);
      const sections = await Promise.all(
        pr.failingChecks.map(
          async (check) =>
            `## ${check.name}\n${check.url}\n\n\`\`\`\n${await fetchCheckLog(check)}\n\`\`\``,
        ),
      );
      fs.writeFileSync(`${workDir}/${candidate.failureFile}`, `${sections.join('\n\n')}\n`);
    }),
);
