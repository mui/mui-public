import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
import prettier from 'prettier';
import { loadConfig, parseFromProgram } from '../src';

const regenerateOutput = process.env.UPDATE_OUTPUT === 'true';
const fixturesDir = path.resolve(__dirname, 'fixtures');

// Every fixture shares one program, and some output depends on what the checker evaluated
// earlier: TypeScript orders union members (and the `keyof`, `Pick` and `Omit` results built
// from them) by internal type id, which is assigned on first use. Sorting keeps parse order,
// and with it the expected output, stable. Extraction independent of checker history is a
// known gap, deliberately left open; do not drop the sort until it is closed.
let testCases = fs
  .globSync('**/input.{d.ts,ts,tsx}', { cwd: fixturesDir })
  .sort()
  .map((testCase) => path.join(fixturesDir, testCase));
if (testCases.some((t) => t.includes('.only'))) {
  testCases = testCases.filter((t) => t.includes('.only'));
}

const program = ts.createProgram(
  testCases,
  loadConfig(path.resolve(__dirname, 'tsconfig.json')).options,
);

for (const testCase of testCases) {
  const dirname = path.dirname(testCase);
  const testName = dirname.slice(fixturesDir.length + 1);
  const expectedOutput = path.join(dirname, 'output.json');

  // eslint-disable-next-line vitest/valid-title -- the title is the fixture directory name
  it.skipIf(testCase.includes('.skip'))(testName, async () => {
    const moduleDefinition = parseFromProgram(testCase, program);

    if (regenerateOutput || !fs.existsSync(expectedOutput)) {
      fs.writeFileSync(
        expectedOutput,
        // Fixtures keep the tab indentation they were written with; the repository config
        // would reindent every file on regeneration.
        await prettier.format(JSON.stringify(moduleDefinition, null, '\t'), {
          filepath: expectedOutput,
          useTabs: true,
          printWidth: 100,
        }),
      );
      return;
    }

    expect(JSON.parse(JSON.stringify(moduleDefinition))).toEqual(
      JSON.parse(fs.readFileSync(expectedOutput, 'utf8')),
    );
  });
}
