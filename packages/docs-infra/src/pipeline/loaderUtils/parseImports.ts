// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

interface ImportName {
  name: string;
  alias?: string;
  type: 'default' | 'named' | 'namespace';
  isType?: boolean;
}

interface RelativeImport {
  path: string;
  names: ImportName[];
  includeTypeDefs?: true;
}

interface ExternalImport {
  names: ImportName[];
}

interface ParseImportsResult {
  relative: Record<string, RelativeImport>;
  externals: Record<string, ExternalImport>;
}

export async function parseImports(code: string, _filePath: string): Promise<ParseImportsResult> {
  const result: Record<string, RelativeImport> = {};
  const externals: Record<string, ExternalImport> = {};

  // Regex to extract regular import statements with 'from' clause
  const importRegex = /import(?:\s+type)?\s*([^'"]*)\s*from\s*['"]([^'"]+)['"][;]?/g;

  // Regex to extract side-effect imports (without 'from' clause)
  const sideEffectImportRegex = /import\s*['"]([^'"]+)['"][;]?/g;

  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = importRegex.exec(code)) !== null) {
    const [fullMatch, importSpecifierRaw, modulePathRaw] = match;

    // Determine if this is a type import by checking if the full match contains "import type"
    const includeTypeDefs = fullMatch.includes('import type');

    const importSpecifier = importSpecifierRaw?.trim();
    const modulePath = modulePathRaw?.trim();

    if (!modulePath) {
      continue;
    }

    // Check if this is a relative import
    const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');

    // Handle side-effect imports (no import specifier)
    if (!importSpecifier) {
      if (isRelative) {
        // Resolve the relative import to an absolute path
        const resolvedPath = path.resolve(path.dirname(_filePath), modulePath);

        if (!result[modulePath]) {
          result[modulePath] = {
            path: resolvedPath,
            names: [], // Empty names array for side-effect imports
          };
        }
      } else if (!externals[modulePath]) {
        // External side-effect import
        externals[modulePath] = {
          names: [],
        };
      }
      continue;
    }
    if (isRelative) {
      // Resolve the relative import to an absolute path
      const resolvedPath = path.resolve(path.dirname(_filePath), modulePath);

      if (!result[modulePath]) {
        result[modulePath] = {
          path: resolvedPath,
          names: [],
          ...(includeTypeDefs && { includeTypeDefs: true as const }),
        };
      } else if (includeTypeDefs && !result[modulePath].includeTypeDefs) {
        result[modulePath].includeTypeDefs = true as const;
      }

      // Parse the import specifier to determine the type of import
      const defaultImportMatch = importSpecifier.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,|$)/);
      const namespaceImportMatch = importSpecifier.match(/\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      const namedImportsMatch = importSpecifier.match(/\{([^}]+)\}/);

      const defaultImport = defaultImportMatch?.[1];
      const namespaceImport = namespaceImportMatch?.[1];
      const namedImportsStr = namedImportsMatch?.[1];

      if (defaultImport) {
        // Check if we already have this default import
        const existing = result[modulePath].names.find(
          (n) => n.name === defaultImport && n.type === 'default',
        );
        if (!existing) {
          result[modulePath].names.push({
            name: defaultImport,
            type: 'default',
            ...(includeTypeDefs && { isType: true }),
          });
        }
      }

      if (namespaceImport) {
        // Check if we already have this namespace import
        const existing = result[modulePath].names.find(
          (n) => n.name === namespaceImport && n.type === 'namespace',
        );
        if (!existing) {
          result[modulePath].names.push({
            name: namespaceImport,
            type: 'namespace',
            ...(includeTypeDefs && { isType: true }),
          });
        }
      }

      if (namedImportsStr) {
        // Handle named imports like { ComponentName, Component2 as Alias, type TypeName }
        // Clean up the string by removing comments and extra whitespace
        const cleanedImportsStr = namedImportsStr
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* comment */ blocks
          .replace(/\/\/.*$/gm, '') // Remove // line comments
          .trim();

        if (cleanedImportsStr) {
          const namedImports = cleanedImportsStr
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          namedImports.forEach((namedImport) => {
            // Check if this specific import is a type import
            const isTypeImport = namedImport.trim().startsWith('type ');

            // Clean up the import name (remove 'type' keyword and handle aliases)
            const cleanImport = namedImport.replace(/^type\s+/, ''); // Remove leading 'type'

            // Parse original name and alias
            const aliasMatch = cleanImport.match(/(.+?)\s+as\s+(.+)/);
            const originalName = aliasMatch ? aliasMatch[1].trim() : cleanImport.trim();
            const alias = aliasMatch ? aliasMatch[2].trim() : undefined;

            // Only add if we have a valid name
            if (originalName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(originalName)) {
              // Check if we already have this named import
              const existing = result[modulePath].names.find(
                (n) => n.name === originalName && n.type === 'named' && n.alias === alias,
              );
              if (!existing) {
                result[modulePath].names.push({
                  name: originalName,
                  ...(alias && { alias }),
                  type: 'named',
                  ...((includeTypeDefs || isTypeImport) && { isType: true }),
                });
              }
            }
          });
        }
      }
    } else {
      // This is an external import
      if (!externals[modulePath]) {
        externals[modulePath] = {
          names: [],
        };
      }

      // Parse the import specifier to determine the type of import
      const defaultImportMatch = importSpecifier.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,|$)/);
      const namespaceImportMatch = importSpecifier.match(/\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      const namedImportsMatch = importSpecifier.match(/\{([^}]+)\}/);

      const defaultImport = defaultImportMatch?.[1];
      const namespaceImport = namespaceImportMatch?.[1];
      const namedImportsStr = namedImportsMatch?.[1];

      if (defaultImport) {
        // Check if we already have this default import
        const existing = externals[modulePath].names.find(
          (n) => n.name === defaultImport && n.type === 'default',
        );
        if (!existing) {
          externals[modulePath].names.push({
            name: defaultImport,
            type: 'default',
            ...(includeTypeDefs && { isType: true }),
          });
        }
      }

      if (namespaceImport) {
        // Check if we already have this namespace import
        const existing = externals[modulePath].names.find(
          (n) => n.name === namespaceImport && n.type === 'namespace',
        );
        if (!existing) {
          externals[modulePath].names.push({
            name: namespaceImport,
            type: 'namespace',
            ...(includeTypeDefs && { isType: true }),
          });
        }
      }

      if (namedImportsStr) {
        // Handle named imports like { ComponentName, Component2 as Alias, type TypeName }
        // Clean up the string by removing comments and extra whitespace
        const cleanedImportsStr = namedImportsStr
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* comment */ blocks
          .replace(/\/\/.*$/gm, '') // Remove // line comments
          .trim();

        if (cleanedImportsStr) {
          const namedImports = cleanedImportsStr
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          namedImports.forEach((namedImport) => {
            // Check if this specific import is a type import
            const isTypeImport = namedImport.trim().startsWith('type ');

            // Clean up the import name (remove 'type' keyword and handle aliases)
            const cleanImport = namedImport.replace(/^type\s+/, ''); // Remove leading 'type'

            // Parse original name and alias - for externals we track both
            const aliasMatch = cleanImport.match(/(.+?)\s+as\s+(.+)/);
            const originalName = aliasMatch ? aliasMatch[1].trim() : cleanImport.trim();
            const alias = aliasMatch ? aliasMatch[2].trim() : undefined;

            // Only add if we have a valid name
            if (originalName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(originalName)) {
              // Check if we already have this named import
              const existing = externals[modulePath].names.find(
                (n) => n.name === originalName && n.type === 'named' && n.alias === alias,
              );
              if (!existing) {
                externals[modulePath].names.push({
                  name: originalName,
                  ...(alias && { alias }),
                  type: 'named',
                  ...((includeTypeDefs || isTypeImport) && { isType: true }),
                });
              }
            }
          });
        }
      }
    }
  }

  // Process side-effect imports separately
  let sideEffectMatch: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((sideEffectMatch = sideEffectImportRegex.exec(code)) !== null) {
    const [, modulePathRaw] = sideEffectMatch;
    const modulePath = modulePathRaw?.trim();

    if (!modulePath) {
      continue;
    }

    // Check if this is a relative import
    const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');

    if (isRelative) {
      // Resolve the relative import to an absolute path
      const resolvedPath = path.resolve(path.dirname(_filePath), modulePath);

      if (!result[modulePath]) {
        result[modulePath] = {
          path: resolvedPath,
          names: [], // Empty names array for side-effect imports
        };
      }
    } else if (!externals[modulePath]) {
      // External side-effect import
      externals[modulePath] = {
        names: [],
      };
    }
  }

  return { relative: result, externals };
}
