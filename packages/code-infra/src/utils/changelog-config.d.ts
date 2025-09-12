export type LabelInfo = {
  title: string;
  labels: string[];
  map?: Record<string, string | { label: string; priority: number }>;
  prefix?: string;
  suffix?: string;
  addToChangelog?: boolean;
  isCatchAll?: boolean;
  priority?: number;
};

type FlagInfo = {
  labels: string[];
  prefix?: string;
  suffix?: string;
  priority?: number;
};

export type ChangelogConfig = {
  categories: Record<string, LabelInfo>;
  sections: Record<string, LabelInfo>;
  subsections?: Record<string, LabelInfo>;
  flags?: Record<string, FlagInfo>;
  ignoreAuthors?: string[];
};
