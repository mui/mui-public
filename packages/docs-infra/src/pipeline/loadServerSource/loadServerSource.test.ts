import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line n/prefer-node-protocol
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import { tmpdir } from 'os';
// eslint-disable-next-line n/prefer-node-protocol
import { join, dirname } from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { pathToFileURL } from 'url';
import { createLoadServerSource } from './loadServerSource';

describe('loadServerSource extraFiles emission', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'load-server-source-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFiles(files: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.entries(files).map(async ([relPath, contents]) => {
        const absPath = join(tmpDir, relPath);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, contents, 'utf8');
      }),
    );
  }

  function fileUrl(relPath: string): string {
    return pathToFileURL(join(tmpDir, relPath)).href;
  }

  describe('CSS files', () => {
    it('emits a plain URL string when the import key resolves to the file URL', async () => {
      // In canonical mode, the key (e.g. './sibling.css') is preserved and
      // resolves to the actual file URL when joined with the source URL, so
      // no `relativeUrl` is needed.
      await writeFiles({
        'src/main.css': "@import './sibling.css';\n",
        'src/sibling.css': 'body { color: red; }\n',
      });

      const loadSource = createLoadServerSource({ storeAt: 'canonical' });
      const result = await loadSource(fileUrl('src/main.css'));

      expect(result.extraFiles).toBeDefined();
      const entry = result.extraFiles!['./sibling.css'];
      expect(typeof entry).toBe('string');
      expect(entry).toBe(fileUrl('src/sibling.css'));
    });

    it('emits a plain URL string when the key was rewritten (flat mode)', async () => {
      // The `flat` mode flattens an `../` import to the entry's directory,
      // so the rewritten key no longer resolves to the file's URL on its own.
      // The emitted string still points at the actual file URL — it's up to
      // `loadCodeVariant` to derive any `relativeUrl` for the consumer.
      await writeFiles({
        'src/lib/code.css': "@import '../styles.css';\n",
        'src/styles.css': 'body {}\n',
      });

      const loadSource = createLoadServerSource({ storeAt: 'flat' });
      const result = await loadSource(fileUrl('src/lib/code.css'));

      expect(result.extraFiles).toBeDefined();
      const entry = result.extraFiles!['./styles.css'];
      expect(typeof entry).toBe('string');
      expect(entry).toBe(fileUrl('src/styles.css'));
    });
  });

  describe('JS/TS files', () => {
    it('emits a plain URL string in flat mode for ../ imports', async () => {
      await writeFiles({
        'src/lib/code.ts': "import { helper } from '../helper';\nexport const x = helper();\n",
        'src/helper.ts': 'export const helper = () => 1;\n',
      });

      const loadSource = createLoadServerSource({ storeAt: 'flat' });
      const result = await loadSource(fileUrl('src/lib/code.ts'));

      expect(result.extraFiles).toBeDefined();
      // The flat-mode key gains an explicit extension and is rooted at the entry.
      const keys = Object.keys(result.extraFiles!);
      expect(keys).toHaveLength(1);
      const [key] = keys;
      const entry = result.extraFiles![key];

      // The plain string carries the actual file URL, which is what
      // `loadCodeVariant` needs in order to recurse and derive the
      // entry-anchored `relativeUrl` for the consumer.
      expect(typeof entry).toBe('string');
      expect(entry).toBe(fileUrl('src/helper.ts'));
    });

    it('emits a plain URL string in canonical mode when the key already points at the file', async () => {
      await writeFiles({
        'src/lib/code.ts': "import { helper } from '../helper';\nexport const x = helper();\n",
        'src/helper.ts': 'export const helper = () => 1;\n',
      });

      const loadSource = createLoadServerSource({ storeAt: 'canonical' });
      const result = await loadSource(fileUrl('src/lib/code.ts'));

      expect(result.extraFiles).toBeDefined();
      const keys = Object.keys(result.extraFiles!);
      expect(keys).toHaveLength(1);
      const [key] = keys;
      const entry = result.extraFiles![key];

      // The canonical key resolves to the helper file URL on its own.
      expect(typeof entry).toBe('string');
      expect(new URL(key, fileUrl('src/lib/code.ts')).href).toBe(entry);
      expect(entry).toBe(fileUrl('src/helper.ts'));
    });
  });

  it('omits extraFiles entirely when there are no relative imports', async () => {
    await writeFiles({
      'src/standalone.ts': "import * as React from 'react';\nexport const x = 1;\n",
    });

    const loadSource = createLoadServerSource({ storeAt: 'flat' });
    const result = await loadSource(fileUrl('src/standalone.ts'));

    expect(result.extraFiles).toBeUndefined();
  });
});
