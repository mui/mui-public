import type { Code } from '../CodeHighlighter/types';

export type CreateDemoDataMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  skipPrecompute?: boolean;
  precompute?: Code;
  client?: React.ComponentType<{ children: React.ReactNode }>;
};

export type DemoData<T extends React.ComponentType<any> = React.ComponentType> = {
  name: string;
  slug: string;
  displayName: string;
  precompute: Code | undefined;
  url: string;
  components: { [key: string]: T };
};

export type DemoGlobalProvider = React.ComponentType<{ children: React.ReactNode }>;
export type DemoGlobalData = DemoData<DemoGlobalProvider>;
