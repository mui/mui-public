// Cross-repository grouping, in-repository supersession and per-repository hints.

import { compareVersions } from './versions.mjs';

/**
 * Key that makes PRs from different repositories "the same update":
 * identical target versions per dependency. PRs whose body has no version
 * table (GitHub Actions, orb digests) fall back to their title.
 */
export function getGroupKey(pullRequest) {
  if (pullRequest.updates.length === 0) {
    return `title:${pullRequest.title}`;
  }
  const targets = new Set(pullRequest.updates.map((update) => `${update.dependency}@${update.to}`));
  return [...targets].sort().join('\n');
}

/**
 * Build cross-repository groups and mark in-repository supersession.
 *
 *   base-ui#5699  pnpm 11.26.0 → 12.4.1 ┐
 *   mosaic#524    pnpm 11.25.0 → 12.4.1 ├─ group g1 (pnpm@12.4.1)
 *   mui-x#23516   pnpm 11.25.0 → 12.4.1 ┘
 *   mosaic#522    pnpm 11.25.0 → 11.26.0 ── supersededBy: 524
 *
 * Mutates each PR with `group` and, when a same-repo PR targets every
 * dependency of this one at a higher version, `supersededBy`.
 */
export function groupPullRequests(pullRequests) {
  const groupsByKey = new Map();
  for (const pullRequest of pullRequests) {
    const key = getGroupKey(pullRequest);
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, {
        id: null,
        key,
        kind: pullRequest.updates.length === 0 ? 'title' : 'updates',
        updates: [...new Set(pullRequest.updates.map((u) => `${u.dependency}@${u.to}`))].sort(),
        pullRequests: [],
      });
    }
    groupsByKey.get(key).pullRequests.push({
      repository: pullRequest.repository,
      number: pullRequest.number,
    });
  }

  // Bigger groups first so one decision covers the most PRs; ties by key for stability.
  const groups = [...groupsByKey.values()].sort(
    (left, right) =>
      right.pullRequests.length - left.pullRequests.length || left.key.localeCompare(right.key),
  );
  groups.forEach((group, index) => {
    group.id = `g${index + 1}`;
  });
  const idByKey = new Map(groups.map((group) => [group.key, group.id]));
  for (const pullRequest of pullRequests) {
    pullRequest.group = idByKey.get(getGroupKey(pullRequest));
    pullRequest.supersededBy = null;
  }

  // Supersession: same repository, same dependency set, strictly newer targets.
  const dependencySet = (pullRequest) =>
    [...new Set(pullRequest.updates.map((update) => update.dependency))].sort().join('\n');
  for (const pullRequest of pullRequests) {
    if (pullRequest.updates.length === 0) {
      continue;
    }
    const newer = pullRequests.find(
      (other) =>
        other !== pullRequest &&
        other.repository === pullRequest.repository &&
        dependencySet(other) === dependencySet(pullRequest) &&
        pullRequest.updates.every((update) => {
          const match = other.updates.find(
            (candidate) => candidate.dependency === update.dependency,
          );
          return match !== undefined && compareVersions(match.to, update.to) > 0;
        }),
    );
    if (newer) {
      pullRequest.supersededBy = newer.number;
    }
  }
  return groups;
}

/**
 * Dependencies touched by more than one PR at any version, so near-duplicate
 * groups (vitest@5.0.0 vs vitest@^5.0.0) are still reviewed together.
 */
export function indexDependencies(pullRequests) {
  const byDependency = new Map();
  for (const pullRequest of pullRequests) {
    for (const update of pullRequest.updates) {
      if (!byDependency.has(update.dependency)) {
        byDependency.set(update.dependency, []);
      }
      byDependency.get(update.dependency).push({
        repository: pullRequest.repository,
        number: pullRequest.number,
        to: update.to,
      });
    }
  }
  return [...byDependency]
    .filter(([, entries]) => entries.length > 1)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([name, entries]) => ({ name, pullRequests: entries }));
}

/**
 * Per-repository hints for shared root causes: check names failing on
 * several PRs, and the base branch tip so stale heads stand out.
 */
export function summarizeRepository(repository, pullRequests, baseHead) {
  const failures = new Map();
  for (const pullRequest of pullRequests) {
    for (const name of new Set(pullRequest.failedChecks.map((check) => check.name))) {
      if (!failures.has(name)) {
        failures.set(name, []);
      }
      failures.get(name).push(pullRequest.number);
    }
  }
  const commonFailures = [...failures]
    .filter(([, numbers]) => numbers.length >= 2)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .map(([name, numbers]) => ({ name, pullRequests: numbers.sort((a, b) => a - b) }));
  return {
    repository,
    openPullRequests: pullRequests.length,
    baseHead,
    commonFailures,
  };
}
