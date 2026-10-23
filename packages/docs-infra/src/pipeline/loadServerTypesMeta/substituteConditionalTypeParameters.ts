/* eslint-disable no-bitwise -- TypeScript type and symbol flags are bitmasks */
import ts from 'typescript';
import { parseFromProgram, withTypeName } from 'typescript-api-extractor';
import type { ExportNode, ParserOptions } from 'typescript-api-extractor';
import { resolveAlias } from './collectExportSymbols';

interface Candidate {
  declaration: ts.TypeAliasDeclaration;
  /** The exports documenting the declaration, more than one when it is reached twice. */
  exportNames: string[];
  /** The companion's export name in the declaring file, qualified by its namespaces. */
  companionExportName: string;
  wideProbeName: string;
  narrowProbeName: string;
}

/**
 * An alias written next to a declaration, generic over the same type parameters, whose
 * body is the condition that declaration resolves through, with `'T'` and `'F'` in place of
 * its branches.
 */
interface Probe {
  name: string;
  declaration: ts.TypeAliasDeclaration;
}

/**
 * Re-resolves generic type aliases whose body is a conditional type that tests their own
 * type parameters. Left generic, TypeScript cannot pick a branch of such a conditional, so
 * the extractor merges every branch into one misleading shape.
 *
 * A branch is only picked when every type argument a caller can pass picks it, apart from
 * `any`. That is checked at both ends of what the tested type parameters accept: their
 * constraint (`unknown` without one), and `never`. When the condition agrees at both ends,
 * the alias is resolved with the constraints substituted. Untested type parameters stay
 * generic, and the export keeps its original name and type parameter list. A condition that
 * distributes over a tested type parameter yields `never` at the `never` end, so it is only
 * resolved when the constraint takes the true branch, which every narrower type then takes
 * too.
 *
 * Generated aliases that don't type-check are a bug, so they throw.
 *
 * Set `DEBUG_DOCS_INFRA_SUBSTITUTION` to log one line per candidate: the export, the
 * condition at both ends, and whether the substitution was applied.
 */
