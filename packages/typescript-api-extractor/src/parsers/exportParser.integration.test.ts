import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

const namespaceExternalAnonymousSource = 'export const thing: { value: number };';

it('preserves namespace type names when anonymous external members are namespace exported', () => {
	const filePath = '/virtual/namespace-external.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram({
			[filePath]: "export * as NS from './node_modules/pkg/index';",
			'/virtual/node_modules/pkg/index.d.ts': namespaceExternalAnonymousSource,
		}),
	);

	// Anonymous object declarations from external files can resolve through the
	// internal `__type` symbol. Export parsing must repair that name before
	// applying the namespace context so the public type path remains `NS.thing`.
	expect(moduleDefinition.exports[0]?.type).toMatchObject({
		kind: 'external',
		typeName: {
			name: 'thing',
			namespaces: ['NS'],
		},
	});
});

it('preserves the historical external-source policy for paths containing node_modules', () => {
	const filePath = '/virtual/external-substring.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram({
			[filePath]: "export { type Data } from './my_node_modules/pkg';",
			'/virtual/my_node_modules/pkg.ts': 'export interface Data { value: string; }',
		}),
	);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'Data',
		type: {
			kind: 'external',
			typeName: { name: 'Data' },
		},
	});
});

it('classifies a re-exported JSON default import as a plain value', () => {
	const filePath = '/virtual/json-import.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(
			{
				[filePath]: "import data from './data.json';\n\nexport { data };",
				'/virtual/data.json': '{ "value": 1 }',
			},
			{ resolveJsonModule: true, esModuleInterop: true },
		),
	);

	// The JSON module's synthetic `export=` property is declared by the JSON
	// source file, which does not make the imported object a namespace.
	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'data',
		isValue: true,
		isType: false,
		isNamespace: false,
	});
});

it('keeps the checker fallback spaces for a re-export from an unresolvable module', () => {
	const filePath = '/virtual/unresolvable.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, "export { Missing } from './missing';"),
	);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'Missing',
		isValue: true,
		isType: false,
		isNamespace: false,
	});
});

it('masks a type-only member of an `export =` namespace re-exported by name', () => {
	const filePath = '/virtual/export-equals-member.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram({
			[filePath]: "export { C, D } from './legacy';",
			'/virtual/c.ts': "export class C {\n  id = 'c';\n}",
			'/virtual/legacy.d.ts': `import { C as ImportedC } from './c';

declare function Service(): void;
declare namespace Service {
  export type { ImportedC as C };
  export class D {
    id: string;
  }
}

export = Service;`,
		}),
	);

	// Named imports of an `export =` module read the assigned namespace's members,
	// so a member exported with `export type` stays type-only downstream.
	expect(
		moduleDefinition.exports.map(({ name, isValue, isType }) => ({ name, isValue, isType })),
	).toEqual([
		{ name: 'C', isValue: false, isType: true },
		{ name: 'D', isValue: true, isType: true },
	]);
});

it('follows star exports of the module assigned with `export =`', () => {
	const filePath = '/virtual/export-equals-star.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram({
			[filePath]: "export { C } from './legacy';",
			'/virtual/c.ts': "export class C {\n  id = 'c';\n}",
			'/virtual/impl.ts': "export type * from './c';",
			'/virtual/legacy.ts': "import * as impl from './impl';\n\nexport = impl;",
		}),
	);

	expect(moduleDefinition.exports[0]).toMatchObject({ name: 'C', isValue: false, isType: true });
});

it('keeps the namespace space of an unresolvable namespace import', () => {
	const filePath = '/virtual/unresolvable-namespace.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(filePath, "import * as Missing from './missing';\n\nexport { Missing };"),
	);

	expect(moduleDefinition.exports[0]).toMatchObject({
		name: 'Missing',
		isValue: true,
		isNamespace: true,
	});
});

it('reads a default import of an `export =` module from the assignment itself', () => {
	const filePath = '/virtual/export-equals-default.ts';
	const moduleDefinition = parseFromProgram(
		filePath,
		createInMemoryProgram(
			{
				[filePath]: "import legacy from './legacy';\n\nexport { legacy };",
				'/virtual/c.ts': "export class C {\n  id = 'c';\n}",
				'/virtual/impl.ts': "import { C } from './c';\n\nexport type { C as default };",
				'/virtual/legacy.ts': "import * as impl from './impl';\n\nexport = impl;",
			},
			{ esModuleInterop: true },
		),
	);

	// The synthetic default is the assigned module object, not its own `default`
	// export, so the type-only `default` member does not apply.
	expect(moduleDefinition.exports[0]).toMatchObject({ name: 'legacy', isValue: true });
});
