import { describe, it, expect, onTestFinished } from 'vitest';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOptimizedProgram } from './createOptimizedProgram';
import { loadTypescriptConfig } from './loadTypescriptConfig';

/**
 * Writes `files` into a fresh temp directory that is removed when the test finishes.
 * Object contents are serialized as JSON.
 */
async function createFixture(files: Record<string, unknown>): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'create-optimized-program-')));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(dir, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        typeof content === 'string' ? content : JSON.stringify(content),
        'utf-8',
      );
    }),
  );
  return dir;
}

describe('createOptimizedProgram', () => {
  it('resolves imports through paths inherited from an extended tsconfig', async () => {
    const dir = await createFixture({
      'tsconfig.base.json': { compilerOptions: { paths: { '@lib/*': ['./lib/*'] } } },
      'lib/Button.ts': 'export interface ButtonProps { disabled?: boolean }',
      'docs/tsconfig.json': { extends: '../tsconfig.base.json', files: ['index.ts'] },
      'docs/index.ts': "export type { ButtonProps } from '@lib/Button';",
    });
    const projectPath = path.join(dir, 'docs');
    const entrypoint = path.join(projectPath, 'index.ts');
    const config = await loadTypescriptConfig(path.join(projectPath, 'tsconfig.json'));

    const program = createOptimizedProgram(projectPath, config.options, [entrypoint]);

    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entrypoint)!)!;
    const buttonProps = checker.getExportsOfModule(moduleSymbol)[0];
    const declarations = checker.getAliasedSymbol(buttonProps).declarations ?? [];
    expect(declarations.map((declaration) => declaration.getSourceFile().fileName)).toEqual([
      path.join(dir, 'lib/Button.ts'),
    ]);
  });
});
