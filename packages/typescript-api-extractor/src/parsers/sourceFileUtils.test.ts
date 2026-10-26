import ts from 'typescript';
import { expect, it } from 'vitest';
import {
	declarationHasNodeModulesPathSegment,
	hasNodeModulesPathSegment,
	isNodeModulesDeclaration,
	isNodeModulesSourceFile,
} from './sourceFileUtils';

function createTypeAliasSourceFile(fileName: string) {
	const sourceFile = ts.createSourceFile(
		fileName,
		'type Value = string;',
		ts.ScriptTarget.Latest,
		true,
	);
	const declaration = sourceFile.statements[0];
	if (!declaration || !ts.isTypeAliasDeclaration(declaration)) {
		throw new Error('Expected a type alias declaration');
	}
	return { sourceFile, declaration };
}

it.each([
	'/project/node_modules/pkg/index.d.ts',
	'C:\\project\\node_modules\\pkg\\index.d.ts',
	'/project/node_modules_backup/pkg/index.d.ts',
	'/project/my_node_modules/pkg/index.d.ts',
])('recognizes paths containing node_modules according to parser policy: %s', (fileName) => {
	const { sourceFile, declaration } = createTypeAliasSourceFile(fileName);

	expect(isNodeModulesSourceFile(sourceFile)).toBe(true);
	expect(isNodeModulesDeclaration(declaration)).toBe(true);
});

it.each(['/project/node_modules/pkg/index.d.ts', 'C:\\project\\node_modules\\pkg\\index.d.ts'])(
	'recognizes actual node_modules path segments: %s',
	(fileName) => {
		const { sourceFile, declaration } = createTypeAliasSourceFile(fileName);

		expect(hasNodeModulesPathSegment(sourceFile)).toBe(true);
		expect(declarationHasNodeModulesPathSegment(declaration)).toBe(true);
	},
);

it.each(['/project/node_modules_backup/pkg/index.d.ts', '/project/my_node_modules/pkg/index.d.ts'])(
	'ignores similarly named directories when matching path segments: %s',
	(fileName) => {
		const { sourceFile, declaration } = createTypeAliasSourceFile(fileName);

		expect(hasNodeModulesPathSegment(sourceFile)).toBe(false);
		expect(declarationHasNodeModulesPathSegment(declaration)).toBe(false);
	},
);
