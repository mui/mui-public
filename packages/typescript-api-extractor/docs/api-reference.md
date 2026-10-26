# API Reference

See the [usage guide](./usage.md) for worked examples and the
[output format](./output-format.md) for the returned data shape.

## Functions

### `createProgram`

Re-export of TypeScript's `createProgram` from the TypeScript version bundled
with `typescript-api-extractor`. It has the same overloads/signature as
`typescript.createProgram` and returns a `Program`.

### `loadConfig(tsConfigPath: string)`

Loads and parses a TypeScript configuration file.

- **Parameters:**
  - `tsConfigPath`: Path to the `tsconfig.json` file
- **Returns:** `{ options: CompilerOptions, fileNames: string[] }`

### `parseFile(filePath: string, options: CompilerOptions, parserOptions?: ParserOptions)`

Parses a single TypeScript file and returns the extracted API information.

- **Parameters:**
  - `filePath`: Path to the TypeScript file to parse
  - `options`: TypeScript compiler options
  - `parserOptions`: Optional parser configuration
- **Returns:** `ResolvedModuleNode` by default, or `SyntaxOnlyModuleNode` when
  `parserOptions.typeOperatorOutput` is the literal `'syntaxOnly'`. A dynamic
  `ParserOptions` value returns their union.

### `parseFromProgram(filePath: string, program: Program, parserOptions?: ParserOptions)`

Parses a file from an existing TypeScript program for better performance when
parsing multiple files.

- **Parameters:**
  - `filePath`: Path to the file to parse
  - `program`: TypeScript program instance
  - `parserOptions`: Optional parser configuration
- **Returns:** `ResolvedModuleNode` by default, or `SyntaxOnlyModuleNode` when
  `parserOptions.typeOperatorOutput` is the literal `'syntaxOnly'`. A dynamic
  `ParserOptions` value returns their union.

## Parser options

The parser accepts optional configuration through the `ParserOptions` interface:

```typescript
interface ParserOptions {
	shouldInclude?: (data: { name: string; depth: number }) => boolean | undefined;
	shouldResolveObject?: (data: {
		name: string;
		propertyCount: number;
		depth: number;
		propertyDepth: number;
	}) => boolean | undefined;
	includeExternalTypes?: boolean;
	typeOperatorOutput?: 'resolved' | 'syntaxOnly';
	onWarning?: (warning: ParserWarning) => void;
}
```

`shouldResolveObject` decides whether an object's shape is expanded or reduced to
a bare object. Returning `undefined` falls back to
`(propertyDepth === 0 || propertyCount <= 50) && depth <= 10`.

`depth` counts every type on the resolution stack, while `propertyDepth` counts
only the property (and index signature) values traversed to reach the object. A
`propertyDepth` of `0` means the object is the export's own type or something
reached from it through composition alone - aliases, unions, intersections, and
the parameter and return types of its call signatures. The default rule applies
the property-count limit only above that, so a large component prop list is
reported in full while its individual props stay bounded.

When `onWarning` is omitted, recoverable parser warnings are printed with
`console.warn`. Provide `onWarning` to collect or format them yourself.

## Parser warnings

```typescript
type ParserWarning =
	| UnsupportedTypeFallbackWarning
	| MissingEnumDeclarationWarning
	| MissingDefaultExportSymbolWarning;

interface ParserWarningBase {
	message: string;
	filePath: string;
	line: number;
	column: number;
	parsedSymbolStack: string[];
}

interface UnsupportedTypeFallbackWarning extends ParserWarningBase {
	code: 'unsupported-type-fallback';
	typeFlags: string[];
	typeText: string;
	sourceText?: string;
}

interface MissingEnumDeclarationWarning extends ParserWarningBase {
	code: 'missing-enum-declaration';
	enumName: string;
}

interface MissingDefaultExportSymbolWarning extends ParserWarningBase {
	code: 'missing-default-export-symbol';
	sourceText: string;
}
```
