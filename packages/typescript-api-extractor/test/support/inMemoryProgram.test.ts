import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { createInMemoryProgram } from './inMemoryProgram';

function getSemanticDiagnosticMessages(program: ts.Program): string[] {
	return program
		.getSemanticDiagnostics()
		.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

it('delegates package imports to TypeScript module resolution', () => {
	const program = createInMemoryProgram(
		path.resolve(__dirname, 'virtual/package-import.ts'),
		"import type { Node } from 'typescript';\nexport type SourceNode = Node;",
	);

	// Package imports are outside the virtual file map, so the helper must fall
	// through to TypeScript's resolver instead of treating them as unresolved.
	expect(getSemanticDiagnosticMessages(program)).toEqual([]);
});

it('delegates path-mapped imports to TypeScript module resolution', () => {
	const program = createInMemoryProgram(
		{
			'/virtual/input.ts':
				"import type { Value } from '@lib/value';\nexport interface Box { value: Value }",
			'/virtual/lib/value.ts': 'export interface Value { id: string }',
		},
		{
			baseUrl: '/virtual',
			paths: {
				'@lib/*': ['lib/*'],
			},
		},
	);

	// TypeScript's resolver knows how to combine `baseUrl`, `paths`, and the
	// host's virtual file lookups; the local relative-file resolver does not.
	expect(getSemanticDiagnosticMessages(program)).toEqual([]);
	expect(program.getSourceFile('/virtual/lib/value.ts')).toBeDefined();
});