export function substituteConditionalTypeParameters(
  exports: ExportNode[],
  symbolsByExportName: Map<string, ts.Symbol>,
  program: ts.Program,
  parserOptions: ParserOptions,
): ExportNode[] {
  const checker = program.getTypeChecker();
  // Aliases to write right after each declaration, so they see the names it sees.
  const insertions = new Map<ts.TypeAliasDeclaration, string[]>();
  const generatedNames = new Set<string>();
  const probes = new Map<ts.TypeAliasDeclaration, Probe | undefined>();
  const candidates = new Map<ts.TypeAliasDeclaration, Candidate>();

  const writeAlias = (declaration: ts.TypeAliasDeclaration, body: string) => {
    const name = `__docsSubstituted${generatedNames.size}`;
    generatedNames.add(name);
    const aliases = insertions.get(declaration) ?? [];
    aliases.push(`type ${name}${getTypeParameterList(declaration)} = ${body};`);
    insertions.set(declaration, aliases);
    return name;
  };

  // Writes the probe for a declaration, and for each alias it forwards to on the way to the
  // conditional, such as `type Cell<Row, Columns> = RowCell<Row, Columns>` in another file.
  const createProbe = (
    declaration: ts.TypeAliasDeclaration,
    conditional: ts.ConditionalTypeNode,
  ): Probe | undefined => {
    if (probes.has(declaration)) {
      return probes.get(declaration);
    }
    probes.set(declaration, undefined);

    const body = skipParentheses(declaration.type);
    let condition: string | undefined;
    if (body === conditional) {
      condition = `${conditional.checkType.getText()} extends ${conditional.extendsType.getText()} ? 'T' : 'F'`;
    } else if (ts.isTypeReferenceNode(body) && body.typeArguments) {
      const target = getTypeAliasDeclaration(body.typeName, checker);
      const targetProbe =
        target &&
        !isFromDependency(target.getSourceFile(), program) &&
        createProbe(target, conditional);
      if (targetProbe) {
        const typeArguments = body.typeArguments.map((argument) => argument.getText());
        condition = `${getProbeReference(targetProbe, declaration)}<${typeArguments.join(', ')}>`;
      }
    }
    if (!condition) {
      return undefined;
    }

    const probe: Probe = { name: writeAlias(declaration, condition), declaration };
    probes.set(declaration, probe);
    return probe;
  };

  for (const exportNode of exports) {
    const exportSymbol = symbolsByExportName.get(exportNode.name);
    const symbol = exportSymbol && resolveAlias(exportSymbol, checker);
    // When a value shares the name, the export documents the value, not the alias.
    if (!symbol || symbol.flags & ts.SymbolFlags.Value) {
      continue;
    }

    const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
    const existing = declaration && candidates.get(declaration);
    if (existing) {
      existing.exportNames.push(exportNode.name);
      continue;
    }

    const typeParameters = declaration?.typeParameters;
    const conditional = declaration && getProjectConditional(declaration, program);
    if (!declaration || !typeParameters || !conditional) {
      continue;
    }

    const testedParameters = getTestedTypeParameters(typeParameters, conditional, checker);
    const probe = testedParameters.size > 0 && createProbe(declaration, conditional.root.node);
    if (!probe) {
      continue;
    }

    // Tested type parameters get their constraint. Every original type parameter is kept on
    // the generated aliases, so constraints and defaults that refer to one still resolve.
    const getTypeArguments = (getUntested: (parameter: ts.TypeParameterDeclaration) => string) =>
      typeParameters
        .map((parameter) =>
          testedParameters.has(parameter)
            ? (parameter.constraint?.getText() ?? 'unknown')
            : getUntested(parameter),
        )
        .join(', ');
    const companionName = writeAlias(
      declaration,
      `${declaration.name.text}<${getTypeArguments((parameter) => parameter.name.text)}>`,
    );
    candidates.set(declaration, {
      declaration,
      exportNames: [exportNode.name],
      companionExportName: [...getNamespacePath(declaration), companionName].join('.'),
      // The condition doesn't involve untested type parameters, so the probes pass `never`,
      // which satisfies any constraint they have on a substituted one.
      wideProbeName: writeAlias(declaration, `${probe.name}<${getTypeArguments(() => 'never')}>`),
      narrowProbeName: writeAlias(
        declaration,
        `${probe.name}<${typeParameters.map(() => 'never').join(', ')}>`,
      ),
    });
  }

  if (candidates.size === 0) {
    return exports;
  }

  const companionProgram = createCompanionProgram(program, insertions);
  const companionChecker = companionProgram.getTypeChecker();
  const aliasesByName = new Map<string, ts.TypeAliasDeclaration>();
  for (const fileName of new Set(
    Array.from(insertions.keys(), (declaration) => declaration.getSourceFile().fileName),
  )) {
    collectGeneratedAliases(
      companionProgram.getSourceFile(fileName)!,
      generatedNames,
      aliasesByName,
    );
  }

  const appliedCandidates = new Map<string, Candidate>();
  for (const candidate of candidates.values()) {
    const wide = readProbe(candidate.wideProbeName, aliasesByName, companionChecker);
    const narrow = readProbe(candidate.narrowProbeName, aliasesByName, companionChecker);
    const isApplied =
      narrow === 'never' ? wide === 'T' : wide === narrow && (wide === 'T' || wide === 'F');
    if (isApplied) {
      appliedCandidates.set(candidate.companionExportName, candidate);
    }
    if (process.env.DEBUG_DOCS_INFRA_SUBSTITUTION) {
      console.error(
        `[substitute] ${candidate.exportNames.join(', ')}: constraint ${wide}, never ${narrow}, ${
          isApplied ? 'applied' : 'kept'
        }`,
      );
    }
  }

  const substitutedTypes = new Map<string, ExportNode['type']>();
  const companionFiles = new Set(
    Array.from(
      appliedCandidates.values(),
      (candidate) => candidate.declaration.getSourceFile().fileName,
    ),
  );
  for (const fileName of companionFiles) {
    for (const companionExport of parseFromProgram(fileName, companionProgram, parserOptions)
      .exports) {
      const candidate = appliedCandidates.get(companionExport.name);
      if (candidate) {
        for (const exportName of candidate.exportNames) {
          substitutedTypes.set(exportName, companionExport.type);
        }
        appliedCandidates.delete(companionExport.name);
      }
    }
  }
  if (appliedCandidates.size > 0) {
    throw new Error(
      `Substituted types are missing from the parsed exports: ${Array.from(appliedCandidates.keys()).join(', ')}`,
    );
  }

  return exports.map((exportNode) => {
    const substitutedType = substitutedTypes.get(exportNode.name);
    const originalTypeName = 'typeName' in exportNode.type ? exportNode.type.typeName : undefined;
    if (!substitutedType || !originalTypeName) {
      return exportNode;
    }
    return exportNode.withType(withTypeName(substitutedType, originalTypeName));
  });
}

/**
 * The unresolved conditional an alias resolves to, when it is written in the project. One
 * inside a dependency, like React's `ComponentPropsWithRef`, is not part of the documented
 * API.
 */
function getProjectConditional(
  declaration: ts.TypeAliasDeclaration,
  program: ts.Program,
): ts.ConditionalType | undefined {
  const aliasType = program.getTypeChecker().getTypeAtLocation(declaration.name);
  if (!(aliasType.flags & ts.TypeFlags.Conditional)) {
    return undefined;
  }

  const conditional = aliasType as ts.ConditionalType;
  return isFromDependency(conditional.root.node.getSourceFile(), program) ? undefined : conditional;
}

