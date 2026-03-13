// GitHub labels
export const LABEL_WAITING_FOR_MAINTAINER = 'status: waiting for maintainer';
export const LABEL_PR_OUT_OF_DATE = 'PR: out-of-date';
export const LABEL_PR_NEEDS_REVISION = 'PR: needs revision';
export const LABEL_ON_HOLD = 'on hold';
export const LABEL_DOCS_FEEDBACK = 'support: docs-feedback';

export interface KpiRepo {
  name: string;
  label: string;
  ossInsightId?: string;
  public?: boolean;
}

export const MUI_KPI_REPOS: KpiRepo[] = [
  { name: 'material-ui', label: 'MUI Core', ossInsightId: '23083156', public: true },
  { name: 'mui-x', label: 'MUI X', ossInsightId: '260240241', public: true },
  { name: 'base-ui', label: 'Base UI', ossInsightId: '762289766', public: true },
  { name: 'mui-public', label: 'Code infra', public: true },
  { name: 'mui-design-kits', label: 'Design Kits', public: true },
  { name: 'mui-private', label: 'MUI Private' },
];

export interface Repository {
  owner: string;
  name: string;
  displayName: string;
  description: string;
  packages: string[];
}

export const repositories: Repository[] = [
  {
    owner: 'mui',
    name: 'material-ui',
    displayName: 'MUI Core',
    description: "React components implementing Google's Material Design",
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
  },
  {
    owner: 'mui',
    name: 'mui-x',
    displayName: 'MUI X',
    description: 'Advanced components for complex use cases',
    packages: [
      '@mui/x-charts',
      '@mui/x-charts-pro',
      '@mui/x-charts-vendor',
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
      '@mui/x-telemetry',
      '@mui/x-tree-view',
      '@mui/x-tree-view-pro',
      '@mui/x-virtualizer',
    ],
  },
  {
    owner: 'mui',
    name: 'base-ui',
    displayName: 'Base UI',
    description: 'Unstyled React components and low-level hooks',
    packages: ['@base-ui/react', '@base-ui/utils'],
  },
  {
    owner: 'mui',
    name: 'mui-public',
    displayName: 'Code infra',
    description: 'Public monorepo with shared infrastructure and tooling',
    packages: [
      '@mui/internal-babel-plugin-display-name',
      '@mui/internal-babel-plugin-minify-errors',
      '@mui/internal-babel-plugin-resolve-imports',
      '@mui/internal-bundle-size-checker',
      '@mui/internal-code-infra',
      '@mui/internal-docs-infra',
    ],
  },
];
