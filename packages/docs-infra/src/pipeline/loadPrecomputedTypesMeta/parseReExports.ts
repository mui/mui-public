import ts from 'typescript';
import path from 'node:path';
import type { Program, SourceFile, TypeChecker } from 'typescript';
import { parseFromProgram, type ExportNode, type ParserOptions } from 'typescript-api-extractor';

type ReExportInfo = {
  sourceFile: SourceFile;
  aliasMap: Map<string, string>; // Maps original name -> exported name
  namespaceName?: string; // For `export * as X`
};

export type ParsedReExports = {
  name: string;
  exports: Array<{
    directory?: string; // Directory containing the source file with actual exports
    exports: ExportNode[];
  }>;
};

/**
 * Recursively parses re-exports from a source file and tracks the directory of each export's origin.
 *
 * Handles:
 * - `export { X as Y } from './file'` - Re-exports with aliasing
 * - `export * as Component from './file'` - Namespace re-exports
 * - Mixed files with both re-exports and actual exports
 *
 * The directory tracking is crucial for finding related files (like DataAttributes, CssVars)
 * in the correct subdirectories when components are organized in nested folder structures.
 *
 * @example
 * // For this structure:
 * // /Component/index.ts: export * as Component from './index.parts'
 * // /Component/index.parts.ts: export { ComponentPart as Part } from './Part/ComponentPart'
 * // /Component/Part/ComponentPart.tsx: export function ComponentPart() { }
 * //
 * // Returns: [{
 * //   name: 'Component',
 * //   exports: [{
 * //     directory: '/Component/Part/',
 * //     exports: [ComponentPart ExportNode with name 'Part']
 * //   }]
 * // }]
 */
export function parseReExports(
  sourceFile: SourceFile,
  checker: TypeChecker,
  program: Program,
  parserOptions: ParserOptions,
  visited: Set<string> = new Set(),
): ParsedReExports[] {
  const fileName = sourceFile.fileName;

  // Prevent infinite recursion
  if (visited.has(fileName)) {
    return [];
  }
  visited.add(fileName);

  const allResults: ParsedReExports[] = [];
  const sourceFileSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  const exportedSymbols = sourceFileSymbol && checker.getExportsOfModule(sourceFileSymbol);

  if (!exportedSymbols) {
    return [];
  }

  const reExportInfos: ReExportInfo[] = [];

  // Check each exported symbol
  exportedSymbols.forEach((symbol) => {
    const declarations = symbol.declarations;

    if (!declarations || declarations.length === 0) {
      return;
    }

    const declaration = declarations[0];

    // Check if it's an ExportSpecifier (like `export { X as Y } from './file'`)
    if (ts.isExportSpecifier(declaration)) {
      const exportDecl = declaration.parent.parent;

      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Resolve the imported module to get its source file
          const resolvedModule = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = resolvedModule?.declarations?.[0]?.getSourceFile();

          if (importedSourceFile) {
            // Get the original name (before 'as') and the exported name (after 'as' or same if no alias)
            const originalName = declaration.propertyName?.getText() || declaration.name.getText();
            const exportedName = symbol.name;

            // Find or create the reExportInfo for this source file
            let reExportInfo = reExportInfos.find((info) => info.sourceFile === importedSourceFile);
            if (!reExportInfo) {
              reExportInfo = {
                sourceFile: importedSourceFile,
                aliasMap: new Map(),
              };
              reExportInfos.push(reExportInfo);
            }

            // Store the alias mapping
            reExportInfo.aliasMap.set(originalName, exportedName);
          }
        }
      }
    }

    // Check if it's a NamespaceExport (like `export * as Component from './index.parts'`)
    if (ts.isNamespaceExport(declaration)) {
      const exportDecl = declaration.parent;

      if (ts.isExportDeclaration(exportDecl) && exportDecl.moduleSpecifier) {
        const moduleSpecifier = exportDecl.moduleSpecifier;

        if (ts.isStringLiteral(moduleSpecifier)) {
          // Get the source file of the module being re-exported
          const importedSymbol = checker.getSymbolAtLocation(moduleSpecifier);
          const importedSourceFile = importedSymbol?.valueDeclaration?.getSourceFile();

          if (importedSourceFile) {
            const namespaceName = symbol.name;

            // For namespace exports, store the namespace name
            reExportInfos.push({
              sourceFile: importedSourceFile,
              aliasMap: new Map(),
              namespaceName,
            });
          }
        }
      }
    }
  });

  // Process re-exports if any exist
  if (reExportInfos.length > 0) {
    for (const reExportInfo of reExportInfos) {
      const recursiveResults = parseReExports(
        reExportInfo.sourceFile,
        checker,
        program,
        parserOptions,
        visited,
      );

      if (reExportInfo.namespaceName) {
        // For namespace exports, collect all exports from all recursive results
        // and group them under a single namespace name
        const allNamespaceExports: Array<{ directory?: string; exports: ExportNode[] }> = [];

        for (const recursiveResult of recursiveResults) {
          allNamespaceExports.push(...recursiveResult.exports);
        }

        allResults.push({
          name: reExportInfo.namespaceName,
          exports: allNamespaceExports,
        });
      } else {
        // Process each recursive result for regular re-exports
        for (const recursiveResult of recursiveResults) {
          if (reExportInfo.aliasMap.size > 0) {
            // Apply alias mappings to individual exports by mutating the name property
            // Only include exports that are explicitly re-exported (in the aliasMap)
            const aliasedExportGroups: Array<{ directory?: string; exports: ExportNode[] }> = [];

            for (const exportGroup of recursiveResult.exports) {
              const aliasedExports: ExportNode[] = [];

              for (const exportNode of exportGroup.exports) {
                if (reExportInfo.aliasMap.has(exportNode.name)) {
                  // Mutate the name property directly to preserve methods like isPublic()
                  const aliasedName = reExportInfo.aliasMap.get(exportNode.name)!;
                  exportNode.name = aliasedName;
                  aliasedExports.push(exportNode);
                }
                // If not in aliasMap, skip this export (don't include it)
              }

              // Only add the group if it has exports after filtering
              if (aliasedExports.length > 0) {
                aliasedExportGroups.push({
                  directory: exportGroup.directory,
                  exports: aliasedExports,
                });
              }
            }

            allResults.push({
              name: recursiveResult.name,
              exports: aliasedExportGroups,
            });
          } else {
            // No alias, use the original result
            allResults.push(recursiveResult);
          }
        }
      }
    }
  }

  // Also check for actual exports from this file (can coexist with re-exports)
  // This is important because a file can both re-export from other files AND have its own exports
  // For example: export { X } from './x'; export const Y = ...;
  const { exports: actualExports } = parseFromProgram(fileName, program, parserOptions);
  if (actualExports.length > 0) {
    // This file has actual exports - add them with this file's directory
    const directory = path.dirname(fileName);

    allResults.push({
      name: '',
      exports: [
        {
          directory,
          exports: actualExports,
        },
      ],
    });
  }

  return allResults;
}
