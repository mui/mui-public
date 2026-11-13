import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type { ExportNode } from '../models';
import { declarationHasNodeModulesPathSegment } from './sourceFileUtils';

/** An emitted export paired with the symbol its descriptor targeted. */
export interface ParsedExport {
  node: ExportNode;
  symbol: ts.Symbol;
}

/** What identifying a declaration needs from the parser. */
export interface DeclarationIdContext {
  checker: ts.TypeChecker;
  program: ts.Program;
  /** Directory the declaration paths are hashed relative to, so ids do not depend on where the project is checked out. */
  rootDir: string;
}

interface DeclarationIdentity {
  id: string;
  declaredName: string | undefined;
}

const identities = new WeakMap<ts.Symbol, DeclarationIdentity | null>();

/**
 * Sets `declarationId` and `declaredName` on every export that resolves to a
 * declaration, so that exports reaching the same declaration under different
 * names carry the same id.
 *
 * Example: `export * as Dialog from './parts'` (with `Trigger` in the parts) next
 * to `export type * from './DialogTrigger'` emits `Dialog.Trigger` and
 * `DialogTrigger` for the same merged symbol, so both get one id.
 */
export function assignDeclarationIds(
  parsedExports: ParsedExport[],
  context: DeclarationIdContext,
): ExportNode[] {
  return parsedExports.map(({ node, symbol }) => {
    const identity = getDeclarationIdentity(resolveDeclarationSymbol(symbol, context), context);
    if (identity) {
      node.declarationId = identity.id;
      if (identity.declaredName !== undefined) {
        node.declaredName = identity.declaredName;
      }
    }
    return node;
  });
}

/**
 * Returns the id of the declaration a type reference names, when the project
 * declares it. Types declared in `node_modules` or the default library get none.
 */
export function getReferencedDeclarationId(
  symbol: ts.Symbol | undefined,
  context: DeclarationIdContext,
): string | undefined {
  if (!symbol) {
    return undefined;
  }
  const declarationSymbol = resolveDeclarationSymbol(symbol, context);
  if (declarationSymbol.declarations?.some((declaration) => isExternal(declaration, context))) {
    return undefined;
  }
  return getDeclarationIdentity(declarationSymbol, context)?.id;
}

function getDeclarationIdentity(
  declarationSymbol: ts.Symbol,
  context: DeclarationIdContext,
): DeclarationIdentity | undefined {
  let identity = identities.get(declarationSymbol);
  if (identity === undefined) {
    identity = createDeclarationIdentity(declarationSymbol, context.rootDir) ?? null;
    identities.set(declarationSymbol, identity);
  }
  return identity ?? undefined;
}

/**
 * Hashes where a symbol is declared: each declaration's file relative to `rootDir`
 * and its name qualified by the declarations enclosing it. Returns `undefined` for
 * a symbol that does not stand for one declaration: one without declarations, such
 * as the checker's fallback for a re-export from a missing module, or one declared
 * by an ambient module that stands in for many modules (`declare module 'pkg';`,
 * `declare module '*.svg' {}`), which every export it types would otherwise share.
 */
function createDeclarationIdentity(
  symbol: ts.Symbol,
  rootDir: string,
): DeclarationIdentity | undefined {
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0 || declarations.some(isInModuleStandIn)) {
    return undefined;
  }

  const locations = new Set(
    declarations.map((declaration) => {
      const filePath = path
        .relative(rootDir, declaration.getSourceFile().fileName)
        .replace(/\\/g, '/');
      return `${filePath}#${getQualifiedDeclaredName(declaration, symbol).join('.')}`;
    }),
  );

  return {
    id: createHash('sha256')
      .update([...locations].sort().join('\n'))
      .digest('hex')
      .slice(0, 16),
    declaredName: getQualifiedDeclaredName(declarations[0], symbol).at(-1),
  };
}

