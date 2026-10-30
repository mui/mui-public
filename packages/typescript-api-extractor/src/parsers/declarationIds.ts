import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { ExportNode } from '../models';

/** An emitted export paired with the symbol its descriptor targeted. */
export interface ParsedExport {
  node: ExportNode;
  symbol: ts.Symbol;
}

/**
 * Sets `declarationId` on every export that resolves to a declaration, so that
 * exports reaching the same declaration under different names carry the same id.
 *
 * Example: `export * as Dialog from './parts'` (with `Trigger` in the parts) next
 * to `export type * from './DialogTrigger'` emits `Dialog.Trigger` and
 * `DialogTrigger` for the same merged symbol, so both get one id.
 *
 * @param parsedExports The module's exports, each with the symbol it was resolved from.
 * @param checker Type checker for following aliases.
 * @param rootDir Directory the declaration paths are hashed relative to, so ids do not depend on where the project is checked out.
 */
export function assignDeclarationIds(
  parsedExports: ParsedExport[],
  checker: ts.TypeChecker,
  rootDir: string,
): ExportNode[] {
  const ids = new Map<ts.Symbol, string | undefined>();
  return parsedExports.map(({ node, symbol }) => {
    const declarationSymbol = resolveDeclarationSymbol(symbol, checker);
    if (!ids.has(declarationSymbol)) {
      ids.set(declarationSymbol, createDeclarationId(declarationSymbol, rootDir));
    }
    const declarationId = ids.get(declarationSymbol);
    if (declarationId !== undefined) {
      node.declarationId = declarationId;
    }
    return node;
  });
}

/**
 * Hashes where a symbol is declared: each declaration's file relative to `rootDir`
 * and its name qualified by the namespaces enclosing it. Returns `undefined` for a
 * symbol without declarations, such as the checker's fallback for a re-export from
 * a missing module, which every unresolved export would otherwise share.
 */
function createDeclarationId(symbol: ts.Symbol, rootDir: string): string | undefined {
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) {
    return undefined;
  }

  const locations = new Set(
    declarations.map((declaration) => {
      const filePath = path
        .relative(rootDir, declaration.getSourceFile().fileName)
        .replace(/\\/g, '/');
      return `${filePath}#${getQualifiedDeclaredName(declaration, symbol)}`;
    }),
  );

  return createHash('sha256')
    .update([...locations].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
}

function getQualifiedDeclaredName(declaration: ts.Declaration, symbol: ts.Symbol): string {
  // A module's symbol is named after its absolute file path; the relative path already
  // identifies it.
  if (ts.isSourceFile(declaration)) {
    return '';
  }
  const name = ts.getNameOfDeclaration(declaration);
  const segments = [name && ts.isIdentifier(name) ? name.text : symbol.name];
  for (let parent = declaration.parent; parent; parent = parent.parent) {
    if (ts.isModuleDeclaration(parent) && ts.isIdentifier(parent.name)) {
      segments.unshift(parent.name.text);
    }
  }
  return segments.join('.');
}

/**
 * Follows import/export aliases and local export bindings to the symbol that
 * owns the declaration, so every route to a declaration (including merged
 * `const` + `interface` + `namespace` declarations) has one identity. An alias
 * that declarations are merged onto where it is imported, such as an imported
 * function with a local interface of the same name, is a symbol of its own.
 */
function resolveDeclarationSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias && !hasMergedDeclarations(symbol)
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return resolved.flags & ts.SymbolFlags.ExportValue
    ? checker.getExportSymbolOfSymbol(resolved)
    : resolved;
}

function hasMergedDeclarations(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some((declaration) => !isAliasDeclaration(declaration));
}

function isAliasDeclaration(declaration: ts.Declaration): boolean {
  return (
    ts.isImportSpecifier(declaration) ||
    ts.isImportClause(declaration) ||
    ts.isNamespaceImport(declaration) ||
    ts.isImportEqualsDeclaration(declaration) ||
    ts.isExportSpecifier(declaration) ||
    ts.isNamespaceExport(declaration) ||
    ts.isExportAssignment(declaration)
  );
}
