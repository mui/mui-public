# TypeScript API Extractor

A utility for extracting API descriptions from [TypeScript](https://www.npmjs.com/package/typescript) definitions using the TypeScript Compiler API. This tool analyzes TypeScript source code and generates structured metadata about exported functions, components, interfaces, types, and more.

## Features

- **Extract API information** from TypeScript source files
- **React component analysis** with prop types and documentation
- **Type definitions** including interfaces, enums, and type aliases
- **JSDoc comments** parsing and extraction
- **Reference resolution** for complex type relationships
- **Selective parsing** of specific files or entire projects

## Installation

```bash
pnpm add @mui/internal-typescript-api-extractor
```

## Quick start

```typescript
import {
  createProgram,
  loadConfig,
  parseFromProgram,
  type ModuleNode,
} from '@mui/internal-typescript-api-extractor';

// Load TypeScript configuration
const config = loadConfig('./tsconfig.json');
const program = createProgram(config.fileNames, config.options);

// Parse all files in the project
for (const file of config.fileNames) {
  try {
    const moduleInfo: ModuleNode = parseFromProgram(file, program);
    console.log(`Extracted API from ${file}:`, moduleInfo);
  } catch (error) {
    console.error(`Failed to parse ${file}:`, error);
  }
}
```

## Documentation

- [Usage](./docs/usage.md) - parsing a project or a single file, filtering
  properties, limiting object expansion, and handling parser warnings.
- [API reference](./docs/api-reference.md) - exported functions, `ParserOptions`,
  and the parser warning types.
- [Output format](./docs/output-format.md) - the extracted module model, type
  operator representation, and an annotated example.
- [Architecture](./docs/architecture.md) - how the parser layers, resolver
  pipeline, and model helpers fit together.

## Requirements

- **Node.js**: `^22.12.0 || ^24.0.0 || >=26.0.0`

## License

This project is licensed under the terms of the [MIT license](./LICENSE).

## Acknowledgments

This package is maintained in the MUI public monorepo as a fork of [typescript-api-extractor](https://github.com/michaldudak/typescript-api-extractor) by [Michał Dudak](https://github.com/michaldudak).

That project was started as a fork of [typescript-to-proptypes](https://github.com/merceyz/typescript-to-proptypes) created by [Kristoffer K.](https://github.com/merceyz).
