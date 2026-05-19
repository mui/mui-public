import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  addClientProviderToIndex,
  generateClientFileContent,
  resolveRequireClientSpecifier,
} from './ensureDemoClients';

describe('generateClientFileContent', () => {
  it('produces a use-client module that imports from the configured path', () => {
    expect(generateClientFileContent('../createDemoClient')).toMatchInlineSnapshot(`
      "'use client';

      import { createDemoClient } from '../createDemoClient';

      const ClientProvider = createDemoClient(import.meta.url);

      export default ClientProvider;
      "
    `);
  });
});

describe('resolveRequireClientSpecifier', () => {
  const configDir = path.resolve('/repo/docs');

  it('passes bare specifiers through unchanged', () => {
    expect(
      resolveRequireClientSpecifier(
        '@/functions/createDemoClient',
        configDir,
        path.resolve('/repo/docs/app/x/demos/y'),
      ),
    ).toBe('@/functions/createDemoClient');
    expect(
      resolveRequireClientSpecifier(
        'some-package/createDemoClient',
        configDir,
        path.resolve('/repo/docs/app/x/demos/y'),
      ),
    ).toBe('some-package/createDemoClient');
  });

  it('rewrites a relative specifier to be relative to the client directory', () => {
    // Specifier './functions/createDemoClient' relative to /repo/docs resolves to
    // /repo/docs/functions/createDemoClient. From /repo/docs/app/x/demos/y that's
    // ../../../../functions/createDemoClient.
    expect(
      resolveRequireClientSpecifier(
        './functions/createDemoClient',
        configDir,
        path.resolve('/repo/docs/app/x/demos/y'),
      ),
    ).toBe('../../../../functions/createDemoClient');
  });

  it('keeps a leading ./ when the resolved path is in the same directory', () => {
    expect(
      resolveRequireClientSpecifier(
        './createDemoClient',
        path.resolve('/repo/docs/app/x/demos'),
        path.resolve('/repo/docs/app/x/demos/y'),
      ),
    ).toBe('../createDemoClient');

    expect(
      resolveRequireClientSpecifier(
        './createDemoClient',
        path.resolve('/repo/docs/app/x/demos/y'),
        path.resolve('/repo/docs/app/x/demos/y'),
      ),
    ).toBe('./createDemoClient');
  });
});

describe('addClientProviderToIndex', () => {
  const filePath = '/repo/app/demos/example/index.ts';

  it('returns null when ClientProvider is already wired up', async () => {
    const source = [
      `import { createLiveDemo } from '../createLiveDemo';`,
      `import ClientProvider from './client';`,
      `import CheckboxBasic from './CheckboxBasic';`,
      ``,
      `export const DemoCheckboxBasic = createLiveDemo(import.meta.url, CheckboxBasic, {`,
      `  name: 'Basic Checkbox',`,
      `  slug: 'basic-checkbox',`,
      `  ClientProvider,`,
      `});`,
      ``,
    ].join('\n');

    expect((await addClientProviderToIndex(source, filePath)).content).toBeNull();
  });

  it('adds the import and meta property when both are missing', async () => {
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import { BasicCode } from './BasicCode';`,
      ``,
      `export const DemoCodeBasic = createDemo(import.meta.url, BasicCode, {`,
      `  name: 'Simple Code Block',`,
      `  slug: 'simple-code-block',`,
      `});`,
      ``,
    ].join('\n');

    const result = await addClientProviderToIndex(source, filePath);
    expect(result.content).toMatchInlineSnapshot(`
      "import { createDemo } from '@/functions/createDemo';
      import { BasicCode } from './BasicCode';
      import ClientProvider from './client';

      export const DemoCodeBasic = createDemo(import.meta.url, BasicCode, { name: 'Simple Code Block', slug: 'simple-code-block', ClientProvider });
      "
    `);
  });

  it('only adds the meta property when the import is already present', async () => {
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import ClientProvider from './client';`,
      `import { BasicCode } from './BasicCode';`,
      ``,
      `export const DemoCodeBasic = createDemo(import.meta.url, BasicCode, {`,
      `  name: 'Simple Code Block',`,
      `});`,
      ``,
    ].join('\n');

    const result = await addClientProviderToIndex(source, filePath);
    expect(result.content).toContain(`import ClientProvider from './client';`);
    expect(result.content?.match(/import ClientProvider/g)?.length).toBe(1);
    expect(result.content).toContain('ClientProvider');
  });

  it('appends a new meta object when the call has no options argument', async () => {
    const source = [
      `import { createDemo } from '@/functions/createDemo';`,
      `import { BasicCode } from './BasicCode';`,
      ``,
      `export const DemoCodeBasic = createDemo(import.meta.url, BasicCode);`,
      ``,
    ].join('\n');

    const result = await addClientProviderToIndex(source, filePath);
    expect(result.content).toContain('ClientProvider');
    expect(result.content).toContain(`import ClientProvider from './client';`);
  });

  it('returns null when no create* call can be located', async () => {
    const source = `export const value = 1;\n`;
    expect((await addClientProviderToIndex(source, filePath)).content).toBeNull();
  });

  it('handles trailing commas after the options object', async () => {
    // Regression: the previous home-grown helper inserted a stray second arg here.
    const source = [
      `import { createDemoWithProvider } from '@/functions/createDemoWithProvider';`,
      `import { MultiFileEditor } from './MultiFileEditor';`,
      ``,
      `export const DemoCodeControllerMultiFile = createDemoWithProvider(`,
      `  import.meta.url,`,
      `  MultiFileEditor,`,
      `  {`,
      `    name: 'Multi-File Editor',`,
      `    slug: 'multi-file-editor',`,
      `  },`,
      `);`,
      ``,
    ].join('\n');

    const result = await addClientProviderToIndex(source, filePath);
    expect(result.content).toMatchInlineSnapshot(`
      "import { createDemoWithProvider } from '@/functions/createDemoWithProvider';
      import { MultiFileEditor } from './MultiFileEditor';
      import ClientProvider from './client';

      export const DemoCodeControllerMultiFile = createDemoWithProvider(import.meta.url, MultiFileEditor, { name: 'Multi-File Editor', slug: 'multi-file-editor', ClientProvider });
      "
    `);
  });
});
