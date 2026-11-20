import { describe, expect, it } from 'vitest';

import { makeTempDir } from './testUtils.mjs';
import { getPublishedPkgJson } from './getPublishedPkgJson.mjs';

describe('getPublishedPkgJson', () => {
  it('publishes publishConfig.scripts as scripts', async () => {
    const cwd = await makeTempDir();

    const published = await getPublishedPkgJson({
      packageJson: {
        name: 'pkg',
        scripts: { build: 'code-infra build' },
        publishConfig: {
          access: 'public',
          directory: 'build',
          scripts: { postinstall: 'node ./postinstall/index.mjs' },
        },
      },
      bundles: ['esm'],
      outputDir: cwd,
      cwd,
      addTypes: false,
      packageType: 'module',
    });

    expect(published.scripts).toEqual({ postinstall: 'node ./postinstall/index.mjs' });
    expect(published.publishConfig).toEqual({ access: 'public' });
  });
});
