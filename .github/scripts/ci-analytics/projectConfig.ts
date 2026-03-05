export interface ProjectConfig {
  slug: string;
  displayName: string;
  workflows: string[];
}

export const PROJECTS: ProjectConfig[] = [
  { slug: 'gh/mui/mui-public', displayName: 'Code infra', workflows: ['pipeline'] },
  { slug: 'gh/mui/mui-private', displayName: 'MUI Private', workflows: ['pipeline'] },
  { slug: 'gh/mui/material-ui', displayName: 'MUI Core', workflows: ['pipeline'] },
  { slug: 'gh/mui/base-ui', displayName: 'Base UI', workflows: ['pipeline', 'react-18'] },
  { slug: 'gh/mui/mui-x', displayName: 'MUI X', workflows: ['pipeline'] },
];
