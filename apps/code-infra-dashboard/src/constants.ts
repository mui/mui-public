import { formatMaterialUiDocPath } from '@/lib/ciReports/formatMaterialUiDocPath';

export const DASHBOARD_ORIGIN =
  process.env.DASHBOARD_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://frontend-public.mui.com';

// GitHub labels
export const LABEL_WAITING_FOR_MAINTAINER = 'status: waiting for maintainer';
export const LABEL_PR_OUT_OF_DATE = 'PR: out-of-date';
export const LABEL_PR_NEEDS_REVISION = 'PR: needs revision';
export const LABEL_ON_HOLD = 'on hold';
export const LABEL_DOCS_FEEDBACK = 'support: docs-feedback';
export const LABEL_SUPPORT_UNKNOWN = 'support: unknown';
export const LABEL_SUPPORT_PRIORITY = 'support: priority';

export interface Repository {
  owner: string;
  name: string;
  displayName: string;
  description: string;
  packages: string[];
  ossInsightId?: string;
  /** CircleCI workflows whose metrics CI analytics collects. */
  circleCi?: { workflows: string[] };
  prComment?: {
    bundleSize?: boolean;
    benchmark?: boolean;
    netlifyDocs?:
      | boolean
      | {
          siteId?: string;
          formatDocPath?: (filePath: string) => string | null;
        };
  };
}

/**
 * The public repositories. Private ones are deliberately not listed: this source is public, and
 * the server discovers them from its GitHub App installation instead (`@/lib/privateRepositories`).
 */
export const repositories = new Map<string, Repository>(
  (
    [
      {
        owner: 'mui',
        name: 'material-ui',
        displayName: 'MUI Core',
        description: "React components implementing Google's Material Design",
        ossInsightId: '23083156',
        circleCi: { workflows: ['pipeline', 'nightly-cron'] },
        packages: [
          '@mui/codemod',
          '@mui/core-downloads-tracker',
          '@mui/docs',
          '@mui/envinfo',
          '@mui/icons-material',
          '@mui/internal-babel-macros',
          '@mui/internal-docs-utils',
          '@mui/internal-markdown',
          '@mui/internal-scripts',
          '@mui/internal-test-utils',
          '@mui/lab',
          '@mui/material',
          '@mui/material-next',
          '@mui/material-nextjs',
          '@mui/private-theming',
          '@mui/styled-engine',
          '@mui/styled-engine-sc',
          '@mui/stylis-plugin-rtl',
          '@mui/system',
          '@mui/types',
          '@mui/utils',
        ],
        prComment: {
          bundleSize: true,
          benchmark: true,
          netlifyDocs: {
            siteId: 'material-ui',
            formatDocPath: formatMaterialUiDocPath,
          },
        },
      },
      {
        owner: 'mui',
        name: 'mui-x',
        displayName: 'MUI X',
        description: 'Advanced components for complex use cases',
        ossInsightId: '260240241',
        circleCi: { workflows: ['pipeline'] },
        packages: [
          '@mui/x-charts',
          '@mui/x-charts-premium',
          '@mui/x-charts-pro',
          '@mui/x-charts-vendor',
          '@mui/x-chat',
          '@mui/x-chat-headless',
          '@mui/x-codemod',
          '@mui/x-data-grid',
          '@mui/x-data-grid-generator',
          '@mui/x-data-grid-premium',
          '@mui/x-data-grid-pro',
          '@mui/x-date-pickers',
          '@mui/x-date-pickers-pro',
          '@mui/x-internal-gestures',
          '@mui/x-internals',
          '@mui/x-license',
          '@mui/x-scheduler',
          '@mui/x-scheduler-premium',
          '@mui/x-telemetry',
          '@mui/x-tree-view',
          '@mui/x-tree-view-pro',
          '@mui/x-virtualizer',
        ],
        prComment: {
          bundleSize: true,
          benchmark: true,
          netlifyDocs: {
            siteId: 'material-ui-x',
            formatDocPath: (filePath) => {
              if (
                !filePath.startsWith('docs/data/') ||
                !/\.(md|mdx|jsx?|tsx?|json)$/.test(filePath)
              ) {
                return null;
              }
              return filePath
                .replace('docs/data', 'x')
                .replace(/\/[^/]+$/, '/')
                .replace('data-grid/', 'react-data-grid/')
                .replace('date-pickers/', 'react-date-pickers/')
                .replace('charts/', 'react-charts/')
                .replace('scheduler/', 'react-scheduler/')
                .replace('tree-view/', 'react-tree-view/');
            },
          },
        },
      },
      {
        owner: 'mui',
        name: 'base-ui',
        displayName: 'Base UI',
        description: 'Unstyled React components and low-level hooks',
        ossInsightId: '762289766',
        circleCi: { workflows: ['pipeline', 'react-18'] },
        packages: ['@base-ui/react', '@base-ui/utils'],
        prComment: {
          bundleSize: true,
          benchmark: true,
        },
      },
      {
        owner: 'mui',
        name: 'mui-design-kits',
        displayName: 'Design Kits',
        description: 'MUI design kits for Figma and other design tools',
        packages: [],
      },
      {
        owner: 'mui',
        name: 'mui-public',
        displayName: 'Code infra',
        description: 'Public monorepo with shared infrastructure and tooling',
        circleCi: { workflows: ['pipeline'] },
        packages: [
          '@mui/internal-babel-plugin-display-name',
          '@mui/internal-babel-plugin-minify-errors',
          '@mui/internal-babel-plugin-resolve-imports',
          '@mui/internal-bundle-size-checker',
          '@mui/internal-code-infra',
          '@mui/internal-docs-infra',
        ],
        prComment: {
          bundleSize: true,
          benchmark: true,
          netlifyDocs: {
            siteId: 'mui-internal',
            formatDocPath: (filePath) => {
              if (!filePath.startsWith('docs/app/docs-infra/') || !filePath.endsWith('.mdx')) {
                return null;
              }
              // Strip docs/app prefix and filename (page.mdx)
              return filePath.replace('docs/app/', '').replace(/\/[^/]+\.mdx$/, '/');
            },
          },
        },
      },
    ] satisfies Repository[]
  ).map((repo) => [`${repo.owner}/${repo.name}`, repo]),
);

export const MUI_KPI_REPOS = [
  repositories.get('mui/material-ui')!,
  repositories.get('mui/mui-x')!,
  repositories.get('mui/base-ui')!,
  repositories.get('mui/mui-public')!,
  repositories.get('mui/mui-design-kits')!,
];
