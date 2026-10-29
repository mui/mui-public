import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
import prettier from 'prettier';
import { loadConfig, parseFromProgram } from '../src';

const regenerateOutput = process.env.UPDATE_OUTPUT === 'true';
const fixturesDir = path.resolve(__dirname, 'fixtures');

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

    if (regenerateOutput) {
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

    if (!fs.existsSync(expectedOutput)) {
      throw new Error(
        `Missing ${path.relative(process.cwd(), expectedOutput)}. Generate it with \`UPDATE_OUTPUT=true pnpm test --run --project @mui/internal-typescript-api-extractor\` and review the result.`,
      );
    }

    expect(JSON.parse(JSON.stringify(moduleDefinition))).toEqual(
      JSON.parse(fs.readFileSync(expectedOutput, 'utf8')),
    );
  });
}
