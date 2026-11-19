import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Language } from './languages';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

export interface Sample {
  id: string;
  language: Language;
  source: string;
  path: string;
}

const REPO_FILES: Array<[Language, string]> = [
  ['tsx', 'docs/app/docs-infra/components/code-highlighter/demos/CodeActionsMenu.tsx'],
  ['ts', 'packages/docs-infra/src/pipeline/parseSource/parseSource.ts'],
  ['ts', 'packages/docs-infra/src/pipeline/parseSource/extendSyntaxTokens.test.ts'],
  ['js', 'packages/code-infra/src/utils/pnpm.mjs'],
  ['json', 'packages/docs-infra/package.json'],
  ['md', 'packages/benchmark/README.md'],
  ['mdx', 'docs/app/docs-infra/pipeline/parse-source/page.mdx'],
  ['mdx', 'docs/app/docs-infra/pipeline/page.mdx'],
  ['css', 'docs/components/ExpandingBox/ExpandingBox.css'],
  ['yaml', '.circleci/config.yml'],
];

const FIXTURE_FILES: Array<[Language, string]> = [
  ['html', 'page.html'],
  ['sh', 'install.sh'],
  ['diff', 'commit.diff'],
];

const SNIPPET_LINES = 12;

export function loadCorpus(): Sample[] {
  const samples: Sample[] = [
    ...REPO_FILES.map(([language, path]) => ({
      language,
      path,
      source: readFileSync(repoRoot + path, 'utf8'),
    })),
    ...FIXTURE_FILES.map(([language, name]) => ({
      language,
      path: `test/syntax-highlight-benchmark/fixtures/${name}`,
      source: readFileSync(fixturesDir + name, 'utf8'),
    })),
  ].map((sample) => ({
    ...sample,
    id: `${sample.language}:${sample.path.split('/').slice(-2).join('/')}`,
  }));

  // Docs pages mostly show short demo snippets, where per-call overhead dominates.
  const tsx = samples[0];
  samples.unshift({
    ...tsx,
    id: `tsx:snippet (${SNIPPET_LINES} lines)`,
    source: tsx.source.split('\n').slice(0, SNIPPET_LINES).join('\n'),
  });
  return samples;
}
