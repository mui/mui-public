import ts from 'typescript';
import type { Program, SourceFile, TypeChecker } from 'typescript';
import { parseFromProgram, type ExportNode, type ParserOptions } from 'typescript-api-extractor';

type ReExportInfo = {
  sourceFile: SourceFile;
  aliasMap: Map<string, string>; // Maps original name -> exported name
  namespaceName?: string; // For `export * as X`
};

export type ParsedReExports = {
  name: string;
  exports: ExportNode[];
};

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

            console.log(
              `${exportedName} is re-exported from: ${moduleSpecifier.text} (original: ${originalName}) -> ${importedSourceFile.fileName}`,
            );

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
            console.log(
              `${namespaceName} is a namespace re-export from: ${moduleSpecifier.text} -> ${importedSourceFile.fileName}`,
            );

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

  // If there are re-exports, recursively process them
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
        const allNamespaceExports: ExportNode[] = [];
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
            const aliasedExports: ExportNode[] = [];
            for (const exportNode of recursiveResult.exports) {
              if (reExportInfo.aliasMap.has(exportNode.name)) {
                // Mutate the name property directly to preserve methods like isPublic()
                const aliasedName = reExportInfo.aliasMap.get(exportNode.name)!;
                exportNode.name = aliasedName;
                aliasedExports.push(exportNode);
              } else {
                aliasedExports.push(exportNode);
              }
            }
            allResults.push({
              name: recursiveResult.name,
              exports: aliasedExports,
            });
          } else {
            // No alias, use the original result
            allResults.push(recursiveResult);
          }
        }
      }
    }
  } else {
    // No re-exports found, parse actual exports from this file
    const { exports } = parseFromProgram(fileName, program, parserOptions);
    console.log(`Found ${exports.length} actual exports in ${fileName}`);
    allResults.push({
      name: '',
      exports,
    });
  }

  return allResults;
}
