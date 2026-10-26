import ts from 'typescript';
import { type ParserWarning } from '../../src/parser';
import { createParserContext } from '../../src/parserContextFactory';
import { type ScopedParserContext } from '../../src/parserContext';

export interface TestParserContext {
	context: ScopedParserContext;
	warnings: ParserWarning[];
}

/**
 * Builds the production ScopedParserContext while capturing warnings into an
 * array. Used to exercise resolveType / TypeResolutionSession directly.
 */
export function createTestParserContext(program: ts.Program, filePath: string): TestParserContext {
	const checker = program.getTypeChecker();
	const sourceFile = program.getSourceFile(filePath);
	if (!sourceFile) {
		throw new Error(`Program doesn't contain file: "${filePath}"`);
	}

	const warnings: ParserWarning[] = [];
	const context = createParserContext(checker, sourceFile, program, {
		shouldInclude: () => true,
		shouldResolveObject: () => true,
		onWarning: (warning) => {
			warnings.push(warning);
		},
	});

	return { context, warnings };
}
