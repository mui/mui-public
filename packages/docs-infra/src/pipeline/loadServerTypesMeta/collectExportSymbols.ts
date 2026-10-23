/* eslint-disable no-bitwise -- TypeScript symbol flags are bitmasks */
import ts from 'typescript';
import type { ExportNode } from 'typescript-api-extractor';

/**
 * Maps the parsed exports of an entrypoint to their symbols. typescript-api-extractor gives
 * members of a namespace export a dotted name, at any depth. That covers
 * `export * as Menu from './menu'` (`Menu.Root`), an in-file `export namespace Row { ... }`
 * (`Row.Cell`), and a namespace merged onto a function or class (`Menu.Root.Props`). A
 * module reached under two names is listed under both.
 *
 * Only namespaces the parsed exports are named under are walked, so the walk is bounded by
 * the parsed exports, and skips namespaces the extractor didn't descend into, such as a
 * re-exported dependency.
 *
 * Symbols are returned as exported, so aliases are not resolved; see {@link resolveAlias}.
 */
export function collectExportSymbols(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  exports: ExportNode[],
): Map<string, ts.Symbol> {
  const symbolsByExportName = new Map<string, ts.Symbol>();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    return symbolsByExportName;
  }

  const namespaceNames = new Set<string>();
  for (const exportNode of exports) {
    for (
      let separator = exportNode.name.indexOf('.');
      separator !== -1;
      separator = exportNode.name.indexOf('.', separator + 1)
    ) {
      namespaceNames.add(exportNode.name.slice(0, separator));
    }
  }

  const visit = (containerSymbol: ts.Symbol, prefix: string) => {
    for (const exportSymbol of checker.getExportsOfModule(containerSymbol)) {
      const exportName = prefix + exportSymbol.name;
      symbolsByExportName.set(exportName, exportSymbol);

      const symbol = resolveAlias(exportSymbol, checker);
      if (symbol.flags & ts.SymbolFlags.Module && namespaceNames.has(exportName)) {
        visit(symbol, `${exportName}.`);
      }
    }
  };

  visit(moduleSymbol, '');
  return symbolsByExportName;
}

/**
 * The symbol an export refers to: its target when it re-exports or imports one, itself
 * otherwise.
 */
export function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
