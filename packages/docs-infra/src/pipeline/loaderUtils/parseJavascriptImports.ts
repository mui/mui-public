import ts from 'typescript';
import type { ExternalImport, ImportName, RelativeImport } from './parseImportsAndComments';

/**
 * Returns the end of an import/export-from construct beginning at `start`, or
 * null when the keyword starts another JavaScript construct such as `import.meta`.
 */
export function findJavascriptImportEnd(source: string, start: number): number | null {
  const candidate = source.slice(start);
  const sourceFile = ts.createSourceFile(
    'mdx-module-reference.tsx',
    candidate,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const statement = sourceFile.statements[0];
  if (
    statement &&
    ts.isImportDeclaration(statement) &&
    candidate[statement.getStart(sourceFile)] === 'i'
  ) {
    return start + statement.end;
  }
  if (
    statement &&
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier &&
    ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    return start + statement.end;
  }
  if (candidate.startsWith('import')) {
    let dynamicImport: ts.CallExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (
        !dynamicImport &&
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.getStart(sourceFile) === 0
      ) {
        dynamicImport = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (dynamicImport) {
      return start + dynamicImport.end;
    }
  }
  return null;
}

interface ParseJavascriptImportsOptions {
  sourceName: string;
  sourceOffset?: number;
  mapPosition?: (position: number) => number;
  resolveRelativeImport: (modulePath: string) => string;
  relative: Record<string, RelativeImport>;
  externals: Record<string, ExternalImport>;
}

/** Adds one parsed module reference to the relative or external import collection. */
function addModuleReference(
  modulePath: string,
  names: ImportName[],
  isTypeOnly: boolean,
  start: number,
  end: number,
  options: ParseJavascriptImportsOptions,
): void {
  if (!modulePath) {
    return;
  }
  const mapPosition = options.mapPosition ?? ((position: number) => position);
  const sourceOffset = options.sourceOffset ?? 0;
  const position = {
    start: mapPosition(sourceOffset + start),
    end: mapPosition(sourceOffset + end),
  };
  const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');
  const collection = isRelative ? options.relative : options.externals;
  let importData = collection[modulePath];
  if (!importData) {
    importData = {
      ...(isRelative && { url: options.resolveRelativeImport(modulePath) }),
      names: [],
      positions: [],
      ...(isRelative && isTypeOnly && { includeTypeDefs: true as const }),
    };
    collection[modulePath] = importData;
  } else if (isRelative && isTypeOnly) {
    const relativeImport = options.relative[modulePath];
    relativeImport.includeTypeDefs = true;
  }
  importData.positions.push(position);
  for (const name of names) {
    if (
      !importData.names.some(
        (existing) =>
          existing.name === name.name &&
          existing.type === name.type &&
          existing.alias === name.alias,
      )
    ) {
      importData.names.push(name);
    }
  }
}

/** Returns the imported bindings represented by an import declaration. */
function getImportNames(node: ts.ImportDeclaration): ImportName[] {
  const clause = node.importClause;
  if (!clause) {
    return [];
  }
  const names: ImportName[] = [];
  if (clause.name) {
    names.push({
      name: clause.name.text,
      type: 'default',
      ...(clause.isTypeOnly && { isType: true }),
    });
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    names.push({
      name: clause.namedBindings.name.text,
      type: 'namespace',
      ...(clause.isTypeOnly && { isType: true }),
    });
  } else if (clause.namedBindings) {
    for (const specifier of clause.namedBindings.elements) {
      names.push({
        name: specifier.propertyName?.text ?? specifier.name.text,
        ...(specifier.propertyName && { alias: specifier.name.text }),
        type: 'named',
        ...((clause.isTypeOnly || specifier.isTypeOnly) && { isType: true }),
      });
    }
  }
  return names;
}

/** Returns the exported bindings represented by an export-from declaration. */
function getExportNames(node: ts.ExportDeclaration): ImportName[] {
  if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
    return [
      {
        name: node.exportClause.name.text,
        type: 'namespace',
        ...(node.isTypeOnly && { isType: true }),
      },
    ];
  }
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return [];
  }
  return node.exportClause.elements.map((specifier) => ({
    name: specifier.propertyName?.text ?? specifier.name.text,
    ...(specifier.propertyName && { alias: specifier.name.text }),
    type: 'named' as const,
    ...((node.isTypeOnly || specifier.isTypeOnly) && { isType: true }),
  }));
}

/** Parses JavaScript/TypeScript module references using the TypeScript syntax tree. */
export function parseJavascriptImports(
  source: string,
  options: ParseJavascriptImportsOptions,
): void {
  const lowerName = options.sourceName.toLowerCase();
  let scriptKind = ts.ScriptKind.TS;
  if (lowerName.endsWith('.tsx')) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (lowerName.endsWith('.jsx')) {
    scriptKind = ts.ScriptKind.JSX;
  }
  const sourceFile = ts.createSourceFile(
    options.sourceName,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKind,
  );

  const addStringLiteral = (
    literal: ts.StringLiteralLike,
    names: ImportName[] = [],
    isTypeOnly: boolean = false,
  ): void => {
    addModuleReference(
      literal.text,
      names,
      isTypeOnly,
      literal.getStart(sourceFile),
      literal.end,
      options,
    );
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      source[node.getStart(sourceFile)] === 'i' &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addStringLiteral(
        node.moduleSpecifier,
        getImportNames(node),
        Boolean(node.importClause?.isTypeOnly),
      );
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addStringLiteral(node.moduleSpecifier, getExportNames(node), node.isTypeOnly);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addStringLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