/**
 * The type parameters of an alias that its resolved conditional tests. Following the
 * resolved type rather than the syntax covers aliases that pass their parameters on to a
 * conditional alias, such as `type Cell<Row, Columns> = RowCell<Row, Columns>`.
 */
function getTestedTypeParameters(
  typeParameters: ts.NodeArray<ts.TypeParameterDeclaration>,
  conditional: ts.ConditionalType,
  checker: ts.TypeChecker,
): Set<ts.TypeParameterDeclaration> {
  // Both sides of the condition, but not the conditional's own alias arguments, which list
  // every type parameter of the alias.
  const referenced = new Set<ts.Type>();
  const visited = new Set<ts.Type>();
  collectTypeParameters(conditional.checkType, checker, referenced, visited);
  collectTypeParameters(conditional.extendsType, checker, referenced, visited);

  return new Set(
    typeParameters.filter((parameter) => referenced.has(checker.getTypeAtLocation(parameter.name))),
  );
}

function isFromDependency(sourceFile: ts.SourceFile, program: ts.Program): boolean {
  return (
    program.isSourceFileFromExternalLibrary(sourceFile) ||
    program.isSourceFileDefaultLibrary(sourceFile)
  );
}

function collectTypeParameters(
  type: ts.Type,
  checker: ts.TypeChecker,
  referenced: Set<ts.Type>,
  visited: Set<ts.Type>,
): void {
  if (visited.has(type)) {
    return;
  }
  visited.add(type);

  if (type.flags & ts.TypeFlags.TypeParameter) {
    referenced.add(type);
  }
  if (type.flags & ts.TypeFlags.Conditional) {
    const conditional = type as ts.ConditionalType;
    collectTypeParameters(conditional.checkType, checker, referenced, visited);
    collectTypeParameters(conditional.extendsType, checker, referenced, visited);
  }
  if (type.isUnionOrIntersection()) {
    for (const member of type.types) {
      collectTypeParameters(member, checker, referenced, visited);
    }
  }
  if (type.flags & ts.TypeFlags.IndexedAccess) {
    const indexedAccess = type as ts.IndexedAccessType;
    collectTypeParameters(indexedAccess.objectType, checker, referenced, visited);
    collectTypeParameters(indexedAccess.indexType, checker, referenced, visited);
  }
  if (type.flags & ts.TypeFlags.Index) {
    collectTypeParameters((type as ts.IndexType).type, checker, referenced, visited);
  }
  for (const argument of type.aliasTypeArguments ?? []) {
    collectTypeParameters(argument, checker, referenced, visited);
  }
  if (
    type.flags & ts.TypeFlags.Object &&
    (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
  ) {
    for (const argument of checker.getTypeArguments(type as ts.TypeReference)) {
      collectTypeParameters(argument, checker, referenced, visited);
    }
  }
}

function skipParentheses(node: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(node) ? skipParentheses(node.type) : node;
}

function getTypeAliasDeclaration(
  typeName: ts.EntityName,
  checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
  const symbol = checker.getSymbolAtLocation(typeName);
  return symbol && resolveAlias(symbol, checker).declarations?.find(ts.isTypeAliasDeclaration);
}

function getTypeParameterList(declaration: ts.TypeAliasDeclaration): string {
  const parameters = declaration.typeParameters ?? [];
  return parameters.length > 0
    ? `<${parameters.map((parameter) => parameter.getText()).join(', ')}>`
    : '';
}

/**
 * How code next to `from` names a probe. Within one file, or for a probe in a global
 * script, that is its name qualified by its enclosing namespaces. Another module is reached
 * through an `import()` type with an absolute specifier, so no relative path is needed.
 */
function getProbeReference(probe: Probe, from: ts.TypeAliasDeclaration): string {
  const qualifiedName = [...getNamespacePath(probe.declaration), probe.name].join('.');
  const sourceFile = probe.declaration.getSourceFile();
  if (sourceFile === from.getSourceFile() || !ts.isExternalModule(sourceFile)) {
    return qualifiedName;
  }

  const specifier = sourceFile.fileName.replace(
    /(?:\.d)?\.([cm]?)tsx?$/,
    (match, moduleKind: string) => `.${moduleKind}js`,
  );
  return `import(${JSON.stringify(specifier)}).${qualifiedName}`;
}

function getNamespacePath(node: ts.Node): string[] {
  const names: string[] = [];
  for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isModuleDeclaration(parent) && ts.isIdentifier(parent.name)) {
      names.unshift(parent.name.text);
    }
  }
  return names;
}

/**
 * Builds a program in which each declaration is followed by its generated aliases. They are
 * exported, except at the top level of a global script, where exporting would turn the
 * script into a module.
 */