function isInModuleStandIn(declaration: ts.Node): boolean {
  for (let node: ts.Node | undefined = declaration; node; node = node.parent) {
    if (
      ts.isModuleDeclaration(node) &&
      ts.isStringLiteral(node.name) &&
      (!node.body || node.name.text.includes('*'))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The declaration's name, preceded by the names of the declarations enclosing it
 * (namespaces, `declare module 'pkg'` blocks, classes, objects, functions), so
 * same-named declarations in one file stay apart.
 */
function getQualifiedDeclaredName(declaration: ts.Declaration, symbol: ts.Symbol): string[] {
  // A module's symbol is named after its absolute file path; the relative path already
  // identifies it.
  if (ts.isSourceFile(declaration)) {
    return [];
  }
  const segments: string[] = [];
  for (let node: ts.Node | undefined = declaration; node; node = node.parent) {
    const name = isNamedContainer(node) ? ts.getNameOfDeclaration(node) : undefined;
    if (name && ts.isIdentifier(name)) {
      segments.unshift(name.text);
    } else if (name && ts.isStringLiteral(name)) {
      segments.unshift(JSON.stringify(name.text));
    } else if (node === declaration) {
      segments.unshift(symbol.name);
    }
  }
  return segments;
}

function isNamedContainer(node: ts.Node): node is ts.Declaration {
  return (
    ts.isModuleDeclaration(node) ||
    ts.isClassLike(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isFunctionLike(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isEnumMember(node)
  );
}

/**
 * Follows import/export aliases, local export bindings and plain renames to the
 * symbol that owns the declaration, so every route to a declaration (including
 * merged `const` + `interface` + `namespace` declarations) has one identity. An
 * alias that declarations are merged onto where it is imported, such as an
 * imported function with a local interface of the same name, is a symbol of its own.
 */
function resolveDeclarationSymbol(symbol: ts.Symbol, context: DeclarationIdContext): ts.Symbol {
  let current = resolveBinding(symbol, context.checker);
  const seen = new Set([current]);
  for (;;) {
    const target = getRenamedSymbol(current, context);
    if (!target || seen.has(target)) {
      return current;
    }
    seen.add(target);
    current = target;
  }
}

function resolveBinding(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  const resolved =
    symbol.flags & ts.SymbolFlags.Alias && !hasMergedDeclarations(symbol)
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return resolved.flags & ts.SymbolFlags.ExportValue
    ? checker.getExportSymbolOfSymbol(resolved)
    : resolved;
}

/**
 * The type a plain rename names: `type A = B`, or `type A<T> = B<T>` passing its
 * type parameters through in order, with the constraints and defaults of the
 * type it names (or a default where it has none). A rename is the type it renames, so both share one identity.
 * Renames of external and built-in types are their own declarations, so
 * `export type Element = HTMLElement` does not stand for every `HTMLElement`.
 */
function getRenamedSymbol(symbol: ts.Symbol, context: DeclarationIdContext): ts.Symbol | undefined {
  const declarations = symbol.declarations ?? [];
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  if (
    !declaration ||
    !ts.isTypeAliasDeclaration(declaration) ||
    !ts.isTypeReferenceNode(declaration.type)
  ) {
    return undefined;
  }

  const { checker } = context;
  const referenceName = declaration.type.typeName;
  const referenced = checker.getSymbolAtLocation(
    ts.isQualifiedName(referenceName) ? referenceName.right : referenceName,
  );
  if (!referenced) {
    return undefined;
  }
  const target = resolveBinding(referenced, checker);
  if (
    !target.declarations?.length ||
    target.declarations.some((targetDeclaration) => isExternal(targetDeclaration, context))
  ) {
    return undefined;
  }

  const parameters = declaration.typeParameters ?? [];
  const targetParameters = getTypeParameters(target);
  const typeArguments = declaration.type.typeArguments ?? [];
  const isPassThrough =
    parameters.length === targetParameters.length &&
    typeArguments.length === parameters.length &&
    parameters.every(
      (parameter, index) =>
        isReferenceTo(typeArguments[index], parameter, checker) &&
        isSameTypeNode(
          [parameter.constraint, parameters],
          [targetParameters[index].constraint, targetParameters],
          checker,
        ) &&
        // A default where the renamed type has none only lets the rename be written
        // without that argument.
        (targetParameters[index].default === undefined ||
          isSameTypeNode(
            [parameter.default, parameters],
            [targetParameters[index].default, targetParameters],
            checker,
          )),
    );
  return isPassThrough ? target : undefined;
}

function getTypeParameters(symbol: ts.Symbol): readonly ts.TypeParameterDeclaration[] {
  for (const declaration of symbol.declarations ?? []) {
    if (
      (ts.isTypeAliasDeclaration(declaration) ||
        ts.isInterfaceDeclaration(declaration) ||
        ts.isClassDeclaration(declaration)) &&
      declaration.typeParameters
    ) {
      return declaration.typeParameters;
    }
  }
  return [];
}

function isReferenceTo(
  argument: ts.TypeNode,
  parameter: ts.TypeParameterDeclaration,
  checker: ts.TypeChecker,
): boolean {
  return (
    ts.isTypeReferenceNode(argument) &&
    !argument.typeArguments &&
    checker.getSymbolAtLocation(argument.typeName) === checker.getSymbolAtLocation(parameter.name)
  );
}

type ParameterTypeNode = [
  node: ts.TypeNode | undefined,
  parameters: readonly ts.TypeParameterDeclaration[],
];

/**
 * Whether a constraint or default of a rename's type parameter is the one of the type it
 * renames: the same type, or a reference to the type parameter at the same position
 * (`Item = Value` in both).
 */
function isSameTypeNode(
  [left, leftParameters]: ParameterTypeNode,
  [right, rightParameters]: ParameterTypeNode,
  checker: ts.TypeChecker,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  const leftIndex = getParameterIndex(left, leftParameters, checker);
  const rightIndex = getParameterIndex(right, rightParameters, checker);
  if (leftIndex !== -1 || rightIndex !== -1) {
    return leftIndex === rightIndex;
  }
  return checker.getTypeFromTypeNode(left) === checker.getTypeFromTypeNode(right);
}

function getParameterIndex(
  node: ts.TypeNode,
  parameters: readonly ts.TypeParameterDeclaration[],
  checker: ts.TypeChecker,
): number {
  return parameters.findIndex((parameter) => isReferenceTo(node, parameter, checker));
}

function isExternal(declaration: ts.Declaration, context: DeclarationIdContext): boolean {
  return (
    declarationHasNodeModulesPathSegment(declaration) ||
    context.program.isSourceFileDefaultLibrary(declaration.getSourceFile())
  );
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
