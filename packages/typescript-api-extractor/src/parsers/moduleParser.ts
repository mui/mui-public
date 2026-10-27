import path from 'node:path';
import ts from 'typescript';
import type { ExportNode } from '../models';
import { ModuleNode } from '../models';
import type { ScopedParserContext } from '../parserContext';
import { createExportNodes, registerExportNames } from './exportParser';
import { resolveExportDescriptors } from './exportDescriptors';
import { applyExportTransforms } from './exportTransforms';
import { ParserError } from '../ParserError';

/**
 * Parses a source file into a ModuleNode: resolves every module export, drops
 * values re-exported through `export type *`, then applies post-parse export
 * transforms such as the React component transform.
 */
export function parseModule(sourceFile: ts.SourceFile, context: ScopedParserContext): ModuleNode {
  const { checker, compilerOptions } = context;

  return context.runWithSymbolScope(sourceFile.fileName, () => {
    try {
      const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
      if (!sourceFileSymbol) {
        throw new Error('Failed to get the source file symbol');
      }

      // Every export's public name is known before any type is resolved, so a
      // reference to an exported type can carry the name the module gives it.
      const descriptorsByExport = checker
        .getExportsOfModule(sourceFileSymbol)
        .map((exportedSymbol) =>
          resolveExportDescriptors(exportedSymbol, context, { containerSymbol: sourceFileSymbol }),
        );
      for (const descriptors of descriptorsByExport) {
        if (descriptors) {
          registerExportNames(descriptors, context);
        }
      }

      let parsedModuleExports: ExportNode[] = [];
      for (const descriptors of descriptorsByExport) {
        const parsedExports = descriptors ? createExportNodes(descriptors, context) : undefined;
        if (!parsedExports) {
          continue;
        }
        parsedModuleExports.push(...parsedExports);
      }

      parsedModuleExports = applyExportTransforms(parsedModuleExports, context);

      const relativeModulePath = path
        .relative(compilerOptions.rootDir!, JSON.parse(sourceFileSymbol.name))
        .replace(/\\/g, '/');

      const imports: string[] = sourceFile.statements
        .filter((s) => ts.isImportDeclaration(s) && s.moduleSpecifier)
        .map((statement) => {
          const importDeclaraion = statement as ts.ImportDeclaration;
          const text = importDeclaraion.moduleSpecifier.getText();
          return text.substring(1, text.length - 1); // Remove quotes
        });

      return new ModuleNode(
        relativeModulePath,
        parsedModuleExports,
        imports.length > 0 ? imports : undefined,
      );
    } catch (error) {
      if (!(error instanceof ParserError)) {
        throw new ParserError(error, context.parsedSymbolStack);
      }

      throw error;
    }
  });
}
