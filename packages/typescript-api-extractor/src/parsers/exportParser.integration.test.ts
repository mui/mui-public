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

it('gives exports the checker cannot resolve no declaration id', () => {
  const filePath = '/virtual/unresolvable-ids.ts';
  const moduleDefinition = parseFromProgram(
    filePath,
    createInMemoryProgram(
      filePath,
      [
        "export { First } from './missing-first';",
        "export { Second } from './missing-second';",
        "import * as FirstNamespace from './missing-first-namespace';",
        "import * as SecondNamespace from './missing-second-namespace';",
        'export { FirstNamespace, SecondNamespace };',
      ].join('\n'),
    ),
  );

  expect(
    moduleDefinition.exports.map(({ name, declarationId }) => ({ name, declarationId })),
  ).toEqual([
    { name: 'First', declarationId: undefined },
    { name: 'Second', declarationId: undefined },
    { name: 'FirstNamespace', declarationId: undefined },
    { name: 'SecondNamespace', declarationId: undefined },
  ]);
});

/** Parses a module and groups its export names by declaration id. */
function groupByDeclarationId(files: Record<string, string>): string[][] {
  const [filePath] = Object.keys(files);
  const groups = new Map<string | undefined, string[]>();
  const { exports } = parseFromProgram(filePath!, createInMemoryProgram(files));
  for (const { name, declarationId } of exports) {
    expect(declarationId).toBeDefined();
    groups.set(declarationId, [...(groups.get(declarationId) ?? []), name]);
  }
  return [...groups.values()];
}

function createDeclarationIdSources(root: string): Record<string, string> {
  return {
    [`${root}/index.ts`]: [
      "export * as Parts from './parts';",
      "export type * from './trigger';",
      "export { other, trigger as renamedTrigger } from './trigger';",
    ].join('\n'),
    [`${root}/parts.ts`]: "export { trigger as Trigger } from './trigger';",
    [`${root}/trigger.ts`]: [
      "export const trigger = (): string => 'trigger';",
      'export interface trigger { (): string }',
      'export namespace trigger { export type Props = { id: string } }',
      "export const other = (): string => 'other';",
    ].join('\n'),
  };
}

it('gives exports reaching one declaration the same declaration id', () => {
  expect(groupByDeclarationId(createDeclarationIdSources('/virtual/ids'))).toEqual([
    ['Parts.Trigger', 'renamedTrigger', 'trigger'],
    ['Parts.Trigger.Props', 'renamedTrigger.Props', 'trigger.Props'],
    ['other'],
  ]);
});

it('gives a declaration the same id wherever the project is checked out', () => {
  const getIds = (root: string) =>
    parseFromProgram(
      `${root}/index.ts`,
      createInMemoryProgram(createDeclarationIdSources(root)),
    ).exports.map(({ declarationId }) => declarationId);

  expect(getIds('/virtual/first-checkout')).toEqual(getIds('/virtual/second-checkout'));
});

it('gives a re-exported module namespace the same id wherever the project is checked out', () => {
  const getId = (root: string) =>
    parseFromProgram(
      `${root}/index.ts`,
      createInMemoryProgram({
        [`${root}/index.ts`]: "import * as api from './api';\nexport { api };",
        [`${root}/api.ts`]: "export const value = 'value';",
      }),
    ).exports.find(({ name }) => name === 'api')?.declarationId;

  expect(getId('/virtual/first-checkout')).toBeDefined();
  expect(getId('/virtual/first-checkout')).toEqual(getId('/virtual/second-checkout'));
});

it('gives an import with a declaration merged onto it a declaration id of its own', () => {
  expect(
    groupByDeclarationId({
      '/virtual/merged-ids/index.ts': [
        "import { target } from './target';",
        'interface target { id: string }',
        'export { target };',
        "export { target as importedTarget } from './target';",
      ].join('\n'),
      '/virtual/merged-ids/target.ts': "export function target(): string { return 'target'; }",
    }),
  ).toEqual([['target'], ['importedTarget']]);
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
