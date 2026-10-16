/* eslint-disable no-bitwise -- TypeScript symbol flags are bitmasks */
import ts from 'typescript';

/**
 * Maps every export of a module to its symbol, named the way typescript-api-extractor
 * names its exports: members of a namespace export get a dotted name, at any depth. That
 * covers `export * as Menu from './menu'` (`Menu.Root`), an in-file
 * `export namespace Row { ... }` (`Row.Cell`), and a namespace merged onto a function or
 * class (`Menu.Root.Props`). A module reached under two names is listed under both.
 *
 * Symbols are returned as exported, so aliases are not resolved; see {@link resolveAlias}.
 */
export function collectExportSymbols(
  moduleSymbol: ts.Symbol,
  checker: ts.TypeChecker,
): Map<string, ts.Symbol> {
  const symbolsByExportName = new Map<string, ts.Symbol>();
  const visit = (containerSymbol: ts.Symbol, prefix: string, ancestors: Set<ts.Symbol>) => {
    for (const exportSymbol of checker.getExportsOfModule(containerSymbol)) {
      const exportName = prefix + exportSymbol.name;
      symbolsByExportName.set(exportName, exportSymbol);

      const symbol = resolveAlias(exportSymbol, checker);
      if (symbol.flags & ts.SymbolFlags.Module && !ancestors.has(symbol)) {
        visit(symbol, `${exportName}.`, new Set([...ancestors, symbol]));
      }
    }
  };

  visit(moduleSymbol, '', new Set([moduleSymbol]));
  return symbolsByExportName;
}

/**
 * The symbol an export refers to: its target when it re-exports or imports one, itself
 * otherwise.
 */
export function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}
