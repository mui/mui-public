import { describe, it, expect } from 'vitest';
import { absolutizeImports, SCOPE_IMPORT_PREFIX } from './absolutizeImports';

const P = SCOPE_IMPORT_PREFIX;

describe('absolutizeImports', () => {
  it('rewrites a parent import (`../`) resolved against the file directory', () => {
    const source = "import { root } from '../root';\nexport default () => root;";
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(
      `import { root } from '${P}root';\nexport default () => root;`,
    );
  });

  it('rewrites a child import from a root-level file', () => {
    const source = "import { thing } from './dir/file';\nexport default () => thing;";
    expect(absolutizeImports(source, 'root.ts')).toBe(
      `import { thing } from '${P}dir/file';\nexport default () => thing;`,
    );
  });

  it('rewrites a sibling import relative to the file directory', () => {
    const source = "import { x } from './sibling';";
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(`import { x } from '${P}dir/sibling';`);
  });

  it('resolves deep relative paths (`../`, `../../`, `./`)', () => {
    const source = [
      "import a from '../../top';",
      "import b from '../mid';",
      "import c from './leaf';",
    ].join('\n');
    expect(absolutizeImports(source, 'a/b/file.ts')).toBe(
      [
        `import a from '${P}top';`, // a/b + ../../top -> top
        `import b from '${P}a/mid';`, // a/b + ../mid -> a/mid
        `import c from '${P}a/b/leaf';`, // a/b + ./leaf -> a/b/leaf
      ].join('\n'),
    );
  });

  it('leaves external (bare) specifiers untouched', () => {
    const source = "import * as React from 'react';\nimport { x } from './local';";
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(
      `import * as React from 'react';\nimport { x } from '${P}dir/local';`,
    );
  });

  it('rewrites a CSS-module import, preserving the extension', () => {
    const source = "import styles from './theme.module.css';";
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(
      `import styles from '${P}dir/theme.module.css';`,
    );
  });

  it('rewrites re-exports (`export ... from`)', () => {
    const source = "export { Thing } from '../shared';";
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(`export { Thing } from '${P}shared';`);
  });

  it('rewrites a dynamic `import()` specifier', () => {
    const source = "const Heavy = () => import('../widgets/Heavy');";
    expect(absolutizeImports(source, 'pages/Home.tsx')).toBe(
      `const Heavy = () => import('${P}widgets/Heavy');`,
    );
  });

  it('leaves a non-literal dynamic import untouched', () => {
    const source = 'const load = (name) => import(name);';
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(source);
  });

  it('rewrites every import and preserves the original quote style', () => {
    const source = `import a from "../a";\nimport b from './b';`;
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(
      `import a from "${P}a";\nimport b from '${P}dir/b';`,
    );
  });

  it('ignores specifiers that appear inside strings or comments', () => {
    const source = [
      "import { x } from './local';",
      "// import y from '../commented';",
      `const note = 'import z from "../inString"';`,
    ].join('\n');
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(
      [
        `import { x } from '${P}dir/local';`,
        "// import y from '../commented';",
        `const note = 'import z from "../inString"';`,
      ].join('\n'),
    );
  });

  it('parses as JS even when the file name has an .mdx extension', () => {
    // An `.mdx` name must not switch the scanner into MDX mode (where quotes stop
    // delimiting strings); the specifier inside the string must NOT be rewritten.
    const source = "import { x } from './real';\nconst note = \"import y from '../fake'\";";
    expect(absolutizeImports(source, 'dir/notes.mdx')).toBe(
      `import { x } from '${P}dir/real';\nconst note = "import y from '../fake'";`,
    );
  });

  it('preserves `..` that points above the demo root (parent-directory imports)', () => {
    // A canonical-mode demo keys a shared file outside the demo folder by its `../`
    // path; the importing specifier must resolve to that same `../`-prefixed key,
    // not be clamped or dropped.
    expect(absolutizeImports("import x from '../shared/util';", 'file.ts')).toBe(
      `import x from '${P}../shared/util';`,
    );
    expect(absolutizeImports("import x from '../../lib/x';", 'dir/file.ts')).toBe(
      `import x from '${P}../lib/x';`,
    );
    // A `..` that stays within the demo still collapses normally.
    expect(absolutizeImports("import y from '../sibling';", 'dir/file.ts')).toBe(
      `import y from '${P}sibling';`,
    );
  });

  it('returns the source unchanged when there are no relative imports', () => {
    const source = "import * as React from 'react';\nexport default () => null;";
    expect(absolutizeImports(source, 'dir/file.ts')).toBe(source);
  });
});
