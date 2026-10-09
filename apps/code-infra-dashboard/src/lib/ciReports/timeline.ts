import { z } from 'zod/v4';
import type { ReportType } from './schemas';

// A timeline is the list of uploads of one report type, in time order: the history the dashboard
// draws. Each tracked branch (master, next, v7.x, …) has its own. A CI job on a tracked branch can
// also write to a named timeline, such as a weekly run against the last release; named timelines
// start with `@` so they never mix with a branch's. Pull requests and forks never write to one.
//
// Each upload adds an empty S3 object whose key holds the time and the commit. Listing the
// timeline's folder then lists its uploads without opening any file, and two uploads at the same
// moment can't overwrite each other, as they could when adding to one shared index file.

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
 * it runs; only a build on a tracked branch joins a timeline: the named one, or else the branch's.
 * `branch` is the build's verified branch, `null` for a fork or a ref that isn't a branch.
 *
 * A pointer is keyed by the commit's time (`commitTime`), so uploading a commit again writes the
 * same pointer and never moves the commit in its timeline. An upload without it joins no timeline,
 * and naming a timeline without it is an error.
 */
export function planUpload({
  repo,
  sha,
  reportType,
  branch,
  requested,
  commitTime,
}: {
  repo: string;
  sha: string;
  reportType: ReportType;
  branch: string | null;
  requested: string | undefined;
  commitTime: number | undefined;
}): UploadPlan | { error: string } {
  if (requested !== undefined && !TIMELINE_NAME_REGEX.test(requested)) {
    return {
      error: `Invalid timeline "${requested}": use lowercase letters, digits, "." and "-"`,
    };
  }
  if (requested !== undefined && commitTime === undefined) {
    return { error: `Timeline "${requested}" needs the commit's time: send commitTimestamp` };
  }
  const named = requested === undefined ? null : `@${requested}`;
  const trackedBranch = branch !== null && isTrackedBranch(branch) ? branch : null;
  const plan: UploadPlan = {
    reportKey: reportKey(repo, sha, reportType, named),
    timeline: null,
    pointerKey: null,
    isBaseBranch: trackedBranch !== null,
  };
  if (trackedBranch === null || commitTime === undefined) {
    return plan;
  }
  const timeline = named ?? trackedBranch;
  return {
    ...plan,
    timeline,
    pointerKey: timelinePointerKey(repo, timeline, reportType, commitTime, sha),
  };
}

export interface TimelineEntry {
  sha: string;
  /** The commit's time, in milliseconds since the epoch. */
  time: number;
}

/**
 * Reads the uploads out of a listing of a timeline's prefix, newest commit first. A commit has one
 * pointer however often it is uploaded, since the key holds only its time and its SHA.
 */
export function parseTimelineKeys(prefix: string, keys: readonly string[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const key of keys) {
    const match = POINTER_NAME_REGEX.exec(key.slice(prefix.length));
    if (match) {
      entries.push({ sha: match[2], time: TIME_CEILING - Number(match[1]) });
    }
  }
  return entries;
}
