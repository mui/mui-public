import ts from 'typescript';
import { withTypeName } from '../models';
import type { ExportNode } from '../models';
import type { ScopedParserContext } from '../parserContext';
import { createParserContext } from '../parserContextFactory';
import { parseExport } from './exportParser';
import { unwrapParenthesizedTypeNode } from './typeResolvers/typeOperatorTypeNodes';

/** One alias declaration to resolve, and the exports that document it. */
interface Candidate {
  declaration: ts.TypeAliasDeclaration;
  exportNodes: ExportNode[];
  companionName: string;
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
 * Re-resolves exported generic type aliases whose body is a conditional type that tests
 * their own type parameters. Left generic, TypeScript cannot pick a branch of such a
 * conditional, so it resolves to every branch at once.
 *
 * The condition is checked at both ends of what the tested type parameters accept: their
 * constraint (`unknown` without one), and `never`. When it agrees at both ends, the alias is
 * resolved with the constraints substituted. Untested type parameters stay generic, and the
 * export keeps its name and type parameter list. For a condition that only flips one way as
 * the type argument narrows, such as an `IsAny` guard, the branch holds for every type
 * argument but `any`; an equality check can still differ in between. A condition that
 * distributes over a tested type parameter yields `never` at the `never` end and is left to
 * the type resolvers.
 *
 * TypeScript only instantiates an alias with chosen type arguments when they are written
 * out, so the substitutions are written as aliases next to each declaration, in a second
 * program that reuses the first. Generated aliases that don't type-check are a bug, so they
 * throw.
 *
 * @param exportSymbols - Each parsed export, with the symbol it was resolved from.
 * @param context - Context of the program being parsed.
 * @returns The exports whose type changed, mapped to their replacement.
 */
export function substituteConditionalExports(
  exportSymbols: ReadonlyMap<ExportNode, ts.Symbol>,
  context: ScopedParserContext,
): Map<ExportNode, ExportNode> {
  const { checker, program } = context;
  // Aliases to write right after each declaration, so they see the names it sees.
  const insertions = new Map<ts.TypeAliasDeclaration, string[]>();
  const generatedNames = new Set<string>();
  const probes = new Map<ts.TypeAliasDeclaration, Probe | undefined>();
  const candidates = new Map<ts.TypeAliasDeclaration, Candidate>();

  const writeAlias = (declaration: ts.TypeAliasDeclaration, body: string) => {
    const name = `__substituted${generatedNames.size}`;
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

    const body = unwrapParenthesizedTypeNode(declaration.type);
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

  for (const [exportNode, symbol] of exportSymbols) {
    // When a value shares the name, the export documents the value, not the alias.
    if (exportNode.isValue) {
      continue;
    }

    const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
    const existing = declaration && candidates.get(declaration);
    if (existing) {
      existing.exportNodes.push(exportNode);
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
    candidates.set(declaration, {
      declaration,
      exportNodes: [exportNode],
      companionName: writeAlias(
        declaration,
        `${declaration.name.text}<${getTypeArguments((parameter) => parameter.name.text)}>`,
      ),
      // The condition doesn't involve untested type parameters, so the probes pass `never`,
      // which satisfies any constraint they have on a substituted one.
      wideProbeName: writeAlias(declaration, `${probe.name}<${getTypeArguments(() => 'never')}>`),
      narrowProbeName: writeAlias(
        declaration,
        `${probe.name}<${typeParameters.map(() => 'never').join(', ')}>`,
      ),
    });
  }

  const replacements = new Map<ExportNode, ExportNode>();
  if (candidates.size === 0) {
    return replacements;
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

  for (const candidate of candidates.values()) {
    const wide = readProbe(candidate.wideProbeName, aliasesByName, companionChecker);
    const narrow = readProbe(candidate.narrowProbeName, aliasesByName, companionChecker);
    if (wide !== narrow || (wide !== 'T' && wide !== 'F')) {
      continue;
    }

    const companion = getGeneratedAlias(candidate.companionName, aliasesByName);
    const companionSymbol = companionChecker.getSymbolAtLocation(companion.name)!;
    const companionContext = createParserContext(
      companionChecker,
      companion.getSourceFile(),
      companionProgram,
      {
        shouldInclude: context.shouldInclude,
        shouldResolveObject: context.shouldResolveObject,
        includeExternalTypes: context.includeExternalTypes,
        typeOperatorOutput: context.typeOperatorOutput,
        // Everything this resolves, the original parse of the export already resolved and
        // reported at its real location. Locations here are shifted by the generated aliases.
        onWarning: () => {},
      },
    );
    const [companionExport] = parseExport(companionSymbol, companionContext) ?? [];
    if (!companionExport) {
      throw new Error(`The generated alias ${candidate.companionName} could not be parsed.`);
    }

    for (const exportNode of candidate.exportNodes) {
      const typeName = 'typeName' in exportNode.type ? exportNode.type.typeName : undefined;
      if (typeName) {
        replacements.set(
          exportNode,
          exportNode.withType(withTypeName(companionExport.type, typeName)),
        );
      }
    }
  }

  return replacements;
}

/**
 * The unresolved conditional an alias resolves to, when it is written in the project. One
 * inside a dependency, like React's `ComponentPropsWithRef`, is not part of the documented
 * API.
 *
 * @param declaration - Alias declaration to inspect.
 * @param program - Program that owns the declaration.
 * @returns The conditional, or `undefined` when the alias resolves to anything else.
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
 *
 * @param typeParameters - Type parameters of the alias.
 * @param conditional - Conditional the alias resolves to.
 * @param checker - Checker of the program that owns the alias.
 * @returns The type parameters the condition refers to.
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

function getTypeAliasDeclaration(
  typeName: ts.EntityName,
  checker: ts.TypeChecker,
): ts.TypeAliasDeclaration | undefined {
  const symbol = checker.getSymbolAtLocation(typeName);
  const target =
    symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return target?.declarations?.find(ts.isTypeAliasDeclaration);
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
 *
 * @param probe - Probe to refer to.
 * @param from - Declaration the reference is written next to.
 * @returns Type syntax naming the probe.
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
 *
 * @param program - Program to extend.
 * @param insertions - Generated aliases, by the declaration they follow.
 * @returns A program that reuses every unchanged file of `program`.
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

  // Generated aliases are type-checked even in declaration files. They repeat every type
  // parameter of the declaration they follow, used or not.
  const options = {
    ...program.getCompilerOptions(),
    skipLibCheck: false,
    noUnusedParameters: false,
    noUnusedLocals: false,
  };
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
 *
 * @param program - Program to read the file from.
 * @param fileName - File to look up.
 * @returns The file a compiler host should return for `fileName`.
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

function getGeneratedAlias(
  name: string,
  aliasesByName: Map<string, ts.TypeAliasDeclaration>,
): ts.TypeAliasDeclaration {
  const declaration = aliasesByName.get(name);
  if (!declaration) {
    throw new Error(`The generated alias ${name} is missing from the substitution program.`);
  }
  return declaration;
}

/**
 * Which branch a probe takes.
 *
 * @param name - Name of the generated probe instantiation.
 * @param aliasesByName - Generated aliases of the substitution program.
 * @param checker - Checker of the substitution program.
 * @returns `T` or `F`, `never` when a distributive condition had nothing to distribute
 * over, or `undecided` when it is both branches or still generic.
 */
function readProbe(
  name: string,
  aliasesByName: Map<string, ts.TypeAliasDeclaration>,
  checker: ts.TypeChecker,
): 'T' | 'F' | 'never' | 'undecided' {
  const type = checker.getTypeAtLocation(getGeneratedAlias(name, aliasesByName).name);
  if (type.flags & ts.TypeFlags.Never) {
    return 'never';
  }
  if (type.isStringLiteral() && (type.value === 'T' || type.value === 'F')) {
    return type.value;
  }
  return 'undecided';
}
