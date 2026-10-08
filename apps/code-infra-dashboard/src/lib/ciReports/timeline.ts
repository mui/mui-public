import { z } from 'zod/v4';
import type { ReportType } from './schemas';

// A timeline is an ordered run of one report type's uploads, the history the dashboard draws. A
// tracked branch's uploads form the timeline named after it; a CI job on a tracked branch can name
// its own (a weekly run against the last release, say), kept apart as `@<name>`. Pull requests and
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

/**
 * A time an upload is ordered by, in milliseconds since the epoch. Bounded below at 2001 so a time in
 * seconds, as git prints it, fails instead of sorting the commit to 1970.
 */
export const uploadTimeSchema = z.number().int().min(1_000_000_000_000).max(TIME_CEILING);

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
 * Where a commit's report is stored. A named timeline (`@<name>`) gets its own file,
 * `<reportType>@<name>.json`, so a run against another baseline on the same commit doesn't
 * overwrite the commit's regular report.
 */
function reportKey(
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
function timelinePointerKey(
  repo: string,
  timeline: string,
  reportType: ReportType,
  time: number,
  sha: string,
): string {
  const remaining = String(TIME_CEILING - time).padStart(TIME_DIGITS, '0');
  return `${timelinePrefix(repo, timeline, reportType)}${remaining}-${sha}`;
}

export interface UploadPlan {
  /** Where the report is stored. */
  reportKey: string;
  /** The timeline the upload joins, or `null` when it joins none. */
  timeline: string | null;
  /** The empty object recording the upload in its timeline, written after the report. */
  pointerKey: string | null;
  /** Whether the report is a tracked branch's, which is what keeps it in the bucket for good. */
  isBaseBranch: boolean;
}

/**
 * What an upload writes. A name the CI job gives (`requested`) picks the report's own file wherever
 * it runs; only a build that is the repository's own on a tracked branch (`trackedBranch`, else
 * `null`) joins a timeline: the named one, or else the branch's.
 */
export function planUpload({
  repo,
  sha,
  reportType,
  trackedBranch,
  requested,
  time,
}: {
  repo: string;
  sha: string;
  reportType: ReportType;
  trackedBranch: string | null;
  requested: string | undefined;
  time: number;
}): UploadPlan | { error: string } {
  if (requested !== undefined && !TIMELINE_NAME_REGEX.test(requested)) {
    return {
      error: `Invalid timeline "${requested}": use lowercase letters, digits, "." and "-"`,
    };
  }
  const named = requested === undefined ? null : `@${requested}`;
  const timeline = trackedBranch === null ? null : (named ?? trackedBranch);
  return {
    reportKey: reportKey(repo, sha, reportType, named),
    timeline,
    pointerKey:
      timeline === null ? null : timelinePointerKey(repo, timeline, reportType, time, sha),
    isBaseBranch: trackedBranch !== null,
  };
}

export interface TimelineEntry {
  sha: string;
  /** Milliseconds since the epoch: the commit's time when the upload sent it, else the upload's. */
  time: number;
}

/**
 * Reads the uploads out of a listing of a timeline's prefix, newest first, keeping one per commit
 * within the listing: a commit uploaded again shows up once, at its newest pointer. Only within it:
 * an older pointer of the same commit can come back on a later page, so a caller that joins pages
 * keeps the first entry per `sha`.
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
