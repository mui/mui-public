import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPOS = [
  'mui/material-ui',
  'mui/mui-x',
  'mui/base-ui',
  'mui/base-ui-mosaic',
  'mui/base-ui-charts',
  'mui/base-ui-plus',
  'mui/mui-public',
  'mui/mui-private',
];

async function fetchVersion(repo: string, pkg: string): Promise<string> {
  const jq = `.devDependencies["${pkg}"] // .dependencies["${pkg}"] // "—"`;
  const { stdout } = await execFileAsync('gh', [
    'api',
    `repos/${repo}/contents/package.json`,
    '-H',
    'Accept: application/vnd.github.raw',
    '--jq',
    jq,
  ]);
  return stdout.trim();
}

const pkg = process.argv[2];
if (!pkg) {
  console.error('usage: org-versions <package-name>');
  process.exit(1);
}

const results = await Promise.all(
  REPOS.map(async (repo) => `${repo}: ${await fetchVersion(repo, pkg)}`),
);

process.stdout.write(`${results.join('\n')}\n`);
