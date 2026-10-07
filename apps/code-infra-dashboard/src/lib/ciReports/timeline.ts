// A timeline is an ordered run of one report type's uploads, the history the dashboard draws. A
// tracked branch's uploads form the timeline named after it; a CI job can name its own (a weekly
// run against the last release, say) as long as it runs on a tracked branch. Pull requests and
// forks never write one.
//
// Each upload in a timeline leaves an empty S3 object whose key holds the time and the commit, so
// listing the timeline's prefix lists its uploads without reading any of them, and two uploads
// landing at once can't lose each other the way appending to a shared index could.

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

/** Whether `name` can be asked for as a timeline: a tracked branch's or a name of its own. */
export function isTimelineName(name: string): boolean {
  return isTrackedBranch(name) || TIMELINE_NAME_REGEX.test(name);
}

export type TimelineResolution = { timeline: string | null } | { error: string };

/**
 * Which timeline an upload belongs to. `requested` is the name the CI job asked for, if any;
 * `trusted` is whether the build ran in the organization's own repository rather than a fork.
 */
export function resolveTimeline({
  requested,
  branch,
  trusted,
}: {
  requested: string | undefined;
  branch: string;
  trusted: boolean;
}): TimelineResolution {
  const tracked = trusted && isTrackedBranch(branch);
  if (requested === undefined) {
    return { timeline: tracked ? branch : null };
  }
  if (!tracked) {
    return { error: 'A timeline can only be named from a tracked branch of the repository itself' };
  }
  // A tracked branch's name would merge into that branch's timeline and share its report file.
  if (isTrackedBranch(requested) || !TIMELINE_NAME_REGEX.test(requested)) {
    return {
      error: `Invalid timeline "${requested}": use lowercase letters, digits, "." and "-", and not a tracked branch's name`,
    };
  }
  return { timeline: requested };
}

/**
 * The file a commit's report is stored in. A tracked branch's timeline, or none, keeps the plain
 * name; a named timeline gets its own file, so a run against another baseline on the same commit
 * doesn't overwrite the commit's regular report.
 */
export function reportFileName(reportType: string, timeline: string | null): string {
  return timeline === null || isTrackedBranch(timeline)
    ? `${reportType}.json`
    : `${reportType}@${timeline}.json`;
}

/** The S3 prefix holding a timeline's pointers. */
export function timelinePrefix(repo: string, timeline: string, reportType: string): string {
  return `artifacts/${repo}/timeline/${encodeURIComponent(timeline)}/${reportType}/`;
}

/** The empty object that records one upload in a timeline. */
export function timelinePointerKey(
  repo: string,
  timeline: string,
  reportType: string,
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
    const match = key.startsWith(prefix) ? POINTER_NAME_REGEX.exec(key.slice(prefix.length)) : null;
    if (!match || seen.has(match[2])) {
      continue;
    }
    seen.add(match[2]);
    entries.push({ sha: match[2], time: TIME_CEILING - Number(match[1]) });
  }
  return entries;
}
