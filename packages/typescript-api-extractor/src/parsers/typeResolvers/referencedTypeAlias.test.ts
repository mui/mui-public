import ts from 'typescript';
import { expect, it } from 'vitest';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';
import { getReferencedTypeAliasDeclaration } from './referencedTypeAlias';

it('resolves ordinary and import-type references through one alias path', () => {
	const filePath = '/virtual/referenced-type-alias.ts';
	const dependencyPath = '/virtual/referenced-type-alias-dependency.ts';
	const program = createInMemoryProgram({
		[filePath]: `import type { Pair as ImportedPair } from './referenced-type-alias-dependency';

export type ViaReference = ImportedPair<string>;
export type ViaImportType = import('./referenced-type-alias-dependency').Pair<string>;`,
		[dependencyPath]: 'export type Pair<T> = [T, T];',
	});
	const sourceFile = program.getSourceFile(filePath)!;
	const checker = program.getTypeChecker();
	const exportedAliases = sourceFile.statements.filter(ts.isTypeAliasDeclaration);

	expect(
		exportedAliases.map(
			(declaration) => getReferencedTypeAliasDeclaration(declaration.type, checker)?.name.text,
		),
	).toEqual(['Pair', 'Pair']);
});
