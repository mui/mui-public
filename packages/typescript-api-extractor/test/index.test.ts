import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { it, expect } from 'vitest';
import glob from 'fast-glob';
import prettier from 'prettier';
import { loadConfig, parseFromProgram } from '../src';

const regenerateOutput = process.env.UPDATE_OUTPUT === 'true';
const fixturesDir = path.resolve(__dirname, 'fixtures');

let testCases = glob.sync('**/input.{d.ts,ts,tsx}', { absolute: true, cwd: fixturesDir });
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

	it.skipIf(testCase.includes('.skip'))(testName, async () => {
		const moduleDefinition = parseFromProgram(testCase, program);

		if (!regenerateOutput && fs.existsSync(expectedOutput)) {
			expect(JSON.parse(JSON.stringify(moduleDefinition))).toEqual(
				JSON.parse(fs.readFileSync(expectedOutput, 'utf8')),
			);
		} else {
			fs.writeFileSync(
				expectedOutput,
				await prettier.format(JSON.stringify(moduleDefinition, null, '\t'), {
					...(await prettier.resolveConfig(expectedOutput)),
					filepath: expectedOutput,
				}),
			);
		}
	});
}
