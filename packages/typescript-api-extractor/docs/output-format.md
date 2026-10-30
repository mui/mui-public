# Output Format

The parser returns a module object with the following structure. The default
`ResolvedModuleNode` and opt-in `SyntaxOnlyModuleNode` types are recursively
mode-aware versions of `ModuleNode`; both remain structurally compatible with
the runtime model.

```typescript
interface ModuleNode {
  name: string;
  exports: ExportNode[];
}

interface ExportNode {
  name: string;
  type: TypeNode;
  documentation?: DocumentationNode;
  isValue: boolean;
  isType: boolean;
  isNamespace: boolean;
  declarationId?: string;
}
```

`TypeNode` represents a TypeScript type. There are multiple classes of types. See
the contents of the `src/models/types` directory to discover them.

## Declaration Spaces

`isValue`, `isType`, and `isNamespace` report which of TypeScript's declaration
spaces the export occupies. `type` describes the resolved type shape, which does
not identify the declaration form: `export type X = 'x'` and
`export const x: X = 'x'` both resolve to the same literal type, and only the
declaration spaces tell them apart.

- `isValue`: the export occupies the value space — variables, functions,
  classes, enums. Note that `const enum` members are inlined by default
  (`preserveConstEnums: false`), so a value export does not guarantee a runtime
  binding in the emitted output.
- `isType`: the export names a type — type aliases, interfaces, classes, enums.
- `isNamespace`: the export declares a namespace or module. Expando assignments
  (`fn.extra = ...`) do not count.

Merged declarations occupy every space their declarations occupy: a class is
both a value and a type, `interface X {}` merged with `const X: X` is both, and
a namespace containing only types is neither a value nor a type, only a
namespace. Renamed and re-exported aliases report the spaces of every symbol
along their alias chain, so declarations merged onto an alias in any module of
the chain count. A re-exported namespace import (`import * as N`; `export { N }`)
is a namespace and a value.

An export keeps the value space only when some path to it crosses no type-only
site (`import type`, `export type { X }`, `export type *`, `export type * as N`).
Paths are followed through every alias, import, `export =`, and star export, and
a local value merged with a type-only import keeps its value. Otherwise the value
space is masked, and an export left with nothing but a value, such as a function
or variable with any namespace merged onto it, is omitted. A re-export from an
unresolvable module gets the checker's fallback: a value of type `any`.

## Declaration Ids

`declarationId` identifies the declaration an export resolves to. A module can
reach one declaration under several export names, for example a component
exported as a namespace member and again through a type-only star export:

```typescript
export * as Dialog from './index.parts'; // export { DialogTrigger as Trigger } from './DialogTrigger';
export type * from './DialogTrigger';
```

Every name is emitted, and `Dialog.Trigger` and `DialogTrigger` carry the same
`declarationId`, as do `Dialog.Trigger.Props` and `DialogTrigger.Props`. Exports
share a declaration when they resolve to the same symbol after following imports
and re-exports, so merged declarations (a `const`, an `interface`, and a
`namespace` of one name) count as one. A type alias that names another type
(`type Props = DialogTriggerProps`) is a declaration of its own. An import with
declarations merged onto it where it is imported, such as an imported function
with a local interface of the same name, is a declaration of its own too.

The id is opaque: compare ids only for equality. It is stable across runs as a
best effort, with no guarantee. Exports the checker cannot resolve, such as
re-exports from a missing module, have no `declarationId`.

## Type Operators

Authored `keyof` expressions are represented without expanding away their syntax:

```typescript
interface TypeOperatorNode {
  kind: 'typeOperator';
  operator: 'keyof';
  type: TypeNode;
  resolvedType?: TypeNode;
  resolutionKind?: 'exact' | 'baseConstraint' | 'fallback';
}

type ResolvedTypeOperatorNode = Omit<TypeOperatorNode, 'resolvedType' | 'resolutionKind'> & {
  resolvedType: TypeNode;
  resolutionKind: 'exact' | 'baseConstraint' | 'fallback';
};

type SyntaxOnlyTypeOperatorNode = Omit<TypeOperatorNode, 'resolvedType' | 'resolutionKind'> & {
  resolvedType?: never;
  resolutionKind?: never;
};
```

The exported `TypeOperatorNode` class represents both runtime modes, so its
payload fields are optional. Parser entry points correlate them recursively:
default and literal `'resolved'` calls return `ResolvedModuleNode`, literal
`'syntaxOnly'` calls return `SyntaxOnlyModuleNode`, and a dynamic mode returns
their union.

Type-query operands retain their authored expression without expanding the
queried value shape:

```typescript
interface TypeQueryNode {
  kind: 'typeQuery';
  expressionName: string;
}
```

For example, the `type` of `keyof typeof value` is a `TypeQueryNode` whose
`expressionName` is `value`.

Readonly arrays and tuples expose `isReadonly: true` in their public output,
including when they are nested inside a preserved operator:

```typescript
interface ArrayNode {
  kind: 'array';
  typeName?: TypeName;
  elementType: TypeNode;
  isReadonly?: true;
}

interface TupleNode {
  kind: 'tuple';
  typeName?: TypeName;
  types: TypeNode[];
  isReadonly?: true;
}
```

