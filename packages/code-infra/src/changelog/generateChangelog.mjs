import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadChangelogConfig } from './loadChangelogConfig.mjs';
import { configView } from './configView.mjs';
import { fetchReleaseFacts } from './fetchReleaseFacts.mjs';

const DEFAULT_CONFIG = 'scripts/changelog.config.mjs';

/**
 * @typedef {import('./types.ts').GenerateChangelogOptions} GenerateChangelogOptions
 * @typedef {import('./types.ts').GenerateChangelogResult} GenerateChangelogResult
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 */

/**
 * Generates a changelog for a release.
 *
 * With `prepare` and `view`, renders the release facts with the repository's own code. Otherwise
 * renders `config`, or the module at the config path: a config object, or a preset exporting
 * `prepare` and `view`.
 *
 * @template Prepared
 * @overload
 * @param {Omit<GenerateChangelogOptions, 'config'> & import('./types.ts').ChangelogPreset<Prepared>} options
 * @returns {Promise<import('./types.ts').PresetChangelogResult<Prepared>>}
 */
/**
 * @overload
 * @param {GenerateChangelogOptions} [options]
 * @returns {Promise<GenerateChangelogResult>}
 */
/**
 * @param {GenerateChangelogOptions & Partial<import('./types.ts').ChangelogPreset<any>>} [options]
 * @returns {Promise<any>}
 */
export async function generateChangelog(options = {}) {
  const cwd = await fs.realpath(options.cwd ?? process.cwd());

  const { preset, config } =
    options.prepare && options.view
      ? {
          preset: {
            prepare: options.prepare,
            view: options.view,
            cherryPickLabels: options.cherryPickLabels,
            includeDirectCommits: options.includeDirectCommits,
          },
          config: false,
        }
      : await loadPreset(options.config, cwd);

  const facts = await fetchReleaseFacts({
    cwd,
    repo: options.repo,
    org: options.org,
    lastRelease: options.lastRelease,
    release: options.release,
    version: options.version,
    date: options.date,
    octokit: options.octokit,
    cherryPickLabels: preset.cherryPickLabels,
    includeDirectCommits: preset.includeDirectCommits,
  });

  const prepared = preset.prepare(facts);
  const markdown = preset.view(prepared);

  if (!config) {
    return { markdown, facts, prepared };
  }

  return { markdown, sections: prepared.sections, contributors: prepared.contributors };
}

/**
 * @param {ChangelogConfig | string | undefined} config
 * @param {string} cwd
 * @returns {Promise<{ preset: import('./types.ts').ChangelogPreset<any>; config: boolean }>}
 */
async function loadPreset(config, cwd) {
  if (typeof config === 'object') {
    return { preset: configView(config), config: true };
  }

  const file = config ?? DEFAULT_CONFIG;
  const resolved = path.isAbsolute(file) ? file : path.join(cwd, file);
  const module = await import(pathToFileURL(resolved).href).catch(() => null);

  if (typeof module?.default?.view === 'function') {
    return { preset: module.default, config: false };
  }

  return { preset: configView(await loadChangelogConfig(file, cwd)), config: true };
}
