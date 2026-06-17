#!/usr/bin/env node

/* eslint-disable no-console */

import { $ } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parseDocument } from 'yaml';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import {
  readMinimumReleaseAge,
  isVersionTooFresh,
  parseReleaseAgeExclusion,
  getReleaseAgeExclude,
  addReleaseAgeExclusions,
  pruneReleaseAgeExclusions,
} from '../utils/pnpm.mjs';

/**
 * @typedef {Object} Args
 * @property {string[]} [spec] - `name@version` specifiers to exempt if too fresh
 * @property {boolean} [prune] - Also remove matured versioned exemptions
 * @property {boolean} [check] - Write nothing; exit non-zero if a change is needed
 */

/**
 * Fetch the registry's `version -> publish time` map for a package.
 * @param {string} packageName
 * @returns {Promise<Record<string, string>>}
 */
async function getPublishTimes(packageName) {
  const result = await $`pnpm view ${packageName} time --json`;
  return JSON.parse(result.stdout);
}

/**
 * Dependabot ignores pnpm's `minimumReleaseAge`, so a security PR can pin a
 * patch that is still too fresh for the policy — which both `pnpm update` here
 * and CI's `pnpm dedupe --check` reject. The only pnpm-native escape is a
 * `minimumReleaseAgeExclude` entry; scoping it to the exact `name@version` keeps
 * every other version of that package under the age gate. Such entries become
 * redundant once the version matures, so `--prune` cleans them up — but only the
 * ones this command added (tagged with a marker comment), never a hand-added
 * exemption.
 *
 * Only the `spec`s passed in are ever exempted — i.e. the packages Dependabot is
 * deliberately bumping (from its `updated-dependencies` metadata). Collateral
 * deps Dependabot floats as a side effect are *not* passed here; the calling
 * workflow drops them by rebuilding the lockfile from the base branch.
 *
 * Limitation: a version-scoped exemption covers only the named version. If a
 * fresh target also requires freshly-published *dependencies* (e.g. a monorepo
 * publishing siblings in lockstep), pnpm rejects those too (pnpm/pnpm#11068) and
 * the run fails loudly — a maintainer then waits or extends the exclude. This
 * matches the state of the art: Renovate respects pnpm's `minimumReleaseAge` and
 * hits the same wall (renovatebot/renovate#39168, #38766).
 *
 * @param {Args} args
 * @returns {Promise<void>}
 */
async function handler(args) {
  const specs = (args.spec ?? []).map(String);

  const workspaceDir = (await findWorkspaceDir(process.cwd())) ?? process.cwd();
  const workspaceYamlPath = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const doc = parseDocument(await fs.readFile(workspaceYamlPath, 'utf8'));

  const minAgeMinutes = readMinimumReleaseAge(doc);
  if (minAgeMinutes === null) {
    console.log('No minimumReleaseAge configured; nothing to do.');
    return;
  }
  const now = Date.now();

  // Add a versioned exemption for any target whose pinned version is too fresh.
  const tooFresh = [];
  for (const spec of specs) {
    const { name, versions } = parseReleaseAgeExclusion(spec);
    if (versions.length !== 1) {
      throw new Error(`Expected a "name@version" spec, received: ${spec}`);
    }
    const [version] = versions;
    // eslint-disable-next-line no-await-in-loop -- registry lookups are cheap and serial keeps logs readable
    const times = await getPublishTimes(name);
    if (isVersionTooFresh(times[version], now, minAgeMinutes)) {
      tooFresh.push(`${name}@${version}`);
    }
  }
  const added = addReleaseAgeExclusions(doc, tooFresh);

  // Optionally drop exemptions whose versions have all matured.
  /** @type {string[]} */
  let removed = [];
  if (args.prune) {
    const uniqueNames = [
      ...new Set(
        getReleaseAgeExclude(doc)
          .map(parseReleaseAgeExclusion)
          .filter((entry) => entry.versions.length > 0)
          .map((entry) => entry.name),
      ),
    ];
    /** @type {Map<string, Record<string, string>>} */
    const timesByName = new Map();
    await Promise.all(
      uniqueNames.map(async (name) => {
        timesByName.set(name, await getPublishTimes(name));
      }),
    );
    removed = pruneReleaseAgeExclusions(doc, (name, versions) => {
      const times = timesByName.get(name) ?? {};
      return versions.every(
        (version) =>
          Boolean(times[version]) && !isVersionTooFresh(times[version], now, minAgeMinutes),
      );
    });
  }

  if (added.length === 0 && removed.length === 0) {
    console.log('minimumReleaseAgeExclude already up to date.');
    return;
  }

  if (args.check) {
    if (added.length > 0) {
      console.error(`Would add to minimumReleaseAgeExclude: ${added.join(', ')}`);
    }
    if (removed.length > 0) {
      console.error(`Would remove from minimumReleaseAgeExclude: ${removed.join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  await fs.writeFile(workspaceYamlPath, doc.toString());
  if (added.length > 0) {
    console.log(`Added to minimumReleaseAgeExclude: ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    console.log(`Removed from minimumReleaseAgeExclude: ${removed.join(', ')}`);
  }
}

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'release-age-exclude [spec...]',
  describe:
    "Exempt too-fresh security bumps from pnpm's minimumReleaseAge by adding versioned minimumReleaseAgeExclude entries (and optionally pruning matured ones)",
  builder: (yargs) => {
    return yargs
      .positional('spec', {
        type: 'string',
        array: true,
        describe: '"name@version" specifiers to exempt when younger than minimumReleaseAge',
      })
      .option('prune', {
        type: 'boolean',
        default: false,
        describe: 'Remove versioned exemptions whose versions have all matured',
      })
      .option('check', {
        type: 'boolean',
        default: false,
        describe: 'Write nothing; exit non-zero if any entry would be added or removed',
      });
  },
  handler,
});
