import path from 'node:path';
import ts from 'typescript';
import type { ExportNode } from '../models';
import { ModuleNode } from '../models';
import type { ScopedParserContext } from '../parserContext';
import { substituteConditionalExports } from './conditionalSubstitution';
import { parseExport } from './exportParser';
import { applyExportTransforms } from './exportTransforms';
import { ParserError } from '../ParserError';

/**
 * Parses a source file into a ModuleNode: resolves every module export, drops
 * values re-exported through `export type *`, resolves generic conditional
 * aliases through their constraints, then applies post-parse export transforms
 * such as the React component transform.
 */
export function parseModule(sourceFile: ts.SourceFile, context: ScopedParserContext): ModuleNode {
  const { checker, compilerOptions } = context;

  return context.runWithSymbolScope(sourceFile.fileName, () => {
    try {
      const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
      if (!sourceFileSymbol) {
        throw new Error('Failed to get the source file symbol');
      }

      let parsedModuleExports: ExportNode[] = [];
      const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);
      const exportSymbols = new Map<ExportNode, ts.Symbol>();

      for (const exportedSymbol of exportedSymbols) {
        const parsedExports = parseExport(
          exportedSymbol,
          context,
          [],
          sourceFileSymbol,
          exportSymbols,
        );
        if (!parsedExports) {
          continue;
        }
        parsedModuleExports.push(...parsedExports);
      }

      const substitutedExports = substituteConditionalExports(exportSymbols, context);
      parsedModuleExports = parsedModuleExports.map(
        (exportNode) => substitutedExports.get(exportNode) ?? exportNode,
      );
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
