import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { loadConfig, parseFromProgram } from '../../index';
import { createInMemoryProgram } from '../../../test/support/inMemoryProgram';

const fixturesDir = path.resolve(__dirname, '../../../test/fixtures');
const mappedAliasFiniteKeyInput = path.join(fixturesDir, 'mapped-alias-finite-key/input.ts');
const propertyCountLimitInput = path.join(
	fixturesDir,
	'object-property-count-limit-scope/input.tsx',
);
const program = ts.createProgram(
	[mappedAliasFiniteKeyInput, propertyCountLimitInput],
	loadConfig(path.resolve(__dirname, '../../../test/tsconfig.json')).options,
);

it('applies shouldInclude to finite mapped properties', async () => {
	const moduleDefinition = parseFromProgram(mappedAliasFiniteKeyInput, program, {
		shouldInclude: ({ name }) => name !== 'b',
	});
	const serializedModuleDefinition = JSON.parse(JSON.stringify(moduleDefinition));
	const specializedExport = serializedModuleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'Specialized',
	);

	expect(
		specializedExport.type.properties.map((property: { name: string }) => property.name),
	).toEqual(['a']);
});

it('includes parameter and accessor properties with expanded external keyof aliases', () => {
	const filePath = '/virtual/external-keyof-class-instance-consumer.ts';
	const moduleDefinition = JSON.parse(
		JSON.stringify(
			parseFromProgram(
				filePath,
				createInMemoryProgram({
					[filePath]: `import type { Keys } from 'external-keyof-class-instance-package';

class Example {
  constructor(public key: Keys) {}

  get accessor(): Keys {
    return this.key;
  }

  set accessor(value: Keys) {
    this.key = value;
  }
}

export type Instance = Example;`,
					'/virtual/node_modules/external-keyof-class-instance-package/index.d.ts': `export interface Params {
  a: string;
  b: number;
}

export type Keys = keyof Params;`,
				}),
				{ includeExternalTypes: true },
			),
		),
	);
	const properties = moduleDefinition.exports[0]?.type.properties;

	expect(properties.map((property: { name: string }) => property.name)).toEqual([
		'key',
		'accessor',
	]);
	for (const property of properties) {
		expect(property.type).toMatchObject({ kind: 'typeOperator', operator: 'keyof' });
	}
});

it('reports the property depth an object was reached at', () => {
	const observedDepths = new Map<string, Set<number>>();
	parseFromProgram(propertyCountLimitInput, program, {
		shouldResolveObject: ({ name, propertyDepth }) => {
			const depths = observedDepths.get(name) ?? new Set<number>();
			depths.add(propertyDepth);
			observedDepths.set(name, depths);
			return undefined;
		},
	});

	// Reached through composition from the export, so it is part of the shape the
	// caller asked about.
	expect([...(observedDepths.get('ManyProps') ?? [])]).toEqual([0]);
	// Reached through the `nested` property, so it is a detail of that shape.
	expect([...(observedDepths.get('ManyNestedProps') ?? [])]).toEqual([1]);
});

it('lets a caller-supplied limit collapse even directly requested shapes', () => {
	const moduleDefinition = parseFromProgram(propertyCountLimitInput, program, {
		shouldResolveObject: ({ propertyCount }) => propertyCount <= 10,
	});
	const serializedModuleDefinition = JSON.parse(JSON.stringify(moduleDefinition));
	const componentExport = serializedModuleDefinition.exports.find(
		(exportNode: { name: string }) => exportNode.name === 'ManyPropsComponent',
	);

	// The 51-property member is dropped by the caller's rule, leaving only the
	// props contributed by the small members.
	expect(componentExport.type.props.map((prop: { name: string }) => prop.name)).toEqual([
		'extra',
		'nested',
		'forced',
	]);
});
