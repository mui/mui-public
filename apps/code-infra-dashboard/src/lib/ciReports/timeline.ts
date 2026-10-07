// A timeline is an ordered run of one report type's uploads, the history the dashboard draws. A
// tracked branch's uploads form the timeline named after it; a CI job on a tracked branch can name
// its own (a weekly run against the last release, say), kept apart as `@<name>`. Pull requests and
// forks never write one.
//
// Each upload in a timeline leaves an empty S3 object whose key holds the time and the commit, so
// listing the timeline's prefix lists its uploads without reading any of them, and two uploads
// landing at once can't lose each other the way appending to a shared index could.

export const REPORT_TYPES = ['size-snapshot', 'benchmark'] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

const TRACKED_BRANCH_REGEX = /^(master|main|next|v[^/]*\.[^/]*)$/;

const TIMELINE_NAME_REGEX = /^[a-z0-9][a-z0-9.-]{0,63}$/;

// S3 lists keys in ascending order only. Keying by the time left until this ceiling (in milliseconds,
// past the year 2286) lists the newest upload first.
const TIME_CEILING = 9_999_999_999_999;

const TIME_DIGITS = String(TIME_CEILING).length;

const POINTER_NAME_REGEX = new RegExp(`^(\\d{${TIME_DIGITS}})-([0-9a-f]{40})$`);

export function isTrackedBranch(branch: string): boolean {
  return TRACKED_BRANCH_REGEX.test(branch);
}

/** Whether `timeline` can be listed: a tracked branch's, or a named one as `@<name>`. */
export function isTimeline(timeline: string): boolean {
  return timeline.startsWith('@')
    ? TIMELINE_NAME_REGEX.test(timeline.slice(1))
    : isTrackedBranch(timeline);
}

/**
 * Which timeline an upload belongs to: the one its CI job named, as `@<name>`, or else its tracked
 * branch's. `trackedBranch` is the branch when the build is the repository's own and the branch is
 * tracked, else `null`: only such builds write a timeline.
 */
export function resolveTimeline(
  requested: string | undefined,
  trackedBranch: string | null,
): { timeline: string | null } | { error: string } {
  if (requested === undefined) {
    return { timeline: trackedBranch };
  }
  if (trackedBranch === null) {
    return { error: 'A timeline can only be named from a tracked branch of the repository itself' };
  }
  if (!TIMELINE_NAME_REGEX.test(requested)) {
    return {
      error: `Invalid timeline "${requested}": use lowercase letters, digits, "." and "-"`,
    };
  }
  return { timeline: `@${requested}` };
}

/**
 * Where a commit's report is stored. A named timeline gets its own file, `<reportType>@<name>.json`,
 * so a run against another baseline on the same commit doesn't overwrite the commit's regular report.
 */
export function reportKey(
  repo: string,
  sha: string,
  reportType: ReportType,
  timeline: string | null,
): string {
  const suffix = timeline?.startsWith('@') ? timeline : '';
  return `artifacts/${repo}/${sha}/${reportType}${suffix}.json`;
}

/** The S3 prefix holding a timeline's pointers. */
export function timelinePrefix(repo: string, timeline: string, reportType: ReportType): string {
  return `artifacts/${repo}/timeline/${timeline}/${reportType}/`;
}

/** The empty object that records one upload in a timeline. */
export function timelinePointerKey(
  repo: string,
  timeline: string,
  reportType: ReportType,
  time: number,
  sha: string,
): string {
  const remaining = String(TIME_CEILING - Math.round(time)).padStart(TIME_DIGITS, '0');
  return `${timelinePrefix(repo, timeline, reportType)}${remaining}-${sha}`;
}

export interface TimelineEntry {
  sha: string;
  /** Milliseconds since the epoch: the commit's time when the upload sent it, else the upload's. */
  time: number;
}

/**
 * Reads the uploads out of a listing of a timeline's prefix, newest first, keeping one per commit:
 * a commit uploaded again shows up once, at its newest pointer.
 */
export function parseTimelineKeys(prefix: string, keys: readonly string[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const match = POINTER_NAME_REGEX.exec(key.slice(prefix.length));
    if (!match || seen.has(match[2])) {
      continue;
    }
    seen.add(match[2]);
    entries.push({ sha: match[2], time: TIME_CEILING - Number(match[1]) });
  }
  return entries;
}