function createCompanionProgram(
  program: ts.Program,
  insertions: Map<ts.TypeAliasDeclaration, string[]>,
): ts.Program {
  const declarationsByFile = new Map<ts.SourceFile, ts.TypeAliasDeclaration[]>();
  for (const declaration of insertions.keys()) {
    const sourceFile = declaration.getSourceFile();
    declarationsByFile.set(sourceFile, [
      ...(declarationsByFile.get(sourceFile) ?? []),
      declaration,
    ]);
  }

  const replacedFiles = new Map<string, { text: string; ranges: Array<[number, number]> }>();
  for (const [sourceFile, declarations] of declarationsByFile) {
    const ranges: Array<[number, number]> = [];
    let text = '';
    let position = 0;
    for (const declaration of declarations.sort((first, second) => first.end - second.end)) {
      const exportKeyword =
        ts.isSourceFile(declaration.parent) && !ts.isExternalModule(sourceFile) ? '' : 'export ';
      text += `${sourceFile.text.slice(position, declaration.end)}\n`;
      const start = text.length;
      text += insertions
        .get(declaration)!
        .map((alias) => `${exportKeyword}${alias}`)
        .join('\n');
      ranges.push([start, text.length]);
      position = declaration.end;
    }
    text += sourceFile.text.slice(position);
    replacedFiles.set(sourceFile.fileName, { text, ranges });
  }

  // Generated aliases are type-checked even in declaration files.
  const options = { ...program.getCompilerOptions(), skipLibCheck: false };
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  // Relative names resolve from the original program's directory, not the process's.
  host.getCurrentDirectory = () => program.getCurrentDirectory();
  // Unchanged files are served from the original program, so the new one reuses them.
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    const replacedFile = replacedFiles.get(fileName);
    if (replacedFile) {
      return ts.createSourceFile(fileName, replacedFile.text, languageVersionOrOptions, true);
    }
    return (
      getOriginalSourceFile(program, fileName) ??
      getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
    );
  };

  const companionProgram = ts.createProgram({
    rootNames: program.getRootFileNames(),
    options,
    host,
    oldProgram: program,
  });

  for (const [fileName, { text, ranges }] of replacedFiles) {
    const sourceFile = companionProgram.getSourceFile(fileName)!;
    const diagnostics = [
      ...companionProgram.getSyntacticDiagnostics(sourceFile),
      ...companionProgram.getSemanticDiagnostics(sourceFile),
    ];
    for (const diagnostic of diagnostics) {
      const { start } = diagnostic;
      const range =
        start !== undefined &&
        ranges.find(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd);
      if (range) {
        throw new Error(
          `A type generated to resolve conditional types in ${fileName} doesn't type-check: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}\n${text.slice(...range)}`,
        );
      }
    }
  }

  return companionProgram;
}

/**
 * A duplicate copy of a package's file is a redirect, which a host must not return. Its
 * unredirected file is what program reuse expects instead. TypeScript only exposes this
 * through the internal `redirectInfo`.
 */
function getOriginalSourceFile(program: ts.Program, fileName: string): ts.SourceFile | undefined {
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile && 'redirectInfo' in sourceFile) {
    const { redirectInfo } = sourceFile as { redirectInfo?: { unredirected: ts.SourceFile } };
    return redirectInfo ? redirectInfo.unredirected : sourceFile;
  }
  return sourceFile;
}

function collectGeneratedAliases(
  node: ts.Node,
  generatedNames: Set<string>,
  aliasesByName: Map<string, ts.TypeAliasDeclaration>,
): void {
  if (ts.isTypeAliasDeclaration(node) && generatedNames.has(node.name.text)) {
    aliasesByName.set(node.name.text, node);
    return;
  }
  if (ts.isSourceFile(node) || ts.isModuleDeclaration(node) || ts.isModuleBlock(node)) {
    ts.forEachChild(node, (child) => collectGeneratedAliases(child, generatedNames, aliasesByName));
  }
}

/**
 * Which branch a probe takes: `T`, `F`, `never` when a distributive condition had nothing to
 * distribute over, or `undecided` when it is both branches or still generic.
 */
function readProbe(
  name: string,
  aliasesByName: Map<string, ts.TypeAliasDeclaration>,
  checker: ts.TypeChecker,
): 'T' | 'F' | 'never' | 'undecided' {
  const declaration = aliasesByName.get(name);
  if (!declaration) {
    throw new Error(`The generated alias ${name} is missing from the substitution program.`);
  }

  const type = checker.getTypeAtLocation(declaration.name);
  if (type.flags & ts.TypeFlags.Never) {
    return 'never';
  }
  if (type.isStringLiteral() && (type.value === 'T' || type.value === 'F')) {
    return type.value;
  }
  return 'undecided';
}
