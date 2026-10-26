import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { loadConfig, parseFromProgram } from '../index';

const returnTypesInput = path.resolve(
	__dirname,
	'../../test/fixtures/react-component-return-types/input.tsx',
);
const program = ts.createProgram(
	[returnTypesInput],
	loadConfig(path.resolve(__dirname, '../../test/tsconfig.json')).options,
);

function classifyExports(includeExternalTypes: boolean): Record<string, string> {
	const moduleDefinition = parseFromProgram(returnTypesInput, program, {
		includeExternalTypes,
		onWarning: () => {},
	});

	return Object.fromEntries(
		moduleDefinition.exports.map((exportNode) => [exportNode.name, exportNode.type.kind]),
	);
}

const expectedClassification = {
	NamespacedElement: 'component',
	BareElement: 'component',
	GenericElement: 'component',
	BareNode: 'component',
	NullableElement: 'component',
	InferredElement: 'component',
	LocalElementType: 'function',
	DomElementType: 'function',
};

it('recognizes React return types without mistaking lookalikes for components', () => {
	expect(classifyExports(false)).toEqual(expectedClassification);
});

// `includeExternalTypes` decides whether React's types are summarized as
// external references or expanded into objects and unions. That is a choice
// about output detail, so it must not change what counts as a component.
it('detects the same components whether external types are summarized or expanded', () => {
	expect(classifyExports(true)).toEqual(expectedClassification);
});
