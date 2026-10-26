# Usage

This guide covers the common ways to run the extractor. For exact signatures and
option types, see the [API reference](./api-reference.md). For the shape of the
data you get back, see the [output format](./output-format.md).

## Parsing a project

`loadConfig` reads a `tsconfig.json` and returns the compiler options and file
list. Create a single program from them and reuse it for every file - the
program owns the type checker and the compiler caches, so sharing it is much
faster than parsing files one by one.

```typescript
import {
	createProgram,
	loadConfig,
	parseFromProgram,
	type ModuleNode,
} from 'typescript-api-extractor';

const config = loadConfig('./tsconfig.json');
const program = createProgram(config.fileNames, config.options);

for (const file of config.fileNames) {
	try {
		const moduleInfo: ModuleNode = parseFromProgram(file, program);
		console.log(`Extracted API from ${file}:`, moduleInfo);
	} catch (error) {
		console.error(`Failed to parse ${file}:`, error);
	}
}
```

## Parsing a single file

`parseFile` creates a throwaway program for one file. It is convenient for
one-off extraction, but avoid it in a loop.

```typescript
import { loadConfig, parseFile } from 'typescript-api-extractor';

const config = loadConfig('./tsconfig.json');
const moduleInfo = parseFile('./src/MyComponent.tsx', config.options);
```

## Controlling how much is resolved

Both entry points accept an optional `ParserOptions` object as the last
argument.

### Filtering properties

`shouldInclude` is called before a property is added to an object type. Return
`true` or `false` to decide, or `undefined` to fall back to the default policy.

```typescript
const moduleInfo = parseFromProgram(file, program, {
	shouldInclude: ({ name }) => !name.startsWith('_'),
});
```

### Limiting object expansion

`shouldResolveObject` decides whether an object's shape is expanded or reduced
to a bare object. Returning `undefined` falls back to
`(propertyDepth === 0 || propertyCount <= 50) && depth <= 10`.

`depth` counts every type on the resolution stack, while `propertyDepth` counts
only the property (and index signature) values traversed to reach the object. A
`propertyDepth` of `0` means the object is the export's own type or something
reached from it through composition alone - aliases, unions, intersections, and
the parameter and return types of its call signatures. The default rule applies
the property-count limit only above that, so a large component prop list is
reported in full while its individual props stay bounded.

```typescript
const moduleInfo = parseFromProgram(file, program, {
	// Expand only the shapes the export directly describes.
	shouldResolveObject: ({ propertyDepth }) => propertyDepth === 0,
});
```

### Including external types

Types declared in external libraries are not expanded by default. Set
`includeExternalTypes: true` to resolve them as well. This can grow the output
considerably, since it pulls in the shape of everything reachable from
`node_modules`.

```typescript
const moduleInfo = parseFromProgram(file, program, { includeExternalTypes: true });
```

### Omitting resolved type operators

Preserved `keyof` operators carry their checker-resolved result by default. Set
`typeOperatorOutput: 'syntaxOnly'` when consumers only need the authored
operator and you want to avoid storing large key unions such as
`keyof React.JSX.IntrinsicElements`.

```typescript
const moduleInfo = parseFromProgram(file, program, { typeOperatorOutput: 'syntaxOnly' });
```

The mode is reflected in the return type: a literal `'syntaxOnly'` returns
`SyntaxOnlyModuleNode`, the default and a literal `'resolved'` return
`ResolvedModuleNode`, and a dynamic value returns their union. See
[type operators](./output-format.md#type-operators) for what each mode emits.

## Handling warnings

The parser recovers from some issues instead of failing, and reports them as
structured warnings. When `onWarning` is omitted, they are printed with
`console.warn`. Provide the callback to collect or format them yourself.

```typescript
import { parseFromProgram, type ParserWarning } from 'typescript-api-extractor';

const warnings: ParserWarning[] = [];
const moduleInfo = parseFromProgram(file, program, {
	onWarning: (warning) => warnings.push(warning),
});
```

Every warning carries a `code`, a `message`, the source location, and the
`parsedSymbolStack` that leads to it. See
[parser warnings](./api-reference.md#parser-warnings) for the individual codes.
