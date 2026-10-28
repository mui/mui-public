import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureDemoPages, findDemoExportName, generatePageFileContent } from './ensureDemoPages';
import { fileExists } from './fileUtils';

const FILE_PATH = path.resolve('/repo/docs/app/x/demos/y/index.ts');

/**
 * Runs `callback` against a fresh temporary directory and removes it afterwards.
 * Keeps each test self-contained without a shared beforeEach/afterEach.
 */
async function withTempDir(callback: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ensure-demo-pages-'));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes a demo `index.ts` under `app/components/demos/<slug>/` and returns its directory. */
async function writeDemo(baseDir: string, slug: string, source: string): Promise<string> {
  const demoDir = path.join(baseDir, 'app', 'components', 'demos', slug);
  await mkdir(demoDir, { recursive: true });
  await writeFile(path.join(demoDir, 'index.ts'), source, 'utf-8');
  return demoDir;
}

const PATTERN = './app/**/demos/*/index.ts';

describe('generatePageFileContent', () => {
  it('renders the demo from a Page component', () => {
    expect(generatePageFileContent('DemoButton')).toMatchInlineSnapshot(`
      "import * as React from 'react';
      import { DemoButton } from '.';

      export default function Page() {
        return <DemoButton />;
      }
      "
    `);
  });
});

describe('findDemoExportName', () => {
  it('reads the export name from a single-component demo', async () => {
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import { Button } from './Button';`,
      ``,
      `export const DemoButton = createDemo(import.meta.url, Button);`,
      ``,
    ].join('\n');
    expect(await findDemoExportName(source, FILE_PATH)).toBe('DemoButton');
  });

  it('reads the export name when the factory has a meta object', async () => {
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import { Checkbox } from './Checkbox';`,
      ``,
      `export const DemoCheckbox = createDemo(import.meta.url, Checkbox, {`,
      `  name: 'Checkbox',`,
      `  slug: 'checkbox',`,
      `});`,
      ``,
    ].join('\n');
    expect(await findDemoExportName(source, FILE_PATH)).toBe('DemoCheckbox');
  });

  it('reads the export name from a variants demo', async () => {
    const source = [
      `import { createDemoWithVariants } from '@/functions/createDemo';`,
      `import { Tabs } from './Tabs';`,
      `import { TabsJs } from './TabsJs';`,
      ``,
      `export const DemoTabs = createDemoWithVariants(import.meta.url, {`,
      `  Default: Tabs,`,
      `  JavaScript: TabsJs,`,
      `});`,
      ``,
    ].join('\n');
    expect(await findDemoExportName(source, FILE_PATH)).toBe('DemoTabs');
  });

  it('returns null when the demo has no named export', async () => {
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import { Button } from './Button';`,
      ``,
      `export default createDemo(import.meta.url, Button);`,
      ``,
    ].join('\n');
    expect(await findDemoExportName(source, FILE_PATH)).toBeNull();
  });

  it('skips an unnamed factory call and returns the named export', async () => {
    // An unexported `const helper = create*()` is keyed as "unknown"; the filter
    // must skip it and return the real named export rather than fall through.
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import { Button } from './Button';`,
      ``,
      `const helper = createDemo(import.meta.url, Button);`,
      `export const DemoButton = createDemo(import.meta.url, Button);`,
      ``,
    ].join('\n');
    expect(await findDemoExportName(source, FILE_PATH)).toBe('DemoButton');
  });
});

describe('ensureDemoPages', () => {
  const demoSource = [
    `import { createDemo } from '@/functions/createDemo';`,
    `import { Button } from './Button';`,
    ``,
    `export const DemoButton = createDemo(import.meta.url, Button);`,
    ``,
  ].join('\n');

  it('creates a page.tsx that renders the demo when none exists', async () => {
    await withTempDir(async (dir) => {
      const demoDir = await writeDemo(dir, 'button', demoSource);

      const result = await ensureDemoPages({ baseDir: dir, requirements: [{ pattern: PATTERN }] });

      expect(result.demoCount).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.updatedFiles).toEqual([path.relative(dir, path.join(demoDir, 'page.tsx'))]);
      // The generator never writes a page.ts; the route lives in page.tsx.
      expect(await fileExists(path.join(demoDir, 'page.ts'))).toBe(false);

      // Quote style depends on the prettier config resolved for the output path,
      // so assert structure rather than an exact quote character.
      const generated = await readFile(path.join(demoDir, 'page.tsx'), 'utf-8');
      expect(generated).toMatch(/import \* as React from ['"]react['"];/);
      expect(generated).toMatch(/import \{ DemoButton \} from ['"]\.['"];/);
      expect(generated).toMatch(/export default function Page\(\) \{/);
      expect(generated).toMatch(/return <DemoButton \/>;/);
    });
  });

  it('does not overwrite an existing page.tsx', async () => {
    await withTempDir(async (dir) => {
      const demoDir = await writeDemo(dir, 'button', demoSource);
      const existing = `export { DemoButton as default } from '.';\n`;
      await writeFile(path.join(demoDir, 'page.tsx'), existing, 'utf-8');

      const result = await ensureDemoPages({ baseDir: dir, requirements: [{ pattern: PATTERN }] });

      expect(result.demoCount).toBe(1);
      expect(result.updatedFiles).toEqual([]);
      expect(await fileExists(path.join(demoDir, 'page.ts'))).toBe(false);
      expect(await readFile(path.join(demoDir, 'page.tsx'), 'utf-8')).toBe(existing);
    });
  });

  it('does not create a page.tsx when a page.ts already exists', async () => {
    await withTempDir(async (dir) => {
      const demoDir = await writeDemo(dir, 'button', demoSource);
      const existing = `export { DemoButton as default } from '.';\n`;
      await writeFile(path.join(demoDir, 'page.ts'), existing, 'utf-8');

      const result = await ensureDemoPages({ baseDir: dir, requirements: [{ pattern: PATTERN }] });

      expect(result.updatedFiles).toEqual([]);
      expect(await fileExists(path.join(demoDir, 'page.tsx'))).toBe(false);
      expect(await readFile(path.join(demoDir, 'page.ts'), 'utf-8')).toBe(existing);
    });
  });

  it('reports an error and skips demos without a named export', async () => {
    await withTempDir(async (dir) => {
      const anonymousSource = [
        `import { createDemo } from '@/functions/createDemo';`,
        `import { Button } from './Button';`,
        ``,
        `export default createDemo(import.meta.url, Button);`,
        ``,
      ].join('\n');
      const demoDir = await writeDemo(dir, 'button', anonymousSource);

      const result = await ensureDemoPages({ baseDir: dir, requirements: [{ pattern: PATTERN }] });

      expect(result.updatedFiles).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(await fileExists(path.join(demoDir, 'page.tsx'))).toBe(false);
    });
  });

  it('returns early when no patterns opted in', async () => {
    const result = await ensureDemoPages({ baseDir: process.cwd(), requirements: [] });
    expect(result).toEqual({ demoCount: 0, updatedFiles: [], errors: [] });
  });
});
