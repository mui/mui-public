import path from 'node:path';
import ts from 'typescript';
import { ModuleNode } from '../models';
import type { ScopedParserContext } from '../parserContext';
import { assignDeclarationIds } from './declarationIds';
import type { ParsedExport } from './declarationIds';
import { parseExport } from './exportParser';
import { applyExportTransforms } from './exportTransforms';
import { ParserError } from '../ParserError';

/**
 * Parses a source file into a ModuleNode: resolves every module export, drops
 * values re-exported through `export type *`, applies post-parse export
 * transforms such as the React component transform, then gives every export the
 * id of the declaration it resolves to.
 */
export function parseModule(sourceFile: ts.SourceFile, context: ScopedParserContext): ModuleNode {
  const { checker, compilerOptions } = context;

  return context.runWithSymbolScope(sourceFile.fileName, () => {
    try {
      const sourceFileSymbol = checker.getSymbolAtLocation(sourceFile);
      if (!sourceFileSymbol) {
        throw new Error('Failed to get the source file symbol');
      }

      const parsedExports: ParsedExport[] = [];
      const exportedSymbols = checker.getExportsOfModule(sourceFileSymbol);

      for (const exportedSymbol of exportedSymbols) {
        parsedExports.push(...parseExport(exportedSymbol, context, [], sourceFileSymbol));
      }

      // Transforms map nodes one to one, in order, so each keeps its export's symbol.
      const transformedExports = applyExportTransforms(
        parsedExports.map(({ node }) => node),
        context,
      );
      const parsedModuleExports = assignDeclarationIds(
        transformedExports.map((node, index) => ({ node, symbol: parsedExports[index].symbol })),
        checker,
        compilerOptions.rootDir!,
      );

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