The optional field is omitted for mutable containers and serialized as `true`
for readonly containers. This keeps rendered operands and their resolved key
sets consistent.

- `type` is the authored operand. Named object operands are intentionally shallow
  references because expanding their properties does not change the operator or
  its key result.
- `resolvedType` is the checker result used to describe the keys available from
  the operator. Set `typeOperatorOutput: 'syntaxOnly'` to omit this potentially
  large payload together with `resolutionKind`; the default is `'resolved'`.
- `resolutionKind: 'exact'` means `resolvedType` is the concrete result.
- `resolutionKind: 'baseConstraint'` means the operand is still generic, so
  `resolvedType` is the best available base constraint rather than its eventual
  instantiated result. For example, `keyof T` commonly resolves to
  `string | number | symbol` at extraction time.
- `resolutionKind: 'fallback'` means the checker exposed neither a usable
  constraint nor a result the model can represent exactly; unsupported concrete
  results are represented by `any` and emit an `unsupported-type-fallback`
  warning.

Preservation follows authored operators through the supported reference,
container, mapped, indexed-access, conditional-branch, and heritage paths. It
does not reconstruct operators after TypeScript selector or inference utilities
have erased their source syntax. For example, `ReturnType`, `Parameters`,
`Awaited`, `ConstructorParameters`, `ThisParameterType`, and user-authored
conditional `infer` selectors can expose only their reduced semantic result.

## Template Literals

Template literal types keep their literal text and resolve each placeholder like
any other type:

```typescript
interface TemplateLiteralNode {
  kind: 'templateLiteral';
  typeName?: TypeName;
  texts: string[];
  types: TypeNode[];
}
```

`texts` holds the text before, between, and after the placeholders, so it has
one more entry than `types`. For example, `` `${number}px` `` has
`texts: ['', 'px']` and a single `number` intrinsic in `types`.

The node describes the type as TypeScript normalizes it. Finite placeholders
are distributed, so `` `${'top' | 'bottom'}-${number}` `` becomes a union of two
template literals, and nested template literals are flattened into one. A
template literal without open-ended placeholders, such as `` `on${'click'}` ``,
is a plain string literal.

## React Components

Exports recognized as React components become component nodes. The props
parameter of every call signature is merged into one `props` list:

```typescript
interface ComponentNode {
  kind: 'component';
  typeName?: TypeName;
  props: PropertyNode[];
  typeParameters?: TypeParameterNode[];
}

interface TypeParameterNode {
  kind: 'typeParameter';
  name: string;
  constraint?: TypeNode;
  defaultValue?: TypeNode;
}
```

`typeParameters` lists the component's generics, which props refer to by name
through `typeParameter` nodes. It is omitted unless every call signature declares
the same names, constraints, and defaults. Components wrapped in `forwardRef` or
`memo` usually have none, since TypeScript erases them from the wrapper's type.

## External Types

Unless `includeExternalTypes` is set, types declared outside the parsed project,
such as DOM types or types from npm packages, are kept as named references
instead of being expanded:

```typescript
interface ExternalTypeNode {
  kind: 'external';
  typeName: TypeName;
  source?: ExternalTypeSource;
}

type ExternalTypeSource =
  { kind: 'lib'; files: readonly string[] } | { kind: 'package'; name: string };
```

`source` tells where the referenced type is declared, so types that share a name
can be told apart. A type from TypeScript's default library has kind `lib`, with
the library files that declare it. Global types are often declared across
several files, so `Intl.NumberFormat` lists `lib.es5.d.ts` along with the
`lib.es20xx.*.d.ts` files that extend it. Any other type has kind `package`,
named after the package directory under `node_modules` that declares it, such as
`@types/react`. The source follows the declaration that supplies the name, so a
package alias of a built-in type, such as `type Locale = Intl.LocalesArgument`,
has kind `package`.

External types with the same name but a different `source` are distinct, so the
DOM `Range` and a package's own `Range` stay separate members of a union.

## Example Output

For a React component like this:

```typescript
interface Props {
  /** The title to display */
  title: string;
  /** Whether the component is disabled */
  disabled?: boolean;
}

export function MyComponent(props: Props) {
  return <div>{props.title}</div>;
}
```

`ModuleNode.name` is the parsed file path relative to `compilerOptions.rootDir`,
including the file extension. For a file at `src/MyComponent.ts`, the extractor
would produce:

```json
{
  "name": "src/MyComponent.ts",
  "exports": [
    {
      "name": "MyComponent",
      "type": {
        "kind": "component",
        "typeName": {
          "name": "MyComponent"
        },
        "props": [
          {
            "name": "title",
            "type": {
              "kind": "intrinsic",
              "intrinsic": "string"
            },
            "optional": false,
            "documentation": {
              "description": "The title to display"
            }
          },
          {
            "name": "disabled",
            "type": {
              "kind": "intrinsic",
              "intrinsic": "boolean"
            },
            "optional": true,
            "documentation": {
              "description": "Whether the component is disabled"
            }
          }
        ]
      }
    }
  ]
}
```
